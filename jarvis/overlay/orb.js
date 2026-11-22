// JARVIS ORB — the floating desktop companion's window shell.
//
// WHAT THIS PROCESS OWNS
// ----------------------
// One frameless, TRANSPARENT, always-on-top window with no taskbar entry that
// loads the ordinary JARVIS page at /orb. The page holds all the UI and the
// whole assistant pipeline; this file only does the things a page cannot:
//
//   transparency      the window, not CSS, decides what is see-through
//   always-on-top     floats over full-screen apps, on every virtual desktop
//   click-through     the window is 420×560 but only the orb/input take clicks
//   OS-level dragging the window follows the real cursor via screen sampling
//   cursor streaming  the page never gets mousemove while another app is
//                     focused, so gaze has to be pushed from here
//
// It deliberately does NOT call setContentProtection: that belongs to the
// stealth HUD (main.js), which must vanish from screen shares. The orb is meant
// to be seen.

const { app, BrowserWindow, ipcMain, globalShortcut, screen, Menu, shell, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");

const SERVER = process.env.JARVIS_ORB_SERVER || "http://localhost:3000";
const ORB_URL = process.env.JARVIS_ORB_URL || `${SERVER}/orb?host=electron`;

// The window is mostly empty space on purpose: the orb lives at the top, the
// speech bubble and input at the bottom. Everything transparent passes clicks
// straight through to the desktop.
const WIDTH = Number(process.env.JARVIS_ORB_WIDTH || 320);
const HEIGHT = Number(process.env.JARVIS_ORB_HEIGHT || 330);

// Debug builds expose a CDP endpoint so the orb can be driven end-to-end by a
// script (scripts/e2e-orb.mjs). Off by default — a debuggable always-on-top
// window is not something to leave listening on a real machine.
const DEBUG =
  process.env.JARVIS_ORB_DEBUG === "1" || process.argv.includes("--debug");
if (DEBUG) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.JARVIS_ORB_DEBUG_PORT || "9228");
}

/** Summon / dismiss from anywhere (Ctrl+Shift+O). */
const TOGGLE_ACCEL = process.env.JARVIS_ORB_HOTKEY || "Control+Shift+O";

// ── One orb per desktop ────────────────────────────────────────────────────
// A second launch (double-click, or a stale window left behind) must never
// stack another sphere on the screen — it hands focus to the orb you already
// have and exits. Only this app takes the lock, so it never conflicts with the
// stealth overlay (main.js), which does not ask for one.
if (!app.requestSingleInstanceLock()) {
  console.log("[orb] another orb is already running — showing that one instead");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!liveWindow()) return;
    win.show();
    win.moveTop();
  });
}

const SERVER_WAIT_MS = Number(process.env.JARVIS_ORB_WAIT_MS || 25_000);

let win = null;
let cursorTimer = null;
let lastCursor = { x: -1, y: -1 };

const liveWindow = () => win && !win.isDestroyed();

// ── Remembered position ────────────────────────────────────────────────────
// A companion that forgets where you put it is a companion you keep moving.
const BOUNDS_FILE = () => path.join(app.getPath("userData"), "orb-bounds.json");

function readBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(BOUNDS_FILE(), "utf8"));
    if (Number.isFinite(b.x) && Number.isFinite(b.y)) {
      return { x: Math.round(b.x), y: Math.round(b.y) };
    }
  } catch {
    /* first run */
  }
  return null;
}

function writeBounds() {
  if (!liveWindow()) return;
  try {
    const { x, y } = win.getBounds();
    fs.writeFileSync(BOUNDS_FILE(), JSON.stringify({ x, y }), "utf8");
  } catch (e) {
    console.warn(`[orb] could not save position: ${e && e.message}`);
  }
}

/** Default spot: bottom-right of the primary work area, clear of the taskbar. */
function defaultPosition() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - WIDTH - 24, y: wa.y + wa.height - HEIGHT - 16 };
}

/** Keep the orb on a display that still exists (monitors get unplugged). */
function clampToDisplays(pos) {
  try {
    const ok = screen.getAllDisplays().some((d) => {
      const wa = d.workArea;
      return (
        pos.x + WIDTH > wa.x + 60 &&
        pos.x < wa.x + wa.width - 60 &&
        pos.y + 80 > wa.y &&
        pos.y < wa.y + wa.height - 80
      );
    });
    if (!ok) return defaultPosition();
  } catch {
    /* no display info — trust the file */
  }
  return pos;
}

// ── Server readiness ──────────────────────────────────────────────────────
function ping(timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(`${SERVER}/orb`, (res) => {
      res.resume();
      resolve(res.statusCode > 0);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(timeoutMs, () => req.destroy());
  });
}

function offlinePage() {
  const html = `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;background:#04070f;color:#cfe9f5;font:13px/1.6 ui-monospace,Consolas,monospace}
  .w{height:100%;display:flex;flex-direction:column;justify-content:center;gap:10px;padding:26px;box-sizing:border-box}
  h1{margin:0;font-size:14px;letter-spacing:.16em;color:#ff5c5c}
  code{background:#0b1522;border:1px solid #16324a;border-radius:6px;padding:7px 9px;display:block;color:#7fe3ff;font-size:12px}
  .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#ffb020;margin-right:7px;animation:b 1s infinite}
  @keyframes b{50%{opacity:.25}}
  .m{color:#7d97a8;font-size:12px}
</style>
<div class="w">
  <h1>JARVIS ORB OFFLINE</h1>
  <div><span class="dot"></span>Waiting for ${SERVER} …</div>
  <div class="m">Start the Jarvis server, then this window loads the orb by itself:</div>
  <code>cd jarvis &amp;&amp; npm run dev</code>
</div>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function waitForServer() {
  const deadline = Date.now() + SERVER_WAIT_MS;
  while (Date.now() < deadline) {
    if (await ping()) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

let watching = false;
function armServerWatch() {
  if (watching) return;
  watching = true;
  const tick = async () => {
    if (!liveWindow()) return;
    if (await ping()) {
      watching = false;
      console.log("[orb] server is up — loading the orb");
      win.loadURL(ORB_URL);
      return;
    }
    setTimeout(tick, 2000);
  };
  setTimeout(tick, 2000);
}

// ── Cursor stream (gaze) ───────────────────────────────────────────────────
function startCursorStream() {
  if (cursorTimer) return;
  cursorTimer = setInterval(() => {
    if (!liveWindow() || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    if (p.x === lastCursor.x && p.y === lastCursor.y) return;
    lastCursor = p;
    const b = win.getBounds();
    win.webContents.send("orb:cursor", { x: p.x, y: p.y, bx: b.x, by: b.y, w: b.width, h: b.height });
  }, 33);
}

// ── Drag ───────────────────────────────────────────────────────────────────
// The window follows the OS cursor, not the page: a renderer-side drag loses
// the pointer as soon as the window slides out from under it. Sampling here
// makes the drag immune to pointer capture quirks and keeps the orb glued to
// the cursor at display refresh rate.
let drag = null;

ipcMain.handle("orb:drag-start", () => {
  if (!liveWindow()) return { ok: false };
  endDrag();
  const p = screen.getCursorScreenPoint();
  const b = win.getBounds();
  drag = { ox: p.x, oy: p.y, bx: b.x, by: b.y, moved: false, at: Date.now(), timer: null };
  drag.timer = setInterval(() => {
    if (!drag || !liveWindow()) return;
    const cur = screen.getCursorScreenPoint();
    const dx = cur.x - drag.ox;
    const dy = cur.y - drag.oy;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
    const wa = screen.getDisplayMatching({
      x: drag.bx,
      y: drag.by,
      width: WIDTH,
      height: HEIGHT,
    }).workArea;
    // Never let the orb be dragged fully off screen — 90px of it stays grabbable.
    const x = Math.min(Math.max(drag.bx + dx, wa.x - WIDTH + 90), wa.x + wa.width - 90);
    const y = Math.min(Math.max(drag.by + dy, wa.y - 40), wa.y + wa.height - 90);
    win.setBounds({ x: Math.round(x), y: Math.round(y), width: WIDTH, height: HEIGHT });
    // A pointerup that never arrives (focus stolen mid-drag) must not leave the
    // orb glued to the cursor forever.
    if (Date.now() - drag.at > 20_000) endDrag();
  }, 16);
  return { ok: true };
});

function endDrag() {
  if (!drag) return null;
  clearInterval(drag.timer);
  const moved = drag.moved;
  drag = null;
  return moved;
}

ipcMain.handle("orb:drag-end", () => {
  if (!liveWindow()) return { ok: false, moved: false };
  const moved = endDrag();
  if (moved) writeBounds();
  return { ok: true, moved: !!moved };
});

// ── OS Clipboard stream & accessor ───────────────────────────────────────
let clipboardTimer = null;
let lastClipboardText = "";

function startClipboardWatcher() {
  if (clipboardTimer) return;
  clipboardTimer = setInterval(() => {
    if (!liveWindow()) return;
    try {
      const text = clipboard.readText();
      if (text && text.trim() && text !== lastClipboardText) {
        lastClipboardText = text;
        win.webContents.send("orb:clipboard-change", text.trim());
      }
    } catch {
      /* ignore */
    }
  }, 1000);
}

ipcMain.handle("orb:get-clipboard", () => {
  try {
    const text = clipboard.readText();
    return text ? text.trim() : "";
  } catch {
    return "";
  }
});

// ── Window control ─────────────────────────────────────────────────────────
ipcMain.handle("orb:resize", (_e, { width, height }) => {
  if (!liveWindow()) return { ok: false };
  win.setSize(Math.round(width || WIDTH), Math.round(height || HEIGHT));
  return { ok: true };
});

ipcMain.handle("orb:set-ignore", (_e, ignore) => {
  if (!liveWindow()) return { ok: false };
  // `forward` keeps mousemove coming while clicks pass through, which is the
  // only way the page can tell it is being hovered at all.
  win.setIgnoreMouseEvents(!!ignore, { forward: true });
  return { ok: true };
});

ipcMain.on("orb:hide", () => liveWindow() && win.hide());
ipcMain.on("orb:quit", () => app.quit());
ipcMain.on("orb:open-app", () => shell.openExternal(`${SERVER}/`));
ipcMain.on("orb:open-external", (_e, url) => {
  if (url && typeof url === "string" && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
  }
});

ipcMain.on("orb:menu", () => {
  if (!liveWindow()) return;
  Menu.buildFromTemplate([
    {
      label: "Open full JARVIS",
      click: () => shell.openExternal(`${SERVER}/`),
    },
    { label: "Hide orb", accelerator: TOGGLE_ACCEL, click: () => win.hide() },
    { type: "separator" },
    { label: "Reload", click: () => win.reload() },
    { label: "Quit JARVIS", role: "quit" },
  ]).popup({ window: win });
});

function toggleOrb() {
  if (!liveWindow()) return;
  if (win.isVisible()) {
    win.hide();
    return;
  }
  win.show();
  win.moveTop();
}

// ── Window ─────────────────────────────────────────────────────────────────
function createWindow(startUrl) {
  const pos = clampToDisplays(readBounds() || defaultPosition());

  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: pos.x,
    y: pos.y,
    frame: false,
    // The whole point. Unlike the stealth HUD (which needs a solid window so it
    // can stay exempt from screen capture), the orb is meant to look like it is
    // floating on the desktop, so the window itself is see-through.
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    // Focusable: you have to be able to type into it.
    focusable: true,
    title: "JARVIS ORB",
    webPreferences: {
      preload: path.join(__dirname, "orb-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // The orb must keep animating while you work in another app.
      backgroundThrottling: false,
    },
  });

  // Above full-screen windows and on every virtual desktop.
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Start transparent to the mouse; the page turns hit-testing on when the
  // cursor is over the orb, the bubble or the input.
  win.setIgnoreMouseEvents(true, { forward: true });

  win.loadURL(startUrl || ORB_URL);

  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    if (code === -3) return; // our own navigation
    console.warn(`[orb] could not load ${url}: ${desc} (${code})`);
    win.loadURL(offlinePage());
    armServerWatch();
  });

  win.webContents.on("did-finish-load", () => {
    console.log(`[orb] loaded ${win.webContents.getURL().slice(0, 80)}`);
    startCursorStream();
    startClipboardWatcher();
  });

  win.on("closed", () => {
    win = null;
    endDrag();
  });

  // The page never grants itself permissions it does not need; the orb only
  // records audio for speech input.
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media");
  });
}

app.whenReady().then(async () => {
  const up = await waitForServer();
  createWindow(up ? ORB_URL : offlinePage());
  if (!up) {
    console.warn(`[orb] ${SERVER} did not answer within ${SERVER_WAIT_MS / 1000}s.`);
    armServerWatch();
  }

  const ok = globalShortcut.register(TOGGLE_ACCEL, toggleOrb);
  if (!ok) console.warn(`[orb] another app already owns ${TOGGLE_ACCEL} — summon key disabled`);
  else console.log(`[orb] ${TOGGLE_ACCEL} shows/hides the orb`);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// The orb lives in the tray-less background: closing its window quits.
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (cursorTimer) clearInterval(cursorTimer);
  if (clipboardTimer) clearInterval(clipboardTimer);
  endDrag();
});
