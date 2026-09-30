// Tests for the browser-agency fixes:
//   • sign-in detection (no false positives, window stays open)
//   • live browser frame registry (panel live view)
//   • follow-up intent routing (so "send it to my telegram" actually sends)
//
// Pure — no browser, no network, no Next runtime.
//
// Run with:  npx tsx tests/missionAgents.test.ts

import {
  evaluateLoginSignal,
  findStrongAuthCookie,
  isAuthUrl,
  loginMessage,
  LOGIN_MIN_DWELL_MS,
} from "../src/lib/agent/loginSignals";
import {
  clearLiveView,
  getLiveFrame,
  getLiveFrameBuffer,
  getLiveMeta,
  isLiveViewEnabled,
  publishLiveFrame,
  pruneLiveViews,
  setLiveViewEnabled,
} from "../src/lib/agent/liveView";
import { detectFollowupAction, artifactFilename } from "../src/lib/agent/followupIntent";

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

/* ----------------------------- sign-in detection ----------------------------- */

section("login signals — the LinkedIn false-positive");

const LINKEDIN_LOGIN = "https://www.linkedin.com/login";
// Anonymous visitors already carry these — the old regex matched them.
const anonCookies = [
  { name: "lang", value: "v=2&lang=en-US" },
  { name: "JSESSIONID", value: "ajax:1234" },
  { name: "bcookie", value: "v=2&abc" },
  { name: "li_gc", value: "MTs" },
];

check(
  "anonymous cookies are NOT a sign-in",
  evaluateLoginSignal({
    startedAt: Date.now() - 30_000,
    now: Date.now(),
    baselineUrl: LINKEDIN_LOGIN,
    currentUrl: LINKEDIN_LOGIN,
    urlStable: true,
    baselineCookies: anonCookies,
    currentCookies: anonCookies,
  }).signedIn === false
);

check(
  "a NEW session cookie is a sign-in",
  evaluateLoginSignal({
    startedAt: Date.now() - 30_000,
    now: Date.now(),
    baselineUrl: LINKEDIN_LOGIN,
    currentUrl: LINKEDIN_LOGIN,
    urlStable: true,
    baselineCookies: anonCookies,
    currentCookies: [...anonCookies, { name: "li_at", value: "AQEDATrealSession" }],
  }).reason === "cookie"
);

check(
  "a changed value on an existing token counts",
  findStrongAuthCookie(
    [{ name: "auth_token", value: "new" }],
    [{ name: "auth_token", value: "old" }]
  )?.name === "auth_token"
);

check(
  "an unchanged token does NOT count",
  findStrongAuthCookie(
    [{ name: "auth_token", value: "old" }],
    [{ name: "auth_token", value: "old" }]
  ) === null
);

check(
  "nothing counts inside the settle window",
  evaluateLoginSignal({
    startedAt: Date.now(),
    now: Date.now() + LOGIN_MIN_DWELL_MS - 500,
    baselineUrl: LINKEDIN_LOGIN,
    currentUrl: "https://www.linkedin.com/feed/",
    urlStable: true,
    baselineCookies: anonCookies,
    currentCookies: [...anonCookies, { name: "li_at", value: "x" }],
  }).signedIn === false
);

check(
  "leaving the login page (twice in a row) counts",
  evaluateLoginSignal({
    startedAt: Date.now() - 20_000,
    now: Date.now(),
    baselineUrl: LINKEDIN_LOGIN,
    currentUrl: "https://www.linkedin.com/feed/",
    urlStable: true,
    baselineCookies: anonCookies,
    currentCookies: anonCookies,
  }).reason === "url"
);

check(
  "a one-poll URL wobble does not count",
  evaluateLoginSignal({
    startedAt: Date.now() - 20_000,
    now: Date.now(),
    baselineUrl: LINKEDIN_LOGIN,
    currentUrl: "https://www.linkedin.com/feed/",
    urlStable: false,
    baselineCookies: anonCookies,
    currentCookies: anonCookies,
  }).signedIn === false
);

check(
  "never started on an auth page → URL change is not proof",
  evaluateLoginSignal({
    startedAt: Date.now() - 20_000,
    now: Date.now(),
    baselineUrl: "https://www.linkedin.com/",
    currentUrl: "https://www.linkedin.com/feed/",
    urlStable: true,
    baselineCookies: anonCookies,
    currentCookies: anonCookies,
  }).signedIn === false
);

check("auth url detection", isAuthUrl("https://x.com/i/flow/signin") && isAuthUrl("https://a.com/uas/login") && isAuthUrl("https://a.com/checkpoint/challenge"));
check("non-auth url detection", !isAuthUrl("https://www.linkedin.com/feed/") && !isAuthUrl("https://amazon.in/orders"));

section("login messages never claim a false success");
check(
  "failure message says nothing was saved",
  /Nothing was saved|nothing was saved/i.test(loginMessage({ site: "LinkedIn", success: false, reason: "none" }))
);
check(
  "closed-window message explains the window was closed",
  /closed/i.test(loginMessage({ site: "LinkedIn", success: false, closedByUser: true }))
);
check(
  "success message confirms the saved session",
  /saved/i.test(loginMessage({ site: "LinkedIn", success: true, reason: "cookie" }))
);

/* ----------------------------- live browser view ----------------------------- */

section("live browser view registry");

const JOB = "live_test_job";
const tinyJpeg = `data:image/jpeg;base64,${Buffer.from("fake-jpeg-bytes").toString("base64")}`;

setLiveViewEnabled(JOB, true);
check("streaming enabled for the job", isLiveViewEnabled(JOB));

publishLiveFrame({
  jobId: JOB,
  stepId: "s1",
  action: "click [4]",
  url: "https://example.com/cart",
  title: "Cart",
  frame: tinyJpeg,
});

check("frame is stored", getLiveFrame(JOB)?.action === "click [4]");
check("frame decodes to bytes", (getLiveFrameBuffer(JOB)?.length ?? 0) > 0);
check("meta carries the page url", getLiveMeta(JOB)?.url === "https://example.com/cart");
check("meta never leaks the image payload", !("frame" in (getLiveMeta(JOB) as object)));
check("meta marks a frame present", getLiveMeta(JOB)?.hasFrame === true);

publishLiveFrame({ jobId: JOB, stepId: "s1", action: "fill [7]", url: "https://example.com/pay", title: "Pay", frame: tinyJpeg });
check("latest frame wins (no unbounded buffer)", getLiveFrame(JOB)?.action === "fill [7]");

setLiveViewEnabled(JOB, false);
check("streaming can be switched off", !isLiveViewEnabled(JOB));

clearLiveView(JOB);
check("cleared job has no frame", getLiveFrame(JOB) === null && getLiveMeta(JOB) === null);

// A stale frame from a long-finished mission must be reaped.
publishLiveFrame({ jobId: "stale_job", stepId: "s", action: "x", url: "u", title: "t", frame: tinyJpeg });
const live = getLiveFrame("stale_job")!;
live.at = Date.now() - 20 * 60_000;
pruneLiveViews(10 * 60_000);
check("stale frames are pruned", getLiveFrame("stale_job") === null);

/* ----------------------------- follow-up intents ----------------------------- */

section("follow-up intent detection");

check("send it to my telegram", detectFollowupAction("send it to my telegram").kind === "telegram");
check("send me on telegram", detectFollowupAction("send me on telegram").kind === "telegram");
check("telegram me that report", detectFollowupAction("telegram me that report").kind === "telegram");
check("dm me this", detectFollowupAction("dm me this").kind === "telegram");
check("message me the results", detectFollowupAction("message me the results").kind === "telegram");
check("send me the top 3", detectFollowupAction("send me the top 3 picks").kind === "telegram");
check("make me a video brief", detectFollowupAction("make me a video brief").kind === "video");
check("turn this into a reel", detectFollowupAction("turn this into a reel").kind === "video");
check("save it to a file", detectFollowupAction("save it to a file").kind === "file");
check("export this as markdown", detectFollowupAction("export this as markdown file").kind === "file");
check("add this to my notes", detectFollowupAction("add this to my notes").kind === "note");
check("a question is not an action", detectFollowupAction("which option was cheapest?").kind === "none");
check("a comparison is not an action", detectFollowupAction("compare the top two results").kind === "none");
check("empty is not an action", detectFollowupAction("").kind === "none");
check(
  "sending wins over the artefact being sent",
  detectFollowupAction("make a video and send it to my telegram").kind === "telegram"
);

check(
  "artifact filenames are filesystem-safe",
  /^[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.txt$/.test(artifactFilename("Research the latest NVIDIA GPU!", "txt")),
  artifactFilename("Research the latest NVIDIA GPU!", "txt")
);

/* ----------------------------- summary ----------------------------- */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
