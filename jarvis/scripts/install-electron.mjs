/**
 * Install / REPAIR the Electron binary that the stealth overlay runs in.
 *
 * WHY THIS EXISTS
 * ---------------
 * `npm install electron` downloads a ~115MB zip and then extracts it into
 * node_modules/electron/dist. On a flaky connection the EXTRACT step is what
 * dies — and it leaves a half-populated `dist/` behind. From then on
 * `npm install` is useless: electron's postinstall sees the package folder and
 * prints "up to date", while `require('electron')` throws
 * "Electron failed to install correctly, please delete node_modules/electron
 * and try installing again". That is a 115MB re-download for a 3-second
 * extraction problem.
 *
 * So this script does the two things npm won't:
 *   1. treats a dist/ without electron.exe (or a stale path.txt) as BROKEN and
 *      wipes it, instead of trusting the folder's existence;
 *   2. reuses the already-downloaded zip from Electron's own cache — and, if
 *      it's missing, downloads it resumably from a mirror that works on
 *      networks where GitHub release downloads stall.
 *
 * Usage:
 *   node scripts/install-electron.mjs            # install or repair
 *   node scripts/install-electron.mjs --check    # report only, exit 1 if broken
 *   ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node scripts/...
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ELECTRON_DIR = path.join(ROOT, "node_modules", "electron");
const DIST_DIR = path.join(ELECTRON_DIR, "dist");
const CHECK_ONLY = process.argv.includes("--check");

const log = (msg) => console.log(`[electron] ${msg}`);
const fail = (msg) => {
  console.error(`[electron] ${msg}`);
  process.exit(1);
};

// ── What "installed" means, straight from electron's own install.js ─────────
function platformPath() {
  switch (process.platform) {
    case "darwin":
    case "mas":
      return path.join("Electron.app", "Contents", "MacOS", "Electron");
    case "win32":
      return "electron.exe";
    default:
      return "electron";
  }
}

function installedStatus(version) {
  const binRel = process.env.ELECTRON_OVERRIDE_DIST_PATH || platformPath();
  const binAbs = path.isAbsolute(binRel) ? binRel : path.join(DIST_DIR, binRel);
  try {
    const distVersion = fs
      .readFileSync(path.join(DIST_DIR, "version"), "utf-8")
      .replace(/^v/, "");
    if (distVersion !== version) {
      return { ok: false, why: `dist/version is ${distVersion}, expected ${version}` };
    }
    const text = fs
      .readFileSync(path.join(ELECTRON_DIR, "path.txt"), "utf-8")
      .replace(/\r?\n$/, "");
    if (text !== platformPath()) {
      return { ok: false, why: `path.txt is "${text}", expected "${platformPath()}"` };
    }
    if (!fs.existsSync(binAbs)) {
      return { ok: false, why: `${binAbs} is missing` };
    }
    return { ok: true, bin: binAbs };
  } catch (e) {
    return { ok: false, why: e.code === "ENOENT" ? "no dist/version or path.txt" : String(e.message) };
  }
}

// ── Find an already-downloaded zip so we never re-download needlessly ───────
function cacheDirs() {
  const dirs = [];
  if (process.env.ELECTRON_CACHE) dirs.push(process.env.ELECTRON_CACHE);
  if (process.env.electron_config_cache) dirs.push(process.env.electron_config_cache);
  if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, "electron", "Cache"));
  if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, "electron", "Cache"));
  dirs.push(path.join(ROOT, "node_modules", ".cache", "electron"));
  dirs.push(os.tmpdir());
  return dirs;
}

function findCachedZip(file) {
  for (const dir of cacheDirs()) {
    // Electron's cache nests each artifact in a hash of its download URL.
    const candidates = [path.join(dir, file)];
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) candidates.push(path.join(dir, entry.name, file));
      }
    } catch {
      /* cache dir may not exist */
    }
    for (const candidate of candidates) {
      try {
        const { size } = fs.statSync(candidate);
        if (size > 20 * 1024 * 1024) return candidate;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

// ── Resumable download from a working mirror ───────────────────────────────
function fetchOnce(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("http:") ? http : https;
    const req = mod.get(url, { headers }, (res) => resolve(res));
    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error("connect timeout")));
  });
}

async function resolveUrl(url, redirects = 0) {
  if (redirects > 5) throw new Error("too many redirects");
  const res = await fetchOnce(url, { "User-Agent": "jarvis-install-electron" });
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    res.resume();
    return resolveUrl(new URL(res.headers.location, url).toString(), redirects + 1);
  }
  return { url, res };
}

const MB = (n) => (n / 1024 / 1024).toFixed(1);

async function download(url, dest) {
  let have = 0;
  try {
    have = fs.statSync(dest).size;
  } catch {
    /* fresh download */
  }

  const headers = { "User-Agent": "jarvis-install-electron" };
  if (have > 0) headers.Range = `bytes=${have}-`;

  const { url: finalUrl, res } = await resolveUrl(url);
  if (res.statusCode !== 200 && res.statusCode !== 206) {
    res.resume();
    throw new Error(`HTTP ${res.statusCode} from ${finalUrl}`);
  }
  if (res.statusCode === 200 && have > 0) have = 0; // server ignored the Range

  const expected = Number(res.headers["content-length"] || 0) + (res.statusCode === 206 ? have : 0);
  log(`fetching ${MB(expected || 0)} MB from ${new URL(finalUrl).host} (${have > 0 ? `resuming at ${MB(have)} MB` : "starting fresh"})`);

  const out = fs.createWriteStream(dest, { flags: have > 0 ? "r+" : "w" });
  if (have > 0) out.start = have;
  await new Promise((resolve, reject) => {
    let last = Date.now();
    res.on("data", (chunk) => {
      if (Date.now() - last > 1500) {
        last = Date.now();
        process.stdout.write(`\r[electron]   ${MB(out.bytesWritten)} / ${MB(expected)} MB`);
      }
    });
    res.on("error", reject);
    out.on("error", reject);
    out.on("finish", resolve);
    res.pipe(out);
  });
  process.stdout.write("\n");

  const size = fs.statSync(dest).size;
  if (expected && size !== expected) {
    throw new Error(`truncated download: ${MB(size)} MB of ${MB(expected)} MB`);
  }
  return size;
}

async function obtainZip(version) {
  const file = `electron-v${version}-${process.platform}-${process.arch}.zip`;
  const override = process.env.ELECTRON_ZIP;

  const cached = override && fs.existsSync(override) ? override : findCachedZip(file);
  if (cached) {
    log(`using cached zip: ${cached} (${MB(fs.statSync(cached).size)} MB)`);
    return cached;
  }

  const mirror = process.env.ELECTRON_MIRROR;
  const bases = [
    ...(mirror ? [mirror.endsWith("/") ? mirror : `${mirror}/`] : []),
    // Hosts the same artifacts with different version-path layouts.
    `https://npmmirror.com/mirrors/electron/${version}/${file}`,
    `https://github.com/electron/electron/releases/download/v${version}/${file}`,
  ];

  const dest = path.join(ROOT, "node_modules", ".cache", "electron", file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  let lastError;
  for (const base of bases) {
    // A bare mirror string is a directory base; the others are full URLs.
    const url = base.includes("{file}") ? base.replace("{file}", file) : base.startsWith("http") && base.endsWith("/") ? `${base}${version}/${file}` : base;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await download(url, dest);
        return dest;
      } catch (e) {
        lastError = e;
        log(`attempt ${attempt} failed (${e.message}) — retrying`);
      }
    }
  }
  throw new Error(`could not download ${file}: ${lastError?.message}`);
}

/**
 * Unpack the zip with whatever this machine can actually finish.
 *
 * NOT extract-zip first: that is what electron's own installer uses, and on
 * Node 24 it hangs after the first entry (its promise never settles, so the
 * install dies with "unsettled top-level await" and leaves a dist/ containing
 * only LICENSES.chromium.html). Windows' bundled bsdtar unpacks the same
 * archive in about a second, so prefer native tools and keep extract-zip as a
 * last resort for machines without them.
 */
async function extract(zipPath) {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  const system32 = process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32") : "C:\\Windows\\System32";
  const candidates = [
    { bin: path.join(system32, "tar.exe"), args: (zip, dest) => ["-xf", zip, "-C", dest], name: "bsdtar" },
    { bin: "unzip", args: (zip, dest) => ["-q", "-o", zip, "-d", dest], name: "unzip" },
  ];

  for (const tool of candidates) {
    try {
      if (path.isAbsolute(tool.bin) && !fs.existsSync(tool.bin)) continue;
      execFileSync(tool.bin, tool.args(zipPath, DIST_DIR), { stdio: "pipe" });
      if (fs.existsSync(path.join(DIST_DIR, platformPath()))) {
        log(`extracted with ${tool.name}`);
        return finishExtract();
      }
      log(`${tool.name} produced no binary — trying the next extractor`);
    } catch (e) {
      log(`${tool.name} failed (${e.message.split("\n")[0]}) — trying the next extractor`);
    }
  }

  const { default: extractZip } = await import("extract-zip");
  log("falling back to extract-zip (can hang on Node 24)");
  await extractZip(zipPath, { dir: DIST_DIR });
  return finishExtract();
}

function finishExtract() {

  // electron's installer moves the bundled type definitions up a level.
  const inDist = path.join(DIST_DIR, "electron.d.ts");
  if (fs.existsSync(inDist)) fs.renameSync(inDist, path.join(ELECTRON_DIR, "electron.d.ts"));

  fs.writeFileSync(path.join(ELECTRON_DIR, "path.txt"), platformPath());
}

// ── Main ───────────────────────────────────────────────────────────────────
const version = JSON.parse(
  fs.readFileSync(path.join(ELECTRON_DIR, "package.json"), "utf-8")
).version;

const status = installedStatus(version);
if (status.ok) {
  log(`already installed and usable (v${version})`);
  if (!CHECK_ONLY) {
    try {
      log(`binary reports: ${execFileSync(status.bin, ["--version"], { encoding: "utf-8" }).trim()}`);
    } catch {
      /* --version is informational only */
    }
  }
  process.exit(0);
}

if (CHECK_ONLY) fail(`broken: ${status.why}`);

log(`installing Electron v${version} — ${status.why}`);
const zipPath = await obtainZip(version);
await extract(zipPath);

const after = installedStatus(version);
if (!after.ok) fail(`extraction finished but the install is still broken: ${after.why}`);
log(`installed: ${after.bin}`);
try {
  log(`binary reports: ${execFileSync(after.bin, ["--version"], { encoding: "utf-8" }).trim()}`);
} catch {
  /* informational */
}
