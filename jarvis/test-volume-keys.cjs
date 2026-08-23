// Test sending virtual volume keys via SendInput.
// VK_VOLUME_UP   = 0xAF
// VK_VOLUME_DOWN = 0xAE
// VK_VOLUME_MUTE = 0xAD
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const SendInput = user32.func(
  'uint32 SendInput(uint32 cInputs, void *pInputs, int cbSize)'
);
const GetLastError = koffi.load('kernel32.dll').func('uint32 GetLastError()');

const INPUT_T = koffi.struct('INPUT', {
  type: 'uint32',
  // Union: KEYBDINPUT (8 bytes), MOUSEINPUT (8 bytes), HARDWAREINPUT (8 bytes)
  ki: koffi.struct('KEYBDINPUT', {
    wVk: 'uint16',
    wScan: 'uint16',
    dwFlags: 'uint32',
    time: 'uint32',
    dwExtraInfo: 'uint64',
  }),
});

function sendVolumeKey(vk) {
  const inp = koffi.alloc(INPUT_T, 1);
  // Build the input manually because koffi's union handling is tricky.
  // We'll write the bytes directly.
  const view = koffi.view(inp, 4 /*type*/ + 4 /*padding?*/ + 24 /*KEYBDINPUT*/);
  const dv = new DataView(view);
  let off = 0;
  dv.setUint32(off, 1, true); off += 4;        // INPUT_KEYBOARD = 1
  // No padding for 64-bit alignment on x64 within the union
  dv.setUint16(off, vk, true); off += 2;       // wVk
  dv.setUint16(off, 0, true); off += 2;        // wScan
  dv.setUint32(off, 0, true); off += 4;        // dwFlags = 0 (key down)
  dv.setUint32(off, 0, true); off += 4;        // time
  dv.setBigUint64(off, 0n, true);              // dwExtraInfo

  const N = 1;
  const r = SendInput(N, inp, 4 + 24);
  return r;
}

const VK_VOLUME_UP = 0xAF;
const VK_VOLUME_DOWN = 0xAE;
const VK_VOLUME_MUTE = 0xAD;

const arg = process.argv[2] || 'up';
const map = {
  up: { vk: VK_VOLUME_UP, name: 'VOLUME_UP' },
  down: { vk: VK_VOLUME_DOWN, name: 'VOLUME_DOWN' },
  mute: { vk: VK_VOLUME_MUTE, name: 'VOLUME_MUTE' },
};
const target = map[arg];
if (!target) {
  console.log('Usage: node test-volume-keys.cjs [up|down|mute]');
  process.exit(1);
}
console.log(`Sending ${target.name} key...`);
const r = sendVolumeKey(target.vk);
console.log(`SendInput returned ${r} (1 means 1 event successfully sent)`);

// Send a few more to make the change visible.
if (arg === 'up' || arg === 'down') {
  for (let i = 0; i < 9; i++) {
    sendVolumeKey(target.vk);
  }
  console.log(`Sent 10 total ${target.name} events (~5 steps of volume change)`);
}