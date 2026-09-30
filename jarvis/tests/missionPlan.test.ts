// Tests for the Mission Control planner core (validation/repair, cost+risk
// estimate, browser-intent detection, recall).
//
// All pure — no LLM, no network, no Next runtime. These lock in the exact
// repair behaviour the executor relies on.
//
// Run with:  npx tsx tests/missionPlan.test.ts

import {
  KNOWN_KINDS,
  autoInferDependencies,
  estimatePlan,
  kindsAllowedForRole,
  maybeAppendBrowserStep,
  needsBrowserInteraction,
  pickSimilarPastGoals,
  planNeedsApproval,
  stepCreditWeight,
  validateAndRepairPlan,
} from "../src/lib/agent/plan";
import type { AgentPlan } from "../src/lib/agent/types";

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

/* ----------------------------- validation + repair ----------------------------- */

section("validateAndRepairPlan — repair");

{
  const plan: AgentPlan = {
    summary: "test",
    steps: [
      { id: "a", kind: "firecrawl_search", title: "Search", params: { query: "x" } },
      { id: "b", kind: "web_scrape", title: "from:1", params: { url: "from:1" } },
    ],
  };
  validateAndRepairPlan(plan);
  check("numeric ref from:1 rewritten to real step id", plan.steps[1].params.url === "from:a", String(plan.steps[1].params.url));
  check("ref-derived title regenerated", !/\bfrom:/.test(plan.steps[1].title), plan.steps[1].title);
  check("dependency inferred from ref", (plan.steps[1].dependsOn ?? []).includes("a"));
}

{
  const plan: AgentPlan = { summary: "t", steps: [{ id: "a", kind: "notify", title: "", params: {} }] };
  validateAndRepairPlan(plan);
  check("missing title repaired from kind label", plan.steps[0].title === "Notify", plan.steps[0].title);
}

{
  const plan: AgentPlan = { summary: "t", steps: [{ id: "a", kind: "notify", title: "n", params: null as unknown as Record<string, unknown> }] };
  validateAndRepairPlan(plan);
  check("null params repaired to {}", typeof plan.steps[0].params === "object" && plan.steps[0].params !== null);
}

section("validateAndRepairPlan — rejections");

function throws(name: string, fn: () => void) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  check(name, threw);
}

throws("unknown kind rejected", () =>
  validateAndRepairPlan({ summary: "t", steps: [{ id: "a", kind: "hack_the_planet" as never, title: "x", params: {} }] })
);
throws("duplicate step id rejected", () =>
  validateAndRepairPlan({
    summary: "t",
    steps: [
      { id: "a", kind: "notify", title: "x", params: {} },
      { id: "a", kind: "notify", title: "y", params: {} },
    ],
  })
);
throws("empty plan rejected", () => validateAndRepairPlan({ summary: "t", steps: [] }));
throws("too many steps rejected", () =>
  validateAndRepairPlan({
    summary: "t",
    steps: Array.from({ length: 11 }, (_, i) => ({ id: `s${i}`, kind: "notify" as const, title: "x", params: {} })),
  })
);
throws("kind outside specialist allow-list rejected", () =>
  validateAndRepairPlan(
    { summary: "t", steps: [{ id: "a", kind: "shell_command", title: "x", params: {} }] },
    kindsAllowedForRole("writer")
  )
);
throws("nested delegation rejected", () =>
  validateAndRepairPlan(
    { summary: "t", steps: [{ id: "a", kind: "delegate", title: "x", params: {} }] },
    kindsAllowedForRole("researcher"),
    { allowDelegate: false }
  )
);

section("dependency inference");

{
  const plan: AgentPlan = {
    summary: "t",
    steps: [
      { id: "s1", kind: "firecrawl_search", title: "a", params: { query: "q" } },
      { id: "s2", kind: "llm_decide", title: "b", params: { input: "from:s1" } },
      { id: "s3", kind: "file_save", title: "c", params: { content: ["from:s2", "from:s1.urls"] } },
    ],
  };
  autoInferDependencies(plan);
  check("ref in nested array inferred", (plan.steps[2].dependsOn ?? []).includes("s1"));
  check("multiple deps collected", (plan.steps[2].dependsOn ?? []).includes("s2"));
  check("self-reference ignored", !(plan.steps[0].dependsOn ?? []).includes("s1"));
}

/* ----------------------------- cost + risk ----------------------------- */

section("estimatePlan");

{
  const cheap = estimatePlan({
    summary: "t",
    steps: [
      { id: "a", kind: "firecrawl_search", title: "s", params: {} },
      { id: "b", kind: "browser_open", title: "o", params: {} },
    ],
  });
  check("cheap plan is low risk", cheap.risk === "low", cheap.risk);
  check("cheap plan credit weight", cheap.credits === 1, String(cheap.credits));

  const heavy = estimatePlan({
    summary: "t",
    steps: [
      { id: "a", kind: "deep_research", title: "r", params: {} },
      { id: "b", kind: "shell_command", title: "c", params: {} },
      { id: "c", kind: "browser_login", title: "l", params: {} },
    ],
  });
  check("deep_research weighted at 5", heavy.credits >= 5, String(heavy.credits));
  check("PC/sign-in plan is high risk", heavy.risk === "high", heavy.risk);
  check("risk reasons surfaced", (heavy.riskReasons ?? []).length >= 2, JSON.stringify(heavy.riskReasons));
}

check("search credit weight is 1", stepCreditWeight("firecrawl_search") === 1);
check("extract credit weight is 2", stepCreditWeight("firecrawl_extract") === 2);
check("local kinds are free", stepCreditWeight("notify") === 0);

section("planNeedsApproval");
check(
  "shell_command needs approval",
  planNeedsApproval({ summary: "t", steps: [{ id: "a", kind: "shell_command", title: "x", params: {} }] })
);
check(
  "browser_login runs without approval (only critical work is gated)",
  !planNeedsApproval({ summary: "t", steps: [{ id: "a", kind: "browser_login", title: "x", params: {} }] })
);
check(
  "browser_replay runs without approval",
  !planNeedsApproval({ summary: "t", steps: [{ id: "a", kind: "browser_replay", title: "x", params: {} }] })
);
check(
  "browser_act runs without approval",
  !planNeedsApproval({ summary: "t", steps: [{ id: "a", kind: "browser_act", title: "x", params: {} }] })
);
check(
  "plain search does not need approval",
  !planNeedsApproval({ summary: "t", steps: [{ id: "a", kind: "firecrawl_search", title: "x", params: {} }] })
);
check(
  "a PC-executing plan still needs approval",
  planNeedsApproval({
    summary: "t",
    steps: [
      { id: "a", kind: "firecrawl_search", title: "x", params: {} },
      { id: "b", kind: "shell_command", title: "y", params: {} },
    ],
  })
);

/* ----------------------------- browser intent ----------------------------- */

section("needsBrowserInteraction");

check("check my orders → interactive", needsBrowserInteraction("check my amazon orders"));
check("sign in to linkedin → interactive", needsBrowserInteraction("sign in to linkedin and find my connections"));
check("add to cart → interactive", needsBrowserInteraction("find the cheapest switch and add to cart on amazon"));
check("buy → interactive", needsBrowserInteraction("buy the new kindle on amazon"));
check("plain research → not interactive", !needsBrowserInteraction("research the latest nvidia gpu and compare it"));
check("simple find → not interactive", !needsBrowserInteraction("find the best free react course and open it"));

section("maybeAppendBrowserStep");

{
  const plan: AgentPlan = {
    summary: "t",
    steps: [
      { id: "s1", kind: "firecrawl_search", title: "search", params: { query: "x" } },
      { id: "s2", kind: "browser_open", title: "open", params: { url: "from:s1.url" } },
    ],
  };
  const added = maybeAppendBrowserStep(plan, "check my amazon orders");
  check("browser step appended for interactive goal", added !== null);
  const step = plan.steps.find((s) => s.id === added);
  check("appended step is browser_act", step?.kind === "browser_act", step?.kind);
  check("appended step depends on upstream", (step?.dependsOn ?? []).includes("s1"));
}

{
  const plan: AgentPlan = {
    summary: "t",
    steps: [{ id: "s1", kind: "browser_act", title: "act", params: { task: "x" } }],
  };
  check("no duplicate browser step added", maybeAppendBrowserStep(plan, "check my account") === null);
}

{
  const plan: AgentPlan = { summary: "t", steps: [{ id: "s1", kind: "firecrawl_search", title: "s", params: {} }] };
  check("nothing added for read-only goal", maybeAppendBrowserStep(plan, "compare two gpus") === null);
}

/* ----------------------------- recall ----------------------------- */

section("pickSimilarPastGoals");

{
  const past = [
    { goal: "research the latest nvidia gpu and compare it", status: "done", createdAt: 100 },
    { goal: "buy groceries and set a timer", status: "done", createdAt: 200 },
    { goal: "research mechanical keyboards under 5000", status: "failed", createdAt: 300 },
  ];
  const picked = pickSimilarPastGoals("research the latest amd gpu and compare prices", past, 2);
  check("most similar mission surfaced first", picked[0]?.goal.includes("nvidia"), JSON.stringify(picked));
  check("recall respects limit", picked.length <= 2, String(picked.length));
  check("unrelated mission excluded", !picked.some((p) => p.goal.includes("groceries")));
}

check("known kinds include v5 browser agency", KNOWN_KINDS.has("browser_act") && KNOWN_KINDS.has("browser_login") && KNOWN_KINDS.has("delegate") && KNOWN_KINDS.has("video_brief"));

/* ----------------------------- summary ----------------------------- */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
