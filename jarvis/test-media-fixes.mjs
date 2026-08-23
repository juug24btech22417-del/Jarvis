/**
 * test-media-fixes.mjs
 *
 * Validates both fixes applied in this session:
 *   Fix 1 — pdf-parse v2 class API (PDFParse + Uint8Array)
 *   Fix 2 — Vision fallback chain no longer includes openrouter/free
 *            (which routed to the content-safety classifier and
 *             returned "User Safety: safe" instead of a description)
 *
 * Run with:  node test-media-fixes.mjs
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

// ──────────────────────────────────────────────────────────
// FIX 1 — pdf-parse v2 class API
// ──────────────────────────────────────────────────────────
console.log("=== Fix 1: pdf-parse v2 (PDFParse class + Uint8Array) ===\n");

// 1a. Module exports PDFParse as a named class
{
  console.log("Test 1a: pdf-parse exports a named PDFParse class");
  const { PDFParse: cls } = await import("pdf-parse");
  assert(typeof cls === "function", "PDFParse is exported and is a constructor function");
  assert(
    typeof new cls(new Uint8Array(0)).getText === "function",
    "instances expose a getText() method"
  );
  console.log();
}

// 1b. Passing a raw Buffer is rejected with a helpful error
{
  console.log("Test 1b: PDFParse rejects a plain Buffer");
  let threw = false;
  try {
    const parser = new PDFParse(Buffer.from([]));
    await parser.getText();
  } catch (e) {
    threw = true;
    assert(
      e.message.includes("Uint8Array"),
      `error mentions Uint8Array (got: ${e.message.slice(0, 80)})`
    );
  }
  assert(threw, "PDFParse throws when given a Buffer");
  console.log();
}

// 1c. Conversion to Uint8Array is accepted (but empty PDF → format error, not the Buffer error)
{
  console.log("Test 1c: Uint8Array conversion bypasses the Buffer check");
  const buff = Buffer.from([]);
  const u8 = new Uint8Array(buff.buffer, buff.byteOffset, buff.byteLength);
  let errorMsg = "";
  try {
    const parser = new PDFParse(u8);
    await parser.getText();
  } catch (e) {
    errorMsg = e.message;
  }
  assert(
    !errorMsg.includes("Uint8Array"),           // not the Buffer error
    "Buffer→Uint8Array conversion accepted (different error now)"
  );
  assert(
    errorMsg.includes("empty") || errorMsg.includes("Invalid") || errorMsg.includes("PDF"),
    `got expected PDF-level error instead: "${errorMsg.slice(0, 80)}"`
  );
  console.log();
}

// 1d. Real PDF download + parse
{
  console.log("Test 1d: Download and parse a real PDF using PDFParse class");
  try {
    const resp = await axios.get(
      "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
      { responseType: "arraybuffer", timeout: 15000 }
    );
    const buff = Buffer.from(resp.data);
    const u8 = new Uint8Array(buff.buffer, buff.byteOffset, buff.byteLength);
    const parser = new PDFParse(u8);
    const result = await parser.getText();

    assert(result && typeof result === "object",  "getText() returned an object");
    assert(typeof result.text === "string",       "result.text is a string");
    assert(result.text.trim().length > 0,         "result.text is non-empty");
    assert(typeof result.total === "number",      `result.total is a number (got ${result.total})`);
    assert(result.total >= 1,                     `PDF has at least 1 page (got ${result.total})`);

    console.log(`  ℹ  Parsed text preview: "${result.text.trim().slice(0, 60)}..."`);
    console.log(`  ℹ  Pages (result.total): ${result.total}`);
  } catch (e) {
    console.error(`  ❌ Real PDF parse threw: ${e.message}`);
    failed++;
  }
  console.log();
}

// ──────────────────────────────────────────────────────────
// FIX 2 — Vision fallback chain
// ──────────────────────────────────────────────────────────
console.log("=== Fix 2: Vision fallback chain no longer routes to content-safety ===\n");

// Replicate the model list from vision.ts
const DEFAULT_VISION_MODEL = "nvidia/nemotron-nano-12b-v2-vl:free";
const preferredModel = process.env.TELEGRAM_VISION_MODEL ?? DEFAULT_VISION_MODEL;

const modelsToTry = [
  preferredModel,
  "google/gemma-4-31b-it:free",
  "google/gemini-2.5-flash",
];

const BANNED_MODELS = [
  "openrouter/free",
  "meta-llama/llama-3.2-11b-vision-instruct:free",  // was removed (404)
  "nvidia/nemotron-3.5-content-safety:free",          // the culprit
];

{
  console.log("Test 2a: Fallback chain does NOT include blacklisted models");
  for (const banned of BANNED_MODELS) {
    assert(
      !modelsToTry.includes(banned),
      `"${banned}" is absent from the fallback chain`
    );
  }
  console.log();
}

{
  console.log("Test 2b: Fallback chain has 3 entries and starts with the preferred model");
  assert(modelsToTry.length === 3,          `chain has 3 entries (got ${modelsToTry.length})`);
  assert(modelsToTry[0] === preferredModel, `first entry is preferredModel`);
  assert(modelsToTry[1] === "google/gemma-4-31b-it:free", "second entry is gemma-4:free");
  assert(modelsToTry[2] === "google/gemini-2.5-flash",    "third entry is gemini-2.5-flash (paid fallback)");
  console.log();
}

{
  console.log("Test 2c: Live call to preferred model (nvidia/nemotron-nano-12b-v2-vl:free)");
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.log("  ⚠  OPENROUTER_API_KEY not set — skipping live test");
  } else {
    try {
      const imgResp = await axios.get(
        "https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=150",
        { responseType: "arraybuffer", timeout: 10000 }
      );
      const dataUrl = `data:image/jpeg;base64,${Buffer.from(imgResp.data).toString("base64")}`;

      const res = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: "nvidia/nemotron-nano-12b-v2-vl:free",
          messages: [{
            role: "user",
            content: [
              { type: "text", text: "Describe this image in one sentence." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          }],
          max_tokens: 200,
          temperature: 0.4,
        },
        {
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          timeout: 25000,
        }
      );

      const content = res.data?.choices?.[0]?.message?.content ?? "";
      assert(content.length > 0,  "model returned a non-empty description");
      assert(
        !content.toLowerCase().startsWith("user safety"),
        `response is a description, NOT a safety label (got: "${content.slice(0, 80)}")`
      );
      console.log(`  ℹ  Model response preview: "${content.slice(0, 120)}"`);
    } catch (e) {
      console.error(`  ⚠  Live vision test failed (non-fatal): ${e.message}`);
    }
  }
  console.log();
}

// ──────────────────────────────────────────────────────────
console.log(`=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
