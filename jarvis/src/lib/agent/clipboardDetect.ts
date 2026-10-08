// Clipboard content detection — the "what did I just copy?" brain.
//
// Runs BEFORE any model call, costs nothing, and answers within a
// millisecond: is this a question, code, an error, a URL, a video, a
// repository, an article, a message, SQL, JSON, a shell command, an equation
// or plain text? The OS watcher uses this to show the right action buttons
// the instant something is copied, so the user never pays for a model call
// just to find out what they copied.
//
// Everything here is pure and dependency-free on purpose: the PowerShell
// watcher mirrors the same decisions through GET /api/clipboard/capture
// (the catalog), and the unit tests drive the heuristics directly.

export type ClipKind =
  | "question"
  | "code"
  | "error"
  | "url"
  | "youtube"
  | "github"
  | "article"
  | "message"
  | "sql"
  | "image"
  | "json"
  | "cli"
  | "math"
  | "text";

/** One button on the detection card. */
export interface ClipAction {
  /** Stable id sent back to /api/clipboard/capture as `action: "act", id`. */
  id: string;
  /** Human label rendered on the button ("Fix", "Explain simply", …). */
  label: string;
  /** True = handled on the client (open a URL). No model call, ever. */
  local?: boolean;
  /** True = the result is code that can be applied over the copied text. */
  applies?: boolean;
}

export interface ClipDetection {
  kind: ClipKind;
  /** Card headline, e.g. "Code detected". */
  label: string;
  /** Short noun for prompts and the in-app pill: "code", "question". */
  noun: string;
  /** Best-effort source language for code / SQL / CLI snippets. */
  language: string;
  /** 0..1 — how sure the classifier is. */
  confidence: number;
  /** Which heuristics fired, for debugging and the UI tooltip. */
  signals: string[];
  /** Buttons to show, in order. */
  actions: ClipAction[];
}

/** Every kind we can recognise, with its card label and prompt noun. */
export const KIND_META: Record<ClipKind, { label: string; noun: string }> = {
  question: { label: "Question detected", noun: "question" },
  code: { label: "Code detected", noun: "code" },
  error: { label: "Error detected", noun: "error" },
  url: { label: "Website detected", noun: "web page" },
  youtube: { label: "Video detected", noun: "video" },
  github: { label: "Repository detected", noun: "repository" },
  article: { label: "Content detected", noun: "content" },
  message: { label: "Message detected", noun: "message" },
  sql: { label: "SQL detected", noun: "SQL query" },
  image: { label: "Image detected", noun: "image" },
  json: { label: "Structured data detected", noun: "structured data" },
  cli: { label: "Command detected", noun: "command" },
  math: { label: "Equation detected", noun: "equation" },
  text: { label: "Text detected", noun: "text" },
};

// ── Action catalog ────────────────────────────────────────────────────────
// These are the buttons each kind offers. `applies` marks the actions whose
// output is code that can be written straight back over the copied text.
const A = {
  answer: { id: "answer", label: "Answer" },
  explainSimple: { id: "explain_simple", label: "Explain simply" },
  exam: { id: "exam_answer", label: "Exam answer" },
  research: { id: "research", label: "Research" },
  fix: { id: "fix", label: "Fix", applies: true },
  explain: { id: "explain", label: "Explain" },
  optimize: { id: "optimize", label: "Optimize", applies: true },
  test: { id: "test", label: "Test" },
  diagnose: { id: "diagnose", label: "Diagnose" },
  open: { id: "open", label: "Open", local: true },
  summarize: { id: "summarize", label: "Summarize" },
  extract: { id: "extract", label: "Extract information" },
  keypoints: { id: "keypoints", label: "Key points" },
  analyze: { id: "analyze", label: "Analyze" },
  questions: { id: "questions", label: "Ask questions" },
  reply: { id: "reply", label: "Reply" },
  improve: { id: "improve", label: "Improve" },
  professional: { id: "professional", label: "Make professional" },
  debug: { id: "debug", label: "Debug" },
  extractText: { id: "extract_text", label: "Extract text" },
  format: { id: "format", label: "Format", applies: true },
  convert: { id: "convert", label: "Convert" },
  safety: { id: "safety", label: "Safety check" },
  solve: { id: "solve", label: "Solve" },
  visualize: { id: "visualize", label: "Visualize" },
} as const satisfies Record<string, ClipAction>;

export const KIND_ACTIONS: Record<ClipKind, ClipAction[]> = {
  question: [A.answer, A.explainSimple, A.exam, A.research],
  code: [A.fix, A.explain, A.optimize, A.test],
  error: [A.diagnose, A.fix, A.explain],
  url: [A.open, A.summarize, A.research, A.extract],
  youtube: [A.open, A.summarize, A.keypoints],
  github: [A.open, A.analyze, A.explain],
  article: [A.summarize, A.explain, A.questions],
  message: [A.reply, A.improve, A.professional, A.summarize],
  sql: [A.explain, A.debug, A.optimize],
  image: [A.analyze, A.extractText, A.explain],
  json: [A.explain, A.format, A.convert],
  cli: [A.explain, A.safety, A.fix],
  math: [A.solve, A.explain, A.visualize],
  text: [A.explain, A.summarize, A.answer],
};

/** Look up one action definition by id (any kind). */
export function findAction(id: string): ClipAction | undefined {
  const wanted = String(id || "").trim().toLowerCase();
  if (!wanted) return undefined;
  for (const kind of Object.keys(KIND_ACTIONS) as ClipKind[]) {
    const hit = KIND_ACTIONS[kind].find((a) => a.id === wanted);
    if (hit) return hit;
  }
  return undefined;
}

// ── Heuristics ────────────────────────────────────────────────────────────

const YOUTUBE_RE = /(?:^|[/.])(?:youtube\.com\/(?:watch|shorts|embed|live)|youtu\.be\/)/i;
const GITHUB_RE = /(?:^|\/\/)github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+|(?:^|\/\/)gist\.github\.com\//i;
const URL_TOKEN_RE = /^(?:https?:\/\/|www\.)[^\s<>"']+$/i;
const BARE_DOMAIN_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[^\s]*$/i;

const STRONG_ERROR_SIGNALS: Array<[RegExp, string]> = [
  [/Traceback \(most recent call last\)/i, "python traceback"],
  [/^\s+at\s+[\w$.<>\[\]"' ]+\s*\(?[^)\n]*:\d+:\d+\)?/m, "js stack frame"],
  [/\bpanic:\s/, "go panic"],
  [/npm ERR!/i, "npm error"],
  [/Unhandled (?:Rejection|Exception)/i, "unhandled rejection"],
  [/Segmentation fault/i, "segfault"],
  [/^\s*File "[^"]+", line \d+/m, "python frame"],
  [/\b(?:Syntax|Type|Reference|Value|Key|Index|NullPointer|Runtime|URI|Range)Error\b[:\s]/, "named exception"],
  [/\bServlet\.service\(\)|Exception in thread "/, "java stack"],
];

const WEAK_ERROR_SIGNALS: Array<[RegExp, string]> = [
  [/\bE(?:NOENT|ACCES|CONNREFUSED|ADDRINUSE|NOTFOUND|PERM)\b/, "errno"],
  [/^\s*at\s+\S+/m, "stack line"],
  [/\bCaused by:/, "caused by"],
  [/\b(?:ERROR|FATAL)\b[:\s]/, "log level"],
  [/\b\d{3,4}-\d\d-\d\d[T ][\d:.]+Z?\s+(?:ERROR|FATAL)/, "timestamped log"],
  [/exit(?:ed)? (?:with )?(?:code|status) [1-9]/, "non-zero exit"],
];

const CODE_SIGNALS: Array<[RegExp, number, string]> = [
  [/```/, 3, "markdown fence"],
  [/^\s*(?:def|class)\s+\w+.*:\s*$/m, 3, "python def/class"],
  [/^\s*(?:from\s+[\w.]+\s+import|import\s+[\w.]+)/m, 2, "import"],
  [/\bfunction\s*\w*\s*\(|=>\s*[{(]|\b(?:const|let|var)\s+\w+\s*=/, 2, "js/ts binding"],
  [/\bexport\s+(?:default\s+)?(?:function|class|const|async)/, 2, "es module export"],
  [/#include\s*<|int\s+main\s*\(/, 3, "c/cpp entry"],
  [/\bpublic\s+(?:static\s+)?(?:class|void|int|String)|System\.out\.println/, 3, "java/c#"],
  [/<\/?[a-z][\w-]*(?:\s[^>]*)?>/i, 2, "html tag"],
  [/<[a-z][\w-]*\b[^>]*>[^<]{1,120}<\/[a-z][\w-]*>/i, 3, "html element"],
  [/\b(?:await|async)\b/, 1, "async"],
  [/\.[a-z_]\w*\s*\(/i, 1, "method call"],
  [/\b(?:console\.log|println!?\(|printf\(|System\.out|print\()/, 2, "print call"],
  [/\bself\.|\)\s*->\s*\{|::\w+\s*\(/, 1, "oop body"],
  [/^\s*[})\]];\s*$/m, 1, "closing brace"],
  [/;\s*$/m, 1, "statement semicolon"],
  [/^\s{2,}\S.*$/m, 1, "indented block"],
];

const SQL_KEYWORDS =
  /\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|MERGE|WITH|EXPLAIN|GRANT|REVOKE)\b/i;
const SQL_DETAIL =
  /\b(?:FROM|WHERE|JOIN|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|VALUES|SET|INTO|PRIMARY\s+KEY|FOREIGN\s+KEY|INDEX|TABLE|VIEW)\b/i;

const CLI_COMMANDS =
  /^(?:sudo\s+)?(?:npm|npx|pnpm|yarn|node|deno|bun|python|python3|pip|pip3|uv|poetry|git|gh|docker|docker-compose|kubectl|helm|terraform|ansible|aws|gcloud|az|brew|apt|apt-get|yum|dnf|pacman|choco|winget|scoop|systemctl|service|journalctl|curl|wget|ssh|scp|rsync|tar|zip|unzip|chmod|chown|mkdir|rm|cp|mv|cat|grep|sed|awk|find|xargs|make|cmake|mvn|gradle|dotnet|cargo|rustc|go|composer|php|ruby|gem|mysql|psql|redis-cli|mongosh|sqlite3|powershell|pwsh|cmd|netsh|ipconfig|tasklist|taskkill|reg|sc)\b/i;

const POWERSHELL_CMDLET = /^(?:Get|Set|New|Remove|Start|Stop|Restart|Test|Invoke|Import|Export|Select|Where|ForEach|Write|Read|Add|Clear|Copy|Move|ConvertTo|ConvertFrom)-[A-Z][A-Za-z]+\b/;

const MATH_TOKEN_RE = /(?:sqrt|sin|cos|tan|log|ln|lim|sum|integral|derivative|factorial)/i;
const QUESTION_STARTERS =
  /^(?:what|why|how|when|where|which|who|whom|whose|can|could|should|would|will|do|does|did|is|are|am|was|were|has|have|had|explain|define|tell me|give me|help me|write|create|generate|summari[sz]e|translate|convert|fix|debug|solve|calculate|compare|list)\b/i;
const INSTRUCTION_STARTERS =
  /^(?:write|create|generate|make|build|draft|rewrite|summari[sz]e|translate|convert|explain|refactor|review|debug|fix|optimi[sz]e|design|plan|draft)\b/i;
const GREETING_RE = /^(?:hi|hey|hello|dear|good\s+(?:morning|afternoon|evening)|yo)\b[\s,]/i;
const SIGN_OFF_RE = /\b(?:regards|best regards|kind regards|thanks|thank you|cheers|sincerely|best)\s*[,!.]?\s*$/im;
const EMAIL_HEADER_RE = /^(?:From|To|Cc|Bcc|Subject|Sent|Date|Reply-To):\s*\S+/im;

function sentenceCount(text: string): number {
  const hits = text.match(/[.!?](\s|$)/g);
  return hits ? hits.length : 0;
}

/** Best-effort language for a code / SQL / CLI snippet. */
export function detectLanguage(text: string): string {
  const t = text;
  if (/^\s*[[{]/.test(t) && /"\s*:/.test(t)) return "json";
  if (/<!doctype html|<html[\s>]|<\/div>/i.test(t)) return "html";
  if (/^\s*[.#]?[\w-]+\s*\{[^}]*:\s*[^;}]+;/m.test(t) && !/[({]\s*$/.test(t)) return "css";
  if (SQL_KEYWORDS.test(t) && SQL_DETAIL.test(t)) return "sql";
  if (/#include\s*<|std::|int\s+main\s*\(/.test(t)) return "cpp";
  if (/\bpublic\s+(?:static\s+)?(?:class|void|int|String)|System\.out\.println|\bpackage\s+[\w.]+;/.test(t)) return "java";
  if (/\busing\s+System;|\bnamespace\s+[\w.]+|\bConsole\.WriteLine/.test(t)) return "csharp";
  if (/\bfunc\s+\w+\s*\(|\bpackage\s+main\b|:=/.test(t)) return "go";
  if (/\bfn\s+\w+\s*\(|\blet\s+mut\b|println!\(/.test(t)) return "rust";
  if (/^\s*def\s+\w+\s*\(|^\s*class\s+\w+.*:\s*$|^\s*(?:from\s+[\w.]+\s+)?import\s+[\w.]+/m.test(t)) return "python";
  if (/\bvar\s+\w+\s*=|\$\w+\s*=|\becho\s|^\s*#!\//m.test(t)) return "bash";
  if (/:\s*(?:string|number|boolean|any|void)\b|\binterface\s+\w+\s*\{|<\w+>\s*\(/.test(t)) return "ts";
  if (/\b(?:const|let|var)\s+\w+\s*=|=>|function\s*\w*\s*\(|require\(|module\.exports/.test(t)) return "js";
  if (/\b(?:puts|attr_accessor|def\s+\w+$)/m.test(t)) return "ruby";
  if (/<\?php|\$\w+\s*=\s*['"]/.test(t)) return "php";
  if (/\bSELECT\b|\bFROM\b/i.test(t)) return "sql";
  return "";
}

export interface DetectOptions {
  /** Force a kind (the OS watcher knows when the clipboard held an image). */
  hint?: ClipKind;
  /** Foreground app title, used as a weak tie-breaker. */
  source?: string;
}

/**
 * Classify a copied snippet. Deterministic, synchronous, no network.
 */
export function detectClip(rawText: string, opts: DetectOptions = {}): ClipDetection {
  const text = (rawText ?? "").replace(/\r\n/g, "\n").trim();
  const signals: string[] = [];

  const finish = (
    kind: ClipKind,
    confidence: number,
    language = ""
  ): ClipDetection => ({
    kind,
    label: KIND_META[kind].label,
    noun: KIND_META[kind].noun,
    language,
    confidence,
    signals,
    actions: KIND_ACTIONS[kind],
  });

  if (opts.hint) {
    signals.push(`hint:${opts.hint}`);
    return finish(opts.hint, 1, opts.hint === "sql" ? "sql" : "");
  }
  if (!text) {
    signals.push("empty");
    return finish("text", 0.2);
  }

  const lines = text.split("\n");
  const words = text.split(/\s+/).filter(Boolean);

  // ── Links (unambiguous enough to win outright) ──
  const hasUrl = URL_TOKEN_RE.test(words[0] ?? "") || /https?:\/\/\S+/.test(text);
  if (YOUTUBE_RE.test(text)) {
    signals.push("youtube url");
    return finish("youtube", 0.98);
  }
  if (GITHUB_RE.test(text)) {
    signals.push("github url");
    return finish("github", 0.95);
  }
  if (
    hasUrl &&
    words.length <= 2 &&
    (URL_TOKEN_RE.test(words[0] ?? "") || BARE_DOMAIN_RE.test(words[0] ?? ""))
  ) {
    signals.push("url only");
    return finish("url", 0.95);
  }

  // ── JSON (parses, so it is not a guess) ──
  const first = text[0];
  if ((first === "{" || first === "[") && text.length < 20000) {
    try {
      JSON.parse(text);
      signals.push("valid json");
      return finish("json", 0.96, "json");
    } catch {
      // not JSON — keep going
    }
  }

  // ── Errors: strong markers win, weak ones need company ──
  const strongErrors = STRONG_ERROR_SIGNALS.filter(([re]) => re.test(text));
  const weakErrors = WEAK_ERROR_SIGNALS.filter(([re]) => re.test(text));
  strongErrors.slice(0, 3).forEach(([, s]) => signals.push(`error:${s}`));
  weakErrors.slice(0, 3).forEach(([, s]) => signals.push(`error?:${s}`));
  if (strongErrors.length >= 1 || weakErrors.length >= 2) {
    const conf = strongErrors.length >= 2 ? 0.95 : strongErrors.length ? 0.9 : 0.72;
    return finish("error", conf, "");
  }

  // ── Code score ──
  let codeScore = 0;
  for (const [re, weight, name] of CODE_SIGNALS) {
    if (re.test(text)) {
      codeScore += weight;
      if (signals.length < 8) signals.push(`code:${name}`);
    }
  }

  // ── SQL vs code ──
  // A query must START with a SQL keyword: prose that merely contains "with"
  // and "from" ("...with a lot of context ...comes from...") is not SQL, and
  // a JS file that embeds a query is still code.
  const sqlHead = text
    .replace(/^\s*(?:(?:--|\/\/)[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/, "")
    .trim();
  const firstKeyword = (sqlHead.match(/[A-Za-z_]+/)?.[0] ?? "").toUpperCase();
  const startsWithSql = SQL_KEYWORDS.test(firstKeyword);
  const sqlScore =
    (startsWithSql ? 6 : 0) + (SQL_DETAIL.test(text) ? 2 : 0) + (SQL_KEYWORDS.test(text) ? 1 : 0);
  if (startsWithSql && sqlScore >= 6 && codeScore < 4) {
    signals.push(`sql starts with ${firstKeyword}`);
    return finish("sql", 0.88, "sql");
  }

  if (codeScore >= 4) {
    signals.push(`code score ${codeScore}`);
    return finish("code", Math.min(0.95, 0.6 + codeScore / 20), detectLanguage(text));
  }

  // ── Shell / CLI command ──
  const firstLine = (lines[0] ?? "").trim();
  const stripped = firstLine.replace(/^[$>]\s*/, "");
  if (
    lines.length <= 3 &&
    (CLI_COMMANDS.test(stripped) || POWERSHELL_CMDLET.test(stripped) || /^[$>]\s+\S/.test(firstLine))
  ) {
    signals.push("cli prefix");
    return finish("cli", 0.85, "bash");
  }

  // ── Math ──
  const compact = text.replace(/\s+/g, "");
  const mathChars = compact.replace(/[\d+\-*/^=().,%xX√π∑∫!<>[\]{}|\\]/g, "");
  const looksMath =
    text.length <= 200 &&
    (/=/.test(compact) || MATH_TOKEN_RE.test(text)) &&
    mathChars.length <= compact.length * 0.25 &&
    /\d/.test(compact);
  if (looksMath) {
    signals.push("equation shape");
    return finish("math", 0.78, "");
  }

  // ── Question ──
  const questionish =
    /\?\s*$/.test(text) ||
    QUESTION_STARTERS.test(text) ||
    INSTRUCTION_STARTERS.test(text) ||
    /\bwhat(?:'s| is)\b/i.test(text);
  if (questionish && text.length <= 1500 && !GREETING_RE.test(text)) {
    signals.push(/\?\s*$/.test(text) ? "ends with ?" : "interrogative opener");
    return finish("question", 0.8, "");
  }

  // ── Message / email ──
  const messageish =
    GREETING_RE.test(text) ||
    EMAIL_HEADER_RE.test(text) ||
    (SIGN_OFF_RE.test(text) && text.length < 3000) ||
    (lines.length <= 8 && text.length < 700 && /^(?:please|thanks|thank you|can you|could you)\b/i.test(text));
  if (messageish) {
    signals.push("conversational shape");
    return finish("message", 0.74, "");
  }

  // ── Long-form content ──
  if (text.length >= 600 && sentenceCount(text) >= 4 && words.length >= 90) {
    signals.push("long prose", `${sentenceCount(text)} sentences`);
    return finish("article", 0.7, "");
  }

  if (text.length >= 200 && sentenceCount(text) >= 2) {
    signals.push("prose");
    return finish("article", 0.55, "");
  }

  signals.push("no strong shape");
  return finish("text", 0.4, "");
}

/** The card shown by the OS watcher before anything is sent to a model. */
export interface ClipOffer extends ClipDetection {
  preview: string;
  source: string;
  chars: number;
}

/** Build the offer payload the OS watcher renders (safe to ship over HTTP). */
export function buildOffer(
  text: string,
  source = "",
  hint?: ClipKind
): ClipOffer {
  const detection = detectClip(text, { hint, source });
  const oneLine = text.replace(/\s+/g, " ").trim();
  return {
    ...detection,
    preview: oneLine.length > 300 ? `${oneLine.slice(0, 297)}...` : oneLine,
    source,
    chars: text.trim().length,
  };
}
