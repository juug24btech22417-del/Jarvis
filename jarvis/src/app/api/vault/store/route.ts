import { NextRequest, NextResponse } from 'next/server';
import { encrypt, decrypt, hashPassword, generateMasterKey, encryptWithKey, decryptWithKey } from '@/lib/security/encryption';

// In-memory vault (in production, use a database with encrypted storage)
interface VaultItem {
  id: string;
  type: 'message' | 'note' | 'password' | 'file' | 'memo';
  encryptedContent: string;
  salt?: string;
  iv: string;
  tags: string[];
  metadata: {
    createdAt: number;
    updatedAt: number;
    source?: string;
    platform?: string;
    contact?: string;
  };
}

// Store vault items in memory (use database in production)
let vaultItems: VaultItem[] = [];
let masterKey: string | null = null;
let passwordHash: string | null = null;

// GET /api/vault/store/status - Check if vault is initialized
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');

    if (action === 'search') {
      const query = searchParams.get('q');
      const password = searchParams.get('password');

      if (!password || !await verifyPassword(password)) {
        return NextResponse.json(
          { success: false, error: 'Invalid password' },
          { status: 401 }
        );
      }

      if (!query) {
        return NextResponse.json({ success: true, items: [] });
      }

      // Decrypt and search
      const results: Array<{ id: string; type: string; preview: string; tags: string[]; createdAt: number }> = [];

      for (const item of vaultItems) {
        try {
          const decrypted = await decryptWithKey(item.encryptedContent, masterKey!, item.iv);

          if (decrypted.toLowerCase().includes(query.toLowerCase()) ||
              item.tags.some(tag => tag.toLowerCase().includes(query.toLowerCase()))) {
            results.push({
              id: item.id,
              type: item.type,
              preview: decrypted.slice(0, 100) + (decrypted.length > 100 ? '...' : ''),
              tags: item.tags,
              createdAt: item.metadata.createdAt,
            });
          }
        } catch {
          continue; // Skip items that can't be decrypted
        }
      }

      return NextResponse.json({ success: true, items: results });
    }

    return NextResponse.json({
      success: true,
      initialized: masterKey !== null,
      itemCount: vaultItems.length,
    });
  } catch (error) {
    console.error('[Vault] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Vault error',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

// POST /api/vault/store - Initialize vault or store item
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, password, content, type, tags, metadata } = body;

    // Initialize vault with password
    if (action === 'initialize') {
      if (!password) {
        return NextResponse.json(
          { success: false, error: 'Password required' },
          { status: 400 }
        );
      }

      masterKey = await generateMasterKey();
      passwordHash = await hashPassword(password);

      // Encrypt master key with password for storage
      const encryptedMasterKey = await encrypt(masterKey, password);

      return NextResponse.json({
        success: true,
        message: 'Vault initialized',
        encryptedMasterKey, // Store this securely
      });
    }

    // Unlock vault with password
    if (action === 'unlock') {
      if (!password || !passwordHash) {
        return NextResponse.json(
          { success: false, error: 'Password required' },
          { status: 400 }
        );
      }

      const hash = await hashPassword(password);
      if (hash !== passwordHash) {
        return NextResponse.json(
          { success: false, error: 'Invalid password' },
          { status: 401 }
        );
      }

      // In production, you'd decrypt the master key from storage
      return NextResponse.json({
        success: true,
        message: 'Vault unlocked',
      });
    }

    // Store item in vault
    if (action === 'store' || !action) {
      if (!masterKey) {
        return NextResponse.json(
          { success: false, error: 'Vault not initialized' },
          { status: 400 }
        );
      }

      if (!content) {
        return NextResponse.json(
          { success: false, error: 'Content required' },
          { status: 400 }
        );
      }

      // Encrypt content with master key
      const { encrypted, iv } = await encryptWithKey(content, masterKey);

      const item: VaultItem = {
        id: Math.random().toString(36).substring(7),
        type: type || 'message',
        encryptedContent: encrypted,
        iv,
        tags: tags || [],
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now(),
          ...metadata,
        },
      };

      vaultItems.unshift(item);

      return NextResponse.json({
        success: true,
        item: {
          id: item.id,
          type: item.type,
          tags: item.tags,
          createdAt: item.metadata.createdAt,
        },
      });
    }

    return NextResponse.json(
      { success: false, error: 'Unknown action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[Vault Store] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Vault error',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

// Verify password against stored hash
async function verifyPassword(password: string): Promise<boolean> {
  if (!passwordHash) return false;
  const hash = await hashPassword(password);
  return hash === passwordHash;
}
