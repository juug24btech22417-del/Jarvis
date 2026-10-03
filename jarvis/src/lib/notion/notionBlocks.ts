/**
 * Pure helpers for building valid Notion block payloads.
 *
 * Extracted from /api/notion/create-page so the sanitization logic can be
 * unit-tested and reused (meeting notes, research reports, etc.).
 *
 * Notion enforces two hard limits that silently break otherwise-fine
 * reports: at most 100 child blocks per request, and at most 2000
 * characters per rich_text object. These helpers normalize both.
 */

export const NOTION_VERSION = "2022-06-28";
export const MAX_BLOCKS_PER_REQUEST = 100;
export const MAX_RICH_TEXT = 2000;

/**
 * Build a rich_text array for a string, splitting anything longer than
 * Notion's 2000-char limit into multiple segments.
 */
export function richText(content: unknown, fallback = "—"): any[] {
  const text = String(content ?? "").trim() || fallback;
  const chunks: any[] = [];
  for (let i = 0; i < text.length; i += MAX_RICH_TEXT) {
    chunks.push({
      type: "text",
      text: { content: text.slice(i, i + MAX_RICH_TEXT) },
    });
  }
  return chunks;
}

/** Split markdown content into Notion paragraph blocks. */
export function splitContentIntoBlocks(content: string): any[] {
  const blocks: any[] = [];
  const paragraphs = String(content || "").split(/\n\s*\n/);
  for (const para of paragraphs) {
    if (!para.trim()) continue;
    for (let i = 0; i < para.length; i += MAX_RICH_TEXT) {
      const piece = para.slice(i, i + MAX_RICH_TEXT);
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: richText(piece) },
      });
    }
  }
  return blocks;
}

/**
 * Normalize caller-supplied structured blocks into valid Notion payloads.
 *
 * Oracle sends blocks already shaped for Notion, but the LLM can still
 * produce a malformed table, an untitled heading, or a list item with no
 * text — any of which makes Notion reject the *entire* request. This
 * sanitizes every block and drops what can't be salvaged.
 */
export function sanitizeBlocks(raw: any[]): any[] {
  const out: any[] = [];

  const withRichText = (type: string, rich: unknown, extra: Record<string, any> = {}) => ({
    object: "block",
    type,
    [type]: { rich_text: richText(rich), ...extra },
  });

  for (const b of Array.isArray(raw) ? raw : []) {
    if (!b || typeof b !== "object") continue;
    const type = b.type;
    const body = b[type] || {};
    const text = body?.rich_text?.[0]?.text?.content ?? b.text ?? b.content;

    switch (type) {
      case "heading_1":
      case "heading_2":
      case "heading_3":
      case "paragraph":
      case "quote":
      case "bulleted_list_item":
      case "numbered_list_item":
        if (!String(text ?? "").trim()) break;
        out.push(withRichText(type, text));
        break;
      case "to_do":
        out.push(withRichText("to_do", text, { checked: Boolean(body?.checked) }));
        break;
      case "callout":
        out.push({
          object: "block",
          type: "callout",
          callout: {
            rich_text: richText(text),
            icon: body?.icon || { type: "emoji", emoji: "💡" },
          },
        });
        break;
      case "image": {
        const imageUrl = body?.external?.url ?? body?.file?.url ?? b.url;
        const caption =
          body?.caption?.[0]?.text?.content ?? b.caption ?? (typeof text === "string" ? text : "");
        if (!imageUrl) break;
        out.push({
          object: "block",
          type: "image",
          image: {
            type: "external",
            external: { url: imageUrl },
            ...(caption ? { caption: richText(caption) } : {}),
          },
        });
        break;
      }
      case "divider":
        out.push({ object: "block", type: "divider", divider: {} });
        break;
      case "table": {
        const cellText = (cell: any): string => {
          if (cell == null) return "—";
          if (typeof cell === "string") return cell;
          if (Array.isArray(cell)) {
            const first = cell[0];
            if (typeof first === "string") return first;
            if (first?.text?.content) return first.text.content;
          }
          if (cell?.text?.content) return cell.text.content;
          return String(cell);
        };
        // Accept both shapes: Notion table_row children, or raw string rows.
        const sourceRows: any[] = Array.isArray(body?.children)
          ? body.children
          : Array.isArray(b.rows)
          ? b.rows
          : [];
        const normalizedRows: string[][] = [];
        for (const r of sourceRows) {
          if (Array.isArray(r)) normalizedRows.push(r.map(cellText));
          else if (r?.table_row?.cells) normalizedRows.push(r.table_row.cells.map(cellText));
        }
        if (normalizedRows.length === 0) break;
        const width = Math.max(...normalizedRows.map((r) => r.length));
        if (width === 0) break;
        const padded = normalizedRows.map((r) => [
          ...r,
          ...Array(width - r.length).fill("—"),
        ]);
        out.push({
          object: "block",
          type: "table",
          table: {
            table_width: width,
            has_column_header: body?.has_column_header ?? true,
            has_row_header: body?.has_row_header ?? false,
            children: padded.map((row) => ({
              object: "block",
              type: "table_row",
              table_row: { cells: row.map((cell) => richText(cell)) },
            })),
          },
        });
        break;
      }
      default:
        // Unknown block type — try to preserve its text as a paragraph.
        if (String(text ?? "").trim()) out.push(withRichText("paragraph", text));
        break;
    }
  }
  return out;
}

/** Split a block list into Notion's <=100-block request batches. */
export function chunkBlocks(blocks: any[], size = MAX_BLOCKS_PER_REQUEST): any[][] {
  const batches: any[][] = [];
  for (let i = 0; i < blocks.length; i += size) {
    batches.push(blocks.slice(i, i + size));
  }
  return batches;
}
