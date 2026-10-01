// Native Windows OS master volume control — resilient, multi-path.
//
// Some Windows 11 audio stacks reject the Core Audio COM activation
// (CoCreateInstance / QueryInterface for IMMDeviceEnumerator can return
// E_NOINTERFACE 0x80004002 or REGDB_E_CLASSNOTREG 0x80040154). That is what
// made the QR-remote volume slider throw "CoCreateInstance failed". So we try
// several independent strategies, best first, and never let one broken rail
// take volume control down with it:
//
//   1. Core Audio  (IAudioEndpointVolume via ole32!CoCreateInstance + koffi)
//      — exact OS master volume on a healthy Windows install.
//   2. winmm waveOutSetVolume/waveOutGetVolume — no COM at all, ships with
//      every Windows install, and drives the default endpoint's volume.
//   3. Hardware volume/mute keys (user32 keybd_event via ./input.cjs) —
//      last-resort nudge/toggle; the OS always handles these.
//
// Public API:
//   setMasterVolume(level) -> { before, after, method }
//   getMasterVolume()      -> number (0..100)
//   setMute(bool)          -> { muted, method }
//   toggleMute()           -> { muted, method }

const koffi = require('koffi');

let input = null;
function getInput() {
  if (!input) input = require('./input.cjs');
  return input;
}

const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

// ─── winmm (no COM) ─────────────────────────────────────────────────────────
const winmm = koffi.load('winmm.dll');
const waveOutGetVolume = winmm.func('uint32 waveOutGetVolume(void *hwo, uint32 *pdwVolume)');
const waveOutSetVolume = winmm.func('uint32 waveOutSetVolume(void *hwo, uint32 dwVolume)');

function waveOutSet(level) {
  const v = Math.round((clamp(level) / 100) * 0xffff) & 0xffff;
  const dw = ((v | (v << 16)) >>> 0);
  const hr = waveOutSetVolume(null, dw);
  if (hr !== 0) throw new Error(`waveOutSetVolume failed: hr=0x${(hr >>> 0).toString(16)}`);
}

function waveOutGet() {
  const buf = koffi.alloc('uint32', 1);
  const hr = waveOutGetVolume(null, buf);
  if (hr !== 0) throw new Error(`waveOutGetVolume failed: hr=0x${(hr >>> 0).toString(16)}`);
  const raw = koffi.decode(buf, 'uint32') >>> 0;
  return Math.round(((raw & 0xffff) / 0xffff) * 100);
}

// ─── Core Audio (COM via ole32 + koffi) ─────────────────────────────────────
// Guarded: Next.js bundles this file into several route bundles sharing one
// koffi runtime — the second GUID declaration would throw.
try {
  koffi.struct('JARVIS_GUID', {
    Data1: 'uint32',
    Data2: 'uint16',
    Data3: 'uint16',
    Data4: koffi.array('uint8', 8),
  });
} catch (e) {
  if (!/Duplicate type name/.test(String(e))) throw e;
}
const GUID_T = 'JARVIS_GUID';

const ole32 = koffi.load('ole32.dll');
const CoCreateInstance = ole32.func(
  'int CoCreateInstance(JARVIS_GUID *rclsid, void *pUnkOuter, uint32 dwClsContext, JARVIS_GUID *riid, void **ppv)'
);
const CoInitializeEx = ole32.func('int CoInitializeEx(void *pvReserved, uint32 dwCoInit)');

// CLSID_MMDeviceEnumerator = {BCDE0395-E52F-467C-8E3D-C4579291692E}
const CLSID_MMDeviceEnumerator = [0xbcde0395, 0xe52f, 0x467c, 0x8e, 0x3d, 0xc4, 0x57, 0x92, 0x91, 0x69, 0x2e];
// IID_IMMDeviceEnumerator = {A95664D2-9614-4F35-A746-DE8DB63625E6}
const IID_IMMDeviceEnumerator = [0xa95664d2, 0x9614, 0x4f35, 0xa7, 0x46, 0xde, 0x8d, 0xb6, 0x36, 0x25, 0xe6];
// IID_IAudioEndpointVolume = {5CDF2C82-841E-4546-9722-0CF74078229A}
const IID_IAudioEndpointVolume = [0x5cdf2c82, 0x841e, 0x4546, 0x97, 0x22, 0x0c, 0xf7, 0x40, 0x78, 0x22, 0x9a];

function packGuid(a) {
  return { Data1: a[0], Data2: a[1], Data3: a[2], Data4: a.slice(3) };
}
function allocGuid(a) {
  const buf = koffi.alloc(GUID_T, 1);
  koffi.encode(buf, GUID_T, packGuid(a));
  return buf;
}

const PTR_SIZE = process.arch === 'x64' ? 8 : 4;

function readPtr(addrBig, offsetBytes) {
  const ab = koffi.view(addrBig, offsetBytes + PTR_SIZE);
  const dv = new DataView(ab);
  return PTR_SIZE === 8 ? dv.getBigUint64(offsetBytes, true) : BigInt(dv.getUint32(offsetBytes, true));
}
function readSlot(buf) {
  return koffi.decode(buf, 'void *');
}
function vtableFn(objPtr, slot) {
  const vt = readPtr(objPtr, 0);
  return readPtr(vt, slot * PTR_SIZE);
}

// koffi types are global to the runtime — register each prototype exactly once
// (a second koffi.proto() with the same name throws "Duplicate type name").
const protoCache = new Map();
function getProto(protoText) {
  let proto = protoCache.get(protoText);
  if (!proto) {
    proto = koffi.proto(protoText);
    protoCache.set(protoText, proto);
  }
  return proto;
}

// Call COM vtable[slot]. `this` is passed as an encoded pointer buffer, which
// is what koffi's calling convention expects for an opaque `void *`.
function callSlot(objPtr, slot, protoText, ...args) {
  const proto = getProto(protoText);
  const fnPtr = vtableFn(objPtr, slot);
  if (fnPtr === 0n) throw new Error(`COM vtable slot ${slot} is null`);
  const holder = koffi.alloc('void *', 1);
  koffi.encode(holder, 'void *', fnPtr);
  const fn = koffi.decode(holder, 'void *');
  const thisBuf = koffi.alloc('void *', 1);
  koffi.encode(thisBuf, 'void *', objPtr);
  return koffi.call(fn, proto, thisBuf, ...args);
}

// IUnknown::Release is vtable slot 2 on every COM interface.
const RELEASE_PROTO = 'uint32 Release(void *self)';
const GET_DEFAULT_PROTO = 'int GetDefaultAudioEndpoint(void *self, int32 dataFlow, int32 role, void **ppDevice)';
const ACTIVATE_PROTO = 'int Activate(void *self, JARVIS_GUID *iid, uint32 dwClsCtx, void *params, void **ppInterface)';
const SET_MASTER_PROTO = 'int SetMasterVolumeLevelScalar(void *self, float level, void *ctx)';
const GET_MASTER_PROTO = 'int GetMasterVolumeLevelScalar(void *self, float *level)';
const SET_MUTE_PROTO = 'int SetMute(void *self, int muted, void *ctx)';
const GET_MUTE_PROTO = 'int GetMute(void *self, int *muted)';

const hrHex = (hr) => `0x${(hr >>> 0).toString(16)}`;

let comInited = false;
function ensureCom() {
  if (comInited) return;
  // COINIT_APARTMENTTHREADED = 0x2 (STA — required for audio endpoints on most machines).
  const hr = CoInitializeEx(null, 0x2);
  // S_OK (0), S_FALSE (1) and RPC_E_CHANGED_MODE (0x80010106) are all fine.
  if (hr !== 0 && hr !== 1 && (hr >>> 0) !== 0x80010106) {
    throw new Error(`CoInitializeEx failed: ${hrHex(hr)}`);
  }
  comInited = true;
}

// Open the default render endpoint's IAudioEndpointVolume. Caller must Release.
function coreEndpoint() {
  ensureCom();
  const enumSlot = koffi.alloc('void *', 1);
  const hr = CoCreateInstance(allocGuid(CLSID_MMDeviceEnumerator), null, 0x17, allocGuid(IID_IMMDeviceEnumerator), enumSlot);
  if (hr !== 0) throw new Error(`CoCreateInstance(MMDeviceEnumerator) failed: ${hrHex(hr)}`);
  const enumPtr = readSlot(enumSlot);
  if (enumPtr === 0n) throw new Error('CoCreateInstance returned a null enumerator');

  try {
    const devSlot = koffi.alloc('void *', 1);
    const hr2 = callSlot(enumPtr, 4, GET_DEFAULT_PROTO, 0 /* eRender */, 1 /* eConsole */, devSlot);
    if (hr2 !== 0) throw new Error(`GetDefaultAudioEndpoint failed: ${hrHex(hr2)}`);
    const devPtr = readSlot(devSlot);
    if (devPtr === 0n) throw new Error('GetDefaultAudioEndpoint returned null');

    const epSlot = koffi.alloc('void *', 1);
    const hr3 = callSlot(devPtr, 3, ACTIVATE_PROTO, allocGuid(IID_IAudioEndpointVolume), 0x17, null, epSlot);
    callSlot(devPtr, 2, RELEASE_PROTO);
    if (hr3 !== 0) throw new Error(`IMMDevice.Activate failed: ${hrHex(hr3)}`);
    const epPtr = readSlot(epSlot);
    if (epPtr === 0n) throw new Error('Activate returned null');
    return epPtr;
  } finally {
    callSlot(enumPtr, 2, RELEASE_PROTO);
  }
}

function coreGetAbsolute() {
  const ep = coreEndpoint();
  try {
    const out = koffi.alloc('float', 1);
    const hr = callSlot(ep, 9, GET_MASTER_PROTO, out); // GetMasterVolumeLevelScalar
    if (hr !== 0) throw new Error(`GetMasterVolumeLevelScalar failed: ${hrHex(hr)}`);
    return Math.round(koffi.decode(out, 'float') * 100);
  } finally {
    callSlot(ep, 2, RELEASE_PROTO);
  }
}

function coreSetAbsolute(level) {
  const ep = coreEndpoint();
  try {
    const out = koffi.alloc('float', 1);
    callSlot(ep, 9, GET_MASTER_PROTO, out);
    const before = Math.round(koffi.decode(out, 'float') * 100);
    const hr = callSlot(ep, 7, SET_MASTER_PROTO, clamp(level) / 100, null); // SetMasterVolumeLevelScalar
    if (hr !== 0) throw new Error(`SetMasterVolumeLevelScalar failed: ${hrHex(hr)}`);
    callSlot(ep, 9, GET_MASTER_PROTO, out);
    return { before, after: Math.round(koffi.decode(out, 'float') * 100) };
  } finally {
    callSlot(ep, 2, RELEASE_PROTO);
  }
}

function coreGetMute() {
  const ep = coreEndpoint();
  try {
    const out = koffi.alloc('int', 1);
    const hr = callSlot(ep, 15, GET_MUTE_PROTO, out); // GetMute
    if (hr !== 0) throw new Error(`GetMute failed: ${hrHex(hr)}`);
    return koffi.decode(out, 'int') !== 0;
  } finally {
    callSlot(ep, 2, RELEASE_PROTO);
  }
}

function coreSetMute(mute) {
  const ep = coreEndpoint();
  try {
    const hr = callSlot(ep, 14, SET_MUTE_PROTO, mute ? 1 : 0, null); // SetMute
    if (hr !== 0) throw new Error(`SetMute failed: ${hrHex(hr)}`);
  } finally {
    callSlot(ep, 2, RELEASE_PROTO);
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────
let cachedLevel = 50;
let cachedMuted = false;

/** Current OS master volume, 0..100. */
function getMasterVolume() {
  try {
    cachedLevel = coreGetAbsolute();
    return cachedLevel;
  } catch {}
  try {
    cachedLevel = waveOutGet();
    return cachedLevel;
  } catch {}
  return cachedLevel;
}

/**
 * Set the OS master volume.
 * @returns {{ before: number, after: number, method: string }}
 */
function setMasterVolume(level) {
  const target = clamp(level);

  // 1. Core Audio — exact.
  try {
    const r = coreSetAbsolute(target);
    cachedLevel = r.after;
    return { ...r, method: 'coreaudio' };
  } catch {}

  // 2. winmm — no COM, drives the default endpoint.
  try {
    const before = waveOutGet();
    waveOutSet(target);
    const after = waveOutGet();
    cachedLevel = after;
    return { before, after, method: 'winmm' };
  } catch {}

  // 3. Hardware keys — relative nudge from the best guess we have.
  try {
    const steps = Math.round((target - cachedLevel) / 2); // Windows steps ~2%
    const action = steps >= 0 ? 'volume-up' : 'volume-down';
    const n = Math.min(Math.abs(steps), 50);
    for (let i = 0; i < n; i++) getInput().sendMediaKey(action);
    cachedLevel = clamp(cachedLevel + steps * 2);
  } catch {}
  return { before: cachedLevel, after: cachedLevel, method: 'keys' };
}

/** Explicitly mute or unmute the OS master output. */
function setMute(mute) {
  const want = !!mute;
  try {
    coreSetMute(want);
    cachedMuted = want;
    return { muted: want, method: 'coreaudio' };
  } catch {}
  // Fall back to the hardware mute toggle, tracked so repeats are idempotent.
  try {
    if (cachedMuted !== want) {
      getInput().sendMediaKey('mute');
      cachedMuted = want;
    }
    return { muted: want, method: 'keys' };
  } catch {
    return { muted: cachedMuted, method: 'none' };
  }
}

/** Toggle the OS master mute. */
function toggleMute() {
  try {
    const cur = coreGetMute();
    coreSetMute(!cur);
    cachedMuted = !cur;
    return { muted: !cur, method: 'coreaudio' };
  } catch {}
  try {
    getInput().sendMediaKey('mute');
    cachedMuted = !cachedMuted;
    return { muted: cachedMuted, method: 'keys' };
  } catch {
    return { muted: cachedMuted, method: 'none' };
  }
}

module.exports = {
  setMasterVolume,
  getMasterVolume,
  setMute,
  toggleMute,
  // Low-level escape hatches (used by tests / diagnostics).
  _waveOutGet: waveOutGet,
  _waveOutSet: waveOutSet,
  _coreSetAbsolute: coreSetAbsolute,
};

// CLI entry for direct testing.
if (require.main === module) {
  const cmd = process.argv[2] || 'get';
  try {
    if (cmd === 'get') console.log(getMasterVolume());
    else if (cmd === 'set') console.log(JSON.stringify(setMasterVolume(parseInt(process.argv[3] || '50', 10))));
    else if (cmd === 'up') console.log(JSON.stringify(setMasterVolume(getMasterVolume() + 5)));
    else if (cmd === 'down') console.log(JSON.stringify(setMasterVolume(getMasterVolume() - 5)));
    else if (cmd === 'mute') console.log(JSON.stringify(setMute(true)));
    else if (cmd === 'unmute') console.log(JSON.stringify(setMute(false)));
    else if (cmd === 'toggle') console.log(JSON.stringify(toggleMute()));
    else console.log('usage: node volume.cjs [get|set N|up|down|mute|unmute|toggle]');
  } catch (e) {
    console.error('error:', e.message);
    process.exit(1);
  }
}
