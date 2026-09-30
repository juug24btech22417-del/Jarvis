"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Inbox,
  Smartphone,
  Mail,
  Send,
  Copy,
  Check,
  Trash2,
  ExternalLink,
  RefreshCw,
  ArrowLeft,
  Clock,
  Sparkles,
  Zap,
  Radio,
  Share2,
} from "lucide-react";

interface BeamItem {
  id: string;
  type: "text" | "url" | "note" | "code" | "clipboard" | "image";
  title: string;
  content: string;
  createdAt: number;
  source: "pc" | "phone";
}

interface EmailItem {
  messageId: string;
  threadId: string | null;
  from: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  date: string | null;
  link: string | null;
  isUnread: boolean;
}

export default function InboxPage() {
  const [tab, setTab] = useState<"beams" | "emails" | "send">("beams");
  const [beams, setBeams] = useState<BeamItem[]>([]);
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sendContent, setSendContent] = useState("");
  const [sendTitle, setSendTitle] = useState("");
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);

  const fetchInbox = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox");
      const data = await res.json();
      if (data?.success) {
        setBeams(data.teleportInbox || []);
        setEmails(data.emails || []);
      }
    } catch (e) {
      console.error("Failed to fetch inbox:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInbox();
    const interval = setInterval(fetchInbox, 5000);
    return () => clearInterval(interval);
  }, [fetchInbox]);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleClearBeams = async () => {
    try {
      await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      setBeams([]);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteBeam = async (id: string) => {
    try {
      await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      setBeams((prev) => prev.filter((b) => b.id !== id));
    } catch (e) {
      console.error(e);
    }
  };

  const handleSendBeam = async () => {
    if (!sendContent.trim() || sending) return;
    setSending(true);
    try {
      const isUrl = sendContent.trim().startsWith("http");
      const res = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "beam",
          item: {
            title: sendTitle.trim() || (isUrl ? "Web Link" : "Quick Note"),
            content: sendContent.trim(),
            type: isUrl ? "url" : "text",
            source: "pc",
          },
        }),
      });
      if (res.ok) {
        setSendContent("");
        setSendTitle("");
        setSendSuccess(true);
        fetchInbox();
        setTimeout(() => setSendSuccess(false), 3000);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-[#020813] text-cyan-50 font-sans flex flex-col"
      style={{
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'SF Pro Display', Inter, sans-serif",
      }}
    >
      {/* Top Header */}
      <header className="sticky top-0 z-30 px-4 py-3.5 bg-[#020813]/90 backdrop-blur-xl border-b border-cyan-500/15 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="w-8 h-8 rounded-full bg-cyan-500/10 border border-cyan-400/20 flex items-center justify-center text-cyan-300 hover:text-white transition-colors"
            title="Return to JARVIS Console"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/10 border border-cyan-400/30 flex items-center justify-center">
              <Inbox className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight text-white flex items-center gap-1.5">
                JARVIS INBOX
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              </h1>
              <p className="text-[10px] text-cyan-400/60 font-mono tracking-wider">
                UNIFIED RELAY STREAM
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchInbox}
            disabled={loading}
            className="p-2 rounded-xl bg-white/5 border border-white/10 text-cyan-300 hover:text-white transition-colors active:scale-95"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <Link
            href="/teleport"
            className="px-3 py-1.5 rounded-xl bg-cyan-500/20 border border-cyan-400/30 text-cyan-300 text-xs font-medium flex items-center gap-1.5 hover:bg-cyan-500/30 transition-colors"
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Phone QR</span>
          </Link>
        </div>
      </header>

      {/* Segmented Control Tabs */}
      <div className="px-4 py-3 bg-[#020813]/60 backdrop-blur-md border-b border-white/5">
        <div className="max-w-md mx-auto grid grid-cols-3 gap-1 bg-black/40 p-1 rounded-xl border border-white/8">
          <button
            onClick={() => setTab("beams")}
            className={`py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
              tab === "beams"
                ? "bg-cyan-500 text-black font-semibold shadow-md shadow-cyan-500/20"
                : "text-white/60 hover:text-white"
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            Beams ({beams.length})
          </button>
          <button
            onClick={() => setTab("emails")}
            className={`py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
              tab === "emails"
                ? "bg-cyan-500 text-black font-semibold shadow-md shadow-cyan-500/20"
                : "text-white/60 hover:text-white"
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            Email ({emails.length})
          </button>
          <button
            onClick={() => setTab("send")}
            className={`py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
              tab === "send"
                ? "bg-cyan-500 text-black font-semibold shadow-md shadow-cyan-500/20"
                : "text-white/60 hover:text-white"
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            Send Beam
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 max-w-3xl w-full mx-auto p-4 space-y-4">
        {/* TAB 1: PHONE BEAMS */}
        {tab === "beams" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-mono uppercase tracking-wider text-cyan-400/70 flex items-center gap-1.5">
                <Radio className="w-3 h-3 text-cyan-400" />
                Live Inbound Beams
              </span>
              {beams.length > 0 && (
                <button
                  onClick={handleClearBeams}
                  className="text-xs text-rose-400 hover:text-rose-300 font-mono flex items-center gap-1 transition-colors"
                >
                  <Trash2 className="w-3 h-3" /> Clear All
                </button>
              )}
            </div>

            {beams.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-cyan-500/20 bg-black/30 p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-cyan-500/10 border border-cyan-400/20 mx-auto flex items-center justify-center text-cyan-400">
                  <Smartphone className="w-6 h-6 opacity-60" />
                </div>
                <h3 className="text-sm font-semibold text-white">No Inbound Beams Yet</h3>
                <p className="text-xs text-white/50 max-w-sm mx-auto leading-relaxed">
                  Beam links, text, or photos directly from your phone by opening{" "}
                  <Link href="/teleport" className="text-cyan-400 underline">
                    /teleport
                  </Link>{" "}
                  on your mobile device.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {beams.map((b) => {
                  const isUrl = b.content.startsWith("http");
                  return (
                    <div
                      key={b.id}
                      className="rounded-2xl border border-cyan-500/20 bg-[#061224]/80 backdrop-blur-md p-4 space-y-2.5 hover:border-cyan-400/40 transition-all shadow-lg shadow-black/40"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium uppercase tracking-wider bg-cyan-500/15 text-cyan-300 border border-cyan-400/20">
                            {b.type}
                          </span>
                          <span className="text-xs font-semibold text-white">
                            {b.title || "Phone Beam"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-white/40 text-[11px] font-mono">
                          <Clock className="w-3 h-3" />
                          {new Date(b.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-black/60 border border-white/5 font-mono text-xs text-cyan-200/90 break-words select-all whitespace-pre-wrap max-h-48 overflow-y-auto">
                        {b.content}
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-1">
                        {isUrl && (
                          <a
                            href={b.content}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2.5 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-400/25 text-xs text-cyan-300 flex items-center gap-1 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Open Link
                          </a>
                        )}
                        <button
                          onClick={() => handleCopy(b.id, b.content)}
                          className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-white/80 flex items-center gap-1 transition-colors"
                        >
                          {copiedId === b.id ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              Copy
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => handleDeleteBeam(b.id)}
                          className="p-1 rounded-lg text-white/30 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: EMAILS */}
        {tab === "emails" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-mono uppercase tracking-wider text-cyan-400/70 flex items-center gap-1.5">
                <Mail className="w-3 h-3 text-cyan-400" />
                Gmail Messages & Briefings
              </span>
              <span className="text-xs font-mono text-white/40">
                {emails.length} Messages
              </span>
            </div>

            {emails.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-cyan-500/20 bg-black/30 p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-cyan-500/10 border border-cyan-400/20 mx-auto flex items-center justify-center text-cyan-400">
                  <Mail className="w-6 h-6 opacity-60" />
                </div>
                <h3 className="text-sm font-semibold text-white">No Emails Cached</h3>
                <p className="text-xs text-white/50 max-w-sm mx-auto leading-relaxed">
                  Connect Gmail via Composio in Connected Apps or request a briefing from
                  JARVIS voice (&quot;Check my emails&quot;).
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {emails.map((m) => (
                  <div
                    key={m.messageId}
                    className={`rounded-2xl border p-4 space-y-2 transition-all ${
                      m.isUnread
                        ? "bg-[#07172e] border-cyan-400/40 shadow-md shadow-cyan-950/50"
                        : "bg-black/40 border-white/8 hover:border-white/15"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {m.isUnread && (
                          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                        )}
                        <span className="text-xs font-semibold text-white">
                          {m.from || m.fromEmail}
                        </span>
                      </div>
                      <span className="text-[10px] text-white/40 font-mono">
                        {m.date ? new Date(m.date).toLocaleDateString() : ""}
                      </span>
                    </div>
                    <div className="text-xs font-medium text-cyan-200">
                      {m.subject || "(No Subject)"}
                    </div>
                    <p className="text-xs text-white/60 line-clamp-2 leading-relaxed">
                      {m.snippet}
                    </p>
                    {m.link && (
                      <div className="pt-1 flex justify-end">
                        <a
                          href={m.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" /> View in Gmail
                        </a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: SEND BEAM */}
        {tab === "send" && (
          <div className="rounded-2xl border border-cyan-500/20 bg-[#061224]/80 backdrop-blur-md p-5 space-y-4 shadow-xl">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-semibold text-white">
                Dispatch Beam to JARVIS & Connected Devices
              </h2>
            </div>
            <p className="text-xs text-white/50">
              Type or paste notes, URLs, or commands. They will be stored in your active
              inbox stream immediately.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-mono text-cyan-400/80 mb-1">
                  TITLE (OPTIONAL)
                </label>
                <input
                  type="text"
                  value={sendTitle}
                  onChange={(e) => setSendTitle(e.target.value)}
                  placeholder="e.g. Research Link, Meeting Notes..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black/60 border border-cyan-500/30 text-xs text-white placeholder-white/20 focus:outline-none focus:border-cyan-400 font-sans"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-cyan-400/80 mb-1">
                  CONTENT OR URL
                </label>
                <textarea
                  rows={4}
                  value={sendContent}
                  onChange={(e) => setSendContent(e.target.value)}
                  placeholder="Paste URL, markdown text, code snippet, or prompt..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black/60 border border-cyan-500/30 text-xs text-white placeholder-white/20 focus:outline-none focus:border-cyan-400 font-mono"
                />
              </div>

              {sendSuccess && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-400/30 text-emerald-300 text-xs flex items-center gap-2">
                  <Check className="w-4 h-4" /> Beam dispatched to JARVIS Inbox!
                </div>
              )}

              <button
                onClick={handleSendBeam}
                disabled={!sendContent.trim() || sending}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-black font-semibold text-xs flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-all shadow-lg shadow-cyan-500/20"
              >
                <Send className="w-3.5 h-3.5" />
                {sending ? "Sending..." : "Dispatch Beam"}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
