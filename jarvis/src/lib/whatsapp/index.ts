// WhatsApp Service using whatsapp-web.js
// This runs a headless WhatsApp Web client

import { Client, Message, Chat, Contact, LocalAuth } from 'whatsapp-web.js';
import QRCode from 'qrcode';

let whatsappClient: Client | null = null;
let qrCodeData: string | null = null;
let isConnected = false;
let isReady = false;

interface WhatsAppStatus {
  connected: boolean;
  ready: boolean;
  qrCode: string | null;
  battery?: number;
  platform?: string;
}

interface SentMessage {
  success: boolean;
  messageId?: string;
  timestamp: number;
  error?: string;
}

// Initialize WhatsApp client
export function initWhatsApp(): Client {
  if (whatsappClient) {
    return whatsappClient;
  }

  whatsappClient = new Client({
    authStrategy: new LocalAuth({
      clientId: 'jarvis-whatsapp',
      dataPath: './.whatsapp-session',
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
    },
  });

  // QR Code event
  whatsappClient.on('qr', async (qr: string) => {
    console.log('[WhatsApp] QR Code received');
    qrCodeData = await QRCode.toDataURL(qr);
    isConnected = false;
    isReady = false;
  });

  // Ready event
  whatsappClient.on('ready', () => {
    console.log('[WhatsApp] Client is ready!');
    isReady = true;
    isConnected = true;
    qrCodeData = null;
  });

  // Auth failure
  whatsappClient.on('auth_failure', (msg: string) => {
    console.error('[WhatsApp] Authentication failed:', msg);
    isConnected = false;
    isReady = false;
  });

  // Disconnected
  whatsappClient.on('disconnected', (reason) => {
    console.log('[WhatsApp] Disconnected:', reason);
    isConnected = false;
    isReady = false;
  });

  // Incoming message
  whatsappClient.on('message', async (message: Message) => {
    console.log('[WhatsApp] New message:', message.body);
    // Store message in database or emit via WebSocket
    await handleIncomingMessage(message);
  });

  whatsappClient.initialize();

  return whatsappClient;
}

// Handle incoming message
async function handleIncomingMessage(message: Message): Promise<void> {
  try {
    const contact = await message.getContact();
    const chat = await message.getChat();

    // Log to console for now - can be extended to store in DB
    console.log('[WhatsApp] Message from:', contact.pushname || contact.number);
    console.log('[WhatsApp] Content:', message.body);

    // TODO: Store in database
    // TODO: Send notification to frontend via WebSocket/SSE
  } catch (error) {
    console.error('[WhatsApp] Error handling message:', error);
  }
}

// Get current status
export function getWhatsAppStatus(): WhatsAppStatus {
  return {
    connected: isConnected,
    ready: isReady,
    qrCode: qrCodeData,
  };
}

// Send message
export async function sendWhatsAppMessage(
  number: string,
  message: string
): Promise<SentMessage> {
  if (!whatsappClient || !isReady) {
    return {
      success: false,
      timestamp: Date.now(),
      error: 'WhatsApp client not ready. Please scan QR code first.',
    };
  }

  try {
    // Format number (remove +, spaces, dashes)
    const cleanNumber = number.replace(/[^0-9]/g, '');

    // Send message
    const chatId = `${cleanNumber}@c.us`;
    const sentMessage = await whatsappClient.sendMessage(chatId, message);

    return {
      success: true,
      messageId: sentMessage.id._serialized,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error('[WhatsApp] Error sending message:', error);
    return {
      success: false,
      timestamp: Date.now(),
      error: error instanceof Error ? error.message : 'Failed to send message',
    };
  }
}

// Get chats
export async function getWhatsAppChats(): Promise<Chat[]> {
  if (!whatsappClient || !isReady) {
    return [];
  }

  try {
    const chats = await whatsappClient.getChats();
    return chats;
  } catch (error) {
    console.error('[WhatsApp] Error getting chats:', error);
    return [];
  }
}

// Get contact info
export async function getWhatsAppContact(number: string): Promise<Contact | null> {
  if (!whatsappClient || !isReady) {
    return null;
  }

  try {
    const cleanNumber = number.replace(/[^0-9]/g, '');
    const contactId = `${cleanNumber}@c.us`;
    const contact = await whatsappClient.getContactById(contactId);
    return contact;
  } catch (error) {
    console.error('[WhatsApp] Error getting contact:', error);
    return null;
  }
}

// Logout
export async function logoutWhatsApp(): Promise<boolean> {
  if (!whatsappClient) {
    return false;
  }

  try {
    await whatsappClient.logout();
    whatsappClient = null;
    isConnected = false;
    isReady = false;
    qrCodeData = null;
    return true;
  } catch (error) {
    console.error('[WhatsApp] Error logging out:', error);
    return false;
  }
}

// Reset session (for re-authentication)
export async function resetWhatsAppSession(): Promise<boolean> {
  if (!whatsappClient) {
    return false;
  }

  try {
    await whatsappClient.destroy();
    whatsappClient = null;
    isConnected = false;
    isReady = false;
    qrCodeData = null;

    // Reinitialize
    initWhatsApp();
    return true;
  } catch (error) {
    console.error('[WhatsApp] Error resetting session:', error);
    return false;
  }
}
