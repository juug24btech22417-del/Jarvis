// Form Fill History — tracks every autofill event for analytics.
//
// Stores are in-memory with optional persistence to disk (JSON file).
// No database migration needed — the data is append-only and lightweight.

import fs from "fs/promises";
import path from "path";

export interface FormFillRecord {
  id: string;
  url: string;
  domain: string;
  timestamp: string; // ISO
  fieldsFilled: Array<{ field: string; selector: string; value: string }>;
  totalFields: number;
  success: boolean;
  error?: string;
  source: "bookmarklet" | "telegram" | "api" | "playwright";
  /** Duration in ms from page load to last field filled */
  durationMs?: number;
}

export interface FormFillAnalytics {
  totalFills: number;
  successRate: number;
  fillsToday: number;
  fillsThisWeek: number;
  fillsThisMonth: number;
  topDomains: Array<{ domain: string; count: number }>;
  topFields: Array<{ field: string; count: number }>;
  fillsByDay: Array<{ date: string; count: number }>;
  fillsByHour: Array<{ hour: number; count: number }>;
  avgFieldsPerForm: number;
  unmatchedFieldRate: number;
  recentFills: FormFillRecord[];
  errorRate: number;
}

const HISTORY_FILE = path.join(process.cwd(), ".jarvis_form_history.json");
let historyBuffer: FormFillRecord[] = [];
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  try {
    const raw = await fs.readFile(HISTORY_FILE, "utf8");
    historyBuffer = JSON.parse(raw);
  } catch {
    historyBuffer = [];
  }
  loaded = true;
}

async function persist() {
  try {
    // Keep last 1000 records max
    const trimmed = historyBuffer.slice(-1000);
    await fs.writeFile(HISTORY_FILE, JSON.stringify(trimmed, null, 2), "utf8");
  } catch (err) {
    console.error("[FormHistory] persist error:", err);
  }
}

export async function recordFormFill(record: Omit<FormFillRecord, "id" | "timestamp">) {
  await ensureLoaded();
  const entry: FormFillRecord = {
    id: `fill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...record,
  };
  historyBuffer.push(entry);
  await persist();
  return entry;
}

export async function getFormHistory(opts?: {
  limit?: number;
  domain?: string;
  source?: string;
  since?: string;
}): Promise<FormFillRecord[]> {
  await ensureLoaded();
  let records = [...historyBuffer];

  if (opts?.domain) {
    records = records.filter((r) => r.domain.includes(opts.domain!));
  }
  if (opts?.source) {
    records = records.filter((r) => r.source === opts.source);
  }
  if (opts?.since) {
    const sinceMs = new Date(opts.since).getTime();
    records = records.filter((r) => new Date(r.timestamp).getTime() >= sinceMs);
  }

  return records.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  ).slice(0, opts?.limit ?? 100);
}

export async function getFormFillAnalytics(): Promise<FormFillAnalytics> {
  await ensureLoaded();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const totalFills = historyBuffer.length;
  const successFills = historyBuffer.filter((r) => r.success);
  const errorFills = historyBuffer.filter((r) => !r.success);

  const fillsToday = historyBuffer.filter(
    (r) => new Date(r.timestamp) >= todayStart
  ).length;
  const fillsThisWeek = historyBuffer.filter(
    (r) => new Date(r.timestamp) >= weekStart
  ).length;
  const fillsThisMonth = historyBuffer.filter(
    (r) => new Date(r.timestamp) >= monthStart
  ).length;

  // Domain frequency
  const domainMap = new Map<string, number>();
  historyBuffer.forEach((r) => {
    domainMap.set(r.domain, (domainMap.get(r.domain) || 0) + 1);
  });
  const topDomains = [...domainMap.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Field frequency
  const fieldMap = new Map<string, number>();
  historyBuffer.forEach((r) => {
    r.fieldsFilled.forEach((f) => {
      fieldMap.set(f.field, (fieldMap.get(f.field) || 0) + 1);
    });
  });
  const topFields = [...fieldMap.entries()]
    .map(([field, count]) => ({ field, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Fills by day (last 30 days)
  const fillsByDay: Array<{ date: string; count: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(todayStart);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const count = historyBuffer.filter(
      (r) => r.timestamp.slice(0, 10) === dateStr
    ).length;
    fillsByDay.push({ date: dateStr, count });
  }

  // Fills by hour
  const fillsByHour: Array<{ hour: number; count: number }> = Array.from(
    { length: 24 },
    (_, h) => ({
      hour: h,
      count: historyBuffer.filter(
        (r) => new Date(r.timestamp).getHours() === h
      ).length,
    })
  );

  // Average fields per form
  const totalFieldCount = historyBuffer.reduce(
    (sum, r) => sum + r.totalFields,
    0
  );
  const avgFieldsPerForm =
    totalFills > 0 ? Math.round((totalFieldCount / totalFills) * 10) / 10 : 0;

  // Unmatched field rate — approximate: if totalFields is 0, the form had no
  // detectable fields or none matched
  const unmatchedCount = historyBuffer.filter((r) => r.totalFields === 0).length;
  const unmatchedFieldRate =
    totalFills > 0
      ? Math.round((unmatchedCount / totalFills) * 100 * 10) / 10
      : 0;

  return {
    totalFills,
    successRate:
      totalFills > 0
        ? Math.round((successFills.length / totalFills) * 100 * 10) / 10
        : 100,
    fillsToday,
    fillsThisWeek,
    fillsThisMonth,
    topDomains,
    topFields,
    fillsByDay,
    fillsByHour,
    avgFieldsPerForm,
    unmatchedFieldRate,
    recentFills: historyBuffer.slice(-20).reverse(),
    errorRate:
      totalFills > 0
        ? Math.round((errorFills.length / totalFills) * 100 * 10) / 10
        : 0,
  };
}

export async function clearFormHistory() {
  historyBuffer = [];
  await persist();
}
