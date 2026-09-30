// Integration tests for the Mission Control v5 server modules — no browser,
// no network, no Next runtime. Exercises real disk behaviour.
//
// Run with:  npx tsx tests/missionRuntime.test.ts

import fs from "fs";
import path from "path";
import {
  putJob,
  getJob,
  listJobs,
  listJobSummaries,
  flushMissions,
  removeJob,
} from "../src/lib/agent/store";
import { saveArtifact, resolveArtifactPath } from "../src/lib/agent/artifacts";
import { renderVideoBrief, buildSlides, extractMetrics } from "../src/services/MissionVideoService";
import { buildMissionContext, missionDigest, plainText } from "../src/services/MissionFollowupService";
import { listRecordings } from "../src/services/BrowserAgentService";
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

const MISSIONS_FILE = path.join(process.cwd(), ".jarvis-data", "missions.json");

function makeJob(overrides: Partial<AgentJob> = {}): AgentJob {
  return {
    id: `test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    goal: "Research the latest GPU and compare it",
    status: "done",
    createdAt: Date.now(),
    finishedAt: Date.now(),
    results: [
      {
        stepId: "s1",
        status: "ok",
        result: { summary: "### Findings\n\n- The RTX is faster\n- It costs more" },
        finishedAt: Date.now(),
      },
      { stepId: "s2", status: "error", error: "boom", finishedAt: Date.now() },
    ],
    plan: {
      summary: "Research GPU",
      steps: [
        { id: "s1", kind: "deep_research", title: "Research", params: {} },
        { id: "s2", kind: "web_scrape", title: "Scrape", params: {} },
      ],
    },
    ...overrides,
  };
}

/* ----------------------------- durable store ----------------------------- */

section("mission store — durability");

const job = makeJob({ partial: true });
removeJob(job.id); // ensure clean slate
putJob(job);
flushMissions();

check("job readable in memory", getJob(job.id)?.id === job.id);
check("missions file written to disk", fs.existsSync(MISSIONS_FILE));
check(
  "job serialized to disk",
  fs.readFileSync(MISSIONS_FILE, "utf8").includes(job.id),
);
check("summary listing is lightweight", (() => {
  const s = listJobSummaries().find((x) => x.id === job.id);
  return !!s && !("results" in (s as unknown as Record<string, unknown>)) && s.goal === job.goal;
})());

// Simulate a server restart: drop the in-memory cache and reload from disk.
(globalThis as unknown as { __jarvisMissionLoaded?: boolean }).__jarvisMissionLoaded = false;
delete (globalThis as unknown as { __jarvisMissionJobs?: unknown }).__jarvisMissionJobs;

check("job survives simulated restart", listJobs().some((j) => j.id === job.id));

// A mission that was mid-flight when the server died must not look live.
const interrupted = makeJob({ status: "running", startedAt: Date.now(), finishedAt: undefined });
putJob(interrupted);
flushMissions();
(globalThis as unknown as { __jarvisMissionLoaded?: boolean }).__jarvisMissionLoaded = false;
delete (globalThis as unknown as { __jarvisMissionJobs?: unknown }).__jarvisMissionJobs;
const recovered = listJobs().find((j) => j.id === interrupted.id);
check("interrupted mission marked failed on reload", recovered?.status === "failed", recovered?.status);
check("interrupted mission explains why", /restart/i.test(recovered?.error ?? ""), recovered?.error);

/* ----------------------------- artifacts ----------------------------- */

section("artifacts — storage + traversal guard");

const dir = path.dirname(MISSIONS_FILE);
const artFile = saveArtifact(job.id, "evidence.jpg", Buffer.from("fake-jpeg"));
check("artifact file created", fs.existsSync(artFile));
check("artifact resolves inside root", resolveArtifactPath(artFile) === path.resolve(artFile));
check("traversal outside root rejected", resolveArtifactPath(path.join(dir, "..", "..", "etc", "passwd")) === null);
check("missing file rejected", resolveArtifactPath(path.join(dir, "nope.txt")) === null);

/* ----------------------------- video brief ----------------------------- */

section("video brief");

const deckJob = makeJob();
const brief = renderVideoBrief(deckJob, "GPU Showdown");
check("brief file rendered", fs.existsSync(brief.path) && brief.path.endsWith(".html"));
check("brief has scenes", brief.slides.length >= 3, String(brief.slides.length));
check("brief starts with a title scene", brief.slides[0].kind === "title");
check("brief ends with an outro", brief.slides[brief.slides.length - 1].kind === "outro");
const html = fs.readFileSync(brief.path, "utf8");
check("html is self-contained (no external scripts)", !/<script[^>]+src=/i.test(html));
check("html has no narration/TTS", !html.includes("speechSynthesis") && !html.includes("SpeechSynthesisUtterance"));
check("html includes the topic", html.includes("GPU Showdown"));
check("buildSlides reflects the title", buildSlides(deckJob, "X")[0].heading === "X");
// It must read as a video, not a deck: camera moves, cuts, ticker, audio bed.
check("html has camera moves", html.includes("camIn") && html.includes("camPanL"));
check("html has cut transitions", html.includes("whipIn") && html.includes("glitchIn"));
check("html has a music bed", /<audio id="bed"/.test(html));
check("html references brag music assets", html.includes("/api/agent/brag-asset?file=music%2F"));
check("html references brag sfx assets", /sfx%2F(interface|ui)%2F/.test(html));
check("html has a running ticker", html.includes("marquee") && html.includes("ticker"));
check("html has a timecode + progress bar", html.includes("fmt(") && html.includes("progress"));
check("scenes carry a camera + cut type", brief.scenes.every((s) => !!s.cam && !!s.cut));
check("storyboard starts with a hook shot", brief.scenes[0].kind === "hook", brief.scenes[0].kind);

/* ----------------------------- follow-up context ----------------------------- */

section("follow-up context");

const ctx = buildMissionContext(deckJob);
check("context includes successful step summary", ctx.includes("The RTX is faster"));
check("context labels the step", ctx.includes("Research"));
check("context excludes failed steps", !ctx.includes("boom"));
check("context respects the budget", buildMissionContext(deckJob, 50).length <= 80);

/* ----------------------------- follow-up actions ----------------------------- */

section("follow-up digest + actions");

const digest = missionDigest(deckJob);
check("digest names the goal", digest.includes("Research the latest GPU"));
check("digest carries the findings", digest.includes("The RTX is faster"));
check("digest is plain text (no markdown headings)", !/^#/m.test(digest));
check("digest respects the budget", missionDigest(deckJob, 900).length <= 1400);
check("plainText strips markdown bullets", plainText("- **a** b").includes("• a b"));

section("metrics extraction (video data bars)");
check(
  "numbers become bars",
  extractMetrics(["The RTX 5090 costs Rs 2,00,000", "The previous gen costs Rs 80,000"]).length === 2
);
check(
  "a single number is not worth a bar shot",
  extractMetrics(["Only one number here: 42"]).length === 0
);
check(
  "bar weights normalise to the largest value",
  (() => {
    const m = extractMetrics(["score 90 points", "score 30 points"]);
    return m.length === 2 && m[0].weight === 1 && m[1].weight < 1;
  })()
);

/* ----------------------------- recordings ----------------------------- */

section("browser recordings store");

try {
  const recs = listRecordings();
  check("recordings listing is an array", Array.isArray(recs));
} catch (e) {
  check("recordings listing is an array", false, (e as Error).message);
}

/* ----------------------------- cleanup ----------------------------- */

removeJob(job.id);
removeJob(interrupted.id);
flushMissions();
try {
  fs.rmSync(path.join(process.cwd(), ".jarvis-data", "artifacts", job.id.replace(/[^\w-]/g, "_")), { recursive: true, force: true });
  const briefDir = path.dirname(brief.path);
  fs.rmSync(briefDir, { recursive: true, force: true });
} catch {
  // cleanup best-effort
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
