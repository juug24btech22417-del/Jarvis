import type { ReportBlock, StructuredReport } from "./ResearchTypes";

/**
 * Convert a StructuredReport to plain markdown. Used as the source for
 * the panel's "Copy to Clipboard" action, the voice briefing, and the
 * Notion fallback when the user hasn't opted into structured blocks.
 */
export function structuredToMarkdown(report: StructuredReport): string {
  const lines: string[] = [];

  lines.push(`## Executive Summary`);
  lines.push("");
  lines.push(report.summary);
  lines.push("");

  for (const block of report.blocks) {
    lines.push(...blockToMarkdown(block));
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function blockToMarkdown(block: ReportBlock): string[] {
  switch (block.type) {
    case "heading_1":
      return [`# ${block.text}`, ""];
    case "heading_2":
      return [`## ${block.text}`, ""];
    case "heading_3":
      return [`### ${block.text}`, ""];
    case "paragraph":
      return [block.text, ""];
    case "bulleted_list":
      return [...block.items.map((item) => `- ${item}`), ""];
    case "numbered_list":
      return [...block.items.map((item, i) => `${i + 1}. ${item}`), ""];
    case "table": {
      if (block.rows.length === 0) return [];
      const [header, ...rest] = block.rows;
      const colCount = Math.max(header.length, ...rest.map((r) => r.length));
      const padRow = (row: string[]) =>
        `| ${[...row, ...Array(colCount - row.length).fill("")].join(" | ")} |`;
      const sep = `| ${Array(colCount).fill("---").join(" | ")} |`;
      return [padRow(header), sep, ...rest.map(padRow), ""];
    }
    case "callout":
      return [`> ${block.emoji ? block.emoji + " " : ""}${block.text}`, ""];
    case "divider":
      return [`---`, ""];
  }
}

/**
 * Convert a StructuredReport to Notion API block objects.
 * The Notion API expects a very specific shape per block type. We
 * keep the conversion pure so it can be tested in isolation.
 */
export function structuredToNotionBlocks(
  report: StructuredReport
): unknown[] {
  const blocks: unknown[] = [];

  // Lead with a callout for the executive summary so it stands out
  // at the top of the Notion page.
  blocks.push(notionCallout(report.summary, "🧠"));

  for (const block of report.blocks) {
    const nb = notionBlock(block);
    if (!nb) continue;
    // list blocks (bulleted/numbered) return an array of children; the
    // outer collection must stay flat or the Notion API rejects it.
    if (Array.isArray(nb)) blocks.push(...nb);
    else blocks.push(nb);
  }

  return blocks;
}

function notionBlock(block: ReportBlock): unknown | null {
  switch (block.type) {
    case "heading_1":
      return notionHeading(1, block.text);
    case "heading_2":
      return notionHeading(2, block.text);
    case "heading_3":
      return notionHeading(3, block.text);
    case "paragraph":
      return notionParagraph(block.text);
    case "bulleted_list":
      return block.items.map((item) => notionBulletedItem(item));
    case "numbered_list":
      return block.items.map((item) => notionNumberedItem(item));
    case "table":
      return notionTable(block.rows);
    case "callout":
      return notionCallout(block.text, block.emoji);
    case "divider":
      return { object: "block", type: "divider", divider: {} };
  }
  return null;
}

function rt(content: string) {
  return [{ type: "text", text: { content } }];
}

function notionHeading(level: 1 | 2 | 3, text: string) {
  const type = `heading_${level}` as const;
  return {
    object: "block",
    type,
    [type]: { rich_text: rt(text) },
  };
}

function notionParagraph(text: string) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: rt(text) },
  };
}

function notionBulletedItem(text: string) {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: rt(text) },
  };
}

function notionNumberedItem(text: string) {
  return {
    object: "block",
    type: "numbered_list_item",
    numbered_list_item: { rich_text: rt(text) },
  };
}

function notionCallout(text: string, emoji = "💡") {
  return {
    object: "block",
    type: "callout",
    callout: {
      rich_text: rt(text),
      icon: { type: "emoji", emoji },
    },
  };
}

function notionTable(rows: string[][]) {
  if (rows.length === 0) return null;
  const [header, ...rest] = rows;
  const colCount = Math.max(header.length, ...rest.map((r) => r.length));
  const padded = rows.map((r) => [...r, ...Array(colCount - r.length).fill("")]);

  return {
    object: "block",
    type: "table",
    table: {
      table_width: colCount,
      has_column_header: true,
      has_row_header: false,
      children: padded.map((row) => ({
        object: "block",
        type: "table_row",
        table_row: {
          cells: row.map((cell) => rt(cell || "—")),
        },
      })),
    },
  };
}
