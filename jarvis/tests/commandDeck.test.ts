// Command Deck — natural-language task quick-add + the Mission → Deck bridge.
//
// All pure: no Prisma, no network, no Next runtime.
//
// Run with:  npx tsx tests/commandDeck.test.ts

import { parseQuickAdd, formatDueAt, type QuickPriority } from "../src/lib/tasks/quickAdd";
import { collectRemainingItems, extractFollowUpTasks, type FollowUpJob } from "../src/lib/agent/missionFollowups";

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

// Friday, 2 October 2026, 10:00 local — frozen so date math is deterministic.
const NOW = new Date(2026, 9, 2, 10, 0, 0);

/* ----------------------------- quick-add parsing ----------------------------- */

section("parseQuickAdd — the headline case");

{
  const r = parseQuickAdd("pay bill tomorrow 6pm high", NOW);
  check("title strips the date/time/priority", r.title === "pay bill", r.title);
  check("priority recognised", r.priority === "high", r.priority);
  check("due is tomorrow at 18:00", r.dueAt !== null && formatDueAt(r.dueAt, NOW) === "Tomorrow 6:00 PM", r.dueAt ? formatDueAt(r.dueAt, NOW) : "null");
}

section("parseQuickAdd — priority words");

const priorityCases: Array<[string, QuickPriority, string]> = [
  ["fix deploy critical", "critical", "fix deploy"],
  ["review PR urgent", "critical", "review PR"],
  ["prep slides tomorrow important", "high", "prep slides"],
  ["buy groceries someday", "someday", "buy groceries"],
  ["read that article low", "someday", "read that article"],
  ["water the plants", "normal", "water the plants"],
];
for (const [input, priority, title] of priorityCases) {
  const r = parseQuickAdd(input, NOW);
  check(`"${input}" → ${priority} / "${title}"`, r.priority === priority && r.title === title, `${r.priority} / ${r.title}`);
}

section("parseQuickAdd — dates & times");

{
  const r = parseQuickAdd("call mom at 9am", NOW);
  check("past time rolls to tomorrow", r.dueAt !== null && formatDueAt(r.dueAt, NOW) === "Tomorrow 9:00 AM", r.dueAt ? formatDueAt(r.dueAt, NOW) : "null");
  check("title keeps the rest", r.title === "call mom", r.title);
}
{
  const r = parseQuickAdd("meeting noon", NOW);
  check("noon is today at 12:00", r.dueAt !== null && formatDueAt(r.dueAt, NOW) === "Today 12:00 PM", r.dueAt ? formatDueAt(r.dueAt, NOW) : "null");
}
{
  const r = parseQuickAdd("submit report friday", NOW);
  check("bare weekday → next Friday", r.dueAt !== null && r.dueAt.getDay() === 5 && r.dueAt.getDate() === 9, r.dueAt ? r.dueAt.toDateString() : "null");
  check("weekday stripped from title", r.title === "submit report", r.title);
}
{
  const r = parseQuickAdd("team sync next week", NOW);
  check("next week = +7 days", r.dueAt !== null && r.dueAt.getDate() === 9, r.dueAt ? r.dueAt.toDateString() : "null");
  check("title clean", r.title === "team sync", r.title);
}
{
  const r = parseQuickAdd("review pr 12 october", NOW);
  check("calendar date parsed", r.dueAt !== null && r.dueAt.getMonth() === 9 && r.dueAt.getDate() === 12, r.dueAt ? r.dueAt.toDateString() : "null");
  check("title clean", r.title === "review pr", r.title);
}
{
  const r = parseQuickAdd("just a plain task line", NOW);
  check("no false positives", r.dueAt === null && r.priority === "normal", `${r.priority} / ${r.dueAt}`);
}
{
  const r = parseQuickAdd("   ", NOW);
  check("empty input is safe", r.title === "" && r.dueAt === null);
}

/* ----------------------------- mission → deck ----------------------------- */

section("collectRemainingItems");

const job: FollowUpJob = {
  goal: "investigate the API",
  plan: {
    summary: "test mission",
    steps: [
      { id: "s1", kind: "firecrawl_search", title: "Search the docs", params: {} },
      { id: "s2", kind: "browser_open", title: "Open the best result", params: {} },
      { id: "s3", kind: "notify", title: "Report back", params: {} },
    ],
  },
  results: [
    {
      stepId: "s1",
      status: "ok",
      finishedAt: 0,
      result: { summary: "## Findings\nSome detail.\n## Next steps\n- Read the pricing docs\n- Try the free tier" },
    },
    { stepId: "s2", status: "error", error: "timeout", finishedAt: 0 },
    { stepId: "s3", status: "error", error: "no channel", finishedAt: 0 },
  ],
};

{
  const items = collectRemainingItems(job);
  check("failed step surfaced", items.some((i) => i === "Open the best result"), JSON.stringify(items));
  check("next-steps bullets surfaced", items.includes("Read the pricing docs") && items.includes("Try the free tier"), JSON.stringify(items));
  check("non-actionable notify failure excluded", !items.some((i) => i.toLowerCase().includes("report back")), JSON.stringify(items));
}

section("extractFollowUpTasks — from the report's What remains section");

{
  const report = [
    "# JARVIS Mission Report",
    "## Plan",
    "- something",
    "## What remains",
    "- renew domain high tomorrow",
    "- email the team",
    "",
    "## Sources",
    "- https://example.com",
  ].join("\n");
  const tasks = extractFollowUpTasks(job, report, NOW);
  check("two tasks extracted", tasks.length === 2, String(tasks.length));
  const domain = tasks.find((t) => t.title.startsWith("renew domain"));
  check("priority parsed from the bullet", domain?.priority === "high", domain?.priority);
  check("due parsed from the bullet", domain?.dueAt !== null, domain?.dueAt ? domain.dueAt.toDateString() : "null");
  check("clean title", domain?.title === "renew domain", domain?.title);
  check("sources section ignored", !tasks.some((t) => t.title.includes("example.com")), JSON.stringify(tasks.map((t) => t.title)));
  check("source tagged report", tasks.every((t) => t.source === "report"), JSON.stringify(tasks.map((t) => t.source)));
}

section("extractFollowUpTasks — fallback when no report is supplied");

{
  const tasks = extractFollowUpTasks(job, null, NOW);
  check("falls back to the job's failed steps + next steps", tasks.length === 3, String(tasks.length));
  check("deduped + capped at limit", extractFollowUpTasks(job, null, NOW, 1).length === 1);
}

section("extractFollowUpTasks — dedupe");

{
  const report = ["## What remains", "- pay the bill", "- Pay the bill"].join("\n");
  const tasks = extractFollowUpTasks(job, report, NOW);
  check("case-insensitive duplicate removed", tasks.length === 1, JSON.stringify(tasks.map((t) => t.title)));
}

section("formatDueAt");

check("today label", formatDueAt(new Date(2026, 9, 2, 18, 0, 0), NOW) === "Today 6:00 PM", formatDueAt(new Date(2026, 9, 2, 18, 0, 0), NOW));
check("tomorrow label", formatDueAt(new Date(2026, 9, 3, 9, 0, 0), NOW) === "Tomorrow 9:00 AM", formatDueAt(new Date(2026, 9, 3, 9, 0, 0), NOW));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
