// Browser watchers — recurring automations with alert conditions.
//
// POST /api/browser/watch                     → create/update a watcher
// POST /api/browser/watch {action:"check"}    → run all due checks now
// GET  /api/browser/watch                     → list watchers (lazy-ticks due checks)
// GET  /api/browser/watch?id=...&history=1    → samples for one watcher
// DELETE /api/browser/watch?id=...            → remove
//
// No external scheduler needed: listing watchers opportunistically ticks
// due checks in the background (guarded to at most once per 10 minutes),
// so an active panel keeps watch jobs alive on its own.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/queries";
import { runActions, parsePrice, BrowserAction } from "@/lib/browser/engine";

interface WatchBody {
  id?: string;
  name?: string;
  workflow?: string;
  actions?: BrowserAction[];
  variables?: Record<string, string>;
  selector?: string;
  extract?: "price" | "text" | "contains";
  condition?: "lt" | "gt" | "eq" | "changed" | "contains";
  threshold?: number;
  expectedText?: string;
  intervalMin?: number;
  active?: boolean;
  action?: "check";
  dueOnly?: boolean;
}

// ─── Shared: store sample, compare, alert via Telegram ──────────────

async function sampleAndAlert(
  watchId: string,
  name: string,
  condition: string,
  threshold: number | null,
  expectedText: string | null,
  lastValue: string | null,
  text: string | null,
  value: number | null,
  now: Date
): Promise<{ alerted: boolean }> {
  await prisma.watchSample.create({
    data: { watchId, value, text: text?.slice(0, 300) ?? null },
  });

  let met = false;
  if (condition === "lt" && value !== null && threshold !== null) met = value < threshold;
  else if (condition === "gt" && value !== null && threshold !== null) met = value > threshold;
  else if (condition === "eq" && value !== null && threshold !== null) met = Math.abs(value - threshold) < 0.01;
  else if (condition === "contains" && text && expectedText) met = text.toLowerCase().includes(expectedText.toLowerCase());
  else if (condition === "changed" && text) met = !!lastValue && lastValue !== text;

  await prisma.watchJob.update({
    where: { id: watchId },
    data: { lastCheckedAt: now, checkCount: { increment: 1 }, lastValue: text?.slice(0, 250) ?? lastValue },
  });

  let alerted = false;
  if (met) {
    const w = await prisma.watchJob.findUnique({ where: { id: watchId } });
    // Alert at most once per hour per watcher.
    if (!w?.lastAlertAt || now.getTime() - w.lastAlertAt.getTime() > 60 * 60_000) {
      const detail =
        condition === "contains"
          ? `"${expectedText}" appeared`
          : condition === "changed"
            ? `value changed: ${lastValue?.slice(0, 40) || "?"} → ${text?.slice(0, 40)}`
            : `value ${text} ${condition === "lt" ? "is below" : condition === "gt" ? "is above" : "equals"} ${threshold}`;
      await fetch("http://localhost:3000/api/telegram/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `🔔 Watcher "${name}": ${detail}`, fromSource: "browser-watch" }),
      }).catch(() => {});
      await prisma.watchJob.update({ where: { id: watchId }, data: { lastAlertAt: now } });
      alerted = true;
    }
  }
  return { alerted };
}

// ─── Due-check engine (shared by POST check + lazy tick) ────────────

type WatchOutcome = { name: string; status: string; value: string | null; alerted: boolean };

async function readWatchValue(w: {
  workflow: string;
  actionsJson: string | null;
  variablesJson: string;
  selector: string | null;
  extract: string;
}): Promise<{ text: string | null; value: number | null; captcha: boolean }> {
  if (w.workflow === "custom") {
    const customActions = JSON.parse(w.actionsJson || "[]") as BrowserAction[];
    const run = await runActions(
      [...customActions, { type: "getText", selector: w.selector ?? "body", optional: true }],
      { globalTimeoutMs: 75_000 }
    );
    const got = [...run.results].reverse().find((r) => r.action === "getText");
    const text = got?.text ?? null;
    const value = w.extract === "price" && text ? parsePrice(text) : null;
    return { text, value, captcha: run.captcha };
  }

  // Saved workflow: execute through the API (reuses its logic + savings on saveRun).
  const res = await fetch("http://localhost:3000/api/browser", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflow: w.workflow, variables: JSON.parse(w.variablesJson || "{}"), saveRun: false }),
  });
  const data = await res.json();
  const evalResult = (data.results ?? []).find((r: { action: string }) => r.action === "evaluate");
  let text: string | null = null;
  if (evalResult) {
    const products = JSON.parse(String(evalResult.result ?? "[]")) as Array<{ title?: string; price?: string }>;
    // Watch the CHEAPEST of the sampled results — that's what "ping me when
    // it drops" actually means. Falls back to the first product.
    const priced = products.filter((p) => p.price && parsePrice(p.price) !== null);
    const best = priced.length
      ? priced.reduce((a, b) => ((parsePrice(b.price!) ?? Infinity) < (parsePrice(a.price!) ?? Infinity) ? b : a))
      : products[0];
    if (best?.price) text = best.title ? `${best.title} — ${best.price}` : best.price;
  }
  const value = text && w.extract === "price" ? parsePrice(text.split("—").pop() ?? text) : null;
  return { text, value, captcha: !!data.captcha };
}

async function runDueChecks(max = 5): Promise<WatchOutcome[]> {
  const now = new Date();
  const due = await prisma.watchJob.findMany({
    where: { active: true },
    orderBy: { lastCheckedAt: "asc" },
    take: max,
  });

  const outcomes: WatchOutcome[] = [];
  for (const w of due) {
    try {
      const interval = w.intervalMin * 60_000;
      if (w.lastCheckedAt && now.getTime() - w.lastCheckedAt.getTime() < interval) continue;

      const { text, value, captcha } = await readWatchValue(w);
      const { alerted } = await sampleAndAlert(
        w.id, w.name, w.condition, w.threshold, w.expectedText, w.lastValue, text, value, now
      );
      outcomes.push({ name: w.name, status: captcha ? "captcha" : "ok", value: text, alerted });
    } catch (e) {
      outcomes.push({ name: w.name, status: "error", value: null, alerted: false });
      console.warn("[Watch] check failed:", (e as Error).message);
    }
  }
  return outcomes;
}

// Lazy tick: at most once per 10 minutes, fire-and-forget.
let lastTick = 0;
function maybeTickWatchers(): void {
  const now = Date.now();
  if (now - lastTick < 10 * 60_000) return;
  lastTick = now;
  runDueChecks().catch((e) => console.warn("[Watch] lazy tick failed:", (e as Error).message));
}

// ─── Routes ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as WatchBody;

  if (body.action === "check") {
    const outcomes = await runDueChecks();
    return NextResponse.json({ success: true, checked: outcomes.length, outcomes });
  }

  const { id, name, workflow, actions, variables = {}, selector, extract, condition, threshold, expectedText, intervalMin, active } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if ((workflow ?? "custom") === "custom" && !actions?.length) {
    return NextResponse.json({ error: "custom watchers need actions" }, { status: 400 });
  }

  const data = {
    name: name.trim().slice(0, 80),
    workflow: workflow ?? "custom",
    actionsJson: actions ? JSON.stringify(actions.slice(0, 40)) : null,
    variablesJson: JSON.stringify(variables),
    selector: selector ?? null,
    extract: extract ?? "price",
    condition: condition ?? "lt",
    threshold: threshold ?? null,
    expectedText: expectedText ?? null,
    intervalMin: Math.max(15, intervalMin ?? 60),
    active: active ?? true,
  };

  const watch = id ? await prisma.watchJob.update({ where: { id }, data }) : await prisma.watchJob.create({ data });
  return NextResponse.json({ success: true, watch });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id && url.searchParams.get("history") === "1") {
    const samples = await prisma.watchSample.findMany({
      where: { watchId: id },
      orderBy: { takenAt: "desc" },
      take: 40,
    });
    return NextResponse.json({ success: true, samples: samples.reverse() });
  }

  // Listing opportunistically ticks due checks in the background.
  maybeTickWatchers();

  const watches = await prisma.watchJob.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ success: true, watches });
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await prisma.watchJob.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ success: true });
}
