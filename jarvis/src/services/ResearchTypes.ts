/**
 * Type definitions for the Oracle Research Engine.
 *
 * Re-exports and extends the public ResearchStatus shape with
 * multi-track comparison data, structured report blocks, and the
 * new ReportType taxonomy. Kept in its own module so the service
 * can be imported by both the API routes and the panel without
 * pulling in Prisma or axios.
 */

export type ReportType =
  | "comparison"
  | "deep_research"
  | "news_roundup"
  | "briefing_memo"
  | "how_to"
  | "market_scan";

/**
 * Structured report block schema. The same shape is rendered in the
 * panel (via the StructuredReportView component) and sent to Notion
 * (via /api/notion/create-page when the request includes "blocks").
 *
 * The Notion API block type names match: heading_1, heading_2,
 * heading_3, paragraph, bulleted_list, numbered_list, table, callout,
 * divider. We add a tiny extension: "items" for list blocks and "rows"
 * for table blocks.
 */
export type ReportBlock =
  | { type: "heading_1"; text: string }
  | { type: "heading_2"; text: string }
  | { type: "heading_3"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bulleted_list"; items: string[] }
  | { type: "numbered_list"; items: string[] }
  | { type: "table"; rows: string[][] }
  | { type: "callout"; text: string; emoji?: string }
  | { type: "divider" };

export interface StructuredReport {
  /** 2-3 sentence executive summary, suitable for a 30s voice brief. */
  summary: string;
  /** Ordered report blocks. */
  blocks: ReportBlock[];
}

/** Per-subject research track for comparison reports. */
export interface ComparisonTrack {
  /** Subject name (e.g. "iPhone 17 Pro Max"). */
  subject: string;
  status: "pending" | "searching" | "scraping" | "synthesizing" | "completed" | "failed";
  progress: number;
  subQueries: { query: string; goal: string }[];
  visitedUrls: string[];
  factsCount: number;
  facts: Map<string, string[]>; // URL -> facts
}

/** Extended status shape returned by /api/research/status. */
export interface ResearchStatus {
  id: string;
  query: string;
  /** Inferred or user-overridden type. */
  reportType: ReportType;
  status: "planning" | "searching" | "scraping" | "synthesizing" | "completed" | "failed";
  /** 0-100. */
  progress: number;
  /** Top-level log feed. */
  logs: string[];
  /** Subject names (for comparisons) or research vectors (for other types). */
  subjects: string[];
  /** Sub-plan emitted by the planner. */
  subQueries: { query: string; goal: string }[];
  /** All sources visited across all tracks. */
  visitedUrls: string[];
  /** Total atomic facts extracted. */
  extractedFactsCount: number;
  /** Per-track status for comparison reports. Empty for single-track. */
  tracks: ComparisonTrack[];
  /** Final structured report (post-synthesis). */
  structuredReport?: StructuredReport;
  /** Final plain markdown (always set, even when structuredReport is set). */
  reportMarkdown?: string;
  /** Notion delivery result. */
  notionUrl?: string;
  /** For follow-up: id of the parent report (set by the API). */
  parentReportId?: string;
}

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  comparison: "Comparison",
  deep_research: "Deep Research",
  news_roundup: "News Roundup",
  briefing_memo: "Briefing Memo",
  how_to: "How-To Guide",
  market_scan: "Market Scan",
};

export const ALL_REPORT_TYPES: ReportType[] = [
  "comparison",
  "deep_research",
  "news_roundup",
  "briefing_memo",
  "how_to",
  "market_scan",
];
