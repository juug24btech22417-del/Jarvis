// Pure IPv4 subnet math. No OS, no I/O — unit-testable.
//
// The old proximity sweep assumed a /24, which silently missed every host on a
// wider subnet (this machine is on a /22). These helpers derive the real
// network from the interface's own netmask.

export function ipToInt(ip: string): number {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p) || p < 0 || p > 255)) return -1;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

/** "255.255.252.0" → 22. Returns -1 for a non-contiguous/invalid mask. */
export function maskToCidr(mask: string): number {
  const n = ipToInt(mask);
  if (n < 0) return -1;
  let cidr = 0;
  for (let i = 31; i >= 0; i--) {
    if (n & (1 << i)) cidr++;
    else break;
  }
  // Validate contiguity: all bits after cidr must be zero.
  const expected = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
  return expected === n ? cidr : -1;
}

export function networkAddress(ip: string, cidr: number): string {
  const n = ipToInt(ip);
  const mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
  return intToIp((n & mask) >>> 0);
}

export interface SubnetInfo {
  cidr: number;
  network: string;
  /** Usable hosts (excludes network + broadcast). */
  hostCount: number;
  /** True when the subnet was larger than `cap` and had to be truncated. */
  truncated: boolean;
}

/** Summarise an interface's subnet, capping the enumerable host count. */
export function subnetInfo(ip: string, mask: string, cap = 4096): SubnetInfo {
  const cidr = maskToCidr(mask);
  if (cidr < 0) {
    const fallback = maskToCidr("255.255.255.0");
    return { cidr: fallback, network: networkAddress(ip, fallback), hostCount: 254, truncated: false };
  }
  const total = cidr >= 31 ? 0 : Math.pow(2, 32 - cidr) - 2;
  return {
    cidr,
    network: networkAddress(ip, cidr),
    hostCount: Math.min(total, Math.max(0, cap)),
    truncated: total > cap,
  };
}

/** Enumerate usable host addresses, bounded by `cap`. */
export function enumerateHosts(ip: string, cidr: number, cap = 4096): string[] {
  const base = ipToInt(networkAddress(ip, cidr));
  const total = cidr >= 31 ? 0 : Math.pow(2, 32 - cidr);
  const usable = Math.max(0, total - 2);
  const count = Math.min(usable, cap);
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(intToIp((base + 1 + i) >>> 0));
  return out;
}
