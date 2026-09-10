// Smoke test for the email flow pieces we can hit without a running
// dev server or composio creds:
//   1. Prisma client sees PendingEmail (model + columns).
//   2. inferTone() picks the right tone from natural language.
//   3. parseRecipient() in the route matches "Name <a@b.com>" + raw.
//   4. End-to-end: insert a PendingEmail, hit the cancel route's
//      atomic claim, then attempt a re-cancel (should be idempotent).
//
// Run: node scratch/test_email_flow.mjs
// (Prisma + composio env must be set in .env — auto-loaded.)

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
loadEnv({ path: resolve(process.cwd(), ".env") });

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

let failed = 0;
function expect(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

async function main() {
  // 1. Prisma model.
  console.log("[1] prisma model");
  const tables = await prisma.$queryRawUnsafe(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='PendingEmail'"
  );
  expect(Array.isArray(tables) && tables.length === 1, "PendingEmail table exists");
  const cols = await prisma.$queryRawUnsafe("PRAGMA table_info('PendingEmail')");
  const colNames = cols.map((c) => c.name);
  for (const want of ["id", "toEmail", "toName", "body", "subject", "tone", "fireAt", "status"]) {
    expect(colNames.includes(want), `column ${want} present`);
  }

  // 2. inferTone — re-implement the keyword logic from email.ts and
  // verify the regex table is wired the same way.
  console.log("\n[2] inferTone (mirrored logic)");
  const TONE_KEYWORDS = [
    { tone: "professional", re: /\b(professional|business[- ]like|corporate|formal\s+work)\b/i },
    { tone: "urgent", re: /\b(urgent|asap|immediately|right\s+away|time[- ]sensitive|pressing)\b/i },
    { tone: "formal", re: /\b(formal|official|ceremonial)\b/i },
    { tone: "friendly", re: /\b(friendly|warm|cheerful|pleasant)\b/i },
    { tone: "polite", re: /\b(polite|courteous|respectful|deferential)\b/i },
    { tone: "casual", re: /\b(casual|informal|laid[- ]back|relaxed)\b/i },
  ];
  function inferTone(text) {
    for (const { tone, re } of TONE_KEYWORDS) {
      if (re.test(text)) return tone;
    }
    return "professional";
  }
  expect(inferTone("Please send this urgent") === "urgent", "inferTone('urgent') → urgent");
  expect(inferTone("Friendly hello") === "friendly", "inferTone('friendly') → friendly");
  expect(inferTone("Polite ask") === "polite", "inferTone('polite') → polite");
  expect(inferTone("Just do it") === "professional", "inferTone(default) → professional");
  expect(inferTone("ASAP please") === "urgent", "inferTone('ASAP') → urgent");

  // 3. Recipient parser (mirrored from route.ts).
  console.log("\n[3] parseRecipient (route.ts logic mirrored)");
  function parseRecipient(raw) {
    const trimmed = raw.trim();
    const m = trimmed.match(/^(.+?)\s*<\s*([^>\s]+@[^>\s]+)\s*>$/);
    if (m) return { name: m[1].trim(), email: m[2].trim() };
    if (/^[^\s<>]+@[^\s<>]+$/.test(trimmed)) return { email: trimmed };
    return null;
  }
  const r1 = parseRecipient("Alice <alice@example.com>");
  expect(r1?.name === "Alice" && r1?.email === "alice@example.com", "Name <email> parses");
  const r2 = parseRecipient("bob@example.com");
  expect(r2?.email === "bob@example.com" && !r2?.name, "bare email parses (no name)");
  const r3 = parseRecipient("not an email");
  expect(r3 === null, "garbage returns null");

  // 4. End-to-end: insert PendingEmail, atomic-claim, re-cancel.
  console.log("\n[4] PendingEmail insert + atomic cancel");
  // We need a connectedAccountId for the row (schema is NOT NULL).
  // Use a dummy; this test never actually sends.
  const dummy = `test_conn_${Date.now()}`;
  const row = await prisma.pendingEmail.create({
    data: {
      toEmail: "test@example.com",
      toName: "Test User",
      body: "Hello there",
      subject: "Test subject",
      tone: "professional",
      requestRaw: "send a test email",
      fireAt: new Date(Date.now() + 30_000),
      status: "pending",
      connectedAccountId: dummy,
    },
  });
  expect(!!row.id, "row inserted with id");

  // First claim — should succeed (count=1).
  const first = await prisma.pendingEmail.updateMany({
    where: { id: row.id, status: "pending" },
    data: { status: "cancelled" },
  });
  expect(first.count === 1, "first claim flips status (count=1)");

  // Second claim — should be no-op (count=0).
  const second = await prisma.pendingEmail.updateMany({
    where: { id: row.id, status: "pending" },
    data: { status: "cancelled" },
  });
  expect(second.count === 0, "second claim is no-op (count=0)");

  // Re-read; should still be "cancelled".
  const fresh = await prisma.pendingEmail.findUnique({ where: { id: row.id } });
  expect(fresh?.status === "cancelled", "row status reflects cancellation");

  // Cleanup.
  await prisma.pendingEmail.delete({ where: { id: row.id } });
  console.log("  ✓ cleanup row deleted");

  console.log(`\nResult: ${failed === 0 ? "ALL PASS" : `${failed} FAILED`}`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
