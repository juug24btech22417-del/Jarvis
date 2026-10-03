// Research pipeline regression tests.
//
// These cover the bugs that made Oracle/meeting reports fail:
//   • LLMs wrapping JSON in fences / thinking blocks / prose — the parsers
//     used to throw and silently abort the whole run,
//   • the planner/fact prompts that allowed either a bare array or an
//     object — both shapes must be accepted,
//   • Notion's 100-block and 2000-char limits, which made "big" reports
//     fail to save,
//   • malformed tables/images that made Notion reject the entire page.
//
// Run with:  npx tsx tests/researchPipeline.test.ts

import { parseJsonLoose, coerceArray, stripThinking } from "../src/lib/llm/looseJson";
import {
  sanitizeBlocks,
  splitContentIntoBlocks,
  richText,
  chunkBlocks,
  MAX_RICH_TEXT,
  MAX_BLOCKS_PER_REQUEST,
} from "../src/lib/notion/notionBlocks";
import {
  structuredToMarkdown,
  structuredToNotionBlocks,
} from "../src/services/StructuredReportConverters";
import type { StructuredReport } from "../src/services/ResearchTypes";
import { extractBlocks, normalizeBlocks } from "../src/services/OracleResearchService";

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

// ─────────────────────────────────────────────────────────────────────────
section("Loose JSON parsing survives real model output");

check("plain JSON parses", parseJsonLoose('{"a":1}').a === 1);
check(
  "markdown-fenced JSON parses",
  parseJsonLoose('```json\n{"queries":[{"query":"q"}]}\n```').queries[0].query === "q"
);
check(
  "prose preamble is stripped",
  parseJsonLoose('Sure! Here is the plan:\n{"type":"deep_research"}').type === "deep_research"
);
check(
  "thinking blocks are stripped",
  parseJsonLoose(' thinkingthe user wants ideas</think>{"facts":["f1"]}').facts[0] === "f1"
);
check("bare arrays parse", Array.isArray(parseJsonLoose('["a","b"]')));
check("garbage returns the fallback", parseJsonLoose("no json here", { ok: true }).ok === true);
check("unterminated JSON still extracts the object", parseJsonLoose('{"x":1} trailing noise').x === 1);
check("stripThinking handles an unclosed block", stripThinking("hello  thinkingpartial reasoning").includes("hello"));

// ─────────────────────────────────────────────────────────────────────────
section("Planner / fact extraction accept both array and object shapes");

const plannerObject = '{"queries":[{"query":"israel gaza latest","goal":"news"}]}';
const plannerArray = '[{"query":"israel gaza latest","goal":"news"}]';
const plannerStrings = '["israel gaza latest news"]';

const mapQuery = (item: any) => {
  if (!item) return null;
  if (typeof item === "string") return { query: item, goal: "" };
  return item.query ? { query: item.query, goal: item.goal || "" } : null;
};

check(
  "queries object shape",
  coerceArray(plannerObject, "queries", mapQuery).length === 1
);
check(
  "queries bare-array shape",
  coerceArray(plannerArray, "queries", mapQuery)[0].query === "israel gaza latest"
);
check(
  "queries string-array shape",
  coerceArray(plannerStrings, "queries", mapQuery)[0].query === "israel gaza latest news"
);
check(
  "facts object shape",
  coerceArray('{"facts":["a","b"]}', "facts", (f) => (typeof f === "string" ? f : null)).length === 2
);
check(
  "facts bare-array shape",
  coerceArray('["a","b"]', "facts", (f) => (typeof f === "string" ? f : null)).length === 2
);
check(
  "facts with garbage entries are filtered",
  coerceArray('{"facts":["a", null, 42]}', "facts", (f) => (typeof f === "string" ? f : null)).length === 1
);

// ─────────────────────────────────────────────────────────────────────────
section("Notion rich text obeys the 2000-char limit");

const long = "x".repeat(MAX_RICH_TEXT * 2 + 50);
const segmented = richText(long);
check("long text is split into multiple rich_text objects", segmented.length === 3);
check(
  "every segment is within the limit",
  segmented.every((s) => s.text.content.length <= MAX_RICH_TEXT)
);
check("empty text falls back to a dash", richText("").length === 1);

// ─────────────────────────────────────────────────────────────────────────
section("Notion block sanitizer drops/repairs bad blocks");

const sanitized = sanitizeBlocks([
  { type: "heading_1", heading_1: { rich_text: [{ text: { content: "Title" } }] } },
  { type: "paragraph", paragraph: { rich_text: [{ text: { content: long } }] } },
  { type: "heading_2", heading_2: { rich_text: [{ text: { content: "" } }] } }, // dropped
  { type: "mystery" }, // dropped
  { type: "divider", divider: {} },
]);
check("valid blocks survive", sanitized.length === 3, `got ${sanitized.length}`);
check(
  "empty headings are dropped",
  !sanitized.some((b) => b.type === "heading_2")
);
const longPara: any = sanitized.find((b) => b.type === "paragraph");
check(
  "long paragraphs are split into several rich_text segments",
  longPara?.paragraph?.rich_text?.length >= 2,
  `segments=${longPara?.paragraph?.rich_text?.length}`
);

// A Notion-shaped table (children are table_row blocks) must be preserved.
const tableBlock = {
  type: "table",
  table: {
    table_width: 2,
    has_column_header: true,
    children: [
      { type: "table_row", table_row: { cells: [[{ text: { content: "Attribute" } }], [{ text: { content: "Israel" } }]] } },
      { type: "table_row", table_row: { cells: [[{ text: { content: "Status" } }], [{ text: { content: "Ongoing" } }]] } },
    ],
  },
};
const withTable = sanitizeBlocks([tableBlock]);
check("Notion table_row children survive sanitization", withTable.length === 1);
check(
  "table keeps both rows",
  withTable[0]?.table?.children?.length === 2
);

// An image block must survive with its URL and caption.
const withImage = sanitizeBlocks([
  { type: "image", image: { type: "external", external: { url: "https://img.example/a.jpg" }, caption: [{ text: { content: "Gaza skyline" } }] } },
]);
check("image block survives", withImage.length === 1);
check(
  "image URL preserved",
  withImage[0]?.image?.external?.url === "https://img.example/a.jpg"
);
check(
  "image caption preserved",
  withImage[0]?.image?.caption?.[0]?.text?.content === "Gaza skyline"
);

// ─────────────────────────────────────────────────────────────────────────
section("Block batching respects the 100-block request limit");

const many = Array.from({ length: 250 }, () => ({ object: "block", type: "divider", divider: {} }));
const batches = chunkBlocks(many);
check("250 blocks split into 3 batches", batches.length === 3);
check("no batch exceeds the limit", batches.every((b) => b.length <= MAX_BLOCKS_PER_REQUEST));

// ─────────────────────────────────────────────────────────────────────────
section("Report converters round-trip images and large reports");

const report: StructuredReport = {
  summary: "Two-week overview of the latest Israel–Gaza developments.",
  blocks: [
    { type: "heading_1", text: "Latest Developments" },
    { type: "image", url: "https://img.example/gaza.jpg", caption: "Gaza" },
    { type: "paragraph", text: "A short analysis." },
    { type: "bulleted_list", items: ["Ceasefire talks", "Aid corridors"] },
  ],
};

const md = structuredToMarkdown(report);
check("markdown includes the image", md.includes("![Gaza](https://img.example/gaza.jpg)"));
check("markdown includes the summary", md.includes("Two-week overview"));

const notion = structuredToNotionBlocks(report) as any[];
check(
  "notion conversion emits an external image block",
  notion.some((b) => b.type === "image" && b.image?.external?.url === "https://img.example/gaza.jpg")
);
check("notion conversion preserves the summary callout", notion[0]?.type === "callout");

// Markdown fallback for a very long report should produce >100 blocks so
// the route's append path is exercised in production.
const huge = splitContentIntoBlocks(Array.from({ length: 60 }, (_, i) => `Paragraph ${i} ${"y".repeat(3000)}`).join("\n\n"));
check("long markdown expands to many blocks", huge.length > 100, `got ${huge.length}`);

// ─────────────────────────────────────────────────────────────────────────
section("Synthesizer output recovery (shape tolerance)");

// The model sometimes returns a bare array instead of { blocks: [...] }.
const bare = normalizeBlocks(extractBlocks([{ type: "heading_1", text: "Title" }]));
check("bare block array is recovered", bare.length === 1 && bare[0].type === "heading_1");

// ...or a sections outline instead of blocks.
const outline = extractBlocks({
  sections: [
    { heading: "Humanitarian", bullets: ["a", "b"] },
    { title: "Politics", content: "A paragraph." },
  ],
});
check("sections outline flattens to heading + list + paragraph", outline.length === 4, `got ${outline.length}`);

// ...or almost-right type names and list shapes.
const aliased = normalizeBlocks([
  { type: "heading", text: "A heading" },
  { type: "list", items: ["one", { text: "two" }, "- three"] },
  "a bare string paragraph",
]);
check("type aliases are repaired", aliased[0]?.type === "heading_2");
check(
  "list items handle strings, objects and bullets",
  aliased[1]?.type === "bulleted_list" && (aliased[1] as any).items.length === 3,
  JSON.stringify(aliased[1])
);
check("bare string blocks become paragraphs", aliased[2]?.type === "paragraph");

// Tables with object cells and a list-with-a-single-text-field.
const weird = normalizeBlocks([
  { type: "table", rows: [["A", { text: "B" }], ["C", "D"]] },
  { type: "bulleted_list", text: "- alpha\n- beta" },
]);
check("table cells coerce objects to text", (weird[0] as any).rows[0][1] === "B");
check("newline lists split into items", (weird[1] as any).items.length === 2);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
