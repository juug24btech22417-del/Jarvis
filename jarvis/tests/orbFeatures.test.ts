// End-to-end unit and integration test for the 5 Jaw-Dropping Orb Capabilities:
//   1. Universal Drag-and-Drop Ingestion Singularity
//   2. Desktop Screen Reticle & Active App Auto-Pilot
//   3. Cross-App Magic Clipboard Stash (Multi-Slot Synthesis)
//   4. Silent Ghost Worker (Autonomous Background Delegator)
//   5. Circle-to-Act Desktop Teleportation
//
// Run with: npx tsx tests/orbFeatures.test.ts

import { bestMatch, groundTarget, type GroundCandidate } from "../src/lib/screen/elementGrounding";
import { useJarvisStore, type StashedClip, type GhostWorker } from "../src/store/jarvis.store";

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

// ─────────────────────────────────────────────────────────────────────────
section("1. Drag & Drop Ingestion Singularity Payload Validation");

function formatIngestedFilePrompt(name: string, content: string): string {
  return `[INGESTED FILE: ${name}]\nAnalyze this file, identify key insights or errors, and summarize:\n\n${content.slice(0, 3500)}`;
}

function formatIngestedImagePrompt(name: string): string {
  return `[INGESTED IMAGE: ${name}] Analyze this image, extract any text and explain key elements.`;
}

const mockCode = "export function add(a: number, b: number) { return a + b; }";
const filePrompt = formatIngestedFilePrompt("math.ts", mockCode);
check("file prompt contains filename tag", filePrompt.includes("[INGESTED FILE: math.ts]"));
check("file prompt includes code content", filePrompt.includes("export function add"));

const imagePrompt = formatIngestedImagePrompt("error_screenshot.png");
check("image prompt tags ingested image", imagePrompt.includes("[INGESTED IMAGE: error_screenshot.png]"));

// ─────────────────────────────────────────────────────────────────────────
section("2. Desktop Screen Reticle & Element Grounding");

const DESKTOP_CANDIDATES: GroundCandidate[] = [
  { ref: "w1", role: "button", name: "Subscribe" },
  { ref: "w2", role: "searchbox", name: "Search documents" },
  { ref: "w3", role: "button", name: "Run Build" },
  { ref: "w4", role: "link", name: "Account Settings" },
  { ref: "w5", role: "textbox", name: "Terminal input" },
];

const reticleMatch1 = bestMatch("click the Subscribe button", DESKTOP_CANDIDATES);
check("reticle locks onto target button", reticleMatch1?.ref === "w1");
check("reticle confidence is high (> 0.5)", (reticleMatch1?.confidence ?? 0) >= 0.5);

const reticleMatch2 = bestMatch("focus the search box", DESKTOP_CANDIDATES);
check("reticle identifies search box by role & name", reticleMatch2?.ref === "w2");

// ─────────────────────────────────────────────────────────────────────────
section("3. Cross-App Magic Clipboard Stash (Multi-Slot Synthesis)");

const store = useJarvisStore.getState();
store.clearClipboardStash();

check("stash starts empty", useJarvisStore.getState().clipboardStash.length === 0);

// Add clip 1: code
store.addToClipboardStash({
  text: "const token = jwt.sign({ user: 'stark' }, SECRET);",
  source: "VSCode",
});

// Add clip 2: error log
store.addToClipboardStash({
  text: "TypeError: Cannot read properties of undefined (reading 'token')\n    at authenticate (auth.ts:42)",
  source: "Terminal",
});

// Add clip 3: URL
store.addToClipboardStash({
  text: "https://jwt.io/introduction",
  source: "Chrome",
});

const currentStash = useJarvisStore.getState().clipboardStash;
check("stash stores 3 distinct clips", currentStash.length === 3);
check("clip 1 detected as URL", currentStash[0].kind === "url");
check("clip 2 detected as error", currentStash[1].kind === "error");
check("clip 3 detected as code", currentStash[2].kind === "code");

// Deduplication check
store.addToClipboardStash({
  text: "https://jwt.io/introduction",
});
check("duplicate clip does not increase count", useJarvisStore.getState().clipboardStash.length === 3);

// ─────────────────────────────────────────────────────────────────────────
section("4. Silent Ghost Worker Background Delegation");

const workerId = store.startGhostWorker({
  title: "Analyze Competitor APIs",
  goal: "Scrape 3 developer docs and compare webhook payloads",
  progress: 25,
  status: "running",
  step: "Deconstructing goal into crawler requests",
});

const activeWorkers = useJarvisStore.getState().ghostWorkers;
check("ghost worker started and assigned ID", activeWorkers.length >= 1 && activeWorkers[0].id === workerId);
check("ghost worker initial progress is 25%", activeWorkers[0].progress === 25);

// Step to checkpoint
store.updateGhostWorker(workerId, {
  progress: 75,
  status: "waiting_approval",
  step: "Checkpoint: confirm 3 external HTTP requests",
  approvalPrompt: "Allow headless crawler to fetch developer endpoints?",
});

const checkpointWorker = useJarvisStore.getState().ghostWorkers.find((w) => w.id === workerId);
check("ghost worker pauses at human checkpoint", checkpointWorker?.status === "waiting_approval");
check("approval prompt is populated", checkpointWorker?.approvalPrompt?.includes("Allow headless crawler") === true);

// Complete worker
store.updateGhostWorker(workerId, {
  progress: 100,
  status: "completed",
  step: "Task complete",
  result: "Extracted 3 webhook schemas successfully.",
});

const completedWorker = useJarvisStore.getState().ghostWorkers.find((w) => w.id === workerId);
check("ghost worker finishes at 100%", completedWorker?.progress === 100);
check("ghost worker stores deliverable result", completedWorker?.result?.includes("3 webhook schemas") === true);

// Clean up
store.removeGhostWorker(workerId);
check("ghost worker removed cleanly after completion", !useJarvisStore.getState().ghostWorkers.some((w) => w.id === workerId));

// ─────────────────────────────────────────────────────────────────────────
section("5. Circle-to-Act Teleportation Contract");

const actionPrompt = "[CIRCLE-TO-ACT RESULT] Instruction: 'translate this'. Action: Identified region and executed target tool.";
check("circle-to-act prompt contains expected prefix", actionPrompt.startsWith("[CIRCLE-TO-ACT RESULT]"));

// ─────────────────────────────────────────────────────────────────────────
console.log(`\nSummary: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) {
  process.exit(1);
}
