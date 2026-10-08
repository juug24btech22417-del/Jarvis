// Clipboard detection tests.
//
// The OS watcher shows action buttons based on this classifier, so a wrong
// guess means the user gets "Fix / Optimize" for a shopping list. These tests
// pin the real shapes people actually copy, plus the guarantees that matter:
// every kind offers buttons, the local "open" action never calls a model, and
// "apply on screen" is only offered where the output replaces the snippet.
//
// Run with:  npx tsx tests/clipboardDetect.test.ts

import {
  detectClip,
  detectLanguage,
  findAction,
  KIND_ACTIONS,
  KIND_META,
  buildOffer,
  type ClipKind,
} from "../src/lib/agent/clipboardDetect";
import { runClipAction } from "../src/lib/agent/clipboardActions";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    console.error(`  \u2717 ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

const kindOf = (s: string, hint?: ClipKind) => detectClip(s, { hint }).kind;

// ─────────────────────────────────────────────────────────────────────────
section("Links: video / repository / plain website");

check(
  "youtube watch url",
  kindOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ") === "youtube"
);
check("youtu.be short url", kindOf("https://youtu.be/kJQP7kiw5Fk") === "youtube");
check(
  "youtube shorts url",
  kindOf("https://youtube.com/shorts/abc123") === "youtube"
);
check(
  "github repo url",
  kindOf("https://github.com/vercel/next.js") === "github"
);
check(
  "github url with trailing path stays github",
  kindOf("https://github.com/microsoft/TypeScript/blob/main/README.md") === "github"
);
check("plain website url", kindOf("https://react.dev/reference/react") === "url");
check("short url with a query", kindOf("https://news.ycombinator.com/item?id=42") === "url");
check(
  "a sentence that merely contains a link is not a website clip",
  kindOf("Read this when you get a chance https://example.com/post thanks") !== "url"
);

// ─────────────────────────────────────────────────────────────────────────
section("Errors");

check(
  "python traceback",
  kindOf(
    'Traceback (most recent call last):\n  File "app.py", line 12, in <module>\n    main()\nValueError: invalid literal for int()'
  ) === "error"
);
check(
  "node stack trace",
  kindOf(
    "TypeError: Cannot read properties of undefined (reading 'map')\n    at renderList (/app/src/list.jsx:42:11)\n    at Object.<anonymous> (/app/src/index.js:7:3)"
  ) === "error"
);
check(
  "npm failure log",
  kindOf("npm ERR! code ELIFECYCLE\nnpm ERR! errno 1\nnpm ERR! Exit status 1") === "error"
);
check(
  "go panic",
  kindOf("panic: runtime error: index out of range [5] with length 3") === "error"
);
check(
  "java exception",
  kindOf("Exception in thread \"main\" java.lang.NullPointerException: null\n\tat Main.run(Main.java:14)") ===
    "error"
);

// ─────────────────────────────────────────────────────────────────────────
section("Code (and the language we report)");

const pythonSnippet = `def total(items):
    result = 0
    for item in items:
        result += item.price
    return result`;

const tsSnippet = `export function total(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}`;

const sqlQuery = `SELECT u.id, u.email, COUNT(o.id) AS orders
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.created_at > '2026-01-01'
GROUP BY u.id
ORDER BY orders DESC;`;

check("python snippet", kindOf(pythonSnippet) === "code", kindOf(pythonSnippet));
check("python language detected", detectLanguage(pythonSnippet) === "python");
check("typescript snippet", kindOf(tsSnippet) === "code", kindOf(tsSnippet));
check("typescript language detected", detectLanguage(tsSnippet) === "ts");
check(
  "html snippet",
  kindOf('<div class="row"><span>hello</span></div>') === "code"
);
check(
  "fenced markdown code block",
  kindOf("```js\nconst a = 1;\n```") === "code"
);
check("sql query, not code", kindOf(sqlQuery) === "sql", kindOf(sqlQuery));
check("sql language", detectLanguage(sqlQuery) === "sql");
check(
  "a code file that merely contains SQL is still code",
  kindOf('const q = `SELECT * FROM users WHERE id = $1`;\nawait db.query(q, [id]);\nexport default q;') ===
    "code"
);

// ─────────────────────────────────────────────────────────────────────────
section("JSON / commands / equations / questions / messages");

check("minified json", kindOf('{"name":"jarvis","tags":["ai","os"]}') === "json");
check("json array", kindOf('[{"id":1},{"id":2}]') === "json");
check(
  "broken json is not json",
  kindOf('{"name": "jarvis", "tags": ["ai",') !== "json"
);
check("shell command", kindOf("npm run build && git push origin main") === "cli");
check("dollar-prefixed command", kindOf("$ docker compose up -d") === "cli");
check("powershell cmdlet", kindOf("Get-Process -Name chrome | Stop-Process") === "cli");
check("kubectl command", kindOf("kubectl get pods -n production") === "cli");
check("linear equation", kindOf("2x + 3 = 11") === "math");
check("quadratic", kindOf("x^2 - 5x + 6 = 0") === "math");
check(
  "question ending in a mark",
  kindOf("What is backpropagation and why does it work?") === "question"
);
check(
  "instruction-shaped question",
  kindOf("write a regex that matches indian phone numbers") === "question"
);
check("how-to phrasing", kindOf("how do I reverse a list in python") === "question");
check(
  "email with headers",
  kindOf("Subject: Invoice 4021\nFrom: billing@acme.com\n\nHi Arjun, please find the invoice attached.") ===
    "message"
);
check(
  "casual message with a sign-off",
  kindOf("Hey, are we still on for the review tomorrow at 4? Let me know.\n\nThanks,\nPriya") ===
    "message"
);

// ─────────────────────────────────────────────────────────────────────────
section("Long content and plain text");

const article = Array.from(
  { length: 24 },
  (_, i) =>
    `Paragraph ${i + 1}: mixing expert judgement with a large amount of context is where real research value comes from.`
).join("\n");
check("long article", kindOf(article) === "article", kindOf(article));
check(
  "short plain phrase",
  kindOf("groceries: milk, eggs, bread") === "text",
  kindOf("groceries: milk, eggs, bread")
);
check("empty clip is text with low confidence", detectClip("").kind === "text");

// ─────────────────────────────────────────────────────────────────────────
section("Image hint (the watcher knows when the clipboard held a bitmap)");

const imageClip = buildOffer("", "Snipping Tool", "image");
check("image kind", imageClip.kind === "image");
check("image label", imageClip.label === "Image detected");
check(
  "image actions",
  imageClip.actions.map((a) => a.label).join("|") === "Analyze|Extract text|Explain",
  imageClip.actions.map((a) => a.label).join("|")
);

// ─────────────────────────────────────────────────────────────────────────
section("Action catalog integrity");

const expected: Record<ClipKind, string> = {
  question: "Answer|Explain simply|Exam answer|Research",
  code: "Fix|Explain|Optimize|Test",
  error: "Diagnose|Fix|Explain",
  url: "Open|Summarize|Research|Extract information",
  youtube: "Open|Summarize|Key points",
  github: "Open|Analyze|Explain",
  article: "Summarize|Explain|Ask questions",
  message: "Reply|Improve|Make professional|Summarize",
  sql: "Explain|Debug|Optimize",
  image: "Analyze|Extract text|Explain",
  json: "Explain|Format|Convert",
  cli: "Explain|Safety check|Fix",
  math: "Solve|Explain|Visualize",
  text: "Explain|Summarize|Answer",
};

for (const kind of Object.keys(expected) as ClipKind[]) {
  const got = KIND_ACTIONS[kind].map((a) => a.label).join("|");
  check(`${kind} buttons`, got === expected[kind], got);
}

check(
  "every kind is reachable and labelled",
  (Object.keys(KIND_ACTIONS) as ClipKind[]).every(
    (k) => KIND_META[k]?.label?.endsWith("detected") && KIND_ACTIONS[k].length > 0
  )
);
check("no emoji in any button label", !Object.values(KIND_ACTIONS).flat().some((a) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(a.label)));
check("no emoji in any kind label", !Object.values(KIND_META).some((m) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(m.label)));
check("findAction resolves an id", findAction("explain_simple")?.label === "Explain simply");
check("findAction ignores unknown ids", findAction("nope") === undefined);
check(
  "only fix / optimize / format may be applied over the snippet",
  Array.from(new Set(Object.values(KIND_ACTIONS).flat().filter((a) => a.applies).map((a) => a.id)))
    .sort()
    .join("|") === "fix|format|optimize"
);
check(
  "only Open is handled locally",
  Array.from(new Set(Object.values(KIND_ACTIONS).flat().filter((a) => a.local).map((a) => a.id))).join("|") ===
    "open"
);

// ─────────────────────────────────────────────────────────────────────────
section("Offer payload shape (what the OS card renders)");

const offer = buildOffer("  const x = 1;  ", "Code.exe", undefined);
check("offer trims whitespace in the preview", offer.preview === "const x = 1;");
check("offer reports the source", offer.source === "Code.exe");
check("offer carries signals", offer.signals.length > 0);
check("offer confidence is a probability", offer.confidence > 0 && offer.confidence <= 1);

const longOffer = buildOffer("x".repeat(1000));
check("offer preview is bounded", longOffer.preview.length <= 300, `${longOffer.preview.length}`);

// ─────────────────────────────────────────────────────────────────────────
// The two zero-cost actions are the ones we can test without a network:
// they must never reach a provider and must produce a usable result.
(async () => {
  section("Zero-cost actions never touch a model");

  const formatted = await runClipAction({
    text: '{"a":1,"b":[1,2,3]}',
    actionId: "format",
    kind: "json",
  });
  check("format pretty-prints json", formatted.code === '{\n  "a": 1,\n  "b": [\n    1,\n    2,\n    3\n  ]\n}', formatted.code);
  check("format is applicable on screen", formatted.applies === true);
  check("format keeps the json language", formatted.language === "json");

  const opened = await runClipAction({
    text: "see https://github.com/vercel/next.js for details",
    actionId: "open",
    kind: "github",
  });
  check("open extracts the link", opened.url === "https://github.com/vercel/next.js", opened.url);
  check("open is not applicable", opened.applies === false);

  const noLink = await runClipAction({ text: "nothing here", actionId: "open", kind: "url" });
  check("open with no link says so instead of guessing", noLink.url === "" && noLink.answer.length > 0);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
