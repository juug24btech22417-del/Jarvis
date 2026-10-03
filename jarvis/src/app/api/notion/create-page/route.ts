import { NextRequest, NextResponse } from "next/server";
import {
  NOTION_VERSION,
  MAX_BLOCKS_PER_REQUEST,
  sanitizeBlocks,
  splitContentIntoBlocks,
} from "@/lib/notion/notionBlocks";

const NOTION_API_BASE = "https://api.notion.com/v1";

/** POST blocks to an existing page in <=100-block batches. */
async function appendBlocks(pageId: string, token: string, blocks: any[]): Promise<void> {
  for (let i = 0; i < blocks.length; i += MAX_BLOCKS_PER_REQUEST) {
    const batch = blocks.slice(i, i + MAX_BLOCKS_PER_REQUEST);
    const res = await fetch(`${NOTION_API_BASE}/blocks/${pageId}/children`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ children: batch }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(
        `[Notion] Appending blocks ${i}-${i + batch.length} failed:`,
        JSON.stringify(err)
      );
      // Keep going — a partial page is better than none.
    }
  }
}

interface NotionPageResult {
  pageId: string;
  url: string;
  appended: number;
}

/** Create a page and append any blocks beyond the first 100. */
async function createPage(params: {
  token: string;
  parent: Record<string, any>;
  properties: Record<string, any>;
  children: any[];
}): Promise<NotionPageResult> {
  const { token, parent, properties, children } = params;
  const firstBatch = children.slice(0, MAX_BLOCKS_PER_REQUEST);

  const res = await fetch(`${NOTION_API_BASE}/pages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent,
      properties,
      ...(firstBatch.length ? { children: firstBatch } : {}),
    }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    const err: any = new Error("Notion page creation failed");
    err.details = error;
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const leftover = children.slice(MAX_BLOCKS_PER_REQUEST);
  if (leftover.length) {
    await appendBlocks(data.id, token, leftover);
  }

  return { pageId: data.id, url: data.url, appended: leftover.length };
}

/** Resolve the title/url/tags property names from a database schema. */
async function buildDatabaseProperties(
  token: string,
  databaseId: string,
  title: string,
  url?: string,
  tags: string[] = []
): Promise<Record<string, any>> {
  const dbRes = await fetch(`${NOTION_API_BASE}/databases/${databaseId}`, {
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION },
  });

  let titleProperty = "Name";
  let properties: Record<string, any> = {
    Name: { title: [{ text: { content: title } }] },
  };

  if (dbRes.ok) {
    const dbData = await dbRes.json();
    const dbProperties = (dbData.properties || {}) as Record<string, any>;

    for (const [propName, propData] of Object.entries(dbProperties)) {
      if ((propData as any).type === "title") {
        titleProperty = propName;
        break;
      }
    }

    properties = { [titleProperty]: { title: [{ text: { content: title } }] } };

    if (url) {
      const urlProp = Object.entries(dbProperties).find(
        ([, data]) => (data as any).type === "url"
      )?.[0];
      if (urlProp) properties[urlProp] = { url };
    }

    if (tags.length > 0) {
      const tagsProp = Object.entries(dbProperties).find(
        ([, data]) => (data as any).type === "multi_select" || (data as any).type === "select"
      )?.[0];
      if (tagsProp) {
        const propType = dbProperties[tagsProp].type;
        if (propType === "multi_select") {
          properties[tagsProp] = { multi_select: tags.map((tag) => ({ name: tag })) };
        } else if (propType === "select") {
          properties[tagsProp] = { select: { name: tags[0] } };
        }
      }
    }
  } else {
    console.warn("[Notion] Could not fetch database schema, using default property names");
  }

  return properties;
}

export async function POST(req: NextRequest) {
  try {
    const notionToken = process.env.NOTION_TOKEN;
    const notionDatabaseId = process.env.NOTION_DATABASE_ID;

    if (!notionToken) {
      return NextResponse.json(
        {
          error: "Notion token not configured",
          setup: {
            step1: "Go to https://www.notion.so/my-integrations",
            step2: "Click 'New integration'",
            step3: "Copy the 'Internal Integration Token'",
            step4: "Add to .env.local: NOTION_TOKEN=your_token",
            step5: "Create a database in Notion and share it with your integration",
            step6: "Copy database ID and add: NOTION_DATABASE_ID=your_database_id",
          },
        },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { title, url, content, tags = [], blocks: structuredBlocks } = body;

    if (!title) {
      return NextResponse.json({ error: "Title required" }, { status: 400 });
    }

    const sanitized = sanitizeBlocks(structuredBlocks || []);
    const children =
      sanitized.length > 0
        ? sanitized
        : content
        ? splitContentIntoBlocks(content)
        : [];

    // ── Database page ───────────────────────────────────────────────
    if (notionDatabaseId) {
      const properties = await buildDatabaseProperties(
        notionToken,
        notionDatabaseId,
        title,
        url,
        tags
      );

      try {
        const result = await createPage({
          token: notionToken,
          parent: { database_id: notionDatabaseId },
          properties,
          children,
        });
        return NextResponse.json({
          success: true,
          pageId: result.pageId,
          url: result.url,
          appended: result.appended,
          message: "Saved to Notion database",
        });
      } catch (structuredErr: any) {
        // Structured blocks were rejected. Retry with markdown paragraphs
        // so the report still lands in Notion.
        if (structuredBlocks?.length) {
          console.warn(
            "[Notion] Structured page failed, retrying with markdown fallback:",
            JSON.stringify(structuredErr?.details || structuredErr?.message)
          );
          const result = await createPage({
            token: notionToken,
            parent: { database_id: notionDatabaseId },
            properties,
            children: splitContentIntoBlocks(content || ""),
          });
          return NextResponse.json({
            success: true,
            pageId: result.pageId,
            url: result.url,
            appended: result.appended,
            message: "Saved to Notion database (markdown fallback)",
          });
        }
        return NextResponse.json(
          { error: "Notion API error", details: structuredErr?.details || String(structuredErr) },
          { status: structuredErr?.status || 500 }
        );
      }
    }

    // ── Standalone page (no database configured) ─────────────────────
    const parentPageId = process.env.NOTION_PARENT_PAGE_ID;
    if (!parentPageId) {
      return NextResponse.json(
        {
          error: "No Notion destination configured",
          setup: [
            "Set NOTION_DATABASE_ID (preferred) or NOTION_PARENT_PAGE_ID in .env.local",
            "Share the target page/database with your Notion integration",
          ],
        },
        { status: 400 }
      );
    }

    const pageChildren = [
      ...(url ? [{ object: "block", type: "bookmark", bookmark: { url } }] : []),
      ...children,
    ];

    try {
      const result = await createPage({
        token: notionToken,
        parent: { page_id: parentPageId },
        properties: { title: [{ text: { content: title } }] },
        children: pageChildren,
      });
      return NextResponse.json({
        success: true,
        pageId: result.pageId,
        url: result.url,
        appended: result.appended,
        message: "Saved to Notion",
      });
    } catch (structuredErr: any) {
      if (structuredBlocks?.length && content) {
        const result = await createPage({
          token: notionToken,
          parent: { page_id: parentPageId },
          properties: { title: [{ text: { content: title } }] },
          children: splitContentIntoBlocks(content),
        });
        return NextResponse.json({
          success: true,
          pageId: result.pageId,
          url: result.url,
          message: "Saved to Notion (markdown fallback)",
        });
      }
      return NextResponse.json(
        { error: "Notion API error", details: structuredErr?.details || String(structuredErr) },
        { status: structuredErr?.status || 500 }
      );
    }
  } catch (error) {
    console.error("Notion API error:", error);
    return NextResponse.json(
      { error: "Failed to save to Notion", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(_req: NextRequest) {
  return NextResponse.json({
    success: true,
    usage: {
      endpoint: "/api/notion/create-page",
      method: "POST",
      body: {
        title: "Article title",
        url: "https://example.com/article",
        content: "Optional notes",
        tags: ["work", "important"],
        blocks: "Optional pre-shaped Notion block array",
      },
    },
    setup: {
      step1: "Get token from https://www.notion.so/my-integrations",
      step2: "Add NOTION_TOKEN to .env.local",
      step3: "Create a database in Notion",
      step4: "Share database with your integration",
      step5: "Copy database ID from URL (the part after the last /)",
      step6: "Add NOTION_DATABASE_ID to .env.local",
    },
  });
}
