// Native Windows OS master volume control via Core Audio API
// (IAudioEndpointVolume) using koffi for direct FFI.
//
// This is the ONLY API that changes the user-visible system master volume
// on Windows 10/11. SAPI.SpVoice.Volume only affects SAPI's per-instance
// TTS volume (reverts when the COM object is released). winmm.dll
// waveOutSetVolume only changes the legacy waveOut endpoint, not the
// modern Windows audio endpoint that the system tray slider controls.
//
// We bypass PowerShell + COM RCW entirely — koffi calls ole32!CoCreateInstance
// directly, then walks the vtable manually using koffi's view() helper to
// read raw memory.

const koffi = require('koffi');
const { view, address, decode } = koffi;

// ─── Load ole32 ────────────────────────────────────────────────────────────
// NOTE: ole32!CoCreateInstance's signature uses a typed GUID parameter.
// We must declare the GUID struct BEFORE the function so koffi can resolve it.
const GUID_T = koffi.struct('GUID', {
  Data1: 'uint32',
  Data2: 'uint16',
  Data3: 'uint16',
  Data4: koffi.array('uint8', 8),
});

const ole32 = koffi.load('ole32.dll');
const CoCreateInstance = ole32.func(
  'int CoCreateInstance(GUID *rclsid, void *pUnkOuter, uint32 dwClsContext, GUID *riid, void **ppv)'
);
const CoInitializeEx = ole32.func('int CoInitializeEx(void *pvReserved, uint32 dwCoInit)');
const CoUninitialize = ole32.func('void CoUninitialize()');

// CLSID_MMDeviceEnumerator = {BCDE0395-E52F-467C-8E3D-C4579291692E}
const CLSID_MMDeviceEnumerator = [
  0xBCDE0395, 0xE52F, 0x467C, 0x8E, 0x3D, 0xC4, 0x57, 0x92, 0x91, 0x69, 0x2E
];
// IID_IMMDeviceEnumerator = {A95664D2-9614-4F35-A746-DE8DB63625E6}
const IID_IMMDeviceEnumerator = [
  0xA95664D2, 0x9614, 0x4F35, 0xA7, 0x46, 0xDE, 0x8D, 0xB6, 0x36, 0x25, 0xE6
];
// IID_IAudioEndpointVolume = {5CDF2C82-841E-4546-9722-0CF74078229A}
const IID_IAudioEndpointVolume = [
  0x5CDF2C82, 0x841E, 0x4546, 0x97, 0x22, 0x0C, 0xF7, 0x40, 0x78, 0x22, 0x9A
];

// GUID struct is now declared above (koffi needs it before ole32 load).

// ─── Helpers ───────────────────────────────────────────────────────────────

function packGuid(arr) {
  return {
    Data1: arr[0],
    Data2: arr[1],
    Data3: arr[2],
    Data4: [arr[3], arr[4], arr[5], arr[6], arr[7], arr[8], arr[9], arr[10]],
  };
}

// Allocate a GUID on the heap and return its address (BigInt).
function allocGuid(arr) {
  const buf = koffi.alloc(GUID_T, 1);
  koffi.encode(buf, GUID_T, packGuid(arr));
  return buf;
}

// Read a pointer-sized value at `ptr` (BigInt) and return BigInt.
// On x64, ptr = 8 bytes. On x86, ptr = 4 bytes.
const PTR_SIZE = process.arch === 'x64' ? 8 : 4;
const PTR_T = process.arch === 'x64' ? 'uint64' : 'uint32';

function readPtrAt(ptrBigInt) {
  const ab = view(ptrBigInt, PTR_SIZE);
  const dv = new DataView(ab);
  return process.arch === 'x64' ? dv.getBigUint64(0, true) : BigInt(dv.getUint32(0, true));
}

// Read the function pointer at vtable[slot] of a COM object.
function getVtableFunc(objPtr, slot) {
  // objPtr is a BigInt. The first PTR_SIZE bytes hold a pointer to the vtable.
  const vtablePtr = readPtrAt(objPtr);
  const fnPtr = readPtrAt(vtablePtr + BigInt(slot * PTR_SIZE));
  return fnPtr;
}

// Call a COM vtable method. The `this` pointer is passed as the first arg.
function makeComCall(objPtr, slot, returnType, argTypes) {
  const fnPtr = getVtableFunc(objPtr, slot);
  const proto = koffi.proto(returnType, argTypes);
  const fn = koffi.call(fnPtr, proto);
  return (thisPtr, ...args) => {
    // Convert BigInt -> Buffer for the `this` pointer.
    const thisBuf = koffi.alloc('void *', 1);
    koffi.encode(thisBuf, 'void *', thisPtr);
    return fn(thisBuf, ...args);
  };
}

// Allocate a pointer-sized slot and return its address (BigInt).
function allocPtrSlot() {
  return koffi.alloc('void *', 1);
}

// Read back the pointer stored at `slotAddr` (BigInt).
function readPtrSlot(slotAddr) {
  return readPtrAt(slotAddr);
}

// ─── Public API ────────────────────────────────────────────────────────────

let comInited = false;
function ensureCom() {
  if (comInited) return;
  // COINIT_APARTMENTTHREADED = 0x2 (STA is required for audio endpoints on most machines)
  const hr = CoInitializeEx(null, 0x2);
  // S_OK (0) or S_FALSE (1) or RPC_E_CHANGED_MODE (0x80010106) all acceptable.
  if (hr !== 0 && hr !== 1 && hr !== -2147417850 /* RPC_E_CHANGED_MODE */) {
    throw new Error(`CoInitializeEx failed: hr=0x${(hr >>> 0).toString(16)}`);
  }
  comInited = true;
}

/**
 * Set the OS master volume via Core Audio API.
 * @param {number} level 0..100 (percentage)
 * @returns {{ before: number, after: number }}
 */
function setMasterVolume(level) {
  ensureCom();
  const target = Math.max(0, Math.min(100, level));

  // 1. CoCreateInstance(MMDeviceEnumerator) -> IMMDeviceEnumerator
  const clsidBuf = allocGuid(CLSID_MMDeviceEnumerator);
  const iidEnumBuf = allocGuid(IID_IMMDeviceEnumerator);
  const enumSlot = allocPtrSlot();

  let hr = CoCreateInstance(clsidBuf, null, 0x17 /* CLSCTX_ALL */, iidEnumBuf, enumSlot);
  if (hr !== 0) {
    throw new Error(`CoCreateInstance(MMDeviceEnumerator) failed: hr=0x${(hr >>> 0).toString(16)}`);
  }
  const enumPtr = readPtrSlot(enumSlot);
  if (enumPtr === 0n) throw new Error('CoCreateInstance returned null pointer');

  try {
    // 2. GetDefaultAudioEndpoint(eRender=0, eConsole=1) -> IMMDevice
    // vtable slot 4 of IMMDeviceEnumerator
    const GetDefault = makeComCall(enumPtr, 4, 'int', ['void *', 'int32', 'int32', 'void **']);
    const devSlot = allocPtrSlot();
    hr = GetDefault(enumPtr, 0, 1, devSlot);
    if (hr !== 0) {
      throw new Error(`GetDefaultAudioEndpoint failed: hr=0x${(hr >>> 0).toString(16)}`);
    }
    const devPtr = readPtrSlot(devSlot);
    if (devPtr === 0n) throw new Error('GetDefaultAudioEndpoint returned null');

    try {
      // 3. Activate(IID_IAudioEndpointVolume) -> IAudioEndpointVolume
      // vtable slot 3 of IMMDevice
      const Activate = makeComCall(devPtr, 3, 'int', ['void *', GUID_T, 'uint32', 'void *', 'void **']);
      const iidAudioBuf = allocGuid(IID_IAudioEndpointVolume);
      const epSlot = allocPtrSlot();
      hr = Activate(devPtr, iidAudioBuf, 0x17, null, epSlot);
      if (hr !== 0) {
        throw new Error(`IMMDevice.Activate failed: hr=0x${(hr >>> 0).toString(16)}`);
      }
      const epPtr = readPtrSlot(epSlot);
      if (epPtr === 0n) throw new Error('Activate returned null');

      try {
        // 4. GetChannelVolumeLevelScalar(channel=0, *level) -> float [0..1]
        // vtable slot 9 of IAudioEndpointVolume
        const GetScalar = makeComCall(epPtr, 9, 'int', ['void *', 'uint32', 'float *']);
        const levelRef = koffi.alloc('float', 1);
        hr = GetScalar(epPtr, 0, levelRef);
        if (hr !== 0) {
          throw new Error(`GetChannelVolumeLevelScalar failed: hr=0x${(hr >>> 0).toString(16)}`);
        }
        const before = koffi.decode(levelRef, 'float');

        // 5. SetChannelVolumeLevelScalar(channel=0, level, pEventContext=NULL)
        // vtable slot 7 of IAudioEndpointVolume
        const SetScalar = makeComCall(epPtr, 7, 'int', ['void *', 'uint32', 'float', 'void *']);
        const scalar = target / 100.0;
        hr = SetScalar(epPtr, 0, scalar, null);
        if (hr !== 0) {
          throw new Error(`SetChannelVolumeLevelScalar failed: hr=0x${(hr >>> 0).toString(16)}`);
        }

        // 6. Read back.
        const levelRef2 = koffi.alloc('float', 1);
        hr = GetScalar(epPtr, 0, levelRef2);
        const after = hr === 0 ? koffi.decode(levelRef2, 'float') : -1;

        return { before, after, hr_set: hr };
      } finally {
        // Release the endpoint (vtable slot 2 = Release).
        const Release = makeComCall(epPtr, 2, 'uint32', ['void *']);
        Release(epPtr);
      }
    } finally {
      const Release = makeComCall(devPtr, 2, 'uint32', ['void *']);
      Release(devPtr);
    }
  } finally {
    const Release = makeComCall(enumPtr, 2, 'uint32', ['void *']);
    Release(enumPtr);
  }
}

module.exports = { setMasterVolume };

// CLI entry for direct testing.
if (require.main === module) {
  const level = parseInt(process.argv[2] || '50', 10);
  console.log(`Setting master volume to ${level}%...`);
  const r = setMasterVolume(level);
  console.log(JSON.stringify(r, null, 2));
}