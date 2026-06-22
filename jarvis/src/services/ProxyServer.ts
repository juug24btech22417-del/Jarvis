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

// OpenRouter config — used for jarvis.internal interception
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Text-only models (free tier)
const FREE_MODELS = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
];

// Vision-capable models (support image_url in messages)
const VISION_MODELS = [
  "google/gemini-2.0-flash-exp:free",
  "google/gemini-2.5-flash-preview-05-20:free",
  "google/gemma-4-31b-it:free",
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

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

async function callLLM(
  query: string,
  url: string,
  domContent: string,
  screenshotBase64?: string
): Promise<string> {
  const openrouterApiKey = getAPIKey("OPENROUTER_API_KEY");
  const nvidiaApiKey = getAPIKey("NVIDIA_API_KEY");

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

  // Try OpenRouter first if key is present
  if (openrouterApiKey) {
    const models = screenshotBase64 ? VISION_MODELS : FREE_MODELS;
    for (const model of models) {
      try {
        console.log(`[Proxy] Trying OpenRouter model: ${model}`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const res = await fetch(OPENROUTER_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openrouterApiKey}`,
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "JARVIS",
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.7,
            max_tokens: 800,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          const reply = data.choices?.[0]?.message?.content?.trim();
          if (reply) {
            console.log(`[Proxy] Successful reply from OpenRouter model: ${model}`);
            return reply;
          }
        } else {
          const errorText = await res.text();
          console.warn(`[Proxy] OpenRouter model ${model} failed with status ${res.status}:`, errorText);
        }
      } catch (e: any) {
        console.warn(`[Proxy] OpenRouter call to ${model} failed:`, e.name === "AbortError" ? "Timeout after 6s" : e.message || e);
      }
    }
  }

  // Fallback to NVIDIA NIM if key is present
  if (nvidiaApiKey) {
    const nvidiaModels = screenshotBase64
      ? ["meta/llama-3.2-90b-vision-instruct"]
      : ["meta/llama-3.1-8b-instruct", "meta/llama-3.1-70b-instruct"];

    for (const model of nvidiaModels) {
      try {
        console.log(`[Proxy] Falling back to NVIDIA model: ${model}`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(NVIDIA_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${nvidiaApiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.7,
            max_tokens: 800,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          const reply = data.choices?.[0]?.message?.content?.trim();
          if (reply) {
            console.log(`[Proxy] Successful reply from NVIDIA model: ${model}`);
            return reply;
          }
        } else {
          const errorText = await res.text();
          console.warn(`[Proxy] NVIDIA model ${model} failed with status ${res.status}:`, errorText);
        }
      } catch (e: any) {
        console.warn(`[Proxy] NVIDIA call to ${model} failed:`, e.name === "AbortError" ? "Timeout after 10s" : e.message || e);
      }
    }
  }

  throw new Error("All LLM providers and models failed");
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
        const userMsg = isTimeout
          ? "Apologies, Boss. The AI providers are slow right now. Please try again in a moment."
          : err?.message || String(err);
        console.error("[Proxy Promise Error]:", isTimeout ? "LLM 20s timeout" : err);
        const errorBody = JSON.stringify({ success: false, error: userMsg });
        res.writeHead(isTimeout ? 503 : 500, corsHeaders);
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

let proxyInstance: any = null;
let isProxyRunning = false;

const PROXY_PORT = 8080;
const CERT_DIR = path.join(process.cwd(), ".certificates");

export function getProxyStatus() {
  return {
    running: isProxyRunning,
    port: PROXY_PORT,
    caCertPath: path.join(CERT_DIR, "certs", "ca.pem"),
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

function decompressBuffer(buffer: Buffer, encoding: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (encoding === "gzip") {
      zlib.gunzip(buffer, (err, result) => (err ? reject(err) : resolve(result)));
    } else if (encoding === "deflate") {
      zlib.inflate(buffer, (err, result) => (err ? reject(err) : resolve(result)));
    } else if (encoding === "br") {
      zlib.brotliDecompress(buffer, (err, result) => (err ? reject(err) : resolve(result)));
    } else {
      resolve(buffer);
    }
  });
}

export async function startProxyServer(): Promise<boolean> {
  if (isProxyRunning && proxyInstance) {
    return true;
  }

  try {
    const { Proxy } = require("http-mitm-proxy");
    proxyInstance = new Proxy();

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

      // Disable compression so we can read/modify the raw HTML
      delete ctx.clientToProxyRequest.headers["accept-encoding"];

      ctx.onResponse(function (ctx: any, callback: any) {
        const contentType = ctx.serverToProxyResponse.headers["content-type"] || "";
        const isHTML = contentType.includes("text/html");

        if (!isHTML) {
          return callback();
        }

        // Remove CSP and encoding headers to allow injection on HTML pages
        delete ctx.serverToProxyResponse.headers["content-security-policy"];
        delete ctx.serverToProxyResponse.headers["content-security-policy-report-only"];
        delete ctx.serverToProxyResponse.headers["x-frame-options"];
        const contentEncoding = ctx.serverToProxyResponse.headers["content-encoding"] || "";
        delete ctx.serverToProxyResponse.headers["content-encoding"];

        const chunks: Buffer[] = [];

        ctx.onResponseData(function (ctx: any, chunk: Buffer, callback: any) {
          chunks.push(chunk);
          return callback(null, null); // suppress direct forwarding for HTML
        });

        ctx.onResponseEnd(async function (ctx: any, callback: any) {
          try {
            let rawBuffer = Buffer.concat(chunks);

            // Decompress if needed
            if (contentEncoding) {
              try {
                rawBuffer = await decompressBuffer(rawBuffer, contentEncoding);
              } catch (decompErr) {
                console.warn("[Proxy] Decompression failed, using raw:", decompErr?.message);
              }
            }

            let html = rawBuffer.toString("utf8");
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

            const resultBuffer = Buffer.from(html, "utf8");
            ctx.serverToProxyResponse.headers["content-length"] = String(resultBuffer.length);

            ctx.proxyToClientResponse.write(resultBuffer);
            return callback();
          } catch (err) {
            console.error("[Proxy] Injection failed:", err);
            ctx.proxyToClientResponse.write(Buffer.concat(chunks));
            return callback();
          }
        });

        return callback();
      });

      return callback();
    });

    // Fire-and-forget: start listening in background so the UI doesn't hang.
    // http-mitm-proxy can take up to 15s on first run (SSL cert generation).
    // We mark isProxyRunning = true optimistically and let it settle.
    isProxyRunning = true;

    proxyInstance.listen(
      {
        port: PROXY_PORT,
        host: "0.0.0.0",
        sslCaDir: CERT_DIR,
      },
      (err: any) => {
        if (err) {
          console.error("[Proxy] Failed to start MITM proxy:", err);
          isProxyRunning = false;
          proxyInstance = null;
        } else {
          console.log(`[Proxy] Autonomous local proxy running on port ${PROXY_PORT}`);
        }
      }
    );

    // Wait up to 1.5s for a quick-start (e.g. cert already exists), then return.
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));
    return isProxyRunning;
  } catch (error) {
    console.error("[Proxy] Critical error starting proxy:", error);
    isProxyRunning = false;
    proxyInstance = null;
    return false;
  }
}

export async function stopProxyServer(): Promise<boolean> {
  if (!isProxyRunning && !proxyInstance) {
    return true;
  }

  try {
    if (proxyInstance) {
      proxyInstance.close();
    }
  } catch (closeErr: any) {
    console.warn("[Proxy] Error during close (non-fatal):", closeErr?.message);
  } finally {
    proxyInstance = null;
    isProxyRunning = false;
    console.log("[Proxy] Autonomous proxy stopped.");
  }
  return true;
}
