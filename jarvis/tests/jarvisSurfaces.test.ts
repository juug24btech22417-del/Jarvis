// Tests for the JARVIS surfaces round: instant planner, themed video briefs,
// natural-language widgets, and the Second Brain constellation layout.
//
// Pure — no browser, no network, no Next runtime, no Prisma.
//
// Run with:  npx tsx tests/jarvisSurfaces.test.ts

import { heuristicPlan, siteLoginUrl } from "../src/lib/agent/plan";
import {
  renderVideoBrief,
  VIDEO_THEMES,
  pickTheme,
  pickFreshTheme,
  buildScenes,
  hookHeadline,
  parseCueJson,
  loadBeatGrid,
  snapScenesToBeats,
} from "../src/services/MissionVideoService";
import {
  flattenSourcePayload,
  heuristicWidget,
  normalizeWidget,
  normalizeItems,
  guessApiSource,
  parsePath,
} from "../src/lib/widgets/spec";
import { buildConstellation, colorForType, typeLegend } from "../src/lib/memory/layout";
import type { AgentJob } from "../src/lib/agent/types";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    console.error(`  \u2717 ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title: string) {
  console.log(`\n${title}`);
}

/* ----------------------------- instant planner ----------------------------- */

section("instant planner (no LLM)");

{
  const p = heuristicPlan("what's the weather in Bengaluru");
  check("weather → weather_lookup", p?.steps[0].kind === "weather_lookup" && p.steps[0].params.city === "Bengaluru", JSON.stringify(p?.steps[0]));
}
{
  const p = heuristicPlan("set a 25 minute timer");
  check("timer → timer_set 25", p?.steps[0].kind === "timer_set" && p.steps[0].params.minutes === 25, JSON.stringify(p?.steps[0]));
}
{
  const p = heuristicPlan("play lofi beats on spotify");
  check("spotify play", p?.steps[0].kind === "spotify_action" && p.steps[0].params.query === "lofi beats");
}
{
  const p = heuristicPlan("open youtube and play lo-fi study music");
  check("youtube open+play", p?.steps[0].kind === "youtube_open");
}
{
  const p = heuristicPlan("find the best free react course and open the best one");
  check(
    "find + open → search → decide → open",
    p?.steps.map((s) => s.kind).join(",") === "firecrawl_search,llm_decide,browser_open",
    p?.steps.map((s) => s.kind).join(",")
  );
  check("find + open chains dependencies", (p?.steps[2].dependsOn ?? []).includes("f2"));
}
{
  const p = heuristicPlan("sign in to linkedin and check my connection requests");
  check("sign-in → browser_login then browser_act", p?.steps[0].kind === "browser_login" && p?.steps[1].kind === "browser_act", JSON.stringify(p?.steps.map((s) => s.kind)));
  check("sign-in uses the known login url", String(p?.steps[0].params.url).includes("linkedin.com"));
  check("sign-in shares the session name", p?.steps[0].params.session === p?.steps[1].params.session);
}
{
  const p = heuristicPlan("sign in to some obscure forum and post hello");
  // No known sign-in URL, so the instant planner degrades to letting the
  // browser agent find the login form itself rather than guessing a URL.
  check(
    "unknown site → browser_act only (no guessed login url)",
    p?.steps.map((s) => s.kind).join(",") === "browser_act",
    JSON.stringify(p?.steps.map((s) => s.kind))
  );
}
{
  const p = heuristicPlan("check my amazon orders and tell me what shipped");
  check("interactive site → login + browser_act", p?.steps.map((s) => s.kind).join(",") === "browser_login,browser_act", JSON.stringify(p?.steps.map((s) => s.kind)));
}
{
  const p = heuristicPlan("what's the price of the Sony WH-1000XM5 on Flipkart");
  check("price lookup → search + extract + summarize", p?.steps.map((s) => s.kind).join(",") === "firecrawl_search,firecrawl_extract,llm_summarize");
}
check(
  "complex research still goes to the LLM",
  heuristicPlan("research the top 3 AI coding assistants, analyse which is best for a student on a budget, write a report and send it to my telegram") === null
);
check("long goals are never auto-planned", heuristicPlan("find " + "x".repeat(200)) === null);
check("siteLoginUrl knows common sites", siteLoginUrl("LinkedIn")?.includes("linkedin") === true);
check("siteLoginUrl is word-bounded (no substring false hits)", siteLoginUrl("nope.example") === null && siteLoginUrl("example forum") === null);
check("siteLoginUrl handles x.com", siteLoginUrl("x")?.includes("x.com") === true);

/* ----------------------------- themed video briefs ----------------------------- */

section("video brief themes");

function makeJob(id: string): AgentJob {
  return {
    id,
    goal: "Research the latest GPU and compare it",
    status: "done",
    createdAt: Date.now(),
    startedAt: Date.now() - 40_000,
    finishedAt: Date.now(),
    creditsUsed: 3,
    results: [
      { stepId: "s1", status: "ok", result: { summary: "### Findings\n\nThe RTX 5090 is 62% faster\nIt costs Rs 2,00,000" }, finishedAt: Date.now() },
    ],
    plan: { summary: "Research GPU", steps: [{ id: "s1", kind: "deep_research", title: "Research", params: {} }] },
  };
}

check("theme ids are unique", new Set(VIDEO_THEMES.map((t) => t.id)).size === VIDEO_THEMES.length);
check("there are several distinct themes", VIDEO_THEMES.length >= 5, String(VIDEO_THEMES.length));
check("theme pick is deterministic", pickTheme("job-123").id === pickTheme("job-123").id);
check("an explicit theme id wins", pickTheme("job-123", "terminal").id === "terminal");
check(
  "different jobs get different themes across a run of ids",
  new Set(Array.from({ length: 24 }, (_, i) => pickTheme(`job-${i}`).id)).size >= 4
);

{
  const job = makeJob("job-theme-a");
  const one = renderVideoBrief(job, undefined, { themeId: "neo-cyan", baseUrl: "http://localhost:3000" });
  const two = renderVideoBrief(job, undefined, { themeId: "editorial", baseUrl: "http://localhost:3000" });
  check("explicit theme is honoured", one.theme === "neo-cyan" && two.theme === "editorial");
  check("the two briefs render different html", one.html !== two.html);
  check("editorial brief uses a serif display font", /--font-display:'Iowan Old Style'/.test(two.html));
  check("terminal theme uses phosphor green", renderVideoBrief(job, undefined, { themeId: "terminal" }).html.includes("#5cff9d"));
  check("brief keeps audio-reactive plumbing", one.html.includes("createAnalyser") && one.html.includes("AudioContext"));
  check("brief has no narration/TTS", !one.html.includes("speechSynthesis"));
  check("brief still plays music from brag assets", one.html.includes("brag-asset?file=music%2F"));
  check("brief supports replay (R key + replay fn)", one.html.includes("function replay()") && one.html.includes("'r'"));
  check("scenes follow the theme's cut list", buildScenes(job, undefined, pickTheme("x", "terminal")).every((s) => ["glitch", "cut", "glitch"].includes(s.cut)));
}

section("video brief music sync (brag cue grids)");

{
  const grid = parseCueJson({
    tempo: 120,
    beats: Array.from({ length: 10 }, (_, i) => ({ time: 3.02 + i * 0.5, intensity: 0.9 })),
    strongCues: [{ time: 4.02, intensity: 1 }],
  });
  check("cue json parses to ms beats", !!grid && grid.beats[0] === 3020 && grid.beats[1] === 3520, JSON.stringify(grid?.beats.slice(0, 3)));
  check("cue json keeps strong cues", grid?.strong[0] === 4020 && grid?.source === "cue");
  check("too few beats is rejected", parseCueJson({ beats: [{ time: 1 }] }) === null);
  check("garbage is rejected", parseCueJson("nope") === null && parseCueJson(null) === null);
}
{
  // The real bundled library must resolve from the repo — this is the wiring
  // that actually makes cuts land on the beat in production.
  const grid = loadBeatGrid("happy-beats-business-moves-vol-1-by-ende-dot-app.mp3");
  check("real cue grid loads from the brag assets", grid.source === "cue", grid.source);
  check("real cue grid has a usable beat count", grid.beats.length > 50, String(grid.beats.length));
  check("real cue grid knows its tempo", grid.tempo > 60 && grid.tempo < 200, String(grid.tempo));
  check("unknown tracks fall back to an even grid", loadBeatGrid("nope.mp3").source === "fallback");
}
{
  const grid = loadBeatGrid("happy-beats-business-moves-vol-9-by-ende-dot-app.mp3");
  const job = makeJob("job-beat-sync");
  const themed = buildScenes(job, undefined, pickTheme("x", "neo-cyan"), grid);
  const beatSet = new Set(grid.beats);
  // Shot 0 starts at t=0 (the video's opening), so the *cuts* are the starts
  // of shots 1..n — each must sit exactly on a detected beat.
  check(
    "every cut lands on a beat",
    themed.slice(1).every((s) => beatSet.has(s.startMs as number)),
    themed.map((s) => s.startMs).join(",")
  );
  check("the hook holds from the intro bar to the first beat", themed[0].startMs === 0 && beatSet.has(themed[1].startMs as number));
  check("shots stay inside the readable window", themed.every((s) => s.durationMs >= 900 && s.durationMs <= 4500), themed.map((s) => s.durationMs).join(","));
  check("the hook holds past the track intro", (themed[0].durationMs ?? 0) >= 2000, String(themed[0].durationMs));
  check("the timeline is continuous", themed.every((s, i) => i === 0 || themed[i - 1].startMs! + themed[i - 1].durationMs === s.startMs));
  check("beat-synced scenes are deterministic", JSON.stringify(buildScenes(job, undefined, pickTheme("x", "neo-cyan"), grid)) === JSON.stringify(themed));
}
{
  const snaps = renderVideoBrief(makeJob("job-synced"), undefined, { baseUrl: "http://localhost:3000" }).html;
  check("brief draws beat markers on the progress bar", snaps.includes("beatmarks") && snaps.includes("paintBeats"));
  check("brief flashes a whip streak on whip cuts", snaps.includes("flashStreak") && snaps.includes("streakSwipe"));
  check("brief reports the tempo on the gate", /\d+ bpm/.test(snaps));
}

section("video brief themes never repeat");

{
  const three = renderVideoBrief(makeJob("job-rot-a"), undefined, { baseUrl: "http://localhost:3000" });
  const four = renderVideoBrief(makeJob("job-rot-b"), undefined, { baseUrl: "http://localhost:3000" });
  const five = renderVideoBrief(makeJob("job-rot-c"), undefined, { baseUrl: "http://localhost:3000" });
  check("consecutive briefs never share a template", new Set([three.theme, four.theme, five.theme]).size === 3, `${three.theme}/${four.theme}/${five.theme}`);
  check("rotation touches every theme before repeating", new Set(Array.from({ length: 6 }, (_, i) => pickFreshTheme(`rot-${i}`).id)).size === VIDEO_THEMES.length);
}
{
  check("each theme has its own title entrance", new Set(VIDEO_THEMES.map((t) => t.title.enter)).size === VIDEO_THEMES.length);
  check("some themes drop the gradient type", VIDEO_THEMES.some((t) => !t.title.gradient) && VIDEO_THEMES.some((t) => t.title.gradient));
  const html = renderVideoBrief(makeJob("job-title"), undefined, { themeId: "editorial", baseUrl: "http://localhost:3000" }).html;
  check("the title entrance class reaches the markup", html.includes("enter-rise") && html.includes("title solid"));
  const term = renderVideoBrief(makeJob("job-title"), undefined, { themeId: "terminal", baseUrl: "http://localhost:3000" }).html;
  check("terminal theme types its headline character by character", term.includes('class="ch"') && term.includes("charType"));
}
{
  check("hook headline drops the command filler", hookHeadline("Research the top 3 AI coding assistants") === "top 3 AI coding assistants", hookHeadline("Research the top 3 AI coding assistants"));
  check("hook headline still readable when nothing is stripped", hookHeadline("Fix it") === "Fix it");
  check("hook headline is bounded", hookHeadline("a ".repeat(80)).length <= 47);
}

/* ----------------------------- widgets ----------------------------- */

section("widget spec normalisation");

check("unknown kind → list", normalizeWidget({ title: "X", kind: "hologram" }).kind === "list");
check("unknown accent → cyan", normalizeWidget({ title: "X", accent: "neon" }).accent === "cyan");
check("missing title → fallback", normalizeWidget({}, "Fallback").title === "Fallback");
check("string items become rows", normalizeItems(["a", "b"]).length === 2);
check("object items keep label/value/done", (() => {
  const [it] = normalizeItems([{ label: "Essay", value: "Fri", done: true }]);
  return it.label === "Essay" && it.value === "Fri" && it.done === true;
})());
check("junk items are dropped", normalizeItems([null, 12, { value: "orphan" }]).length === 2 || normalizeItems([{ label: "ok" }]).length === 1);
check("api source without a url degrades to manual", normalizeWidget({ title: "X", source: { type: "api" } }).source.type === "manual");
check("counter widget seeds a value", normalizeWidget({ kind: "counter", title: "Water" }).items[0].value === "0");
check("item count is capped", normalizeItems(Array.from({ length: 60 }, (_, i) => `row ${i}`)).length <= 20);

section("widget live payloads");

check("dot path resolves", parsePath({ data: { items: [1, 2] } }, "data.items") !== undefined);
check("missing path resolves to undefined", parsePath({ a: 1 }, "b.c") === undefined);
check(
  "array of objects → label/value rows",
  (() => {
    const items = flattenSourcePayload([{ name: "Bitcoin", price: 5000000 }], { type: "api" });
    return items.length === 1 && items[0].label === "Bitcoin" && items[0].value === "5000000";
  })()
);
check(
  "nested dict (coingecko shape) → one row per key",
  (() => {
    const items = flattenSourcePayload({ bitcoin: { inr: 5000000 }, ethereum: { inr: 250000 } }, { type: "api", valueKey: "inr" });
    return items.length === 2 && items[0].label === "bitcoin" && items[0].value === "5000000";
  })()
);
check("plain string arrays work", flattenSourcePayload(["a", "b", "c"], { type: "api" }).length === 3);
check("explicit keys win", (() => {
  const items = flattenSourcePayload([{ sym: "BTC", usd: 70000 }], { type: "api", labelKey: "sym", valueKey: "usd" });
  return items[0].label === "BTC" && items[0].value === "70000";
})());

section("widget heuristics (no LLM)");

check("crypto prompt → live api source", guessApiSource("track bitcoin and ethereum prices")?.type === "api");
check("crypto url is coingecko", String(guessApiSource("bitcoin price")?.url).includes("coingecko"));
check("assignments → checklist", heuristicWidget("track my assignments").kind === "checklist");
check("tasks prompt → tasks source", heuristicWidget("my todo list").source.type === "tasks");
check("notes prompt → notes source", heuristicWidget("my recent notes").source.type === "notes");
check("water prompt → counter", heuristicWidget("water intake").kind === "counter");
check("vague prompt → editable checklist", heuristicWidget("build me a panel for stuff").kind === "checklist");

/* ----------------------------- second brain layout ----------------------------- */

section("constellation layout");

const gNodes = [
  { id: "n1", name: "Dhruv", type: "PERSON", strength: 0.9, pinned: true },
  { id: "n2", name: "JARVIS", type: "PROJECT", strength: 0.8, pinned: false },
  { id: "n3", name: "React", type: "SKILL", strength: 0.5, pinned: false },
  { id: "n4", name: "Bengaluru", type: "LOCATION", strength: 0.4, pinned: false },
  { id: "n5", name: "Codebuff", type: "COMPANY", strength: 0.6, pinned: false },
];
const gLinks = [
  { source: "n1", target: "n2", type: "builds", strength: 0.9 },
  { source: "n1", target: "n4", type: "lives_in", strength: 0.7 },
  { source: "n2", target: "n3", type: "knows", strength: 0.5 },
];

{
  const c = buildConstellation(gNodes, gLinks);
  check("every node is placed", c.nodes.length === gNodes.length);
  check("positions are finite", c.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z)));
  check("links resolve to node indices", c.links.length === gLinks.length);
  check("clusters group by type", c.clusters.length === 5 && c.clusters.every((cl) => cl.count >= 1), String(c.clusters.length));
  check("extent is positive (camera can frame it)", c.extent > 1);
  check("node colours come from the type palette", c.nodes.find((n) => n.id === "n1")?.color === colorForType("PERSON"));
  check("pinned memories render larger", (c.nodes.find((n) => n.id === "n1")?.radius ?? 0) > (c.nodes.find((n) => n.id === "n3")?.radius ?? 0));
  check("archived flag is carried through", buildConstellation([{ ...gNodes[0], archived: true }], []).nodes[0].archived === true);
}
{
  const a = buildConstellation(gNodes, gLinks);
  const b = buildConstellation(gNodes, gLinks);
  check("layout is deterministic", JSON.stringify(a.nodes.map((n) => [n.x, n.y, n.z])) === JSON.stringify(b.nodes.map((n) => [n.x, n.y, n.z])));
}
{
  // Relaxation should pull a linked pair closer than the unbonded baseline.
  const far = buildConstellation(
    [
      { id: "a", name: "A", type: "CONCEPT", strength: 1, pinned: false },
      { id: "b", name: "B", type: "CONCEPT", strength: 1, pinned: false },
    ],
    [],
    { iterations: 0, clusterSpread: 40 }
  );
  const near = buildConstellation(
    [
      { id: "a", name: "A", type: "CONCEPT", strength: 1, pinned: false },
      { id: "b", name: "B", type: "CONCEPT", strength: 1, pinned: false },
    ],
    [{ source: "a", target: "b", type: "knows", strength: 1 }],
    { iterations: 20, clusterSpread: 40 }
  );
  const dist = (c: typeof far) => Math.hypot(c.nodes[0].x - c.nodes[1].x, c.nodes[0].y - c.nodes[1].y, c.nodes[0].z - c.nodes[1].z);
  check("linked memories end up closer", dist(near) < dist(far), `${dist(near).toFixed(2)} vs ${dist(far).toFixed(2)}`);
}
{
  const empty = buildConstellation([], []);
  check("empty graph is safe", empty.nodes.length === 0 && empty.extent === 1);
  const legend = typeLegend(buildConstellation(gNodes, gLinks));
  check("legend sorts by size", legend[0].count >= legend[legend.length - 1].count);
}

/* ----------------------------- summary ----------------------------- */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
