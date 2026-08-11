// Boot-time replay. When the dev server comes up, it sweeps the queue
// for any "pending" inbound messages left over from while the laptop
// was asleep and dispatches them.

import {
  claimNextPendingInbound,
  markFailed,
} from "./queue";
import {
  setTypingAction,
  sendReply,
  sendVoiceNote,
  sendFile,
} from "./index";
import { dispatchFromQueueRow } from "./handleInbound";

export async function replayPendingOnBoot(token: string): Promise<number> {
  let processed = 0;
  // Cap so a flood of stale messages doesn't block the dev server.
  const maxBatch = 20;
  for (let i = 0; i < maxBatch; i++) {
    const row = await claimNextPendingInbound();
    if (!row) break;
    try {
      await dispatchFromQueueRow(row, {
        token,
        sendTyping: () => setTypingAction(token, row.chatId),
        sendReply: (text, opts) => sendReply(token, row.chatId, text, opts),
        sendVoice: (url, caption) =>
          sendVoiceNote(token, row.chatId, url, caption),
        sendFile: (url, caption) => sendFile(token, row.chatId, url, caption),
      });
      processed++;
    } catch (err: any) {
      console.error(
        `[telegram/replay] dispatch failed for row ${row.id}:`,
        err?.message || err
      );
      await markFailed(row.id, err?.message ?? "replay dispatch failed");
    }
  }
  if (processed > 0) {
    console.log(
      `[telegram/replay] processed ${processed} pending message(s) from queue`
    );
  }
  return processed;
}
