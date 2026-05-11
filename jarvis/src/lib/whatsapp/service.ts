// WhatsApp Service - Reliable Singleton with File Persistence
import { Client, Message, Chat, Contact, LocalAuth } from 'whatsapp-web.js';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

const SESSION_FILE = './.whatsapp-session-v3/session.json';

// Global variable to persist client across serverless invocations
declare global {
  var whatsappClientGlobal: Client | null;
  var whatsappStateGlobal: {
    isConnected: boolean;
    isReady: boolean;
    isAuthenticated: boolean;
    qrCodeData: string | null;
  };
}

// Initialize global state
if (!global.whatsappStateGlobal) {
  global.whatsappStateGlobal = {
    isConnected: false,
    isReady: false,
    isAuthenticated: false,
    qrCodeData: null,
  };
}

class WhatsAppServiceClass {
  private client: Client | null = null;
  private qrCodeData: string | null = null;
  private isConnected = false;
  private isReady = false;
  private isInitializing = false;
  private isAuthenticated = false;
  private initPromise: Promise<Client> | null = null;
  private qrListeners: Array<(qr: string) => void> = [];

  constructor() {
    // Restore from global state
    this.restoreFromGlobal();
    // Also load from file
    this.loadSessionState();
  }

  private restoreFromGlobal() {
    if (global.whatsappClientGlobal) {
      console.log('[WhatsApp] Restoring client from global');
      this.client = global.whatsappClientGlobal;
    }
    if (global.whatsappStateGlobal) {
      this.isConnected = global.whatsappStateGlobal.isConnected;
      this.isReady = global.whatsappStateGlobal.isReady;
      this.isAuthenticated = global.whatsappStateGlobal.isAuthenticated;
      this.qrCodeData = global.whatsappStateGlobal.qrCodeData;
    }
  }

  private saveToGlobal() {
    global.whatsappClientGlobal = this.client;
    global.whatsappStateGlobal = {
      isConnected: this.isConnected,
      isReady: this.isReady,
      isAuthenticated: this.isAuthenticated,
      qrCodeData: this.qrCodeData,
    };
  }

  private loadSessionState() {
    try {
      if (fs.existsSync(SESSION_FILE)) {
        const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
        this.isAuthenticated = data.authenticated || false;
        this.isReady = data.ready || false;
        console.log('[WhatsApp] Loaded session state:', { authenticated: this.isAuthenticated, ready: this.isReady });
      }
    } catch (e) {
      console.log('[WhatsApp] No previous session');
    }
  }

  private saveSessionState() {
    try {
      const dir = path.dirname(SESSION_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(SESSION_FILE, JSON.stringify({
        authenticated: this.isAuthenticated,
        ready: this.isReady,
        timestamp: Date.now()
      }));
    } catch (e) {
      console.error('[WhatsApp] Failed to save session state:', e);
    }
  }

  async initialize(): Promise<Client> {
    // If client exists and is ready, return it
    if (this.client && this.isReady) {
      console.log('[WhatsApp] Client exists and ready, returning existing');
      return this.client;
    }

    // If state says authenticated but no client, we need to reinitialize
    if ((this.isAuthenticated || this.isReady) && !this.client) {
      console.log('[WhatsApp] State exists but client lost, resetting state and reinitializing...');
      this.isAuthenticated = false;
      this.isReady = false;
      this.saveSessionState();
    }

    // Return existing initialization promise if in progress
    if (this.initPromise) {
      console.log('[WhatsApp] Initialization in progress, returning promise');
      return this.initPromise;
    }

    this.isInitializing = true;

    this.initPromise = new Promise<Client>((resolve, reject) => {
      let resolved = false;

      try {
        console.log('[WhatsApp] Creating new client...');

        // Use unique session ID to avoid lock issues
        const uniqueId = `jarvis-${Date.now()}`;
        this.client = new Client({
          authStrategy: new LocalAuth({
            clientId: uniqueId,
            dataPath: './.whatsapp-session-v3',
          }),
          puppeteer: {
            headless: true,
            executablePath: process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
          },
        });

        // QR Code event
        this.client.on('qr', async (qr: string) => {
          console.log('[WhatsApp] QR Code received!');
          this.qrCodeData = await QRCode.toDataURL(qr);
          this.isInitializing = false;
          this.saveToGlobal();
        });

        // Authenticated event
        this.client.on('authenticated', () => {
          console.log('[WhatsApp] AUTHENTICATED!');
          this.isAuthenticated = true;
          this.saveSessionState();
          this.saveToGlobal();
        });

        // Ready event
        this.client.on('ready', () => {
          console.log('[WhatsApp] READY!');
          this.isReady = true;
          this.isConnected = true;
          this.isInitializing = false;
          this.qrCodeData = null;
          this.saveSessionState();
          this.saveToGlobal();

          // Pre-fetch chats in background
          setTimeout(() => {
            console.log('[WhatsApp] Pre-fetching chats...');
            this.getChats().catch(console.error);
          }, 3000);

          if (!resolved) {
            resolved = true;
            resolve(this.client!);
          }
        });

        // Auth failure
        this.client.on('auth_failure', (msg) => {
          console.error('[WhatsApp] Auth failed:', msg);
          this.isAuthenticated = false;
          this.isReady = false;
          this.saveSessionState();
          if (!resolved) {
            resolved = true;
            reject(new Error(msg));
          }
        });

        // Disconnected
        this.client.on('disconnected', (reason) => {
          console.log('[WhatsApp] Disconnected:', reason);
          this.isConnected = false;
          this.isAuthenticated = false;
          this.isReady = false;
          this.saveSessionState();
        });

        // Initialize
        this.client.initialize().catch((err) => {
          console.error('[WhatsApp] Init error:', err);
          if (!resolved) {
            resolved = true;
            reject(err);
          }
        });

        // Timeout after 60 seconds
        setTimeout(() => {
          if (!resolved && !this.isReady) {
            resolved = true;
            this.isInitializing = false;
            if (this.qrCodeData) {
              resolve(this.client!);
            } else {
              reject(new Error('Timeout'));
            }
          }
        }, 60000);

      } catch (error) {
        console.error('[WhatsApp] Setup error:', error);
        if (!resolved) {
          resolved = true;
          reject(error);
        }
      }
    });

    return this.initPromise;
  }

  getStatus() {
    return {
      connected: this.isConnected,
      ready: this.isReady,
      authenticated: this.isAuthenticated,
      qrCode: this.qrCodeData,
      initializing: this.isInitializing,
    };
  }

  async getChats(retryCount = 0): Promise<Chat[]> {
    // If state says ready but client is null, log error and try to recover
    if (!this.client && this.isReady) {
      console.error('[WhatsApp] CRITICAL: State is ready but client is null!');
      return [];
    }

    if (!this.client || !this.isReady) {
      console.log('[WhatsApp] getChats: client not ready');
      return [];
    }

    try {
      console.log('[WhatsApp] Fetching chats (attempt', retryCount + 1, ')...');

      // Try to force sync by getting contacts first
      if (retryCount === 0) {
        try {
          const contacts = await this.client.getContacts();
          console.log('[WhatsApp] Loaded', contacts.length, 'contacts');
        } catch (e) {
          // Ignore
        }
      }

      const chats = await this.client.getChats();
      console.log('[WhatsApp] Found', chats.length, 'chats');

      // If no chats and under retry limit, retry after delay
      if (chats.length === 0 && retryCount < 5) {
        console.log('[WhatsApp] No chats yet, retrying in 5 seconds...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        return this.getChats(retryCount + 1);
      }

      return chats;
    } catch (e) {
      console.error('[WhatsApp] Get chats error:', e);
      return [];
    }
  }

  async sendMessage(number: string, message: string) {
    if (!this.client || !this.isReady) {
      throw new Error('Not ready');
    }
    const chatId = `${number.replace(/[^0-9]/g, '')}@c.us`;
    return await this.client.sendMessage(chatId, message);
  }

  async logout(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.logout();
      this.client = null;
      this.isConnected = false;
      this.isReady = false;
      this.isAuthenticated = false;
      this.qrCodeData = null;
      this.initPromise = null;
      // Delete session file
      if (fs.existsSync(SESSION_FILE)) {
        fs.unlinkSync(SESSION_FILE);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // Force sync - trigger WhatsApp to sync conversations
  async forceSync(): Promise<void> {
    if (!this.client || !this.isReady) {
      console.log('[WhatsApp] Cannot sync: not ready');
      return;
    }
    try {
      console.log('[WhatsApp] Forcing sync...');
      // Send a message to yourself to trigger sync (optional)
      // Or just wait
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (e) {
      console.error('[WhatsApp] Sync error:', e);
    }
  }
}

export const WhatsAppService = new WhatsAppServiceClass();
