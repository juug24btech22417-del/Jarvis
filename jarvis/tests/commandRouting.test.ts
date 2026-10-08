// Tests for the shared command-routing predicates.
//
// Regression guard for the bug where "play back … on youtube" was hijacked by
// the local Spotify transport shortcuts and failed with the misleading
// "I couldn't go back. Time travel remains elusive, Boss." message.
//
// Pure — no browser, no network, no Next runtime, no Prisma.
//
// Run with:  npx tsx tests/commandRouting.test.ts

import {
  allowsSpotifyTransport,
  feedScrollIntent,
  isMissionControlOpen,
  liveBrowseIntent,
} from "../src/lib/jarvis/commandRouting";
import { detectBrowserTask } from "../src/lib/jarvis/personality";
import { getShopperProfile, describeShopperProfile } from "../src/lib/agent/shopperProfile";

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

// Regression: every one of these was hijacked away from a live browser run.
// "playwright" opened the Browser Automation panel, "price of" became a
// Mission Control research run, and the generic search matcher opened
// google.com in a new tab — so the user never saw anything browsed live.
section("liveBrowseIntent — the user's real commands route to the live agent");

for (const cmd of [
  'Go to github.com, open the microsoft/playwright repository, and tell me its star count and number of open issues.',
  'Go to amazon.in, search for "mechanical keyboard", and tell me the price of the first search result',
  'Go to imdb.com, search for "Interstellar", and tell me its rating, runtime, and director',
  'Go to xe.com and find the current USD to INR rate, then calculate what 250 US dollars is in Indian rupee',
  "go to wikipedia and tell me how tall the eiffel tower is",
  "navigate to news.ycombinator.com and read me the top story",
  "open wikipedia and find when Ada Lovelace was born",
  "https://example.com/docs",
]) {
  check(`"${cmd}" → live browse`, liveBrowseIntent(cmd) !== null, "got null");
}

section("liveBrowseIntent — keeps the task text and extracts the url");

const gh = liveBrowseIntent(
  "Go to github.com, open the microsoft/playwright repository, and tell me its star count and number of open issues."
);
check("task is passed through verbatim", gh?.task.startsWith("Go to github.com") === true, gh?.task);
check("a bare host becomes a concrete start url", gh?.url === "https://github.com", String(gh?.url));

const pasted = liveBrowseIntent("read https://example.com/docs and summarize it");
check("pasted url is extracted", pasted?.url === "https://example.com/docs", String(pasted?.url));

section("liveBrowseIntent — everything else is left for the other engines");

for (const cmd of [
  "find the best free react course and open the best one",
  "research the top 3 AI coding assistants and write a report",
  "open youtube and play any song",
  "open chrome",
  "open my downloads folder",
  "go to mission control",
  "what is backpropagation",
  "play some music",
  "",
]) {
  check(`"${cmd}" → null`, liveBrowseIntent(cmd) === null, `got ${JSON.stringify(liveBrowseIntent(cmd))}`);
}

// Regression: these three all failed in the wild. nasa.gov was mis-resolved to
// nasa.com (and then the window closed), "play the first song" was eaten by the
// local Spotify handler, and the amazon errand was dumped into a Google tab.
section("liveBrowseIntent — spoken brands and multi-step errands");

for (const cmd of [
  "Go to nasa.gov and tell me what today's astronomy picture of the day is",
  "go to amazon and search for umbrella, add it to cart and proceed to buy it, and also fetch my current loc details and fill it in address if asked",
  "add this umbrella to the cart on amazon",
  "buy a phone case on flipkart",
  "head to swiggy and order a pizza",
]) {
  check(`"${cmd}" → live browse`, liveBrowseIntent(cmd) !== null, "got null");
}

const nasa = liveBrowseIntent(
  "Go to nasa.gov and tell me what today's astronomy picture of the day is"
);
check("nasa.gov resolves to https://nasa.gov", nasa?.url === "https://nasa.gov", String(nasa?.url));

section("liveBrowseIntent — local media handlers keep their commands");

for (const cmd of [
  "open spotify",
  "go to spotify and head to liked songs in spotify and play the first song",
  "play some music",
  "play the first song",
  "play lofi beats on spotify",
  "open youtube and play any song",
  "open instagram and scroll reels",
]) {
  check(`"${cmd}" → null`, liveBrowseIntent(cmd) === null, `got ${JSON.stringify(liveBrowseIntent(cmd))}`);
}

// The intent API consults this only after BOTH providers have failed, so it is
// the difference between browsing and answering from memory when the network
// blips.
section("detectBrowserTask — provider-down safety net");

for (const cmd of [
  "go to nasa.gov and tell me what today's astronomy picture of the day is",
  "go to amazon and search for umbrella and add it to cart",
]) {
  check(`"${cmd}" → detected`, detectBrowserTask(cmd) !== null, "got null");
}

section("detectBrowserTask — provider-down safety net (existing)");

for (const cmd of [
  "go to news.ycombinator.com and tell me the top story",
  "check the price of an iphone 15 on amazon.in",
  "browse to imdb.com and find the rating of Interstellar",
  "open the page https://example.com and tell me the headline",
]) {
  check(`"${cmd}" → detected`, detectBrowserTask(cmd) !== null, "got null");
}

for (const cmd of [
  "how are you",
  "tell me a joke",
  "remind me to call mom",
  "play lofi beats on youtube",
  "what's the weather in tokyo",
  "",
]) {
  check(`"${cmd}" → null`, detectBrowserTask(cmd) === null, `got ${JSON.stringify(detectBrowserTask(cmd))}`);
}

// Checkout autofill: the saved details the browser agent fills into any
// order/address form. Nothing here is invented — only what is configured.
section("shopperProfile — saved details drive autofill");

const saved = { ...process.env };
process.env.JARVIS_PROFILE_PHONE = "9606571200";
process.env.JARVIS_PROFILE_EMAIL = "dhruvbijapur@gmail.com";
delete process.env.JARVIS_PROFILE_NAME;
delete process.env.JARVIS_PROFILE_ADDRESS;

const profile = getShopperProfile();
check("profile is returned when anything is set", profile !== null);
check("phone is carried through", profile?.phone === "9606571200", String(profile?.phone));
check("email is carried through", profile?.email === "dhruvbijapur@gmail.com", String(profile?.email));
const described = describeShopperProfile(profile);
check("phone appears in the prompt block", described.includes("9606571200"), described);
check("email appears in the prompt block", described.includes("dhruvbijapur@gmail.com"), described);
check("unset fields are not invented", !described.includes("Street address"), described);

for (const [k, v] of Object.entries(saved)) {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
