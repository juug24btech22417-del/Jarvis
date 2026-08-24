// Composio SDK singleton.
//
// Wraps `new Composio({ apiKey })` so the rest of the jarvis codebase can
// import a single shared instance rather than re-instantiating per call.
//
// Env contract:
//   COMPOSIO_API_KEY       — required. API key from composio.dev dashboard.
//   COMPOSIO_USER_ID       — optional. Entity id used when we create trigger
//                            instances ("which user is this connection for?").
//                            Defaults to "jarvis-local" since we run single-user.
//
// HMR note: pinned to globalThis for the same reason as src/lib/db/queries.ts —
// Next.js dev recompiles routes on demand, and a fresh Composio() per recompile
// would tear down the Pusher WebSocket connection on every code change.

import { Composio } from "@composio/core";

const STATE_KEY = Symbol.for("jarvis.composio.client");
type GlobalState = { composio: Composio | null };
const g = globalThis as typeof globalThis & { [STATE_KEY]?: GlobalState };
const state: GlobalState = g[STATE_KEY] ?? (g[STATE_KEY] = { composio: null });

export interface ComposioEnv {
  apiKey: string;
  userId: string;
}

export function readComposioEnv(): ComposioEnv {
  const apiKey = process.env.COMPOSIO_API_KEY?.trim();
  if (!apiKey || apiKey === "your-api-key-here") {
    throw new Error(
      "[composio] COMPOSIO_API_KEY is missing or unset. Add it to jarvis/.env.local."
    );
  }
  const userId = process.env.COMPOSIO_USER_ID?.trim() || "jarvis-local";
  return { apiKey, userId };
}

export function isComposioConfigured(): boolean {
  const k = process.env.COMPOSIO_API_KEY?.trim();
  return !!k && k !== "your-api-key-here";
}

export function getComposio(): Composio {
  if (state.composio) return state.composio;
  const { apiKey } = readComposioEnv();
  state.composio = new Composio({ apiKey });
  return state.composio;
}

/**
 * Resolve the public base URL composio should redirect back to. Defaults
 * to http://localhost:3000 in dev. Override via COMPOSIO_APP_URL.
 */
export function getAppBaseUrl(): string {
  return process.env.COMPOSIO_APP_URL?.trim() || "http://localhost:3000";
}

/**
 * Find an existing composio-managed auth config for a toolkit, or create
 * one. Composio requires a configured auth config before you can call
 * `connectedAccounts.link` for OAuth flows.
 *
 * Lookup is by toolkit slug only (composio-managed configs are unique per
 * toolkit per project). We always re-use the first matching one; if
 * you've manually created multiple, the first wins.
 */
export async function getOrCreateAuthConfig(
  toolkit: string
): Promise<string> {
  const composio = getComposio();

  const existing = await composio.authConfigs.list({
    toolkit,
    isComposioManaged: true,
    limit: 50,
  });
  if (existing.items.length > 0) return existing.items[0].id;

  const created = await composio.authConfigs.create(toolkit, {
    type: "use_composio_managed_auth",
  });
  return created.id;
}
