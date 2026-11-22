// API Route Handler tests for Orb Capabilities
// Run with: npx tsx tests/orbApis.test.ts

import { POST as screenGroundPost } from "../src/app/api/screen/ground/route";
import { POST as ghostWorkerPost } from "../src/app/api/ghost-worker/route";
import { NextRequest } from "next/server";

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

async function run() {
  console.log("\nScreen Ground Route (/api/screen/ground)");
  {
    // 1. With caller-supplied candidates
    const req1 = new NextRequest("http://localhost:3000/api/screen/ground", {
      method: "POST",
      body: JSON.stringify({
        query: "click the Subscribe button",
        candidates: [
          { ref: "btn-sub", role: "button", name: "Subscribe" },
          { ref: "btn-like", role: "button", name: "Like" },
        ],
      }),
    });
    const res1 = await screenGroundPost(req1);
    const json1 = await res1.json();
    check("status 200 (supplied candidates)", res1.status === 200);
    check("ok is true", json1.ok === true);
    check("match found for subscribe button", json1.match?.name === "Subscribe");
    check("role is button", json1.match?.role === "button");
    check("confidence is high", json1.match?.confidence >= 0.5);

    // 2. Without candidates (live desktop context generation)
    const req2 = new NextRequest("http://localhost:3000/api/screen/ground", {
      method: "POST",
      body: JSON.stringify({ query: "Code Editor" }),
    });
    const res2 = await screenGroundPost(req2);
    const json2 = await res2.json();
    check("status 200 (desktop context mode)", res2.status === 200);
    check("ok is true for desktop mode", json2.ok === true);
    check("candidatesUsed > 0", json2.candidatesUsed > 0);
  }

  console.log("\nGhost Worker Route (/api/ghost-worker - Real Agent Bridge)");
  {
    // Start real worker mission
    const req1 = new NextRequest("http://localhost:3000/api/ghost-worker", {
      method: "POST",
      body: JSON.stringify({ action: "start", goal: "Audit performance metrics" }),
    });
    const res1 = await ghostWorkerPost(req1);
    const json1 = await res1.json();
    check("worker started", json1.ok === true);
    check("worker has id", typeof json1.workerId === "string");
    check("status is valid", ["planning", "running", "done"].includes(json1.status));
    check("step is non-empty", typeof json1.step === "string" && json1.step.length > 0);

    // Poll worker status
    const req2 = new NextRequest("http://localhost:3000/api/ghost-worker", {
      method: "POST",
      body: JSON.stringify({ action: "poll", workerId: json1.workerId }),
    });
    const res2 = await ghostWorkerPost(req2);
    const json2 = await res2.json();
    check("poll returned ok", json2.ok === true);
    check("progress is a number", typeof json2.progress === "number");
    check("workerId matches", json2.workerId === json1.workerId);
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
