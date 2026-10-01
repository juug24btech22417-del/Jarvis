// ProximityService — real LAN discovery for the proximity radar.
//
// Pipeline: subnet sweep (ICMP) → ARP table → enrichment (reverse DNS + light
// TCP fingerprint) → classification → learned identity → change detection.
//
// Everything is derived from live sources; there is no sample/fallback device
// list. When a source is unavailable (e.g. ARP fails) the scan is reported as
// `degraded` instead of inventing data. Distances only exist when a real RSSI
// reading has been supplied (see setRssi / the phone beacon).

import os from "os";
import net from "net";
import dns from "dns/promises";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { createSocket } from "dgram";
import { getLanIP, getLanNetwork } from "@/lib/net/lanIp";
import { phoneContactAgeMs, raisePhonePing } from "@/lib/os/phonePing";
import { runAwayScene, runWelcomeScene } from "@/lib/os/presence";
import { evaluatePresence, resolvePresenceConfig } from "@/lib/net/proximity/presence";
import { enumerateHosts } from "@/lib/net/proximity/netaddr";
import {
  normalizeMac,
  prettyMac,
  isLocallyAdministered,
  vendorForMac,
  classForVendor,
} from "@/lib/net/proximity/oui";
import {
  buildAutoName,
  classifyDevice,
  diffDevices,
  distanceFromRssi,
  signalStrengthFromRssi,
  zoneForDevice,
  type ProximityConfig,
  type ProximityDevice,
  type ProximityEvent,
  type ProximityScan,
  type Reachability,
} from "@/lib/net/proximity/model";

const execAsync = promisify(exec);

const DATA_DIR = path.join(process.cwd(), ".jarvis-data");
const STORE_FILE = path.join(DATA_DIR, "proximity.json");

/** Discovery results are cached so polling the panel doesn't re-sweep. */
const SCAN_TTL_MS = 20_000;
const PING_TIMEOUT_MS = 250;
/** How long we let the kernel finish ARP resolution after seeding. */
const ARP_SETTLE_MS = 900;
/** At most this many ICMP probes per sweep (found devices only, never the /22). */
const MAX_LATENCY_PROBES = 96;
const PING_CONCURRENCY = 16;
const DNS_TIMEOUT_MS = 300;
const PORT_TIMEOUT_MS = 220;
const MAX_FINGERPRINT_DEVICES = 12;
const FINGERPRINT_PORTS = [62078, 7000, 8009, 3389, 445];
const HISTORY_LIMIT = 120;
/** Upper bound on hosts in one sweep (a /22 = 1022; a /16 would be capped). */
const MAX_SWEEP_HOSTS = 4096;
/** The phone-remote broker runs on this fixed local port. */
const BROKER_BASE = process.env.JARVIS_BROKER_URL || "http://127.0.0.1:3311";

/* ----------------------------- persistence ----------------------------- */

interface IdentityRecord {
  label?: string;
  favorite?: boolean;
  firstSeen: number;
  lastSeen: number;
  vendor?: string | null;
  hostname?: string | null;
  lastIp?: string;
}

interface PresenceRecord {
  state: "home" | "away" | "unknown";
  lastPresentAt: number;
  lastActionAt: number;
  everSeen: boolean;
}

interface ProximityStore {
  identities: Record<string, IdentityRecord>;
  knownIds: string[];
  config: ProximityConfig;
  history: ProximityEvent[];
  presence?: PresenceRecord;
}

const DEFAULT_CONFIG: ProximityConfig = {
  autoWelcome: true,
  autoLockOnLeave: false,
};

const DEFAULT_STORE: ProximityStore = {
  identities: {},
  knownIds: [],
  config: { ...DEFAULT_CONFIG },
  history: [],
  presence: { state: "unknown", lastPresentAt: 0, lastActionAt: 0, everSeen: false },
};

/** How often the background watcher sweeps while automations are enabled. */
const PRESENCE_WATCH_MS = 20_000;

interface ProxGlobal {
  __jarvisProxStore?: ProximityStore;
  __jarvisProxLoaded?: boolean;
  __jarvisProxWriteTimer?: ReturnType<typeof setTimeout>;
  __jarvisProxScan?: ProximityScan;
  __jarvisProxScanAt?: number;
  /** Single-flight guard: never run two sweeps of the same subnet at once. */
  __jarvisProxInflight?: Promise<ProximityScan> | null;
  __jarvisProxLastIds?: string[];
  __jarvisProxEverSeen?: Set<string>;
  __jarvisProxLastZone?: ProximityZoneLite;
  __jarvisProxRssi?: Map<string, { rssi: number; at: number }>;
  /** Background sweep timer — keeps automations alive with no panel open. */
  __jarvisProxWatch?: ReturnType<typeof setInterval>;
  /** Which module instance owns that timer (see ensurePresenceWatch). */
  __jarvisProxWatchOwner?: object;
}

/**
 * Unique per module instance.
 *
 * In dev, editing this file gives Next a brand-new module while the previous
 * instance's setInterval is still running on globalThis — it would keep sweeping
 * with stale code and the new code would never take over. The owner token lets
 * the newest instance replace it instead.
 */
const WATCH_OWNER = {};
type ProximityZoneLite = "immediate" | "room" | "perimeter" | "away";

const g = globalThis as unknown as ProxGlobal;

function ensureLoaded(): ProximityStore {
  if (g.__jarvisProxLoaded && g.__jarvisProxStore) return g.__jarvisProxStore;
  let store: ProximityStore = { ...DEFAULT_STORE, identities: {}, knownIds: [], history: [] };
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STORE_FILE, "utf8")) as Partial<ProximityStore>;
      store = {
        identities: raw.identities ?? {},
        knownIds: raw.knownIds ?? [],
        config: { ...DEFAULT_CONFIG, ...(raw.config ?? {}) },
        history: raw.history ?? [],
        presence: raw.presence ?? DEFAULT_STORE.presence,
      };
    }
  } catch (e) {
    console.warn("[Proximity] store load failed:", (e as Error)?.message);
  }
  g.__jarvisProxStore = store;
  g.__jarvisProxLoaded = true;
  if (!g.__jarvisProxEverSeen) g.__jarvisProxEverSeen = new Set(store.knownIds);
  return store;
}

function flushStore(store: ProximityStore): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    // Keep the known-id list bounded so the file can't grow forever.
    store.knownIds = store.knownIds.slice(-500);
    store.history = store.history.slice(-HISTORY_LIMIT);
    const tmp = `${STORE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store), "utf8");
    fs.renameSync(tmp, STORE_FILE);
  } catch (e) {
    console.warn("[Proximity] store persist failed:", (e as Error)?.message);
  }
}

function persistSoon(store: ProximityStore): void {
  if (g.__jarvisProxWriteTimer) return;
  g.__jarvisProxWriteTimer = setTimeout(() => {
    g.__jarvisProxWriteTimer = undefined;
    flushStore(store);
  }, 400);
}

/* ----------------------------- helpers ----------------------------- */

/** Run `worker` over `items` with a bounded number in flight. */
async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return out;
}

function pingArgs(ip: string): string {
  if (process.platform === "win32") return `ping -n 1 -w ${PING_TIMEOUT_MS} ${ip}`;
  if (process.platform === "darwin") return `ping -c 1 -W ${PING_TIMEOUT_MS} ${ip}`;
  return `ping -c 1 -W 1 ${ip}`;
}

/**
 * Populate the OS ARP cache for a whole subnet without a process per host.
 *
 * This is the fix for the sweep being unusably slow: spawning `ping` for all
 * 1022 addresses meant 1022 child processes, which starves the event loop and
 * blocks every other request in the server. A UDP datagram is fire-and-forget,
 * and the kernel still has to resolve ARP for the destination — so live hosts
 * land in the ARP table within ~1s while we spend no time waiting on replies.
 * Absent hosts simply never produce an entry, which is exactly the signal.
 */
function seedArp(hosts: string[], ports: number[] = [9, 33434]): Promise<void> {
  return new Promise((resolve) => {
    let socket: ReturnType<typeof createSocket> | null = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        socket?.close();
      } catch {
        /* already closed */
      }
      resolve();
    };
    try {
      socket = createSocket({ type: "udp4", reuseAddr: true });
    } catch {
      finish();
      return;
    }
    const payload = Buffer.from([0]);
    const fire = () => {
      for (const ip of hosts) {
        for (const port of ports) {
          try {
            socket!.send(payload, 0, payload.length, port, ip, () => {});
          } catch {
            /* per-host failures are expected and meaningless here */
          }
        }
      }
      // Let ARP resolution settle, then read the table.
      setTimeout(finish, ARP_SETTLE_MS);
    };
    socket.once("error", finish);
    socket.bind(0, fire);
    // Hard stop: a stuck socket must never hang the sweep.
    setTimeout(finish, ARP_SETTLE_MS + 1500);
  });
}

/** ICMP echo. Returns null when unreachable (never a fabricated latency). */
async function pingHost(ip: string): Promise<number | null> {
  try {
    const start = Date.now();
    const { stdout } = await execAsync(pingArgs(ip), { timeout: PING_TIMEOUT_MS + 400, windowsHide: true });
    const m = stdout.match(/time[=<]\s*(\d+(?:\.\d+)?)\s*ms/i);
    if (m) return Math.max(1, Math.round(parseFloat(m[1])));
    // Some stacks answer without a time= field; fall back to measured wall time.
    return Math.max(1, Date.now() - start);
  } catch {
    return null;
  }
}

/** Parse `arp -a` / `arp -n` across Windows, Linux and macOS. */
async function arpTable(): Promise<{ entries: Map<string, string>; ok: boolean }> {
  const entries = new Map<string, string>();
  try {
    const { stdout } = await execAsync("arp -a", { timeout: 5000, windowsHide: true });
    for (const rawLine of stdout.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      // Windows: "  192.168.1.1    ac-84-c6-78-90-ab   dynamic"
      const win = line.match(/^(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F]{2}(?:[-:][0-9a-fA-F]{2}){5})\s+\w+/);
      // Unix:    "? (192.168.1.1) at ac:84:c6:78:90:ab [ether] on wlan0"
      const unix = line.match(/\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})/);
      const m = win ?? unix;
      if (!m) continue;
      const macHex = normalizeMac(m[2]);
      if (!macHex || /^0{12}$/.test(macHex)) continue; // skip all-zero / broadcast
      entries.set(m[1], macHex);
    }
    return { entries, ok: true };
  } catch {
    return { entries, ok: false };
  }
}

/** Reverse DNS with a hard timeout — most home devices won't resolve. */
async function reverseDns(ip: string): Promise<string | null> {
  try {
    const names = await Promise.race([
      dns.reverse(ip),
      new Promise<string[]>((resolve) => setTimeout(() => resolve([]), DNS_TIMEOUT_MS)),
    ]);
    const name = names?.[0];
    return name ? name.replace(/\.$/, "") : null;
  } catch {
    return null;
  }
}

/** Light TCP fingerprint — which of a few ports answer. Never blocks long. */
function probePort(ip: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(PORT_TIMEOUT_MS);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, ip);
  });
}

async function fingerprint(ip: string): Promise<number[]> {
  const results = await Promise.all(FINGERPRINT_PORTS.map((p) => probePort(ip, p).then((open) => (open ? p : 0))));
  return results.filter((p) => p > 0);
}

function zoneOf(dev: Pick<ProximityDevice, "distanceMeters" | "reachability"> & { viaBeacon?: boolean }): ProximityZoneLite {
  return zoneForDevice(dev);
}

/* ----------------------------- phone beacon ----------------------------- */

interface BrokerBeacon {
  ip: string;
  beaconId?: string;
  model?: string | null;
  label?: string | null;
  platform?: string | null;
  connection?: string | null;
  downlinkMbps?: number | null;
  rttMs?: number | null;
  /** Real dBm, present only when the phone could actually read the radio. */
  rssi?: number | null;
  battery?: number | null;
  batteryCharging?: boolean | null;
  at?: number;
}

/** Normalise an IPv4 that may arrive as "::ffff:172.16.0.20". */
function normalizeIp(ip: string | undefined | null): string {
  if (!ip) return "";
  return ip.replace(/^::ffff:/i, "").trim();
}

/**
 * Pull the phone beacon from the remote broker. Best-effort: if the broker is
 * not running this returns [], and the sweep simply has no beacon data.
 */
async function fetchBrokerBeacons(): Promise<BrokerBeacon[]> {
  try {
    const res = await fetch(`${BROKER_BASE}/api/beacon`, {
      signal: AbortSignal.timeout(900),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { beacons?: BrokerBeacon[] };
    if (!Array.isArray(data?.beacons)) return [];
    return data.beacons
      .map((b) => ({ ...b, ip: normalizeIp(b.ip) }))
      .filter((b) => !!b.ip);
  } catch {
    return [];
  }
}

/** Live view of the phone remote, so the UI can say whether it is reachable. */
export interface RemoteStatus {
  url: string;
  phoneConnected: boolean;
  lastPhonePollMs: number | null;
  beaconCount: number;
  ringing: boolean;
}

/**
 * Ask the broker whether a phone is actually connected. Returns null when the
 * broker isn't running (which is exactly the case the UI needs to explain).
 */
export async function getRemoteStatus(): Promise<RemoteStatus | null> {
  // The phone may be on the broker's /remote page OR the /teleport page. The
  // teleport page can't be detected from the socket, so it records its own
  // contact through the shared ping state instead.
  const teleportAgeMs = phoneContactAgeMs();
  const teleportConnected = teleportAgeMs != null && teleportAgeMs < 15_000;
  try {
    const res = await fetch(`${BROKER_BASE}/api/status`, {
      signal: AbortSignal.timeout(900),
      cache: "no-store",
    });
    if (!res.ok) throw new Error("broker down");
    const d = (await res.json()) as Partial<RemoteStatus> & { success?: boolean };
    if (!d?.success || !d.url) throw new Error("bad status");
    return {
      url: d.url,
      phoneConnected: !!d.phoneConnected || teleportConnected,
      lastPhonePollMs: d.lastPhonePollMs ?? teleportAgeMs,
      beaconCount: d.beaconCount ?? 0,
      ringing: !!d.ringing,
    };
  } catch {
    // The broker starts lazily, so a down broker is normal until the first
    // ring. A phone that checked in through /teleport is still connected.
    return {
      url: `http://${getLanIP()}:3311/remote`,
      phoneConnected: teleportConnected,
      lastPhonePollMs: teleportAgeMs,
      beaconCount: 0,
      ringing: false,
    };
  }
}

/**
 * "Find my phone": raise a ping on the broker so the phone page rings.
 * Retries briefly, because the very first call is often the one that starts
 * the broker — the socket may not be listening for the first ~200ms.
 */
export async function ringPhone(retries = 4): Promise<boolean> {
  // The phone may have either surface open: the broker's /remote page (polled
  // via /api/ping) or the /teleport page (polled via /api/teleport?pingCheck=1).
  // Raise both so a ring lands whichever one is on screen.
  raisePhonePing();
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${BROKER_BASE}/api/ping`, {
        method: "POST",
        signal: AbortSignal.timeout(1200),
      });
      if (res.ok) return true;
    } catch {
      /* broker not up yet — retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/* ----------------------------- identity ----------------------------- */

function sortDevices(devices: ProximityDevice[]): void {
  devices.sort((a, b) => {
    if (a.isUserDevice !== b.isUserDevice) return a.isUserDevice ? -1 : 1;
    if (a.reachability !== b.reachability) return a.reachability === "active" ? -1 : 1;
    return a.ip.localeCompare(b.ip, undefined, { numeric: true });
  });
}

/**
 * Re-derive identity/label/ranging on the cached scan so a rename, favourite
 * or RSSI reading appears instantly — without paying for a fresh 5s sweep.
 */
function patchCachedScan(): void {
  const result = g.__jarvisProxScan;
  if (!result) return;
  const store = ensureLoaded();
  const beaconMac = (store.config.beaconMac ?? "").toUpperCase();
  const beaconIp = store.config.beaconIp ?? "";
  for (const d of result.devices) {
    const rec = store.identities[d.id];
    d.label = rec?.label ?? null;
    d.name = rec?.label?.trim() || d.autoName;
    d.favorite = !!rec?.favorite;
    d.isUserDevice =
      (!!beaconMac && d.macHex === beaconMac) || (!!beaconIp && d.ip === beaconIp);
    // A beacon-supplied RSSI lives on the device itself (the beacon map is only
    // consulted during a sweep), so keep it while the reading is still fresh.
    const rssi =
      rssiFor(d.id, d.ip, d.macHex) ??
      (d.viaBeacon && d.rssi != null && Date.now() - d.lastSeen < 30_000 ? d.rssi : null);
    d.rssi = rssi;
    d.distanceMeters = rssi != null ? distanceFromRssi(rssi, store.config.rssiRefDbm, store.config.pathLossExponent) : null;
    d.signalStrength = rssi != null ? signalStrengthFromRssi(rssi) : null;
    d.proximityZone = zoneOf({ distanceMeters: d.distanceMeters, reachability: d.reachability, viaBeacon: d.viaBeacon });
  }
  sortDevices(result.devices);
  result.userDevice = result.devices.find((d) => d.isUserDevice) ?? null;
  result.config = store.config;
}

export function setLabel(id: string, label: string): void {
  const store = ensureLoaded();
  const rec = (store.identities[id] ??= { firstSeen: Date.now(), lastSeen: Date.now() });
  const trimmed = label.trim();
  if (trimmed) rec.label = trimmed.slice(0, 48);
  else delete rec.label;
  rec.lastSeen = Date.now();
  persistSoon(store);
  patchCachedScan();
}

export function toggleFavorite(id: string): boolean {
  const store = ensureLoaded();
  const rec = (store.identities[id] ??= { firstSeen: Date.now(), lastSeen: Date.now() });
  rec.favorite = !rec.favorite;
  persistSoon(store);
  patchCachedScan();
  return !!rec.favorite;
}

export function setBeacon(id: string, kind: "mac" | "ip"): void {
  const store = ensureLoaded();
  // Exactly one identity: matching is an OR, so leaving the other one set meant
  // "my device" could never be moved (or cleared) once it had been picked.
  if (kind === "mac") {
    store.config.beaconMac = id.toUpperCase();
    store.config.beaconIp = "";
  } else {
    store.config.beaconIp = id;
    store.config.beaconMac = "";
  }
  persistSoon(store);
  patchCachedScan();
}

export function updateConfig(patch: Partial<ProximityConfig>): ProximityConfig {
  const store = ensureLoaded();
  store.config = { ...store.config, ...patch };
  persistSoon(store);
  patchCachedScan();
  // Start or stop the background watcher to match what is now armed.
  ensurePresenceWatch();
  return store.config;
}

export function getConfig(): ProximityConfig {
  return ensureLoaded().config;
}

/** Record an RSSI reading (e.g. from the phone beacon) → enables real ranging. */
export function setRssi(id: string, rssi: number): void {
  if (!Number.isFinite(rssi) || rssi > 0 || rssi < -120) return;
  if (!g.__jarvisProxRssi) g.__jarvisProxRssi = new Map();
  g.__jarvisProxRssi.set(id.toUpperCase(), { rssi, at: Date.now() });
  // Reflect the reading on the cached scan instantly (no re-sweep needed).
  patchCachedScan();
}

function rssiFor(id: string, ip: string, macHex: string | null): number | null {
  const map = g.__jarvisProxRssi;
  if (!map) return null;
  // A reading older than 30s is stale.
  const fresh = (rec?: { rssi: number; at: number }) =>
    rec && Date.now() - rec.at < 30_000 ? rec.rssi : null;
  return (
    (macHex ? fresh(map.get(macHex)) : null) ??
    fresh(map.get(ip.toUpperCase())) ??
    null
  );
}

/* ----------------------------- the sweep ----------------------------- */

function buildDevice(
  ip: string,
  macHex: string | null,
  reachability: Reachability,
  latencyMs: number | null,
  hostname: string | null,
  openPorts: number[],
  store: ProximityStore,
  localIp: string,
  beacon: BrokerBeacon | null
): ProximityDevice {
  const mac = macHex ? prettyMac(macHex) : null;
  const macRandomized = macHex ? isLocallyAdministered(macHex) : false;
  const isSelf = ip === localIp;
  // The beacon's reported model rescues identity when the MAC is randomised.
  const beaconVendor = beacon?.model
    ? /SM-|Galaxy|Samsung/i.test(beacon.model) ? "Samsung"
      : /iPhone|iPad/i.test(beacon.model) ? "Apple"
      : /Pixel/i.test(beacon.model) ? "Google"
      : /Redmi|POCO|Xiaomi/i.test(beacon.model) ? "Xiaomi"
      : null
    : null;
  const vendor = (macHex && !macRandomized ? vendorForMac(macHex) : null) ?? beaconVendor;
  const vendorClass = classForVendor(vendor);
  const { deviceClass, classConfidence } = isSelf
    ? { deviceClass: "computer" as const, classConfidence: 1 }
    : beacon
      ? { deviceClass: "phone" as const, classConfidence: 0.9 }
      : classifyDevice(vendorClass, hostname, openPorts);
  const autoName = isSelf
    ? "This PC (JARVIS)"
    : beacon?.label?.trim() || buildAutoName(vendor, hostname, deviceClass, ip);
  const id = macHex ?? ip;

  // A beacon reading is the strongest signal source we have: it comes straight
  // from the phone, beats any manually posted value, and enables real ranging.
  const beaconRssi =
    beacon?.rssi != null && Number.isFinite(beacon.rssi) && beacon.rssi < 0 ? beacon.rssi : null;
  const rssi = beaconRssi ?? rssiFor(id, ip, macHex);
  const distanceMeters = rssi != null
    ? distanceFromRssi(rssi, store.config.rssiRefDbm, store.config.pathLossExponent)
    : null;
  const signalStrength = rssi != null ? signalStrengthFromRssi(rssi) : null;
  const viaBeacon = !!beacon;
  const rttMs = beacon?.rttMs != null && Number.isFinite(beacon.rttMs) ? Math.round(beacon.rttMs) : null;
  const beaconModel = beacon?.model?.trim() || null;

  const zone = zoneOf({ distanceMeters, reachability, viaBeacon });

  const rec = store.identities[id];
  const beaconMac = store.config.beaconMac;
  const beaconIp = store.config.beaconIp;
  // "My device" means the beacon you picked, and nothing else: a favourite is
  // just a favourite, otherwise starring a device silently made it your phone.
  const isUserDevice =
    (!!beaconMac && macHex === beaconMac.toUpperCase()) || (!!beaconIp && ip === beaconIp);

  return {
    id,
    ip,
    mac,
    macHex,
    macRandomized,
    vendor,
    hostname,
    autoName,
    label: rec?.label ?? null,
    name: rec?.label?.trim() || autoName,
    deviceClass,
    classConfidence,
    isUserDevice,
    favorite: !!rec?.favorite,
    reachability,
    latencyMs,
    rssi,
    distanceMeters,
    rttMs,
    beaconModel,
    viaBeacon,
    signalStrength,
    proximityZone: zone,
    openPorts,
    firstSeen: rec?.firstSeen ?? Date.now(),
    lastSeen: Date.now(),
  };
}

interface ScanOptions {
  /** Ignore the cache and run a fresh sweep. */
  force?: boolean;
}

/**
 * Single-flight wrapper around the sweep. A /22 takes ~20s, and the panel polls
 * every few seconds, so two concurrent sweeps would pile up and stall the UI.
 */
async function sweep(): Promise<ProximityScan> {
  const existing = g.__jarvisProxInflight;
  if (existing) return existing;
  const running = runSweep();
  g.__jarvisProxInflight = running;
  try {
    return await running;
  } finally {
    if (g.__jarvisProxInflight === running) g.__jarvisProxInflight = null;
  }
}

export async function scan(opts: ScanOptions = {}): Promise<ProximityScan> {
  const cached = g.__jarvisProxScan;
  const age = g.__jarvisProxScanAt ? Date.now() - g.__jarvisProxScanAt : Infinity;

  // Fresh enough → instant, no work at all.
  if (cached && !opts.force && age < SCAN_TTL_MS) return cached;

  // Stale but present → serve it immediately and re-sweep in the background.
  // Making the caller wait ~20s is what made every button feel broken.
  if (cached && !opts.force) {
    void sweep().catch(() => {});
    return cached;
  }

  // Explicit refresh → the caller asked to wait for a real sweep.
  return sweep();
}

async function runSweep(): Promise<ProximityScan> {
  const store = ensureLoaded();

  const started = Date.now();
  const netinfo = getLanNetwork();
  const localIp = netinfo?.ip ?? getLanIP();
  const degradedReasons: string[] = [];
  if (netinfo?.truncated) degradedReasons.push(`Subnet larger than ${MAX_SWEEP_HOSTS} hosts — sweep truncated`);

  if (!localIp || localIp === "localhost" || !netinfo) {
    const empty: ProximityScan = {
      success: true,
      meta: {
        subnet: "unknown",
        localIp,
        hostsSwept: 0,
        activeCount: 0,
        durationMs: 0,
        at: Date.now(),
        degraded: true,
        degradedReason: "No LAN interface detected",
      },
      devices: [],
      userDevice: null,
      events: [],
      config: store.config,
      arrivalTriggered: false,
      announcement: null,
    };
    g.__jarvisProxScan = empty;
    g.__jarvisProxScanAt = Date.now();
    return empty;
  }

  // Sweep the interface's REAL subnet (a /22 here, not a /24).
  const hosts = enumerateHosts(netinfo.ip, netinfo.cidr, MAX_SWEEP_HOSTS);

  // Pull any phone beacon before enriching so the phone can be matched by IP.
  const beacons = await fetchBrokerBeacons();
  const beaconByIp = new Map(beacons.map((b) => [normalizeIp(b.ip), b]));
  // A beacon that has never been set becomes the default "my device".
  if (!store.config.beaconIp && beacons[0]?.ip) store.config.beaconIp = beacons[0].ip;

  // 1. ARP-seeded discovery — see seedArp. No child process per host.
  await seedArp(hosts);

  // 2. ARP table is the authoritative IP↔MAC mapping for the subnet.
  const { entries: arp, ok: arpOk } = await arpTable();
  if (!arpOk) degradedReasons.push("ARP table unavailable");

  // 3. A host is a device when the OS holds a MAC for it — proof it answered
  //    ARP moments ago. Reachability is refined below with real probes.
  const candidates: Array<{ ip: string; macHex: string | null; reachability: Reachability; latency: number | null }> = [];
  hosts.forEach((ip) => {
    const macHex = arp.get(ip) ?? null;
    if (!macHex) return;
    candidates.push({ ip, macHex, reachability: "idle", latency: null });
  });
  // Our own machine is always present, even though it has no ARP entry.
  if (!candidates.some((c) => c.ip === localIp)) {
    candidates.push({ ip: localIp, macHex: arp.get(localIp) ?? null, reachability: "active", latency: null });
  }

  // A beaconing phone is proof of presence even if it ignored ARP.
  for (const b of beacons) {
    const bip = normalizeIp(b.ip);
    if (!bip) continue;
    const known = candidates.find((c) => c.ip === bip);
    if (known) {
      known.reachability = "active";
      continue;
    }
    candidates.push({ ip: bip, macHex: arp.get(bip) ?? null, reachability: "active", latency: null });
  }

  // 4. Confirm + measure only the devices that exist (a few dozen, not 1022).
  await mapLimit(candidates.slice(0, MAX_LATENCY_PROBES), PING_CONCURRENCY, async (c) => {
    c.latency = await pingHost(c.ip);
    if (c.latency != null) c.reachability = "active";
  });

  // 5. Enrich the reachable devices (bounded) — reverse DNS + port fingerprint.
  const activeForProbe = candidates.filter((c) => c.reachability === "active").slice(0, MAX_FINGERPRINT_DEVICES);
  const enriched = new Map<string, { hostname: string | null; openPorts: number[] }>();
  await mapLimit(activeForProbe, 8, async (c) => {
    const [hostname, openPorts] = await Promise.all([reverseDns(c.ip), fingerprint(c.ip)]);
    if (openPorts.length) c.reachability = "active";
    enriched.set(c.ip, { hostname, openPorts });
  });

  // 5. Build typed devices.
  const devices: ProximityDevice[] = candidates.map((c) =>
    buildDevice(
      c.ip,
      c.macHex,
      c.reachability,
      c.latency,
      enriched.get(c.ip)?.hostname ?? null,
      enriched.get(c.ip)?.openPorts ?? [],
      store,
      localIp,
      beaconByIp.get(c.ip) ?? null
    )
  );

  // Stable ordering: user device first, then active, then vendor, then IP.
  devices.sort((a, b) => {
    if (a.isUserDevice !== b.isUserDevice) return a.isUserDevice ? -1 : 1;
    if (a.reachability !== b.reachability) return a.reachability === "active" ? -1 : 1;
    return a.ip.localeCompare(b.ip, undefined, { numeric: true });
  });

  // 6. Identity bookkeeping + change detection.
  const nextIds = devices.map((d) => d.id);
  const prevIds = g.__jarvisProxLastIds ?? [];
  const everSeen = (g.__jarvisProxEverSeen ??= new Set(store.knownIds));
  const { joined, returned, left } = diffDevices(prevIds, nextIds, everSeen);

  const events: ProximityEvent[] = [];
  const now = Date.now();
  const nameOf = (id: string) => devices.find((d) => d.id === id)?.name ?? id;
  for (const id of joined) {
    const d = devices.find((x) => x.id === id)!;
    events.push({ id: `ev_${now}_${id}`, type: "joined", at: now, ip: d.ip, name: d.name, mac: d.mac, message: `${d.name} joined the network (${d.ip})` });
  }
  for (const id of returned) {
    const d = devices.find((x) => x.id === id)!;
    events.push({ id: `ev_${now}_${id}`, type: "returned", at: now, ip: d.ip, name: d.name, mac: d.mac, message: `${d.name} is back in range` });
  }
  for (const id of left) {
    events.push({ id: `ev_${now}_${id}`, type: "left", at: now, ip: "", name: nameOf(id), mac: null, message: `${nameOf(id)} left the network` });
  }

  // Persist identity first/last-seen (and learn IP/vendor as we go).
  for (const d of devices) {
    const rec = (store.identities[d.id] ??= { firstSeen: now, lastSeen: now });
    rec.lastSeen = now;
    rec.lastIp = d.ip;
    rec.vendor = d.vendor;
    rec.hostname = d.hostname;
    if (!store.knownIds.includes(d.id)) store.knownIds.push(d.id);
    everSeen.add(d.id);
  }
  // 7. Presence automations — the phone is the tracked device. Transitions are
  //    judged by a pure evaluator, then the scene actually runs.
  const userDevice = devices.find((d) => d.isUserDevice) ?? null;
  let arrivalTriggered = false;
  let announcement: string | null = null;

  const presCfg = resolvePresenceConfig(store.config);
  const presence = (store.presence ??= {
    state: "unknown",
    lastPresentAt: 0,
    lastActionAt: 0,
    everSeen: false,
  });
  if (userDevice) presence.everSeen = true;

  const decision = evaluatePresence(
    { enabled: presCfg.enabled, leaveGraceSeconds: presCfg.leaveGraceSeconds },
    {
      now,
      present: !!userDevice,
      everSeen: presence.everSeen,
      state: presence.state,
      lastPresentAt: presence.lastPresentAt,
      lastActionAt: presence.lastActionAt,
    }
  );
  presence.state = decision.state;
  presence.lastPresentAt = decision.lastPresentAt;
  presence.lastActionAt = decision.lastActionAt;

  if (decision.action === "arrived" && store.config.autoWelcome) {
    const scene = await runWelcomeScene(store.config.welcomeApps ?? []);
    arrivalTriggered = true;
    announcement = scene.message;
    events.push({
      id: `ev_${now}_presence_arrived`,
      type: "presence",
      at: now,
      ip: userDevice?.ip ?? "",
      name: userDevice?.name ?? "Phone",
      mac: userDevice?.mac ?? null,
      message: scene.message,
    });
  } else if (decision.action === "left" && store.config.autoLockOnLeave) {
    const scene = await runAwayScene();
    announcement = scene.message;
    events.push({
      id: `ev_${now}_presence_left`,
      type: "presence",
      at: now,
      ip: "",
      name: "Phone",
      mac: null,
      message: scene.message,
    });
  }

  if (events.length) store.history.push(...events);
  g.__jarvisProxLastIds = nextIds;
  persistSoon(store);

  const result: ProximityScan = {
    success: true,
    meta: {
      subnet: `${netinfo.network}/${netinfo.cidr}`,
      localIp,
      hostsSwept: hosts.length,
      activeCount: devices.filter((d) => d.reachability === "active").length,
      durationMs: Date.now() - started,
      at: Date.now(),
      degraded: degradedReasons.length > 0,
      degradedReason: degradedReasons[0],
    },
    devices,
    userDevice,
    events,
    config: store.config,
    arrivalTriggered,
    announcement,
    presence: {
      state: presence.state,
      lastPresentAt: presence.lastPresentAt,
      lastActionAt: presence.lastActionAt,
    },
  };

  g.__jarvisProxScan = result;
  g.__jarvisProxScanAt = Date.now();
  ensurePresenceWatch();
  return result;
}

/**
 * Keep sweeping while an automation is armed, even with no panel open —
 * otherwise "lock when I walk away" only works while you are looking at it.
 */
function ensurePresenceWatch(): void {
  const store = ensureLoaded();
  const { enabled } = resolvePresenceConfig(store.config);
  if (!enabled) {
    if (g.__jarvisProxWatch) {
      clearInterval(g.__jarvisProxWatch);
      g.__jarvisProxWatch = undefined;
    }
    return;
  }
  if (g.__jarvisProxWatch && g.__jarvisProxWatchOwner === WATCH_OWNER) return;
  // Replace a timer left behind by an older module instance.
  if (g.__jarvisProxWatch) clearInterval(g.__jarvisProxWatch);
  g.__jarvisProxWatch = setInterval(() => {
    void scan().catch(() => {});
  }, PRESENCE_WATCH_MS);
  g.__jarvisProxWatchOwner = WATCH_OWNER;
}

/** Current presence state, for the UI. */
export function getPresence(): PresenceRecord {
  const store = ensureLoaded();
  return (
    store.presence ?? { state: "unknown", lastPresentAt: 0, lastActionAt: 0, everSeen: false }
  );
}

export function getHistory(): ProximityEvent[] {
  return ensureLoaded().history.slice(-HISTORY_LIMIT).reverse();
}
