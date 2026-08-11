// Register the bot's slash-command menu with Telegram. Called once on
// boot from `ensurePollerStarted()`. Telegram replaces the existing
// menu on each call, so we can re-invoke safely.
//
// The menu is registered per-language; for v1 we only set the English
// (default) version. Adding language variants later is just a matter
// of repeating the call with a `language_code` field.

const TELEGRAM_API = "https://api.telegram.org/bot";

export const BOT_COMMANDS: Array<{ command: string; description: string }> = [
  { command: "start", description: "Hi from Jarvis" },
  { command: "help", description: "Show all commands" },
  { command: "whoami", description: "Show your chat_id" },

  { command: "brief", description: "Morning / evening briefing" },
  { command: "clip", description: "Send laptop clipboard" },
  { command: "whereami", description: "Last shared location" },

  { command: "remind", description: "Set a reminder (e.g. /remind in 5 min text)" },
  { command: "reminders", description: "List pending reminders" },
  { command: "cancel", description: "Cancel a reminder by id" },

  { command: "lock", description: "Lock the laptop" },
  { command: "sleep", description: "Sleep the laptop" },
  { command: "screenshot", description: "Take a screenshot" },
  { command: "wake", description: "Wake screen + chime" },
  { command: "shutdown", description: "Shut down (with confirm)" },
  { command: "restart", description: "Restart (with confirm)" },
  { command: "cancel_shutdown", description: "Abort a pending shutdown" },
  { command: "vol", description: "Volume: /vol 30 | up | down | mute" },
  { command: "open", description: "Open an app or URL" },
  { command: "kill", description: "Force-kill an app" },
  { command: "search", description: "Web search the default browser" },

  { command: "tasks", description: "List pending tasks" },
  { command: "task", description: "Add a task (/task title)" },
  { command: "done", description: "Mark a task done by id" },
];

export async function setMyCommands(token: string): Promise<void> {
  const res = await fetch(`${TELEGRAM_API}${token}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands: BOT_COMMANDS }),
  });
  const data = await res.json().catch(() => ({} as any));
  if (!data.ok) {
    throw new Error(data.description ?? "setMyCommands failed");
  }
}
