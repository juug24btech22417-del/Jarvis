"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  QrCode,
  Smartphone,
  Copy,
  Check,
  Send,
  Camera,
  Clipboard,
  Sparkles,
  Inbox,
  RefreshCw,
  ExternalLink,
  Wifi,
  Trash2,
} from "lucide-react";
import { useJarvisStore } from "@/store/jarvis.store";

interface TeleportPayload {
  id: string;
  type: "text" | "url" | "note" | "code" | "clipboard" | "image";
  title: string;
  content: string;
  language?: string;
  createdAt: number;
  source: "pc" | "phone";
}

export default function QRTeleportPanel({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<"beam" | "inbox">("beam");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [mobileUrl, setMobileUrl] = useState<string>("");
  const [lanIp, setLanIp] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [customText, setCustomText] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [inbox, setInbox] = useState<TeleportPayload[]>([]);
  const [autoSyncClipboard, setAutoSyncClipboard] = useState(false);
  const [activePayload, setActivePayload] = useState<TeleportPayload | null>(null);
  const [beamSuccessMsg, setBeamSuccessMsg] = useState<string | null>(null);

  const messages = useJarvisStore((s) => s.messages);
  const tasks = useJarvisStore((s) => s.tasks);
  const lastAssistantMsg = messages.filter((m) => m.role === "assistant").slice(-1)[0]?.content || "";

  // Render QR Code from a URL or text
  const generateQR = useCallback(async (targetUrl: string) => {
    try {
      const QR = await import("qrcode");
      const dataUrl = await QR.toDataURL(targetUrl, {
        width: 240,
        margin: 1,
        color: {
          dark: "#00d4ff",
          light: "#040914",
        },
      });
      setQrDataUrl(dataUrl);
    } catch (e) {
      console.error("Failed to generate QR:", e);
    }
  }, []);

  // Beam payload to server
  const beamPayload = useCallback(async (payload: {
    type: "text" | "url" | "note" | "code" | "clipboard" | "image";
    title: string;
    content: string;
  }) => {
    setLoading(true);
    try {
      const res = await fetch("/api/teleport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data?.success) {
        setMobileUrl(data.mobileUrl);
        setLanIp(data.lanIp);
        setActivePayload(data.payload);
        await generateQR(data.mobileUrl);
        setBeamSuccessMsg(`Beamed ${payload.title}!`);
        setTimeout(() => setBeamSuccessMsg(null), 3000);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [generateQR]);

  // Fetch initial beam & inbox
  const fetchCurrent = useCallback(async () => {
    try {
      const res = await fetch("/api/teleport");
      const data = await res.json();
      if (data?.success) {
        setMobileUrl(data.mobileUrl);
        setLanIp(data.lanIp);
        setActivePayload(data.payload);
        await generateQR(data.mobileUrl);
      }
    } catch (e) {
      console.error(e);
    }
  }, [generateQR]);

  const fetchInbox = useCallback(async () => {
    try {
      const res = await fetch("/api/teleport?inbox=1");
      const data = await res.json();
      if (data?.success) {
        setInbox(data.inbox || []);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    fetchCurrent();
    fetchInbox();
    const interval = setInterval(fetchInbox, 4000);
    return () => clearInterval(interval);
  }, [fetchCurrent, fetchInbox]);

  // Clipboard Watcher
  useEffect(() => {
    if (!autoSyncClipboard) return;
    let lastClip = "";
    const timer = setInterval(async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text !== lastClip && text.trim().length > 0) {
          lastClip = text;
          beamPayload({
            type: text.startsWith("http") ? "url" : "clipboard",
            title: text.startsWith("http") ? "Copied URL" : "Live Clipboard",
            content: text,
          });
        }
      } catch {}
    }, 2000);
    return () => clearInterval(timer);
  }, [autoSyncClipboard, beamPayload]);

  // Actions
  const handleBeamClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        await beamPayload({
          type: text.startsWith("http") ? "url" : "clipboard",
          title: text.startsWith("http") ? "Clipboard URL" : "Clipboard Content",
          content: text,
        });
      }
    } catch {
      alert("Please allow clipboard access or type in the custom text box.");
    }
  };

  const handleBeamChat = () => {
    if (!lastAssistantMsg) return;
    beamPayload({
      type: "text",
      title: "Latest JARVIS Response",
      content: lastAssistantMsg,
    });
  };

  const handleBeamTasks = () => {
    const list = tasks.map((t, i) => `${i + 1}. [${t.completed ? "x" : " "}] ${t.title}`).join("\n");
    beamPayload({
      type: "note",
      title: "Active Tasks List",
      content: list || "No pending tasks.",
    });
  };

  const handleBeamCustom = () => {
    if (!customText.trim()) return;
    beamPayload({
      type: customText.startsWith("http") ? "url" : "text",
      title: customText.startsWith("http") ? "Shared Link" : "Quick Note",
      content: customText.trim(),
    });
    setCustomText("");
  };

  const handleBeamScreenshot = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/screenshot/capture");
      const data = await res.json();
      if (data?.success && data?.image) {
        await beamPayload({
          type: "image",
          title: "PC Desktop Screenshot",
          content: `data:image/png;base64,${data.image}`,
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleClearInbox = async () => {
    try {
      await fetch("/api/teleport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear-inbox" }),
      });
      setInbox([]);
    } catch {}
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[#030914]/95 border border-cyan-500/40 rounded-2xl shadow-[0_0_50px_rgba(0,212,255,0.2)] overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyan-500/20 bg-cyan-950/20">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_15px_rgba(0,212,255,0.3)]">
              <QrCode className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="font-orbitron text-sm font-bold text-cyan-300 tracking-wider flex items-center gap-2">
                QUANTUM QR TELEPORTER
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 font-mono">
                  v2.0 LIVE
                </span>
              </h2>
              <p className="text-[11px] font-rajdhani text-text-secondary flex items-center gap-1">
                <Wifi className="w-3 h-3 text-cyan-400" /> Host Wi-Fi: {lanIp || "Locating..."} · Scan to open on phone
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-black/40 p-0.5 border border-cyan-500/30 text-xs font-mono">
              <button
                onClick={() => setActiveTab("beam")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  activeTab === "beam" ? "bg-cyan-500 text-black font-bold" : "text-cyan-400 hover:text-white"
                }`}
              >
                BEAM TO PHONE
              </button>
              <button
                onClick={() => setActiveTab("inbox")}
                className={`px-3 py-1 rounded-md transition-colors flex items-center gap-1.5 ${
                  activeTab === "inbox" ? "bg-cyan-500 text-black font-bold" : "text-cyan-400 hover:text-white"
                }`}
              >
                PHONE INBOX
                {inbox.length > 0 && (
                  <span className="w-4 h-4 rounded-full bg-cyan-300 text-black text-[10px] font-bold flex items-center justify-center">
                    {inbox.length}
                  </span>
                )}
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-text-secondary hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {activeTab === "beam" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              {/* Left Column: QR Display */}
              <div className="flex flex-col items-center justify-center p-5 bg-black/50 border border-cyan-500/20 rounded-2xl relative group">
                {beamSuccessMsg && (
                  <div className="absolute top-2 px-3 py-1 bg-cyan-500/90 text-black text-xs font-mono font-bold rounded-full shadow-lg animate-bounce">
                    {beamSuccessMsg}
                  </div>
                )}

                {loading ? (
                  <div className="w-[240px] h-[240px] flex flex-col items-center justify-center gap-3">
                    <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
                    <p className="font-mono text-xs text-cyan-400">ENCODING BEAM...</p>
                  </div>
                ) : qrDataUrl ? (
                  <div className="relative p-2 bg-[#040914] rounded-xl border-2 border-cyan-400/50 shadow-[0_0_25px_rgba(0,212,255,0.25)]">
                    <img src={qrDataUrl} alt="Teleport QR" className="w-[220px] h-[220px] rounded-lg" />
                    <div className="absolute inset-0 border border-cyan-400/20 rounded-lg pointer-events-none" />
                  </div>
                ) : (
                  <div className="w-[240px] h-[240px] flex items-center justify-center font-mono text-xs text-cyan-400/50">
                    Generating Code...
                  </div>
                )}

                <div className="mt-4 text-center">
                  <p className="font-mono text-xs text-cyan-300 font-bold tracking-wide">
                    POINT PHONE CAMERA AT QR
                  </p>
                  <p className="font-rajdhani text-[11px] text-text-secondary mt-0.5">
                    Opens mobile receiver on your phone instantly
                  </p>
                </div>

                {mobileUrl && (
                  <div className="mt-3 flex items-center gap-2 bg-black/60 px-3 py-1.5 rounded-lg border border-cyan-500/20 max-w-full">
                    <span className="text-[10px] font-mono text-cyan-400/70 truncate">{mobileUrl}</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(mobileUrl);
                        setCopiedLink(true);
                        setTimeout(() => setCopiedLink(false), 2000);
                      }}
                      className="text-cyan-400 hover:text-white"
                      title="Copy Link"
                    >
                      {copiedLink ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                )}
              </div>

              {/* Right Column: 1-Click Beams & Options */}
              <div className="flex flex-col gap-3">
                <div className="text-xs font-mono text-cyan-400/80 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> Instant Beams
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleBeamClipboard}
                    className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-500/30 hover:border-cyan-400 text-left transition-all hover:bg-cyan-900/40 group"
                  >
                    <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold font-mono">
                      <Clipboard className="w-4 h-4" /> Beam Clipboard
                    </div>
                    <p className="text-[10px] text-text-secondary mt-1">Send copied text/links to phone</p>
                  </button>

                  <button
                    onClick={handleBeamScreenshot}
                    className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-500/30 hover:border-cyan-400 text-left transition-all hover:bg-cyan-900/40 group"
                  >
                    <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold font-mono">
                      <Camera className="w-4 h-4" /> Beam Screen
                    </div>
                    <p className="text-[10px] text-text-secondary mt-1">Capture desktop to mobile</p>
                  </button>

                  <button
                    onClick={handleBeamChat}
                    disabled={!lastAssistantMsg}
                    className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-500/30 hover:border-cyan-400 text-left transition-all hover:bg-cyan-900/40 group disabled:opacity-40"
                  >
                    <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold font-mono">
                      <Send className="w-4 h-4" /> Beam Last Chat
                    </div>
                    <p className="text-[10px] text-text-secondary mt-1">Send JARVIS AI reply to phone</p>
                  </button>

                  <button
                    onClick={handleBeamTasks}
                    className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-500/30 hover:border-cyan-400 text-left transition-all hover:bg-cyan-900/40 group"
                  >
                    <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold font-mono">
                      <Smartphone className="w-4 h-4" /> Beam Tasks
                    </div>
                    <p className="text-[10px] text-text-secondary mt-1">Send to-do checklist to phone</p>
                  </button>
                </div>

                {/* Custom Beam Input */}
                <div className="mt-2 bg-black/40 border border-cyan-500/20 rounded-xl p-3 flex flex-col gap-2">
                  <span className="text-[11px] font-mono text-cyan-300">Custom Text / Link:</span>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={customText}
                      onChange={(e) => setCustomText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleBeamCustom()}
                      placeholder="Paste link, note, or code snippet..."
                      className="flex-1 bg-black/60 border border-cyan-500/30 rounded-lg px-3 py-1.5 text-xs text-white placeholder-cyan-400/30 font-mono focus:outline-none focus:border-cyan-400"
                    />
                    <button
                      onClick={handleBeamCustom}
                      disabled={!customText.trim()}
                      className="px-3 py-1.5 rounded-lg bg-cyan-500 text-black font-bold text-xs font-mono hover:bg-cyan-400 disabled:opacity-40"
                    >
                      BEAM
                    </button>
                  </div>
                </div>

                {/* Feature Guide & Sonar Ping */}
                <div className="mt-2 p-3 bg-cyan-950/20 border border-cyan-500/20 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-cyan-300 font-bold uppercase tracking-wider">
                      Phone Capabilities Active
                    </span>
                    <button
                      onClick={async () => {
                        await fetch("/api/teleport", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "ping-phone" }),
                        });
                        setBeamSuccessMsg("Sonar ping sent to phone!");
                        setTimeout(() => setBeamSuccessMsg(null), 3000);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-[10px] font-mono text-amber-300 flex items-center gap-1 active:scale-95 transition-transform"
                    >
                      <Smartphone className="w-3 h-3" />
                      <span>Ping Phone</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-[10px] text-white/70 font-sans">
                    <div className="flex items-center gap-1.5">
                      <span className="text-cyan-400">✓</span> Voice AI Chat & Directives
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-cyan-400">✓</span> Instant AirDrop Beam Sync
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-cyan-400">✓</span> Room & Desk Spatial AI Scan
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-cyan-400">✓</span> PC Remote Media & Lock
                    </div>
                  </div>
                </div>

                {/* Auto-Sync Toggle */}
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-cyan-950/20 border border-cyan-500/20 text-xs font-mono">
                  <div className="flex items-center gap-2 text-cyan-300">
                    <RefreshCw className={`w-3.5 h-3.5 ${autoSyncClipboard ? "animate-spin text-cyan-400" : ""}`} />
                    <span>Auto-Sync Clipboard to Phone</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoSyncClipboard}
                    onChange={(e) => setAutoSyncClipboard(e.target.checked)}
                    className="accent-cyan-400 w-4 h-4 rounded cursor-pointer"
                  />
                </div>
              </div>
            </div>
          ) : (
            /* Phone Inbox View */
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-cyan-400 flex items-center gap-2">
                  <Inbox className="w-4 h-4" /> Beams Received From Phone ({inbox.length})
                </span>
                {inbox.length > 0 && (
                  <button
                    onClick={handleClearInbox}
                    className="text-[11px] font-mono text-red-400 hover:text-red-300 flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Clear All
                  </button>
                )}
              </div>

              {inbox.length === 0 ? (
                <div className="py-16 text-center text-cyan-400/40 font-mono text-xs border border-dashed border-cyan-500/20 rounded-2xl">
                  No items received from mobile yet.
                  <br />
                  Scan the QR code with your phone and use the &quot;Beam Back to JARVIS&quot; box!
                </div>
              ) : (
                <div className="flex flex-col gap-2.5 max-h-[50vh] overflow-y-auto pr-1">
                  {inbox.map((item) => (
                    <div
                      key={item.id}
                      className="bg-black/40 border border-cyan-500/30 rounded-xl p-3.5 flex flex-col gap-2 hover:border-cyan-400 transition-colors"
                    >
                      <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-cyan-300 font-bold">{item.title}</span>
                        <span className="text-cyan-400/50">{new Date(item.createdAt).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-xs text-cyan-100 font-mono bg-black/60 p-2.5 rounded-lg border border-cyan-500/20 break-words whitespace-pre-wrap">
                        {item.content}
                      </p>
                      <div className="flex justify-end gap-2">
                        {item.content.startsWith("http") && (
                          <a
                            href={item.content}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2.5 py-1 rounded bg-cyan-500/20 border border-cyan-400/30 text-cyan-300 text-[10px] font-mono flex items-center gap-1 hover:bg-cyan-500/40"
                          >
                            <ExternalLink className="w-3 h-3" /> Open Link
                          </a>
                        )}
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(item.content);
                            alert("Copied to clipboard!");
                          }}
                          className="px-2.5 py-1 rounded bg-cyan-500/20 border border-cyan-400/30 text-cyan-300 text-[10px] font-mono flex items-center gap-1 hover:bg-cyan-500/40"
                        >
                          <Copy className="w-3 h-3" /> Copy
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-cyan-500/20 bg-cyan-950/10 flex items-center justify-between text-[11px] font-mono text-cyan-400/60">
          <span>STARK TELEPORT PROTOCOL ACTIVE</span>
          {activePayload && <span>CURRENT BEAM: {activePayload.title}</span>}
        </div>
      </div>
    </motion.div>
  );
}
