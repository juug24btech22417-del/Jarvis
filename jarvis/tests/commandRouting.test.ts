// Tests for the shared command-routing predicates.
//
// Regression guard for the bug where "play back … on youtube" was hijacked by
// the local Spotify transport shortcuts and failed with the misleading
// "I couldn't go back. Time travel remains elusive, Boss." message.
//
// Pure — no browser, no network, no Next runtime, no Prisma.
//
// Run with:  npx tsx tests/commandRouting.test.ts

import { allowsSpotifyTransport, feedScrollIntent, isMissionControlOpen } from "../src/lib/jarvis/commandRouting";

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

section("allowsSpotifyTransport — commands aimed elsewhere must NOT hit Spotify");

for (const cmd of [
  "open youtube and play any song",
  "open youtube and play a song",
  "play back to back songs on youtube",
  "open youtube and play lo-fi study music",
  "open instagram and scroll reels",
  "open youtube and scroll shorts",
  "play some music in the browser",
  "watch a video on youtube",
]) {
  check(`"${cmd}" → false`, allowsSpotifyTransport(cmd) === false);
}

section("allowsSpotifyTransport — genuine Spotify controls still work");

for (const cmd of [
  "play music",
  "play some music",
  "pause music",
  "next track",
  "skip song",
  "previous song",
  "go back",
  "resume playback",
]) {
  check(`"${cmd}" → true`, allowsSpotifyTransport(cmd) === true);
}

section("allowsSpotifyTransport — naming Spotify wins over any other target");

check('"pause spotify" → true', allowsSpotifyTransport("pause spotify") === true);
check(
  '"play next on spotify while youtube is open" → true',
  allowsSpotifyTransport("play next on spotify while youtube is open") === true
);

section("allowsSpotifyTransport — empty input is safe");

check('"" → false', allowsSpotifyTransport("") === false);

// Regression: "open mission control" opened nothing — the phrase carries no
// goal, so the mission matcher skipped it and no panel handler claimed it.
section("isMissionControlOpen — opening the deck");

for (const cmd of [
  "open mission control",
  "Open Mission Control",
  "hey jarvis, open mission control",
  "show me mission control",
  "launch mission control",
  "bring up mission control",
  "pull up the mission control panel",
  "go to mission control",
  "mission control",
]) {
  check(`"${cmd}" → true`, isMissionControlOpen(cmd) === true);
}

section("isMissionControlOpen — real missions and other commands are untouched");

for (const cmd of [
  "mission control: find the best free react course and open the best one",
  "open youtube and scroll shorts",
  "open instagram and scroll reels",
  "find the best free react course and open the best one",
  "open the proxy panel",
  "open the agent panel",
  "play some music",
  "scroll reels on instagram until I say stop",
  "",
]) {
  check(`"${cmd}" → false`, isMissionControlOpen(cmd) === false);
}

// The feed runner must catch how people actually type it, from either the
// command bar or the Mission Control composer.
section("feedScrollIntent — natural phrasing resolves to a feed");

const feedCases: Array<[string, string]> = [
  ["open youtube and scroll shorts", "youtube"],
  ["open instagram and scroll reels", "instagram"],
  ["open youtube and scroll", "youtube"],
  ["open instagram and keep scrolling", "instagram"],
  ["scroll reels on instagram", "instagram"],
  ["scroll through youtube shorts", "youtube"],
  ["scroll shorts", "youtube"],
  ["scroll reels", "instagram"],
  ["keep scrolling reels", "instagram"],
  ["show me instagram reels", "instagram"],
  ["browse instagram reels", "instagram"],
  ["open tiktok and scroll", "tiktok"],
  ["open snapchat spotlight", "snapchat"],
];
for (const [cmd, site] of feedCases) {
  const hit = feedScrollIntent(cmd);
  check(`"${cmd}" → ${site}`, hit?.site === site, `got ${hit ? hit.site : "null"}`);
}

section("feedScrollIntent — other commands are left alone");

for (const cmd of [
  "scroll youtube comments",
  "open youtube and play any song",
  "play some music",
  "open the proxy panel",
  "open youtube in the browser",
  "find the best free react course and open the best one",
  "",
]) {
  check(`"${cmd}" → null`, feedScrollIntent(cmd) === null, `got ${JSON.stringify(feedScrollIntent(cmd))}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
