// Pure proximity model — types + heuristics. No I/O, no Next, no OS calls,
// so every rule here is unit-testable in isolation.
//
// Design rule: NEVER fabricate data. A value is either measured (latency, RSSI,
// open ports) or `null`. Distance is only produced from a real radio signal
// (RSSI) — reachability alone maps to a presence TIER, not metres.

import type { DeviceClass } from "./oui";

export type { DeviceClass };

/** Presence band used by automations (welcome / walk-away shield). */
export type ProximityZone = "immediate" | "room" | "perimeter" | "away";

/** How a device showed up in the most recent sweep. */
export type Reachability = "active" | "idle" | "offline";

export interface ProximityDevice {
  /** Stable key — prefer the MAC, fall back to the IP. */
  id: string;
  ip: string;
  /** "AA:BB:CC:DD:EE:FF" or null when the MAC was not resolved. */
  mac: string | null;
  /** 12 uppercase hex chars or null. */
  macHex: string | null;
  /** True when the MAC is locally administered (iOS/Android privacy MAC). */
  macRandomized: boolean;
  vendor: string | null;
  hostname: string | null;
  /** Machine-derived label (vendor + hostname + class). */
  autoName: string;
  /** User/learned label — wins over autoName when present. */
  label: string | null;
  /** label ?? autoName. */
  name: string;
  deviceClass: DeviceClass;
  /** 0..1 — how much we trust deviceClass. */
  classConfidence: number;
  isUserDevice: boolean;
  favorite: boolean;
  reachability: Reachability;
  /** ICMP round-trip in ms, or null when the host did not answer. */
  latencyMs: number | null;
  /** Measured RSSI in dBm, or null when no radio reading exists. */
  rssi: number | null;
  /** Metres derived from RSSI only — null without a radio reading. */
  distanceMeters: number | null;
  /** Round-trip ms reported by the phone beacon, or null. */
  rttMs: number | null;
  /** Phone model reported by the beacon (e.g. "SM-S928B"), or null. */
  beaconModel: string | null;
  /** True when the phone's presence beacon confirmed this device. */
  viaBeacon: boolean;
  /** 0..100 signal bar derived from RSSI — null without a radio reading. */
  signalStrength: number | null;
  proximityZone: ProximityZone;
  /** TCP ports that answered the light fingerprint probe. */
  openPorts: number[];
  firstSeen: number;
  lastSeen: number;
}

export interface ProximityEvent {
  id: string;
  type: "joined" | "left" | "returned" | "identity" | "presence";
  at: number;
  ip: string;
  name: string;
  mac: string | null;
  message: string;
}

export interface ProximityConfig {
  autoWelcome: boolean;
  autoLockOnLeave: boolean;
  /** Seconds the phone must stay missing before "left" fires. Default 90. */
  leaveGraceSeconds?: number;
  /** App ids (see src/lib/os/apps.cjs) launched when you arrive. */
  welcomeApps?: string[];
  /** MAC (hex) or IP of the device treated as "me". */
  beaconMac?: string;
  beaconIp?: string;
  /** Persisted RSSI calibration (see distanceFromRssi). */
  rssiRefDbm?: number;
  pathLossExponent?: number;
}

export interface ScanMeta {
  /** e.g. "192.168.1.0/24" */
  subnet: string;
  localIp: string;
  hostsSwept: number;
  activeCount: number;
  durationMs: number;
  at: number;
  /** True when discovery data is incomplete (e.g. ARP unavailable). */
  degraded: boolean;
  degradedReason?: string;
}

export interface ProximityPresence {
  state: "home" | "away" | "unknown";
  lastPresentAt: number;
  lastActionAt: number;
}

export interface ProximityScan {
  success: true;
  meta: ScanMeta;
  devices: ProximityDevice[];
  userDevice: ProximityDevice | null;
  events: ProximityEvent[];
  config: ProximityConfig;
  arrivalTriggered: boolean;
  announcement: string | null;
  /** Where the tracked phone is right now, and when it last changed. */
  presence?: ProximityPresence;
}

/* ----------------------------- ranging ----------------------------- */

export const DEFAULT_RSSI_REF_DBM = -59;
export const DEFAULT_PATH_LOSS_EXPONENT = 2.0;

/**
 * RSSI (dBm) → distance (m) via the log-distance path-loss model:
 *
 *   d = 10 ^ ((refDbm - rssi) / (10 * n))
 *
 * `refDbm` is the RSSI measured at 1 m and `n` the environment exponent
 * (2.0 free space, 2.7–3.5 indoors). Both are calibratable, so this is
 * honest model output rather than a guessed mapping.
 */
export function distanceFromRssi(
  rssi: number,
  refDbm: number = DEFAULT_RSSI_REF_DBM,
  pathLossExponent: number = DEFAULT_PATH_LOSS_EXPONENT
): number {
  const n = pathLossExponent > 0 ? pathLossExponent : DEFAULT_PATH_LOSS_EXPONENT;
  const d = Math.pow(10, (refDbm - rssi) / (10 * n));
  // Clamp to a sane indoor ceiling so a stray weak reading can't say 10km.
  return Math.round(Math.min(d, 100) * 10) / 10;
}

/** RSSI → 0..100 bar (roughly -30 dBm = 100%, -90 dBm = 0%). */
export function signalStrengthFromRssi(rssi: number): number {
  const clamped = Math.max(-90, Math.min(-30, rssi));
  return Math.round(((clamped + 90) / 60) * 100);
}

export function zoneForDistance(meters: number): ProximityZone {
  if (meters <= 0.8) return "immediate";
  if (meters <= 3) return "room";
  if (meters <= 7) return "perimeter";
  return "away";
}

/**
 * Presence band when only reachability is known (no radio). We deliberately
 * never return "immediate" here — you cannot claim sub-metre without ranging.
 */
export function zoneForPresence(reachability: Reachability): ProximityZone {
  if (reachability === "active") return "room";
  if (reachability === "idle") return "perimeter";
  return "away";
}

/**
 * Zone for a device. Measured distance wins; a beacon-confirmed phone is
 * definitely present (but sub-metre is never claimed without ranging).
 */
export function zoneForDevice(
  dev: Pick<ProximityDevice, "distanceMeters" | "reachability"> & { viaBeacon?: boolean }
): ProximityZone {
  if (dev.distanceMeters != null) return zoneForDistance(dev.distanceMeters);
  if (dev.viaBeacon) return "room";
  return zoneForPresence(dev.reachability);
}

/* ----------------------------- classification ----------------------------- */

const HOSTNAME_RULES: Array<{ re: RegExp; cls: DeviceClass; conf: number }> = [
  { re: /iphone/i, cls: "phone", conf: 0.95 },
  { re: /ipad/i, cls: "tablet", conf: 0.9 },
  { re: /\b(galaxy|sm-[a-z0-9]|redmi|poco|oneplus|pixel|moto|mi-?\d|vivo|oppo|realme|phone)\b/i, cls: "phone", conf: 0.85 },
  { re: /\b(tab|tablet)\b/i, cls: "tablet", conf: 0.8 },
  { re: /\b(macbook|mac-?pro|imac|thinkpad|latitude|inspiron|elitebook|vivobook|zenbook|desktop|laptop|pc)\b/i, cls: "computer", conf: 0.85 },
  { re: /\b(tv|bravia|roku|shield|chromecast)\b/i, cls: "tv", conf: 0.8 },
  { re: /\b(sonos|speaker|homepod|echo|alexa)\b/i, cls: "speaker", conf: 0.8 },
  { re: /\b(esp|esp32|esp8266|tasmota|shelly|smartplug|bulb)\b/i, cls: "iot", conf: 0.8 },
  { re: /\b(printer|laserjet|deskjet)\b/i, cls: "iot", conf: 0.7 },
  { re: /\b(router|gateway|ap-|access-?point|openwrt|fritz)\b/i, cls: "router", conf: 0.8 },
  { re: /\b(watch|band|fitbit|wear)\b/i, cls: "wearable", conf: 0.75 },
  { re: /\b(playstation|ps4|ps5|xbox|switch|console)\b/i, cls: "console", conf: 0.85 },
];

const PORT_HINTS: Array<{ port: number; cls: DeviceClass; conf: number }> = [
  { port: 62078, cls: "phone", conf: 0.75 },   // iOS lockdown
  { port: 7000, cls: "phone", conf: 0.6 },     // AirPlay
  { port: 8009, cls: "tv", conf: 0.6 },        // Chromecast
  { port: 5000, cls: "speaker", conf: 0.55 },  // AirPlay audio
  { port: 3389, cls: "computer", conf: 0.6 },  // RDP
  { port: 445, cls: "computer", conf: 0.45 },  // SMB
  { port: 9100, cls: "iot", conf: 0.5 },       // raw printing
];

/**
 * Combine vendor class, hostname keywords and open-port fingerprints into a
 * class + confidence. Evidence weight: hostname > ports > vendor (vendor is
 * broad — Apple makes phones, laptops AND TVs).
 */
export function classifyDevice(
  vendorClass: DeviceClass | null,
  hostname: string | null,
  openPorts: number[]
): { deviceClass: DeviceClass; classConfidence: number } {
  if (hostname) {
    for (const rule of HOSTNAME_RULES) {
      if (rule.re.test(hostname)) return { deviceClass: rule.cls, classConfidence: rule.conf };
    }
  }
  for (const hint of PORT_HINTS) {
    if (openPorts.includes(hint.port)) return { deviceClass: hint.cls, classConfidence: hint.conf };
  }
  if (vendorClass) return { deviceClass: vendorClass, classConfidence: 0.55 };
  return { deviceClass: "unknown", classConfidence: 0.1 };
}

/* ----------------------------- labels ----------------------------- */

const CLASS_LABEL: Record<DeviceClass, string> = {
  phone: "Phone",
  tablet: "Tablet",
  computer: "Computer",
  router: "Router",
  tv: "TV",
  speaker: "Speaker",
  console: "Console",
  iot: "Smart device",
  wearable: "Wearable",
  unknown: "Network device",
};

/** Best-effort automatic name. Never invents a model number we didn't see. */
export function buildAutoName(
  vendor: string | null,
  hostname: string | null,
  deviceClass: DeviceClass,
  ip: string
): string {
  const prettyHost = hostname?.replace(/\.(local|lan|home)$/i, "").trim();
  if (prettyHost && prettyHost.length <= 40 && !/^\d+$/.test(prettyHost)) return prettyHost;
  if (vendor && vendor !== "unknown") return `${vendor} ${CLASS_LABEL[deviceClass]}`.trim();
  return CLASS_LABEL[deviceClass] + ` · ${ip.split(".").slice(-1)[0]}`;
}

/* ----------------------------- change detection ----------------------------- */

/**
 * Compare the id sets of two consecutive sweeps.
 * `seenBefore` is every id ever observed (so re-appearing ≠ new).
 */
export function diffDevices(
  prevIds: Iterable<string>,
  nextIds: Iterable<string>,
  everSeen: Iterable<string>
): { joined: string[]; returned: string[]; left: string[] } {
  const prev = new Set(prevIds);
  const next = new Set(nextIds);
  const ever = new Set(everSeen);
  const joined: string[] = [];
  const returned: string[] = [];
  const left: string[] = [];
  for (const id of next) {
    if (prev.has(id)) continue;
    (ever.has(id) ? returned : joined).push(id);
  }
  for (const id of prev) if (!next.has(id)) left.push(id);
  return { joined, returned, left };
}
