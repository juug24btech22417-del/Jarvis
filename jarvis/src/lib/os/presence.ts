// Presence scenes — what actually happens when your phone arrives or leaves.
//
// Server-only. Talks to the same native modules the phone broker uses, so the
// two never disagree about what "lock the desk" or "unmute" means.
//
// Runtime requires on purpose: these are native .cjs modules that must not be
// bundled, exactly like /api/remote/status does for remoteBroker.cjs.

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

type NativeInput = {
  sendMediaKey: (action: string) => unknown;
  lockWorkstation: () => unknown;
};
type NativeVolume = {
  getMasterVolume: () => number | null;
  setMasterVolume: (level: number) => unknown;
  setMute: (muted: boolean) => unknown;
};
type AppEntry = { label: string; cmd: string };

export interface SceneResult {
  actions: string[];
  message: string;
}

const g = globalThis as unknown as {
  __jarvisPresenceNative?: { input: NativeInput | null; volume: NativeVolume | null; apps: Record<string, AppEntry> };
};

function load<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function native() {
  if (g.__jarvisPresenceNative) return g.__jarvisPresenceNative;
  // Static specifiers (not a computed path) so webpack resolves @/ at build
  // time and leaves the native .cjs modules to be required at runtime.
  const mod = {
    input: load(() => require("@/lib/os/input.cjs") as NativeInput),
    volume: load(() => require("@/lib/os/volume.cjs") as NativeVolume),
    apps: load(() => (require("@/lib/os/apps.cjs") as { APPS: Record<string, AppEntry> }).APPS) ?? {},
  };
  g.__jarvisPresenceNative = mod;
  return mod;
}

/**
 * Level restored when the desk was muted or silent. Deliberately not "max" —
 * arriving home should not blast audio at whoever is still asleep.
 */
const WELCOME_VOLUME = 35;
/** Let the mute land before the lock screen covers everything. */
const LOCK_DELAY_MS = 1200;

/** Phone arrived: sound back on, your apps up. */
export async function runWelcomeScene(apps: string[]): Promise<SceneResult> {
  const { volume, apps: catalog } = native();
  const actions: string[] = [];

  try {
    // Reported as the resulting state, not as "I changed something" — we have
    // no reliable get-mute, and claiming an unmute that wasn't needed is
    // exactly the kind of invented detail this whole feature avoids.
    volume?.setMute(false);
    actions.push("sound on");
  } catch {
    /* a failed unmute must not abort the rest of the scene */
  }

  try {
    const level = volume?.getMasterVolume();
    if (level === 0) {
      volume?.setMasterVolume(WELCOME_VOLUME);
      actions.push(`volume restored to ${WELCOME_VOLUME}%`);
    }
  } catch {
    /* ignore */
  }

  const launched: string[] = [];
  for (const id of apps) {
    const entry = catalog[id];
    if (!entry) continue;
    try {
      await execAsync(entry.cmd, { timeout: 8000, windowsHide: true });
      launched.push(entry.label);
    } catch {
      /* one app failing to start should not stop the others */
    }
  }
  if (launched.length) actions.push(`launched ${launched.join(", ")}`);

  const message = actions.length
    ? `Welcome back — ${actions.join(", ")}.`
    : "Welcome back.";
  return { actions, message };
}

/** Phone left: pause media, mute, lock the desk. */
export async function runAwayScene(): Promise<SceneResult> {
  const { input, volume } = native();
  const actions: string[] = [];

  try {
    input?.sendMediaKey("play-pause");
    actions.push("media paused");
  } catch {
    /* ignore */
  }

  try {
    volume?.setMute(true);
    actions.push("sound muted");
  } catch {
    /* ignore */
  }

  // Lock last, and slightly later, so the pause/mute are visibly applied first.
  await new Promise((resolve) => setTimeout(resolve, LOCK_DELAY_MS));
  try {
    if (input?.lockWorkstation) input.lockWorkstation();
    else await execAsync("rundll32.exe user32.dll,LockWorkStation", { timeout: 5000, windowsHide: true });
    actions.push("desk locked");
  } catch {
    /* ignore */
  }

  const message = actions.length ? `Phone left — ${actions.join(", ")}.` : "Phone left.";
  return { actions, message };
}
