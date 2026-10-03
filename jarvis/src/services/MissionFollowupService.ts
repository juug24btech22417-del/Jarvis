// Post-mission conversation — now with real actions.
//
// After a mission finishes the user can keep talking about it: "compare #1 and
// #3", "show me more like this", "send it to my telegram", "save this to a
// file", "make me a video brief". Answers come from the shared agent LLM with a
// compact context built from the mission's findings; imperative follow-ups are
// EXECUTED here (Telegram push, note/file write, video brief) instead of being
// described, and the result is reported back in the conversation.

import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { randomUUID } from "crypto";
import type { AgentJob, MissionArtifact } from "@/lib/agent/types";
import { agentLlm } from "@/lib/agent/llm";
import { getJob, putJob, flushMissions } from "@/lib/agent/store";
import { detectFollowupAction, artifactFilename, type FollowupActionKind } from "@/lib/agent/followupIntent";
import { pickByOrdinal } from "@/lib/agent/followupRefs";
import { renderVideoBrief, briefSummary } from "@/services/MissionVideoService";

/** Flatten a mission's successful step outputs into readable context blocks. */
export function buildMissionContext(job: AgentJob, budget = 6000): string {
  const blocks: string[] = [];
  const stepById = new Map((job.plan?.steps ?? []).map((s) => [s.id, s]));
  job.results.forEach((r, i) => {
    if (r.status !== "ok") return;
    const out = r.result as Record<string, unknown> | undefined;
    const title = stepById.get(r.stepId)?.title ?? r.stepId;
    const body =
      typeof out?.summary === "string"
        ? out.summary
        : typeof out?.content === "string"
          ? out.content
          : typeof out?.markdown === "string"
            ? out.markdown
            : out
              ? JSON.stringify(out)
              : "";
    if (!body.trim()) return;
    blocks.push(`### [${i + 1}] ${title}\n${String(body).slice(0, 1800)}`);
  });

  if (job.artifacts?.length) {
    blocks.push(
      `### Artifacts (the user may refer to these as "the first/second one")\n` +
        job.artifacts
          .map((a, i) => `- [${i + 1}] (${a.kind}) ${a.label}: ${a.value}`)
          .join("\n")
    );
  }

  let text = blocks.join("\n\n");
  if (text.length > budget) text = text.slice(0, budget) + "\n…(truncated)";
  return text;
}

/** Strip the markdown JARVIS emits so the text travels well over Telegram. */
export function plainText(md: string): string {
  return (md || "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/^[-*•]\s+/gm, "• ")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1 ($2)")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Plain-text digest of a mission — what actually gets pushed to Telegram or
 * written to a file when the user asks for "it".
 */
export function missionDigest(job: AgentJob, maxChars = 3200): string {
  const ok = job.results.filter((r) => r.status === "ok").length;
  const stepById = new Map((job.plan?.steps ?? []).map((s) => [s.id, s]));
  const lines: string[] = [
    `🗂 JARVIS mission: ${job.goal}`,
    `Status: ${job.status}${job.partial ? " (partial)" : ""} · ${ok}/${job.results.length} steps ok`,
  ];
  if (job.plan?.summary) lines.push("", `Plan: ${job.plan.summary}`);

  const bodies: string[] = [];
  for (const r of job.results) {
    if (r.status !== "ok") continue;
    const out = r.result as Record<string, unknown> | undefined;
    const title = stepById.get(r.stepId)?.title ?? r.stepId;
    const body =
      typeof out?.summary === "string"
        ? out.summary
        : typeof out?.content === "string"
          ? out.content
          : typeof out?.markdown === "string"
            ? out.markdown
            : "";
    if (!body.trim()) continue;
    bodies.push(`— ${title} —\n${plainText(body)}`);
  }
  const findings = bodies.join("\n\n");
  const head = lines.join("\n");
  const budget = Math.max(400, maxChars - head.length - 200);
  return `${head}\n\n${findings.slice(0, budget)}${findings.length > budget ? "\n…" : ""}`;
}

/** Register an artifact on the job (de-duplicated) and persist. */
function addArtifact(job: AgentJob, kind: MissionArtifact["kind"], label: string, value: string): void {
  job.artifacts = job.artifacts ?? [];
  if (!job.artifacts.some((a) => a.value === value)) {
    job.artifacts.push({ id: randomUUID(), kind, label, value, stepId: "followup", at: Date.now() });
  }
}

export interface FollowupActionResult {
  kind: FollowupActionKind;
  ok: boolean;
  detail: string;
  artifact?: { kind: MissionArtifact["kind"]; label: string; value: string };
}

/** Notes folder shared with the Notes panel + the mission file_save step. */
function notesDir(): string {
  const dir = path.join(process.cwd(), "notes");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Open a mission artifact on the host: a URL in the browser, a file with its
 * default app. Windows-first (the whole app is), and a no-op elsewhere.
 */
function openArtifactOnHost(target: string): boolean {
  const value = (target || "").trim();
  if (!value) return false;
  const isUrl = /^https?:\/\//i.test(value);
  if (!isUrl) {
    try {
      if (!fs.existsSync(value)) return false;
    } catch {
      return false;
    }
  }
  if (process.platform !== "win32") return isUrl; // nothing to launch server-side
  try {
    const clean = value.replace(/"/g, "%22");
    exec(`cmd.exe /c start "" "${clean}"`, (err) => {
      if (err) console.warn("[Followup] open failed (non-fatal):", err.message);
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run the imperative follow-up. Returns a confirmation block for the chat and
 * a structured result for the API/UI. Never throws for expected failures
 * (missing Telegram target, disk error) — it explains what happened instead.
 */
export async function executeFollowupAction(job: AgentJob, message: string): Promise<FollowupActionResult | null> {
  const action = detectFollowupAction(message);
  if (action.kind === "none") return null;

  if (action.kind === "telegram") {
    const text = missionDigest(job);
    try {
      const { notifyUser } = await import("@/lib/telegram/notify");
      const res = await notifyUser(null, text, { fromSource: "mission-followup" });
      if (res.sent) {
        return {
          kind: "telegram",
          ok: true,
          detail: `Sent “${job.goal.slice(0, 60)}” to your Telegram (${text.length} chars).`,
        };
      }
      const why =
        res.error === "no_token"
          ? "TELEGRAM_BOT_TOKEN isn't configured"
          : res.error === "no_target"
            ? "no chat is registered yet — message your bot once and retry"
            : res.error || "unknown error";
      return { kind: "telegram", ok: false, detail: `Couldn't reach Telegram: ${why}.` };
    } catch (e) {
      return { kind: "telegram", ok: false, detail: `Telegram send failed: ${(e as Error).message}` };
    }
  }

  if (action.kind === "open") {
    const artifacts = job.artifacts ?? [];
    if (!artifacts.length) {
      return { kind: "open", ok: false, detail: "This mission didn't produce anything I can open." };
    }
    const picked = pickByOrdinal(artifacts, message) ?? artifacts[0];
    const ok = openArtifactOnHost(picked.value);
    return {
      kind: "open",
      ok,
      detail: ok
        ? `Opening “${picked.label}”${picked.kind === "url" ? ` — ${picked.value}` : ""}.`
        : `I found “${picked.label}” (${picked.value}) but couldn't open it automatically.`,
      artifact: { kind: picked.kind, label: picked.label, value: picked.value },
    };
  }

  if (action.kind === "video") {
    try {
      const { path: file, slides } = renderVideoBrief(job);
      addArtifact(job, "video", "Mission video brief", file);
      return { kind: "video", ok: true, detail: `Video brief rendered — ${slides.length} scenes.`, artifact: { kind: "video", label: "Mission video brief", value: file } };
    } catch (e) {
      return { kind: "video", ok: false, detail: `Couldn't render the brief: ${(e as Error).message}` };
    }
  }

  // note + file both write real text to the Notes folder so the Notes panel
  // and the user's file browser both see it.
  const asNote = action.kind === "note";
  const ext = asNote ? "txt" : /\b(md|markdown)\b/i.test(message) ? "md" : /\bcsv\b/i.test(message) ? "csv" : "txt";
  const filename = artifactFilename(job.goal, ext);
  try {
    const target = path.join(notesDir(), filename);
    const header = asNote ? `# ${job.goal}\n\n` : "";
    fs.writeFileSync(target, `${header}${missionDigest(job)}\n`, "utf8");
    const kind: MissionArtifact["kind"] = asNote ? "note" : "file";
    const label = asNote ? `Note: ${job.goal.slice(0, 50)}` : filename;
    addArtifact(job, kind, label, target);
    return { kind: action.kind, ok: true, detail: `${asNote ? "Note created" : "File saved"}: notes/${filename}`, artifact: { kind, label, value: target } };
  } catch (e) {
    return { kind: action.kind, ok: false, detail: `Couldn't write the file: ${(e as Error).message}` };
  }
}

const FOLLOWUP_SYSTEM = [
  "You are JARVIS continuing a conversation about a mission you just completed.",
  "You have the mission goal, its plan, its findings and its artifacts below.",
  "Answer the user's follow-up directly and concretely, using ONLY the mission context.",
  "Be concise, warm and precise. Use markdown bullets when listing. Never invent facts not in the context.",
  "If something is genuinely not in the context, say so briefly instead of guessing.",
].join("\n");

export interface FollowupResult {
  answer: string;
  turns: NonNullable<AgentJob["followups"]>;
  /** Set when the follow-up actually performed something. */
  action?: { kind: FollowupActionKind; ok: boolean; detail: string };
}

export async function answerFollowup(jobId: string, message: string): Promise<FollowupResult> {
  const job = getJob(jobId);
  if (!job) throw new Error("Mission not found");
  const question = message.trim();
  if (!question) throw new Error("Empty follow-up");

  const turns = job.followups ?? [];
  const now = Date.now();

  // Imperative follow-ups are executed, not described. This is the path that
  // makes "send it to my telegram" actually deliver.
  const performed = await executeFollowupAction(job, question);

  let answer: string;
  if (performed) {
    // Deterministic + instant: no LLM in the loop for an action turn, so the
    // confirmation can never disagree with what actually happened.
    const icon = performed.ok ? "✅" : "⚠️";
    answer = `${icon} ${performed.detail}`;
    const tail = buildMissionContext(job, 500);
    if (tail) answer += `\n\n_Mission context available — ask me anything else about it._`;
  } else {
    const history = turns
      .slice(-6)
      .map((t) => `${t.role === "user" ? "USER" : "JARVIS"}: ${t.content.slice(0, 800)}`)
      .join("\n");

    const context = buildMissionContext(job);
    const user = [
      `MISSION GOAL: ${job.goal}`,
      `PLAN: ${job.plan?.summary ?? "(none)"}`,
      `\nMISSION CONTEXT:\n${context || "(no findings)"}`,
      history ? `\nCONVERSATION SO FAR:\n${history}` : "",
      `\nUSER FOLLOW-UP: ${question}`,
    ].join("\n");

    try {
      answer = await agentLlm({ system: FOLLOWUP_SYSTEM, user, maxTokens: 700, temperature: 0.3, label: "followup" });
    } catch (e) {
      answer = `I couldn't reach my reasoning engine just now (${String((e as Error).message).slice(0, 80)}). The mission findings above are still available.`;
    }
  }

  const updated = [
    ...turns,
    { role: "user" as const, content: question, at: now },
    { role: "assistant" as const, content: answer, at: now + 1 },
  ];
  job.followups = updated;
  putJob(job);
  flushMissions();
  return {
    answer,
    turns: updated,
    ...(performed ? { action: { kind: performed.kind, ok: performed.ok, detail: performed.detail } } : {}),
  };
}
