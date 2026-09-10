// Test the CommandBar email regex against the user's exact request.
// Mirrors the logic in src/components/panels/CommandBar.tsx.

const text = "send an email to dhruvbijapur67@gmail.com on design review in urgent tone";

const emailSpokenPatterns = [
  // Spoken: "send email to NAME at DOMAIN [about|on|re|saying] BODY [in TONE tone]"
  /(?:send|email)\s+(?:an?\s+)?(?:email\s+)?(?:to\s+)?(.+?)\s+(?:at|@)\s+(.+?)(?:\s+(?:about|on|regarding|re|saying|with\s+subject|with\s+message|with\s+body|body|message)\s+(.+?))?(?:\s+(?:in|with(?:\s+a)?)\s+(?:a\s+)?(professional|friendly|polite|formal|urgent|casual)\s+(?:tone|way|manner)(?:\s+please)?)?\s*[\.\!]?\s*$/i,
  // Real email: "send email to real@addr.com [about|on|re|saying] BODY [in TONE tone]"
  /(?:send|email)\s+(?:an?\s+)?(?:email\s+)?(?:to\s+)?([^\s]+@[^\s]+?)(?:\s+(?:about|on|regarding|re|saying|with\s+subject|with\s+message|with\s+body|body|message)\s+(.+?))?(?:\s+(?:in|with(?:\s+a)?)\s+(?:a\s+)?(professional|friendly|polite|formal|urgent|casual)\s+(?:tone|way|manner)(?:\s+please)?)?\s*[\.\!]?\s*$/i,
];

let match = null;
for (const pattern of emailSpokenPatterns) {
  const m = text.match(pattern);
  if (m) { match = m; break; }
}

if (!match) {
  console.log("FAIL: no match");
  process.exit(1);
}

let emailAddress, about, explicitTone;
if (match[2] && /dot/i.test(match[2])) {
  // Spoken pattern
  const localPart = match[1].toLowerCase().replace(/\s+/g, "");
  const domainPart = match[2].toLowerCase().replace(/\s+dot\s*/gi, ".").replace(/\s+/g, "").replace(/\.+$/, "");
  emailAddress = `${localPart}@${domainPart}`;
  about = (match[3] || "").trim();
  explicitTone = match[4] ? match[4].toLowerCase() : null;
} else {
  // Real email pattern
  emailAddress = match[1];
  about = (match[2] || "").trim();
  explicitTone = match[3] ? match[3].toLowerCase() : null;
}

console.log("emailAddress:", JSON.stringify(emailAddress));
console.log("about:", JSON.stringify(about));
console.log("explicitTone:", JSON.stringify(explicitTone));

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const valid = emailRegex.test(emailAddress);
console.log("valid:", valid);

// Expected:
//   emailAddress: "dhruvbijapur67@gmail.com"
//   about: "design review"
//   explicitTone: "urgent"
//   valid: true

let failed = 0;
function expect(cond, msg) {
  if (cond) console.log("  ✓", msg);
  else { console.error("  ✗", msg); failed++; }
}
expect(emailAddress === "dhruvbijapur67@gmail.com", "parses email correctly (NOT concatenated with topic)");
expect(about === "design review", "captures about without tone phrase");
expect(explicitTone === "urgent", "extracts explicit tone");
expect(valid === true, "passes email regex");

process.exit(failed === 0 ? 0 : 1);
