/**
 * E2E Tests — 4 New Orb Features
 * Run with: npx ts-node --project tsconfig.test.json tests/orbNewFeatures.test.ts
 * Or:        npx jest tests/orbNewFeatures.test.ts
 *
 * Tests use real PowerShell/OS calls to verify features work in production.
 */

import * as http from "http";
import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const BASE = "http://localhost:3000";
const PASS = "\x1b[32m✓ PASS\x1b[0m";
const FAIL = "\x1b[31m✗ FAIL\x1b[0m";
const INFO = "\x1b[36mℹ\x1b[0m ";

let passed = 0;
let failed = 0;

async function post(path: string, body: object) {
  return new Promise<any>((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "localhost",
        port: 3000,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ raw: data });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  ${PASS} ${label}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

// ── Feature 1: Context Leech ─────────────────────────────────────────────────
async function testContextLeech() {
  console.log("\n📸 TEST: Context Leech (/api/orb/context-leech)");
  
  // Test 1: Desktop context scan
  try {
    const res = await post("/api/orb/context-leech", {});
    console.log(`  ${INFO} Response:`, JSON.stringify(res).slice(0, 200));
    assert(typeof res === "object" && res !== null, "Returns an object");
    assert(res.ok === true, "Context Leech: ok=true");
    assert(Array.isArray(res.tacticalBullets), "tacticalBullets is array");
    assert(Array.isArray(res.suggestedQuestions), "suggestedQuestions is array");
    assert(Array.isArray(res.factChecks), "factChecks is array");
    console.log(`  ${INFO} Topic: ${res.meetingTopic || "(none)"}`);
    console.log(`  ${INFO} Bullets: ${res.tacticalBullets?.length ?? 0}`);
  } catch (err: any) {
    console.log(`  ${FAIL} Network error: ${err.message}`);
    failed++;
  }

  // Test 2: YouTube / Song playback context intelligence
  try {
    const mediaRes = await post("/api/orb/context-leech", {
      contextText: 'ACTIVE MEDIA PLAYING: "The Weeknd - Blinding Lights (Official Audio) - YouTube - Google Chrome"',
      topic: "YouTube Song Playback",
    });
    console.log(`  ${INFO} Media Leech Response:`, JSON.stringify(mediaRes).slice(0, 250));
    assert(mediaRes.ok === true, "Media Context: ok=true");
    assert(
      mediaRes.meetingTopic.toLowerCase().includes("blinding") ||
      mediaRes.meetingTopic.toLowerCase().includes("weeknd") ||
      mediaRes.meetingTopic.toLowerCase().includes("song"),
      "Media Topic recognizes song/artist"
    );
    assert(mediaRes.tacticalBullets.length > 0, "Provides musical/artist trivia bullets");
    console.log(`  ${INFO} Detected Topic: ${mediaRes.meetingTopic}`);
    mediaRes.tacticalBullets.forEach((b: string) => console.log(`    • ${b}`));
  } catch (err: any) {
    console.log(`  ${FAIL} Media Leech error: ${err.message}`);
    failed++;
  }
}

// ── Feature 3: Ghost Copilot — Bug Trapper ───────────────────────────────────
async function testGhostCopilot() {
  console.log("\n🐛 TEST: Ghost Copilot (/api/orb/copilot)");

  // Create a real broken Python file to test against
  const tmpDir = os.tmpdir();
  const testFile = path.join(tmpDir, "jarvis_copilot_test.py");
  const brokenCode = `def divide(a, b):
    return a / b

result = divide(10, 0)
print(result)
`;

  fs.writeFileSync(testFile, brokenCode);
  console.log(`  ${INFO} Created test file: ${testFile}`);

  const errorTrace = `Traceback (most recent call last):
  File "${testFile}", line 4, in <module>
    result = divide(10, 0)
  File "${testFile}", line 2, in divide
    return a / b
ZeroDivisionError: division by zero`;

  try {
    // Step 1: Diagnose
    const diagRes = await post("/api/orb/copilot", { action: "diagnose", errorTrace, file: testFile });
    console.log(`  ${INFO} Diagnose response:`, JSON.stringify(diagRes).slice(0, 300));
    assert(diagRes.ok === true, "Diagnose: ok=true");
    assert(typeof diagRes.errorSummary === "string" && diagRes.errorSummary.length > 0, "errorSummary present");
    assert(typeof diagRes.explanation === "string" && diagRes.explanation.length > 0, "explanation present");
    assert(typeof diagRes.proposedPatch === "string", "proposedPatch is string");

    // Step 2: Apply fix (write patch to file with .bak safety)
    const patch = diagRes.proposedPatch || "    if b == 0: return None\n    return a / b";
    const applyRes = await post("/api/orb/copilot", {
      action: "apply",
      file: testFile,
      originalSnippet: "return a / b",
      proposedPatch: patch,
    });
    console.log(`  ${INFO} Apply response:`, JSON.stringify(applyRes).slice(0, 200));
    assert(applyRes.ok === true, "Apply: ok=true");
    assert(fs.existsSync(testFile + ".bak"), "Safety .bak file created");

    const patchedContent = fs.readFileSync(testFile, "utf8");
    assert(patchedContent.includes(patch), "File content was actually patched on disk");
    console.log(`  ${INFO} Verified patched file & safety .bak ✓`);
  } catch (err: any) {
    console.log(`  ${FAIL} Network error: ${err.message}`);
    failed++;
  } finally {
    // Cleanup
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    if (fs.existsSync(testFile + ".bak")) fs.unlinkSync(testFile + ".bak");
  }
}

// ── Feature 4: Omni-Query — Universal OS Deep Search ─────────────────────────
async function testOmniQuery() {
  console.log("\n🔍 TEST: Omni-Query (/api/orb/omni-query)");

  // Test 1: Real PDFs downloaded last week (user's real request)
  try {
    const pdfRes = await post("/api/orb/omni-query", {
      action: "search",
      query: "find all the pdfs downloaded last week",
    });
    console.log(`  ${INFO} Last week PDFs: found ${pdfRes.totalFound} file(s)`);
    assert(pdfRes.ok === true, "Search returns ok=true");
    assert(typeof pdfRes.totalFound === "number", "totalFound is number");
    assert(pdfRes.totalFound > 0, `Found ${pdfRes.totalFound} PDFs from last week in Downloads`);
    assert(Array.isArray(pdfRes.files), "files is array");
    pdfRes.files.slice(0, 4).forEach((f: any) => {
      console.log(`    📄 ${f.name} (${f.size}) - modified: ${f.modified}`);
    });
  } catch (err: any) {
    console.log(`  ${FAIL} PDF Search error: ${err.message}`);
    failed++;
  }

  // Test 2: Search for real .py files in Downloads
  try {
    const pyRes = await post("/api/orb/omni-query", {
      action: "search",
      query: "python files in downloads",
    });
    console.log(`  ${INFO} .py in Downloads:`, `${pyRes.totalFound} found`);
    assert(pyRes.ok === true, "Python file search returns ok=true");
    assert(typeof pyRes.totalFound === "number", "totalFound is number for python search");
  } catch (err: any) {
    console.log(`  ${FAIL} Network error: ${err.message}`);
    failed++;
  }
}

// ── Feature 6: Self-Healing Environment Daemon ───────────────────────────────
async function testEnvHeal() {
  console.log("\n⚡ TEST: Env Heal (/api/orb/env-heal)");

  try {
    // Step 1: Scan
    const scanRes = await post("/api/orb/env-heal", { action: "scan" });
    console.log(`  ${INFO} Scan response:`, JSON.stringify(scanRes).slice(0, 400));
    assert(scanRes.ok === true, "Scan: ok=true");
    assert(typeof scanRes.healthy === "boolean", "healthy is boolean");
    assert(Array.isArray(scanRes.issues), "issues is array");
    assert(typeof scanRes.lastChecked === "number", "lastChecked is number");

    console.log(`  ${INFO} Healthy: ${scanRes.healthy}, Issues: ${scanRes.issues.length}`);
    scanRes.issues.forEach((iss: any) => {
      console.log(`    Issue: ${iss.id} — ${iss.description}`);
    });

    // Step 2: Port 3000 must show as busy (server is running on it)
    const port3000Issue = scanRes.issues.find((i: any) => i.port === 3000 || i.description?.includes("3000"));
    if (port3000Issue) {
      console.log(`  ${INFO} Port 3000 detected occupied by PID ${port3000Issue.pid} ✓`);
      assert(typeof port3000Issue.pid === "number", "Port 3000 issue has PID");
      assert(typeof port3000Issue.fixAction === "string", "Port 3000 issue has fixAction");
      // We do NOT heal port 3000 because that would kill our running server!
      console.log(`  ${INFO} Skipping heal for port 3000 (would kill our test server)`);
    } else {
      console.log(`  ${INFO} Port 3000 not in issue list (may be filtered or not detected as listener)`);
    }

    // Step 3: Simulate a git index lock and heal it
    const gitDir = path.join(process.cwd(), ".git");
    if (fs.existsSync(gitDir)) {
      const lockFile = path.join(gitDir, "index.lock");
      fs.writeFileSync(lockFile, "SIMULATED LOCK");
      console.log(`  ${INFO} Created simulated .git/index.lock`);

      const healRes = await post("/api/orb/env-heal", {
        action: "heal",
        issueId: "git-index-lock",
        type: "git_lock",
      });
      console.log(`  ${INFO} Heal response:`, JSON.stringify(healRes).slice(0, 200));
      assert(healRes.ok === true, "Git lock heal: ok=true");
      assert(!fs.existsSync(lockFile), ".git/index.lock removed by heal");
    } else {
      console.log(`  ${INFO} No .git directory found — skipping git lock test`);
    }
  } catch (err: any) {
    console.log(`  ${FAIL} Network error: ${err.message}`);
    failed++;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n\x1b[1m🤖 JARVIS ORB — New Features E2E Test Suite\x1b[0m");
  console.log("=".repeat(52));
  console.log(`${INFO} Testing against: ${BASE}`);
  console.log(`${INFO} Timestamp: ${new Date().toISOString()}`);

  await testContextLeech();
  await testGhostCopilot();
  await testOmniQuery();
  await testEnvHeal();

  console.log("\n" + "=".repeat(52));
  console.log(
    `\x1b[1m${passed + failed} tests — \x1b[32m${passed} passed\x1b[0m\x1b[1m, \x1b[${failed > 0 ? "31" : "32"}m${failed} failed\x1b[0m`
  );

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
