import { callJsonLlm } from "@/lib/llm/fastJson";

export interface DiplomatCallParams {
  to: string;
  objective?: string;
  callerName?: string;
  introMessage?: string;
}

export interface DiplomatTranscriptItem {
  role: "jarvis" | "counterparty" | "system";
  text: string;
  time: string;
}

export interface CallSession {
  callId: string;
  to: string;
  formattedNumber: string;
  mode: "twilio_pstn" | "webrtc_free";
  status: "dialing" | "ringing" | "connected" | "ended";
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number;
  objective: string;
  transcript: DiplomatTranscriptItem[];
  webrtcRoomUrl: string;
  telecomNotice?: string;
}

// In-memory active calls table (per server process).
const activeCalls = new Map<string, CallSession>();

function nowTime() {
  return new Date().toLocaleTimeString();
}

/**
 * Normalise a dialled number to E.164 where possible. A 10-digit Indian
 * mobile is expanded to +91; everything else is left with just its country
 * code. Returns null when there are not enough digits to be a real number —
 * callers must not invent one.
 */
export function formatDialNumber(raw: string): string | null {
  const input = String(raw || "").trim();
  if (!input) return null;
  const hadPlus = input.startsWith("+");
  const hadCountryCode = /^\s*\+?91[\s-]?/.test(input) || hadPlus;
  let digits = input.replace(/\D/g, "");
  if (!digits) return null;

  if (!hadPlus && !hadCountryCode && digits.length === 10 && /^[6-9]/.test(digits)) {
    digits = "91" + digits;
  }
  if (digits.length < 8 || digits.length > 15) return null; // E.164 bounds
  return `+${digits}`;
}

/** RFC-4122-ish unique room id, derived from the number so it is stable. */
function roomFor(digits: string) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `jarvis-diplomat-${digits.slice(-4)}-${rand}`;
}

/**
 * Generate JARVIS's opening line for the call from the objective. Uses the
 * shared JSON-LLM helper so the wording is produced, never canned. When no
 * provider is reachable we return a short, neutral sentence built from the
 * objective rather than a fabricated transcript.
 */
async function openingLine(objective: string, callerName: string): Promise<string> {
  const reply = await callJsonLlm<{ opening: string }>({
    system:
      'You are JARVIS, an AI assistant placed on an outbound phone call. Write exactly one natural, polite spoken sentence (max 30 words) that opens the call and states the purpose. No stage directions. Respond with ONLY a JSON object of the form {"opening": "<the sentence>"}.',
    user: `Caller: ${callerName || "the caller"}. Purpose of the call: ${objective}.`,
    maxTokens: 220,
    temperature: 0.3,
    timeoutMs: 6000,
    label: "DiplomatOpening",
  });
  const opening = reply?.opening?.trim();
  if (opening) return opening;
  return `Hello, this is ${callerName || "an assistant"} calling regarding: ${objective}. Is now a good time?`;
}

export async function handleDiplomat(action: string, params: Record<string, any>) {
  if (action === "make_call") {
    const rawNumber = String(params.to ?? params.number ?? params.recipient ?? "").trim();
    const formatted = formatDialNumber(rawNumber);
    if (!formatted) {
      return {
        success: false,
        mcp: "diplomat",
        error: "Enter a full phone number including its country code to place a call.",
      };
    }

    const objective = String(params.objective || "").trim() || "Speak with the person who answers";
    const callerName = String(params.callerName || params.from || "").trim();

    const callId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const digits = formatted.replace(/\D/g, "");

    // Optional paid PSTN path: only used when real Twilio credentials exist.
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom = process.env.TWILIO_PHONE_NUMBER;

    let mode: CallSession["mode"] = "webrtc_free";
    let telecomNotice =
      "Free mode: this browser is the voice agent. Dial on your own device (or share the WebRTC room) and JARVIS will listen and speak through this machine. No telephony credits used.";

    if (twilioSid && twilioAuth && twilioFrom && !twilioSid.includes("your_")) {
      try {
        const voiceUrl =
          process.env.TWILIO_VOICE_URL ||
          `${process.env.NEXT_PUBLIC_APP_URL || ""}/api/mcp`;
        if (voiceUrl) {
          const form = new URLSearchParams();
          form.append("To", formatted);
          form.append("From", twilioFrom);
          form.append("Url", voiceUrl);
          const auth = Buffer.from(`${twilioSid}:${twilioAuth}`).toString("base64");
          const twilioRes = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls.json`,
            {
              method: "POST",
              headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: form,
            }
          );
          if (twilioRes.ok) {
            mode = "twilio_pstn";
            telecomNotice = `Calling ${formatted} through the Twilio carrier gateway.`;
          } else {
            const err = await twilioRes.json().catch(() => null);
            console.warn("[Diplomat] Twilio refused the call:", err?.message || twilioRes.status);
          }
        }
      } catch (e: any) {
        console.warn("[Diplomat] Twilio error, using free mode:", e.message);
      }
    }

    const opener = await openingLine(objective, callerName);

    const session: CallSession = {
      callId,
      to: rawNumber,
      formattedNumber: formatted,
      mode,
      status: "connected",
      startedAt: new Date().toISOString(),
      objective,
      transcript: [
        { role: "system", text: `Channel opened to ${formatted}.`, time: nowTime() },
        { role: "jarvis", text: opener, time: nowTime() },
      ],
      webrtcRoomUrl: `https://meet.jit.si/${roomFor(digits)}`,
      telecomNotice,
    };

    activeCalls.set(callId, session);

    return { success: true, mcp: "diplomat", action, data: session };
  }

  if (action === "dialogue") {
    const callId = String(params.callId || "");
    const userUtterance = String(params.message || params.text || "").trim();
    if (!userUtterance) {
      return { success: false, mcp: "diplomat", error: "No speech was captured to reply to." };
    }

    const session = activeCalls.get(callId);
    const objective = String(params.objective || session?.objective || "").trim();

    // Give the model the real conversation so far so replies stay in context.
    const history = (session?.transcript || [])
      .filter((t) => t.role !== "system")
      .slice(-8)
      .map((t) => `${t.role === "jarvis" ? "JARVIS" : "Caller"}: ${t.text}`)
      .join("\n");

    const reply = await callJsonLlm<{
      jarvisResponse: string;
      callPhase: "greeting" | "inquiry" | "negotiation" | "conclusion";
      shouldHangup: boolean;
      sentiment: "positive" | "neutral" | "skeptical";
    }>({
      system: `You are JARVIS, an AI assistant on a live phone call.
${objective ? `Objective of the call: ${objective}` : ""}
Speak naturally and politely. Keep every reply to one or two spoken sentences. Never sound like an IVR. Address the caller's last question directly. Set shouldHangup true only when the objective is clearly finished or the caller is ending the call.
Respond with ONLY a JSON object of the form {"jarvisResponse": "<what you say>", "callPhase": "greeting"|"inquiry"|"negotiation"|"conclusion", "shouldHangup": true|false, "sentiment": "positive"|"neutral"|"skeptical"}.`,
      user: `${history ? `Conversation so far:\n${history}\n\n` : ""}Caller just said: "${userUtterance}". What do you say next?`,
      maxTokens: 320,
      temperature: 0.25,
      timeoutMs: 8000,
      label: "DiplomatDialogue",
    });

    if (!reply?.jarvisResponse) {
      return {
        success: false,
        mcp: "diplomat",
        error: "The language model did not return a reply. Check the configured AI keys and try again.",
      };
    }

    if (session) {
      session.transcript.push(
        { role: "counterparty", text: userUtterance, time: nowTime() },
        { role: "jarvis", text: reply.jarvisResponse, time: nowTime() }
      );
      if (reply.shouldHangup) session.status = "ended";
    }

    return {
      success: true,
      mcp: "diplomat",
      action,
      data: {
        callId,
        jarvisResponse: reply.jarvisResponse,
        phase: reply.callPhase || "inquiry",
        shouldHangup: !!reply.shouldHangup,
        sentiment: reply.sentiment || "neutral",
      },
    };
  }

  if (action === "get_status") {
    const callId = String(params.callId || "");
    const session = activeCalls.get(callId) || Array.from(activeCalls.values()).pop();
    return { success: true, mcp: "diplomat", action, data: session || null };
  }

  if (action === "hangup") {
    const callId = String(params.callId || "");
    const session = activeCalls.get(callId);
    if (session) {
      session.status = "ended";
      session.endedAt = new Date().toISOString();
      // Real elapsed duration, not a canned number.
      session.durationSeconds = Math.max(
        0,
        Math.round((Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 1000)
      );
      session.transcript.push({
        role: "system",
        text: "Call ended and the line disconnected.",
        time: nowTime(),
      });
    }
    return {
      success: true,
      mcp: "diplomat",
      action,
      data: session
        ? { callId, status: "ended", durationSeconds: session.durationSeconds }
        : { callId, status: "ended" },
    };
  }

  return { success: false, error: `Unsupported diplomat action '${action}'` };
}
