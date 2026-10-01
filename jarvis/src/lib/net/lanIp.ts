import os from "os";
import { subnetInfo, type SubnetInfo } from "@/lib/net/proximity/netaddr";

export interface LanInterfaceCandidate {
  name: string;
  ip: string;
  priority: number;
}

interface CandidateWithMask extends LanInterfaceCandidate {
  netmask: string;
}

/** Score every non-internal IPv4 interface; Wi-Fi/Ethernet beat virtual adapters. */
function collectCandidates(): CandidateWithMask[] {
  const ifs = os.networkInterfaces();
  const candidates: CandidateWithMask[] = [];

  for (const [name, list] of Object.entries(ifs)) {
    const lower = name.toLowerCase();
    const isVirtual =
      lower.includes("wsl") ||
      lower.includes("vethernet") ||
      lower.includes("hyper-v") ||
      lower.includes("docker") ||
      lower.includes("virtual") ||
      lower.includes("vmware") ||
      lower.includes("tailscale") ||
      lower.includes("zerotier");

    for (const iface of list || []) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      let priority = 10;
      if (lower.includes("wi-fi") || lower.includes("wifi") || lower.includes("wireless") || lower.includes("wlan")) {
        priority = 100;
      } else if (lower.includes("ethernet") && !isVirtual) {
        priority = 80;
      } else if (!isVirtual) {
        priority = 50;
      } else {
        priority = 1;
      }
      candidates.push({ name, ip: iface.address, netmask: iface.netmask, priority });
    }
  }
  return candidates.sort((a, b) => b.priority - a.priority);
}

/**
 * Returns the true local Wi-Fi or physical Ethernet IP address.
 * Prioritizes Wi-Fi/Ethernet and filters out virtual adapters like WSL,
 * Hyper-V, Docker, VirtualBox, VMware, and Tailscale.
 */
export function getLanIP(): string {
  try {
    const best = collectCandidates()[0];
    if (best) return best.ip;
  } catch {}
  return "localhost";
}

export interface LanNetwork extends SubnetInfo {
  ip: string;
  netmask: string;
}

/**
 * The active interface's real subnet (IP + mask + derived CIDR/hosts), so a
 * sweep scans the whole network instead of assuming a /24.
 */
export function getLanNetwork(): (LanNetwork & { interface: string }) | null {
  try {
    const best = collectCandidates()[0];
    if (!best) return null;
    const info = subnetInfo(best.ip, best.netmask);
    return { ...info, ip: best.ip, netmask: best.netmask, interface: best.name };
  } catch {
    return null;
  }
}

/**
 * Returns all active IPv4 interfaces for user selection if needed
 */
export function getAllLanIPs(): LanInterfaceCandidate[] {
  try {
    return collectCandidates().map(({ name, ip, priority }) => ({ name, ip, priority }));
  } catch {
    return [];
  }
}
