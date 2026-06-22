/**
 * test-vision.js — Terminal test for JARVIS Multimodal Vision (Phase 1)
 *
 * Run with: node test-vision.js
 * Requirements:
 *   - Next.js dev server running on port 3000
 *   - Proxy started via the Jarvis UI (port 8080 LISTENING)
 *
 * Tests:
 *   1. Text-only query (no screenshot) — sanity check baseline
 *   2. Vision query with captureScreenshot:true (no live Chrome = graceful fallback to text)
 */

const http = require("http");

function sendProxyRequest(payload, label) {
  return new Promise((resolve) => {
    console.log(`\n--- [${label}] ---`);
    console.log("Sending:", JSON.stringify(payload, null, 2));

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
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString());
          console.log(`STATUS: ${res.statusCode}`);
          if (result.success) {
            console.log(`✅ PASS — Response: ${result.response.slice(0, 200)}...`);
          } else {
            console.error(`❌ FAIL — Error: ${result.error}`);
          }
          resolve(result);
        } catch (e) {
          console.error(`❌ JSON parse error: ${e.message}`);
          resolve(null);
        }
      });
    });

    req.on("error", (e) => {
      console.error(`❌ Request error: ${e.message}`);
      resolve(null);
    });

    req.setTimeout(30000, () => {
      console.error("❌ Request timed out after 30s");
      req.destroy();
      resolve(null);
    });

    req.write(body);
    req.end();
  });
}

async function main() {
  console.log("=== JARVIS Vision Feature Test Suite ===\n");

  // Test 1: Normal text-only query
  await sendProxyRequest(
    {
      query: "What is 2 + 2?",
      url: "https://news.ycombinator.com",
      domContent: "Hacker News: links for the intellectually curious",
      captureScreenshot: false,
    },
    "Test 1: Text-only query (baseline)"
  );

  // Short pause between tests
  await new Promise((r) => setTimeout(r, 2000));

  // Test 2: Vision query (Chrome NOT running = graceful fallback to text-only)
  await sendProxyRequest(
    {
      query: "What do you see on my screen? Describe it.",
      url: "https://news.ycombinator.com",
      domContent: "Hacker News front page content",
      captureScreenshot: true,
    },
    "Test 2: Vision query (captureScreenshot:true)"
  );

  console.log("\n=== All tests complete ===");
}

main();
