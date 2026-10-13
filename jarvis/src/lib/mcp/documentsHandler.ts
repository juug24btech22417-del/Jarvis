// Document conversion provider (Docling).
//
// WHY: JARVIS reads documents with pdf-parse + mammoth, which produce flat
// text. Flat text is why an LLM mangles anything tabular — a spec sheet or
// invoice reads back as a word salad with the columns gone. Docling preserves
// layout, reading order and table structure, and runs entirely locally.
//
// NO TERMINAL, EVER: Docling is Python, so JARVIS provisions its own venv
// (.jarvis-services/docling-venv, gitignored) and runs `docling-serve` as a
// supervised child process. The first call pays for model download/load; after
// that the server stays warm for the life of the Next.js process.
//
// GRACEFUL DEGRADATION: if the Python sidecar is unavailable (not provisioned,
// still installing, or crashed), conversion falls back to in-process
// pdf-parse/mammoth and *says so* in the response. A document tool that
// silently returns nothing is worse than one that says "I used the basic
// reader, tables will be flattened".

import fs from "fs";
import path from "path";
import { ensureService, getServiceState, stopService, readServiceLog, type ServiceSpec } from "@/lib/services/supervisor";
import { hadPathDecoration, normalizeLocalPath } from "@/lib/mcp/localPaths";

// Host/port are configurable so the sidecar can be moved (or an existing
// docling-serve on another port reused) without touching code.
const DOCLING_HOST = process.env.JARVIS_DOCLING_HOST || "127.0.0.1";
const DOCLING_PORT = Number(process.env.JARVIS_DOCLING_PORT || 5001);
const DOCLING_BASE = `http://${DOCLING_HOST}:${DOCLING_PORT}`;
// Which Python interpreter runs the sidecar — override for a system Python.
const DOCLING_PYTHON = process.env.JARVIS_DOCLING_PYTHON || "";

// Service runtimes live under one directory; override it to relocate the venv
// (e.g. onto a bigger drive) without editing code.
function servicesDir(): string {
  const configured = process.env.JARVIS_SERVICES_DIR;
  return configured ? path.resolve(configured) : path.join(process.cwd(), ".jarvis-services");
}

function venvDir(): string {
  return path.join(servicesDir(), process.env.JARVIS_DOCLING_VENV || "docling-venv");
}

function venvPython(): string {
  if (DOCLING_PYTHON) return DOCLING_PYTHON;
  // Windows venvs put the interpreter in Scripts/, POSIX ones in bin/.
  const win = path.join(venvDir(), "Scripts", "python.exe");
  return process.platform === "win32" ? win : path.join(venvDir(), "bin", "python");
}

const SPEC: ServiceSpec = {
  name: "docling-serve",
  label: "Docling document server",
  command: venvPython(),
  args: [
    "-m",
    process.env.JARVIS_DOCLING_MODULE || "docling_serve",
    "run",
    "--host",
    DOCLING_HOST,
    "--port",
    String(DOCLING_PORT),
  ],
  healthUrl: `${DOCLING_BASE}/health`,
  // A cold first start downloads the layout + TableFormer models from
  // Hugging Face (measured: ~7 minutes end-to-end on this machine), so the
  // readiness window has to be generous or the very first conversion silently
  // falls back to the flat-text reader and the user thinks Docling is broken.
  readyTimeoutMs: Number(process.env.JARVIS_DOCLING_READY_MS || 600_000),
  setupHint:
    "Provision it with: uv venv --python 3.12 .jarvis-services/docling-venv && " +
    "uv pip install --python .jarvis-services/docling-venv/Scripts/python.exe docling-serve",
};

export function isProvisioned(): boolean {
  return fs.existsSync(venvPython());
}

async function ensureDocling(): Promise<{ ok: boolean; error?: string }> {
  if (!isProvisioned()) {
    return {
      ok: false,
      error:
        "The Docling runtime is not provisioned yet. Run the setup command from the panel's setup hint (it is a one-time ~2-4 GB install of the document models).",
    };
  }
  const ok = await ensureService(SPEC);
  if (!ok) {
    const st = getServiceState(SPEC.name);
    return { ok: false, error: st?.lastError || "docling-serve did not become ready" };
  }
  return { ok: true };
}

export function doclingStatus() {
  const st = getServiceState("docling-serve");
  return {
    provisioned: isProvisioned(),
    venv: venvDir(),
    baseUrl: DOCLING_BASE,
    service: st,
    log: readServiceLog("docling-serve", 25),
    setupHint: SPEC.setupHint,
  };
}

// ── Docling HTTP calls ───────────────────────────────────────────────

type ConvertOptions = {
  toFormats?: string;
  doOcr?: boolean;
  forceOcr?: boolean;
  tableMode?: string;
  imageExportMode?: string;
  ocrLang?: string;
  pipeline?: string;
};

async function convertWithDocling(
  filePath: string,
  opts: ConvertOptions
): Promise<{ markdown: string; json: unknown; status: string; seconds: number; errors: unknown }> {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("files", new Blob([new Uint8Array(buf)]), path.basename(filePath));
  form.append("to_formats", opts.toFormats ?? "md");
  form.append("do_ocr", String(opts.doOcr ?? true));
  if (opts.forceOcr) form.append("force_ocr", "true");
  if (opts.tableMode) form.append("table_mode", opts.tableMode);
  if (opts.imageExportMode) form.append("image_export_mode", opts.imageExportMode);
  if (opts.ocrLang) form.append("ocr_lang", opts.ocrLang);
  if (opts.pipeline) form.append("pipeline", opts.pipeline);

  const res = await fetch(`${DOCLING_BASE}/v1/convert/file`, {
    method: "POST",
    body: form,
    // Conversion of a large PDF is genuinely slow; do not cut it short.
    signal: AbortSignal.timeout(Number(process.env.JARVIS_DOCLING_TIMEOUT_MS || 600_000)),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`docling-serve ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = JSON.parse(text) as {
    document?: { md_content?: string; json_content?: unknown };
    status?: string;
    processing_time?: number;
    errors?: unknown;
  };
  return {
    markdown: data.document?.md_content ?? "",
    json: data.document?.json_content ?? null,
    status: data.status ?? "unknown",
    seconds: data.processing_time ?? 0,
    errors: data.errors ?? [],
  };
}

async function convertFromUrl(url: string, opts: ConvertOptions) {
  const res = await fetch(`${DOCLING_BASE}/v1/convert/source`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      http_sources: [{ url }],
      options: {
        to_formats: [opts.toFormats ?? "md"],
        do_ocr: opts.doOcr ?? true,
        ...(opts.tableMode ? { table_mode: opts.tableMode } : {}),
        ...(opts.imageExportMode ? { image_export_mode: opts.imageExportMode } : {}),
      },
    }),
    signal: AbortSignal.timeout(Number(process.env.JARVIS_DOCLING_TIMEOUT_MS || 600_000)),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`docling-serve ${res.status}: ${text.slice(0, 400)}`);
  const data = JSON.parse(text);
  return {
    markdown: data.document?.md_content ?? "",
    json: data.document?.json_content ?? null,
    status: data.status ?? "unknown",
    seconds: data.processing_time ?? 0,
  };
}

// ── Built-in fallback (no Python needed) ────────────────────────────

/**
 * Flat-text extraction using the packages JARVIS already ships. Used only when
 * Docling is unavailable, and always labelled as such in the response.
 */
async function convertWithBuiltin(filePath: string): Promise<{ markdown: string; engine: string }> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".pdf") {
    const mod = (await import("pdf-parse")) as unknown as {
      PDFParse?: new (o: { data: Uint8Array }) => { getText: () => Promise<{ text?: string }> };
      default?: (b: Buffer) => Promise<{ text: string }>;
    };
    if (typeof mod.PDFParse === "function") {
      const parser = new mod.PDFParse({ data: new Uint8Array(fs.readFileSync(filePath)) });
      const out = await parser.getText();
      return { markdown: out.text ?? "", engine: "pdf-parse v2" };
    }
    if (typeof mod.default === "function") {
      const out = await mod.default(fs.readFileSync(filePath));
      return { markdown: out.text, engine: "pdf-parse v1" };
    }
    throw new Error("pdf-parse exposed neither PDFParse nor a default function");
  }

  if (ext === ".docx") {
    const mammoth = (await import("mammoth")) as unknown as {
      extractRawText: (o: { path: string }) => Promise<{ value: string }>;
    };
    const out = await mammoth.extractRawText({ path: filePath });
    return { markdown: out.value, engine: "mammoth" };
  }

  if ([".txt", ".md", ".csv", ".json", ".log"].includes(ext)) {
    return { markdown: fs.readFileSync(filePath, "utf8"), engine: "raw text reader" };
  }

  throw new Error(
    `No built-in reader for ${ext || "this file type"}. Docling (which handles PDF/DOCX/PPTX/XLSX/HTML/images) is required for this one.`
  );
}

// ── Actions ─────────────────────────────────────────────────────────

async function actionStatus() {
  const status = doclingStatus();
  return {
    ...status,
    engines: {
      docling: status.service?.ready ? "ready (server warm)" : status.provisioned ? "provisioned, not running" : "not provisioned",
      builtin: "pdf-parse + mammoth (always available, flat text only)",
    },
  };
}

async function actionStart() {
  const r = await ensureDocling();
  return { started: r.ok, error: r.error ?? null, status: doclingStatus() };
}

async function actionStop() {
  return { stopped: stopService("docling-serve"), status: doclingStatus() };
}

async function actionConvert(params: Record<string, unknown>) {
  // A pasted path arrives dressed as whatever the OS gave the user: Explorer
  // adds quotes, browsers add a file:// scheme, and both used to be passed to
  // fs.existsSync verbatim — so a real file was reported as missing.
  const rawPath = params.path ? String(params.path) : "";
  const filePath = normalizeLocalPath(rawPath);
  const url = params.url ? String(params.url).trim() : "";
  if (!filePath && !url) throw new Error("Provide either path (a local file) or url");

  const opts: ConvertOptions = {
    toFormats: params.toFormats ? String(params.toFormats) : "md",
    doOcr: params.doOcr === undefined ? true : params.doOcr === true,
    forceOcr: params.forceOcr === true,
    tableMode: params.tableMode ? String(params.tableMode) : undefined,
    imageExportMode: params.imageExportMode ? String(params.imageExportMode) : undefined,
    ocrLang: params.ocrLang ? String(params.ocrLang) : undefined,
    pipeline: params.pipeline ? String(params.pipeline) : undefined,
  };

  if (filePath && !fs.existsSync(filePath)) {
    const resolved = path.resolve(filePath);
    const hints: string[] = [];
    if (hadPathDecoration(rawPath)) {
      hints.push("the quotes/scheme around the pasted path were already stripped, so they are not the cause");
    }
    if (fs.existsSync(path.dirname(resolved))) {
      const name = path.basename(resolved);
      const near = fs
        .readdirSync(path.dirname(resolved))
        .filter((f) => f.toLowerCase().includes(name.toLowerCase().slice(0, 6)))
        .slice(0, 5);
      if (near.length) hints.push(`files in that folder with a similar name: ${near.join(", ")}`);
    } else {
      hints.push(`the folder itself does not exist (${path.dirname(resolved)})`);
    }
    hints.push("on Windows, paste the path without surrounding quotes");
    throw new Error(`File does not exist: ${resolved} — ${hints.join("; ")}.`);
  }

  const docling = await ensureDocling();
  const warnings: string[] = [];

  if (docling.ok) {
    try {
      const out = url
        ? await convertFromUrl(url, opts)
        : await convertWithDocling(filePath, opts);

      // A 200 with no text is a real outcome (an empty or image-only document)
      // and must be called out — returning a blank panel with no explanation is
      // exactly the silent failure that makes a tool untrustworthy.
      if (!out.markdown || !out.markdown.trim()) {
        warnings.push(
          `Docling returned status "${out.status}" but no text. The document is likely empty, or image-only without OCR output — try again with doOcr enabled.`
        );
      }
      if (out.status && out.status !== "success") {
        warnings.push(`Docling reported status: ${out.status}.`);
      }

      return {
        engine: "docling",
        source: url || path.resolve(filePath),
        status: out.status,
        seconds: out.seconds,
        markdown: out.markdown,
        json: params.includeJson === true ? out.json : undefined,
        warnings,
      };
    } catch (err) {
      warnings.push(`Docling failed (${(err as Error).message}); fell back to the built-in reader.`);
    }
  } else {
    warnings.push(`Docling unavailable: ${docling.error}`);
  }

  if (url) {
    throw new Error(warnings.join(" ") + " URL fetching requires Docling (the built-in reader only reads local files).");
  }

  const builtin = await convertWithBuiltin(filePath);
  if (builtin.markdown.trim() === "") {
    warnings.push("The built-in reader returned no text — this is often a scanned PDF that needs OCR (Docling).");
  }
  return {
    engine: builtin.engine,
    source: filePath,
    status: "partial_success",
    markdown: builtin.markdown,
    warnings,
  };
}

/** Convert and write the markdown next to the source (or into scratch/). */
async function actionConvertToFile(params: Record<string, unknown>) {
  const result = await actionConvert(params);
  const source = String(result.source);
  const outPath = params.outPath
    ? String(params.outPath)
    : path.join(path.dirname(source), `${path.basename(source, path.extname(source))}.md`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, result.markdown ?? "", "utf8");
  return { ...result, wroteTo: outPath, bytes: Buffer.byteLength(result.markdown ?? "") };
}

export async function handleDocuments(action: string, params: Record<string, unknown>) {
  try {
    switch (action) {
      case "status":
        return { success: true, mcp: "documents", action, data: await actionStatus() };
      case "start":
        return { success: true, mcp: "documents", action, data: await actionStart() };
      case "stop":
        return { success: true, mcp: "documents", action, data: await actionStop() };
      case "convert":
        return { success: true, mcp: "documents", action, data: await actionConvert(params) };
      case "convert_to_file":
        return { success: true, mcp: "documents", action, data: await actionConvertToFile(params) };
      default:
        return {
          success: false,
          mcp: "documents",
          error: `Unsupported documents action '${action}'. Supported: status, start, stop, convert, convert_to_file.`,
        };
    }
  } catch (err) {
    return { success: false, mcp: "documents", error: (err as Error).message };
  }
}
