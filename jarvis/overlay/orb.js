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

const { app, BrowserWindow, ipcMain, globalShortcut, screen, Menu, shell, clipboard, desktopCapturer } = require("electron");
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
// `--debug` is swallowed by Electron's own Node CLI handling (DEP0062), so the
// flag is spelled `--orb-debug` — Electron passes unknown switches straight
// through to the app.
const DEBUG =
  process.env.JARVIS_ORB_DEBUG === "1" ||
  process.argv.includes("--orb-debug") ||
  process.argv.includes("--debug");
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

const send = (channel, payload) => {
  if (liveWindow()) win.webContents.send(channel, payload);
};

// ── Native window probing (Window Devourer) ────────────────────────────────
// Electron can list window TITLES but cannot tell you which window sits under
// a point, and shelling out to PowerShell per frame is far too slow for a live
// hover. koffi (already a dependency for the audio service) calls user32
// directly, so a hit-test costs microseconds and the orb can show its target
// while it is being dragged.
let win32 = null;

function natives() {
  if (win32 !== null) return win32;
  win32 = false;
  if (process.platform !== "win32") return win32;
  try {
    const koffi = require("koffi");
    const user32 = koffi.load("user32.dll");
    const POINT = koffi.struct("POINT", { x: "long", y: "long" });
    const RECT = koffi.struct("RECT", {
      left: "long",
      top: "long",
      right: "long",
      bottom: "long",
    });
    win32 = {
      koffi,
      POINT,
      RECT,
      GetTopWindow: user32.func("intptr GetTopWindow(intptr hwnd)"),
      GetWindow: user32.func("intptr GetWindow(intptr hwnd, uint32 cmd)"),
      IsIconic: user32.func("bool IsIconic(intptr hwnd)"),
      GetWindowRect: user32.func("bool GetWindowRect(intptr hwnd, _Out_ RECT *rect)"),
      GetWindowTextW: user32.func("int GetWindowTextW(intptr hwnd, void *buf, int max)"),
      GetClassNameW: user32.func("int GetClassNameW(intptr hwnd, void *buf, int max)"),
      GetWindowLongPtrW: user32.func("intptr GetWindowLongPtrW(intptr hwnd, int index)"),
      GetWindowThreadProcessId: user32.func(
        "uint32 GetWindowThreadProcessId(intptr hwnd, _Out_ uint32 *pid)"
      ),
      IsWindowVisible: user32.func("bool IsWindowVisible(intptr hwnd)"),
      GetAsyncKeyState: user32.func("short GetAsyncKeyState(int vk)"),
    };
    console.log("[orb] window devourer: native hit-testing ready");
  } catch (e) {
    console.warn(`[orb] window devourer unavailable (koffi/user32): ${e && e.message}`);
    win32 = false;
  }
  return win32;
}

/** The orb's own OS handle — never an edible target. */
function orbHwnd() {
  if (!liveWindow()) return 0;
  try {
    const b = win.getNativeWindowHandle();
    return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0);
  } catch {
    return 0;
  }
}

/**
 * Which window is at a screen point (DIP)? Returns null for the desktop, our
 * own windows, and invisible/zero-size shells.
 */
function windowAt(point) {
  const api = natives();
  if (!api) return null;
  const dip = point || screen.getCursorScreenPoint();
  let physical = dip;
  try {
    physical = screen.dipToScreenPoint({ x: Math.round(dip.x), y: Math.round(dip.y) });
  } catch {
    /* displays without a scale factor */
  }

  const px = Math.round(physical.x);
  const py = Math.round(physical.y);
  const self = orbHwnd();

  try {
    const rectBuf = api.koffi.alloc(api.RECT, 1);
    const pidBuf = api.koffi.alloc("uint32", 1);
    const titleBuf = api.koffi.alloc("uint16", 512);

    const rectOf = (h) => {
      if (!api.GetWindowRect(h, rectBuf)) return null;
      return api.koffi.decode(rectBuf, api.RECT);
    };
    const pidOf = (h) => {
      api.GetWindowThreadProcessId(h, pidBuf);
      return api.koffi.decode(pidBuf, "uint32");
    };
    const coversPoint = (h, x, y) => {
      const r = rectOf(h);
      return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };

    const wa = screen.getDisplayNearestPoint({
      x: Math.round(dip.x),
      y: Math.round(dip.y),
    }).workArea;

    // Describe a window as an edible target, or null when it is not one. Every
    // candidate gets the full test and the walk carries on past the rejects:
    // IME hosts, tool windows and 1px shells sit above real windows in the
    // Z-order, so stopping at the first covering window finds nothing useful.
    // Shell furniture that floats above real windows: the IME/input host, the
    // desktop, the taskbar. Eating them would only ever produce a blank frame.
    const NON_APP_CLASSES = new Set([
      "windows.ui.core.corewindow",
      "windows.internal.ui.xamllexplorersourcewindow",
      "ime",
      "msctfime ui",
      "foregroundstaging",
      "progman",
      "workerw",
      "shell_traywnd",
      "shell_secondarytraywnd",
      "multitaskingviewframe",
    ]);
    const classBuf = api.koffi.alloc("uint16", 256);
    const classOf = (h) => {
      const n = api.GetClassNameW(h, classBuf, 256);
      if (n <= 0) return "";
      const chars = api.koffi.decode(classBuf, "uint16", 256);
      let s = "";
      for (let i = 0; i < n && i < chars.length; i++) {
        if (!chars[i]) break;
        s += String.fromCharCode(chars[i]);
      }
      return s.trim();
    };

    const describe = (h) => {
      const pid = pidOf(h);
      // Our own windows are never edible — the orb must not eat itself.
      if (pid === process.pid) return null;

      // Tool windows, no-activate overlays and click-through layers are never
      // what someone is pointing at, even when they cover the whole screen.
      const ex = Number(api.GetWindowLongPtrW(h, -20 /* GWL_EXSTYLE */)) || 0;
      if (ex & 0x00000080 /* WS_EX_TOOLWINDOW */) return null;
      if (ex & 0x08000000 /* WS_EX_NOACTIVATE */) return null;
      if (ex & 0x00000020 /* WS_EX_TRANSPARENT */) return null;
      if (NON_APP_CLASSES.has(classOf(h).toLowerCase())) return null;

      const len = api.GetWindowTextW(h, titleBuf, 512);
      if (len <= 0) return null;
      const chars = api.koffi.decode(titleBuf, "uint16", 512);
      let title = "";
      for (let i = 0; i < len && i < chars.length; i++) {
        if (!chars[i]) break;
        title += String.fromCharCode(chars[i]);
      }
      title = title.trim();
      if (!title) return null;

      const r = rectOf(h);
      if (!r) return null;

      // Report geometry in DIP so the page and Electron agree on units.
      let tl = { x: r.left, y: r.top };
      let br = { x: r.right, y: r.bottom };
      try {
        tl = screen.screenToDipPoint(tl);
        br = screen.screenToDipPoint(br);
      } catch {
        /* 1:1 displays */
      }
      const width = Math.round(br.x - tl.x);
      const height = Math.round(br.y - tl.y);
      // Zero-size shells are not things a person means to pick up. A window
      // that fills the screen is fair game: terminals and editors are usually
      // maximised, and they are the most common thing to drag the orb onto.
      if (width < 120 || height < 90) return null;

      return {
        title,
        pid,
        hwnd: String(h),
        rect: { x: Math.round(tl.x), y: Math.round(tl.y), width, height },
      };
    };

    // Walk the Z-order from the top instead of asking WindowFromPoint: the orb
    // is click-through (WS_EX_TRANSPARENT) so the pointer reaches the window
    // underneath, but WindowFromPoint still hit-tests the transparent window
    // and would always answer "the orb". The first edible window covering the
    // point is the thing being aimed at.
    let candidate = api.GetTopWindow(0);
    for (let guard = 0; candidate && guard < 4000; guard++) {
      const h = Number(candidate);
      if (
        h &&
        h !== self &&
        api.IsWindowVisible(candidate) &&
        !api.IsIconic(candidate) &&
        coversPoint(candidate, px, py)
      ) {
        const found = describe(h);
        if (found) return found;
      }
      candidate = api.GetWindow(candidate, 2 /* GW_HWNDNEXT */);
    }
    return null;
  } catch (e) {
    console.warn(`[orb] hit-test failed: ${e && e.message}`);
    return null;
  }
}

/** Cheap token overlap, enough to pair a title with its capture source. */
function titleScore(a, b) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const A = norm(a);
  const B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const at = new Set(A.split(" "));
  const bt = new Set(B.split(" "));
  let shared = 0;
  for (const t of at) if (bt.has(t)) shared++;
  return shared / Math.max(at.size, bt.size);
}

/**
 * Luminance spread of a frame. A protected or hardware-accelerated window
 * captures as a flat black rectangle; saying so is better than pretending the
 * orb swallowed something it can see.
 */
function frameStats(image) {
  try {
    const bmp = image.toBitmap(); // BGRA
    const { width, height } = image.getSize();
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    for (let y = 0; y < height; y += 8) {
      for (let x = 0; x < width; x += 8) {
        const i = (y * width + x) * 4;
        const lum = 0.114 * bmp[i] + 0.587 * bmp[i + 1] + 0.299 * bmp[i + 2];
        sum += lum;
        sumSq += lum * lum;
        n++;
      }
    }
    if (!n) return { mean: 0, stddev: 0, blank: true };
    const mean = sum / n;
    const variance = Math.max(0, sumSq / n - mean * mean);
    const stddev = Math.sqrt(variance);
    return {
      mean: Number(mean.toFixed(1)),
      stddev: Number(stddev.toFixed(1)),
      blank: stddev < 3,
    };
  } catch {
    return { mean: 0, stddev: 0, blank: false };
  }
}

/** Snapshot one window by its title. */
async function captureWindowByTitle(title) {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: { width: 900, height: 900 },
      fetchWindowIcons: false,
    });
    let best = null;
    let bestScore = 0;
    for (const s of sources) {
      const name = (s.name || "").trim();
      if (!name) continue;
      if (/^jarvis orb$/i.test(name)) continue; // never eat ourselves
      const score = titleScore(name, title);
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (!best || bestScore < 0.5) {
      return {
        ok: false,
        error: "no matching window to capture",
        score: Number(bestScore.toFixed(2)),
      };
    }
    const image = best.thumbnail;
    const size = image.getSize();
    if (!size.width || !size.height) return { ok: false, error: "empty thumbnail" };
    return {
      ok: true,
      title: best.name,
      width: size.width,
      height: size.height,
      dataUrl: image.toDataURL(),
      ...frameStats(image),
    };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

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
//
// Window Devourer rides on the same gesture. While dragging, the window makes
// itself click-through so the hit-test underneath finds the REAL window rather
// than the orb parked on top of it, and the physical mouse button (not a DOM
// pointerup that can never arrive) decides when the bite lands.
const VK_LBUTTON = 0x01;

let drag = null;
let hoverTarget = null;
let lastHoverKey = "";

function setHover(next) {
  const key = next ? `${next.hwnd}|${next.title}` : "";
  hoverTarget = next;
  if (key === lastHoverKey) return;
  lastHoverKey = key;
  if (DEBUG) console.log(`[orb] devour target: ${next ? next.title : "(none)"}`);
  send("orb:devour-target", next);
}

ipcMain.handle("orb:drag-start", () => {
  if (!liveWindow()) return { ok: false };
  endDrag();
  const p = screen.getCursorScreenPoint();
  const b = win.getBounds();
  const api = natives();
  setHover(null);
  drag = {
    ox: p.x,
    oy: p.y,
    bx: b.x,
    by: b.y,
    moved: false,
    at: Date.now(),
    timer: null,
    probeAt: 0,
    api,
  };
  if (api) win.setIgnoreMouseEvents(true, { forward: true });

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

    if (drag.api) {
      const down = (Number(drag.api.GetAsyncKeyState(VK_LBUTTON)) & 0x8000) !== 0;
      if (!down) {
        finishDrag();
        return;
      }
      if (Date.now() - drag.probeAt > 80) {
        drag.probeAt = Date.now();
        setHover(windowAt(cur));
      }
    }
    // A pointerup that never arrives (focus stolen mid-drag) must not leave the
    // orb glued to the cursor forever.
    if (Date.now() - drag.at > 20_000) {
      if (drag.api) finishDrag();
      else endDrag();
    }
  }, 16);
  return { ok: true, devourer: !!api };
});

function endDrag() {
  if (!drag) return null;
  clearInterval(drag.timer);
  const { moved, api } = drag;
  drag = null;
  // Hand hit-testing back to the page, which re-enables it only when the cursor
  // is over something that should take clicks.
  if (api && liveWindow()) win.setIgnoreMouseEvents(true, { forward: true });
  return { moved, native: !!api };
}

function finishDrag() {
  const d = endDrag();
  if (!d) return;
  if (d.moved) writeBounds();
  const target = d.moved ? hoverTarget : null;

  // The page toggles the composer on a click, so every drag has to settle with
  // an answer — even when nothing was eaten. The drop goes first: clearing the
  // hover before it would blow away the card the drop is about to raise.
  // A plain drag only repositions the orb: holding Shift when the button comes
  // up is the commit gesture, so sliding the orb across the screen never spends
  // a question by accident.
  const api = natives();
  const commit =
    !!target && !!api && (Number(api.GetAsyncKeyState(0x10 /* VK_SHIFT */)) & 0x8000) !== 0;
  if (DEBUG) {
    console.log(
      `[orb] devour drop: moved=${d.moved} target=${target ? target.title : "(none)"} commit=${commit}`
    );
  }
  send("orb:devour-drop", { moved: d.moved, target, commit, capture: null });
  // Reset the hover silently: telling the page "no target" right after the
  // drop would unmount the card the drop just raised.
  hoverTarget = null;
  lastHoverKey = "";
  if (!commit) return;

  captureWindowByTitle(target.title).then((capture) => {
    send("orb:devour-capture", { target, capture });
  });
}

ipcMain.handle("orb:drag-end", () => {
  if (!liveWindow()) return { ok: false, moved: false };
  // The shell owns the gesture whenever it can read the physical mouse button.
  if (drag && drag.api) return { ok: true, moved: !!drag.moved, shellOwned: true };
  const d = endDrag();
  if (d && d.moved) writeBounds();
  return { ok: true, moved: !!(d && d.moved) };
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
ipcMain.handle("orb:open-path", async (_e, filePath) => {
  if (filePath && typeof filePath === "string") {
    try {
      const err = await shell.openPath(filePath);
      return { ok: !err, error: err || null };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  return { ok: false, error: "Invalid path" };
});

ipcMain.handle("orb:get-active-windows", async () => {
  try {
    const sources = await desktopCapturer.getSources({ types: ["window"], fetchWindowIcons: false });
    return sources.map((s) => s.name).filter(Boolean);
  } catch {
    return [];
  }
});

// ── Window Devourer bridge ────────────────────────────────────────────────
ipcMain.handle("orb:window-at", (_e, point) => {
  if (!liveWindow()) return null;
  return windowAt(point || null);
});

ipcMain.handle("orb:capture-window", async (_e, title) => {
  if (!title || typeof title !== "string") return { ok: false, error: "title required" };
  return captureWindowByTitle(title);
});

ipcMain.handle("orb:devour-supported", () => !!natives());

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
