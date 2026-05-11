import { NextRequest, NextResponse } from "next/server";

// Gmail API configuration
const GMAIL_API = "https://www.googleapis.com/gmail/v1";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: {
    headers: { name: string; value: string }[];
    body?: { data?: string };
    parts?: { body: { data?: string }; mimeType: string }[];
  };
  internalDate: string;
}

// Token cache
let cachedToken: { access_token: string; expires_at: number } | null = null;

// Get access token using refresh token
async function getAccessToken(): Promise<string | null> {
  // Return cached token if still valid (with 5 minute buffer)
  if (cachedToken && cachedToken.expires_at > Date.now() + 5 * 60 * 1000) {
    return cachedToken.access_token;
  }

  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!refreshToken || !clientId || !clientSecret) {
    console.log("Gmail: Missing credentials");
    return null;
  }

  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Gmail token refresh failed:", error);
      return null;
    }

    const data = await response.json();

    cachedToken = {
      access_token: data.access_token,
      expires_at: Date.now() + (data.expires_in * 1000),
    };

    console.log("Gmail: Access token refreshed");
    return data.access_token;
  } catch (error) {
    console.error("Failed to refresh Gmail token:", error);
    return null;
  }
}

// Fetch unread emails from Gmail
async function fetchUnreadEmails(maxResults: number = 10): Promise<{ emails: any[]; authenticated: boolean; count: number }> {
  const token = await getAccessToken();

  if (!token) {
    return { emails: [], authenticated: false, count: 0 };
  }

  try {
    // Search for unread emails in inbox
    const searchResponse = await fetch(
      `${GMAIL_API}/users/me/messages?q=is:unread+in:inbox&maxResults=${maxResults}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );

    if (!searchResponse.ok) {
      if (searchResponse.status === 401) {
        cachedToken = null;
        return { emails: [], authenticated: false, count: 0 };
      }
      throw new Error(`Gmail API error: ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();
    const messages = searchData.messages || [];
    const totalUnread = searchData.resultSizeEstimate || messages.length;

    if (messages.length === 0) {
      return { emails: [], authenticated: true, count: 0 };
    }

    // Fetch details for each email
    const emails = await Promise.all(
      messages.slice(0, maxResults).map(async (msg: { id: string }) => {
        try {
          const detailResponse = await fetch(
            `${GMAIL_API}/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
              },
            }
          );

          if (!detailResponse.ok) return null;

          const message: GmailMessage = await detailResponse.json();

          const headers = message.payload.headers;
          const subject = headers.find((h) => h.name === "Subject")?.value || "No Subject";
          const from = headers.find((h) => h.name === "From")?.value || "Unknown";
          const date = headers.find((h) => h.name === "Date")?.value || "";

          // Extract sender name/email
          const senderMatch = from.match(/(?:(.+?)\s<)?(.+?)(?:>)?$/);
          const senderName = senderMatch?.[1] || from.split("<")[0].trim();
          const senderEmail = senderMatch?.[2] || from;

          // Check if urgent
          const isUrgent =
            subject.toLowerCase().includes("urgent") ||
            subject.toLowerCase().includes("asap") ||
            subject.toLowerCase().includes("important") ||
            subject.toLowerCase().includes("action required") ||
            message.labelIds?.includes("IMPORTANT");

          return {
            id: message.id,
            subject,
            senderName,
            senderEmail,
            snippet: message.snippet,
            date,
            isUrgent,
            link: `https://mail.google.com/mail/u/0/#inbox/${message.threadId}`,
          };
        } catch (error) {
          console.error("Failed to fetch email details:", error);
          return null;
        }
      })
    );

    return {
      emails: emails.filter(Boolean),
      authenticated: true,
      count: totalUnread,
    };
  } catch (error) {
    console.error("Failed to fetch emails:", error);
    return { emails: [], authenticated: false, count: 0 };
  }
}

// Generate AI summary of emails
async function generateBriefing(emails: any[], totalCount: number): Promise<string> {
  if (emails.length === 0) {
    return "You have no unread emails, Boss. Your inbox is clear.";
  }

  const urgentCount = emails.filter((e) => e.isUrgent).length;
  const senderList = Array.from(new Set(emails.map((e) => e.senderName)));

  let briefing = `You have ${totalCount} unread email${totalCount !== 1 ? "s" : ""}`;

  if (urgentCount > 0) {
    briefing += `, ${urgentCount} marked as urgent`;
  }

  briefing += ". ";

  // List senders
  if (senderList.length <= 3) {
    briefing += `From ${senderList.join(", ")}. `;
  } else {
    briefing += `From ${senderList.slice(0, 3).join(", ")} and ${senderList.length - 3} others. `;
  }

  // List email subjects
  briefing += "Latest emails: ";
  const subjectList = emails.slice(0, 5).map((e) => `"${e.subject}"`);
  briefing += subjectList.join("; ");

  if (emails.length > 5) {
    briefing += `; and ${emails.length - 5} more.`;
  }

  return briefing;
}

// Demo emails for testing
function getDemoEmails(): any[] {
  return [
    {
      id: "demo-1",
      subject: "Project deadline moved to Friday",
      senderName: "Project Manager",
      senderEmail: "pm@company.com",
      snippet: "Hi team, due to some delays we need to push the deadline to this Friday...",
      date: new Date().toISOString(),
      isUrgent: true,
      link: "https://mail.google.com",
    },
    {
      id: "demo-2",
      subject: "Weekly newsletter: Tech updates",
      senderName: "Tech Weekly",
      senderEmail: "newsletter@techweekly.com",
      snippet: "This week in tech: AI breakthroughs, new gadgets, and more...",
      date: new Date(Date.now() - 86400000).toISOString(),
      isUrgent: false,
      link: "https://mail.google.com",
    },
    {
      id: "demo-3",
      subject: "Invoice #1234 - Action Required",
      senderName: "Billing Department",
      senderEmail: "billing@service.com",
      snippet: "Your invoice is ready. Please review and complete payment...",
      date: new Date(Date.now() - 172800000).toISOString(),
      isUrgent: true,
      link: "https://mail.google.com",
    },
  ];
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const maxResults = parseInt(searchParams.get("maxResults") || "10", 10);
    const summary = searchParams.get("summary") === "true";

    const { emails, authenticated, count } = await fetchUnreadEmails(maxResults);

    // Use demo mode if not authenticated
    const useEmails = authenticated ? emails : getDemoEmails();
    const useCount = authenticated ? count : useEmails.length;

    // Generate summary if requested
    let briefing = "";
    if (summary) {
      briefing = await generateBriefing(useEmails, useCount);
    }

    return NextResponse.json({
      success: true,
      count: useCount,
      urgentCount: useEmails.filter((e) => e.isUrgent).length,
      emails: useEmails,
      briefing,
      demo: !authenticated,
      setupInstructions: authenticated ? undefined : [
        "1. Go to https://console.cloud.google.com/apis/credentials",
        "2. Enable Gmail API",
        "3. Add Gmail scopes (https://www.googleapis.com/auth/gmail.readonly)",
        "4. Re-authorize with Gmail permissions",
      ],
    });
  } catch (error) {
    console.error("Gmail briefing API error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch Gmail briefing",
        details: String(error),
      },
      { status: 500 }
    );
  }
}
