/**
 * Normalising local file paths that arrive from a human.
 *
 * The MCP providers take paths straight from a UI text field or the API, and
 * people paste them in whatever shape their OS handed them. Windows Explorer's
 * "Copy as path" wraps the result in double quotes, browsers hand out `file://`
 * URLs, and every shell offers `~`. All three used to reach `fs.existsSync`
 * verbatim, so a file that plainly existed was reported as
 * `File does not exist: "C:\…\AML4.pdf"` — the quotes were being treated as
 * part of the filename. Normalise once, here, rather than in each provider.
 */

import os from "os";
import path from "path";

/**
 * Strip the decoration a paste can carry:
 * quotes (Explorer), `file://` (browsers, drag-and-drop), `~` (shells), and
 * surrounding whitespace/newlines. Returns the path as the filesystem expects
 * it, without resolving it against the current directory — callers that need an
 * absolute path should use `resolveLocalPath`.
 */
export function normalizeLocalPath(input: unknown): string {
  let value = String(input ?? "").trim();

  // Explorer's "Copy as path" wraps the path in double quotes. Strip repeated
  // layers because a quoted `file://` URL arrives as `"file:///C:/…"`.
  let previous = "";
  while (value !== previous) {
    previous = value;
    const wrapped =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")));
    if (wrapped) value = value.slice(1, -1).trim();
  }

  // A file:// URL (browser address bar, drag-and-drop onto the panel).
  if (/^file:\/\//i.test(value)) {
    try {
      value = decodeURIComponent(new URL(value).pathname);
    } catch {
      value = value.replace(/^file:\/\//i, "");
    }
    // file URLs put a leading slash in front of a Windows drive: /C:/Users → C:/Users
    if (/^\/[a-zA-Z]:/.test(value)) value = value.slice(1);
  }

  // A leading ~ only means "home" for a person, never for fs.existsSync.
  if (value === "~") value = os.homedir();
  else if (/^~[\\/]/.test(value)) value = path.join(os.homedir(), value.slice(2));

  return value;
}

/** Normalise and make absolute against the server's working directory. */
export function resolveLocalPath(input: unknown): string {
  const normalized = normalizeLocalPath(input);
  return normalized ? path.resolve(normalized) : "";
}

/**
 * Whether the raw input carried the decoration we just stripped. Used only to
 * explain an error better — "we removed the quotes and this still isn't there"
 * is a different message from "that file isn't there".
 */
export function hadPathDecoration(input: unknown): boolean {
  const raw = String(input ?? "").trim();
  return /^["']/.test(raw) || /^file:\/\//i.test(raw);
}
