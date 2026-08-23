// Debug version: print every byte of the GUID we're passing.
const koffi = require('koffi');

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

const CLSID_MMDeviceEnumerator = {
  Data1: 0xBCDE0395,
  Data2: 0xE52F,
  Data3: 0x467C,
  Data4: [0x8E, 0x3D, 0xC4, 0x57, 0x92, 0x91, 0x69, 0x2E],
};
const IID_IMMDeviceEnumerator = {
  Data1: 0xA95664D2,
  Data2: 0x9614,
  Data3: 0x4F35,
  Data4: [0xA7, 0x46, 0xDE, 0x8D, 0xB6, 0x36, 0x25, 0xE6],
};

// Print raw bytes
function hexDump(label, obj) {
  const buf = Buffer.alloc(16);
  buf.writeUInt32LE(obj.Data1, 0);
  buf.writeUInt16LE(obj.Data2, 4);
  buf.writeUInt16LE(obj.Data3, 6);
  for (let i = 0; i < 8; i++) buf[8 + i] = obj.Data4[i];
  console.log(label, buf.toString('hex').match(/.{2}/g).join(' '));
}

hexDump('CLSID:', CLSID_MMDeviceEnumerator);
hexDump('IID  :', IID_IMMDeviceEnumerator);

const hr0 = CoInitializeEx(null, 0x2);
console.log('CoInitializeEx hr=0x' + (hr0 >>> 0).toString(16));

const clsidBuf = koffi.alloc(GUID_T, 1);
koffi.encode(clsidBuf, GUID_T, CLSID_MMDeviceEnumerator);
const iidBuf = koffi.alloc(GUID_T, 1);
koffi.encode(iidBuf, GUID_T, IID_IMMDeviceEnumerator);
const slot = koffi.alloc('void *', 1);

// Try different CLSCTX values:
//   CLSCTX_INPROC_SERVER    = 0x1
//   CLSCTX_INPROC_HANDLER   = 0x2
//   CLSCTX_LOCAL_SERVER     = 0x4
//   CLSCTX_ALL              = 0x17
for (const clsctx of [0x1, 0x2, 0x4, 0x17, 0x15, 0x5]) {
  const hr = CoCreateInstance(clsidBuf, null, clsctx, iidBuf, slot);
  const ptr = koffi.decode(slot, 'void *');
  console.log(`CLSCTX=0x${clsctx.toString(16)}: hr=0x${(hr >>> 0).toString(16)} ptr=${ptr}`);
  if (hr === 0) {
    console.log('  SUCCESS — break out of loop');
    break;
  }
}

// Also check what happens with no IID at all (asking for IUnknown)
const IID_IUnknown = {
  Data1: 0x00000000, Data2: 0x0000, Data3: 0x0000,
  Data4: [0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46],
};
const iidUnkBuf = koffi.alloc(GUID_T, 1);
koffi.encode(iidUnkBuf, GUID_T, IID_IUnknown);
const slot2 = koffi.alloc('void *', 1);
const hr2 = CoCreateInstance(clsidBuf, null, 0x1, iidUnkBuf, slot2);
console.log(`CoCreateInstance(IUnknown, CLSCTX_INPROC_SERVER) hr=0x${(hr2 >>> 0).toString(16)}`);