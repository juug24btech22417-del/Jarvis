/**
 * Macro Generator — natural language → macro.
 *
 * "open youtube and play lofi" → a real, replayable macro. The LLM emits
 * JSON steps (browser or desktop), we validate/normalize every one, and
 * anything that varies per-run (search text, username…) becomes a
 * {{variable}} the user fills at replay time — or dictating
 * "play <song> on youtube" pre-fills it.
 */

import { runLlmChain } from "./LlmChain";
import { saveMacro } from "@/lib/ghost/macroStore";
import { extractMacroVariables } from "@/lib/ghost/macroStore";
import type { MacroStep, StepAction } from "@/lib/ghost/macroTypes";

const BROWSER_ACTIONS: StepAction[] = [
  "goto", "click", "type", "fill", "select", "press", "wait",
  "scroll", "hover", "submit", "screenshot",
];
const DESKTOP_ACTIONS: StepAction[] = ["launch", "focus", "click", "type", "fill", "press", "wait", "scroll"];

const SYSTEM_PROMPT = `You convert a user's plain-English request into a JSON macro for a Windows PC assistant.

Output ONLY raw JSON — no markdown fences, no explanations, no <think> blocks.

Schema:
{
  "name": "short Title Case name (max 5 words)",
  "description": "one sentence",
  "mode": "browser" | "desktop",
  "targetUrl": "https://... (browser mode only, the main site)",
  "steps": [ ... ]
}

Browser steps (Playwright CSS selectors):
{"action":"goto","target":"https://youtube.com"}
{"action":"click","target":"ytd-searchbox input#search"}
{"action":"type","target":"input#search","value":"{{search}}"}
{"action":"press","value":"Enter"}
{"action":"wait","value":"2000"}
{"action":"scroll","value":"down"}   (or "up")
{"action":"fill","target":"css","value":"text"}
{"action":"select","target":"css select","value":"optionValue"}

Desktop steps (Windows apps):
{"action":"launch","target":"spotify"}          (process name, no .exe)
{"action":"focus","target":"notepad"}
{"action":"click","target":"Description of element","options":{"uiaName":"exact visible text of the element","uiaProcess":"spotify"}}
{"action":"type","value":"{{song}}"}
{"action":"press","value":"Enter"}
{"action":"wait","value":"1000"}

RULES:
1. Use {{doubleBraces}} for ANY text that depends on the user's request wording (song name, search query, message text, recipient…). Keep them SHORT single-word-ish names like search, song, message, query. NEVER put long user phrases literally into value — templatize them.
2. Selectors must be real, stable CSS: prefer ID selectors (#search), then aria/data attributes, then structural. YouTube search box = "input#search" or "ytd-searchbox", search button = "button#search-icon-legacy". Google search box = "textarea[name=q]".
3. After typing into a search box, press Enter, then wait 2500ms for results.
4. For "play a song/video on YouTube": goto youtube.com → type {{search}} in input#search → press Enter → wait 3000 → click the first result with selector "ytd-video-renderer a#video-title" (use ytd-video-renderer NOT ytd-item-section-renderer).
5. Desktop apps: launch first, wait 2000, then interact. Common processes: spotify, notepad, calc, mspaint, chrome, msedge.
6. Order matters. Keep it minimal — no redundant steps.
7. If the request is impossible to map (e.g. "delete my emails" without a site), still produce your best-effort generic macro.

User request: `;

interface GenStep {
  action?: string;
  target?: string;
  value?: string;
  options?: Record<string, unknown>;
  description?: string;
}

export interface GeneratedMacro {
  id: string;
  name: string;
  description?: string;
  mode: "browser" | "desktop";
  steps: MacroStep[];
  variables: Array<{ name: string; description?: string }>;
  provider: string;
  model: string;
}

/** Strip <think> reasoning blocks and markdown fences some models emit. */
function cleanLlmOutput(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*/gi, "") // unclosed think block
    .replace(/```(?:json)?/gi, "")
    .trim();
}

/** Pull the outermost JSON object out of noisy LLM output. */
function extractJson(raw: string): any | null {
  const cleaned = cleanLlmOutput(raw);
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  // Walk to the matching closing brace (handles nested objects/strings)
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function stepId(): string {
  return `genstep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * YouTube (and friends) keep renaming their search buttons — current DOM
 * has no button#search-icon-legacy, but pressing Enter in the search box
 * always works. Rewrite type→click(search-icon) into type→press Enter.
 */
function normalizeSearchSubmit(steps: MacroStep[]): MacroStep[] {
  const out: MacroStep[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const next = steps[i + 1];
    if (
      s.action === "type" &&
      /search|input#search|textarea\[name=.?q/i.test(s.target || "") &&
      next &&
      next.action === "click" &&
      /search-icon|search.?button|searchbtn/i.test(next.target || "")
    ) {
      out.push(s);
      out.push({
        id: stepId(),
        action: "press",
        value: "Enter",
        description: "Submit search",
      });
      i++; // skip the doomed search-button click
      continue;
    }
    out.push(s);
  }
  return out;
}

/**
 * YouTube search flows must actually PLAY: if the macro searches but
 * never clicks a result, append the result click. Small models skip it
 * randomly — this makes the outcome deterministic.
 */
function ensureYouTubeResultClick(steps: MacroStep[]): MacroStep[] {
  const isYouTubeFlow = steps.some(
    (s) => (s.target || "").includes("youtube") || /search/i.test(s.target || "")
  );
  if (!isYouTubeFlow) return steps;
  const clicksResult = steps.some((s) => /ytd-video-renderer|video-title/i.test(s.target || ""));
  if (clicksResult) return steps;
  return [
    ...steps,
    { id: stepId(), action: "wait", value: "1500", description: "Wait for results" },
    {
      id: stepId(),
      action: "click",
      target: "ytd-video-renderer a#video-title",
      description: "Click first video result",
    },
  ];
}

/** Collapse consecutive wait steps — LLMs love padding with 2s waits. */
function collapseWaits(steps: MacroStep[]): MacroStep[] {
  const out: MacroStep[] = [];
  for (const s of steps) {
    const prev = out[out.length - 1];
    if (s.action === "wait" && prev?.action === "wait") {
      const total = Math.min((parseInt(prev.value || "0", 10) || 0) + (parseInt(s.value || "0", 10) || 0), 6000);
      prev.value = String(total);
      continue;
    }
    out.push(s);
  }
  return out;
}

/** Validate + normalize one LLM step. Returns null if unusable. */
function normalizeStep(s: GenStep, mode: "browser" | "desktop"): MacroStep | null {
  if (!s || typeof s !== "object") return null;
  let action = String(s.action || "").toLowerCase() as StepAction;

  // LLMs sometimes emit press with a CSS target when they mean click —
  // a keyboard "press" has no selector. Coerce to click so the step
  // actually presses the button the model pointed at.
  if (action === "press" && s.target && /^[#a-zA-Z[]/.test(String(s.target))) {
    action = "click";
  }

  const allowed = mode === "desktop" ? DESKTOP_ACTIONS : BROWSER_ACTIONS;
  if (!allowed.includes(action)) return null;

  const step: MacroStep = {
    id: stepId(),
    action,
    description: String(s.description || "").slice(0, 120) || undefined,
  };
  if (s.target !== undefined && s.target !== null && String(s.target).trim() !== "") {
    step.target = String(s.target).slice(0, 500);
  }
  if (s.value !== undefined && s.value !== null && String(s.value).trim() !== "") {
    step.value = String(s.value).slice(0, 500);
  }
  // Playwright rejects bare domains — normalize goto targets to full URLs
  if (action === "goto" && step.target && !/^[a-z][a-z0-9+.-]*:/i.test(step.target)) {
    step.target = `https://${step.target}`;
  }
  if (action === "wait") {
    const ms = parseInt(step.value || "1000", 10);
    step.value = String(Math.min(Math.max(isNaN(ms) ? 1000 : ms, 100), 15000));
  }

  // Desktop semantic target — normalize into our UiaTarget shape
  if (mode === "desktop") {
    const uiaName = (s.options as any)?.uiaName ?? (s.options as any)?.uia?.name;
    const uiaProc = (s.options as any)?.uiaProcess ?? (s.options as any)?.uia?.process;
    if (uiaName && action !== "launch" && action !== "focus") {
      step.options = {
        ...(step.options || {}),
        uia: {
          process: String(uiaProc || "").replace(/\.exe$/i, ""),
          name: String(uiaName),
          controlType: "",
          automationId: "",
          className: "",
          windowName: String(uiaProc || "").replace(/\.exe$/i, ""),
        },
      };
    }
  }

  // Browser steps need a target except pure keyboard/timing actions
  const needsTarget =
    mode === "browser" &&
    !["wait", "press", "scroll", "screenshot", "goto", "submit"].includes(action);
  if (needsTarget && !step.target) return null;

  return step;
}

export async function generateMacroFromPrompt(
  prompt: string
): Promise<{ success: boolean; macro?: GeneratedMacro; error?: string }> {
  const trimmed = (prompt || "").trim();
  if (!trimmed) return { success: false, error: "Describe what the macro should do" };

  const llm = await runLlmChain(SYSTEM_PROMPT + trimmed, {
    maxTokens: 1500,
    temperature: 0.1,
  });
  if (!llm) {
    return { success: false, error: "AI provider unreachable — try again in a moment" };
  }

  const parsed = extractJson(llm.content);
  if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    return { success: false, error: "AI returned an unreadable macro — try rephrasing" };
  }

  const mode: "browser" | "desktop" = parsed.mode === "desktop" ? "desktop" : "browser";
  const normalized = parsed.steps
    .map((s: GenStep) => normalizeStep(s, mode))
    .filter((s: MacroStep | null): s is MacroStep => s !== null)
    .slice(0, 25);
  const steps =
    mode === "browser"
      ? collapseWaits(ensureYouTubeResultClick(normalizeSearchSubmit(normalized)))
      : normalized;

  if (steps.length === 0) {
    return { success: false, error: "AI produced no usable steps — try being more specific" };
  }

  // Auto-declare {{variables}} found in steps — the panel prompts for
  // their values at replay time ("one macro, infinite uses").
  const variables = extractMacroVariables(steps);

  const name = String(parsed.name || trimmed.slice(0, 40))
    .replace(/[#<>:"/\\|?*]/g, "")
    .slice(0, 60) || "Generated macro";

  const saved = await saveMacro({
    name,
    description: String(parsed.description || `Generated from: "${trimmed.slice(0, 80)}"`).slice(0, 200),
    steps,
    tags: ["generated", mode === "desktop" ? "desktop" : "browser"],
    isFormFill: false,
    targetUrl: parsed.targetUrl ? String(parsed.targetUrl).slice(0, 300) : undefined,
    variables,
  });

  return {
    success: true,
    macro: {
      id: saved.id,
      name: saved.name,
      description: saved.description,
      mode,
      steps: saved.steps,
      variables,
      provider: llm.provider,
      model: llm.model,
    },
  };
}
