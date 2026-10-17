// Tests for local element grounding ("click the Subscribe button" → ref).
//
// Grounding is a retrieval model, so the tests are retrieval assertions: the
// right element must rank first, ambiguity must be VISIBLE as low confidence
// (so the caller falls back instead of clicking a coin flip), a role word must
// act as evidence about the element's kind, and a request that matches nothing
// must return nothing rather than the least-bad element on the page.
//
// Run with:  npx tsx tests/elementGrounding.test.ts

import {
  groundTarget,
  bestMatch,
  describeGrounding,
  tokenize,
  tokensMatch,
  roleHintOf,
  GROUND_ACCEPT,
  type GroundCandidate,
} from "../src/lib/screen/elementGrounding";

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

// A realistic page: a video site with a sticky header and a sidebar.
const PAGE: GroundCandidate[] = [
  { ref: "j1", role: "link", name: "Home" },
  { ref: "j2", role: "searchbox", name: "Search" },
  { ref: "j3", role: "button", name: "Subscribe" },
  { ref: "j4", role: "button", name: "Save to playlist" },
  { ref: "j5", role: "button", name: "Share" },
  { ref: "j6", role: "link", name: "Sign in" },
  { ref: "j7", role: "link", name: "Terms of Service" },
  { ref: "j8", role: "button", name: "More" },
  { ref: "j9", role: "textbox", name: "Add a comment" },
  { ref: "j10", role: "link", name: "Help" },
  { ref: "j11", role: "button", name: "Subscribe to newsletter" },
  { ref: "j12", role: "combobox", name: "Sort by" },
];

// ─────────────────────────────────────────────────────────────────────────
section("Tokenization and fuzzy matching");

check(
  "camelCase and separators split into words",
  tokenize("SubscribeNow-this_week").join(",") === "subscribe,now,this,week",
  tokenize("SubscribeNow-this_week").join(",")
);
check("punctuation is stripped", tokenize("Sign in? (Google)").join(",") === "sign,in,google");
check("identical tokens match", tokensMatch("subscribe", "subscribe"));
check("plural / suffix variants match", tokensMatch("subscriptions", "subscribe"));
check("a one-letter typo matches", tokensMatch("subscrbe", "subscribe"));
check("unrelated words do not match", !tokensMatch("share", "subscribe"));
check("short tokens are not fuzzy-matched", !tokensMatch("ab", "ax"));
check("the role hint reads the requested element kind", roleHintOf("click the blue Subscribe button") === "button");
check("role hint for a field", roleHintOf("type something in the search box") === "searchbox");
check("no role word → no hint", roleHintOf("Subscribe") === null);

section("The right element ranks first");

const subscribe = bestMatch("click the blue Subscribe button", PAGE);
check("a described button is found", subscribe?.ref === "j3" || subscribe?.ref === "j11", subscribe?.ref ?? "null");
check(
  "and it beats the unrelated buttons",
  groundTarget("click the blue Subscribe button", PAGE)[0].ref === subscribe?.ref
);
check("with a confident score", (subscribe?.confidence ?? 0) >= GROUND_ACCEPT, `conf=${subscribe?.confidence}`);

const search = bestMatch("click the Search field", PAGE);
check("a field is found by role word", search?.ref === "j2", search?.ref ?? "null");
const signIn = bestMatch("click Sign in", PAGE);
check("an exact label is found", signIn?.ref === "j6", signIn?.ref ?? "null");
const more = bestMatch("click the More button", PAGE);
check("a short generic label is found", more?.ref === "j8", more?.ref ?? "null");
const comment = bestMatch("type hello in the Add a comment box", PAGE);
check("a multi-word field label is found", comment?.ref === "j9", comment?.ref ?? "null");
const sort = bestMatch("open the Sort by dropdown", PAGE);
check("a combobox is found by role word", sort?.ref === "j12", sort?.ref ?? "null");
const help = bestMatch("click Help", PAGE);
check("a link is found", help?.ref === "j10", help?.ref ?? "null");

section("Typos and casual phrasing");

const typo = bestMatch("hit the subscrbe button", PAGE);
check("a typo still grounds", typo?.ref === "j3" || typo?.ref === "j11", typo?.ref ?? "null");
const chatty = bestMatch("please can you click the share button for me", PAGE);
check("filler words are ignored", chatty?.ref === "j5", chatty?.ref ?? "null");
const caps = bestMatch("CLICK SHARE", PAGE);
check("case does not matter", caps?.ref === "j5", caps?.ref ?? "null");

section("Role words are EVIDENCE, not decoration");

// "Search" the word is on the link/page copy; "search box" is the field. The
// request says field, so the field must win.
const fieldVsWord = groundTarget("type into the search textbox", PAGE);
check("a field request prefers the field", fieldVsWord[0].ref === "j2", fieldVsWord[0]?.ref);
check(
  "even though other elements carry the word 'search'",
  fieldVsWord.filter((m) => m.ref !== "j2").every((m) => m.confidence < 1)
);

section("Ambiguity is visible, not hidden");

// Two identical labels: the ranker must still return both, with a lower
// confidence than a single clean match, so the caller can choose to fall back.
const twins: GroundCandidate[] = [
  { ref: "a1", role: "button", name: "Subscribe" },
  { ref: "a2", role: "button", name: "Subscribe" },
];
const twinRanked = groundTarget("Subscribe button", twins);
const twin = bestMatch("Subscribe button", twins);
const unique = bestMatch("Subscribe button", [{ ref: "b1", role: "button", name: "Subscribe" }]);
check("both twins are still ranked and visible", twinRanked.length === 2, `${twinRanked.length}`);
check(
  "but a tie is NOT acted on (it defers to the model's own ref)",
  twin === null,
  twin ? `picked ${twin.ref} @ ${twin.confidence}` : "null"
);
check(
  "because its confidence sits below the acceptance threshold",
  twinRanked.every((m) => m.confidence < GROUND_ACCEPT),
  twinRanked.map((m) => m.confidence.toFixed(3)).join(", ")
);
check(
  "while a unique match is confidently above it",
  (unique?.confidence ?? 0) > GROUND_ACCEPT && (unique?.confidence ?? 0) > (twinRanked[0]?.confidence ?? 1),
  `ambiguous=${twinRanked[0]?.confidence} unique=${unique?.confidence}`
);
check("a unique match is fully confident", (unique?.confidence ?? 0) > 0.9, `conf=${unique?.confidence}`);

section("Stale refs: the same wording still resolves after a re-render");

// Refs are re-issued every turn; the ranker must follow the LABEL, not the ref.
const rerendered: GroundCandidate[] = [
  { ref: "k7", role: "button", name: "Subscribe" },
  { ref: "k8", role: "link", name: "Sign in" },
];
check("grounding follows the label across a ref change", bestMatch("Subscribe button", rerendered)?.ref === "k7");

// ─────────────────────────────────────────────────────────────────────────
section("No match means NO match");

check("an element that does not exist is not invented", bestMatch("click Delete my account", PAGE) === null);
check("and the ranked list is empty", groundTarget("click Delete my account", PAGE).length === 0);
check("an empty request matches nothing", bestMatch("", PAGE) === null);
// A role word alone ("the button") is not a target: there are four buttons with
// different labels, and picking the first is a coin flip. The ranker must
// return nothing so the caller falls back to the model's own ref.
check("a role-only request matches nothing", groundTarget("please click the button", PAGE).length === 0);
check("and is never acted on", bestMatch("please click the button", PAGE) === null);
check("a colour word alone matches nothing", groundTarget("click the blue one", PAGE).length === 0);

section("Explanations are produced for the agent log");

const explained = groundTarget("click the blue Subscribe button", PAGE)[0];
check("the match explains itself", explained.why.some((w) => w.includes("subscribe")), explained.why.join(" / "));
check("and names the role hit", explained.why.some((w) => w.startsWith("role=") || w.includes("mismatch")), explained.why.join(" / "));
check("describeGrounding offers a candidate", /Best local match/.test(describeGrounding("click Share", PAGE)));
check(
  "describeGrounding warns instead of guessing when nothing matches",
  /No element matches/.test(describeGrounding("click Delete my account", PAGE))
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
