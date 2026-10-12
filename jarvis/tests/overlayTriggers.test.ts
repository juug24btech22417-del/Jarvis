// Tests for proactive question detection.
//
// The cost of a false positive here is a wrong answer stealing the reading
// position in the middle of a call, and a model call nobody wanted. The cost of
// a false negative is the user having to ask. So the bar is: a question aimed at
// the user MUST be caught, and a rhetorical or third-person line must NOT be.
//
// Run with:  npx tsx tests/overlayTriggers.test.ts

import {
  DEFAULT_TRIGGERS,
  detect,
  anyEnabled,
  forAction,
  pickPrimary,
  type TriggerSettings,
} from "../src/lib/overlay/triggers";

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

function kinds(text: string, ctx = {}) {
  return detect(text, ctx).map((d) => d.kind);
}

// ─────────────────────────────────────────────────────────────────────────
section("A question aimed at the user is caught");

const direct = detect("so how would you handle authentication for the API?");
check("direct question is detected", direct.some((d) => d.kind === "question"), JSON.stringify(kinds("so how would you handle authentication for the API?")));
check("it scores high enough to auto-answer", (pickPrimary(direct)?.score ?? 0) >= 0.6, `${pickPrimary(direct)?.score}`);
check(
  "and the reason names the person",
  direct[0].reason.includes("you"),
  direct[0].reason
);

check("an imperative request counts too", kinds("explain how rate limiting works here").includes("question"));
check("a request with a question mark counts", kinds("can you look at the latency numbers?").includes("question"));

// ─────────────────────────────────────────────────────────────────────────
section("Rhetorical and third-person lines are left alone");

check("a short fragment is never a question", kinds("okay so then").length === 0, JSON.stringify(kinds("okay so then")));
check(
  "a line about somebody else is not a request",
  !kinds("she was saying the migration took three weeks").includes("question")
);
check("a long monologue is downgraded", (detect("what is the plan and then after that we should also think about the roadmap and the hiring plan and the budget for the next two quarters because the board will ask about it and we need the numbers ready before the meeting on Thursday next week?").find((d) => d.kind === "question")?.score ?? 1) < 0.6);

// ─────────────────────────────────────────────────────────────────────────
section("The other kinds are recognised and distinguishable");

const decision = detect("should we go with the managed queue or build our own?");
check("a decision is detected", decision.some((d) => d.kind === "decision"));

const claim = detect("studies show that 63% of users churn in the first 30 days");
check("a claim with a number is detected", claim.some((d) => d.kind === "claim"));

const term = detect("we moved the ingestion pipeline to kafka last quarter");
check("a domain term is detected", term.some((d) => d.kind === "term"), JSON.stringify(term.map((t) => t.text)));
check("the term suggestion is phrased as a question to answer", term.find((t) => t.kind === "term")?.text.startsWith("Explain ") === true);

const acronym = detect("the client wants SOC2 and HIPAA before the pilot");
check("a known acronym counts as a term", acronym.some((d) => d.kind === "term"));

const followup = detect("and what about the second option?", { topic: "vendor selection for the cdn" });
check("a follow-up is detected once there is a topic", followup.some((d) => d.kind === "followup"));
check(
  "a follow-up without a topic is not invented",
  !detect("and what about the second option?").some((d) => d.kind === "followup")
);

// ─────────────────────────────────────────────────────────────────────────
section("No repeats: an already-answered line is not answered again");

const asked = ["how would you handle authentication for the api"];
check("an identical line is ignored", detect("how would you handle authentication for the API?", { asked }).length === 0);
check("an unrelated line still gets through", detect("what is the deployment plan for friday?", { asked }).length > 0);

// ─────────────────────────────────────────────────────────────────────────
section("The user's settings decide what actually happens");

const settings: TriggerSettings = { ...DEFAULT_TRIGGERS, question: "prep", term: "off" };
const dets = detect("how would you scale the postgres replica?");
check("turning QUESTION to prep removes it from auto", forAction(dets, settings, "auto").length === 0);
check("and puts it in prep instead", forAction(dets, settings, "prep").some((d) => d.kind === "question"));
check("turning TERM off removes it entirely", !forAction(dets, { ...settings, term: "off" }, "auto").some((d) => d.kind === "term"));
check("turning TERM to auto offers it as a suggestion", forAction(dets, { ...settings, term: "auto" }, "auto").some((d) => d.kind === "term"));

const allOff: TriggerSettings = { question: "off", followup: "off", decision: "off", claim: "off", term: "off" };
check("everything off means the model is never called on its own", !anyEnabled(dets, allOff));
check("the defaults auto-answer questions only", DEFAULT_TRIGGERS.question === "auto" && DEFAULT_TRIGGERS.term === "prep");

check("an empty line produces nothing", detect("").length === 0);
check("whitespace produces nothing", detect("    ").length === 0);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
