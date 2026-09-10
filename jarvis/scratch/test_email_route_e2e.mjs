// E2E smoke test: insert a fake ComposioConnection, hit the send
// route, verify a PendingEmail row was created, then cancel it via
// the cancel route and verify the cancel route's atomic-claim + the
// row state.
//
// Run after `npm run dev` is up on :3000.

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
loadEnv({ path: resolve(process.cwd(), ".env") });

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const API = "http://localhost:3000";

let failed = 0;
function expect(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failed++; }
}

async function main() {
  // 1. Insert a fake Gmail composio connection so the send route's
  // "no active Gmail connection" check passes.
  console.log("[1] seed fake composio connection");
  // The ComposioConnection model has a unique constraint on
  // (userId, toolkitSlug), so use those as the upsert key.
  const upsertRes = await prisma.composioConnection.upsert({
    where: {
      userId_toolkitSlug: { userId: "jarvis-local", toolkitSlug: "gmail" },
    },
    update: { status: "ACTIVE", connectedAccountId: "fake_acct_123" },
    create: {
      toolkitSlug: "gmail",
      connectedAccountId: "fake_acct_123",
      userId: "jarvis-local",
      status: "ACTIVE",
      authConfigId: "test_auth",
    },
  }).catch((e) => {
    console.log("  ! upsert failed:", e?.message?.split("\n")[0]);
    return null;
  });
  // Verify the table existed enough to upsert. If the composio
  // migration hasn't been applied to this dev.db, the upsert will
  // have returned null.
  const conn = await prisma.composioConnection.findFirst({
    where: { userId: "jarvis-local", toolkitSlug: "gmail" },
  });
  expect(!!conn, "ComposioConnection row exists (or skip rest of test)");

  if (!conn) {
    console.log("\n  Composio tables not present in this dev.db — skipping the");
    console.log("  HTTP-driven portion. The earlier scratch/test_email_flow.mjs");
    console.log("  already verified the lib + DB pieces.");
    await prisma.$disconnect();
    return;
  }

  // 2. POST to /api/composio/email/send with a friendly tone.
  console.log("\n[2] POST /api/composio/email/send");
  const sendRes = await fetch(`${API}/api/composio/email/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: "Alice <alice@example.com>",
      about: "saying hi and wishing a good week",
      tone: "friendly",
    }),
  });
  const sendData = await sendRes.json();
  expect(sendRes.status === 200, `status 200 (got ${sendRes.status})`);
  expect(sendData?.ok === true, "ok=true");
  expect(sendData?.pendingId, "pendingId present");
  expect(sendData?.tone === "friendly", "tone round-trips as friendly");
  expect(sendData?.subject && sendData.subject.length > 0, "subject composed");
  expect(sendData?.body && sendData.body.length > 0, "body composed");
  expect(sendData?.to?.email === "alice@example.com", "parsed email correct");
  expect(sendData?.to?.name === "Alice", "parsed name correct");

  const pendingId = sendData?.pendingId;

  // 3. Verify PendingEmail row in DB.
  console.log("\n[3] verify PendingEmail row");
  const row = await prisma.pendingEmail.findUnique({ where: { id: pendingId } });
  expect(!!row, "row exists in DB");
  expect(row?.status === "pending", "row status = pending");
  expect(row?.tone === "friendly", "row tone = friendly");
  expect(row?.toEmail === "alice@example.com", "row toEmail = alice@example.com");
  expect(row?.toName === "Alice", "row toName = Alice");
  expect(row?.connectedAccountId === "fake_acct_123", "row connectedAccountId = fake_acct_123");
  expect(row?.fireAt > new Date(), "row fireAt is in the future");

  // 4. POST to /api/composio/email/cancel.
  console.log("\n[4] POST /api/composio/email/cancel");
  const cancelRes = await fetch(`${API}/api/composio/email/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pendingId }),
  });
  const cancelData = await cancelRes.json();
  expect(cancelRes.status === 200, `cancel status 200 (got ${cancelRes.status})`);
  expect(cancelData?.ok === true, "cancel ok=true");
  expect(cancelData?.status === "cancelled", "cancel status=cancelled");

  // 5. Re-cancel — should be idempotent.
  console.log("\n[5] re-cancel is idempotent");
  const reCancel = await fetch(`${API}/api/composio/email/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pendingId }),
  });
  const reData = await reCancel.json();
  expect(reCancel.status === 200, "re-cancel status 200");
  expect(reData?.ok === true, "re-cancel ok=true");
  expect(reData?.alreadyCancelled === true, "re-cancel reports alreadyCancelled");

  // 6. Tone inference via the route (no explicit tone).
  console.log("\n[6] send without explicit tone → inferTone");
  const auto = await fetch(`${API}/api/composio/email/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: "bob@example.com",
      about: "this is urgent please respond",
    }),
  });
  const autoData = await auto.json();
  expect(autoData?.ok === true, "auto-tone send ok");
  expect(autoData?.tone === "urgent", "auto-tone inferred as urgent");

  console.log(`\nResult: ${failed === 0 ? "ALL PASS" : `${failed} FAILED`}`);
  // cleanup
  await prisma.pendingEmail.deleteMany({ where: { toEmail: { in: ["alice@example.com", "bob@example.com"] } } });
  await prisma.composioConnection.deleteMany({ where: { userId: "jarvis-local", toolkitSlug: "gmail" } });
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
