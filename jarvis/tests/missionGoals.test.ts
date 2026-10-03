// Mission Control — "Jarvis, handle it" coverage.
//
// Two representative natural-language goals from each of the ten mission
// tiers. For every goal we assert that:
//   1. it is classified into a known mission category,
//   2. a deterministic fallback plan can ALWAYS be produced for it (so a
//      planner/LLM outage never leaves the user with nothing),
//   3. that plan passes the same validation the executor applies,
//   4. its steps are sane (1..10, all known kinds, no dangling dependency),
//   5. a routing directive exists for the category.
//
// Plus the structured shapes that must stay on the instant lane.
//
// Run with:  npx tsx tests/missionGoals.test.ts

import {
  KNOWN_KINDS,
  autoInferDependencies,
  categoryDirective,
  classifyGoal,
  cleanGoalQuery,
  estimatePlan,
  extractDurationMinutes,
  fallbackPlan,
  heuristicPlan,
  maybeAppendBrowserStep,
  multiOpenIntent,
  validateAndRepairPlan,
  type MissionCategory,
} from "../src/lib/agent/plan";

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

const KNOWN_CATEGORIES: MissionCategory[] = [
  "investigate",
  "dev_env",
  "organize_files",
  "vision_verify",
  "resources_digest",
  "oss_contribute",
  "news",
  "research_compare",
  "learn",
  "prep_workspace",
  "parallel",
  "figure_it_out",
  "generic",
];

/* Two goals per tier — the hard, natural-language versions a user actually types. */
const TIER_GOALS: Array<{ tier: number; goal: string; category: MissionCategory }> = [
  // Tier 1 — figure it out yourself
  { tier: 1, goal: "I have 90 minutes free. Decide what would be the most useful thing for me to accomplish and set everything up.", category: "figure_it_out" },
  { tier: 1, goal: "My laptop is cluttered. Figure out what can safely be cleaned up and organize it.", category: "organize_files" },

  // Tier 2 — research → reason → execute
  { tier: 2, goal: "Research three AI tools that could actually make my development workflow faster. Test what you can, compare them, and open the most useful one.", category: "research_compare" },
  { tier: 2, goal: "Find a useful open-source project I could contribute to as a beginner, inspect its GitHub repository, and find an issue I could realistically work on.", category: "oss_contribute" },

  // Tier 3 — developer agent
  { tier: 3, goal: "Open my Jarvis project, check whether it's running, inspect the project for obvious issues, and tell me what needs attention.", category: "dev_env" },
  { tier: 3, goal: "Start my development environment. If anything fails, investigate the error and try to fix it.", category: "investigate" },

  // Tier 4 — cross-web intelligence
  { tier: 4, goal: "Find today's biggest AI story, read multiple sources, identify what they agree on and where they differ, then open the most informative source.", category: "news" },
  { tier: 4, goal: "Find three alternatives to a popular paid developer tool. Verify that they're usable for free and open the best two.", category: "research_compare" },

  // Tier 5 — information → file → communication
  { tier: 5, goal: "Research the latest developments in AI agents, create a concise summary, save it as a file, and send it to me on Telegram.", category: "resources_digest" },
  { tier: 5, goal: "Find five useful resources for learning agentic AI, organize them from beginner to advanced, save the list, and open the first one.", category: "resources_digest" },

  // Tier 6 — vision + browser + recovery
  { tier: 6, goal: "Open a website and find the main call-to-action. Don't rely only on a predefined selector; verify visually that you clicked the correct element.", category: "vision_verify" },
  { tier: 6, goal: "Open my localhost application, visually inspect it, find anything obviously broken, and tell me what you found.", category: "dev_env" },

  // Tier 7 — parallel multitasking
  { tier: 7, goal: "Research today's AI news, start a coding playlist, and open my development project. Do whatever can safely happen in parallel.", category: "parallel" },
  { tier: 7, goal: "Prepare my coding environment while simultaneously finding a useful tutorial for the problem I'm working on.", category: "parallel" },

  // Tier 8 — context & memory
  { tier: 8, goal: "Find three interesting AI projects.", category: "generic" },
  { tier: 8, goal: "Open the second one from that list and remember it.", category: "generic" },

  // Tier 9 — investigation
  { tier: 9, goal: "Something seems wrong with my development environment. Investigate what's wrong and tell me what you find.", category: "investigate" },
  { tier: 9, goal: "Find out whether this library is still actively maintained. Check its GitHub activity, latest release, documentation, and issues.", category: "investigate" },

  // Tier 10 — "Jarvis, handle it"
  { tier: 10, goal: "I want to build a new capability for Jarvis. Find something genuinely useful that I don't already have, research how to build it, and prepare everything I need to start.", category: "research_compare" },
  { tier: 10, goal: "I have nothing planned for the next two hours. Make this time useful.", category: "figure_it_out" },
];

/* ----------------------------- classification ----------------------------- */

section("classifyGoal — two tasks per mission tier");

for (const { tier, goal, category } of TIER_GOALS) {
  const got = classifyGoal(goal);
  check(`T${tier}: "${goal.slice(0, 58)}…" → ${category}`, got === category, `got ${got}`);
  check(`T${tier}: category is known`, KNOWN_CATEGORIES.includes(got), got);
}

/* ----------------------------- fallback planner ----------------------------- */

section("fallbackPlan — every goal yields a valid, executable plan");

for (const { tier, goal, category } of TIER_GOALS) {
  const plan = fallbackPlan(goal, category);
  let valid = true;
  let err = "";
  try {
    validateAndRepairPlan(plan);
  } catch (e) {
    valid = false;
    err = (e as Error).message;
  }
  check(`T${tier}: plan validates`, valid, err);
  check(`T${tier}: 1..10 steps`, plan.steps.length >= 1 && plan.steps.length <= 10, String(plan.steps.length));
  check(
    `T${tier}: all kinds known`,
    plan.steps.every((s) => KNOWN_KINDS.has(s.kind)),
    plan.steps.map((s) => s.kind).join(",")
  );

  // Every dependsOn must point at a real, earlier-or-equal step id.
  const ids = new Set(plan.steps.map((s) => s.id));
  const dangling = plan.steps.flatMap((s) => (s.dependsOn ?? []).filter((d) => !ids.has(d.split(".")[0])));
  check(`T${tier}: no dangling dependencies`, dangling.length === 0, dangling.join(","));

  const est = estimatePlan(plan);
  check(`T${tier}: estimate present`, typeof est.credits === "number" && typeof est.seconds === "number");
}

section("categoryDirective — routing hints");

for (const cat of KNOWN_CATEGORIES) {
  const directive = categoryDirective(cat);
  check(`${cat}: directive present when expected`, cat === "generic" ? directive === "" : directive.length > 0, `"${directive.slice(0, 40)}"`);
}

/* ----------------------------- specific plan shapes ----------------------------- */

section("fallbackPlan — key kinds per category");

const kindOf = (goal: string) => new Set(fallbackPlan(goal).steps.map((s) => s.kind));

check(
  "organize_files scans local folders and never shells out",
  kindOf("My laptop is cluttered. Organize it.").has("file_list") &&
    !kindOf("My laptop is cluttered. Organize it.").has("shell_command")
);

check(
  "dev_env runs diagnostics (shell) and reports",
  kindOf("Check whether my dev server is running").has("shell_command") &&
    kindOf("Check whether my dev server is running").has("notify")
);

check(
  "investigate collects evidence then reports",
  kindOf("Investigate why this website isn't working for me").has("firecrawl_search") &&
    kindOf("Investigate why this website isn't working for me").has("shell_command")
);

check(
  "resources_digest saves a file and sends it",
  kindOf("Find resources and save them and send it to me on Telegram").has("file_save") &&
    kindOf("Find resources and save them and send it to me on Telegram").has("telegram_send")
);

check(
  "vision_verify ends with a visual confirmation",
  (() => {
    const steps = fallbackPlan("Visually verify the page looks right").steps;
    return steps[steps.length - 1].kind === "vision_inspect";
  })()
);

check(
  "figure_it_out decides, opens, and starts a timer",
  kindOf("I have 90 minutes free, decide something useful").has("llm_decide") &&
    kindOf("I have 90 minutes free, decide something useful").has("browser_open") &&
    kindOf("I have 90 minutes free, decide something useful").has("timer_set")
);

section("fallbackPlan — parallel branch has independent steps");

{
  const plan = fallbackPlan("Research the news and open my project in parallel");
  const parallel = plan.steps.filter((s) => s.id === "p1" || s.id === "p2" || s.id === "p3");
  check("three independent branches", parallel.length === 3);
  check("independent branches carry no dependsOn", parallel.every((s) => (s.dependsOn ?? []).length === 0));
  const joiner = plan.steps.find((s) => s.id === "p4");
  check("the report step waits for all branches", (joiner?.dependsOn ?? []).length === 3, JSON.stringify(joiner?.dependsOn));
}

/* ----------------------------- helpers ----------------------------- */

section("extractDurationMinutes + session length");

check("numeric minutes", extractDurationMinutes("I have 90 minutes free") === 90, String(extractDurationMinutes("I have 90 minutes free")));
check("numeric hours", extractDurationMinutes("I have 2 hours") === 120, String(extractDurationMinutes("I have 2 hours")));
check("word hours", extractDurationMinutes("nothing planned for the next two hours") === 120, String(extractDurationMinutes("nothing planned for the next two hours")));
check("none stated → null", extractDurationMinutes("find me a course") === null);
{
  const plan = fallbackPlan("I have 90 minutes free. Decide something useful.");
  const timer = plan.steps.find((s) => s.kind === "timer_set");
  check("figure_it_out timer honours stated 90 minutes", Number(timer?.params.minutes) === 90, String(timer?.params.minutes));
}

section("cleanGoalQuery");

check("strips leading polite noise", !/^please/i.test(cleanGoalQuery("Please research the best keyboards under 5000 and open one")));
check("drops trailing instruction tail", !/open one$/i.test(cleanGoalQuery("Research the best keyboards under 5000 and open one")));
check("never empty", cleanGoalQuery("open").length > 0);

/* ----------------------------- instant lane unchanged ----------------------------- */

section("heuristicPlan — structured shapes stay instant");

check("weather", heuristicPlan("What's the weather in Bengaluru") !== null);
check("timer", heuristicPlan("Set a 25 minute timer") !== null);
check("play on spotify", heuristicPlan("Play lo-fi beats on spotify") !== null);
check("find and open", heuristicPlan("Find the best free react course and open it") !== null);
check("multi-open", multiOpenIntent("find three websites to watch movies for free and open all three in different panels") !== null);

section("maybeAppendBrowserStep — interactive goals get a browser step");

{
  const plan = fallbackPlan("Compare two GPUs");
  autoInferDependencies(plan);
  const added = maybeAppendBrowserStep(plan, "sign in to linkedin and check my connections");
  check("interactive goal gains a browser step", added !== null);
  check("read-only goal does not", maybeAppendBrowserStep(fallbackPlan("Compare two GPUs"), "compare two gpus") === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
