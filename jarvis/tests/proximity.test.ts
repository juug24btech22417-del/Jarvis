// Tests for the proximity radar's pure model layer.
//
// Everything here is heuristic/math — no network, no OS, no Next. These lock
// in the "never fabricate data" rules: distance only from RSSI, presence tiers
// without ranging, and honest unknown vendors.
//
// Run with:  npx tsx tests/proximity.test.ts

import {
  normalizeMac,
  prettyMac,
  isLocallyAdministered,
  vendorForMac,
  classForVendor,
  OUI_ENTRY_COUNT,
} from "../src/lib/net/proximity/oui";
import {
  buildAutoName,
  classifyDevice,
  diffDevices,
  distanceFromRssi,
  signalStrengthFromRssi,
  zoneForDistance,
  zoneForDevice,
  zoneForPresence,
} from "../src/lib/net/proximity/model";
import {
  ARRIVE_DEBOUNCE_MS,
  DEFAULT_LEAVE_GRACE_SECONDS,
  evaluatePresence,
  resolvePresenceConfig,
  type PresenceSnapshot,
} from "../src/lib/net/proximity/presence";

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

/* ----------------------------- MAC helpers ----------------------------- */

section("MAC helpers");
check("normalizes dashes", normalizeMac("AC-84-C6-78-90-AB") === "AC84C67890AB", String(normalizeMac("AC-84-C6-78-90-AB")));
check("normalizes colons", normalizeMac("ac:84:c6:78:90:ab") === "AC84C67890AB");
check("rejects short input", normalizeMac("AC-84-C6") === null);
check("rejects garbage", normalizeMac("not-a-mac") === null);
check("prettyMac formats", prettyMac("AC84C67890AB") === "AC:84:C6:78:90:AB", prettyMac("AC84C67890AB"));

// Locally-administered bit = bit 1 of the first octet.
check("randomized MAC detected (DA:...)", isLocallyAdministered("DA1E5CAA11BB"));
check("randomized MAC detected (02:...)", isLocallyAdministered("02AABBCCDDEE"));
check("real OUI is not flagged randomized", !isLocallyAdministered("AC84C67890AB"));

/* ----------------------------- vendor ----------------------------- */

section("OUI vendor lookup");
check("Samsung prefix resolved", vendorForMac("8C7712AABBCC") === "Samsung");
check("Apple prefix resolved", vendorForMac("F099BFAABBCC") === "Apple");
check("Google prefix resolved", vendorForMac("F4F5D8AABBCC") === "Google");
check("Espressif prefix resolved", vendorForMac("240AC4AABBCC") === "Espressif");
check("unknown prefix returns null (never guesses)", vendorForMac("AAAAAAAAAAAA") === null);
check("vendor table is populated", OUI_ENTRY_COUNT > 100, String(OUI_ENTRY_COUNT));
check("vendor class maps phone", classForVendor("Samsung") === "phone");
check("vendor class maps router", classForVendor("TP-Link") === "router");

/* ----------------------------- ranging ----------------------------- */

section("ranging (RSSI only)");
{
  const ref = distanceFromRssi(-59); // 1 m by definition
  check("reference RSSI maps to ~1 m", ref >= 0.9 && ref <= 1.1, String(ref));
  const near = distanceFromRssi(-40);
  const far = distanceFromRssi(-80);
  check("stronger signal is closer", near < ref && ref < far, `${near} < ${ref} < ${far}`);
  check("distance is monotonic", distanceFromRssi(-70) < distanceFromRssi(-85), `${distanceFromRssi(-70)} < ${distanceFromRssi(-85)}`);
  check("path-loss exponent changes the curve", distanceFromRssi(-70, -59, 3.0) < distanceFromRssi(-70, -59, 2.0));
  check("distance is bounded", distanceFromRssi(-150) <= 100, String(distanceFromRssi(-150)));
}
check("signal bar: strong ≈ 100", signalStrengthFromRssi(-31) >= 95, String(signalStrengthFromRssi(-31)));
check("signal bar: weak ≈ 0", signalStrengthFromRssi(-89) <= 5, String(signalStrengthFromRssi(-89)));
check("signal bar is clamped 0..100", signalStrengthFromRssi(-200) === 0 && signalStrengthFromRssi(0) === 100);

/* ----------------------------- zones ----------------------------- */

section("zones");
check("sub-metre → immediate", zoneForDistance(0.5) === "immediate");
check("2 m → room", zoneForDistance(2) === "room");
check("5 m → perimeter", zoneForDistance(5) === "perimeter");
check("10 m → away", zoneForDistance(10) === "away");

check("active presence → room", zoneForPresence("active") === "room");
check("idle presence → perimeter", zoneForPresence("idle") === "perimeter");
check("offline presence → away", zoneForPresence("offline") === "away");
check("presence never claims immediate (no ranging)", zoneForPresence("active") !== "immediate");

check("measured distance wins", zoneForDevice({ distanceMeters: 0.5, reachability: "idle" }) === "immediate");
check("no distance falls back to presence", zoneForDevice({ distanceMeters: null, reachability: "active" }) === "room");

/* ----------------------------- classification ----------------------------- */

section("classifyDevice");
check("hostname beats broad vendor", classifyDevice("phone", "DESKTOP-8K3J21", []).deviceClass === "computer");
check("iPhone hostname → phone", classifyDevice("computer", "Dhruv-iPhone", []).deviceClass === "phone");
check("Galaxy hostname → phone", classifyDevice(null, "Galaxy-S24-Ultra", []).deviceClass === "phone");
check("port 62078 → phone", classifyDevice(null, null, [62078]).deviceClass === "phone");
check("port 3389 → computer", classifyDevice(null, null, [3389]).deviceClass === "computer");
check("vendor fallback → phone", classifyDevice("phone", null, []).deviceClass === "phone");
check("nothing known → unknown", classifyDevice(null, null, []).deviceClass === "unknown");
check("hostname confidence > vendor confidence", classifyDevice("phone", "Dhruv-iPhone", []).classConfidence > classifyDevice("phone", null, []).classConfidence);

/* ----------------------------- labels ----------------------------- */

section("buildAutoName");
check("prefers hostname", buildAutoName("Apple", "Dhruvs-iPhone.local", "phone", "192.168.1.5") === "Dhruvs-iPhone");
check("falls back to vendor + class", buildAutoName("Samsung", null, "phone", "192.168.1.5") === "Samsung Phone");
check("falls back to class + ip tail", buildAutoName(null, null, "unknown", "192.168.1.42").includes("42"));

/* ----------------------------- change detection ----------------------------- */

section("diffDevices");
{
  const a = diffDevices(["m1", "m2"], ["m2", "m3"], ["m1", "m2"]);
  check("new id → joined", a.joined.includes("m3"));
  check("missing id → left", a.left.includes("m1"));
  check("existing id is neither", !a.joined.includes("m2") && !a.left.includes("m2"));

  const b = diffDevices(["m2"], ["m2", "m1"], ["m1", "m2"]);
  check("re-appearing id → returned (not joined)", b.returned.includes("m1") && !b.joined.includes("m1"));

  const c = diffDevices([], ["x"], []);
  check("first ever sighting → joined", c.joined.includes("x"));
}

/* ----------------------------- presence automations ----------------------------- */

section("resolvePresenceConfig");
{
  const off = resolvePresenceConfig({ autoWelcome: false, autoLockOnLeave: false });
  check("no automation armed → disabled", !off.enabled);
  check("default grace is a minute and a half", off.leaveGraceSeconds === DEFAULT_LEAVE_GRACE_SECONDS);

  const on = resolvePresenceConfig({ autoLockOnLeave: true });
  check("either toggle arms it", on.enabled);

  check("absurd grace is clamped", resolvePresenceConfig({ autoWelcome: true, leaveGraceSeconds: 999999 }).leaveGraceSeconds === 3600);
  check("garbage grace falls back", resolvePresenceConfig({ autoWelcome: true, leaveGraceSeconds: -5 }).leaveGraceSeconds === DEFAULT_LEAVE_GRACE_SECONDS);
}

section("evaluatePresence");
{
  const cfg = { enabled: true, leaveGraceSeconds: 90 };
  const base = (over: Partial<PresenceSnapshot>): PresenceSnapshot => ({
    now: 1_000_000,
    present: true,
    everSeen: true,
    state: "unknown",
    lastPresentAt: 0,
    lastActionAt: 0,
    ...over,
  });

  // 1. First sighting while watching must not greet an empty room.
  const first = evaluatePresence(cfg, base({ present: true }));
  check("first sighting → home, no scene", first.state === "home" && first.action === null);
  check("first sighting records presence", first.lastPresentAt === 1_000_000);

  // 2. A glance away (under the grace) is not a departure.
  const brief = evaluatePresence(
    cfg,
    base({ now: 1_030_000, present: false, state: "home", lastPresentAt: 1_000_000 })
  );
  check("phone missing 30s → still home", brief.state === "home" && brief.action === null);
  check("absent time is reported", brief.absentForMs === 30_000);

  // 3. Missing past the grace → left, once.
  const gone = evaluatePresence(
    cfg,
    base({ now: 1_100_000, present: false, state: "home", lastPresentAt: 1_000_000, lastActionAt: 0 })
  );
  check("phone missing 100s → left", gone.state === "away" && gone.action === "left");
  check("left fires immediately after the grace, not later", gone.absentForMs === 100_000);

  // 4. Still absent → no repeat.
  const stillGone = evaluatePresence(
    cfg,
    base({ now: 1_140_000, present: false, state: gone.state, lastPresentAt: 1_000_000, lastActionAt: gone.lastActionAt })
  );
  check("staying away does not re-fire", stillGone.action === null);

  // 5. Coming back → arrived.
  const back = evaluatePresence(
    cfg,
    base({ now: 1_160_000, present: true, state: "away", lastPresentAt: 1_000_000, lastActionAt: gone.lastActionAt })
  );
  check("phone returns → arrived", back.state === "home" && back.action === "arrived");

  // 6. Leave/return chatter inside the debounce is absorbed.
  const chatter = evaluatePresence(
    cfg,
    base({
      now: gone.lastActionAt + 1000,
      present: true,
      state: "away",
      lastPresentAt: 1_000_000,
      lastActionAt: gone.lastActionAt,
    })
  );
  check("arrival inside the debounce is ignored", chatter.action === null);
  check("debounce window is a minute", ARRIVE_DEBOUNCE_MS === 60_000);

  // 7. A phone we have never seen can never "arrive".
  const unseen = evaluatePresence(cfg, base({ present: true, everSeen: false }));
  check("untracked phone never fires", unseen.state === "unknown" && unseen.action === null);

  // 8. Switched off → state still tracked, but nothing ever runs.
  const disabled = { enabled: false, leaveGraceSeconds: 90 };
  const offGone = evaluatePresence(
    disabled,
    base({ now: 1_100_000, present: false, state: "home", lastPresentAt: 1_000_000 })
  );
  check("disabled automation never locks", offGone.action === null && offGone.state === "home");
  const offBack = evaluatePresence(
    disabled,
    base({ now: 1_200_000, present: true, state: "away", lastPresentAt: 1_000_000 })
  );
  check("disabled automation never welcomes", offBack.action === null && offBack.state === "home");
}

/* ----------------------------- summary ----------------------------- */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
