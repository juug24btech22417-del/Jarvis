/**
 * test-os-commands.js — Phase 4: Speech-to-OS
 * Run: node test-os-commands.js
 * Requires: Next.js dev server on port 3000
 */

const BASE = "http://localhost:3000/api/os/command";

async function cmd(label, body) {
  process.stdout.write(`\n[${label}] `);
  try {
    const r = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (d.success) {
      console.log(`✅ ${d.description}${d.stderr ? " (stderr: " + d.stderr + ")" : ""}`);
    } else {
      console.log(`❌ FAIL: ${d.error}`);
    }
    return d;
  } catch (e) {
    console.log(`❌ REQUEST ERROR: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log("=== JARVIS Phase 4 — Speech-to-OS Test Suite ===");

  // Safe read-only tests that won't disrupt the system
  await cmd("web_search",     { command: "web_search",  query: "JARVIS Iron Man AI" });
  await cmd("open_url",       { command: "open_url",    url: "https://github.com" });
  await cmd("open_app:calc",  { command: "open_app",    app: "calculator" });
  await cmd("open_app:notepad", { command: "open_app",  app: "notepad" });

  // Bad command — should 400
  process.stdout.write("\n[unknown_command] ");
  try {
    const r = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "make_coffee" }),
    });
    const d = await r.json();
    console.log(r.status === 400 ? `✅ Correctly rejected (400): ${d.error}` : `❌ Expected 400, got ${r.status}`);
  } catch (e) {
    console.log(`❌ ${e.message}`);
  }

  console.log("\n=== Phase 4 tests complete ===\n");
}

main();
