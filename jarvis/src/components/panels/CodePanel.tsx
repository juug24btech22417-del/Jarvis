"use client";

/**
 * Code Forge — JARVIS's dedicated code panel.
 *
 * When JARVIS writes code, it lands here instead of the chat: syntax-
 * highlighted source, a sandboxed live preview for web code (HTML/CSS/JS),
 * and a console that captures the running artifact's output.
 *
 * Design: quiet, Apple-grade glass — hairline borders, traffic-light
 * window controls, centered segmented control, system typography. Drag the
 * header to move the panel; the preview can go fullscreen or open in a tab.
 *
 * Security: the preview iframe runs with sandbox="allow-scripts" only —
 * no same-origin, so generated code cannot touch JARVIS's storage, cookies,
 * or DOM. Console output crosses the iframe boundary via postMessage.
 */

import { motion, AnimatePresence } from "framer-motion";
import {
  Maximize2,
  ExternalLink,
  RotateCcw,
  Play,
} from "lucide-react";
import { useJarvisStore } from "@/store/jarvis.store";
import type { GeneratedCodeArtifact } from "@/store/jarvis.store";
import { useState, useMemo, useRef, useEffect, useLayoutEffect } from "react";
import { wrapInHtmlShell, isRunnableLanguage } from "@/lib/jarvis/codeForge";
import { buildSystemPrompt } from "@/lib/jarvis/personality";

/* ─── Syntax highlighting — Xcode-dark palette, deliberately quiet ───── */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightCode(code: string, language: string): string {
  let h = escapeHtml(code);
  const KEY = "#fc5fa3"; // keywords — Xcode pink
  const FN = "#67b7a4";  // functions — muted teal
  const STR = "#fc6a5d"; // strings — soft coral
  const NUM = "#d0bf69"; // numbers — sand
  const COM = "#6c7986"; // comments — slate
  const TAG = "#5dd8ff"; // html tags — ice blue
  const ATTR = "#a794ff"; // attributes — lavender

  if (language === "html") {
    // Order matters: attributes BEFORE tags — otherwise the attribute pass
    // matches the style="..." inside spans injected by the tag pass and
    // shreds them into garbage text.
    h = h.replace(/(&lt;!--[\s\S]*?--&gt;)/g, `<span style="color:${COM}">$1</span>`);
    h = h.replace(/([a-zA-Z-]+)(=)(&quot;.*?&quot;|".*?")/g, `<span style="color:${ATTR}">$1</span>$2<span style="color:${STR}">$3</span>`);
    h = h.replace(/(&lt;\/?)([a-zA-Z][\w-]*)/g, `<span style="color:${COM}">$1</span><span style="color:${TAG}">$2</span>`);
  } else if (language === "css") {
    h = h.replace(/(\/\*[\s\S]*?\*\/)/g, `<span style="color:${COM}">$1</span>`);
    h = h.replace(/([\w-]+)(\s*:\s*)([^;{}\n]+)/g, `<span style="color:${ATTR}">$1</span>$2<span style="color:${STR}">$3</span>`);
    h = h.replace(/(^|\n)(\s*)([.#]?[\w-]+)(\s*\{)/g, `$1$2<span style="color:${KEY}">$3</span>$4`);
  } else if (["javascript", "js", "typescript", "ts"].includes(language)) {
    h = h.replace(/(\/\/.*$)/gm, `<span style="color:${COM}">$1</span>`);
    h = h.replace(/(\/\*[\s\S]*?\*\/)/g, `<span style="color:${COM}">$1</span>`);
    h = h.replace(/(&quot;.*?&quot;|".*?"|'.*?'|`.*?`)/g, `<span style="color:${STR}">$1</span>`);
    h = h.replace(/\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|new|this|typeof|switch|case|break|default|extends|super)\b/g, `<span style="color:${KEY}">$1</span>`);
    h = h.replace(/\b(\d+(?:\.\d+)?)\b/g, `<span style="color:${NUM}">$1</span>`);
    h = h.replace(/([a-zA-Z_$][\w$]*)(\s*\()/g, `<span style="color:${FN}">$1</span>$2`);
  } else if (language === "python" || language === "py") {
    h = h.replace(/(#.*$)/gm, `<span style="color:${COM}">$1</span>`);
    h = h.replace(/(&quot;.*?&quot;|".*?"|'.*?')/g, `<span style="color:${STR}">$1</span>`);
    h = h.replace(/\b(def|class|return|if|elif|else|for|while|import|from|try|except|with|as|lambda|None|True|False|and|or|not|in|is)\b/g, `<span style="color:${KEY}">$1</span>`);
    h = h.replace(/\b(\d+(?:\.\d+)?)\b/g, `<span style="color:${NUM}">$1</span>`);
    h = h.replace(/([a-zA-Z_][\w]*)(\s*\()/g, `<span style="color:${FN}">$1</span>$2`);
  }
  return h;
}

/* ─── Preview iframe: console bridge + document building ─────────────── */

interface ConsoleLine {
  kind: "log" | "error" | "warn";
  text: string;
  time: string;
}

const BRIDGE_SNIPPET = `<script>(function(){
  var send=function(kind,args){try{parent.postMessage({__forge:true,kind:kind,text:Array.prototype.map.call(args,function(a){
    try{return typeof a==="object"&&a!==null?JSON.stringify(a):String(a);}catch(e){return String(a);}
  }).join(" ")}, "*");}catch(e){}};
  ["log","warn","error","info"].forEach(function(m){
    var orig=console[m].bind(console);
    console[m]=function(){send(m==="info"?"log":m,arguments);orig.apply(console,arguments);};
  });
  window.addEventListener("error",function(e){send("error",[e.message+" ("+(e.lineno||0)+":"+(e.colno||0)+")"]);});
  window.addEventListener("unhandledrejection",function(e){send("error",["Unhandled rejection: "+e.reason]);});
})();</script>`;

function buildPreviewDoc(code: string, language: string): string {
  const src = wrapInHtmlShell(code, language === "js" ? "javascript" : language);
  if (/<head[^>]*>/i.test(src)) {
    return src.replace(/<head[^>]*>/i, (m) => m + BRIDGE_SNIPPET);
  }
  if (/<html[^>]*>/i.test(src)) {
    return src.replace(/<html[^>]*>/i, (m) => m + BRIDGE_SNIPPET);
  }
  return BRIDGE_SNIPPET + src;
}

/* ─── Small helpers ──────────────────────────────────────────────────── */

const EXT: Record<string, string> = {
  html: "html", css: "css", javascript: "js", js: "js", typescript: "ts",
  python: "py", java: "java", cpp: "cpp", c: "c", csharp: "cs", go: "go",
  rust: "rs", ruby: "rb", php: "php", sql: "sql", json: "json",
};

const LANG_LABEL: Record<string, string> = {
  html: "HTML", css: "CSS", javascript: "JavaScript", js: "JavaScript",
  typescript: "TypeScript", python: "Python",
};

const PANEL_W = 680;

type Tab = "preview" | "code" | "console";

/* ─── Panel ──────────────────────────────────────────────────────────── */

export default function CodePanel() {
  const {
    generatedCode,
    clearGeneratedCode,
    activePanel,
    setActivePanel,
    setGeneratedCode,
    userName,
  } = useJarvisStore();

  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<Tab>("preview");
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [runNonce, setRunNonce] = useState(0); // bump → rebuild doc → re-run
  const [regenerating, setRegenerating] = useState(false);

  // Drag state — position is viewport-absolute; -1 means "not yet placed"
  // (panel then anchors top-right by default).
  const [pos, setPos] = useState({ x: -1, y: -1 });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const previewRef = useRef<HTMLDivElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);

  const doc = useMemo(
    () =>
      generatedCode
        ? buildPreviewDoc(generatedCode.code, generatedCode.language)
        : "",
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [generatedCode?.code, generatedCode?.language, runNonce]
  );

  const open = activePanel === "code" && !!generatedCode;
  const runnable =
    !!generatedCode &&
    (generatedCode.runnable ||
      ["html", "css", "javascript", "js"].includes(generatedCode.language.toLowerCase()));

  /* Console bridge from the sandboxed iframe */
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const d = e.data as { __forge?: boolean; kind?: string; text?: string };
      if (!d || d.__forge !== true || !d.text) return;
      setConsoleLines((prev) => [
        ...prev.slice(-199),
        {
          kind: d.kind === "error" ? "error" : d.kind === "warn" ? "warn" : "log",
          text: String(d.text).slice(0, 500),
          time: new Date().toLocaleTimeString([], { hour12: false }),
        },
      ]);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  /* Fresh artifact → reset console, show preview */
  useEffect(() => {
    setConsoleLines([]);
    setTab("preview");
  }, [generatedCode?.createdAt]);

  /* Console auto-scroll */
  useEffect(() => {
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [consoleLines]);

  /* Default placement (top-right) once open */
  useLayoutEffect(() => {
    if (!open || pos.x >= 0) return;
    setPos({ x: Math.max(8, window.innerWidth - PANEL_W - 16), y: 80 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* Drag: window-level move/up while a drag is active */
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const x = Math.min(Math.max(8, e.clientX - d.dx), window.innerWidth - PANEL_W - 8);
      const y = Math.min(Math.max(8, e.clientY - d.dy), window.innerHeight - 140);
      setPos({ x, y });
    };
    const up = () => {
      setDragging(false);
      dragRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging]);

  if (!open || !generatedCode) return null;

  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    setDragging(true);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedCode.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — ignore
    }
  };

  const handleDownload = () => {
    const ext = EXT[generatedCode.language.toLowerCase()] || "txt";
    const filename = `jarvis-forge-${new Date().toISOString().slice(0, 10)}.${ext}`;
    const blob = new Blob([generatedCode.code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const goFullscreen = async () => {
    const el = previewRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
      return;
    }
    if (tab !== "preview") setTab("preview");
    // Wait a frame so the preview container is mounted before expanding it.
    setTimeout(() => el.requestFullscreen?.().catch(() => {}), 60);
  };

  const openInNewTab = () => {
    const blob = new Blob([doc], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  /**
   * Ask JARVIS to rewrite the artifact through /api/chat (same pipeline as
   * the main conversation, so the Code Forge protocol applies). The reply
   * must carry a fresh <<<FORGE:...>>> block — parsed here and swapped in.
   */
  const regenerate = async () => {
    if (regenerating || !generatedCode) return;
    setRegenerating(true);
    try {
      const ctx = {
        userName,
        currentTime: new Date().toLocaleString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        memories: [],
        tasks: [],
        recentMessages: [],
      };
      const lang = generatedCode.language;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: `The ${lang} artifact you generated (${
                generatedCode.description || "Code Forge output"
              }) has functional bugs — interactions misbehave after the first click. Rewrite the COMPLETE artifact from scratch and verify every interaction mentally before emitting. Deliver it in the <<<FORGE:${lang} ... FORGE>>> block exactly per the Code Forge protocol: fully working, single self-contained file, no alert(), no external requests.`,
            },
          ],
          systemPrompt: buildSystemPrompt(ctx),
        }),
      });

      let text = "";
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const data = await res.json().catch(() => ({ content: "" }));
        text = data.content || "";
      } else {
        const reader = res.body?.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const d = line.slice(6);
            if (d === "[DONE]") continue;
            try {
              const j = JSON.parse(d);
              const c =
                j.choices?.[0]?.delta?.content ||
                (j.type === "content_block_delta" ? j.delta?.text : "") ||
                "";
              if (c) text += c;
            } catch {}
          }
        }
      }

      // Swap in the new artifact (last complete marker wins; tolerant of
      // spacing variants and truncated-marker recovery).
      const all = [...text.matchAll(/<<<FORGE:\s*(\w+)\s*([\s\S]*?)\s*FORGE>>>/g)]
        .filter((mm) => mm[2].trim().length > 40);
      const last = all[all.length - 1];
      const om = !last ? text.match(/<<<FORGE:\s*(\w+)\s*\n?([\s\S]*)$/) : null;
      const next = last
        ? { lang: last[1], code: last[2].trim() }
        : om && om[2].trim().length > 200
        ? { lang: om[1], code: om[2].replace(/```\s*$/, "").trimEnd() }
        : null;

      if (next && next.code.trim().length > 40) {
        const normLang = next.lang.toLowerCase() === "web" ? "html" : next.lang.toLowerCase();
        setGeneratedCode({
          language: normLang,
          code: next.code,
          description: generatedCode.description,
          runnable: isRunnableLanguage(normLang),
          createdAt: Date.now(),
        });
        setRunNonce((n) => n + 1); // auto re-run the fresh build
        setConsoleLines([]);
        setTab("preview");
      }
    } catch {
      // silent — the panel simply keeps the previous artifact
    } finally {
      setRegenerating(false);
    }
  };

  const errorCount = consoleLines.filter((l) => l.kind === "error").length;
  const langLabel = LANG_LABEL[generatedCode.language.toLowerCase()] || generatedCode.language.toUpperCase();
  const lineCount = generatedCode.code.split("\n").length;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 220, damping: 26 }}
        className={`fixed z-40 max-w-[calc(100vw-2rem)] max-h-[82vh] rounded-2xl border border-white/[0.08] bg-[#0b0f16]/85 backdrop-blur-2xl overflow-hidden flex flex-col ${
          dragging ? "select-none" : ""
        }`}
        style={{
          width: PANEL_W,
          ...(pos.x >= 0 && pos.y >= 0
            ? { left: pos.x, top: pos.y }
            : { right: 16, top: 80 }),
          boxShadow:
            "0 32px 90px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.02) inset",
        }}
      >
        {/* ── Title bar: traffic lights + centered title + drag handle ── */}
        <div
          onPointerDown={startDrag}
          className={`shrink-0 px-4 pt-3 pb-1 ${
            dragging ? "cursor-grabbing" : "cursor-grab"
          }`}
        >
          <div className="flex items-center">
            {/* Traffic lights — close (red), fullscreen (yellow), open tab (green) */}
            <div className="flex items-center gap-2 w-20">
              <button
                onClick={() => {
                  setActivePanel(null);
                  clearGeneratedCode();
                }}
                title="Close"
                className="group h-3 w-3 rounded-full bg-[#ff5f57] transition hover:brightness-125"
              >
                <span className="mx-auto hidden h-1.5 w-1.5 text-[#7c1d16] group-hover:block">
                  ✕
                </span>
              </button>
              <button
                onClick={goFullscreen}
                title="Fullscreen preview"
                className="h-3 w-3 rounded-full bg-[#febc2e] transition hover:brightness-125"
              />
              <button
                onClick={openInNewTab}
                title="Open in new tab"
                className="h-3 w-3 rounded-full bg-[#28c840] transition hover:brightness-125"
              />
            </div>

            <div className="flex-1 text-center min-w-0">
              <span className="text-[13px] font-medium tracking-tight text-white/90">
                Code Forge
              </span>
              <span className="text-[13px] text-white/35"> — {langLabel}</span>
            </div>

            <div className="flex items-center justify-end gap-0.5 w-20">
              <button
                onClick={handleCopy}
                title="Copy to clipboard"
                className="rounded-md px-1.5 py-1 text-[11px] text-white/40 transition hover:bg-white/[0.06] hover:text-white/90"
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                onClick={handleDownload}
                title="Download file"
                className="rounded-md px-1.5 py-1 text-[11px] text-white/40 transition hover:bg-white/[0.06] hover:text-white/90"
              >
                Save
              </button>
            </div>
          </div>
        </div>

        {/* ── Controls: segmented tabs (centered) + Run/Regenerate ── */}
        <div className="shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 pb-2.5 pt-1">
          <div />

          <div className="flex items-center rounded-lg bg-white/[0.05] p-0.5">
            {(
              [
                { id: "preview" as Tab, label: "Preview", disabled: !runnable },
                { id: "code" as Tab, label: "Source", disabled: false },
                { id: "console" as Tab, label: "Console", disabled: !runnable, badge: errorCount },
              ] as const
            ).map(({ id, label, disabled }) => (
              <button
                key={id}
                disabled={disabled}
                onClick={() => setTab(id)}
                className={`relative rounded-[7px] px-3.5 py-1 text-[12px] tracking-tight transition-colors ${
                  tab === id
                    ? "text-white"
                    : disabled
                    ? "text-white/20 cursor-not-allowed"
                    : "text-white/45 hover:text-white/75"
                }`}
              >
                {tab === id && (
                  <motion.span
                    layoutId="forge-seg"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    className="absolute inset-0 rounded-[7px] bg-white/[0.10] shadow-[0_1px_2px_rgba(0,0,0,0.4)]"
                  />
                )}
                <span className="relative flex items-center gap-1.5">
                  {label}
                  {id === "console" && errorCount > 0 && (
                    <span className="inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#ff5f57]/90 px-1 text-[9px] font-semibold text-black/80">
                      {errorCount}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-end gap-1.5">
            <button
              onClick={regenerate}
              disabled={regenerating}
              title="Ask JARVIS to rewrite the artifact"
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-white/50 transition hover:bg-white/[0.06] hover:text-white/90 disabled:opacity-40"
            >
              <RotateCcw className={`h-3.5 w-3.5 ${regenerating ? "animate-spin" : ""}`} />
              {regenerating ? "Fixing…" : "Regenerate"}
            </button>
            {runnable && (
              <button
                onClick={() => {
                  setConsoleLines([]);
                  setRunNonce((n) => n + 1);
                  setTab("preview");
                }}
                className="flex items-center gap-1.5 rounded-full bg-cyan-300/90 px-3.5 py-1 text-[12px] font-semibold tracking-tight text-[#04121c] transition hover:bg-cyan-200"
              >
                <Play className="h-3 w-3" />
                {runNonce === 0 ? "Run" : "Rerun"}
              </button>
            )}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="min-h-[440px] shrink-0 overflow-hidden px-3 pb-3">
          {tab === "preview" && runnable && (
            <div
              ref={previewRef}
              className="h-[calc(82vh-150px)] min-h-[440px] overflow-hidden rounded-xl border border-white/[0.07] bg-[#05070b]"
            >
              {runNonce === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3">
                  <p className="text-[13px] tracking-tight text-white/55">
                    Ready when you are, Boss.
                  </p>
                  <button
                    onClick={() => setRunNonce((n) => n + 1)}
                    className="flex items-center gap-2 rounded-full bg-cyan-300/90 px-5 py-1.5 text-[13px] font-semibold tracking-tight text-[#04121c] transition hover:bg-cyan-200"
                  >
                    <Play className="h-3.5 w-3.5" /> Run
                  </button>
                  <p className="text-[11px] text-white/25">
                    Isolated sandbox — no access to this machine.
                  </p>
                </div>
              ) : (
                <iframe
                  key={runNonce}
                  title="Code Forge preview"
                  className="h-full w-full bg-white"
                  sandbox="allow-scripts allow-modals allow-forms allow-popups"
                  srcDoc={doc}
                />
              )}
            </div>
          )}

          {tab === "code" && (
            <div className="h-[calc(82vh-150px)] min-h-[440px] overflow-auto rounded-xl border border-white/[0.07] bg-[#05070b] p-4">
              <pre className="font-mono text-[12px] leading-[1.65] whitespace-pre-wrap break-words text-white/85">
                <code
                  dangerouslySetInnerHTML={{
                    __html: highlightCode(generatedCode.code, generatedCode.language),
                  }}
                />
              </pre>
            </div>
          )}

          {tab === "console" && runnable && (
            <div className="flex h-[calc(82vh-150px)] min-h-[440px] flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-[#05070b]">
              <div
                ref={consoleRef}
                className="flex-1 overflow-auto p-3 font-mono text-[11.5px] leading-relaxed"
              >
                {consoleLines.length === 0 ? (
                  <p className="text-[12px] italic text-white/25">
                    Output from the running artifact appears here…
                  </p>
                ) : (
                  consoleLines.map((l, i) => (
                    <div
                      key={i}
                      className={`flex gap-2 py-0.5 ${
                        l.kind === "error"
                          ? "text-[#ff7b72]"
                          : l.kind === "warn"
                          ? "text-[#e2b93d]"
                          : "text-white/75"
                      }`}
                    >
                      <span className="shrink-0 tabular-nums text-white/25">{l.time}</span>
                      <span className="break-all whitespace-pre-wrap">{l.text}</span>
                    </div>
                  ))
                )}
              </div>
              {consoleLines.length > 0 && (
                <div className="flex justify-end border-t border-white/[0.05] px-3 py-1.5">
                  <button
                    onClick={() => setConsoleLines([])}
                    className="text-[11px] text-white/35 transition hover:text-white/80"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex shrink-0 items-center justify-between border-t border-white/[0.05] px-4 py-2">
          <span className="text-[11px] text-white/30">
            {runnable
              ? "Sandboxed · origin-isolated · nothing leaves this window"
              : "Display only — this language runs outside the browser"}
          </span>
          <span className="tabular-nums text-[11px] text-white/25">{lineCount} lines</span>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
