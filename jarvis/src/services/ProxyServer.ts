// @ts-nocheck
import fs from "fs";
import path from "path";
import zlib from "zlib";

// OpenRouter config — used for jarvis.internal interception
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const FREE_MODELS = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
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
- Keep your answers concise, readable, and structured.`;

async function callOpenRouter(query: string, url: string, domContent: string): Promise<string> {
  const systemPrompt = JARVIS_SYSTEM_PROMPT
    .replace("{{url}}", url || "Unknown")
    .replace("{{domContent}}", (domContent || "No content extracted.").slice(0, 10000));

  for (const model of FREE_MODELS) {
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "JARVIS",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: query },
          ],
          temperature: 0.7,
          max_tokens: 800,
        }),
      });

      if (!res.ok) continue;

      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content?.trim();
      if (reply) return reply;
    } catch {
      // try next model
    }
  }
  throw new Error("All models failed");
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
    const { query, url, domContent } = body;

    if (!query) {
      res.writeHead(400, corsHeaders);
      res.end(JSON.stringify({ success: false, error: "Query is required" }));
      return;
    }

    callOpenRouter(query, url, domContent)
      .then((reply) => {
        const responseBody = JSON.stringify({ success: true, response: reply });
        res.writeHead(200, {
          ...corsHeaders,
          "Content-Length": Buffer.byteLength(responseBody).toString(),
        });
        res.end(responseBody);
      })
      .catch((err) => {
        const errorBody = JSON.stringify({ success: false, error: err?.message || String(err) });
        res.writeHead(500, corsHeaders);
        res.end(errorBody);
      });
  } catch (err: any) {
    const errorBody = JSON.stringify({ success: false, error: err?.message || String(err) });
    res.writeHead(500, corsHeaders);
    res.end(errorBody);
  }
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

      // Intercept JARVIS internal chat — same-origin path avoids mixed content issues
      if (reqUrl.includes("/__jarvis_chat")) {
        const req = ctx.clientToProxyRequest;
        const res = ctx.proxyToClientResponse;

        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Content-Type": "application/json",
        };

        if (req.method === "OPTIONS") {
          res.writeHead(200, corsHeaders);
          res.end("{}");
          return;
        }

        const chunks: Buffer[] = [];
        ctx.onRequestData((ctx: any, chunk: Buffer, callback: any) => {
          chunks.push(chunk);
          return callback(null, null); // suppress forwarding
        });

        ctx.onRequestEnd((ctx: any, callback: any) => {
          handleJarvisInternalRequest(ctx, Buffer.concat(chunks));
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

    return new Promise((resolve) => {
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
            resolve(false);
          } else {
            console.log(`[Proxy] Autonomous local proxy running on port ${PROXY_PORT}`);
            isProxyRunning = true;
            resolve(true);
          }
        }
      );
    });
  } catch (error) {
    console.error("[Proxy] Critical error starting proxy:", error);
    isProxyRunning = false;
    return false;
  }
}

export async function stopProxyServer(): Promise<boolean> {
  if (!isProxyRunning || !proxyInstance) {
    return true;
  }

  try {
    proxyInstance.close();
    proxyInstance = null;
    isProxyRunning = false;
    console.log("[Proxy] Autonomous proxy stopped successfully.");
    return true;
  } catch (error) {
    console.error("[Proxy] Error stopping proxy server:", error);
    return false;
  }
}
