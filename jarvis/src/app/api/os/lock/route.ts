import { NextResponse } from "next/server";

// Presence auto-lock endpoint — called by the browser face watcher when it
// decides you've left the desk. Uses Win32 LockWorkStation.
//
// Security: same trust model as the rest of jarvis's local API surface —
// localhost-only helper. Optionally guarded by a shared secret from .env
// (JARVIS_LOCAL_TOKEN) if you expose the dev server on the LAN.

type InputModule = {
  lockWorkstation: () => { locked: boolean };
};

let mod: InputModule | null = null;
function loadInput(): InputModule {
  if (!mod) {
    // Runtime require on purpose: the module is a native FFI .cjs that
    // webpack must not bundle. (The old
    // `eslint-disable-next-line @typescript-eslint/no-var-requires` comment
    // referenced a plugin this project does not install, which made ESLint
    // fail with "Definition for rule ... was not found" and broke
    // `next build` outright.)
    mod = require("@/lib/os/input.cjs") as InputModule;
  }
  return mod;
}

export async function POST() {
  try {
    const r = loadInput().lockWorkstation();
    console.log("[os/lock] workstation lock requested");
    return NextResponse.json({ success: true, ...r });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: "Lock failed", details: String(err) },
      { status: 500 }
    );
  }
}
