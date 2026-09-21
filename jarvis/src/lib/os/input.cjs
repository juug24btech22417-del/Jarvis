// Native Windows OS control via koffi FFI (user32.dll).
// Powers the flex features: air-mouse + pinch click + drag, two-finger
// scrolling, chords/unicode typing for the phone remote, gesture DJ media
// transport, and presence auto-lock.
//
// Conventions follow src/lib/os/volume.cjs — direct FFI, no PowerShell.

const koffi = require('koffi');

const user32 = koffi.load('user32.dll');

// Structs must be declared BEFORE the functions that reference them,
// so koffi can resolve the type names at declaration time.
// Guarded: Next.js bundles this file into several route bundles that all
// share one koffi runtime — the second declaration would throw.
try {
  koffi.struct('POINT', { x: 'long', y: 'long' });
} catch (e) {
  if (!/Duplicate type name/.test(String(e))) throw e;
}

// ─── user32 functions ──────────────────────────────────────────────────────
const SetCursorPos = user32.func('int SetCursorPos(int X, int Y)');
const GetCursorPos = user32.func('int GetCursorPos(_Out_ POINT *lpPoint)');
const GetSystemMetrics = user32.func('int GetSystemMetrics(int nIndex)');
// dx/dy/dwData are signed (relative motion, wheel notches) — use long.
const mouse_event = user32.func('void mouse_event(uint32 dwFlags, long dx, long dy, long dwData, uintptr_t dwExtraInfo)');
const keybd_event = user32.func('void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr_t dwExtraInfo)');
// SendInput with a raw byte buffer (no koffi struct — avoids duplicate-type
// issues across Next.js route bundles). Each INPUT is 40 bytes on x64.
const SendInput = user32.func('uint32 SendInput(uint32 cInputs, void *pInputs, int cbSize)');
const LockWorkStation = user32.func('int LockWorkStation()');

// mouse_event flags
const MOUSEEVENTF_MOVE = 0x0001;
const MOUSEEVENTF_LEFTDOWN = 0x02;
const MOUSEEVENTF_LEFTUP = 0x04;
const MOUSEEVENTF_RIGHTDOWN = 0x08;
const MOUSEEVENTF_RIGHTUP = 0x10;
const MOUSEEVENTF_WHEEL = 0x0800;
const MOUSEEVENTF_HWHEEL = 0x1000;
const WHEEL_DELTA = 120;

// keybd_event flags: 0 = keydown, KEYEVENTF_KEYUP = 2
const KEYEVENTF_KEYUP = 0x02;
// SendInput keyboard flags
const KEYEVENTF_UNICODE = 0x04;

// Virtual-key codes (media + volume)
const VK = {
  VOLUME_MUTE: 0xAD,
  VOLUME_DOWN: 0xAE,
  VOLUME_UP: 0xAF,
  MEDIA_NEXT: 0xB0,
  MEDIA_PREV: 0xB1,
  MEDIA_STOP: 0xB2,
  MEDIA_PLAY_PAUSE: 0xB3,
};

// Named keys for chords ("ctrl+shift+esc") and single taps.
const KEY_NAMES = {
  esc: 0x1b, escape: 0x1b, tab: 0x09, enter: 0x0d, return: 0x0d, space: 0x20,
  backspace: 0x08, delete: 0x2e, del: 0x2e, insert: 0x2d, home: 0x24, end: 0x23,
  pageup: 0x21, pagedown: 0x22, up: 0x26, down: 0x28, left: 0x25, right: 0x27,
  ctrl: 0x11, control: 0x11, shift: 0x10, alt: 0x12, menu: 0x12,
  win: 0x5b, meta: 0x5b, super: 0x5b, apps: 0x5d, capslock: 0x14,
  printscreen: 0x2c, mute: VK.VOLUME_MUTE,
  volumedown: VK.VOLUME_DOWN, volumeup: VK.VOLUME_UP,
  playpause: VK.MEDIA_PLAY_PAUSE, next: VK.MEDIA_NEXT, prev: VK.MEDIA_PREV,
};
for (let i = 0; i < 26; i++) KEY_NAMES[String.fromCharCode(97 + i)] = 0x41 + i;
for (let i = 0; i < 10; i++) KEY_NAMES[String(i)] = 0x30 + i;
for (let i = 1; i <= 12; i++) KEY_NAMES['f' + i] = 0x6f + i;

function tapKey(vk) {
  keybd_event(vk, 0, 0, 0);
  keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
}

/** "ctrl+shift+esc" → [0x11, 0x10, 0x1b]. Throws on unknown names. */
function parseChord(spec) {
  const names = String(spec || '').split('+').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!names.length) throw new Error('Empty key chord');
  return names.map((n) => {
    const vk = KEY_NAMES[n];
    if (!vk) throw new Error(`Unknown key: ${n}`);
    return vk;
  });
}

// ─── Mouse ─────────────────────────────────────────────────────────────────

/** Move the OS cursor to absolute screen coords. */
function moveMouse(x, y) {
  const ok = SetCursorPos(Math.round(x), Math.round(y));
  if (!ok) throw new Error('SetCursorPos failed');
  return { x: Math.round(x), y: Math.round(y) };
}

/** Move the cursor by relative pixels (phone trackpad). */
function moveMouseRelative(dx, dy) {
  mouse_event(MOUSEEVENTF_MOVE, Math.round(dx), Math.round(dy), 0, 0);
  return { dx: Math.round(dx), dy: Math.round(dy) };
}

/** Get cursor position + screen size. */
function getMouseState() {
  const ptBuf = koffi.alloc('POINT', 1);
  GetCursorPos(ptBuf);
  const p = koffi.decode(ptBuf, 'POINT');
  return {
    x: p.x,
    y: p.y,
    screenWidth: GetSystemMetrics(0),
    screenHeight: GetSystemMetrics(1),
  };
}

/** Click: 'left' (default) or 'right'. */
function clickMouse(button = 'left') {
  if (button === 'right') {
    mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
    mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
  } else {
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
  }
  return { clicked: button };
}

/** Press and hold (drag start). */
function mouseDown(button = 'left') {
  mouse_event(button === 'right' ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
  return { down: button };
}

/** Release (drag end). */
function mouseUp(button = 'left') {
  mouse_event(button === 'right' ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
  return { up: button };
}

/** Scroll by wheel notches (±120 each). Positive dy scrolls content up. */
function scrollWheel(dy, dx = 0) {
  const nDy = Math.round(Number(dy) || 0);
  const nDx = Math.round(Number(dx) || 0);
  if (nDy) mouse_event(MOUSEEVENTF_WHEEL, 0, 0, nDy * WHEEL_DELTA, 0);
  if (nDx) mouse_event(MOUSEEVENTF_HWHEEL, 0, 0, nDx * WHEEL_DELTA, 0);
  return { dy: nDy, dx: nDx };
}

// ─── Keyboard ──────────────────────────────────────────────────────────────

/** Press a chord: all keys down in order, then released in reverse. */
function keyChord(spec) {
  const vks = parseChord(spec);
  for (const vk of vks) keybd_event(vk, 0, 0, 0);
  for (const vk of [...vks].reverse()) keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
  return { keys: String(spec) };
}

// SendInput KEYBDINPUT entry — 40-byte flat layout matching the x64 INPUT
// struct: type(4) pad(4) wVk(2) wScan(2) dwFlags(4) time(4) pad(4)
// dwExtraInfo(8) tail(8, pads the union up to MOUSEINPUT's size).
function writeKbEntry(buf, off, scan, flags) {
  buf.writeUInt32LE(1, off);              // type = INPUT_KEYBOARD
  buf.writeUInt32LE(0, off + 4);          // union alignment pad
  buf.writeUInt16LE(0, off + 8);          // wVk = 0 (unicode mode)
  buf.writeUInt16LE(scan & 0xffff, off + 10); // wScan = unicode code unit
  buf.writeUInt32LE(flags, off + 12);     // KEYEVENTF_UNICODE [| KEYUP]
  buf.writeUInt32LE(0, off + 16);         // time
  buf.writeUInt32LE(0, off + 20);         // pad
  buf.writeBigUInt64LE(0n, off + 24);     // dwExtraInfo
  // bytes 32..40 stay zero (union tail)
}

/** Type unicode text into the focused window via KEYEVENTF_UNICODE. */
function typeText(text) {
  const s = String(text ?? '');
  if (!s.length) return { chars: 0 };
  if (s.length > 1000) throw new Error('Text too long (max 1000 chars)');

  // Expand to UTF-16 code units (SendInput consumes units, not code points).
  const units = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      units.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    } else {
      units.push(cp === 10 ? 13 : cp); // \n → CR
    }
  }

  const BATCH = 32; // 32 down + 32 up per SendInput call
  for (let i = 0; i < units.length; i += BATCH / 2) {
    const slice = units.slice(i, i + BATCH / 2);
    const buf = Buffer.alloc(slice.length * 2 * 40);
    slice.forEach((u, j) => {
      writeKbEntry(buf, j * 80, u, KEYEVENTF_UNICODE);
      writeKbEntry(buf, j * 80 + 40, u, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
    });
    const n = slice.length * 2;
    const sent = SendInput(n, buf, 40);
    if (sent !== n) throw new Error(`SendInput partial: ${sent}/${n}`);
  }
  return { chars: units.length };
}

/** Media transport — works across Spotify Free, YouTube, VLC, browsers. */
function sendMediaKey(action) {
  const map = {
    'play-pause': VK.MEDIA_PLAY_PAUSE,
    'next': VK.MEDIA_NEXT,
    'prev': VK.MEDIA_PREV,
    'stop': VK.MEDIA_STOP,
    'mute': VK.VOLUME_MUTE,
    'volume-up': VK.VOLUME_UP,
    'volume-down': VK.VOLUME_DOWN,
  };
  const vk = map[action];
  if (!vk) throw new Error(`Unknown media action: ${action}`);
  tapKey(vk);
  return { action, ok: true };
}

/** Lock the workstation (Win+L equivalent). */
function lockWorkstation() {
  const ok = LockWorkStation();
  return { locked: !!ok };
}

module.exports = {
  moveMouse, moveMouseRelative, getMouseState,
  clickMouse, mouseDown, mouseUp, scrollWheel,
  keyChord, typeText, sendMediaKey, lockWorkstation,
};

// CLI entry for direct testing.
if (require.main === module) {
  const cmd = process.argv[2];
  try {
    if (cmd === 'state') console.log(JSON.stringify(getMouseState()));
    else if (cmd === 'media') console.log(JSON.stringify(sendMediaKey(process.argv[3] || 'play-pause')));
    else if (cmd === 'lock') console.log(JSON.stringify(lockWorkstation()));
    else if (cmd === 'click') console.log(JSON.stringify(clickMouse(process.argv[3])));
    else if (cmd === 'rel') console.log(JSON.stringify(moveMouseRelative(Number(process.argv[3]) || 0, Number(process.argv[4]) || 0)));
    else if (cmd === 'scroll') console.log(JSON.stringify(scrollWheel(Number(process.argv[3]) || 1)));
    else if (cmd === 'key') console.log(JSON.stringify(keyChord(process.argv[3])));
    else if (cmd === 'type') console.log(JSON.stringify(typeText(process.argv[3] || '')));
    else if (cmd === 'down') console.log(JSON.stringify(mouseDown(process.argv[3])));
    else if (cmd === 'up') console.log(JSON.stringify(mouseUp(process.argv[3])));
    else console.log('usage: node input.cjs [state|media <a>|click|rel dx dy|scroll n|key chord|type text|down|up|lock]');
  } catch (e) {
    console.error('error:', e.message);
    process.exit(1);
  }
}
