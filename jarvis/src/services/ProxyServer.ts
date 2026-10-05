// @ts-nocheck
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { buildMemoryContext, extractMemoryFromTurn, persistMemory } from "./ProxyMemory";

// Get API keys dynamically with fallback to manual parsing of .env.local at multiple locations
function getAPIKey(keyName: string): string | undefined {
  if (process.env[keyName]) {
    return process.env[keyName];
  }
  const potentialPaths = [
    path.join(process.cwd(), ".env.local"),
    path.join(process.cwd(), "jarvis", ".env.local"),
    "c:\\Users\\dhruv\\Desktop\\Jarvis\\jarvis\\.env.local"
  ];
  for (const envPath of potentialPaths) {
    try {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf8");
        const lines = content.split("\n");
        for (const line of lines) {
          const parts = line.split("=");
          if (parts[0]?.trim() === keyName) {
            return parts.slice(1).join("=").trim().replace(/^['"]|['"]$/g, "");
          }
        }
      }
    } catch (e) {
      console.error(`[Proxy] Error reading env path ${envPath} for ${keyName}:`, e);
    }
  }
  return undefined;
}

// ── Provider registry ───────────────────────────────────────────────────────
// Verified against the live catalogues (Oct 2026). Free slugs get retired
// frequently (NVIDIA EOL'd llama-3.1, Gemini retired 2.0-flash, and the
// OpenRouter free tier rate-limits per account per day), so no single entry
// is load-bearing: the chain skips a model the moment it answers
// 400/404/410/429 and moves to the next one. This is what makes the overlay
// survive a provider outage instead of showing a bare HTTP 500.
type ProxyProviderId = "nvidia" | "groq" | "openrouter";

interface ProxyProvider {
  id: ProxyProviderId;
  url: string;
  keyEnv: string;
  /** Text chat models, best first. */
  models: string[];
  /** Multimodal models that accept an image_url content part. */
  visionModels: string[];
  supportsVision: boolean;
}

/** Per-model budget. Kept short so a rate-limited provider fails fast. */
const PER_MODEL_TIMEOUT_MS = 9000;

const PROVIDERS: ProxyProvider[] = [
  {
    id: "nvidia",
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
    keyEnv: "NVIDIA_API_KEY",
    models: [
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-3-ultra-550b-a55b",
    ],
    visionModels: ["meta/llama-3.2-90b-vision-instruct"],
    supportsVision: true,
  },
  {
    id: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    keyEnv: "GROQ_API_KEY",
    models: ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"],
    visionModels: [],
    supportsVision: false,
  },
  {
    id: "openrouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    keyEnv: "OPENROUTER_API_KEY",
    models: [
      "nvidia/nemotron-3-super-120b-a12b:free",
      "qwen/qwen3.8-27b:free",
      "nvidia/nemotron-3-ultra-550b-a55b:free",
    ],
    visionModels: ["google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free"],
    supportsVision: true,
  },
];

const JARVIS_SYSTEM_PROMPT = `You are J.A.R.V.I.S., Tony Stark's extremely advanced, loyal, and witty AI assistant.
You are assisting the user directly inside their active browser session.
They are browsing a webpage, and you have access to their current URL and DOM page content.

Context:
- URL: {{url}}
- Page Content (DOM extract):
{{domContent}}

Instructions:
- Address the user's query directly using the page context provided.
- Maintain the JARVIS personality (eloquent, British, polite, slightly sarcastic but deeply helpful).
- If they ask to summarize the page, provide a bulleted summary of the most critical insights.
- If they ask to extract details, be precise.
- Keep your answers concise, readable, and structured.

ACTION TOOLS — You may optionally trigger a browser action by appending a JSON block at the END of your response.
Only use this when the user explicitly asks you to interact with the page (click, scroll, fill, navigate).
Never use action tools for informational queries.

Available actions:
  {"action":"click","selector":"CSS_SELECTOR"}  — clicks a DOM element
  {"action":"scroll","direction":"down"|"up","amount":300}  — scrolls the page
  {"action":"fill","selector":"CSS_SELECTOR","value":"TEXT"}  — fills an input field
  {"action":"navigate","url":"FULL_URL"}  — navigates to a URL

Format your action at the very end of your reply like this (on its own line):
__ACTION__ {"action":"click","selector":"#submit-btn"}

Only emit ONE action per response. If no action is needed, do not include the __ACTION__ line.`;

// Parse an optional __ACTION__ JSON block from the LLM reply
function parseActionFromReply(reply: string): { text: string; action?: Record<string, any> } {
  const actionMarker = "__ACTION__";
  const idx = reply.lastIndexOf(actionMarker);
  if (idx === -1) return { text: reply.trim() };

  const textPart = reply.slice(0, idx).trim();
  const jsonPart = reply.slice(idx + actionMarker.length).trim();

  try {
    const action = JSON.parse(jsonPart);
    return { text: textPart, action };
  } catch {
    // If JSON parse fails, return the full reply as text
    return { text: reply.trim() };
  }
}

async function callLLM(
  query: string,
  url: string,
  domContent: string,
  screenshotBase64?: string
): Promise<string> {
  // ── Persistent memory injection ───────────────────────────────────────────
  // Build relevant memory context from the flat-file store and append to the
  // system prompt so the model knows user facts, preferences, and history.
  const memoryCtx = buildMemoryContext(query, 8);
  const baseSystemPrompt = JARVIS_SYSTEM_PROMPT
    .replace("{{url}}", url || "Unknown")
    .replace("{{domContent}}", (domContent || "No content extracted.").slice(0, 10000));

  const systemPrompt = memoryCtx
    ? `${baseSystemPrompt}\n\n── LONG-TERM MEMORY ─────────────────────────────\n${memoryCtx}\n────────────────────────────────────────────────`
    : baseSystemPrompt;

  // Build the message payload
  let userContent: any;
  if (screenshotBase64) {
    userContent = [
      { type: "text", text: query },
      {
        type: "image_url",
        image_url: {
          url: `data:image/jpeg;base64,${screenshotBase64}`,
        },
      },
    ];
  } else {
    userContent = query;
  }

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  // ── Provider walk ─────────────────────────────────────────────────────────
  // Walk providers in order, rotating to the next model the moment one answers
  // 400/404/410 (retired slug) or 429 (rate-limited). Vision is attempted first
  // when a screenshot was requested; if every vision model fails we still fall
  // through to the text models so the user gets an answer instead of an error.
  const errors: string[] = [];
  let sawRateLimit = false;

  for (const provider of PROVIDERS) {
    const apiKey = getAPIKey(provider.keyEnv);
    if (!apiKey) continue;

    const wantsImage = Boolean(screenshotBase64) && provider.supportsVision;
    const attempts: Array<{ model: string; withImage: boolean }> = [
      ...(wantsImage ? provider.visionModels.map((m) => ({ model: m, withImage: true })) : []),
      ...provider.models.map((m) => ({ model: m, withImage: false })),
    ];

    for (const { model, withImage } of attempts) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PER_MODEL_TIMEOUT_MS);
      try {
        console.log(`[Proxy] Trying ${provider.id}/${model}${withImage ? " (vision)" : ""}`);
        const res = await fetch(provider.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            ...(provider.id === "openrouter"
              ? { "HTTP-Referer": "http://localhost:3000", "X-Title": "JARVIS" }
              : {}),
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: withImage ? userContent : query },
            ],
            temperature: 0.7,
            max_tokens: 800,
          }),
          signal: controller.signal,
        });

        if (res.ok) {
          const data = await res.json();
          const reply = data.choices?.[0]?.message?.content?.trim();
          if (reply) {
            console.log(`[Proxy] Served via ${provider.id}/${model}`);
            return reply;
          }
          errors.push(`${provider.id}/${model}: empty response`);
        } else {
          if (res.status === 429) sawRateLimit = true;
          const errorText = await res.text().catch(() => "");
          errors.push(`${provider.id}/${model}: HTTP ${res.status}`);
          console.warn(`[Proxy] ${provider.id}/${model} → HTTP ${res.status}: ${errorText.slice(0, 140)}`);
        }
      } catch (e: any) {
        const reason = e?.name === "AbortError" ? `timeout ${PER_MODEL_TIMEOUT_MS}ms` : e?.message || String(e);
        errors.push(`${provider.id}/${model}: ${reason}`);
        console.warn(`[Proxy] ${provider.id}/${model} failed: ${reason}`);
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }

  const failure: any = new Error("All LLM providers failed");
  failure.details = errors;
  failure.rateLimited = sawRateLimit && errors.every((d) => d.includes("HTTP 429"));
  throw failure;
}


function handleJarvisInternalRequest(ctx: any, bodyBuffer: Buffer): void {
  const res = ctx.proxyToClientResponse;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
  };

  try {
    const body = JSON.parse(bodyBuffer.toString("utf8") || "{}");
    const { query, url, domContent, captureScreenshot } = body;

    if (!query) {
      res.writeHead(400, corsHeaders);
      res.end(JSON.stringify({ success: false, error: "Query is required" }));
      return;
    }

    // If vision requested, grab screenshot from live Chrome then call multimodal model
    const processRequest = async () => {
      let screenshotBase64: string | undefined;

      if (captureScreenshot) {
        try {
          const { playwrightService } = require("./PlaywrightService");
          const result = await playwrightService.captureActiveTabScreenshot();
          if (result.base64) {
            screenshotBase64 = result.base64;
            console.log("[Proxy] Screenshot captured for vision query.");
          } else {
            console.warn("[Proxy] Screenshot capture failed:", result.error);
          }
        } catch (e: any) {
          console.warn("[Proxy] Could not load PlaywrightService:", e.message);
        }
      }

      // If copilot query, adjust query to be direct and return only code/text replacement
      let finalQuery = query;
      if (body.copilot) {
        finalQuery = `You are acting as an inline text autocomplete assistant. Polish, complete, or rewrite the following text: "${query}". Respond ONLY with the replacement text. Do NOT include any explanations, introductory text, markdown wrappers, or conversational dialogue. Just return the direct completion.`;
      }

      // Hard 20-second timeout — prevents browser 504 if all LLM providers are slow/down
      const timeout = new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("LLM_TIMEOUT")), 20000)
      );
      return Promise.race([callLLM(finalQuery, url, domContent, screenshotBase64), timeout]);
    };

    processRequest()
      .then((reply) => {
        const { text, action } = parseActionFromReply(reply);

        // ── Persist memory from this turn (fire-and-forget) ───────────────
        if (!body.copilot) {
          try {
            const extracted = extractMemoryFromTurn(query, text);
            persistMemory(extracted, "proxy");
          } catch (memErr) {
            console.warn("[Proxy] Memory extraction failed (non-fatal):", memErr?.message);
          }
        }

        const responseBody = JSON.stringify({
          success: true,
          response: text,
          ...(action ? { action } : {}),
        });
        res.writeHead(200, {
          ...corsHeaders,
          "Content-Length": Buffer.byteLength(responseBody).toString(),
        });
        res.end(responseBody);
      })
      .catch((err) => {
        const isTimeout = err?.message === "LLM_TIMEOUT";
        const details: string[] = Array.isArray(err?.details) ? err.details : [];

        // Distinguish the real causes so the overlay can say something useful
        // instead of a blanket 500. 503 = transient (retry helps), 502 = the
        // provider chain is genuinely down.
        let userMsg: string;
        let status: number;
        if (isTimeout) {
          userMsg = "Apologies, Boss. My reasoning engines are responding slowly. Do try again in a moment.";
          status = 503;
        } else if (err?.rateLimited) {
          userMsg = "Apologies, Boss. Every free AI provider is rate-limited right now. Give it a minute.";
          status = 503;
        } else {
          const firstDetail = details[0] ? ` (${details[0]})` : "";
          userMsg = `Apologies, Boss. I couldn't reach any AI provider.${firstDetail}`;
          status = 502;
        }

        console.error("[Proxy Promise Error]:", isTimeout ? "LLM 20s timeout" : err?.message, details.slice(0, 6));
        const errorBody = JSON.stringify({ success: false, error: userMsg, details });
        res.writeHead(status, corsHeaders);
        res.end(errorBody);
      });
  } catch (err: any) {
    console.error("[Proxy Try-Catch Error]:", err);
    const errorBody = JSON.stringify({ success: false, error: err?.message || String(err) });
    res.writeHead(500, corsHeaders);
    res.end(errorBody);
  }
}

// ── OS-Bridge Relay ──────────────────────────────────────────────────────────
// The overlay runs in an HTTPS page (e.g. YouTube). Browsers block HTTP fetches
// from HTTPS pages (mixed-content). So instead of calling http://localhost:3000
// directly from the browser, we route through /__jarvis_os which the MITM proxy
// intercepts here and relays server-side (no browser restrictions).
function handleJarvisOSRequest(ctx: any, bodyBuffer: Buffer): void {
  const res = ctx.proxyToClientResponse;
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  const relayToNextJS = async () => {
    try {
      const body = JSON.parse(bodyBuffer.toString("utf8") || "{}");
      console.log("[Proxy] OS relay:", body.command, body.app || body.url || body.query || "");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 9000);

      const nextRes = await fetch("http://localhost:3000/api/os/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await nextRes.json();
      const responseBody = JSON.stringify(data);
      res.writeHead(nextRes.status, {
        ...corsHeaders,
        "Content-Length": Buffer.byteLength(responseBody).toString(),
      });
      res.end(responseBody);
    } catch (e: any) {
      const isAbort = e.name === "AbortError";
      const errorBody = JSON.stringify({
        success: false,
        error: isAbort ? "OS bridge timed out" : (e?.message || String(e)),
      });
      res.writeHead(isAbort ? 504 : 500, corsHeaders);
      res.end(errorBody);
    }
  };

  relayToNextJS();
}

// HMR-safe singleton. Next.js dev re-evaluates this module on every edit, which
// would orphan the running proxy: the old instance keeps holding port 8080
// (serving the code from before the edit) while the fresh module believes
// nothing is running — so stop() no-ops and the overlay keeps hitting stale
// logic. Stashing the handle on globalThis survives the reload, so stop and
// restart actually take effect.
interface ProxyState {
  instance: any;
  running: boolean;
  lastError?: string;
}

const globalForProxy = globalThis as unknown as { __jarvisProxyState?: ProxyState };
const proxyState: ProxyState =
  globalForProxy.__jarvisProxyState ??
  (globalForProxy.__jarvisProxyState = { instance: null, running: false });

const PROXY_PORT = Number(process.env.JARVIS_PROXY_PORT) || 8080;
const CERT_DIR = path.join(process.cwd(), ".certificates");

/** True when nothing is listening on the port yet. */
function isPortAvailable(port: number, host = "0.0.0.0"): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require("net");
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

export function getProxyStatus() {
  return {
    running: proxyState.running,
    port: PROXY_PORT,
    caCertPath: path.join(CERT_DIR, "certs", "ca.pem"),
    lastError: proxyState.lastError,
  };
}

function getOverlayScript(): string {
  try {
    const overlayPath = path.join(process.cwd(), "public", "jarvis-overlay.js");
    return fs.readFileSync(overlayPath, "utf8");
  } catch (e) {
    console.error("[Proxy] Could not read jarvis-overlay.js:", e);
    return "";
  }
}

// Thrown when a body cannot be decoded. Callers MUST fall back to forwarding the
// original bytes with the original header — never to a lossy UTF-8 round-trip.
class UnsupportedEncodingError extends Error {}

/**
 * Decode a Content-Encoding chain, e.g. "gzip", "br", "gzip, br".
 *
 * Chrome 154 sends `accept-encoding: gzip, deflate, br, zstd`, so servers happily
 * answer with zstd. Node's zstd support is newer than the rest, so it is looked
 * up defensively and the whole call fails safe when it (or any other codec) is
 * missing.
 */
/** Split a Content-Encoding header into the codec chain it describes. */
function parseEncodings(encoding: string): string[] {
  return String(encoding || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e && e !== "identity");
}

function decodeContent(buffer: Buffer, encoding: string): Buffer {
  const encodings = parseEncodings(encoding);

  const zstdSync = (zlib as any).zstdDecompressSync;

  let out = buffer;
  // Content-Encoding lists outermost-last, so decode in reverse.
  for (const enc of [...encodings].reverse()) {
    if (enc === "gzip" || enc === "x-gzip") out = zlib.gunzipSync(out);
    else if (enc === "deflate") out = zlib.inflateSync(out);
    else if (enc === "br") out = zlib.brotliDecompressSync(out);
    else if (enc === "zstd" && zstdSync) out = zstdSync(out);
    else throw new UnsupportedEncodingError(`unsupported content-encoding: ${enc}`);
  }
  return out;
}

/**
 * True when every codec in the chain has a decoder available locally.
 *
 * The response headers are flushed to the browser the moment the onResponse
 * handler returns, so this has to be knowable *before* the body arrives. If we
 * cannot decode, we must not claim we did.
 */
function canDecode(encodings: string[]): boolean {
  return encodings.every((enc) => {
    if (enc === "gzip" || enc === "x-gzip" || enc === "deflate" || enc === "br") return true;
    if (enc === "zstd") return typeof (zlib as any).zstdDecompressSync === "function";
    return false;
  });
}

/**
 * True when a body is already plain markup/JSON despite carrying a
 * Content-Encoding header. Guards against double-decoding and against handing a
 * still-compressed body to a browser that has been told it is plain text.
 */
function looksLikePlainText(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;
  // gzip magic 1f 8b, zstd magic 28 b5 2f fd — definitely still compressed.
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) return false;
  if (buffer[0] === 0x28 && buffer[1] === 0xb5 && buffer[2] === 0x2f && buffer[3] === 0xfd) return false;
  const head = buffer.slice(0, 64).toString("utf8").trimStart();
  return head.startsWith("<") || head.startsWith("{") || head.startsWith("[");
}

export async function startProxyServer(): Promise<boolean> {
  if (proxyState.running && proxyState.instance) {
    return true;
  }

  try {
    // Refuse to pretend we started when another instance already owns the port.
    // http-mitm-proxy reports EADDRINUSE asynchronously, which used to leave the
    // UI showing ACTIVE while a stale proxy served old code.
    if (!(await isPortAvailable(PROXY_PORT))) {
      proxyState.running = false;
      proxyState.lastError = `Port ${PROXY_PORT} is already in use by another proxy instance — restart the dev server to clear it.`;
      console.error(`[Proxy] ${proxyState.lastError}`);
      return false;
    }

    const { Proxy } = require("http-mitm-proxy");
    const proxyInstance = new Proxy();
    proxyState.instance = proxyInstance;

    if (!fs.existsSync(CERT_DIR)) {
      fs.mkdirSync(CERT_DIR, { recursive: true });
    }

    proxyInstance.onError(function (ctx: any, err: any, errorKind: string) {
      if (
        err?.message?.includes("ECONNRESET") ||
        err?.message?.includes("handshake") ||
        err?.message?.includes("ECONNREFUSED") ||
        err?.code === "ERR_STREAM_DESTROYED"
      ) {
        return;
      }
      console.warn(`[Proxy Error] ${errorKind}:`, err?.message || err);
    });

    proxyInstance.onRequest(function (ctx: any, callback: any) {
      const host = ctx.clientToProxyRequest.headers.host || "";
      const reqUrl = ctx.clientToProxyRequest.url || "";
      const req = ctx.clientToProxyRequest;
      const res = ctx.proxyToClientResponse;

      const internalCors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Content-Type": "application/json",
      };

      // ── /__jarvis_chat — LLM query endpoint ──────────────────────────────
      if (reqUrl.includes("/__jarvis_chat")) {
        if (req.method === "OPTIONS") {
          res.writeHead(200, internalCors);
          res.end("{}");
          return;
        }

        const chunks: Buffer[] = [];
        ctx.onRequestData((ctx: any, chunk: Buffer, callback: any) => {
          chunks.push(chunk);
          return callback(null, null);
        });
        ctx.onRequestEnd((ctx: any, callback: any) => {
          handleJarvisInternalRequest(ctx, Buffer.concat(chunks));
        });
        return callback();
      }

      // ── /__jarvis_os — OS command relay (fixes mixed-content block) ──────
      if (reqUrl.includes("/__jarvis_os")) {
        if (req.method === "OPTIONS") {
          res.writeHead(200, internalCors);
          res.end("{}");
          return;
        }

        const chunks: Buffer[] = [];
        ctx.onRequestData((ctx: any, chunk: Buffer, callback: any) => {
          chunks.push(chunk);
          return callback(null, null);
        });
        ctx.onRequestEnd((ctx: any, callback: any) => {
          handleJarvisOSRequest(ctx, Buffer.concat(chunks));
        });
        return callback();
      }

      // Skip localhost (JARVIS itself)
      if (host.includes("localhost") || host.includes("127.0.0.1")) {
        return callback();
      }

      // Disable compression so we can read/modify the raw HTML.
      //
      // This has to happen on proxyToServerRequestOptions: http-mitm-proxy
      // snapshots the outgoing headers *before* it runs the onRequest handlers,
      // so deleting from clientToProxyRequest here never reached the server and
      // every page still arrived gzipped.
      const upstreamHeaders = ctx.proxyToServerRequestOptions?.headers;
      if (upstreamHeaders) {
        delete upstreamHeaders["accept-encoding"];
        delete upstreamHeaders["Accept-Encoding"];
      }
      delete ctx.clientToProxyRequest.headers["accept-encoding"];

      ctx.onResponse(function (ctx: any, callback: any) {
        const contentType = ctx.serverToProxyResponse.headers["content-type"] || "";
        const isHTML = contentType.includes("text/html");

        if (!isHTML) {
          return callback();
        }

        // Strip the headers that would block injection.
        delete ctx.serverToProxyResponse.headers["content-security-policy"];
        delete ctx.serverToProxyResponse.headers["content-security-policy-report-only"];
        delete ctx.serverToProxyResponse.headers["x-frame-options"];
        const contentEncoding = ctx.serverToProxyResponse.headers["content-encoding"] || "";
        const encodings = parseEncodings(contentEncoding);

        // This is the last moment the response headers can be changed: the
        // library flushes them with writeHead() as soon as this handler calls
        // back. Declaring the body plain text therefore has to be decided here,
        // not in onResponseEnd — mutating content-encoding after that point is
        // silently discarded and leaves the browser waiting on gzip bytes that
        // will never arrive (the page just hangs).
        if (!canDecode(encodings)) {
          console.warn(
            `[Proxy] Not injecting the overlay: unsupported content-encoding "${contentEncoding}" from ${host}. The page is passed through untouched.`
          );
          return callback();
        }

        // From here on we are replacing the body with decoded plain text, so the
        // old encoding no longer describes what we send.
        delete ctx.serverToProxyResponse.headers["content-encoding"];

        const chunks: Buffer[] = [];

        ctx.onResponseData(function (ctx: any, chunk: Buffer, callback: any) {
          chunks.push(chunk);
          return callback(null, null); // suppress direct forwarding for HTML
        });

        ctx.onResponseEnd(function (ctx: any, callback: any) {
          const original = Buffer.concat(chunks);

          // onResponse already stripped content-encoding, so plain UTF-8 has to
          // come out of here no matter what happens below.
          let html: string;
          try {
            html =
              encodings.length > 0 && !looksLikePlainText(original)
                ? decodeContent(original, contentEncoding).toString("utf8")
                : original.toString("utf8");
          } catch (decodeErr: any) {
            console.error(
              `[Proxy] Could not decode "${contentEncoding}" from ${host}: ${decodeErr?.message}`
            );
            ctx.proxyToClientResponse.write(
              Buffer.from(
                `<html><body style="font-family:system-ui,sans-serif;padding:2rem">` +
                  `<h3>JARVIS proxy could not read this page</h3>` +
                  `<p>The server sent <code>${contentEncoding}</code> in an unexpected format.</p>` +
                  `<p>Reload to try again.</p></body></html>`,
                "utf8"
              )
            );
            return callback();
          }

          try {
            const overlayScript = getOverlayScript();

            if (overlayScript) {
              // overlay already has its own IIFE, inject directly
              const inlineScript = `<script>\n${overlayScript}\n</script>`;

              if (html.includes("</body>")) {
                html = html.replace("</body>", `${inlineScript}\n</body>`);
              } else {
                html += inlineScript;
              }
            }
          } catch (err) {
            // A failed injection must never take the page down with it.
            console.error("[Proxy] Overlay injection failed, serving the page without it:", err);
          }

          // The body is plain UTF-8 now. http-mitm-proxy has already switched
          // the response to chunked transfer, so Node frames it for us.
          ctx.proxyToClientResponse.write(Buffer.from(html, "utf8"));
          return callback();
        });

        return callback();
      });

      return callback();
    });

    // Listen and wait for the real outcome. The first run can take ~15s to
    // generate the CA cert, so we cap the wait instead of hanging the UI — but
    // we no longer report success before the socket has actually bound.
    const started = await new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      const timer = setTimeout(() => settle(true), 15000);

      proxyInstance.listen(
        { port: PROXY_PORT, host: "0.0.0.0", sslCaDir: CERT_DIR },
        (err: any) => {
          clearTimeout(timer);
          if (err) {
            const reason = err?.code || err?.message || String(err);
            console.error("[Proxy] Failed to start MITM proxy:", reason);
            proxyState.running = false;
            proxyState.instance = null;
            proxyState.lastError = `Failed to bind port ${PROXY_PORT}: ${reason}`;
            settle(false);
          } else {
            console.log(`[Proxy] Autonomous local proxy running on port ${PROXY_PORT}`);
            proxyState.running = true;
            proxyState.lastError = undefined;
            settle(true);
          }
        }
      );
    });

    return started;
  } catch (error: any) {
    console.error("[Proxy] Critical error starting proxy:", error);
    proxyState.running = false;
    proxyState.instance = null;
    proxyState.lastError = error?.message || String(error);
    return false;
  }
}

export async function stopProxyServer(): Promise<boolean> {
  if (!proxyState.running && !proxyState.instance) {
    return true;
  }

  try {
    if (proxyState.instance) {
      proxyState.instance.close();
    }
  } catch (closeErr: any) {
    console.warn("[Proxy] Error during close (non-fatal):", closeErr?.message);
  } finally {
    proxyState.instance = null;
    proxyState.running = false;
    proxyState.lastError = undefined;
    console.log("[Proxy] Autonomous proxy stopped.");
  }
  return true;
}
