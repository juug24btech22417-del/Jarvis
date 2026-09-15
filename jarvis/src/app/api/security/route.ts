import { NextRequest, NextResponse } from "next/server";

function getAllowedChats(): number[] {
  const raw = process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? process.env.TELEGRAM_ALLOWED_CHAT_Ids ?? "";
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n !== 0);
}

// Security settings
interface SecuritySettings {
  enabled: boolean;
  strictMode: boolean;
  autoLockTimeout: number; // minutes
  stealthMode: boolean;    // #5: silent watcher — no visible UI reaction, still logs + alerts
  escalation: boolean;     // #3: Telegram → siren+TTS → lock ladder
}

interface AuthorizedFace {
  id: string;
  name: string;
  descriptor: number[];
  createdAt: string;
}

interface SecurityEvent {
  id: string;
  type: "access_granted" | "access_denied" | "system_enabled" | "system_disabled" | "face_registered" | "face_removed";
  timestamp: string;
  details: string;
  faceId?: string;
}

// In-memory storage (replace with database in production)
let securitySettings: SecuritySettings = {
  enabled: false,
  strictMode: false,
  autoLockTimeout: 5,
  stealthMode: false,
  escalation: true,
};

let authorizedFaces: AuthorizedFace[] = [];
let securityEvents: SecurityEvent[] = [];

// Log security event
function logEvent(
  type: SecurityEvent["type"],
  details: string,
  faceId?: string
) {
  const event: SecurityEvent = {
    id: `event-${Date.now()}`,
    type,
    timestamp: new Date().toISOString(),
    details,
    faceId,
  };
  securityEvents.unshift(event);

  // Keep only last 100 events
  if (securityEvents.length > 100) {
    securityEvents = securityEvents.slice(0, 100);
  }
}

// Calculate Euclidean distance between two face descriptors
function euclideanDistance(descriptor1: number[], descriptor2: number[]): number {
  if (descriptor1.length !== descriptor2.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < descriptor1.length; i++) {
    sum += Math.pow(descriptor1[i] - descriptor2[i], 2);
  }
  return Math.sqrt(sum);
}

// Find best matching face
function findMatchingFace(
  descriptor: number[],
  threshold: number = 0.6
): { face: AuthorizedFace; distance: number } | null {
  let bestMatch: { face: AuthorizedFace; distance: number } | null = null;

  for (const face of authorizedFaces) {
    const distance = euclideanDistance(descriptor, face.descriptor);
    if (distance < threshold) {
      if (!bestMatch || distance < bestMatch.distance) {
        bestMatch = { face, distance };
      }
    }
  }

  return bestMatch;
}

// GET - Get security settings and events
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");

    if (action === "settings") {
      return NextResponse.json({
        success: true,
        settings: securitySettings,
        authorizedFacesCount: authorizedFaces.length,
      });
    }

    if (action === "events") {
      const limit = parseInt(searchParams.get("limit") || "50");
      return NextResponse.json({
        success: true,
        events: securityEvents.slice(0, limit),
        totalEvents: securityEvents.length,
      });
    }

    if (action === "faces") {
      return NextResponse.json({
        success: true,
        faces: authorizedFaces.map((f) => ({
          id: f.id,
          name: f.name,
          createdAt: f.createdAt,
        })),
      });
    }

    // Default: return all info
    return NextResponse.json({
      success: true,
      settings: securitySettings,
      faces: authorizedFaces.map((f) => ({
        id: f.id,
        name: f.name,
        createdAt: f.createdAt,
      })),
      events: securityEvents.slice(0, 20),
      setupRequired: authorizedFaces.length === 0,
    });
  } catch (error) {
    console.error("Security GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch security data" },
      { status: 500 }
    );
  }
}

// POST - Security actions
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, data } = body;

    // Toggle system on/off
    if (action === "toggle") {
      const { enabled } = data;
      securitySettings.enabled = enabled;
      logEvent(
        enabled ? "system_enabled" : "system_disabled",
        `Face recognition security ${enabled ? "enabled" : "disabled"}`
      );
      return NextResponse.json({
        success: true,
        enabled: securitySettings.enabled,
        message: `Security system ${enabled ? "enabled" : "disabled"}`,
      });
    }

    // Update settings
    if (action === "settings") {
      const { strictMode, autoLockTimeout, stealthMode, escalation } = data;
      if (strictMode !== undefined) securitySettings.strictMode = strictMode;
      if (autoLockTimeout !== undefined)
        securitySettings.autoLockTimeout = autoLockTimeout;
      if (stealthMode !== undefined) securitySettings.stealthMode = stealthMode;
      if (escalation !== undefined) securitySettings.escalation = escalation;
      if (stealthMode !== undefined) {
        logEvent("system_enabled", `Stealth mode ${stealthMode ? "ARMED — silent watcher active" : "disarmed"}`);
      }
      return NextResponse.json({
        success: true,
        settings: securitySettings,
      });
    }

    // Register new face
    if (action === "register") {
      const { name, descriptor } = data;

      if (!name || !descriptor || !Array.isArray(descriptor)) {
        return NextResponse.json(
          { error: "Name and face descriptor required" },
          { status: 400 }
        );
      }

      // Check if face already exists
      const existing = findMatchingFace(descriptor, 0.4);
      if (existing) {
        return NextResponse.json(
          { error: "Face already registered", existingFace: existing.face },
          { status: 400 }
        );
      }

      const newFace: AuthorizedFace = {
        id: `face-${Date.now()}`,
        name,
        descriptor,
        createdAt: new Date().toISOString(),
      };

      authorizedFaces.push(newFace);
      logEvent("face_registered", `Registered face for ${name}`, newFace.id);

      return NextResponse.json({
        success: true,
        face: {
          id: newFace.id,
          name: newFace.name,
          createdAt: newFace.createdAt,
        },
        totalFaces: authorizedFaces.length,
      });
    }

    // Remove face
    if (action === "remove") {
      const { faceId } = data;
      const face = authorizedFaces.find((f) => f.id === faceId);

      if (!face) {
        return NextResponse.json({ error: "Face not found" }, { status: 404 });
      }

      authorizedFaces = authorizedFaces.filter((f) => f.id !== faceId);
      logEvent("face_removed", `Removed face for ${face.name}`, faceId);

      return NextResponse.json({
        success: true,
        removed: face.name,
        remainingFaces: authorizedFaces.length,
      });
    }

    // Verify face
    if (action === "verify") {
      if (!securitySettings.enabled) {
        return NextResponse.json({
          success: true,
          access: "granted",
          reason: "Security system is disabled",
          enabled: false,
        });
      }

      const { descriptor } = data;
      if (!descriptor || !Array.isArray(descriptor)) {
        return NextResponse.json(
          { error: "Face descriptor required" },
          { status: 400 }
        );
      }

      const threshold = securitySettings.strictMode ? 0.5 : 0.55;
      const match = findMatchingFace(descriptor, threshold);

      if (match) {
        logEvent(
          "access_granted",
          `Access granted to ${match.face.name}`,
          match.face.id
        );
        return NextResponse.json({
          success: true,
          access: "granted",
          person: match.face.name,
          confidence: 1 - match.distance,
          enabled: true,
        });
      }

      logEvent("access_denied", "Access denied - face not recognized");
      return NextResponse.json({
        success: true,
        access: "denied",
        reason: "Face not recognized",
        enabled: true,
      });
    }

    // Demo mode - add sample faces
    if (action === "demo") {
      // Add demo faces with random descriptors
      const demoNames = ["Boss", "Assistant"];
      for (const name of demoNames) {
        const demoDescriptor = Array.from({ length: 128 }, () =>
          Math.random() * 2 - 1
        );
        const demoFace: AuthorizedFace = {
          id: `demo-face-${name.toLowerCase()}-${Date.now()}`,
          name,
          descriptor: demoDescriptor,
          createdAt: new Date().toISOString(),
        };
        authorizedFaces.push(demoFace);
      }

      securitySettings.enabled = true;
      logEvent("system_enabled", "Security system enabled with demo faces");

      return NextResponse.json({
        success: true,
        message: "Demo mode activated with sample faces",
        faces: authorizedFaces.map((f) => ({ id: f.id, name: f.name })),
        enabled: true,
      });
    }

    // Telegram Threat Alert
    if (action === "alert") {
      const { imageData, message } = data;
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const allowedChats = getAllowedChats();
      const target = allowedChats[0];

      if (!token || !target) {
        console.error("[Security API] Telegram not configured or no allowed chat ID", { token: !!token, target });
        return NextResponse.json({ success: false, error: "Telegram bot not configured" });
      }

      try {
        const buttons = [
          [
            { text: "🔒 Lock Laptop", callback_data: "security:lock" },
            { text: "🔔 Trigger Alarm", callback_data: "security:alarm" },
          ],
          [
            { text: "✅ Dismiss", callback_data: "security:dismiss" }
          ]
        ];

        if (imageData) {
          const FormData = (await import("form-data")).default;
          const form = new FormData();
          form.append("chat_id", String(target));
          form.append("caption", message);
          form.append("reply_markup", JSON.stringify({ inline_keyboard: buttons }));

          // Convert base64 image data to buffer
          const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
          const buffer = Buffer.from(base64Data, "base64");
          
          form.append("photo", buffer, {
            filename: "security_alert.jpg",
            contentType: "image/jpeg",
          });

          // Send multipart post to Telegram API
          const response = await new Promise<any>((resolve, reject) => {
            form.submit(`https://api.telegram.org/bot${token}/sendPhoto`, (err, res) => {
              if (err) return reject(err);
              let body = "";
              res.on("data", (chunk) => body += chunk.toString("utf8"));
              res.on("end", () => {
                try {
                  resolve(JSON.parse(body));
                } catch (e) {
                  reject(e);
                }
              });
            });
          });

          if (response.ok) {
            logEvent("access_denied", `Telegram alert sent with snapshot: ${message}`);
            return NextResponse.json({ success: true, messageId: response.result.message_id });
          } else {
            console.error("[Security API] Telegram sendPhoto failed:", response);
            throw new Error(response.description || "Telegram API error");
          }
        } else {
          // Fallback to text message if no image is present
          const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: target,
              text: message,
              reply_markup: { inline_keyboard: buttons },
            }),
          });
          const resData = await response.json();
          if (resData.ok) {
            logEvent("access_denied", `Telegram alert sent: ${message}`);
            return NextResponse.json({ success: true, messageId: resData.result.message_id });
          } else {
            console.error("[Security API] Telegram sendMessage failed:", resData);
            throw new Error(resData.description || "Telegram API error");
          }
        }
      } catch (err: any) {
        console.error("[Security API] Alert sending failed:", err);
        return NextResponse.json({ success: false, error: err.message });
      }
    }

    // ESCALATION LADDER (#3) — progressive defense on intrusion.
    // level 1: Telegram alert (already sent by the panel) + TTS warning
    // level 2: siren on speakers + TTS "device monitored and photographed"
    // level 3: lock Windows (LockWorkStation via os bridge)
    if (action === "escalate") {
      const level = Math.min(3, Math.max(1, Number(data?.level ?? 1)));
      const { executeOsCommand } = await import("@/lib/telegram/osBridge");
      const steps: string[] = [];
      try {
        if (level >= 1) {
          // Spoken warning — intruder knows they're on camera (unless stealth).
          const warn = securitySettings.stealthMode
            ? null // stealth: stay silent, keep watching
            : "Warning. This device is monitored and photographed. Step away.";
          if (warn) {
            const tts = await executeOsCommand("speak", { text: warn });
            steps.push(tts.ok ? "tts-warning" : `tts-failed:${tts.error ?? "?"}`);
          }
        }
        if (level >= 2) {
          const siren = await executeOsCommand("siren");
          steps.push(siren.ok ? "siren" : `siren-failed:${siren.error ?? "?"}`);
        }
        if (level >= 3) {
          const lock = await executeOsCommand("lock");
          steps.push(lock.ok ? "locked" : `lock-failed:${lock.error ?? "?"}`);
        }
        logEvent("access_denied", `Escalation L${level} executed: ${steps.join(" → ")}`);
        return NextResponse.json({ success: true, level, steps, stealth: securitySettings.stealthMode });
      } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message, steps });
      }
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Security POST error:", error);
    return NextResponse.json(
      { error: "Failed to process security request" },
      { status: 500 }
    );
  }
}
