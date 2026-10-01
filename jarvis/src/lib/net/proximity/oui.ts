// MAC OUI vendor table + helpers.
//
// This is DATA, not logic: a MAC's first three bytes (the OUI) are assigned to
// a manufacturer by the IEEE. We ship a curated subset of the vendors that
// actually show up on home/office LANs (phones, laptops, routers, IoT) so
// JARVIS can label a device without any cloud lookup. Unknown prefixes simply
// return null — we never guess a vendor.
//
// It is intentionally easy to extend: add `"AABBCC": "Vendor"` entries.

/** Normalise any MAC form to 12 uppercase hex chars, or null when invalid. */
export function normalizeMac(mac: string | undefined | null): string | null {
  if (!mac) return null;
  const hex = mac.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  // Accept 12 chars (full MAC) — reject the 8-char IPv6 link-local form etc.
  return hex.length === 12 ? hex : null;
}

/** 12-hex MAC → "AA:BB:CC:DD:EE:FF". */
export function prettyMac(mac: string): string {
  return mac.match(/.{2}/g)?.join(":") ?? mac;
}

/**
 * True when the MAC is locally administered (bit 1 of the first octet set).
 * Randomized/private MACs (iOS/Android privacy) always land here — a strong
 * signal that the vendor lookup is meaningless and the identity is unstable.
 */
export function isLocallyAdministered(mac: string): boolean {
  if (!/^[0-9A-F]{12}$/.test(mac)) return false;
  const first = parseInt(mac.slice(0, 2), 16);
  return (first & 0b00000010) !== 0;
}

const VENDORS: Record<string, string> = {
  // ── Apple ──
  "001B63": "Apple", "001CB3": "Apple", "001EC2": "Apple", "0023DF": "Apple",
  "002608": "Apple", "040CCE": "Apple", "041E64": "Apple", "0452F3": "Apple",
  "04D3CF": "Apple", "086698": "Apple", "0C3021": "Apple", "0C4DE9": "Apple",
  "1040F3": "Apple", "14109F": "Apple", "183451": "Apple", "1CABA7": "Apple",
  "2078F0": "Apple", "286ABA": "Apple", "2CB43A": "Apple", "3408BC": "Apple",
  "38C986": "Apple", "3C0754": "Apple", "406C8F": "Apple", "442A60": "Apple",
  "4860BC": "Apple", "4C57CA": "Apple", "50EAD6": "Apple", "542696": "Apple",
  "581FAA": "Apple", "5C95AE": "Apple", "600308": "Apple", "6476BA": "Apple",
  "68A86D": "Apple", "6C4008": "Apple", "701124": "Apple", "78CA39": "Apple",
  "7C6D62": "Apple", "80BE05": "Apple", "84FCFE": "Apple", "8866A5": "Apple",
  "8C8EF2": "Apple", "90B0ED": "Apple", "94E96A": "Apple", "9801A7": "Apple",
  "9C04EB": "Apple", "A0999B": "Apple", "A4C361": "Apple", "A85C2C": "Apple",
  "AC61EA": "Apple", "B065BD": "Apple", "B4F0AB": "Apple", "B817C2": "Apple",
  "B8E856": "Apple", "BC52B7": "Apple", "C09F42": "Apple", "C4B301": "Apple",
  "C82A14": "Apple", "C8B5B7": "Apple", "CC08E0": "Apple", "D023DB": "Apple",
  "D0817A": "Apple", "D49A20": "Apple", "D8004D": "Apple", "DC2B2A": "Apple",
  "E0ACCB": "Apple", "E48B7F": "Apple", "E4CE8F": "Apple", "F01898": "Apple",
  "F099BF": "Apple", "F41BA1": "Apple", "F8FFC2": "Apple",

  // ── Samsung (phones, tablets, TVs) ──
  "2CAE2B": "Samsung", "3C5AB4": "Samsung", "8C7712": "Samsung", "E8508B": "Samsung",
  "5C0A5B": "Samsung", "781FDB": "Samsung", "8425DB": "Samsung", "38AA3C": "Samsung",
  "400E85": "Samsung", "683E34": "Samsung", "88366C": "Samsung", "A02195": "Samsung",
  "B43A28": "Samsung", "C819F7": "Samsung", "D022BE": "Samsung", "E47CF9": "Samsung",
  "F025B7": "Samsung", "9C0298": "Samsung", "AC5F3E": "Samsung", "D0176A": "Samsung",

  // ── Xiaomi / Redmi / POCO ──
  "009EC8": "Xiaomi", "04CF8C": "Xiaomi", "0C1DAF": "Xiaomi", "102AB3": "Xiaomi",
  "14F65A": "Xiaomi", "185936": "Xiaomi", "2034FB": "Xiaomi", "286C07": "Xiaomi",
  "3480B3": "Xiaomi", "38A4ED": "Xiaomi", "3CBDD8": "Xiaomi", "40313C": "Xiaomi",
  "44237C": "Xiaomi", "4C49E3": "Xiaomi", "508F4C": "Xiaomi", "584498": "Xiaomi",
  "5C9960": "Xiaomi", "640980": "Xiaomi", "64B473": "Xiaomi", "68ABBC": "Xiaomi",
  "6CF17E": "Xiaomi", "7451BA": "Xiaomi", "7802F8": "Xiaomi", "7811DC": "Xiaomi",
  "7C1DD9": "Xiaomi", "80AD16": "Xiaomi", "8CBEBE": "Xiaomi", "98FAE3": "Xiaomi",
  "9C99A0": "Xiaomi", "A086C6": "Xiaomi", "A45046": "Xiaomi", "ACC1EE": "Xiaomi",
  "B0E235": "Xiaomi", "C40BCB": "Xiaomi", "C8478C": "Xiaomi", "CC2D1B": "Xiaomi",
  "D4970B": "Xiaomi", "E446DA": "Xiaomi", "F48B32": "Xiaomi", "F8A45F": "Xiaomi",

  // ── OnePlus / Oppo / Realme / Vivo ──
  "94652D": "OnePlus", "C0EEFB": "OnePlus", "64A2F9": "OnePlus", "8C3AE3": "OnePlus",
  "A4C1EE": "Oppo", "B0D59D": "Oppo", "E8BBA8": "Oppo", "5C3A3D": "Oppo",
  "6C5C14": "Realme", "7CD95C": "Realme", "A0E453": "Realme",
  "3C831E": "Vivo", "4C74BF": "Vivo", "90F1AA": "Vivo",
  "90F652": "Huawei", "00E0FC": "Huawei", "04BD70": "Huawei", "10474F": "Huawei",
  "4C5499": "Huawei", "6CE873": "Huawei", "781DBA": "Huawei",

  // ── Google / Motorola / Nokia / Sony ──
  "F4F5D8": "Google", "F88FCA": "Google", "30FDA4": "Google", "441499": "Google",
  "E4B318": "Motorola", "C02EE5": "Motorola", "F894C2": "Motorola",
  "B0C4E7": "Nokia", "B8F8BE": "Nokia", "FCE557": "Sony", "D8D43C": "Sony",
  "FCF152": "Sony", "A0E5E9": "Sony",

  // ── Computers / NIC vendors ──
  "001B21": "Intel", "001E67": "Intel", "00216A": "Intel",
  "00226B": "Intel", "3C7C3F": "Intel", "48F17F": "Intel", "5CE0C5": "Intel",
  "7CB27D": "Intel", "94B86D": "Intel", "A4BF01": "Intel", "B49691": "Intel",
  "D8FCCD": "Intel", "F48E38": "Intel", "F8B156": "Intel",
  "00238B": "Dell", "14B31F": "Dell", "1866DA": "Dell", "24B6FD": "Dell",
  "3417EB": "Dell", "3C2C30": "Dell", "44A842": "Dell", "5CF9DD": "Dell",
  "74867A": "Dell", "782BCB": "Dell", "B88584": "Dell", "C8FFF7": "Dell",
  "10E7C6": "HP", "1458D0": "HP", "30E171": "HP", "3C4A92": "HP", "480FCF": "HP",
  "70106F": "HP", "9457A5": "HP", "A0481C": "HP", "B4B52F": "HP", "D48564": "HP",
  "B827EB": "Raspberry Pi", "DCA632": "Raspberry Pi", "E45F01": "Raspberry Pi",
  "2CCF67": "Raspberry Pi", "E8DA3C": "Raspberry Pi",
  "001B44": "Lenovo", "B0A4D3": "Lenovo", "D8D385": "Lenovo", "F8A963": "Lenovo",
  "00E04C": "Realtek", "1CBFCE": "Realtek",

  // ── Networking / infra ──
  "50C7BF": "TP-Link", "6032B1": "TP-Link", "98DAC4": "TP-Link", "A42BB0": "TP-Link",
  "C46E1F": "TP-Link", "D84C90": "TP-Link", "F4016A": "TP-Link", "F4F26D": "TP-Link",
  "204E7F": "Netgear", "28C68E": "Netgear", "405D82": "Netgear", "9C3DCF": "Netgear",
  "A06391": "Netgear", "B03956": "Netgear", "C40415": "Netgear", "E091F5": "Netgear",
  "0023FE": "Ubiquiti", "0418D6": "Ubiquiti", "24A43C": "Ubiquiti", "44D9E7": "Ubiquiti",
  "68D79A": "Ubiquiti", "7483C2": "Ubiquiti", "802AA8": "Ubiquiti", "B4FBE4": "Ubiquiti",
  "F492BF": "Ubiquiti", "FCECDA": "Ubiquiti",
  "003048": "Cisco", "0050F2": "Cisco", "D4EB68": "Cisco", "F02929": "Cisco",
  "000C42": "Routerboard", "48A98A": "Routerboard", "6C3B6B": "Routerboard",
  "001349": "Aruba", "186472": "Aruba", "204C03": "Aruba", "9C1C12": "Aruba",

  // ── IoT / smart home ──
  "240AC4": "Espressif", "246F28": "Espressif", "30AEA4": "Espressif",
  "3C71BF": "Espressif", "500291": "Espressif", "5CCF7F": "Espressif",
  "A4CF12": "Espressif", "B4E62D": "Espressif",
  "CC50E3": "Espressif", "D8A01D": "Espressif", "DC4F22": "Espressif",
  "ECFABC": "Espressif", "C4411E": "Espressif",
  "44650D": "Amazon", "4CEFC0": "Amazon", "6837E9": "Amazon", "747548": "Amazon",
  "84D6D0": "Amazon", "A002DC": "Amazon", "B47C9C": "Amazon", "F0272D": "Amazon",
  "5CAAFD": "Sonos", "48A6B8": "Sonos", "949F3E": "Sonos", "B8E937": "Sonos",
  "000B82": "Grandstream", "D8D5B9": "Google", "6C2995": "Roku", "AC3A7A": "Roku",
  "B0A737": "Roku", "CC6DA0": "Roku", "D83134": "Roku",
};

/** IEEE-registered vendor for a 12-hex MAC, or null when unknown. */
export function vendorForMac(mac: string): string | null {
  const prefix = mac.slice(0, 6).toUpperCase();
  return VENDORS[prefix] ?? null;
}

export type DeviceClass =
  | "phone"
  | "tablet"
  | "computer"
  | "router"
  | "tv"
  | "speaker"
  | "console"
  | "iot"
  | "wearable"
  | "unknown";

/** Vendor → coarse device class. Confidence is separate (see classifyDevice). */
export function classForVendor(vendor: string | null): DeviceClass | null {
  if (!vendor) return null;
  switch (vendor) {
    case "Apple":
    case "Samsung":
    case "Xiaomi":
    case "OnePlus":
    case "Oppo":
    case "Realme":
    case "Vivo":
    case "Huawei":
    case "Google":
    case "Motorola":
    case "Nokia":
    case "Sony":
      return "phone";
    case "TP-Link":
    case "Netgear":
    case "Ubiquiti":
    case "Cisco":
    case "Aruba":
    case "Routerboard":
    case "Grandstream":
      return "router";
    case "Intel":
    case "Dell":
    case "HP":
    case "Lenovo":
    case "Realtek":
      return "computer";
    case "Raspberry Pi":
      return "computer";
    case "Espressif":
      return "iot";
    case "Amazon":
      return "iot";
    case "Sonos":
      return "speaker";
    case "Roku":
      return "tv";
    default:
      return null;
  }
}

/** Apple/Samsung/etc. also make TVs/tablets/watches — keyword refinements live
 *  in classifyDevice(), which can use the hostname to sharpen this. */
export const OUI_ENTRY_COUNT = Object.keys(VENDORS).length;
