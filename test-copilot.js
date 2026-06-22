/**
 * test-copilot.js — Terminal test for JARVIS Phase 3: Inline Co-Pilot
 *
 * Run with: node test-copilot.js
 * Requirements:
 *   - Next.js dev server running on port 3000
 *   - Proxy started (port 8080 LISTENING)
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
          console.log(`response: "${result.response}"`);
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

async function main() {
  console.log("=== JARVIS Inline Co-Pilot Test Suite ===");

  const payload = {
    query: "hey can u write a quick email to my manager explaining i will be late by 15 mins due to heavy traffic on outer ring road",
    url: "https://mail.google.com",
    domContent: "Gmail Compose Window",
    copilot: true, // triggers the autocomplete prompt override
  };

  const result = await sendProxyRequest(payload, "Test 1: Inline Co-Pilot Text Polish (copilot:true)");

  if (result && result.success && result.response) {
    const resp = result.response.toLowerCase();
    const hasGreetingFluff = resp.includes("here is the email") || resp.includes("certainly, sir") || resp.includes("apologies");
    if (!hasGreetingFluff) {
      console.log("\n✅ PASS: Response is direct and ready to inject into the input field.");
    } else {
      console.warn("\n⚠️  NOTE: Response included some conversational fluff.");
    }
  } else {
    console.error("\n❌ FAIL: Empty or unsuccessful response.");
  }

  console.log("\n=== All copilot tests complete ===");
}

main();
