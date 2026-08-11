// Telegram sendVoice via multipart/form-data.
//
// Telegram's `sendVoice` endpoint accepts EITHER a public URL on the
// `voice` JSON field OR a multipart/form-data upload. We use the latter
// because the bot synthesizes audio to a local file (under JARVIS_TMP_DIR)
// and the URL form requires the file to be hosted somewhere reachable
// from Telegram's CDN.
//
// This module is split out from `index.ts` to keep the existing
// `sendVoiceNote` (JSON URL form) available for callers that DO have a
// hosted URL — and to avoid pulling in `form-data` + `fs` deps into
// the smaller client surface.

import FormData from "form-data";
import fs from "fs";

const TELEGRAM_API = "https://api.telegram.org/bot";

export async function sendVoiceNoteMultipart(
  token: string,
  chatId: number,
  filePath: string,
  caption?: string
): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  return new Promise((resolve) => {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("voice", fs.createReadStream(filePath), {
      contentType: "audio/mpeg",
      filename: "voice.mp3",
    });
    if (caption) form.append("caption", caption);

    form.submit(
      `${TELEGRAM_API}${token}/sendVoice`,
      (err, res) => {
        if (err) {
          console.error("[Telegram] sendVoiceNoteMultipart error:", err);
          resolve({ ok: false, error: err.message });
          return;
        }
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
        });
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            if (!data.ok) {
              console.error("[Telegram] sendVoiceNoteMultipart failed:", data);
              resolve({
                ok: false,
                error: data.description ?? "sendVoice failed",
              });
              return;
            }
            resolve({
              ok: true,
              messageId: data.result?.message_id,
            });
          } catch (parseErr: any) {
            resolve({
              ok: false,
              error: `unparseable response: ${parseErr?.message || parseErr}`,
            });
          }
        });
      }
    );
  });
}
