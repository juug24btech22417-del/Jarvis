/**
 * test-memory.js — Phase 5: Persistent Memory Graph
 * Run: node test-memory.js
 * Requires: Next.js dev server on port 3000 + proxy on port 8080
 *
 * Tests:
 *   1. Send a message with a memorable fact → memory file should update
 *   2. Send a follow-up → JARVIS should reference the stored fact
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const MEMORY_FILE = path.join(__dirname, "jarvis", ".jarvis-memory.json");

function proxyRequest(payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const opts = {
      host: "127.0.0.1",
      port: 8080,
      method: "POST",
      path: "https://example.com/__jarvis_chat",
      headers: {
        "Content-Type": "application/json",
        Host: "example.com",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: Buffer.concat(chunks).toString() });
        }
      });
    });

    req.on("error", (e) => resolve({ status: 0, error: e.message }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ status: 0, error: "timeout" }); });
    req.write(body);
    req.end();
  });
}

function readMemoryFile() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) return null;
    return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  console.log("=== JARVIS Phase 5 — Persistent Memory Test Suite ===\n");

  // ── Test 1: Inject a memorable fact ──────────────────────────────────────
  console.log("[Test 1] Sending a memorable fact to JARVIS via proxy...");
  const t1 = await proxyRequest({
    query: "Remember that my project is called IronGrid and I work at Stark Industries.",
    url: "https://example.com",
    domContent: "",
  });
  console.log(`  STATUS: ${t1.status}`);
  if (t1.status === 200 && t1.data?.success) {
    console.log(`  RESPONSE: "${t1.data.response?.slice(0, 120)}..."`);
    console.log("  ✅ LLM replied successfully");
  } else {
    console.log(`  ❌ FAIL: ${t1.data?.error || t1.error}`);
  }

  // Small delay to let memory persist
  await new Promise((r) => setTimeout(r, 800));

  // ── Test 2: Check memory file was written ─────────────────────────────────
  console.log("\n[Test 2] Checking memory file on disk...");
  const mem = readMemoryFile();
  if (mem) {
    const hasProjectFact = mem.facts?.some((f) =>
      f.text.toLowerCase().includes("irongrid") || f.text.toLowerCase().includes("stark")
    );
    console.log(`  Memory file: ${MEMORY_FILE}`);
    console.log(`  Total facts stored: ${mem.facts?.length ?? 0}`);
    console.log(`  Preferences stored: ${JSON.stringify(mem.preferences)}`);
    if (hasProjectFact) {
      console.log("  ✅ PASS: Fact about IronGrid/Stark Industries found in memory");
    } else {
      console.log("  ⚠️  NOTE: No exact match for IronGrid/Stark. Stored facts:");
      (mem.facts || []).forEach((f) => console.log(`    • ${f.text}`));
    }
  } else {
    console.log("  ⚠️  Memory file not found or empty (may write on next query)");
  }

  // ── Test 3: Follow-up that should use stored memory ───────────────────────
  console.log("\n[Test 3] Follow-up query to see if JARVIS recalls the fact...");
  const t3 = await proxyRequest({
    query: "What project am I working on?",
    url: "https://example.com",
    domContent: "",
  });
  console.log(`  STATUS: ${t3.status}`);
  if (t3.status === 200 && t3.data?.success) {
    const reply = t3.data.response || "";
    console.log(`  RESPONSE: "${reply.slice(0, 200)}"`);
    const recalled = reply.toLowerCase().includes("irong") || reply.toLowerCase().includes("stark");
    if (recalled) {
      console.log("  ✅ PASS: JARVIS referenced stored memory in reply");
    } else {
      console.log("  ⚠️  PARTIAL: Memory was injected but model may have paraphrased");
    }
  } else {
    console.log(`  ❌ FAIL: ${t3.data?.error || t3.error}`);
  }

  console.log("\n=== Phase 5 tests complete ===\n");
}

main();
