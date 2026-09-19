// Code Forge — shared utilities for detecting runnable web code in JARVIS
// replies and routing it into the CodePanel instead of raw chat text.

export interface ExtractedCode {
  language: string;
  code: string;
  /** Raw content with the code block(s) removed — what chat should render. */
  remainder: string;
}

const FENCE_RE = /```([a-zA-Z0-9_+-]*)\r?\n([\s\S]*?)```/g;

/** Languages the sandboxed runner can actually execute. */
export function isRunnableLanguage(lang: string): boolean {
  const l = lang.toLowerCase();
  return l === "html" || l === "css" || l === "javascript" || l === "js";
}

function normalizeLanguage(raw: string, code: string): string {
  const l = (raw || "").toLowerCase().trim();
  if (["html", "htm", "xhtml"].includes(l)) return "html";
  if (["css"].includes(l)) return "css";
  if (["js", "javascript", "node", "nodejs"].includes(l)) return "javascript";
  if (["ts", "typescript"].includes(l)) return "typescript";
  if (["py", "python"].includes(l)) return "python";
  if (l) return l;
  // No fence tag — sniff the content.
  const head = code.slice(0, 400).toLowerCase();
  if (head.includes("<!doctype html") || head.includes("<html")) return "html";
  if (head.includes("<style") || head.includes("{") && head.includes(":") && head.includes("}")) return "css";
  if (/\b(function|const|let|var|=>|document\.|console\.)\b/.test(head)) return "javascript";
  return "text";
}

/**
 * Pull fenced code blocks out of an LLM reply.
 * Returns null when nothing code-like is present.
 */
export function extractCodeBlocks(reply: string): ExtractedCode[] | null {
  FENCE_RE.lastIndex = 0;
  const blocks: ExtractedCode[] = [];
  let match: RegExpExecArray | null;
  while ((match = FENCE_RE.exec(reply)) !== null) {
    const rawLang = match[1];
    const code = match[2].replace(/\r\n/g, "\n").replace(/\s+$/, "");
    if (!code.trim()) continue;
    blocks.push({ language: normalizeLanguage(rawLang, code), code, remainder: "" });
  }
  if (blocks.length === 0) return null;
  // remainder = reply with every fenced block removed
  FENCE_RE.lastIndex = 0;
  const remainder = reply.replace(FENCE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  return blocks.map((b) => ({ ...b, remainder }));
}

/**
 * Pick the block most worth sending to the panel: prefer runnable web code,
 * then the largest block. HTML gets priority because it self-contains its
 * own CSS/JS when the model follows the single-file instruction.
 */
export function pickPrimaryBlock(blocks: ExtractedCode[]): ExtractedCode {
  const runnable = blocks.filter((b) => isRunnableLanguage(b.language));
  if (runnable.length > 0) {
    const html = runnable.find((b) => b.language === "html");
    if (html) return html;
    return runnable.reduce((a, b) => (b.code.length > a.code.length ? b : a));
  }
  return blocks.reduce((a, b) => (b.code.length > a.code.length ? b : a));
}

/** Wrap a JS/CSS snippet in a minimal HTML shell so the iframe can run it. */
export function wrapInHtmlShell(code: string, language: string): string {
  if (language === "html") return code;
  if (language === "css") {
    return `<!DOCTYPE html>\n<html>\n<head>\n<style>\n${code}\n</style>\n</head>\n<body>\n<h1>Code Forge · CSS Preview</h1>\n<p>Edit assumptions live in the panel — this shell just hosts your stylesheet.</p>\n</body>\n</html>`;
  }
  return `<!DOCTYPE html>\n<html>\n<body>\n<script>\ntry {\n${code}\n} catch (e) { console.error(e && e.message ? e.message : String(e)); }\n</script>\n</body>\n</html>`;
}
