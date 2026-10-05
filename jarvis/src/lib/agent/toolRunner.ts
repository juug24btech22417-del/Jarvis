// Autonomous Task Agent — real execution engine.
//
// A ReAct loop: the LLM looks at the goal and the trail of real tool results,
// picks ONE tool, we actually run it, and feed the true output back. Nothing
// here fabricates an outcome. Tools are the same real backends the MCP hub uses.
import { callJsonLlm } from "@/lib/llm/fastJson";
import { searchWebWithFallback } from "@/services/WebSearchFallback";
import { browserAct } from "@/services/BrowserAgentService";

const BASE =
  process.env.INTERNAL_BASE_URL ||
  process.env.INTERNAL_API_URL ||
  "http://localhost:3000";

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "thought"; text: string }
  | { type: "action"; step: number; tool: string; detail: string }
  | { type: "observation"; step: number; tool: string; output: string; ok: boolean }
  | { type: "final"; summary: string; ok: boolean }
  | { type: "error"; message: string };

export type Emit = (e: AgentEvent) => void;

export interface UserLocation {
  lat: number;
  lng: number;
  address?: string;
}

export interface AgentRunResult {
  ok: boolean;
  summary: string;
  steps: Array<{ tool: string; detail: string; output: string; ok: boolean }>;
}

interface Ctx {
  userLocation?: UserLocation;
}

/** One real MCP call. Returns the parsed JSON (success or error). */
async function mcp(mcpName: string, action: string, params: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mcp: mcpName, action, params }),
  });
  return res.json();
}

const TOOL_SPECS = `Available tools (call exactly one per turn):
- maps.search { "query": "barbers", "location": "Indiranagar" } — real Google Maps place discovery. Use BEFORE any booking to find real options with ratings. Omit "location" to search near the user's live location.
- maps.directions { "origin": "...", "destination": "..." } — real driving route + distance/time. Omit "origin" to start from the user's live location.
- web.search { "query": "..." } — live web search. Use to find opening hours, prices, booking pages, official sites.
- github { "action": "get_repo|list_issues|list_pulls|list_commits|list_contents|list_repos", "params": { ... } } — real GitHub data. params.repo must be "owner/name".
- whatsapp.send { "contact": "mom", "message": "..." } — send a real WhatsApp message to a named contact.
- browser.act { "task": "what to accomplish", "url": "https://start-url" } — drive a REAL visible browser for things a search cannot do: add to cart, fill a booking form, click through a site.
- finish { "summary": "..." } — end the task, stating exactly what was really accomplished and what still needs the user.`;

const SYSTEM = `You are JARVIS's Autonomous Task Agent. You actually OPERATE tools to accomplish a user's goal — you never pretend to have done something you did not.

${TOOL_SPECS}

Choosing the right site for browser.act (IMPORTANT):
- Food / groceries / delivery (pizza, biryani, restaurant food, groceries) → use https://www.swiggy.com (or https://www.zomato.com).
- Local services — barber, salon, spa, clinic, gym, restaurant table, repair → FIRST call maps.search to find real nearby providers, THEN open that provider's own website or Google Maps. NEVER open a food-delivery app for a non-food task.
- Appointments/booking (movie, train, flight, hotel) → the relevant booking site (BookMyShow, IRCTC, MakeMyTrip…).
- Use web.search to find the correct URL when unsure, before opening the browser.

Location:
- If the user says "my location", "near me", "here", "to my address" → use the LIVE LOCATION given in the turn. NEVER assume Bengaluru or any other city.
- When ordering/delivering, pass the live address through so the site can use it.

Rules:
- Prefer maps.search + web.search to gather facts before browser.act.
- Keep every reply small so it stays valid JSON: "thought" under 25 words; a finish "summary" under 60 words; list at most the top 3 items.
- Do not repeat a search you already ran with the same query — use the result you have.
- One action per turn. Respond with STRICT JSON only:
  { "thought": "short reasoning", "tool": "<tool name>", "args": { ... } }
  or to end: { "thought": "...", "tool": "finish", "summary": "..." }`;

interface Decision {
  thought?: string;
  tool?: string;
  args?: Record<string, any>;
  summary?: string;
}

function locationLine(loc?: UserLocation): string {
  if (!loc) return "Live location: not shared (ask the user or use a search).";
  const addr = loc.address ? ` (${loc.address})` : "";
  return `Live location: ${loc.lat},${loc.lng}${addr}`;
}

async function decide(goal: string, history: string, loc?: UserLocation): Promise<Decision | null> {
  // Keep the recent trail only — a long history makes small models drift into
  // prose (invalid JSON), which stalls the loop.
  const focused = history.length > 3500 ? history.slice(history.length - 3500) : history;
  const raw = await callJsonLlm<Record<string, any>>({
    system: SYSTEM,
    user: `${locationLine(loc)}\n\nGoal: ${goal}\n\nWhat has happened so far:\n${focused || "(nothing yet)"}\n\nYour next action as strict JSON:`,
    maxTokens: 900,
    temperature: 0.2,
    label: "TaskAgent",
    timeoutMs: 12000,
  });
  if (!raw) return null;
  // Small models occasionally rename keys. Accept the common aliases so a
  // good decision isn't thrown away over wording.
  const rawTool = raw.tool || raw.action || raw.name || raw.function || raw.tool_name;
  if (!rawTool || typeof rawTool !== "string") return null;
  // Normalise "maps_search" / "MAPS.SEARCH" → "maps.search".
  let tool = rawTool.trim().toLowerCase();
  if (!tool.includes(".")) tool = tool.replace(/_/g, ".");
  if (tool === "done" || tool === "end" || tool === "complete") tool = "finish";
  const args = raw.args || raw.arguments || raw.parameters || raw.params || {};
  const summary = raw.summary || raw.final || raw.answer || raw.message || raw.result;
  return { tool, args, thought: raw.thought || raw.reasoning, summary: typeof summary === "string" ? summary : undefined };
}

/** One transient provider hiccup must not derail an otherwise-working run. */
async function decideWithRetry(goal: string, history: string, loc?: UserLocation): Promise<Decision | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const d = await decide(goal, history, loc);
    if (d && d.tool) return d;
    if (attempt === 0) await new Promise((r) => setTimeout(r, 350));
  }
  return null;
}

function stringify(data: any, max = 1600): string {
  try {
    const s = typeof data === "string" ? data : JSON.stringify(data);
    return s.length > max ? s.slice(0, max) + "…" : s;
  } catch {
    return String(data);
  }
}

/** Execute one tool call for real. Never throws — returns ok=false with the reason. */
async function executeTool(
  tool: string,
  args: Record<string, any>,
  emit: Emit,
  ctx: Ctx
): Promise<{ ok: boolean; output: string }> {
  const loc = ctx.userLocation;

  switch (tool) {
    case "maps.search": {
      const query = args.query || args.q;
      if (!query) return { ok: false, output: "maps.search needs a 'query'." };
      const params: Record<string, unknown> = { query, location: args.location };
      // No explicit location → anchor to the user's live location.
      if (!args.location && loc) {
        params.lat = loc.lat;
        params.lng = loc.lng;
        params.location = loc.address;
      }
      const j = await mcp("googlemaps", "search_places", params);
      if (!j.success) return { ok: false, output: j.error || "Maps search failed." };
      const places = (j.data || []) as any[];
      if (places.length === 0) return { ok: false, output: `No places found for "${query}".` };
      const lines = places.slice(0, 8).map(
        (p, i) =>
          `${i + 1}. ${p.name} — ${p.address || ""}${p.rating ? ` (★${p.rating}${p.totalRatings ? `, ${p.totalRatings} reviews` : ""})` : ""}${p.website ? ` · ${p.website}` : ""}${p.phone ? ` · ${p.phone}` : ""}`
      );
      return { ok: true, output: `Found ${places.length} real places (${j.source}):\n${lines.join("\n")}` };
    }

    case "maps.directions": {
      const params: Record<string, unknown> = { origin: args.origin, destination: args.destination };
      if (!args.origin && loc) {
        params.lat = loc.lat;
        params.lng = loc.lng;
      }
      const j = await mcp("googlemaps", "get_directions", params);
      if (!j.success) return { ok: false, output: j.error || "Directions failed." };
      return { ok: true, output: `${j.data.distanceKm} km, ~${j.data.durationMin} min from ${j.data.origin} to ${j.data.destination}.` };
    }

    case "web.search": {
      const query = args.query || args.q;
      if (!query) return { ok: false, output: "web.search needs a 'query'." };
      const hits = await searchWebWithFallback(query, 5);
      if (!hits.length) return { ok: false, output: `No web results for "${query}".` };
      return {
        ok: true,
        output: hits.slice(0, 5).map((h) => `• ${h.title} — ${h.url}\n  ${h.description}`).join("\n"),
      };
    }

    case "github": {
      const j = await mcp("github", args.action, args.params || {});
      if (!j.success) return { ok: false, output: j.error || "GitHub call failed." };
      return { ok: true, output: stringify(j.data) };
    }

    case "whatsapp.send": {
      const j = await mcp("whatsapp", "send_message", { contact: args.contact, message: args.message });
      if (!j.success) return { ok: false, output: j.error || "WhatsApp send failed." };
      return { ok: true, output: `Message delivered to ${j.data.recipient} at ${j.data.deliveredAt}.` };
    }

    case "browser.act": {
      const baseTask = args.task || String(args.goal || "accomplish the user's goal");
      const task = loc ? `${baseTask}\n\n(User's current live location: ${loc.lat},${loc.lng}${loc.address ? ` — ${loc.address}` : ""}. Use it as the delivery/booking address where relevant.)` : baseTask;
      emit({ type: "status", message: "Opening a visible browser to carry this out…" });
      try {
        // Bound the run so a stuck page can never hold the task hostage.
        const result = await Promise.race([
          browserAct({ task, url: args.url, headed: true, maxSteps: 6 }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Browser step timed out after 150s")), 150000)),
        ]);
        const acts = (result.actions || []).slice(-6).map((a) => `• ${a.type}: ${a.detail}`).join("\n");
        return {
          ok: true,
          output: `Browser finished at ${result.finalUrl} ("${result.title}").\n${result.answer || result.summary}${acts ? "\nActions:\n" + acts : ""}`,
        };
      } catch (e: any) {
        return { ok: false, output: `Browser run failed: ${e?.message || e}` };
      }
    }

    default:
      return { ok: false, output: `Unknown tool "${tool}".` };
  }
}

/**
 * Run the autonomous loop. Emits real events as it goes so the UI can show
 * every action and observation live.
 */
export async function runAutonomousTask(
  goal: string,
  emit: Emit,
  opts?: { userLocation?: UserLocation }
): Promise<AgentRunResult> {
  const ctx: Ctx = { userLocation: opts?.userLocation };
  const steps: AgentRunResult["steps"] = [];
  const history: string[] = [];
  const MAX_ROUNDS = 8;

  emit({
    type: "status",
    message: ctx.userLocation
      ? `Using your live location${ctx.userLocation.address ? ` (${ctx.userLocation.address})` : ""}. Planning real actions…`
      : "Decomposing your goal into real, executable actions…",
  });

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const decision = await decideWithRetry(goal, history.join("\n\n"), ctx.userLocation);
    if (!decision || !decision.tool) {
      // Don't throw away the real work already done — report it honestly,
      // leading with the richest results (Maps/WhatsApp) over raw search hits.
      const okSteps = steps.filter((s) => s.ok);
      const ranked = [...okSteps].sort((a, b) => {
        const weight = (t: string) => (t === "maps.search" || t === "maps.directions" ? 3 : t === "whatsapp.send" || t === "github" ? 2 : 1);
        return weight(b.tool) - weight(a.tool);
      });
      const gathered = ranked.slice(0, 3).map((s) => `• ${s.output}`).join("\n").slice(0, 1200);
      const summary = gathered
        ? `The planner hiccuped before I could wrap up, but here is what I actually found:\n${gathered}`
        : "The language models are unavailable right now, so I couldn't plan a step. Try again in a moment.";
      emit({ type: "final", summary, ok: false });
      return { ok: false, summary, steps };
    }

    if (decision.tool === "finish") {
      const summary = decision.summary || "Task complete.";
      emit({ type: "final", summary, ok: true });
      return { ok: true, summary, steps };
    }

    if (decision.thought) emit({ type: "thought", text: decision.thought });

    const detail = stringify(decision.args || {}, 300);
    emit({ type: "action", step: round, tool: decision.tool, detail });

    let result: { ok: boolean; output: string };
    try {
      result = await executeTool(decision.tool, decision.args || {}, emit, ctx);
    } catch (e: any) {
      result = { ok: false, output: `Tool error: ${e?.message || e}` };
    }

    steps.push({ tool: decision.tool, detail, output: result.output, ok: result.ok });
    emit({ type: "observation", step: round, tool: decision.tool, output: result.output, ok: result.ok });
    // Bound each history entry so the prompt stays small and fast.
    const shortOutput = result.output.length > 650 ? result.output.slice(0, 650) + "…" : result.output;
    history.push(`Round ${round}: ${decision.tool}(${detail})\nResult: ${shortOutput}`);
  }

  const summary =
    "I ran out of steps before the goal was fully confirmed. Here's exactly what I did, Boss — see the action trail above.";
  emit({ type: "final", summary, ok: false });
  return { ok: false, summary, steps };
}
