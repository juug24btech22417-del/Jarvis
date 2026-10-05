// Tests for the shared command-routing predicates.
//
// Regression guard for the bug where "play back … on youtube" was hijacked by
// the local Spotify transport shortcuts and failed with the misleading
// "I couldn't go back. Time travel remains elusive, Boss." message.
//
// Pure — no browser, no network, no Next runtime, no Prisma.
//
// Run with:  npx tsx tests/commandRouting.test.ts

import { allowsSpotifyTransport } from "../src/lib/jarvis/commandRouting";

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
