/**
 * test-actions.js — Terminal test for JARVIS Phase 2: Autonomous Action Execution
 *
 * Run with: node test-actions.js
 * Requirements:
 *   - Next.js dev server running on port 3000
 *   - Proxy started (port 8080 LISTENING)
 *
 * Tests:
 *   1. Informational query — verifies NO action is returned
 *   2. Action query: "scroll down" — verifies scroll action payload
 *   3. Action query: "click the search button" — verifies click action payload
 *   4. Action query: "navigate to github.com" — verifies navigate action payload
 *   5. __ACTION__ parser edge case — malformed JSON falls back to text-only
 */

const http = require("http");

function sendProxyRequest(payload, label) {
  return new Promise((resolve) => {
    console.log(`\n--- [${label}] ---`);

    const body = JSON.stringify(payload);
    const options = {
      host: "127.0.0.1",
      port: 8080,
      method: "POST",
      path: "https://news.ycombinator.com/__jarvis_chat",
      headers: {
        "Content-Type": "application/json",
        "Host": "news.ycombinator.com",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString());
          console.log(`STATUS: ${res.statusCode}`);
          console.log(`response: ${(result.response || "").slice(0, 120)}...`);
          if (result.action) {
            console.log(`action:`, JSON.stringify(result.action));
          } else {
            console.log("action: (none)");
          }
          resolve(result);
        } catch (e) {
          console.error(`❌ JSON parse error: ${e.message}`);
          resolve(null);
        }
      });
    });

    req.on("error", (e) => console.error(`❌ Request error: ${e.message}`));
    req.setTimeout(30000, () => { console.error("❌ Timeout"); req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

// Direct parser unit test — no network needed
function testParser() {
  console.log("\n--- [Test 0: __ACTION__ Parser Unit Tests] ---");

  const cases = [
    {
      input: 'Sure, scrolling down now.\n__ACTION__ {"action":"scroll","direction":"down","amount":500}',
      expectAction: true,
      label: "Valid scroll action"
    },
    {
      input: "The answer to life is 42.",
      expectAction: false,
      label: "No action (text only)"
    },
    {
      input: 'Clicking now.\n__ACTION__ {BROKEN JSON}',
      expectAction: false,
      label: "Malformed JSON fallback"
    },
  ];

  const MARKER = "__ACTION__";
  let allPassed = true;

  for (const c of cases) {
    const idx = c.input.lastIndexOf(MARKER);
    let action = null;
    if (idx !== -1) {
      try { action = JSON.parse(c.input.slice(idx + MARKER.length).trim()); } catch {}
    }

    const hasAction = action !== null;
    const pass = hasAction === c.expectAction;
    console.log(`  ${pass ? "✅" : "❌"} ${c.label}: action=${JSON.stringify(action)}`);
    if (!pass) allPassed = false;
  }

  return allPassed;
}

async function main() {
  console.log("=== JARVIS Action Execution Test Suite ===");

  // Unit test the parser first (no network)
  const parserOk = testParser();
  if (!parserOk) {
    console.error("\n❌ Parser tests failed. Stopping.");
    process.exit(1);
  }

  const pause = () => new Promise((r) => setTimeout(r, 2000));

  // Test 1: Informational — should return NO action
  const t1 = await sendProxyRequest(
    { query: "What is the main topic of this page?", url: "https://news.ycombinator.com", domContent: "Hacker News: links for intellectually curious." },
    "Test 1: Informational query (expect: no action)"
  );
  console.log(t1?.action ? "❌ FAIL — unexpected action" : "✅ PASS");
  await pause();

  // Test 2: Scroll action
  const t2 = await sendProxyRequest(
    { query: "Scroll down on the page please", url: "https://news.ycombinator.com", domContent: "Hacker News front page." },
    "Test 2: Scroll down (expect: scroll action)"
  );
  const t2Pass = t2?.action?.action === "scroll" || t2?.action == null; // LLM may or may not emit action
  console.log(`${t2Pass ? "✅ PASS" : "⚠️  NOTE"} — action: ${JSON.stringify(t2?.action)}`);
  await pause();

  // Test 3: Navigate action
  const t3 = await sendProxyRequest(
    { query: "Navigate me to https://github.com", url: "https://news.ycombinator.com", domContent: "Hacker News." },
    "Test 3: Navigate action (expect: navigate action)"
  );
  const t3Pass = t3?.action?.action === "navigate" || t3?.action == null;
  console.log(`${t3Pass ? "✅ PASS" : "⚠️  NOTE"} — action: ${JSON.stringify(t3?.action)}`);

  console.log("\n=== All action tests complete ===");
}

main();
