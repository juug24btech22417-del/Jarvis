"use client";

// ConnectedPanel — shows composio connected apps + a "Test fire" button.
//
// This is the user-facing surface for the composio integration. Three app
// cards (Gmail, GCal, GitHub) and one big "Send test event" button.
//
// We use the same onClose pattern as TelegramPanel so the page.tsx wrapper
// can mount/unmount it without modification.

import { useEffect, useState, useRef, useLayoutEffect } from "react";
import { motion } from "framer-motion";
import {
  X,
  Plug,
  Check,
  AlertCircle,
  Send,
  Mail,
  Calendar,
  GitBranch,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { animatePanelOpen } from "@/lib/animations/gsap";

interface Connection {
  id: string;
  toolkitSlug: string;
  connectedAccountId: string;
  status: string;
  connectedAt: string;
}

interface ConnectionsResponse {
  ok: boolean;
  configured: boolean;
  userId: string;
  connections: Connection[];
}

interface UsageResponse {
  ok: boolean;
  today: number;
  month: number;
  freeTierMonthly: number;
  monthPercent: number;
}

const APPS: { slug: string; label: string; Icon: LucideIcon; phase2?: boolean }[] = [
  { slug: "gmail", label: "Gmail", Icon: Mail },
  { slug: "googlecalendar", label: "Google Calendar", Icon: Calendar },
  { slug: "github", label: "GitHub", Icon: GitBranch, phase2: true },
];

export default function ConnectedPanel({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [userId, setUserId] = useState<string>("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [firing, setFiring] = useState(false);
  const [lastResult, setLastResult] = useState<string>("");

  useLayoutEffect(() => {
    if (panelRef.current) {
      animatePanelOpen(panelRef.current, "right");
    }
  }, []);

  const refresh = async () => {
    setLoading(true);
    try {
      const [c, u] = await Promise.all([
        fetch("/api/composio/connections").then((r) => r.json() as Promise<ConnectionsResponse>),
        fetch("/api/composio/usage").then((r) => r.json() as Promise<UsageResponse>),
      ]);
      setConfigured(c.configured);
      setUserId(c.userId);
      setConnections(c.connections);
      setUsage(u.ok ? u : null);
    } catch (e) {
      setLastResult(
        `Failed to load: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const fireTest = async (source: string) => {
    setFiring(true);
    setLastResult("");
    try {
      const res = await fetch("/api/composio/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      const data = (await res.json()) as { ok: boolean; event?: { title: string }; reason?: string };
      if (data.ok) {
        setLastResult(`✓ Sent "${data.event?.title}" — check Telegram + desktop notification.`);
        void refresh();
      } else {
        setLastResult(`✗ ${data.reason ?? "unknown error"}`);
      }
    } catch (e) {
      setLastResult(
        `✗ ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setFiring(false);
    }
  };

  const statusFor = (slug: string) => {
    return connections.find((c) => c.toolkitSlug === slug)?.status ?? null;
  };

  const startConnect = async (toolkit: string) => {
    setLastResult("");
    try {
      const res = await fetch("/api/composio/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolkit }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        redirectUrl?: string;
        error?: string;
      };
      if (!data.ok || !data.redirectUrl) {
        setLastResult(`✗ ${data.error ?? "no redirectUrl returned"}`);
        return;
      }
      // Listen for the popup to post us a success message.
      const onMessage = (ev: MessageEvent) => {
        if (
          ev.data &&
          typeof ev.data === "object" &&
          (ev.data as { type?: string }).type === "composio:connected"
        ) {
          window.removeEventListener("message", onMessage);
          setLastResult(`✓ ${toolkit} connected. Subscribing to triggers...`);
          void refresh();
        }
      };
      window.addEventListener("message", onMessage);

      const popup = window.open(
        data.redirectUrl,
        "composio-oauth",
        "width=520,height=720"
      );
      if (!popup) {
        window.removeEventListener("message", onMessage);
        setLastResult(
          "✗ Popup blocked. Allow popups for localhost:3000 and try again."
        );
        return;
      }

      // Poll connections in case the popup got blocked from posting back.
      const poll = setInterval(() => {
        void refresh();
        if (popup.closed) {
          clearInterval(poll);
          window.removeEventListener("message", onMessage);
        }
      }, 2_000);
    } catch (e) {
      setLastResult(
        `✗ ${e instanceof Error ? e.message : String(e)}`
      );
    }
  };

  return (
    <motion.div
      ref={panelRef}
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className="fixed right-0 top-0 h-full w-[420px] z-40 bg-black/85 backdrop-blur-xl border-l border-cyan-500/30 text-cyan-100 p-5 overflow-y-auto"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Plug size={18} className="text-cyan-400" />
          <h2 className="text-lg font-semibold tracking-wide">Connected Apps</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-cyan-500/20 transition"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>

      {!configured && (
        <div className="mb-4 p-3 rounded border border-yellow-500/40 bg-yellow-500/10 text-yellow-200 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle size={14} /> COMPOSIO_API_KEY missing
          </div>
          <div className="mt-1 opacity-80">
            Add it to <code>jarvis/.env.local</code> and restart the listener
            process. The test-fire button still works without it.
          </div>
        </div>
      )}

      <div className="text-xs text-cyan-300/60 mb-3">
        Listener user: <code className="text-cyan-300">{userId || "—"}</code>
      </div>

      <div className="space-y-2 mb-6">
        {APPS.map(({ slug, label, Icon, phase2 }) => {
          const status = statusFor(slug);
          const connected = status === "ACTIVE";
          return (
            <div
              key={slug}
              className={`p-3 rounded border ${
                connected
                  ? "border-green-500/40 bg-green-500/5"
                  : "border-cyan-500/20 bg-cyan-500/5"
              } flex items-center justify-between`}
            >
              <div className="flex items-center gap-3">
                <Icon size={18} />
                <div>
                  <div className="text-sm font-medium">
                    {label}
                    {phase2 && (
                      <span className="ml-2 text-[10px] text-yellow-300/80">phase 2</span>
                    )}
                  </div>
                  <div className="text-[11px] text-cyan-300/60">
                    {phase2
                      ? "needs per-repo config"
                      : connected
                      ? "Connected"
                      : status ?? "Not connected"}
                  </div>
                </div>
              </div>
              {connected ? (
                <Check size={16} className="text-green-400" />
              ) : phase2 ? (
                <span className="text-[10px] text-cyan-300/40">soon</span>
              ) : (
                <button
                  className="text-[11px] px-2 py-1 rounded border border-cyan-500/40 hover:bg-cyan-500/20"
                  onClick={() => startConnect(slug)}
                >
                  Connect
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="mb-6">
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Zap size={14} className="text-yellow-400" /> Test fire
        </h3>
        <p className="text-[11px] text-cyan-300/60 mb-2">
          Send a synthetic event through the full pipeline. Check your Telegram
          bot + desktop system notification. No composio connection needed.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            disabled={firing}
            onClick={() => fireTest("test")}
            className="text-xs py-2 rounded border border-cyan-500/40 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {firing ? "…" : "Generic test"}
          </button>
          {APPS.map(({ slug, label }) => (
            <button
              key={slug}
              disabled={firing}
              onClick={() => fireTest(slug)}
              className="text-xs py-2 rounded border border-cyan-500/40 hover:bg-cyan-500/20 disabled:opacity-50"
            >
              {firing ? "…" : `${label.split(" ")[0]} sample`}
            </button>
          ))}
        </div>
        {lastResult && (
          <div className="mt-2 text-[11px] text-cyan-200/80 break-words">
            {lastResult}
          </div>
        )}
      </div>

      {usage && (
        <div className="text-[11px] text-cyan-300/60 border-t border-cyan-500/20 pt-3">
          <div className="flex justify-between">
            <span>Today</span>
            <span className="text-cyan-200">{usage.today}</span>
          </div>
          <div className="flex justify-between">
            <span>This month</span>
            <span className="text-cyan-200">
              {usage.month} / {usage.freeTierMonthly} ({usage.monthPercent}%)
            </span>
          </div>
          <div className="mt-1 h-1 bg-cyan-500/10 rounded overflow-hidden">
            <div
              className="h-full bg-cyan-400/70"
              style={{ width: `${Math.min(usage.monthPercent, 100)}%` }}
            />
          </div>
        </div>
      )}

      {loading && (
        <div className="text-[11px] text-cyan-300/40 mt-3">Loading…</div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={refresh}
          className="text-[11px] px-2 py-1 rounded border border-cyan-500/30 hover:bg-cyan-500/20 flex items-center gap-1"
        >
          <Send size={12} /> Refresh
        </button>
      </div>
    </motion.div>
  );
}
