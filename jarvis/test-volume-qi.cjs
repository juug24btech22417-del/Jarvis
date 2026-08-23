// Probe which interfaces MMDeviceEnumerator IUnknown actually exposes.
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

function qi(objPtr, iidObj) {
  // Walk vtable[0] = QueryInterface.
  const ptrSize = 8;
  const vtBuf = koffi.view(objPtr, ptrSize);
  const vtable = new DataView(vtBuf).getBigUint64(0, true);
  const qifnBuf = koffi.view(vtable, ptrSize);
  const qifn = new DataView(qifnBuf).getBigUint64(0, true);

  const iidBuf = koffi.alloc(GUID_T, 1);
  koffi.encode(iidBuf, GUID_T, iidObj);
  const outPtr = koffi.alloc('void *', 1);
  const thisBuf = koffi.alloc('void *', 1);
  koffi.encode(thisBuf, 'void *', objPtr);
  const proto = koffi.proto('int', ['void *', GUID_T, 'void **']);
  const hr = koffi.call(qifn, proto, thisBuf, iidBuf, outPtr);
  const ptr = koffi.decode(outPtr, 'void *');
  return { hr, ptr };
}

const CLSID_MMDeviceEnumerator = {
  Data1: 0xBCDE0395, Data2: 0xE52F, Data3: 0x467C,
  Data4: [0x8E, 0x3D, 0xC4, 0x57, 0x92, 0x91, 0x69, 0x2E],
};
const IID_IUnknown = {
  Data1: 0x00000000, Data2: 0x0000, Data3: 0x0000,
  Data4: [0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46],
};
const IID_IMMDeviceEnumerator = {
  Data1: 0xA95664D2, Data2: 0x9614, Data3: 0x4F35,
  Data4: [0xA7, 0x46, 0xDE, 0x8D, 0xB6, 0x36, 0x25, 0xE6],
};
const IID_IDispatch = {
  Data1: 0x00020400, Data2: 0x0000, Data3: 0x0000,
  Data4: [0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46],
};
const IID_IPolicyConfig = {
  Data1: 0xF8679F50, Data2: 0x850A, Data3: 0x41CF,
  Data4: [0x9C, 0x72, 0x43, 0x0F, 0x29, 0x02, 0x90, 0xC8],
};

const hr0 = CoInitializeEx(null, 0x2);

const clsidBuf = koffi.alloc(GUID_T, 1);
koffi.encode(clsidBuf, GUID_T, CLSID_MMDeviceEnumerator);
const iidUnkBuf = koffi.alloc(GUID_T, 1);
koffi.encode(iidUnkBuf, GUID_T, IID_IUnknown);
const slot = koffi.alloc('void *', 1);
const hr = CoCreateInstance(clsidBuf, null, 0x1, iidUnkBuf, slot);
const objPtr = koffi.decode(slot, 'void *');
console.log('objPtr =', objPtr);

const probes = [
  ['IUnknown       ', IID_IUnknown],
  ['IMMDeviceEnum  ', IID_IMMDeviceEnumerator],
  ['IDispatch      ', IID_IDispatch],
  ['IPolicyConfig  ', IID_IPolicyConfig],
];
for (const [label, iid] of probes) {
  const r = qi(objPtr, iid);
  console.log(`  ${label}: hr=0x${(r.hr >>> 0).toString(16)} ptr=${r.ptr}`);
}