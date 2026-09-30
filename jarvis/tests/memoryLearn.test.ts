// Memory learning — what the assistant decides is worth remembering.
//
// Pure and offline: only the gate that filters chat messages before the
// extractor spends a model call. The extraction + graph merge itself is
// exercised against the live DB by the run described in
// MISSION-CONTROL-TESTING.md §5c.
//
// Run with:  npx tsx tests/memoryLearn.test.ts

import { shouldExtract } from "../src/lib/memory/learn";

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

console.log("\nmemory gate (what is worth remembering)");

// Personal facts must always pass.
check("a person is worth remembering", shouldExtract("My sister Ananya just started her masters at IISc"));
check("a personal detail is worth remembering", shouldExtract("I moved to Bengaluru last month and I love it here"));
check("an explicit request is worth remembering", shouldExtract("remember that I hate cilantro"));
check("a preference is worth remembering", shouldExtract("I prefer dark mode over light mode"));
check("a deadline is worth remembering", shouldExtract("my DBMS project deadline is 12 October and I am behind"));

// Noise must never pass.
check("a greeting is skipped", !shouldExtract("hey"));
check("small talk is skipped", !shouldExtract("ok thanks"));
check("thanks is skipped", !shouldExtract("thank you so much"));
check("an empty message is skipped", !shouldExtract(""));
check("whitespace is skipped", !shouldExtract("   "));

// Commands are not facts.
check("a play command is skipped", !shouldExtract("open youtube and play lofi"));
check("a timer command is skipped", !shouldExtract("set a 25 minute timer"));
check("a question is skipped", !shouldExtract("what's the weather right now"));
check("a lookup is skipped", !shouldExtract("who is the prime minister of India"));
check("a screenshot command is skipped", !shouldExtract("take a screenshot please"));

// …but a long, fact-carrying sentence that merely opens with a command verb
// still counts.
check(
  "a long sentence is not mistaken for a command",
  shouldExtract("remind me that Ananya's birthday party is on Saturday and she wants filter coffee")
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
