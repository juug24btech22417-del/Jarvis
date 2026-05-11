// Instagram Service using instagram-private-api
// Note: This uses unofficial API - use at your own risk

import { IgApiClient } from 'instagram-private-api';

let instagramClient: IgApiClient | null = null;
let isLoggedIn = false;
let currentUser: { username: string; fullName: string } | null = null;

interface InstagramStatus {
  loggedIn: boolean;
  username: string | null;
  unreadCount: number;
}

interface DirectMessage {
  id: string;
  threadId: string;
  userId: string;
  username: string;
  text: string;
  timestamp: number;
  isFromMe: boolean;
}

interface DirectThread {
  id: string;
  title: string;
  participants: Array<{ username: string; fullName: string }>;
  lastMessage?: string;
  timestamp: number;
  unreadCount: number;
  isGroup: boolean;
}

interface SentMessage {
  success: boolean;
  messageId?: string;
  timestamp: number;
  error?: string;
}

// Session storage helpers
const SESSION_KEY = 'instagram_session';

function storeSession(session: any) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (e) {
    console.error('[Instagram] Failed to store session:', e);
  }
}

function getStoredSession(): any {
  try {
    const session = localStorage.getItem(SESSION_KEY);
    return session ? JSON.parse(session) : null;
  } catch (e) {
    console.error('[Instagram] Failed to get session:', e);
    return null;
  }
}

function clearStoredSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (e) {
    console.error('[Instagram] Failed to clear session:', e);
  }
}

// Initialize Instagram client
export function initInstagram(): IgApiClient {
  if (instagramClient) {
    return instagramClient;
  }

  instagramClient = new IgApiClient();

  // Auto-login if session exists
  const session = getStoredSession();
  if (session) {
    instagramClient.state.deserialize(session);
  }

  return instagramClient;
}

// Login with username/password
export async function loginInstagram(username: string, password: string): Promise<{ success: boolean; error?: string }> {
  const client = initInstagram();

  try {
    // Login
    await client.account.login(username, password);

    // Store session
    const session = await client.state.serialize();
    storeSession(session);

    isLoggedIn = true;
    currentUser = {
      username: client.state.cookieUserId?.toString() || username,
      fullName: username,
    };

    return { success: true };
  } catch (error) {
    console.error('[Instagram] Login failed:', error);
    isLoggedIn = false;
    currentUser = null;

    // Handle two-factor auth
    if (error instanceof Error && error.message.includes('two_factor')) {
      return { success: false, error: 'Two-factor authentication required' };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Login failed',
    };
  }
}

// Logout
export async function logoutInstagram(): Promise<boolean> {
  if (!instagramClient) return false;

  try {
    clearStoredSession();
    instagramClient = null;
    isLoggedIn = false;
    currentUser = null;
    return true;
  } catch (error) {
    console.error('[Instagram] Logout error:', error);
    return false;
  }
}

// Get status
export function getInstagramStatus(): InstagramStatus {
  return {
    loggedIn: isLoggedIn,
    username: currentUser?.username || null,
    unreadCount: 0,
  };
}

// Get direct threads (conversations)
export async function getInstagramThreads(): Promise<DirectThread[]> {
  if (!instagramClient || !isLoggedIn) {
    return [];
  }

  try {
    const inboxResponse = await instagramClient.feed.directInbox().request();
    const threads = inboxResponse.inbox?.threads || [];

    return threads.map((thread: any) => ({
      id: thread.thread_id,
      title: thread.thread_title || thread.inviter?.username || 'Unknown',
      participants: thread.users?.map((u: any) => ({
        username: u.username,
        fullName: u.full_name,
      })) || [],
      lastMessage: thread.last_permanent_item?.text || '',
      timestamp: thread.timestamp ? Math.floor(thread.timestamp / 1000) : 0,
      unreadCount: thread.unread_count || 0,
      isGroup: thread.thread_type === 'group',
    }));
  } catch (error) {
    console.error('[Instagram] Error getting threads:', error);
    return [];
  }
}

// Send direct message
export async function sendInstagramMessage(threadIdOrUsername: string, message: string): Promise<SentMessage> {
  if (!instagramClient || !isLoggedIn) {
    return {
      success: false,
      timestamp: Date.now(),
      error: 'Instagram not logged in',
    };
  }

  try {
    const broadcastOptions: any = {
      threadIds: [threadIdOrUsername],
      text: message,
    };

    const result = await instagramClient.directThread.broadcast(broadcastOptions);

    return {
      success: true,
      messageId: result.payload?.client_context || '',
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error('[Instagram] Send message failed:', error);
    return {
      success: false,
      timestamp: Date.now(),
      error: error instanceof Error ? error.message : 'Failed to send',
    };
  }
}

// Get thread messages
export async function getThreadMessages(threadId: string): Promise<DirectMessage[]> {
  if (!instagramClient || !isLoggedIn) {
    return [];
  }

  try {
    const threadResponse: any = await (instagramClient.feed.directThread as any)(threadId).request();
    const items = threadResponse.thread?.items || [];
    const thread = threadResponse.thread;

    return items.map((item: any) => ({
      id: item.item_id,
      threadId: threadId,
      userId: item.user_id?.toString() || '',
      username: thread?.users?.find((u: any) => u.pk === item.user_id)?.username || 'Unknown',
      text: item.text || '',
      timestamp: item.timestamp ? Math.floor(item.timestamp / 1000) : 0,
      isFromMe: item.user_id?.toString() === instagramClient?.state.cookieUserId,
    }));
  } catch (error) {
    console.error('[Instagram] Get messages failed:', error);
    return [];
  }
}
