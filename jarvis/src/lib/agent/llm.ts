// Shared multi-provider LLM helper for the agent subsystems (browser agent,
// follow-up chat, video brief). Mirrors the provider strategy in
// AgentService.llmRace — Gemini → Groq → OpenRouter → NVIDIA, launched with
// a stagger so a dead first provider never blocks the whole call.

import {
  GEMINI_PLANNER_MODEL,
  GROQ_PLANNER_MODELS,
  OPENROUTER_PLANNER_MODELS,
} from "./types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NIM_MODEL = process.env.NVIDIA_MODEL || "nvidia/nemotron-3-super-120b-a12b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export type LlmProviderName = "gemini" | "groq" | "openrouter" | "nvidia";

export interface AgentLlmOptions {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  label?: string;
  /** Request a JSON object response where supported. */
  json?: boolean;
  /**
   * Preferred provider order. Providers not listed are appended in the default
   * order. Used by background jobs (memory extraction) to stay OFF the lanes
   * the interactive chat reply is racing on, so they never cause a rate-limit
   * cascade that turns a 2s answer into a 20s one.
   */
  providerOrder?: LlmProviderName[];
}

/**
 * Run a prompt through the provider chain. Throws only when every provider
 * fails (callers that can degrade should catch and fall back).
 */
export async function agentLlm(opts: AgentLlmOptions): Promise<string> {
  const label = opts.label ?? "agent";
  const timeoutMs = opts.timeoutMs ?? 40_000;
  const payload = {
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    max_tokens: opts.maxTokens ?? 800,
    temperature: opts.temperature ?? 0.3,
  };

  const attempt = async (
    provider: string,
    url: string,
    apiKey: string,
    model: string,
    extraHeaders?: Record<string, string>
  ): Promise<string> => {
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...extraHeaders },
        body: JSON.stringify({
          model,
          ...payload,
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        }),
      },
      timeoutMs
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`${label} HTTP ${res.status} (${provider}/${model})${detail ? `: ${detail.slice(0, 120)}` : ""}`);
    }
    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) throw new Error(`${label} empty content (${provider}/${model})`);
    return content.trim();
  };

  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const nimKey = process.env.NVIDIA_API_KEY;

  const byProvider: Record<LlmProviderName, Array<() => Promise<string>>> = {
    gemini: [],
    groq: [],
    openrouter: [],
    nvidia: [],
  };
  if (geminiKey) byProvider.gemini.push(() => attempt("gemini", GEMINI_URL, geminiKey, GEMINI_PLANNER_MODEL));
  if (groqKey) for (const m of GROQ_PLANNER_MODELS) byProvider.groq.push(() => attempt("groq", GROQ_URL, groqKey, m));
  if (openrouterKey) {
    for (const m of OPENROUTER_PLANNER_MODELS) {
      byProvider.openrouter.push(() =>
        attempt("openrouter", OPENROUTER_URL, openrouterKey, m, {
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "JARVIS AI Assistant",
        })
      );
    }
  }
  if (nimKey) byProvider.nvidia.push(() => attempt("nvidia", NIM_URL, nimKey, NIM_MODEL));

  const defaultOrder: LlmProviderName[] = ["gemini", "groq", "openrouter", "nvidia"];
  const order = opts.providerOrder && opts.providerOrder.length > 0
    ? [...opts.providerOrder, ...defaultOrder.filter((p) => !opts.providerOrder!.includes(p))]
    : defaultOrder;

  const chain: Array<() => Promise<string>> = [];
  for (const provider of order) chain.push(...byProvider[provider]);

  if (chain.length === 0) throw new Error(`no LLM provider key configured for ${label}`);

  const STAGGER_MS = 500;
  return await new Promise<string>((resolve, reject) => {
    const errors: string[] = [];
    const total = chain.length;
    let launched = 0;
    let settled = false;

    const pump = () => {
      if (settled || launched >= total) return;
      const idx = launched++;
      chain[idx]().then(
        (res) => {
          if (!settled) {
            settled = true;
            resolve(res);
          }
        },
        (e) => {
          errors.push((e as Error)?.message || String(e));
          if (errors.length >= total && !settled) {
            settled = true;
            reject(new Error(`All LLM providers failed for ${label}: ${errors.map((m) => m.slice(0, 70)).join(" | ")}`));
            return;
          }
          pump();
        }
      );
    };

    pump();
    for (let i = 1; i < total; i++) setTimeout(() => { if (!settled) pump(); }, i * STAGGER_MS);
  });
}

/** Extract the first JSON object from a possibly-fenced LLM response. */
export function parseJsonLoose<T = Record<string, unknown>>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
