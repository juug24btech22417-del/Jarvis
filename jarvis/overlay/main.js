// JARVIS STEALTH OVERLAY — the window shell.
//
// WHY ELECTRON AND NOT JUST A BROWSER WINDOW
// ------------------------------------------
// The capture exemption is SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE),
// and Windows refuses that call unless the CALLING PROCESS OWNS THE WINDOW
// (verified: GetLastError = 5, ERROR_ACCESS_DENIED when called on a Chrome
// window from the Jarvis server). So the window has to belong to a process we
// control. This is that process.
//
// It owns one frameless, transparent, always-on-top window, calls
// setContentProtection(true) — Electron's binding for the same Win32 call — and
// loads the ordinary Jarvis page at /stealth, so all the UI, transcription and
// answering logic stays in the Next.js app where it belongs.
//
// Result: the HUD floats over your call, genuinely translucent, and is simply
// absent from Zoom / Meet / Teams / OBS / getDisplayMedia.

const { app, BrowserWindow, ipcMain, globalShortcut, screen, clipboard, session, desktopCapturer } = require("electron");
const path = require("path");
const http = require("http");

// Debug builds expose a Chrome DevTools Protocol endpoint so the HUD can be
// driven end-to-end by a script (scratch/overlay_e2e.mjs). Off by default — a
// debuggable window is not something to leave listening on a machine that is
// sharing its screen.
if (process.env.JARVIS_OVERLAY_DEBUG === "1") {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.JARVIS_OVERLAY_DEBUG_PORT || "9227");
}

// A machine with no microphone cannot exercise the capture half of the HUD at
// all, so the e2e run can ask Chromium for a synthetic audio device. Test-only:
// in a normal launch there is no fake device and LISTEN uses the real ears.
if (process.env.JARVIS_OVERLAY_FAKE_MEDIA === "1") {
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
}

const OVERLAY_URL = process.env.JARVIS_OVERLAY_URL || "http://localhost:3000/stealth?host=electron";
// Everything the HUD can show — mode bar, answer, transcript, controls — needs
// the room; it is resizable, and remembers nothing, so the default is generous.
const WIDTH = Number(process.env.JARVIS_OVERLAY_WIDTH || 460);
const HEIGHT = Number(process.env.JARVIS_OVERLAY_HEIGHT || 720);
// The smallest the HUD may be dragged. The page's eight resize handles clamp to
// the same numbers, so a drag never disagrees with the shell about the floor.
const MIN_W = 160;
const MIN_H = 120;
const OVERLAY_ORIGIN = new URL(OVERLAY_URL).origin;
/** Print the OS affinity and exit — used to verify the shell without leaving a
 * window open on screen. */
const SELFTEST = process.env.JARVIS_OVERLAY_SELFTEST === "1";
/** How long to wait for the Jarvis server before showing "server offline". */
const SERVER_WAIT_MS = Number(process.env.JARVIS_OVERLAY_WAIT_MS || 25_000);

/** One cheap request to the dev server. Resolves true only on a real answer. */
function ping(timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(`${OVERLAY_ORIGIN}/stealth`, (res) => {
      res.resume();
      resolve(res.statusCode > 0);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(timeoutMs, () => req.destroy());
  });
}

/**
 * A blank window tells the user nothing, so when the server is not up we say
 * exactly that — in the window, where they are already looking — and swap in
 * the real HUD by itself the moment the server appears. Polling happens in
 * this process rather than in the page: a data: page cannot fetch localhost
 * without tripping CORS, and the shell owns a window it can navigate anyway.
 */
function offlinePage() {
  const html = `<!doctype html><meta charset="utf-8"><title>JARVIS OVERLAY</title>
<style>
  html,body{margin:0;height:100%;background:#04070f;color:#cfe9f5;font:13px/1.5 ui-monospace,Consolas,monospace}
  .w{height:100%;display:flex;flex-direction:column;justify-content:center;gap:10px;padding:22px;box-sizing:border-box}
  h1{margin:0;font-size:15px;letter-spacing:.14em;color:#ff5c5c}
  code{background:#0b1522;border:1px solid #16324a;border-radius:6px;padding:7px 9px;display:block;color:#7fe3ff;font-size:12px}
  .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#ffb020;margin-right:7px;animation:b 1s infinite}
  @keyframes b{50%{opacity:.25}}
  .muted{color:#7d97a8;font-size:12px}
</style>
<div class="w">
  <h1>JARVIS SERVER OFFLINE</h1>
  <div><span class="dot"></span>Waiting for ${OVERLAY_ORIGIN} …</div>
  <div class="muted">Start the Jarvis server, then this window loads the HUD by itself. In a terminal:</div>
  <code>cd jarvis &amp;&amp; npm run dev</code>
  <div class="muted">The overlay needs it for transcription and answers. Nothing else to do once it is up.</div>
</div>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function waitForServer() {
  const deadline = Date.now() + SERVER_WAIT_MS;
  let announced = false;
  while (Date.now() < deadline) {
    if (await ping()) return true;
    if (!announced) {
      console.log(`[overlay] ${OVERLAY_ORIGIN} is not answering yet — waiting…`);
      announced = true;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

/** Read back the OS-level affinity for a window WE own. Same-process only, which
 * is exactly why this lives here and not in the Jarvis server. */
function readAffinity(nativeHandleBuffer) {
  try {
    const koffi = require("koffi");
    const user32 = koffi.load("user32.dll");
    const GetWindowDisplayAffinity = user32.func(
      "bool __stdcall GetWindowDisplayAffinity(void *hWnd, _Out_ uint32 *pdwAffinity)"
    );
    // Electron hands back the raw HWND bytes.
    const hwnd = nativeHandleBuffer.readBigInt64LE(0);
    const slot = koffi.alloc("uint32", 1);
    const ok = GetWindowDisplayAffinity(hwnd, slot);
    const value = ok ? koffi.decode(slot, "uint32") : null;
    const name =
      value === 0x11
        ? "excluded-from-capture (invisible to screen share)"
        : value === 0x01
        ? "monitor-only (records as black)"
        : value === 0
        ? "NONE — not protected"
        : `unknown (${value})`;
    return { ok: !!ok, value, name };
  } catch (e) {
    return { ok: false, name: `could not read affinity: ${e && e.message ? e.message : e}` };
  }
}

let win = null;

// ── Remembered geometry ───────────────────────────────────────────────────
// Kept next to Electron's own profile data, as a tiny JSON file.
const BOUNDS_FILE = () => path.join(app.getPath("userData"), "overlay-bounds.json");

function readBounds() {
  try {
    const raw = require("fs").readFileSync(BOUNDS_FILE(), "utf8");
    const b = JSON.parse(raw);
    if ([b.x, b.y, b.width, b.height].every((n) => Number.isFinite(n))) {
      return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
    }
  } catch {
    /* first run, or a corrupt file: fall back to the defaults */
  }
  return null;
}

function writeBounds(bounds) {
  try {
    require("fs").writeFileSync(BOUNDS_FILE(), JSON.stringify(bounds), "utf8");
  } catch (e) {
    console.warn(`[overlay] could not save the window size: ${e && e.message}`);
  }
}

/** Keep a remembered window on a screen that still exists (monitors go away). */
function clampToDisplay(bounds) {
  try {
    const displays = screen.getAllDisplays();
    const fits = displays.some((d) => {
      const wa = d.workArea;
      return (
        bounds.x < wa.x + wa.width - 40 &&
        bounds.y < wa.y + wa.height - 40 &&
        bounds.x + bounds.width > wa.x + 40 &&
        bounds.y + bounds.height > wa.y + 40
      );
    });
    if (!fits) return null;
  } catch {
    /* no screen info — trust the file */
  }
  return bounds;
}

function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
}

/**
 * The global shortcuts, and the page commands they trigger.
 *
 * WHY THE SHELL OWNS THEM
 * -----------------------
 * The whole point of the overlay is that it sits behind the app the user is
 * actually working in — a call, an editor, a slide deck. Those apps HAVE the
 * focus, so a key handler inside the page would never see a keystroke. Electron's
 * globalShortcut works system-wide and forwards the command over IPC; the page
 * runs it (see overlay/preload.js → onCommand).
 *
 * The ids are the contract with src/lib/overlay/shortcuts.ts, which renders the
 * same list in the HUD's ⌘ panel. tests/overlayCommands.test.ts reads both files
 * and fails if they drift apart.
 */
const COMMANDS = [
  { accel: "Control+Shift+Space", command: "focus-ask" },
  { accel: "Control+Shift+H", command: "hide" },
  { accel: "Control+Shift+L", command: "toggle-listen" },
  { accel: "Control+Shift+M", command: "toggle-mute" },
  { accel: "Control+Shift+A", command: "ask-now" },
  { accel: "Control+Shift+R", command: "repeat" },
  { accel: "Control+Shift+E", command: "expand" },
  { accel: "Control+Shift+S", command: "summarize" },
  { accel: "Control+Shift+D", command: "cycle-density" },
  { accel: "Control+Shift+P", command: "toggle-privacy" },
  { accel: "Control+Shift+C", command: "toggle-context" },
  { accel: "Control+Shift+X", command: "clear-all" },
  { accel: "Control+Shift+K", command: "help" },
];

function registerGlobalCommands() {
  const failed = [];
  for (const { accel, command } of COMMANDS) {
    const ok = globalShortcut.register(accel, () => {
      if (!liveWindow()) return;
      // `hide` is the one command that must not re-show the window.
      if (command === "hide") {
        if (win.isVisible()) {
          win.hide();
        } else {
          win.show();
          win.focus();
          win.moveTop();
        }
        return;
      }
      // Everything else also brings the HUD up: a command whose effect cannot
      // be seen would look like a broken key.
      win.show();
      win.moveTop();
      if (command === "focus-ask") {
        win.focus();
        win.webContents.send("overlay:focus");
      }
      win.webContents.send("overlay:command", command);
    });
    if (!ok) failed.push(`${accel} (${command})`);
  }
  if (failed.length) {
    console.warn(`[overlay] another app already owns: ${failed.join(", ")} — those keys will do nothing`);
  } else {
    console.log(`[overlay] ${COMMANDS.length} global shortcuts registered`);
  }
}

function createWindow(startUrl) {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: Math.max(0, sw - WIDTH - 24),
    y: 64,
    frame: false,
    // NOT transparent:true. On Windows a transparent window and
    // WDA_EXCLUDEFROMCAPTURE both take the composition path and can fight each
    // other; a solid window plus setOpacity() below gives the same see-through
    // HUD (the whole window composites at that alpha over the desktop) without
    // risking the capture exemption. One knob, predictable result.
    transparent: false,
    backgroundColor: "#04070f",
    hasShadow: true,
    // Freely resizable down to a strip: the HUD is used at every size from a
    // one-line whisper to a full transcript, and the layout is a flex column of
    // min-h-0 stages, so nothing breaks on the way down. The floor is only here
    // so title-bar buttons stay grabbable and the resize handles keep a target.
    resizable: true,
    maximizable: true,
    minWidth: MIN_W,
    minHeight: MIN_H,
    alwaysOnTop: true,
    skipTaskbar: false,
    title: "JARVIS OVERLAY",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // ── The whole point ──────────────────────────────────────────────────────
  // On Windows this is SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE).
  win.setContentProtection(true);
  // Float above full-screen call windows too.
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Desktop see-through: this is the real "kinda transparent" — the window
  // composites at this alpha over whatever is behind it.
  win.setOpacity(Number(process.env.JARVIS_OVERLAY_OPACITY || 0.85));

  // Where the user last left it. A HUD that comes back the wrong size every
  // launch is a HUD you have to fix before every call.
  const saved = readBounds();
  if (saved) {
    win.setBounds(clampToDisplay(saved));
  }
  const remember = debounce(() => {
    if (!liveWindow() || win.isMinimized() || win.isMaximized()) return;
    writeBounds(win.getBounds());
  }, 400);
  win.on("resized", remember);
  win.on("moved", remember);

  // Typing in another app first is the normal case: when this window takes focus
  // back, tell the page so it can put the caret where the user is about to type.
  win.on("focus", () => {
    if (liveWindow()) win.webContents.send("overlay:focus");
  });

  win.loadURL(startUrl || OVERLAY_URL);

  // Keep the window honest if the HUD fails to render for any reason.
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    // -3 is ERR_ABORTED: our own re-navigation, not a real failure.
    if (SELFTEST || code === -3) return;
    console.warn(`[overlay] could not load ${url}: ${desc} (${code})`);
    win.loadURL(offlinePage());
    armServerWatch();
  });

  win.webContents.on("did-finish-load", () => {
    const affinity = readAffinity(win.getNativeWindowHandle());
    console.log(`[overlay] content protection → ${affinity.name}`);
    if (!affinity.ok || affinity.value === 0) {
      console.warn(
        "[overlay] WARNING: this window is NOT exempt from capture. " +
          "WDA_EXCLUDEFROMCAPTURE needs Windows 10 v2004 (build 19041) or newer."
      );
    }
    // Tell the page what the OS actually says, so the badge never lies.
    if (!win.webContents.isLoading()) win.webContents.send("overlay:status", affinity);

    if (SELFTEST) {
      console.log(`[overlay] SELFTEST ${affinity.ok && affinity.value ? "PASS" : "FAIL"}`);
      app.exit(affinity.ok && affinity.value ? 0 : 1);
    }
  });
}

/** While the offline page is up, keep checking and swap in the HUD ourselves. */
let watching = false;
function armServerWatch() {
  if (watching) return;
  watching = true;
  const tick = async () => {
    if (!win || win.isDestroyed()) return;
    if (await ping()) {
      watching = false;
      console.log("[overlay] server is up — loading the HUD");
      win.loadURL(OVERLAY_URL);
      return;
    }
    setTimeout(tick, 2000);
  };
  setTimeout(tick, 2000);
}

app.whenReady().then(async () => {
  // ── Capture permissions and system audio ───────────────────────────────
  // LISTEN is supposed to hear the OTHER side of the call. In Electron,
  // getDisplayMedia throws outright unless a display-media handler is
  // registered — which is why LISTEN did nothing in the shell and only ever
  // fell back to the microphone. `audio: "loopback"` is Windows system audio:
  // the HUD hears Zoom/Meet/Teams directly instead of through your speakers.
  try {
    session.defaultSession.setDisplayMediaRequestHandler(
      async (_request, callback) => {
        // getDisplayMedia always asks for a video track, and Electron refuses the
        // whole request (NotFoundError) if the callback supplies audio only —
        // which is exactly how LISTEN ended up dead in the shell. So hand it the
        // primary screen and throw the video away: the page already keeps the
        // unused track alive, and nothing is ever recorded from it.
        try {
          const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } });
          callback({ video: sources[0], audio: "loopback" });
        } catch (e) {
          console.warn(`[overlay] could not resolve a screen source for loopback audio: ${e && e.message}`);
          callback({ audio: "loopback" });
        }
      },
      { useSystemPicker: false }
    );
  } catch (e) {
    console.warn(`[overlay] system-audio loopback unavailable (${e && e.message}) — LISTEN will use the mic`);
  }

  // Grant only what this HUD actually uses: the camera-free audio capture above,
  // capture itself, and clipboard writes.
  const ALLOWED = new Set(["media", "display-capture", "clipboard-sanitized-write", "clipboard-read", "speaker-selection"]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED.has(permission));
  });

  if (SELFTEST) {
    createWindow();
    return;
  }

  const up = await waitForServer();
  createWindow(up ? OVERLAY_URL : offlinePage());
  if (!up) {
    console.warn(`[overlay] ${OVERLAY_ORIGIN} did not answer within ${SERVER_WAIT_MS / 1000}s.`);
    armServerWatch();
  }

  registerGlobalCommands();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Translucency and geometry come from the page's own controls.
// Every handler tolerates a window that is closing: the HUD polls status, and
// after app.quit() a late poll would otherwise throw "Object has been
// destroyed" into the console and look like a crash.
const liveWindow = () => win && !win.isDestroyed();

ipcMain.handle("overlay:set-opacity", (_e, value) => {
  if (!liveWindow()) return { ok: false };
  const v = Math.max(0.15, Math.min(1, Number(value) || 1));
  win.setOpacity(v);
  return { ok: true, opacity: v };
});

ipcMain.handle("overlay:status", () => (liveWindow() ? readAffinity(win.getNativeWindowHandle()) : { ok: false }));

/**
 * Free-form resizing from the page's grip.
 *
 * A frameless window is resizable from its edges, but a 4px border on an
 * always-on-top HUD that sits behind a call is a bad target — so the page draws
 * real handles and drives the window itself.
 *
 * Both handlers funnel through applyBox so the clamping lives in one place:
 * anything the page sends is forced above the floor and inside the display the
 * window is on, which is what keeps a drag from losing the window off-screen.
 */
ipcMain.handle("overlay:get-bounds", () => {
  if (!liveWindow()) return null;
  return { ...win.getBounds(), scale: screen.getPrimaryDisplay().scaleFactor };
});

function applyBox(box) {
  const b = win.getBounds();
  const num = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : fallback;
  };
  const display = screen.getDisplayMatching(b);
  const wa = display.workArea;
  const width = Math.min(Math.max(num(box?.width, b.width), MIN_W), Math.max(MIN_W, wa.width - 8));
  const height = Math.min(Math.max(num(box?.height, b.height), MIN_H), Math.max(MIN_H, wa.height - 8));
  // Keep a sliver of the title bar on screen whatever the requested origin.
  const x = Math.min(Math.max(num(box?.x, b.x), wa.x - width + 60), wa.x + wa.width - 60);
  const y = Math.min(Math.max(num(box?.y, b.y), wa.y), wa.y + wa.height - 40);
  win.setBounds({ x, y, width, height });
  const now = win.getBounds();
  return { ok: true, x: now.x, y: now.y, width: now.width, height: now.height };
}

// The bottom-right grip: resize only, the top-left corner stays put.
ipcMain.handle("overlay:set-size", (_e, size) => {
  if (!liveWindow()) return { ok: false };
  const b = win.getBounds();
  return applyBox({ x: b.x, y: b.y, width: size?.width, height: size?.height });
});

// Every other handle: an edge or corner drag that moves the origin as well, so
// the west/north sides can grow the window outwards instead of just shrinking it.
ipcMain.handle("overlay:set-bounds", (_e, box) => {
  if (!liveWindow()) return { ok: false };
  return applyBox(box);
});

/**
 * Copy through the OS clipboard instead of the page's clipboard API.
 * Chromium refuses `navigator.clipboard` unless the document has focus, and the
 * whole point of this HUD is to sit behind a call that has the focus — so the
 * COPY buttons failed exactly where they were most needed.
 */
ipcMain.handle("overlay:copy", (_e, text) => {
  clipboard.writeText(String(text ?? ""));
  return { ok: true };
});

ipcMain.on("overlay:hide", () => {
  if (liveWindow()) win.hide();
});

/** Bring the window forward and give it keyboard focus (Ctrl+Shift+Space). */
ipcMain.on("overlay:focus", () => {
  if (!liveWindow()) return;
  win.show();
  win.focus();
  win.moveTop();
});

ipcMain.on("overlay:close", () => app.quit());

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());
