import os from "os";

export interface LanInterfaceCandidate {
  name: string;
  ip: string;
  priority: number;
}

/**
 * Returns the true local Wi-Fi or physical Ethernet IP address.
 * Prioritizes Wi-Fi/Ethernet and filters out virtual adapters like WSL,
 * Hyper-V, Docker, VirtualBox, VMware, and Tailscale.
 */
export function getLanIP(): string {
  try {
    const ifs = os.networkInterfaces();
    const candidates: LanInterfaceCandidate[] = [];

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
        if (iface.family === "IPv4" && !iface.internal) {
          let priority = 10;
          if (
            lower.includes("wi-fi") ||
            lower.includes("wifi") ||
            lower.includes("wireless") ||
            lower.includes("wlan")
          ) {
            priority = 100;
          } else if (lower.includes("ethernet") && !isVirtual) {
            priority = 80;
          } else if (!isVirtual) {
            priority = 50;
          } else {
            priority = 1; // Virtual adapter fallback only
          }
          candidates.push({ name, ip: iface.address, priority });
        }
      }
    }

    candidates.sort((a, b) => b.priority - a.priority);
    if (candidates.length > 0) {
      return candidates[0].ip;
    }
  } catch {}
  return "localhost";
}

/**
 * Returns all active IPv4 interfaces for user selection if needed
 */
export function getAllLanIPs(): LanInterfaceCandidate[] {
  try {
    const ifs = os.networkInterfaces();
    const candidates: LanInterfaceCandidate[] = [];
    for (const [name, list] of Object.entries(ifs)) {
      for (const iface of list || []) {
        if (iface.family === "IPv4" && !iface.internal) {
          candidates.push({ name, ip: iface.address, priority: 1 });
        }
      }
    }
    return candidates;
  } catch {
    return [];
  }
}
