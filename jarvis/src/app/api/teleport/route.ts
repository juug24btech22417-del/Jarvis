import { NextRequest, NextResponse } from "next/server";
import { getLanIP, getAllLanIPs } from "@/lib/net/lanIp";

export interface TeleportPayload {
  id: string;
  type: "text" | "url" | "note" | "code" | "clipboard" | "image";
  title: string;
  content: string;
  language?: string;
  createdAt: number;
  expiresAt: number;
  source: "pc" | "phone";
}

// In-memory persistent cache across server reloads
const g = globalThis as unknown as {
  __jarvisTeleportStore?: Map<string, TeleportPayload>;
  __jarvisTeleportInbox?: TeleportPayload[];
  __jarvisActiveBeamId?: string;
  __jarvisPhonePingActive?: number;
};

if (!g.__jarvisTeleportStore) {
  g.__jarvisTeleportStore = new Map<string, TeleportPayload>();
}
if (!g.__jarvisTeleportInbox) {
  g.__jarvisTeleportInbox = [];
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const wantInbox = searchParams.get("inbox");
  const wantPing = searchParams.get("pingCheck");
  const lanIp = getLanIP();
  const allIps = getAllLanIPs();

  if (wantPing) {
    const isPinged = (Date.now() - (g.__jarvisPhonePingActive || 0)) < 15000;
    return NextResponse.json({
      success: true,
      phonePingActive: isPinged,
    });
  }

  if (wantInbox) {
    return NextResponse.json({
      success: true,
      inbox: (g.__jarvisTeleportInbox || []).slice(-20).reverse(),
      lanIp,
      allIps,
    });
  }

  const targetId = id || g.__jarvisActiveBeamId;
  if (!targetId || !g.__jarvisTeleportStore?.has(targetId)) {
    // Return sample starter beam if empty
    const defaultPayload: TeleportPayload = {
      id: "welcome",
      type: "text",
      title: "J.A.R.V.I.S. Teleporter Online",
      content: "Connected to Stark Core. Point camera to beam files, clipboard, and notes seamlessly.",
      createdAt: Date.now(),
      expiresAt: Date.now() + 86400000,
      source: "pc",
    };
    return NextResponse.json({
      success: true,
      payload: defaultPayload,
      activeId: "welcome",
      lanIp,
      allIps,
      mobileUrl: `http://${lanIp}:3000/teleport?id=welcome`,
    });
  }

  const payload = g.__jarvisTeleportStore.get(targetId);
  return NextResponse.json({
    success: true,
    payload,
    activeId: targetId,
    lanIp,
    allIps,
    mobileUrl: `http://${lanIp}:3000/teleport?id=${targetId}`,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, type = "text", title = "Beamed Content", content, language, id: customId, command } = body;

    if (action === "ping-phone") {
      g.__jarvisPhonePingActive = Date.now();
      return NextResponse.json({
        success: true,
        message: "Sonar ping sent to phone beacon",
      });
    }

    if (action === "command") {
      const { exec } = require("child_process");
      if (command === "lock") {
        exec("rundll32.exe user32.dll,LockWorkStation");
        return NextResponse.json({ success: true, message: "Workstation locked" });
      }
      if (command === "playpause") {
        exec('powershell -c "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys([char]179)"');
        return NextResponse.json({ success: true, message: "Media toggled" });
      }
      if (command === "volumeup") {
        exec('powershell -c "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys([char]175)"');
        return NextResponse.json({ success: true, message: "Volume increased" });
      }
      if (command === "volumedown") {
        exec('powershell -c "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys([char]174)"');
        return NextResponse.json({ success: true, message: "Volume decreased" });
      }
      if (command === "mute") {
        exec('powershell -c "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys([char]173)"');
        return NextResponse.json({ success: true, message: "Mute toggled" });
      }
      return NextResponse.json({ success: true, message: `Executed command: ${command}` });
    }

    if (action === "clear-inbox") {
      g.__jarvisTeleportInbox = [];
      return NextResponse.json({ success: true, message: "Inbox cleared" });
    }

    if (!content && action !== "clear-inbox" && action !== "command") {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    const id = customId || `beam-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const now = Date.now();
    const payload: TeleportPayload = {
      id,
      type,
      title,
      content: content || "",
      language,
      createdAt: now,
      expiresAt: now + 3600000 * 4, // 4 hours
      source: action === "receive-from-phone" ? "phone" : "pc",
    };

    g.__jarvisTeleportStore?.set(id, payload);

    let aiReply: string | null = null;

    if (action === "receive-from-phone" || action === "chat") {
      g.__jarvisTeleportInbox?.push(payload);

      // Generate AI response from JARVIS using Gemini or Groq
      const geminiKey = process.env.GEMINI_API_KEY;
      const groqKey = process.env.GROQ_API_KEY;

      if (geminiKey && content && content.trim()) {
        const candidateModels = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-flash-latest"];
        for (const model of candidateModels) {
          try {
            const sys = "You are J.A.R.V.I.S., the ultra-advanced, witty, and loyal AI assistant created by Tony Stark. Boss is communicating with you remotely from their smartphone quantum relay. Reply naturally in 1 to 2 punchy, helpful sentences, addressing the user as Boss. If they ask to control something, confirm execution.";
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [
                  { role: "user", parts: [{ text: `${sys}\n\nBoss says: "${content}"` }] },
                ],
                generationConfig: { temperature: 0.7, maxOutputTokens: 200 },
              }),
              signal: AbortSignal.timeout(6000),
            });

            if (r.ok) {
              const data = await r.json();
              const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) {
                aiReply = text.trim();
                break;
              }
            }
          } catch (e) {
            console.warn(`[Teleport] Model ${model} failed, trying next...`);
          }
        }
      }

      // Fallback to Groq if Gemini had an issue
      if (!aiReply && groqKey && content && content.trim()) {
        try {
          const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${groqKey}`,
            },
            body: JSON.stringify({
              model: "llama-3.3-70b-versatile",
              messages: [
                {
                  role: "system",
                  content: "You are J.A.R.V.I.S., Tony Stark's witty AI. Answer Boss in 1-2 punchy sentences.",
                },
                { role: "user", content },
              ],
              max_tokens: 150,
            }),
            signal: AbortSignal.timeout(5000),
          });
          if (r.ok) {
            const data = await r.json();
            aiReply = data?.choices?.[0]?.message?.content?.trim();
          }
        } catch {}
      }

      if (!aiReply) {
        aiReply = `Direct transmission received and logged to Stark mainframe, Boss. Systems running at optimal efficiency.`;
      }

      // Store JARVIS response in inbox too
      g.__jarvisTeleportInbox?.push({
        id: `reply-${Date.now()}`,
        type: "text",
        title: "JARVIS Reply",
        content: aiReply,
        createdAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        source: "pc",
      });
    } else {
      g.__jarvisActiveBeamId = id;
    }

    const lanIp = getLanIP();
    const mobileUrl = `http://${lanIp}:3000/teleport?id=${id}`;

    return NextResponse.json({
      success: true,
      id,
      payload,
      reply: aiReply,
      lanIp,
      mobileUrl,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to process teleport payload", details: String(error) },
      { status: 500 }
    );
  }
}
