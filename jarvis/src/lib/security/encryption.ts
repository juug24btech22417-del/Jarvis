// AES-256-GCM Encryption for Message Vault
// Uses Web Crypto API for browser-based encryption

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;

// Generate a key from a password using PBKDF2
export async function deriveKey(password: string, salt: Uint8Array | ArrayBuffer): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const saltBuffer = salt instanceof Uint8Array ? salt.buffer : salt;

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer as ArrayBuffer,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

// Generate random salt
export function generateSalt(): Uint8Array {
  return window.crypto.getRandomValues(new Uint8Array(16));
}

// Generate random IV
export function generateIV(): Uint8Array {
  return window.crypto.getRandomValues(new Uint8Array(12));
}

// Encrypt data
export async function encrypt(
  data: string,
  password: string
): Promise<{ encrypted: string; salt: string; iv: string }> {
  const salt = generateSalt();
  const iv = generateIV();

  const key = await deriveKey(password, salt);
  const encoder = new TextEncoder();

  const encryptedData = await window.crypto.subtle.encrypt(
    {
      name: ALGORITHM,
      iv: iv.buffer as ArrayBuffer,
    },
    key,
    encoder.encode(data)
  );

  // Convert to base64 for storage
  const encryptedBase64 = arrayBufferToBase64(encryptedData);
  const saltBase64 = arrayBufferToBase64(salt);
  const ivBase64 = arrayBufferToBase64(iv);

  return {
    encrypted: encryptedBase64,
    salt: saltBase64,
    iv: ivBase64,
  };
}

// Decrypt data
export async function decrypt(
  encrypted: string,
  password: string,
  salt: string,
  iv: string
): Promise<string> {
  const saltArray = base64ToArrayBuffer(salt);
  const ivArray = base64ToArrayBuffer(iv);
  const encryptedData = base64ToArrayBuffer(encrypted);

  const key = await deriveKey(password, saltArray);

  const decryptedData = await window.crypto.subtle.decrypt(
    {
      name: ALGORITHM,
      iv: ivArray,
    },
    key,
    encryptedData
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedData);
}

// Utility: ArrayBuffer to Base64
function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = new Uint8Array(buffer instanceof Uint8Array ? buffer.buffer : buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Utility: Base64 to ArrayBuffer
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Hash password for verification (not for key derivation)
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await window.crypto.subtle.digest(
    'SHA-256',
    encoder.encode(password)
  );
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate a master key for the vault
export async function generateMasterKey(): Promise<string> {
  const key = window.crypto.getRandomValues(new Uint8Array(32));
  return arrayBufferToBase64(key.buffer);
}

// Encrypt with a pre-generated key (for master key encryption)
export async function encryptWithKey(
  data: string,
  masterKey: string
): Promise<{ encrypted: string; iv: string }> {
  const keyArray = base64ToArrayBuffer(masterKey);

  const key = await window.crypto.subtle.importKey(
    'raw',
    keyArray,
    { name: ALGORITHM },
    false,
    ['encrypt', 'decrypt']
  );

  const iv = generateIV();

  const encoder = new TextEncoder();
  const encryptedData = await window.crypto.subtle.encrypt(
    {
      name: ALGORITHM,
      iv: iv.buffer as ArrayBuffer,
    },
    key,
    encoder.encode(data)
  );

  return {
    encrypted: arrayBufferToBase64(encryptedData),
    iv: arrayBufferToBase64(iv),
  };
}

// Decrypt with a pre-generated key
export async function decryptWithKey(
  encrypted: string,
  masterKey: string,
  iv: string
): Promise<string> {
  const keyArray = base64ToArrayBuffer(masterKey);
  const ivArray = base64ToArrayBuffer(iv);

  const key = await window.crypto.subtle.importKey(
    'raw',
    keyArray,
    { name: ALGORITHM },
    false,
    ['decrypt']
  );

  const decryptedData = await window.crypto.subtle.decrypt(
    {
      name: ALGORITHM,
      iv: ivArray,
    },
    key,
    base64ToArrayBuffer(encrypted)
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedData);
}
