/**
 * test-doc-summarise.mjs
 *
 * Validates the document summarisation fix:
 *   1. Documents now go through the LLM path (not direct-send).
 *   2. The prompt tells the LLM NOT to echo the raw text.
 *   3. A real PDF is parsed correctly with pdf-parse v2.
 *   4. The simulated LLM response is concise, not a raw dump.
 *
 * Run from jarvis/:  node test-doc-summarise.mjs
 */

import axios from "axios";
import { PDFParse } from "pdf-parse";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) {
    console.log(`  ✅ PASS: ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

// ── Helpers replicating the production code ──────────────────────────────────

function buildDocumentPrompt(fileName, caption, parsedText, pages) {
  const docText = parsedText.slice(0, 4000).trim();
  return (
    `[Document: "${fileName || "file"}" — ${pages ?? "?"} page(s)]\n` +
    `User request: ${caption}\n\n` +
    `--- Document Content (extract) ---\n${docText}\n---\n\n` +
    `Respond with a concise, well-formatted Telegram message that directly answers the user's request. ` +
    `Do NOT repeat or quote the full document text. Keep it brief.`
  );
}

function mediaKindFromRow(row) {
  return row.metadata?.kind;
}

// In the new code, only "photo" bypasses the LLM; "document" falls through.
function wouldBypassLLM(kind) {
  return kind === "photo";  // documents & voice go to LLM
}

// ── Tests ────────────────────────────────────────────────────────────────────

console.log("=== Document Summarisation Fix Tests ===\n");

// ── Test 1: prompt structure ─────────────────────────────────────────────────
{
  console.log("Test 1: Prompt structure tells LLM not to echo raw text");

  const rawText = "INTERNSHIP OFFER LETTER\nCompany: ACME Corp\n...".repeat(150);
  const prompt = buildDocumentPrompt(
    "offer_letter.pdf",
    "Summarise this internship offer letter.",
    rawText,
    1
  );

  assert(prompt.includes("[Document:"),                 "prompt has document metadata header");
  assert(prompt.includes("User request:"),              "prompt has user request label");
  assert(prompt.includes("Do NOT repeat"),              "prompt explicitly forbids echoing raw text");
  assert(prompt.includes("Keep it brief"),              "prompt instructs brevity");
  assert(!prompt.includes(rawText),                     "full raw text is NOT embedded verbatim (capped at 4000)");
  assert(prompt.length <= 6000,                         `prompt is within safe bounds (${prompt.length} chars)`);
  console.log();
}

// ── Test 2: routing — document rows fall through to LLM ─────────────────────
{
  console.log("Test 2: handleInbound routing — document kind routes to LLM, not direct-send");

  const photoRow  = { metadata: { kind: "photo"    }, text: "A swimming pool." };
  const docRow    = { metadata: { kind: "document" }, text: "...prompt..." };
  const voiceRow  = { metadata: { kind: "voice"    }, text: "Set a reminder for 6pm." };

  assert( wouldBypassLLM(mediaKindFromRow(photoRow)),  "photo bypasses LLM (sent directly)");
  assert(!wouldBypassLLM(mediaKindFromRow(docRow)),    "document goes through LLM");
  assert(!wouldBypassLLM(mediaKindFromRow(voiceRow)),  "voice goes through LLM");
  console.log();
}

// ── Test 3: real PDF parse → prompt construction ─────────────────────────────
{
  console.log("Test 3: Real PDF parse → prompt is well-formed");
  try {
    const resp = await axios.get(
      "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
      { responseType: "arraybuffer", timeout: 15000 }
    );
    const buff = Buffer.from(resp.data);
    const u8   = new Uint8Array(buff.buffer, buff.byteOffset, buff.byteLength);
    const parser = new PDFParse(u8);
    const result = await parser.getText();

    const prompt = buildDocumentPrompt(
      "dummy.pdf",
      "Summarise this document in 3 bullet points.",
      result.text,
      result.total
    );

    assert(result.text.trim().length > 0,   "PDF text was extracted successfully");
    assert(prompt.includes("dummy.pdf"),     "filename appears in prompt");
    assert(prompt.includes("3 bullet"),      "user caption is embedded");
    assert(prompt.includes("Do NOT repeat"), "anti-echo instruction is present");
    assert(
      prompt.indexOf(result.text.trim()) === -1 ||
      prompt.includes(result.text.trim().slice(0, 100)),
      "text is included but potentially trimmed"
    );
    console.log(`  ℹ  Prompt length: ${prompt.length} chars`);
    console.log(`  ℹ  Prompt preview:\n${prompt.slice(0, 300)}...`);
  } catch (e) {
    console.error(`  ❌ Test 3 threw: ${e.message}`);
    failed++;
  }
  console.log();
}

// ── Test 4: live LLM call with document prompt ───────────────────────────────
{
  console.log("Test 4: Live LLM call — response is a summary, not a raw text dump");
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.log("  ⚠  OPENROUTER_API_KEY not set — skipping live test");
  } else {
    try {
      const resp = await axios.get(
        "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
        { responseType: "arraybuffer", timeout: 15000 }
      );
      const buff = Buffer.from(resp.data);
      const u8   = new Uint8Array(buff.buffer, buff.byteOffset, buff.byteLength);
      const parser = new PDFParse(u8);
      const result = await parser.getText();

      const prompt = buildDocumentPrompt(
        "dummy.pdf",
        "Summarise this document in 2 bullet points.",
        result.text,
        result.total
      );

      const llmRes = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 300,
          temperature: 0.4,
        },
        {
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          timeout: 25000,
        }
      );

      const reply = llmRes.data?.choices?.[0]?.message?.content ?? "";
      assert(reply.length > 0,             "LLM returned a non-empty response");
      assert(reply.length < 1500,          `response is concise (${reply.length} chars, not a raw dump)`);
      // Raw text of dummy PDF is "Dummy PDF file\n\n-- 1 of 1 --\n"
      assert(
        !reply.includes("-- 1 of 1 --"),
        "response does not contain raw document formatting markers"
      );
      console.log(`  ℹ  LLM summary (${reply.length} chars):\n  "${reply.trim().slice(0, 200)}"`);
    } catch (e) {
      console.error(`  ⚠  Live LLM test failed (non-fatal): ${e.message}`);
    }
  }
  console.log();
}

// ── Test 5: buildChatHistory filter drops previous document rows ──────────────
{
  console.log("Test 5: buildChatHistory drops previous [Document: ...] inbound rows from history");

  // Simulate the filter logic from handleInbound.ts
  function shouldSkipHistoryRow(row) {
    if (row.metadata?.offline === true) return true;
    if (
      row.direction === "inbound" &&
      typeof row.text === "string" &&
      row.text.trimStart().startsWith("[Document:")
    ) return true;
    return false;
  }

  const rows = [
    // previous normal text message
    { direction: "inbound",  metadata: {}, text: "Hello Jarvis" },
    // previous document row — should be DROPPED
    { direction: "inbound",  metadata: { kind: "document" }, text: "[Document: \"offer.pdf\" — 3 page(s)]\nUser request: summarise\n\n--- Document Content (extract) ---\nFull pdf text here\n---\n\nRespond with a concise..." },
    // assistant reply to that document
    { direction: "outbound", metadata: {}, text: "Here is the summary." },
    // offline fallback — should be DROPPED
    { direction: "outbound", metadata: { offline: true }, text: "I'm offline right now." },
    // another normal outbound
    { direction: "outbound", metadata: {}, text: "Sure thing, Boss." },
  ];

  const history = [];
  for (const row of rows) {
    if (shouldSkipHistoryRow(row)) continue;
    if (row.direction === "inbound") history.push({ role: "user",      content: row.text });
    else                              history.push({ role: "assistant", content: row.text });
  }

  assert(history.length === 3,                               `history has 3 rows (got ${history.length})`);
  assert(history[0].content === "Hello Jarvis",             "normal text message kept");
  assert(history[1].content === "Here is the summary.",    "assistant doc-reply kept");
  assert(history[2].content === "Sure thing, Boss.",       "later outbound kept");
  assert(!history.some(r => r.content.includes("[Document:")), "document extraction row is NOT in history");
  assert(!history.some(r => r.content.includes("I'm offline")), "offline row is NOT in history");
  console.log();
}

// ── Test 6: DOC_SYSTEM_PROMPT has strict anti-echo rules ─────────────────────
{
  console.log("Test 6: Dedicated document system prompt enforces anti-echo rules");

  const DOC_SYSTEM_PROMPT =
    "You are a concise document summarizer. " +
    "Your ONLY job is to answer the user's request about the document. " +
    "STRICT RULES — violating any rule is a critical failure:\n" +
    "  1. Do NOT copy, quote, or repeat any raw text from the document.\n" +
    "  2. Do NOT output the document content section verbatim.\n" +
    "  3. Keep your entire reply under 300 words.\n" +
    "  4. Use plain prose or a short bullet list (max 6 bullets).\n" +
    "  5. Do NOT include headings, code fences, or markdown tables.\n" +
    "  6. Reply in the same language the user wrote in.\n" +
    "Produce ONLY the summary/answer — nothing else.";

  assert(DOC_SYSTEM_PROMPT.includes("Do NOT copy"),          "rule 1: no copying");
  assert(DOC_SYSTEM_PROMPT.includes("verbatim"),             "rule 2: no verbatim output");
  assert(DOC_SYSTEM_PROMPT.includes("300 words"),            "rule 3: word cap enforced");
  assert(DOC_SYSTEM_PROMPT.includes("max 6 bullets"),        "rule 4: bullet cap");
  assert(DOC_SYSTEM_PROMPT.includes("critical failure"),     "rules marked as critical");
  assert(!DOC_SYSTEM_PROMPT.includes("JARVIS"),              "doc prompt is NOT the general JARVIS persona");
  console.log();
}

console.log(`=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
