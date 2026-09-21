// Phone remote broker — a tiny express server on port 3311 that your phone
// talks to over Wi-Fi. jarvis's web app generates a QR code containing
// http://<LAN-IP>:3311/remote (a self-contained control page), the phone
// opens it, and the remote drives the native input module: full trackpad,
// keyboard, media, volume, lock, and app launching.
//
// Zero new dependencies: express is already in package.json.

const express = require("express");
const os = require("os");
const { exec } = require("child_process");

const input = require("./input.cjs");

const PORT = 3311;
const app = express();
app.use(express.json());

// The phone is on the LAN; allow the control page to call us.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function lanIP() {
  const ifs = os.networkInterfaces();
  for (const list of Object.values(ifs)) {
    for (const i of list || []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return "localhost";
}

// Health/identity — the remote page checks this to show the right title.
app.get("/api/info", (req, res) => {
  res.json({ app: "jarvis-remote", host: os.hostname(), ip: lanIP() });
});

// Media + volume commands.
app.post("/api/media", (req, res) => {
  const { action } = req.body || {};
  try {
    const r = input.sendMediaKey(String(action || ""));
    res.json({ success: true, ...r });
  } catch (e) {
    res.status(400).json({ success: false, error: String(e) });
  }
});

// Volume: explicit level 0..100 (precise Core Audio path).
app.post("/api/volume", (req, res) => {
  const level = Number(req.body && req.body.level);
  try {
    const { setMasterVolume } = require("./volume.cjs");
    const r = setMasterVolume(level);
    res.json({ success: true, ...r });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e) });
  }
});

// Lock the PC from the couch.
app.post("/api/lock", (req, res) => {
  try {
    const r = input.lockWorkstation();
    res.json({ success: true, ...r });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e) });
  }
});

// ─── Trackpad / keyboard endpoints ─────────────────────────────────────────

// Relative cursor move (phone touch deltas → cursor pixels).
app.post("/api/mouse/move", (req, res) => {
  const { dx, dy } = req.body || {};
  try {
    const r = input.moveMouseRelative(Number(dx) || 0, Number(dy) || 0);
    res.json({ success: true, ...r });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e) });
  }
});

// Click / drag press / drag release.
app.post("/api/mouse/click", (req, res) => {
  try {
    const r = input.clickMouse(req.body?.button === "right" ? "right" : "left");
    res.json({ success: true, ...r });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e) });
  }
});
app.post("/api/mouse/down", (req, res) => {
  try {
    res.json({ success: true, ...input.mouseDown(req.body?.button === "right" ? "right" : "left") });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e) });
  }
});
app.post("/api/mouse/up", (req, res) => {
  try {
    res.json({ success: true, ...input.mouseUp(req.body?.button === "right" ? "right" : "left") });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e) });
  }
});

// Wheel scroll — dy/dx in wheel notches (±120 raw each).
app.post("/api/mouse/scroll", (req, res) => {
  const dy = Number(req.body?.dy) || 0;
  const dx = Number(req.body?.dx) || 0;
  try {
    res.json({ success: true, ...input.scrollWheel(dy, dx) });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e) });
  }
});

// Key chord — "alt+tab", "ctrl+w", "win", "enter", ...
app.post("/api/key", (req, res) => {
  try {
    const r = input.keyChord(String(req.body?.keys || ""));
    res.json({ success: true, ...r });
  } catch (e) {
    res.status(400).json({ success: false, error: String(e) });
  }
});

// Type unicode text into the focused window.
app.post("/api/type", (req, res) => {
  try {
    const r = input.typeText(String(req.body?.text ?? "").slice(0, 1000));
    res.json({ success: true, ...r });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e) });
  }
});

// Launch apps — explicit allowlist only, never raw shell from the phone.
const APPS = {
  spotify: { label: "Spotify", cmd: 'start "" "spotify:"' },
  chrome: { label: "Chrome", cmd: 'start "" chrome' },
  explorer: { label: "Files", cmd: 'start "" explorer' },
  terminal: { label: "Terminal", cmd: 'start "" cmd' },
  notepad: { label: "Notepad", cmd: 'start "" notepad' },
  calc: { label: "Calculator", cmd: 'start "" calc' },
  taskmgr: { label: "Task Manager", cmd: 'start "" taskmgr' },
};
app.get("/api/apps", (req, res) => {
  res.json({ success: true, apps: Object.entries(APPS).map(([id, a]) => ({ id, label: a.label })) });
});
app.post("/api/apps", (req, res) => {
  const id = String(req.body?.id || "");
  const a = APPS[id];
  if (!a) return res.status(400).json({ success: false, error: "unknown app" });
  exec(a.cmd, { shell: true }, (err) => {
    if (err) return res.status(500).json({ success: false, error: String(err) });
    res.json({ success: true, launched: id });
  });
});

// ─── The self-contained remote page (single file, mobile-first) ────────────
app.get("/remote", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#04070d">
<title>J.A.R.V.I.S. Remote</title>
<style>
  :root { --bg:#04070d; --panel:#0a1420; --line:#12283a; --cyan:#00d4ff; --dim:#4b6a80; --txt:#bfe9ff; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; user-select:none; -webkit-user-select:none; }
  html,body { height:100%; overscroll-behavior:none; }
  body { margin:0; font-family:ui-rounded,system-ui,sans-serif; background:
         radial-gradient(1200px 500px at 50% -10%, #0a1a2e 0%, var(--bg) 60%);
         color:var(--txt); display:flex; flex-direction:column; }
  header { display:flex; align-items:center; justify-content:space-between;
           padding:14px 18px 8px; }
  .brand { font-size:13px; letter-spacing:.4em; color:var(--cyan); font-weight:700; }
  .host { font-size:10px; color:var(--dim); letter-spacing:.1em; }
  main { flex:1; display:none; min-height:0; }
  main.active { display:flex; flex-direction:column; }

  /* ── Trackpad ── */
  #pad { flex:1; margin:6px 12px; border-radius:22px; position:relative;
         border:1px solid var(--line); touch-action:none;
         background:linear-gradient(160deg, rgba(13,34,54,.55), rgba(8,19,31,.9));
         box-shadow: inset 0 0 40px rgba(0,212,255,.03); }
  #pad .hint { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
               color:var(--dim); font-size:12px; letter-spacing:.15em; pointer-events:none;
               transition:opacity .3s; }
  #pad.dirty .hint { opacity:0; }
  .padbtns { display:grid; grid-template-columns:1fr 2fr 1fr; gap:10px; padding:0 12px 8px; }
  .pbtn { border:1px solid var(--line); background:var(--panel); color:var(--txt);
          border-radius:16px; padding:15px 0; font-size:13px; text-align:center; }
  .pbtn:active { background:#0d2236; border-color:var(--cyan); }
  .pbtn.hold { border-color:var(--cyan); color:var(--cyan); }

  /* ── Shared grids/buttons ── */
  .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; padding:4px 12px; overflow:auto; }
  button { border:1px solid var(--line); background:var(--panel); color:var(--txt);
           border-radius:16px; padding:20px 0; font-size:15px; cursor:pointer; transition:.12s; }
  button:active { background:#0d2236; border-color:var(--cyan); color:#fff; transform:scale(.97); }
  .wide { grid-column: span 3; padding:15px 0; letter-spacing:.2em; }
  .danger { border-color:#4a1620; color:#ff6b81; }
  .chip { font-size:12px; padding:12px 0; letter-spacing:.05em; }
  .volwrap { padding:10px 16px 4px; }
  input[type=range] { width:100%; accent-color:var(--cyan); height:34px; }
  .volrow { display:flex; align-items:center; gap:10px; }
  .volrow button { padding:12px 16px; }
  .status { min-height:18px; text-align:center; font-size:11px; color:var(--dim); padding:6px 0 10px; }

  /* ── Keyboard tab ── */
  .typeline { display:flex; gap:8px; padding:6px 12px 2px; }
  .typeline input { flex:1; background:var(--panel); border:1px solid var(--line); color:var(--txt);
                    border-radius:14px; padding:12px 14px; font-size:15px; outline:none; }
  .typeline input:focus { border-color:var(--cyan); }
  .typeline button { padding:0 22px; border-radius:14px; background:var(--cyan); color:#02141d;
                     border:none; font-weight:700; letter-spacing:.1em; }
  .krows { display:grid; grid-template-columns:repeat(5,1fr); gap:8px; padding:8px 12px; }
  .krows button { padding:13px 0; font-size:13px; border-radius:12px; }

  /* ── Tab bar ── */
  nav { display:grid; grid-template-columns:repeat(4,1fr); border-top:1px solid var(--line);
        background:rgba(6,12,20,.92); backdrop-filter:blur(10px); padding-bottom:env(safe-area-inset-bottom); }
  nav button { border:none; background:none; color:var(--dim); font-size:10px; letter-spacing:.12em;
               padding:10px 0 12px; display:flex; flex-direction:column; gap:4px; align-items:center; }
  nav button .ic { font-size:19px; }
  nav button.active { color:var(--cyan); }
  nav button:active { transform:none; }
</style>
</head><body>
<header>
  <div class="brand">J.A.R.V.I.S.</div>
  <div class="host" id="host">ARC REMOTE</div>
</header>

<main id="tab-pad" class="active">
  <div id="pad"><div class="hint">1 finger move · tap click<br>2 finger scroll · 2 tap right-click<br>hold = drag · 3 tap alt-tab</div></div>
  <div class="padbtns">
    <div class="pbtn" id="left">◀ LEFT</div>
    <div class="pbtn" id="drag">DRAG</div>
    <div class="pbtn" id="right">RIGHT ▶</div>
  </div>
  <div class="status" id="status"></div>
</main>

<main id="tab-keys">
  <div class="typeline">
    <input id="typetext" type="text" placeholder="Type on your PC…" autocomplete="off">
    <button id="typesend">SEND</button>
  </div>
  <div class="krows">
    <button data-k="esc">esc</button><button data-k="tab">tab</button>
    <button data-k="ctrl">ctrl</button><button data-k="win">win</button>
    <button data-k="enter">enter</button>
    <button data-k="ctrl+w">ctrl W</button><button data-k="ctrl+t">ctrl T</button>
    <button data-k="ctrl+z">ctrl Z</button><button data-k="alt+tab">alt⇥</button>
    <button data-k="ctrl+shift+esc">task</button>
    <button data-k="up">▲</button><button data-k="down">▼</button>
    <button data-k="left">◀</button><button data-k="right">▶</button>
    <button data-k="space">space</button>
    <button data-k="home">home</button><button data-k="end">end</button>
    <button data-k="pageup">pg up</button><button data-k="pagedown">pg dn</button>
    <button data-k="delete">del</button>
  </div>
  <div class="grid">
    <button class="wide danger" id="lock">LOCK WORKSTATION</button>
  </div>
  <div class="status"></div>
</main>

<main id="tab-media">
  <div class="grid" style="padding-top:14px">
    <button data-a="prev">&#9198;</button>
    <button data-a="play-pause" style="padding:26px 0">&#9199;</button>
    <button data-a="next">&#9197;</button>
  </div>
  <div class="volwrap">
    <div class="volrow">
      <button data-a="volume-down">&minus;</button>
      <input id="vol" type="range" min="0" max="100" value="30">
      <button data-a="volume-up">+</button>
    </div>
  </div>
  <div class="grid">
    <button class="wide" data-a="mute">MUTE</button>
  </div>
  <div class="status"></div>
</main>

<main id="tab-apps">
  <div class="grid" id="appsgrid" style="grid-template-columns:repeat(2,1fr); padding-top:14px"></div>
  <div class="status"></div>
</main>

<nav>
  <button data-t="pad" class="active"><span class="ic">&#9635;</span>PAD</button>
  <button data-t="keys"><span class="ic">&#9000;</span>KEYS</button>
  <button data-t="media"><span class="ic">&#9836;</span>MEDIA</button>
  <button data-t="apps"><span class="ic">&#9636;</span>APPS</button>
</nav>

<script>
  const $ = (s) => document.querySelector(s);
  const statusEls = document.querySelectorAll('.status');
  let statusTimer = null;
  function show(msg) {
    statusEls.forEach(el => el.textContent = msg);
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => statusEls.forEach(el => el.textContent = ''), 1600);
  }
  const post = (p, b) => fetch(p, { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(b||{}) })
    .then(r => r.json())
    .then(d => { if (!d.success) show(d.error || 'failed'); })
    .catch(() => show('connection lost'));

  // ── Tabs ──
  document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('main').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $('#tab-' + b.dataset.t).classList.add('active');
  }));

  // ── Trackpad ──
  const pad = $('#pad');
  const SENS = 1.7;          // cursor px per touch px
  const SCROLL_SENS = 0.006; // touch px → wheel notches
  let pts = new Map();       // pointerId → {x,y}
  let mode = 'none';         // none | move | scroll
  let pendingDx = 0, pendingDy = 0, scrollAcc = 0, scrollTimer = null;
  let downAt = 0, downX = 0, downY = 0, longTimer = null, dragging = false, moved = 0;
  let flushRaf = null;

  function flushMoves() {
    flushRaf = null;
    if (pendingDx || pendingDy) {
      post('/api/mouse/move', { dx: Math.round(pendingDx), dy: Math.round(pendingDy) });
      pendingDx = 0; pendingDy = 0;
    }
  }
  function queueMove() { if (!flushRaf) flushRaf = requestAnimationFrame(flushMoves); }

  function flushScroll() {
    scrollTimer = null;
    if (Math.abs(scrollAcc) >= 0.4) {
      const n = Math.trunc(scrollAcc);
      scrollAcc -= n;
      post('/api/mouse/scroll', { dy: -n }); // phone drag up = content up (natural)
    }
  }

  pad.addEventListener('pointerdown', e => {
    e.preventDefault(); pad.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pad.classList.add('dirty');
    if (pts.size === 1) {
      downAt = performance.now(); downX = e.clientX; downY = e.clientY; moved = 0;
      longTimer = setTimeout(() => {           // long-press → drag
        if (moved < 12 && pts.size === 1) {
          dragging = true; mode = 'move';
          post('/api/mouse/down'); show('drag…'); navigator.vibrate && navigator.vibrate(30);
        }
      }, 550);
    } else { clearTimeout(longTimer); mode = 'scroll'; }
  });

  pad.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (mode === 'scroll' && pts.size >= 2) {
      scrollAcc += dy * SCROLL_SENS;
      if (!scrollTimer) scrollTimer = setTimeout(flushScroll, 60);
    } else if (!dragging) {
      pendingDx += dx * SENS; pendingDy += dy * SENS; queueMove();
    } else {
      pendingDx += dx * SENS; pendingDy += dy * SENS; queueMove();
    }
  });

  function endPointer(e) {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    clearTimeout(longTimer);
    if (dragging) { dragging = false; post('/api/mouse/up'); show('dropped'); return; }
    if (pts.size === 0) {
      const dt = performance.now() - downAt;
      if (dt < 220 && moved < 12) {
        if (e.pointerType && false) {}
        post('/api/mouse/click'); show('click');   // single tap (1 finger)
      }
      mode = 'none';
    } else if (pts.size === 1 && mode === 'scroll') {
      mode = 'move';
    }
  }
  pad.addEventListener('pointerup', endPointer);
  pad.addEventListener('pointercancel', endPointer);

  // Two-finger tap → right click; three-finger tap → alt-tab.
  pad.addEventListener('click', e => {}); // no-op guard
  let tapCount = 0, tapTimer = null;
  pad.addEventListener('pointerdown', () => {
    if (pts.size >= 2) {
      tapCount = pts.size; clearTimeout(tapTimer);
    }
  }, true);
  pad.addEventListener('pointerup', () => {
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => {
      if (tapCount === 2) { post('/api/mouse/click', { button:'right' }); show('right-click'); }
      else if (tapCount >= 3) { post('/api/key', { keys:'alt+tab' }); show('alt-tab'); }
      tapCount = 0;
    }, 120);
  }, true);

  // Physical buttons under the pad.
  $('#left').addEventListener('click', () => { post('/api/mouse/click'); show('click'); });
  $('#right').addEventListener('click', () => { post('/api/mouse/click', { button:'right' }); show('right-click'); });
  const dragBtn = $('#drag');
  dragBtn.addEventListener('pointerdown', () => {
    dragBtn.classList.add('hold'); post('/api/mouse/down'); show('drag…');
  });
  const dragEnd = () => { dragBtn.classList.remove('hold'); post('/api/mouse/up'); show('dropped'); };
  dragBtn.addEventListener('pointerup', dragEnd);
  dragBtn.addEventListener('pointercancel', dragEnd);

  // ── Keys tab ──
  $('#typesend').addEventListener('click', () => {
    const v = $('#typetext').value;
    if (!v) return;
    post('/api/type', { text: v });
    $('#typetext').value = ''; show('typed ' + v.length + ' chars');
  });
  $('#typetext').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); $('#typesend').click(); }
    e.stopPropagation(); // keep phone keyboard events off the gesture layer
  });
  document.querySelectorAll('[data-k]').forEach(b =>
    b.addEventListener('click', () => { post('/api/key', { keys: b.dataset.k }); show(b.dataset.k); }));
  $('#lock').addEventListener('click', () => { post('/api/lock'); show('locking…'); });

  // ── Media tab ──
  document.querySelectorAll('[data-a]').forEach(b =>
    b.addEventListener('click', () => post('/api/media', { action: b.dataset.a })));
  let volTimer = null;
  $('#vol').addEventListener('input', e => {
    clearTimeout(volTimer);
    volTimer = setTimeout(() => post('/api/volume', { level: +e.target.value }), 220);
  });

  // ── Apps tab ──
  fetch('/api/apps').then(r => r.json()).then(d => {
    if (!d.success) return;
    const g = $('#appsgrid');
    d.apps.forEach(a => {
      const b = document.createElement('button');
      b.textContent = a.label;
      b.addEventListener('click', () => { post('/api/apps', { id: a.id }); show('launching ' + a.label + '…'); });
      g.appendChild(b);
    });
  }).catch(() => {});

  // ── Identity ──
  fetch('/api/info').then(r => r.json()).then(d => {
    $('#host').textContent = 'ARC REMOTE · ' + (d.host || '');
  }).catch(() => {});
</script>
</body></html>`);
});

function startBroker() {
  return new Promise((resolve) => {
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`[RemoteBroker] listening on ${lanIP()}:${PORT}`);
      resolve({ port: PORT, ip: lanIP() });
    });
    server.on("error", (e) => {
      console.error("[RemoteBroker] failed:", e.message);
      resolve(null);
    });
  });
}

module.exports = { startBroker, lanIP, PORT };

if (require.main === module) {
  startBroker();
}
