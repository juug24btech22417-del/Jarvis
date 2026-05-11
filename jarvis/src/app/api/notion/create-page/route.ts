import { NextRequest, NextResponse } from "next/server";

const NOTION_API_BASE = "https://api.notion.com/v1";

// Helper to split content into Notion-compatible blocks (max 2000 chars per block)
function splitContentIntoBlocks(content: string) {
  const MAX_CHARS = 2000;
  const blocks = [];
  const paragraphs = content.split(/\n\s*\n/);
  let currentBlock = "";

  for (const para of paragraphs) {
    if ((currentBlock + para).length <= MAX_CHARS) {
      currentBlock += (currentBlock ? "\n\n" : "") + para;
    } else {
      if (currentBlock) blocks.push(currentBlock);
      if (para.length > MAX_CHARS) {
        let start = 0;
        while (start < para.length) {
          blocks.push(para.substring(start, start + MAX_CHARS));
          start += MAX_CHARS;
        }
        currentBlock = "";
      } else {
        currentBlock = para;
      }
    }
  }
  if (currentBlock) blocks.push(currentBlock);
  return blocks.map(text => ({
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: [{ type: "text", text: { content: text } }] },
  }));
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
    const { title, url, content, tags = [] } = body;

    if (!title) {
      return NextResponse.json(
        { error: "Title required" },
        { status: 400 }
      );
    }

    // If database ID is set, create a database page
    if (notionDatabaseId) {
      // First, get the database schema to find the correct property names
      const dbResponse = await fetch(`${NOTION_API_BASE}/databases/${notionDatabaseId}`, {
        headers: {
          Authorization: `Bearer ${notionToken}`,
          "Notion-Version": "2022-06-28",
        },
      });

      let properties: Record<string, any> = {};
      let titleProperty = "Name"; // Default fallback

      if (dbResponse.ok) {
        const dbData = await dbResponse.json();
        const dbProperties = dbData.properties as Record<string, any>;

        // Find the title property (type: "title")
        for (const [propName, propData] of Object.entries(dbProperties)) {
          if ((propData as any).type === "title") {
            titleProperty = propName;
            break;
          }
        }

        console.log("[Notion] Database schema:", Object.keys(dbProperties));
        console.log("[Notion] Using title property:", titleProperty);

        // Build properties dynamically based on database schema
        properties = {
          [titleProperty]: {
            title: [
              {
                text: { content: title },
              },
            ],
          },
        };

        // Add URL if database has a URL property
        if (url) {
          const urlProp = Object.entries(dbProperties).find(
            ([_, data]) => (data as any).type === "url"
          )?.[0];
          if (urlProp) {
            properties[urlProp] = { url };
          }
        }

        // Add tags if database has a multi_select or select property
        if (tags.length > 0) {
          const tagsProp = Object.entries(dbProperties).find(
            ([_, data]) => (data as any).type === "multi_select" || (data as any).type === "select"
          )?.[0];
          if (tagsProp) {
            const propType = dbProperties[tagsProp].type;
            if (propType === "multi_select") {
              properties[tagsProp] = {
                multi_select: tags.map((tag: string) => ({ name: tag })),
              };
            } else if (propType === "select") {
              // For select, use only the first tag
              properties[tagsProp] = {
                select: { name: tags[0] },
              };
            }
          }
        }
      } else {
        // Fallback to default property names if we can't fetch schema
        console.warn("[Notion] Could not fetch database schema, using defaults");
        properties = {
          Name: {
            title: [
              {
                text: { content: title },
              },
            ],
          },
          ...(url && {
            URL: { url },
          }),
          ...(tags.length > 0 && {
            Tags: {
              multi_select: tags.map((tag: string) => ({ name: tag })),
            },
          }),
        };
      }

      const response = await fetch(`${NOTION_API_BASE}/pages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${notionToken}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parent: { database_id: notionDatabaseId },
          properties,
          ...(content && {
            children: splitContentIntoBlocks(content),
          }),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        return NextResponse.json(
          { error: "Notion API error", details: error },
          { status: 500 }
        );
      }

      const data = await response.json();
      return NextResponse.json({
        success: true,
        pageId: data.id,
        url: data.url,
        message: "Saved to Notion database",
      });
    }

    // Without database, create a simple page
    const response = await fetch(`${NOTION_API_BASE}/pages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { page_id: process.env.NOTION_PARENT_PAGE_ID },
        properties: {
          title: [
            {
              text: { content: title },
            },
          ],
        },
        children: [
          ...(url
            ? [
                {
                  object: "block",
                  type: "bookmark",
                  bookmark: { url },
                },
              ]
            : []),
          ...splitContentIntoBlocks(content || ""),
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { error: "Notion API error", details: error },
        { status: 500 }
      );
    }

    const data = await response.json();
    return NextResponse.json({
      success: true,
      pageId: data.id,
      url: data.url,
      message: "Saved to Notion",
    });
  } catch (error) {
    console.error("Notion API error:", error);
    return NextResponse.json(
      { error: "Failed to save to Notion", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
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
