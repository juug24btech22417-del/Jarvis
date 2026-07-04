// Tier 2D — Second Me agent.
// One input → many artifacts. The LLM extracts a structured bundle
// (tasks, notes, memory cues, timers). Artifacts are returned in the
// response — the UI applies them so the user approves before they land.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct:free";

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export interface SecondMeTask {
  title: string;
  /** optional: critical | high | normal | someday. */
  priority?: "critical" | "high" | "normal" | "someday";
  /** optional ISO date string. */
  due?: string;
}

export interface SecondMeNote {
  title: string;
  content: string;
  tags?: string[];
}

export interface SecondMeMemoryCue {
  name: string;
  type: string; // PERSON | COMPANY | PROJECT | CONCEPT | LOCATION | SKILL | PREFERENCE | EVENT
  description: string;
}

export interface SecondMeTimer {
  label: string;
  minutes: number;
}

export interface SecondMeBundle {
  summary: string;
  tasks: SecondMeTask[];
  notes: SecondMeNote[];
  memoryCues: SecondMeMemoryCue[];
  timers: SecondMeTimer[];
}

const SYSTEM_PROMPT = [
  "You are JARVIS, parsing a brief the user just dropped into you.",
  "Extract a structured bundle of artifacts as JSON only — no commentary, no markdown.",
  "Schema:",
  "{",
  '  "summary": "<one-line summary of the brief>",',
  '  "tasks": [{"title": "...", "priority": "critical|high|normal|someday", "due": "<ISO date or omit>"}],',
  '  "notes": [{"title": "...", "content": "...", "tags": ["..."]}],',
  '  "memoryCues": [{"name": "...", "type": "PERSON|COMPANY|PROJECT|CONCEPT|LOCATION|SKILL|PREFERENCE|EVENT", "description": "..."}],',
  '  "timers": [{"label": "...", "minutes": <int>}]',
  "}",
  "Be conservative: only include artifacts clearly implied by the brief. Empty arrays are fine.",
].join("\n");

function emptyBundle(): SecondMeBundle {
  return { summary: "", tasks: [], notes: [], memoryCues: [], timers: [] };
}

/**
 * Parse the brief via LLM. Returns a deterministic fallback bundle
 * (just the summary) if the API key is missing or the model fails.
 */
export async function parseBrief(input: string): Promise<SecondMeBundle> {
  const trimmed = input.trim().slice(0, 6000);
  if (!trimmed) return emptyBundle();

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { ...emptyBundle(), summary: trimmed.slice(0, 200) };
  }

  try {
    const res = await fetchWithTimeout(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: trimmed },
        ],
        max_tokens: 800,
        temperature: 0.3,
      }),
    }, 12000);
    if (!res.ok) return { ...emptyBundle(), summary: trimmed.slice(0, 200) };
    const data = await res.json();
    const text: string = data?.choices?.[0]?.message?.content ?? "";
    const json = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(json);
    return sanitize(parsed);
  } catch {
    return { ...emptyBundle(), summary: trimmed.slice(0, 200) };
  }
}

function sanitize(raw: unknown): SecondMeBundle {
  const out = emptyBundle();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;

  if (typeof r.summary === "string") out.summary = r.summary.slice(0, 400);

  if (Array.isArray(r.tasks)) {
    for (const t of r.tasks.slice(0, 12)) {
      if (t && typeof t === "object" && typeof (t as SecondMeTask).title === "string") {
        const task = t as SecondMeTask;
        const validPriorities = ["critical", "high", "normal", "someday"] as const;
        out.tasks.push({
          title: task.title.slice(0, 200),
          priority: validPriorities.includes(task.priority as (typeof validPriorities)[number])
            ? (task.priority as SecondMeTask["priority"])
            : "normal",
          due: typeof task.due === "string" ? task.due : undefined,
        });
      }
    }
  }

  if (Array.isArray(r.notes)) {
    for (const n of r.notes.slice(0, 8)) {
      if (n && typeof n === "object" && typeof (n as SecondMeNote).title === "string") {
        const note = n as SecondMeNote;
        out.notes.push({
          title: note.title.slice(0, 120),
          content: typeof note.content === "string" ? note.content.slice(0, 2000) : "",
          tags: Array.isArray(note.tags) ? note.tags.filter((t) => typeof t === "string").slice(0, 8) as string[] : undefined,
        });
      }
    }
  }

  if (Array.isArray(r.memoryCues)) {
    for (const m of r.memoryCues.slice(0, 12)) {
      if (m && typeof m === "object" && typeof (m as SecondMeMemoryCue).name === "string") {
        const cue = m as SecondMeMemoryCue;
        out.memoryCues.push({
          name: cue.name.slice(0, 120),
          type: typeof cue.type === "string" ? cue.type : "CONCEPT",
          description: typeof cue.description === "string" ? cue.description.slice(0, 400) : "",
        });
      }
    }
  }

  if (Array.isArray(r.timers)) {
    for (const t of r.timers.slice(0, 6)) {
      if (t && typeof t === "object" && typeof (t as SecondMeTimer).label === "string") {
        const timer = t as SecondMeTimer;
        const minutes = typeof timer.minutes === "number" ? Math.max(1, Math.min(720, Math.round(timer.minutes))) : null;
        if (minutes) out.timers.push({ label: timer.label.slice(0, 80), minutes });
      }
    }
  }

  return out;
}

/**
 * Apply a bundle to the various systems.
 * - tasks: POST to /api/tasks (fire-and-forget per item)
 * - notes: POST to /api/notes (fire-and-forget per item)
 * - memoryCues: addEntity per cue (await sequentially — they're cheap)
 * - timers: POST to /api/timer per item
 */
export async function applyBundle(bundle: SecondMeBundle): Promise<{
  tasks: number;
  notes: number;
  memoryCues: number;
  timers: number;
}> {
  const counts = { tasks: 0, notes: 0, memoryCues: 0, timers: 0 };

  await Promise.all(
    bundle.tasks.map(async (t) => {
      try {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: t.title,
            priority: t.priority ?? "normal",
            dueDate: t.due,
          }),
        });
        if (res.ok) counts.tasks++;
      } catch {
        // ignore
      }
    })
  );

  await Promise.all(
    bundle.notes.map(async (n) => {
      try {
        const res = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", title: n.title, content: n.content, tags: n.tags }),
        });
        if (res.ok) counts.notes++;
      } catch {
        // ignore
      }
    })
  );

  await Promise.all(
    bundle.memoryCues.map(async (c) => {
      try {
        const { addEntity } = await import("@/lib/memory/graph");
        await addEntity({ name: c.name, type: c.type, description: c.description });
        counts.memoryCues++;
      } catch {
        // ignore
      }
    })
  );

  await Promise.all(
    bundle.timers.map(async (t) => {
      try {
        const res = await fetch("/api/timer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", minutes: t.minutes, label: t.label }),
        });
        if (res.ok) counts.timers++;
      } catch {
        // ignore
      }
    })
  );

  return counts;
}