import { NextRequest, NextResponse } from "next/server";

interface IFTTTWebhookPayload {
  value1?: string;
  value2?: string;
  value3?: string;
}

async function triggerIFTTT(
  event: string,
  key: string,
  payload: IFTTTWebhookPayload
): Promise<{ success: boolean; message: string }> {
  const url = `https://maker.ifttt.com/trigger/${event}/with/key/${key}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (response.status === 200) {
    return { success: true, message: "IFTTT webhook triggered successfully" };
  } else {
    const text = await response.text();
    return { success: false, message: `IFTTT error: ${response.status} - ${text}` };
  }
}

// Predefined applets mapping
const APPLETS: Record<
  string,
  { event: string; description: string; requiredValues: string[] }
> = {
  save_to_notion: {
    event: "save_article",
    description: "Save article to Notion database",
    requiredValues: ["value1"], // URL or content
  },
  add_todoist_task: {
    event: "add_task",
    description: "Add task to Todoist",
    requiredValues: ["value1"], // Task name
  },
  send_email: {
    event: "send_email",
    description: "Send email notification",
    requiredValues: ["value1", "value2"], // Subject, Body
  },
  log_to_sheets: {
    event: "log_data",
    description: "Log data to Google Sheets",
    requiredValues: ["value1"],
  },
  send_notification: {
    event: "notify",
    description: "Send phone notification",
    requiredValues: ["value1"],
  },
  tweet: {
    event: "post_tweet",
    description: "Post to Twitter",
    requiredValues: ["value1"],
  },
  create_calendar_event: {
    event: "calendar_event",
    description: "Create Google Calendar event",
    requiredValues: ["value1", "value2"], // Title, Date
  },
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { applet, event, key, values = {} } = body;

    const webhookKey = key || process.env.IFTTT_WEBHOOK_KEY;

    if (!webhookKey) {
      return NextResponse.json(
        {
          error: "IFTTT webhook key required",
          setup: {
            instructions: [
              "1. Go to https://ifttt.com/maker_webhooks",
              "2. Click 'Documentation'",
              "3. Copy your key (shown in the URL)",
              "4. Add to .env.local: IFTTT_WEBHOOK_KEY=your_key",
            ],
          },
        },
        { status: 400 }
      );
    }

    // Handle predefined applets
    if (applet) {
      const appletConfig = APPLETS[applet];
      if (!appletConfig) {
        return NextResponse.json(
          {
            error: "Unknown applet",
            availableApplets: Object.keys(APPLETS),
          },
          { status: 400 }
        );
      }

      // Validate required values
      for (const val of appletConfig.requiredValues) {
        if (!values[val]) {
          return NextResponse.json(
            {
              error: `Missing required value: ${val}`,
              description: appletConfig.description,
              requiredValues: appletConfig.requiredValues,
            },
            { status: 400 }
          );
        }
      }

      const result = await triggerIFTTT(appletConfig.event, webhookKey, values);
      return NextResponse.json({
        success: result.success,
        applet,
        event: appletConfig.event,
        message: result.message,
      });
    }

    // Handle custom events
    if (!event) {
      return NextResponse.json(
        { error: "Either 'applet' or 'event' required" },
        { status: 400 }
      );
    }

    const result = await triggerIFTTT(event, webhookKey, values);
    return NextResponse.json({
      success: result.success,
      event,
      values,
      message: result.message,
    });
  } catch (error) {
    console.error("IFTTT error:", error);
    return NextResponse.json(
      { error: "IFTTT webhook failed", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return NextResponse.json({
    success: true,
    setup: {
      step1: "Go to https://ifttt.com/create to make a new applet",
      step2: "For trigger, search 'Webhooks' and select 'Receive a web request'",
      step3: "Enter an event name (e.g., 'save_article')",
      step4: "For action, choose your service (Notion, Todoist, Email, etc.)",
      step5: "Get your key from https://ifttt.com/maker_webhooks",
      step6: "Add IFTTT_WEBHOOK_KEY to your .env.local",
    },
    usage: {
      method: "POST",
      endpoint: "/api/ifttt",
      examples: [
        {
          name: "Save to Notion",
          body: {
            applet: "save_to_notion",
            values: { value1: "https://example.com/article" },
          },
        },
        {
          name: "Add Todoist task",
          body: {
            applet: "add_todoist_task",
            values: { value1: "Read this article" },
          },
        },
        {
          name: "Custom event",
          body: {
            event: "my_custom_event",
            values: { value1: "data1", value2: "data2" },
          },
        },
      ],
    },
    predefinedApplets: APPLETS,
    customEvent: {
      note: "Use any event name you've created in IFTTT",
      urlFormat: "https://maker.ifttt.com/trigger/{event}/with/key/{key}",
    },
  });
}
