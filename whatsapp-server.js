// WhatsApp Express Server - Runs separately to maintain persistent connection
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();

// Simple CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

const PORT = 3001;

// WhatsApp Client State
let client = null;
let qrCodeData = null;
let isConnected = false;
let isReady = false;
let isAuthenticated = false;
let initPromise = null;

// Initialize WhatsApp
async function initializeWhatsApp() {
  if (client && isReady) {
    console.log('[WhatsApp Server] Client already ready');
    return client;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = new Promise((resolve, reject) => {
    console.log('[WhatsApp Server] Creating client...');

    client = new Client({
      authStrategy: new LocalAuth({
        clientId: 'jarvis-whatsapp',
        dataPath: './.whatsapp-session-server',
      }),
      puppeteer: {
        headless: true,
        executablePath: process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
    });

    let resolved = false;

    client.on('qr', async (qr) => {
      console.log('[WhatsApp Server] QR received');
      qrCodeData = await QRCode.toDataURL(qr);
    });

    client.on('authenticated', () => {
      console.log('[WhatsApp Server] Authenticated!');
      isAuthenticated = true;
    });

    client.on('ready', () => {
      console.log('[WhatsApp Server] Ready!');
      isReady = true;
      isConnected = true;
      qrCodeData = null;
      if (!resolved) {
        resolved = true;
        resolve(client);
      }
    });

    client.on('auth_failure', (msg) => {
      console.error('[WhatsApp Server] Auth failed:', msg);
      if (!resolved) {
        resolved = true;
        reject(new Error(msg));
      }
    });

    client.on('disconnected', (reason) => {
      console.log('[WhatsApp Server] Disconnected:', reason);
      isConnected = false;
      isReady = false;
      isAuthenticated = false;
      client = null;
      initPromise = null;
    });

    client.initialize().catch((err) => {
      console.error('[WhatsApp Server] Init error:', err);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        if (qrCodeData) {
          resolve(client);
        } else {
          reject(new Error('Timeout'));
        }
      }
    }, 60000);
  });

  return initPromise;
}

// API Routes

// Get status
app.get('/status', async (req, res) => {
  if (!isAuthenticated && !isReady && !initPromise) {
    initializeWhatsApp().catch(console.error);
  }

  res.json({
    success: true,
    connected: isConnected,
    ready: isReady,
    authenticated: isAuthenticated,
    qrCode: qrCodeData,
  });
});

// Initialize
app.post('/init', async (req, res) => {
  try {
    await initializeWhatsApp();
    res.json({
      success: true,
      message: isReady ? 'Connected' : isAuthenticated ? 'Syncing...' : 'QR ready',
      qrCode: qrCodeData,
      ready: isReady,
      authenticated: isAuthenticated,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get chats
app.get('/chats', async (req, res) => {
  if (!client || !isReady) {
    return res.status(400).json({
      success: false,
      error: 'WhatsApp not ready',
    });
  }

  try {
    console.log('[WhatsApp Server] Fetching chats...');
    const chats = await client.getChats();
    console.log(`[WhatsApp Server] Found ${chats.length} chats`);

    const formattedChats = chats.map(chat => ({
      id: chat.id._serialized,
      name: chat.name || chat.id.user || 'Unknown',
      unreadCount: chat.unreadCount || 0,
      timestamp: chat.timestamp || Date.now(),
      lastMessage: chat.lastMessage?.body || '',
      isGroup: chat.isGroup || false,
    }));

    formattedChats.sort((a, b) => b.timestamp - a.timestamp);

    res.json({
      success: true,
      chats: formattedChats,
      count: formattedChats.length,
    });
  } catch (error) {
    console.error('[WhatsApp Server] Get chats error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Send message
app.post('/send', async (req, res) => {
  const { number, message } = req.body;

  if (!client || !isReady) {
    return res.status(400).json({
      success: false,
      error: 'WhatsApp not ready',
    });
  }

  try {
    const chatId = `${number.replace(/[^0-9]/g, '')}@c.us`;
    const sent = await client.sendMessage(chatId, message);
    res.json({
      success: true,
      messageId: sent.id._serialized,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Logout
app.post('/logout', async (req, res) => {
  if (client) {
    await client.logout();
    client = null;
    isConnected = false;
    isReady = false;
    isAuthenticated = false;
    qrCodeData = null;
    initPromise = null;
  }
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`[WhatsApp Server] Running on http://localhost:${PORT}`);
  console.log('[WhatsApp Server] Initializing WhatsApp...');
  initializeWhatsApp().catch(console.error);
});
