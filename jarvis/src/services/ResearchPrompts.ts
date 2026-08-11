/**
 * Prompt library for the Oracle Research Engine.
 *
 * Each prompt is a system-level instruction that is fed to the
 * /api/research-llm endpoint along with user/context data. The endpoint
 * is expected to return JSON where appropriate.
 *
 * Sections are kept in the order the engine consumes them:
 *   1. CLASSIFIER  — picks the report type from a free-form query
 *   2. PLANNER     — generates sub-queries for a single-track research task
 *   3. COMPARISON_PLANNER — generates one sub-plan PER subject
 *   4. RESEARCHER  — extracts atomic facts from a scraped page
 *   5. SYNTHESIZER — produces a single-topic executive report (markdown)
 *   6. COMPARISON_SYNTHESIZER — produces structured comparison blocks
 *   7. STRUCTURED_SYNTHESIZER — produces structured blocks for any report type
 *   8. FOLLOWUP    — derives a follow-up query from a finished report
 */
export const RESEARCH_PROMPTS = {
  /**
   * Step 1 of the Oracle pipeline. Called once when a query is submitted.
   * Returns { type, subjects?, reasoning }.
   */
  CLASSIFIER: `You are a query classifier for a deep-research engine.

Your job is to look at a user's free-form research query and decide which
of these report types fits best:

- "comparison"        — comparing 2+ named products/concepts/options side by side
                         (e.g. "iPhone 17 Pro Max vs Samsung Z Fold 7",
                          "Postgres vs MongoDB", "React vs Vue vs Svelte").
                         Extract every subject as a string in "subjects".
- "deep_research"     — single-topic deep dive, no comparison frame
                         (e.g. "the future of solid-state batteries",
                          "history of the Roman Empire").
- "news_roundup"      — time-bounded survey of recent events or announcements
                         (e.g. "AI news this week",
                          "Apple announcements from WWDC 2026").
- "briefing_memo"     — short executive memo on a single topic
                         (e.g. "briefing memo on the new EU AI Act",
                          "executive summary of our Q3 results").
- "how_to"            — sequential guide on how to do something
                         (e.g. "how to set up a Kubernetes cluster",
                          "steps to migrate to a new Mac").
- "market_scan"       — landscape overview of a market, players, pricing
                         (e.g. "vector database market in 2026",
                          "top LLM providers for enterprise").

Return ONLY JSON of the form:
{
  "type": "<one of the types above>",
  "subjects": ["<named subject 1>", "<named subject 2>", ...],
  "reasoning": "<one-sentence justification>"
}

If you cannot determine the type with confidence, default to "deep_research"
and set subjects to an empty array. Subjects should be the literal product
or concept names, not a description. For non-comparison types, subjects
should be an empty array.`,

  /** Step 2A — single-track planning (the original behavior). */
  PLANNER: `You are a Research Strategist. Decompose the following research query into 3-5 targeted search queries.
  For each query, explain what specific information we are looking for.
  Return the result as a JSON array of objects: [{ "query": "string", "goal": "string" }]`,

  /**
   * Step 2B — comparison planning. The engine calls this once per subject
   * so each subject gets its own research plan.
   */
  COMPARISON_PLANNER: `You are a Research Strategist preparing a deep dive on ONE specific subject that will be compared against other subjects.

The subject to research is: "{SUBJECT}"
The overall comparison query is: "{QUERY}"

Generate 3-5 targeted search queries that will gather the structured facts
needed to compare this subject against its peers. Focus on:
- Headline specifications (e.g. dimensions, weight, display, processor, memory)
- Price and availability (with date and region if available)
- Distinguishing features and design choices
- Known weaknesses or trade-offs
- Reviewer/press consensus (recent)

Return ONLY JSON: { "queries": [{ "query": "string", "goal": "string" }] }`,

  /** Step 4 — fact extraction. Unchanged from the original. */
  RESEARCHER: `You are a Web Research Specialist. Extract a list of atomic facts from the provided text that are relevant to the research goal.
  Ignore fluff, ads, and navigation elements. Focus on numbers, dates, specific claims, and technical specifications.
  Return the result as a JSON array of strings. If no relevant information is found, return an empty array [].`,

  /** Step 5 — flat markdown synthesis. Kept for backwards compat. */
  SYNTHESIZER: `You are a Senior Research Analyst. Synthesize the following extracted facts into a professional, executive-grade research report.

  Report Schema:
  - Executive Summary: A high-level overview (3-5 sentences).
  - Detailed Analysis: Thematic sections with bullet points for data.
  - Key Sources: A numbered list of URLs used.
  - Conclusion: Final verdict or synthesis.

  Use a professional, neutral tone. Use markdown formatting.`,

  /**
   * Step 6 — structured comparison synthesis.
   * Emits a JSON array of "blocks" that the UI renders as a side-by-side
   * spec table plus a verdict. The same shape is sent to Notion.
   */
  COMPARISON_SYNTHESIZER: `You are a Senior Comparison Analyst. You are given the aggregated facts for each of several subjects that a user asked to compare.

The comparison query is: "{QUERY}"
The subjects being compared are: {SUBJECTS}

Produce a JSON object of the form:
{
  "summary": "<2-3 sentence executive summary of the comparison verdict>",
  "blocks": [
    { "type": "heading_1", "text": "<short comparison title>" },
    { "type": "callout", "text": "<the executive summary>", "emoji": "⚖️" },
    { "type": "heading_2", "text": "At a glance" },
    {
      "type": "table",
      "rows": [
        ["<attribute>", "<subject 1>", "<subject 2>", ...],
        ["<spec or feature>", "<value>", "<value>", ...],
        ...
      ]
    },
    { "type": "heading_2", "text": "Per-subject details" },
    ... one bulleted_list per subject, with the most important 3-6 facts ...
    { "type": "heading_2", "text": "Verdict" },
    { "type": "paragraph", "text": "<which subject wins for which kind of user>" },
    { "type": "heading_2", "text": "Sources" },
    { "type": "bulleted_list", "items": ["<url>", "<url>", ...] }
  ]
}

Constraints:
- The "table" block's first row is the header row and must list every subject.
- Keep attribute rows focused on the comparison (specs, price, key features).
- Do NOT invent facts that are not in the aggregated data; if a value is
  unknown, write "—" in the cell.
- For "bulleted_list" blocks, use "items": ["a", "b", ...] not "text".
- For all other text blocks, use "text" not "items".
- Use only these block types: heading_1, heading_2, heading_3, paragraph,
  bulleted_list, numbered_list, table, callout, divider.
- The output is a single JSON object, no commentary, no markdown fences.
- Your very first character of output must be "{" and your last must be "}".`,

  /**
   * Step 7 — generic structured synthesis for non-comparison types.
   * Produces the same block schema, themed appropriately.
   */
  STRUCTURED_SYNTHESIZER: `You are a Senior Research Analyst. You will be given a report type, a research query, and aggregated facts.

The report type is: "{TYPE}"
The research query is: "{QUERY}"

Produce a JSON object of the form:
{
  "summary": "<2-3 sentence executive summary suitable for a 30-second voice briefing>",
  "blocks": [
    { "type": "heading_1", "text": "<a short title for the report>" },
    { "type": "callout", "text": "<the executive summary>", "emoji": "🧠" },
    ... further blocks appropriate to the report type ...
  ]
}

Guidelines per report type:
- deep_research:   heading_2 themes with bulleted_list items under each
- news_roundup:    numbered_list of dated items, then a callout for the throughline
- briefing_memo:   heading_2 sections for "Context", "Key Points", "Implications"
- how_to:          numbered_list of steps, then a "Prerequisites" callout
- market_scan:     table of players × columns (positioning, pricing, key feature),
                   followed by a "Trends" bulleted_list

Use only these block types: heading_1, heading_2, heading_3, paragraph,
bulleted_list, numbered_list, table, callout, divider.
The output is a single JSON object, no commentary, no markdown fences.
Your very first character of output must be "{" and your last must be "}".`,

  /**
   * Step 8 — derive a follow-up query from a finished report. Used when
   * the user clicks "Ask follow-up" in the panel.
   */
  FOLLOWUP: `You are an assistant that reads a finished report and the user's follow-up question, and rewrites the question as a standalone research query that includes enough context to be researched on its own.

The report was on: "{REPORT_QUERY}"
The report's executive summary was: "{REPORT_SUMMARY}"
The user's follow-up question is: "{FOLLOWUP}"

Return ONLY JSON: { "query": "<the rewritten standalone research query>", "type": "<one of: deep_research, comparison, news_roundup, briefing_memo, how_to, market_scan>" }`,
};
