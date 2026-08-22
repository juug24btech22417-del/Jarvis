// Clipboard watcher — polls the laptop's clipboard every 2s and
// updates a globalThis-pinned string. The bot's `/clip` command reads
// from this snapshot.
//
// Implementation uses PowerShell's `Get-Clipboard` because Node has no
// first-class clipboard API on Windows. We use async execFile to avoid
// blocking the event loop — each poll runs entirely in the background.

import { execFile } from "child_process";

const CLIPBOARD_KEY = Symbol.for("jarvis.telegram.clipboardWatcher");
type GlobalWithWatcher = typeof globalThis & {
  [CLIPBOARD_KEY]?: { started: boolean; lastText: string | null; lastErrorAt: number };
};

const POLL_INTERVAL_MS = 2000;

function readClipboardWindowsAsync(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell",
      ["-NoProfile", "-Command", "Get-Clipboard -Raw"],
      { encoding: "utf8", timeout: 2000 },
      (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve((stdout as string).replace(/\r?\n$/, ""));
        }
      }
    );
  });
}

export function getLastClipboard(): string | null {
  const g = globalThis as GlobalWithWatcher;
  return g[CLIPBOARD_KEY]?.lastText ?? null;
}

export function startClipboardWatcher(): void {
  const g = globalThis as GlobalWithWatcher;
  if (g[CLIPBOARD_KEY]?.started) return;
  g[CLIPBOARD_KEY] = { started: true, lastText: null, lastErrorAt: 0 };

  const tick = async () => {
    try {
      const text = await readClipboardWindowsAsync();
      g[CLIPBOARD_KEY]!.lastText = text;
    } catch (err: any) {
      // Throttle error logging so a broken PowerShell doesn't flood logs.
      const now = Date.now();
      const last = g[CLIPBOARD_KEY]?.lastErrorAt ?? 0;
      if (now - last > 60_000) {
        console.warn(
          `[telegram/clipboard] Get-Clipboard failed: ${err?.message || err}`
        );
        g[CLIPBOARD_KEY]!.lastErrorAt = now;
      }
    }
  };

  // Run first read immediately so /clip works within 2s of boot.
  tick();
  setInterval(tick, POLL_INTERVAL_MS);
}
