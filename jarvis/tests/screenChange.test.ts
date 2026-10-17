// Tests for screen-change verification (did that click actually DO anything?).
//
// These pin the two halves that make the agent self-verifying: the comparison
// must not be fooled by the things that change on every turn without anything
// happening (re-issued element refs, whitespace, reflow), and it must not
// mistake an observation-only step for a failed action.
//
// Run with:  npx tsx tests/screenChange.test.ts

import {
  classifyChange,
  fingerprint,
  structureFingerprint,
  textSimilarity,
  expectsChange,
  changeNote,
  TEXT_CHANGE_THRESHOLD,
  type ScreenSnapshot,
} from "../src/lib/screen/screenChange";

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

function snap(over: Partial<ScreenSnapshot> = {}): ScreenSnapshot {
  return {
    url: "https://example.com/video",
    title: "A video",
    text: "Subscribe to this channel for more videos about circuits and rockets",
    elements: [
      { ref: "j1", role: "button", name: "Subscribe" },
      { ref: "j2", role: "link", name: "Share" },
    ],
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────
section("The fingerprint ignores what changes every turn anyway");

check("identical observations fingerprint identically", fingerprint(snap()) === fingerprint(snap()));
check(
  "re-issued element refs do NOT count as a change",
  fingerprint(snap()) ===
    fingerprint(
      snap({
        elements: [
          { ref: "k41", role: "button", name: "Subscribe" },
          { ref: "k42", role: "link", name: "Share" },
        ],
      })
    )
);
check(
  "whitespace and reflow do NOT count as a change",
  fingerprint(snap()) ===
    fingerprint(
      snap({ text: "Subscribe   to this channel\nfor more   videos about circuits and rockets" })
    )
);
check("a different label does change it", fingerprint(snap()) !== fingerprint(snap({ title: "Another video" })));
check(
  "the structural fingerprint tracks elements only",
  structureFingerprint(snap()) === structureFingerprint(snap({ text: "completely different words here" })) &&
    structureFingerprint(snap()) !== structureFingerprint(snap({ elements: [] }))
);

section("Text similarity behaves like a similarity, not an equality");

check("identical text is 1", textSimilarity("hello world", "hello world") === 1);
check("whitespace only is 1", textSimilarity("hello  world", "hello world") === 1);
check("disjoint text is 0", textSimilarity("apples oranges", "circuits rockets") === 0);
/**
 * A realistic page body the length of the agent's 1200-char excerpt, with a
 * varied vocabulary (a repetitive fixture makes word-set similarity absurdly
 * sensitive, which is a property of the fixture, not of the metric).
 */
const LONG_PAGE = Array.from({ length: 180 }, (_, i) => `phrase${i}`).join(" ");

const minor = textSimilarity(LONG_PAGE, `${LONG_PAGE} today`);
check("one added word on a real-length page stays above the threshold", minor > TEXT_CHANGE_THRESHOLD, `sim=${minor.toFixed(3)}`);
const minorChange = classifyChange(snap({ text: LONG_PAGE }), snap({ text: `${LONG_PAGE} today` }));
check(
  "so one changed word is NOT reported as a content change",
  !minorChange.changed && minorChange.wordsChanged === 1,
  `changed=${minorChange.changed} words=${minorChange.wordsChanged}`
);
const major = textSimilarity("Subscribe to this channel", "Your order has been placed successfully");
check("different content falls below it", major < TEXT_CHANGE_THRESHOLD, `sim=${major.toFixed(3)}`);
check("two empty texts are equal, not undefined", textSimilarity("", "") === 1);
check("one empty text is not", textSimilarity("", "something") === 0);

// ─────────────────────────────────────────────────────────────────────────
section("The verdict says WHAT changed");

const same = classifyChange(snap(), snap());
check("no change → verdict none", same.verdict === "none" && same.changed === false);

const navigated = classifyChange(snap(), snap({ url: "https://example.com/other", text: "A different page entirely" }));
check("a new URL → navigation", navigated.verdict === "navigation" && navigated.changed === true);
check("and it reports urlChanged", navigated.urlChanged === true);

const content = classifyChange(snap(), snap({ text: "Your order has been placed successfully thank you" }));
check("new text on the same URL → content", content.verdict === "content", content.verdict);
check("and the URL flag stays false", content.urlChanged === false);

const layout = classifyChange(
  snap(),
  snap({
    elements: [
      { ref: "j1", role: "button", name: "Subscribe" },
      { ref: "j2", role: "link", name: "Share" },
      { ref: "j3", role: "button", name: "Download" },
    ],
  })
);
check("a new interactive element → layout", layout.verdict === "layout", layout.verdict);
check("the element delta is reported", layout.elementDelta === 1, `${layout.elementDelta}`);

const gone = classifyChange(snap(), snap({ elements: [] }));
check("elements disappearing is a change too", gone.changed && gone.elementDelta === -2, `${gone.elementDelta}`);
const titleOnly = classifyChange(snap(), snap({ title: "Renamed" }));
check("a title-only change is reported", titleOnly.titleChanged === true);
check(
  "but does not count as the page moving (titles churn: counters, clocks)",
  titleOnly.changed === false,
  `changed=${titleOnly.changed}`
);

// ─────────────────────────────────────────────────────────────────────────
section("Only actions that SHOULD move the page are judged");

check("click is judged", expectsChange("click"));
check("type is judged", expectsChange("type"));
check("press is judged", expectsChange("press"));
check("goto is judged", expectsChange("goto"));
check("scroll is judged", expectsChange("scroll"));
check("extract is NOT (it only reads)", !expectsChange("extract"));
check("screenshot is NOT", !expectsChange("screenshot"));
check("wait is NOT", !expectsChange("wait"));
check("done is NOT", !expectsChange("done"));
check("case is irrelevant", expectsChange("CLICK"));

section("The feedback line: exactly when it is useful");

const noChange = classifyChange(snap(), snap());
check(
  "a click that did nothing produces a note",
  !!changeNote("click", noChange)?.includes("NO visible change"),
  changeNote("click", noChange) ?? "null"
);
check(
  "the note names the action so the model can avoid repeating it",
  changeNote("click", noChange)?.startsWith("the click") === true
);
const didChange = classifyChange(snap(), snap({ text: "Your order has been placed" }));
check("a click that worked produces NO note", changeNote("click", didChange) === null);
check("an extract that changed nothing produces NO note", changeNote("extract", noChange) === null);
check("a missing comparison produces NO note", changeNote("click", null) === null);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
