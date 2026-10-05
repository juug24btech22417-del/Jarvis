// WhatsApp Express Server - Runs separately to maintain persistent connection.
//
// Lifecycle contract (kept honest so the MCP hub never shows a fake "connected"):
//   boot → not linked → QR shown → scan → authenticated → ready
//
// Known "couldn't link device" causes we handle here:
//   1. A stale/partial LocalAuth session left behind by a previous failed link
//      — WhatsApp refuses to re-link over it. POST /reset wipes it and mints a
//      genuinely fresh QR.
//   2. An outdated cached WhatsApp Web bundle in `.wwebjs_cache`, also wiped.
//   3. A dead initPromise after a timeout. The old code kept returning the
//      rejected promise forever, so no new QR was ever produced.
//
// All client event handlers are generation-guarded: a client that is being
// torn down can no longer clobber the state of the client that replaced it
// (which is what made /reset explode with "Target closed").
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

const PORT = process.env.WHATSAPP_PORT || 3100;
const ROOT = __dirname;
const SESSION_DIR = path.join(ROOT, '.whatsapp-session-server');
const CACHE_DIR = path.join(ROOT, '.wwebjs_cache');

// ── State ──
let client = null;
let qrCodeData = null;
let qrGeneratedAt = null;
let isConnected = false;
let isReady = false;
let isAuthenticated = false;
let initPromise = null;
let lastError = null;
let generation = 0; // bumped for every client we create

/** Locate a real Chrome/Chromium without hardcoding a single machine path. */
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return undefined;
}

function rmrf(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (e) {
    console.warn(`[WhatsApp Server] Could not remove ${target}:`, e.message);
  }
}

// Wiping the *session* is what fixes a stale link. The web cache is kept by
// default because re-downloading the WhatsApp Web bundle is the main reason
// a fresh QR feels slow. `cache: true` is only used after a real auth failure.
function wipeSession({ cache = false } = {}) {
  rmrf(SESSION_DIR);
  if (cache) rmrf(CACHE_DIR);
  console.log(`[WhatsApp Server] Session cleared${cache ? ' (+ web cache)' : ''}`);
}

function resetState() {
  client = null;
  isConnected = false;
  isReady = false;
  isAuthenticated = false;
  qrCodeData = null;
  qrGeneratedAt = null;
  initPromise = null;
}

/** Create (or return) the live client. */
async function initializeWhatsApp() {
  if (client && isReady) return client;
  if (initPromise) return initPromise;

  const gen = ++generation;

  initPromise = new Promise((resolve, reject) => {
    console.log(`[WhatsApp Server] Creating client (gen ${gen})...`);
    lastError = null;

    const c = new Client({
      authStrategy: new LocalAuth({ clientId: 'jarvis-whatsapp', dataPath: SESSION_DIR }),
      puppeteer: {
        headless: true,
        executablePath: findChrome(),
        // Lean startup flags: skip first-run chrome noise, background timers
        // and throttling so the WhatsApp Web page boots and mints a QR faster.
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-extensions',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=TranslateUI,site-per-process',
        ],
      },
    });
    client = c;

    let resolved = false;
    const alive = () => gen === generation;
    const finish = (fn, arg) => {
      if (resolved) return;
      resolved = true;
      fn(arg);
    };

    c.on('qr', async (qr) => {
      if (!alive()) return;
      console.log('[WhatsApp Server] QR received');
      qrCodeData = await QRCode.toDataURL(qr);
      qrGeneratedAt = Date.now();
      finish(resolve, c); // resolve as soon as a QR exists
    });

    c.on('authenticated', () => {
      if (!alive()) return;
      console.log('[WhatsApp Server] Authenticated!');
      isAuthenticated = true;
    });

    c.on('ready', () => {
      if (!alive()) return;
      console.log('[WhatsApp Server] Ready!');
      isReady = true;
      isConnected = true;
      qrCodeData = null;
      lastError = null;
      finish(resolve, c);
    });

    c.on('auth_failure', async (msg) => {
      if (!alive()) return;
      console.error('[WhatsApp Server] Auth failed:', msg);
      lastError = typeof msg === 'string' ? msg : 'Authentication failed';
      try {
        await c.destroy().catch(() => {});
      } catch {}
      if (gen !== generation) return;
      resetState();
      wipeSession({ cache: true }); // a real link failure — clear everything
      initializeWhatsApp().catch((e) => console.warn('[WhatsApp Server] Re-init after auth_failure failed:', e.message));
      finish(reject, new Error(lastError));
    });

    c.on('disconnected', (reason) => {
      if (!alive()) return;
      console.log('[WhatsApp Server] Disconnected:', reason);
      const loggedOut = String(reason || '').toUpperCase().includes('LOGOUT');
      resetState();
      if (loggedOut) wipeSession();
      finish(reject, new Error(`Disconnected: ${reason}`));
    });

    c.initialize().catch((err) => {
      if (gen !== generation) return;
      console.error('[WhatsApp Server] Init error:', err && err.message ? err.message : err);
      lastError = err.message || String(err);
      resetState();
      finish(reject, err);
    });

    setTimeout(() => {
      if (!resolved && gen === generation) {
        if (qrCodeData) {
          finish(resolve, c);
        } else {
          lastError = 'Timed out waiting for a QR code. Press Reset to try again.';
          finish(reject, new Error(lastError));
        }
      }
    }, 60000);
  });

  // Clear initPromise on failure — but only if THIS promise is still the
  // current one, otherwise a stale rejection would clobber a later reset.
  const self = initPromise;
  self.catch(() => {
    if (initPromise === self) initPromise = null;
  });

  return initPromise;
}

/** Tear down whatever exists and start from a clean session. */
async function hardReset() {
  const old = client;
  generation++; // invalidate every handler on the old client
  resetState();
  if (old) {
    try {
      await old.destroy();
    } catch (e) {
      console.warn('[WhatsApp Server] destroy() during reset:', e.message);
    }
  }
  await new Promise((r) => setTimeout(r, 250));
  wipeSession(); // keep the web cache for a fast new QR
  return initializeWhatsApp();
}

// ─────────────────────────── API ───────────────────────────

app.get('/status', async (req, res) => {
  if (!isAuthenticated && !isReady && !initPromise) {
    initializeWhatsApp().catch(() => {});
  }
  res.json({
    success: true,
    connected: isConnected,
    ready: isReady,
    authenticated: isAuthenticated,
    qrCode: qrCodeData,
    qrGeneratedAt,
    error: lastError,
  });
});

app.post('/init', async (req, res) => {
  try {
    await initializeWhatsApp();
  } catch (e) {
    // fall through — the response reports real state either way
  }
  res.json({
    success: true,
    message: isReady ? 'Connected' : isAuthenticated ? 'Syncing...' : 'QR ready',
    qrCode: qrCodeData,
    ready: isReady,
    authenticated: isAuthenticated,
    qrGeneratedAt,
    error: lastError,
  });
});

// Reset — responds immediately, then wipes + re-mints a fresh QR in the
// background. The client polls /status until the new QR appears.
app.post('/reset', (req, res) => {
  console.log('[WhatsApp Server] Reset requested');
  res.json({ success: true, message: 'Resetting session… scan the fresh QR once it appears.' });
  setTimeout(() => {
    hardReset().catch((e) => console.warn('[WhatsApp Server] Reset failed:', e.message));
  }, 10);
});

app.get('/chats', async (req, res) => {
  if (!client || !isReady) return res.status(400).json({ success: false, error: 'WhatsApp not ready' });
  try {
    const chats = await client.getChats();
    const formattedChats = chats.map((chat) => ({
      id: chat.id._serialized,
      name: chat.name || chat.id.user || 'Unknown',
      unreadCount: chat.unreadCount || 0,
      timestamp: chat.timestamp || Date.now(),
      lastMessage: chat.lastMessage ? chat.lastMessage.body : '',
      isGroup: chat.isGroup || false,
    }));
    formattedChats.sort((a, b) => b.timestamp - a.timestamp);
    res.json({ success: true, chats: formattedChats, count: formattedChats.length });
  } catch (error) {
    console.error('[WhatsApp Server] Get chats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/contacts', async (req, res) => {
  if (!client || !isReady) return res.status(400).json({ success: false, error: 'WhatsApp not ready' });
  try {
    const contacts = await client.getContacts();
    const formatted = contacts
      .filter((c) => !c.isGroup && c.id && c.id.server === 'c.us' && !String(c.id._serialized).includes('@lid'))
      .map((c) => ({
        id: c.id._serialized,
        number: c.number || c.id.user,
        name: c.name || c.pushname || c.shortName || c.number || c.id.user,
      }))
      .filter((c) => !!c.name);
    formatted.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ success: true, contacts: formatted, count: formatted.length });
  } catch (error) {
    console.error('[WhatsApp Server] Get contacts error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Resolve a recipient from a phone number or a contact name. */
async function resolveRecipient({ number, name }) {
  const target = String(number || name || '').trim();
  const digitsOnly = target.replace(/\D/g, '');

  if (digitsOnly.length >= 7 && (number || /^[\+]?[\d\s\-()]{7,}$/.test(target))) {
    let clean = digitsOnly;
    // 10 digits Indian mobile (starts with 6, 7, 8, 9) -> prepend country code 91
    if (clean.length === 10 && /^[6-9]/.test(clean)) {
      clean = '91' + clean;
    }
    return { chatId: `${clean}@c.us`, label: target };
  }
  const q = norm(target);
  if (!q) throw new Error('Provide either a phone number or a contact name');

  let pool = [];
  try {
    const contacts = await client.getContacts();
    pool = contacts
      .filter((c) => !c.isGroup && c.id && c.id.server === 'c.us' && !String(c.id._serialized).includes('@lid'))
      .map((c) => ({ id: c.id._serialized, name: c.name || c.pushname || c.shortName || '', number: c.number || c.id.user }));
  } catch {}

  if (pool.length === 0) {
    try {
      const chats = await client.getChats();
      pool = chats.filter((c) => !c.isGroup).map((c) => ({ id: c.id._serialized, name: c.name || '', number: c.id.user }));
    } catch {}
  }

  const scored = pool
    .map((c) => {
      const n = norm(c.name);
      let score = -1;
      if (!n) return { c, score };
      const words = String(c.name).toLowerCase().split(/\s+/);
      if (n === q) score = 100;
      else if (words.some((w) => norm(w) === q)) score = 90;
      else if (n.startsWith(q)) score = 80;
      else if (q.startsWith(n) && n.length >= 3) score = 70;
      else if (n.includes(q)) score = 60;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    const names = pool.map((c) => c.name).filter(Boolean).slice(0, 15).join(', ');
    throw new Error(`No contact matched "${name}".${names ? ` Saved contacts include: ${names}` : ''}`);
  }
  const best = scored[0].c;
  return { chatId: best.id, label: best.name || best.number };
}

app.post('/send', async (req, res) => {
  const { number, name, message } = req.body;
  if (!client || !isReady) return res.status(400).json({ success: false, error: 'WhatsApp not ready' });
  if (!message) return res.status(400).json({ success: false, error: 'message is required' });
  try {
    const { chatId, label } = await resolveRecipient({ number, name });
    const sent = await client.sendMessage(chatId, message);
    // sent may be undefined in some versions when the message is sent without waiting
    const messageId = sent && sent.id ? (sent.id._serialized || sent.id.id || String(sent.id)) : 'sent';
    res.json({ success: true, messageId, recipient: label, chatId });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/logout', async (req, res) => {
  const old = client;
  generation++;
  resetState();
  try {
    if (old) await old.logout();
  } catch {}
  wipeSession();
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`[WhatsApp Server] Running on http://localhost:${PORT}`);
  console.log('[WhatsApp Server] Initializing WhatsApp...');
  initializeWhatsApp().catch((e) => console.warn('[WhatsApp Server] Initial init failed:', e.message));
});
