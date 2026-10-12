// Email identity — the signature that goes out on every composed email.
//
// Regression these pin down: free models, told to "sign off appropriately",
// invent a template sign-off —
//
//   Best regards,
//   [Your title]
//   [Company name]
//   [Contact info]
//
// — and the old applyIdentity only appended the real signature when the name
// was missing, so literal placeholder brackets were sent in real email. The
// signature must be exactly one, always the user's real one (name + contact),
// and never contain a job title or company.
//
// Run with:  npx tsx tests/emailIdentity.test.ts

import { applyIdentity } from "../src/lib/composio/email";
import { USER_PROFILE, emailSignature } from "../src/lib/userProfile";

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

const PLACEHOLDERS = /\[(?:your|my)\s+(?:name|title|company|contact[^\]\]]*)\]|\[company\s+name\]|\[contact\s+info\]/i;

// 1. The reported case: the model emitted a placeholder block instead of a name.
{
  const body =
    "Hi Rahul,\n\nThe invoice is attached and ready for review.\n\nBest regards,\n[Your title]\n[Company name]\n[Contact info]";
  const out = applyIdentity("Invoice", body);
  check("placeholder block is stripped from the body", !PLACEHOLDERS.test(out.body), out.body);
  check("the real signature is appended", out.body.includes(emailSignature()), out.body);
  check("the real name is present", out.body.includes(USER_PROFILE.name), out.body);
  check("the real contact is present", out.body.includes(USER_PROFILE.phone), out.body);
}

// 2. The model signed off properly with a name AND invented a title/company.
{
  const body =
    "Hi Rahul,\n\nSending the latest numbers.\n\nBest regards,\nDhruv Bijapur\nSenior Engineer\nAcme Corp";
  const out = applyIdentity("Numbers", body);
  check("a model signature block is cut, not duplicated", !out.body.includes("Acme"), out.body);
  check("no job title leaks into the mail", !/senior engineer/i.test(out.body), out.body);
  check("signature appears exactly once", out.body.split(emailSignature()).length - 1 === 1, out.body);
}

// 3. No signature at all (the good path): we still stamp the real one once.
{
  const out = applyIdentity("Hello", "Hi Rahul,\n\nQuick update on the build.");
  check("a signature is added when the model wrote none", out.body.includes(emailSignature()), out.body);
  check("and only once", out.body.split(emailSignature()).length - 1 === 1, out.body);
}

// 4. "thanks" mid-sentence must not be mistaken for a closing.
{
  const body =
    "Hi Rahul,\n\nThanks for the update yesterday — it unblocked me.\n\nThe new build is up.";
  const out = applyIdentity("Build", body);
  check(
    "an internal 'thanks' does not truncate the mail",
    out.body.includes("unblocked me") && out.body.includes("new build is up"),
    out.body
  );
}

// 5. Curly placeholder variants and {{mustache}} fills are cleaned too.
{
  const out = applyIdentity("X", "Hi,\n\nBody line.\n\nRegards,\n<Your Name>\n{{company}}");
  check("angle/mustache placeholders are stripped", !/[<{]{2}/.test(out.body), out.body);
  check("real signature still appended", out.body.includes(USER_PROFILE.name), out.body);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
