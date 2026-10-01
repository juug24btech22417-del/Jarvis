"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Radio,
  Smartphone,
  Laptop,
  Router,
  Tv,
  Speaker,
  Watch,
  Gamepad2,
  Cpu,
  HelpCircle,
  Star,
  Pencil,
  Check,
  RefreshCw,
  LocateFixed,
} from "lucide-react";
import { useJarvisVoice } from "@/hooks/useVoice";

type DeviceClass =
  | "phone" | "tablet" | "computer" | "router" | "tv" | "speaker"
  | "console" | "iot" | "wearable" | "unknown";
type ProximityZone = "immediate" | "room" | "perimeter" | "away";
type Reachability = "active" | "idle" | "offline";

interface ProximityDevice {
  id: string;
  ip: string;
  mac: string | null;
  macHex: string | null;
  macRandomized: boolean;
  vendor: string | null;
  hostname: string | null;
  autoName: string;
  label: string | null;
  name: string;
  deviceClass: DeviceClass;
  classConfidence: number;
  isUserDevice: boolean;
  favorite: boolean;
  reachability: Reachability;
  latencyMs: number | null;
  rssi: number | null;
  distanceMeters: number | null;
  rttMs: number | null;
  beaconModel: string | null;
  viaBeacon: boolean;
  signalStrength: number | null;
  proximityZone: ProximityZone;
  openPorts: number[];
  firstSeen: number;
  lastSeen: number;
}

interface ProximityEvent {
  id: string;
  type: "joined" | "left" | "returned" | "identity" | "presence";
  at: number;
  name: string;
  ip: string;
  message: string;
}

interface ScanMeta {
  subnet: string;
  localIp: string;
  hostsSwept: number;
  activeCount: number;
  durationMs: number;
  at: number;
  degraded: boolean;
  degradedReason?: string;
}

interface RemoteStatus {
  url: string;
  phoneConnected: boolean;
  lastPhonePollMs: number | null;
  beaconCount: number;
  ringing: boolean;
}

interface ProximityConfig {
  autoWelcome: boolean;
  autoLockOnLeave: boolean;
  beaconMac?: string;
  beaconIp?: string;
  leaveGraceSeconds?: number;
  welcomeApps?: string[];
}

interface ProximityScan {
  success: boolean;
  meta: ScanMeta;
  devices: ProximityDevice[];
  userDevice: ProximityDevice | null;
  events: ProximityEvent[];
  config: ProximityConfig;
  announcement: string | null;
  /** Live state of the phone remote, or null when the broker is down. */
  remote?: RemoteStatus | null;
  /** Launchable apps for the welcome scene. */
  apps?: Array<{ id: string; label: string }>;
  presence?: { state: "home" | "away" | "unknown"; lastPresentAt: number; lastActionAt: number };
}

const DEVICE_ICON: Record<DeviceClass, typeof Smartphone> = {
  phone: Smartphone,
  tablet: Smartphone,
  computer: Laptop,
  router: Router,
  tv: Tv,
  speaker: Speaker,
  console: Gamepad2,
  iot: Cpu,
  wearable: Watch,
  unknown: HelpCircle,
};

/** Plain-language presence bands — no jargon, no fake precision. */
const ZONE: Record<ProximityZone, { label: string; color: string }> = {
  immediate: { label: "Right here", color: "#30d158" },
  room: { label: "In the room", color: "#0a84ff" },
  perimeter: { label: "Nearby", color: "#ff9f0a" },
  away: { label: "Not nearby", color: "#8e8e93" },
};

const CLASS_LABEL: Record<DeviceClass, string> = {
  phone: "Phone",
  tablet: "Tablet",
  computer: "Computer",
  router: "Router",
  tv: "TV",
  speaker: "Speaker",
  console: "Console",
  iot: "Smart device",
  wearable: "Wearable",
  unknown: "Device",
};

const ACCENT = "#0a84ff";
const GREEN = "#30d158";
const spring = { type: "spring" as const, stiffness: 480, damping: 40, mass: 0.7 };

const SYSTEM_FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif';

function hashAngle(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 360) * Math.PI) / 180;
}

function relTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export default function ProximityPanel({ onClose }: { onClose: () => void }) {
  const [scan, setScan] = useState<ProximityScan | null>(null);
  const [devices, setDevices] = useState<ProximityDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<"radar" | "devices" | "log">("radar");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [events, setEvents] = useState<ProximityEvent[]>([]);
  const [pinging, setPinging] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { speak } = useJarvisVoice();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** meta.at of the scan we were showing when a refresh was requested — lets us
   *  clear the spinner exactly when the fresh sweep lands, not on a timer. */
  const refreshingFromRef = useRef<number | null>(null);
  const lastMetaAtRef = useRef<number>(0);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const applyScan = useCallback((data: ProximityScan) => {
    setScan(data);
    setDevices(data.devices || []);
    if (data.events?.length) setEvents((prev) => [...data.events, ...prev].slice(0, 80));
    // The sweep runs in the background, so the spinner ends when the new scan
    // timestamp actually changes (not when the immediate cached reply lands).
    const at = data.meta?.at ?? 0;
    if (refreshingFromRef.current !== null && at !== refreshingFromRef.current) {
      refreshingFromRef.current = null;
      setRefreshing(false);
    }
    lastMetaAtRef.current = at;
  }, []);

  const fetchScan = useCallback(async () => {
    try {
      const res = await fetch("/api/proximity", { cache: "no-store" });
      const data = (await res.json()) as ProximityScan;
      if (data?.success) applyScan(data);
    } catch (e) {
      console.error("[Proximity] scan failed:", e);
    } finally {
      setLoading(false);
    }
  }, [applyScan]);

  const forceScan = useCallback(async () => {
    refreshingFromRef.current = lastMetaAtRef.current;
    setRefreshing(true);
    // Safety valve so the spinner can never stick if a sweep dies.
    setTimeout(() => {
      if (refreshingFromRef.current !== null) {
        refreshingFromRef.current = null;
        setRefreshing(false);
      }
    }, 30_000);
    try {
      const res = await fetch("/api/proximity?refresh=1", { cache: "no-store" });
      const data = (await res.json()) as ProximityScan;
      if (data?.success) applyScan(data);
    } catch (e) {
      console.error(e);
      refreshingFromRef.current = null;
      setRefreshing(false);
    }
  }, [applyScan]);

  useEffect(() => {
    fetchScan();
    const interval = setInterval(fetchScan, 5000);
    return () => clearInterval(interval);
  }, [fetchScan]);  // Mutations apply locally first so a tap never waits on the network, then
  // reconcile with the server (which patches its cached scan).
  const patchLocal = useCallback((id: string, patch: Partial<ProximityDevice>) => {
    setDevices((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, []);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        const res = await fetch("/api/proximity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as Record<string, unknown> & { success?: boolean };
        void fetchScan(); // reconcile in the background; do not block the tap
        return data;
      } catch (e) {
        console.error("[Proximity] action failed:", e);
        return { success: false as const };
      }
    },
    [fetchScan]
  );

  const handleRename = useCallback(
    (id: string) => {
      const label = draftLabel.trim();
      patchLocal(id, { label: label || null, name: label || undefined } as Partial<ProximityDevice>);
      setEditingId(null);
      setDraftLabel("");
      void post({ action: "set-label", id, label });
    },
    [draftLabel, patchLocal, post]
  );

  const handleFavorite = useCallback(
    (id: string) => {
      const current = devices.find((d) => d.id === id);
      patchLocal(id, { favorite: !current?.favorite });
      void post({ action: "favorite", id });
    },
    [devices, patchLocal, post]
  );

  const handleSetBeacon = useCallback(
    (d: ProximityDevice) => {
      setDevices((prev) => prev.map((x) => ({ ...x, isUserDevice: x.id === d.id })));
      void post({ action: "set-beacon", id: d.macHex ?? d.id, kind: d.macHex ? "mac" : "ip" });
    },
    [post]
  );

  const handleConfig = useCallback(
    (patch: Record<string, unknown>) => {
      setScan((prev) =>
        prev ? { ...prev, config: { ...prev.config, ...patch } as ProximityScan["config"] } : prev
      );
      void post({ action: "config", config: patch });
    },
    [post]
  );

  const handlePingPhone = useCallback(async () => {
    setPinging(true);
    const res = (await post({ action: "ping-phone" })) as {
      success?: boolean;
      ringing?: boolean;
      phoneConnected?: boolean;
      message?: string;
    };
    setPinging(false);
    const sent = !!res?.success && !!res.ringing;
    const connected = !!res?.phoneConnected;
    const msg = !sent
      ? "Couldn't reach the phone remote. Open the QR remote page on your phone first."
      : connected
        ? "Ringing your phone now."
        : "Ping sent, but no phone is connected to the remote — open the remote URL on it.";
    flash(msg);
    if (sent && connected) speak(msg);
  }, [flash, post, speak]);

  const selected = useMemo(
    () => devices.find((d) => d.id === selectedId) ?? null,
    [devices, selectedId]
  );
  const focus = selected ?? scan?.userDevice ?? devices[0] ?? null;
  const beacon = useMemo(() => devices.find((d) => d.viaBeacon) ?? null, [devices]);
  const ranging = useMemo(() => devices.some((d) => d.distanceMeters != null), [devices]);
  const meta = scan?.meta;

  /* ── Radar canvas ── */
  useEffect(() => {
    if (tab !== "radar") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = canvas.clientWidth || 320;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    let raf = 0;
    let angle = 0;
    const MAX_METERS = 15;

    const draw = () => {
      const cx = size / 2;
      const cy = size / 2;
      const maxR = Math.min(cx, cy) - 26;
      ctx.clearRect(0, 0, size, size);

      // Concentric rings — hairline, no colour wash.
      const ratios = ranging ? [0.25, 0.5, 0.75, 1] : [0.34, 0.67, 1];
      ratios.forEach((ratio, i) => {
        ctx.beginPath();
        ctx.arc(cx, cy, maxR * ratio, 0, Math.PI * 2);
        ctx.strokeStyle = i === ratios.length - 1 ? "rgba(235,235,245,0.16)" : "rgba(235,235,245,0.08)";
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      // Distance ticks (only when we actually have metres).
      if (ranging) {
        ctx.font = `10px ${SYSTEM_FONT}`;
        ctx.fillStyle = "rgba(235,235,245,0.34)";
        ctx.textAlign = "left";
        [0.25, 0.5, 0.75, 1].forEach((ratio) => {
          ctx.fillText(`${Math.round(MAX_METERS * ratio)} m`, cx + 6, cy - maxR * ratio + 3);
        });
      }

      // Sweep sector + leading edge.
      angle += 0.02;
      if (angle >= Math.PI * 2) angle = 0;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, maxR, angle - Math.PI / 3.4, angle, false);
      ctx.closePath();
      const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, maxR);
      grad.addColorStop(0, "rgba(10,132,255,0.16)");
      grad.addColorStop(1, "rgba(10,132,255,0.01)");
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR);
      ctx.strokeStyle = "rgba(10,132,255,0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Blips.
      devices.forEach((d) => {
        const a = hashAngle(d.id);
        const ratio =
          d.distanceMeters != null
            ? Math.min(d.distanceMeters / MAX_METERS, 1)
            : d.reachability === "active"
              ? 0.5
              : 0.78;
        const bx = cx + Math.cos(a) * ratio * maxR;
        const by = cy + Math.sin(a) * ratio * maxR;
        const diff = Math.abs(angle - a);
        const lit = diff < 0.35 || diff > Math.PI * 2 - 0.35;
        const isFocus = d.id === focus?.id;
        const color = d.isUserDevice ? GREEN : isFocus ? "#ffffff" : ACCENT;

        if (lit || isFocus) {
          ctx.beginPath();
          ctx.arc(bx, by, isFocus ? 12 : 9, 0, Math.PI * 2);
          ctx.fillStyle = d.isUserDevice ? "rgba(48,209,88,0.18)" : "rgba(10,132,255,0.16)";
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(bx, by, d.isUserDevice ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        if (isFocus) {
          ctx.font = `500 11px ${SYSTEM_FONT}`;
          ctx.fillStyle = "rgba(235,235,245,0.92)";
          ctx.textAlign = "center";
          const label = d.name.length > 20 ? `${d.name.slice(0, 19)}…` : d.name;
          ctx.fillText(label, bx, by - 12);
        }
      });

      // Centre.
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(235,235,245,0.85)";
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [tab, devices, focus?.id, ranging]);

  const selectedZone = ZONE[(focus?.proximityZone as ProximityZone) ?? "away"];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-md"
      style={{ fontFamily: SYSTEM_FONT }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.98, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.99, y: 8 }}
        transition={spring}
        className="w-full max-w-[880px] max-h-[92vh] flex flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#1c1c1e] shadow-[0_30px_80px_rgba(0,0,0,0.65)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 px-7 pt-6 pb-5">
          <div className="min-w-0">
            <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-white">Nearby</h2>
            <p className="mt-0.5 text-[13px] text-white/45 truncate">
              {meta
                ? `${meta.subnet} · ${devices.length} devices · ${meta.activeCount} responding`
                : "Scanning your network…"}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={forceScan}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3.5 py-2 text-[13px] text-white/80 transition hover:bg-white/[0.12] active:scale-95 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Scanning" : "Scan again"}
            </button>
            <button
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-full bg-white/[0.07] text-white/60 transition hover:bg-white/[0.14] hover:text-white active:scale-95"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Segmented control ── */}
        <div className="px-7 pb-5">
          <div className="flex w-full gap-1 rounded-[11px] bg-white/[0.06] p-1">
            {(["radar", "devices", "log"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`relative flex-1 rounded-[8px] py-1.5 text-[13px] font-medium transition-colors ${
                  tab === t ? "text-white" : "text-white/55 hover:text-white/80"
                }`}
              >
                {tab === t && (
                  <motion.span
                    layoutId="prox-seg"
                    transition={spring}
                    className="absolute inset-0 rounded-[8px] bg-white/[0.14]"
                  />
                )}
                <span className="relative z-10">
                  {t === "radar" ? "Radar" : t === "devices" ? "Devices" : "Activity"}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-7">
          {loading ? (
            <div className="py-24 text-center text-[13px] text-white/40">Scanning…</div>
          ) : (
            <AnimatePresence mode="wait">
              {tab === "radar" && (
                <motion.div
                  key="radar"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={spring}
                  className="flex flex-col gap-6 lg:flex-row lg:items-start"
                >
                  <div className="mx-auto w-[300px] shrink-0 sm:w-[340px]">
                    <div className="relative aspect-square">
                      <canvas ref={canvasRef} className="block h-full w-full" />
                      {!ranging && (
                        <p className="absolute inset-x-0 -bottom-1 text-center text-[11px] leading-relaxed text-white/30">
                          Distance needs a radio reading — circles show presence only
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1 space-y-3">
                    {/* Selected device */}
                    <div className="rounded-[18px] bg-white/[0.05] p-4">
                      {focus ? (
                        <>
                          <div className="flex items-center gap-3">
                            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-white/[0.07]">
                              {(() => {
                                const Icon = DEVICE_ICON[focus.deviceClass];
                                return <Icon className="h-5 w-5 text-white/80" />;
                              })()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[15px] font-medium text-white">
                                {focus.name}
                              </p>
                              <p className="truncate text-[12px] text-white/45">
                                {CLASS_LABEL[focus.deviceClass]}
                                {focus.vendor ? ` · ${focus.vendor}` : ""}
                              </p>
                            </div>
                            <span
                              className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium"
                              style={{
                                color: selectedZone.color,
                                background: `${selectedZone.color}1f`,
                              }}
                            >
                              {selectedZone.label}
                            </span>
                          </div>

                          <div className="mt-3.5 space-y-px border-t border-white/[0.07] pt-1">
                            <Detail k="IP address" v={focus.ip} />
                            <Detail
                              k="MAC address"
                              v={focus.mac ?? "Not available"}
                              note={focus.macRandomized ? "private" : undefined}
                            />
                            <Detail
                              k="Distance"
                              v={
                                focus.distanceMeters != null
                                  ? `${focus.distanceMeters} m`
                                  : "Not measured"
                              }
                            />
                            <Detail
                              k="Signal"
                              v={
                                focus.rssi != null
                                  ? `${focus.rssi} dBm · ${focus.signalStrength ?? "—"}%`
                                  : "No radio reading"
                              }
                            />
                            {focus.viaBeacon && (
                              <Detail
                                k="Beacon"
                                v={`${focus.beaconModel ?? "Phone"} · ${
                                  focus.rttMs != null ? `${focus.rttMs} ms` : "live"
                                }`}
                              />
                            )}
                            <Detail
                              k="Response"
                              v={focus.latencyMs != null ? `${focus.latencyMs} ms` : "No reply"}
                            />
                            <Detail k="Last seen" v={relTime(focus.lastSeen)} />
                          </div>
                        </>
                      ) : (
                        <p className="py-6 text-center text-[13px] text-white/40">
                          No devices found on this network.
                        </p>
                      )}
                    </div>

                    {/* Phone remote connection — without this, a silent phone
                        looks like a broken button. */}
                    <div className="flex items-center gap-2 px-1">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          background: !scan?.remote
                            ? "#8e8e93"
                            : scan.remote.phoneConnected
                              ? "#30d158"
                              : "#ff9f0a",
                        }}
                      />
                      <span className="min-w-0 truncate text-[12px] text-white/45">
                        {!scan?.remote
                          ? "Phone remote is offline"
                          : scan.remote.phoneConnected
                            ? "Phone remote connected"
                            : "No phone connected to the remote"}
                      </span>
                    </div>

                    {/* Actions */}
                    <button
                      onClick={handlePingPhone}
                      disabled={pinging}
                      className="flex w-full items-center justify-center gap-2 rounded-[16px] bg-[#0a84ff] py-3.5 text-[15px] font-medium text-white transition hover:bg-[#0a84ff]/90 active:scale-[0.99] disabled:opacity-60"
                    >
                      <LocateFixed className="h-4 w-4" />
                      {pinging ? "Ringing…" : "Find My Phone"}
                    </button>

                    {scan?.remote && !scan.remote.phoneConnected && (
                      <div className="rounded-[14px] bg-white/[0.05] px-4 py-3">
                        <p className="text-[12px] leading-relaxed text-white/55">
                          Your phone won&apos;t ring until one of these is open on it (same
                          Wi‑Fi), so keep the tab alive and tap once to allow sound:
                        </p>
                        <p className="mt-1.5 select-all break-all text-[12px] font-medium text-[#0a84ff]">
                          {scan.remote.url}
                        </p>
                        <p className="mt-0.5 select-all break-all text-[12px] font-medium text-[#0a84ff]">
                          {typeof window !== "undefined"
                            ? `${window.location.protocol}//${window.location.host}/teleport`
                            : "/teleport"}
                        </p>
                      </div>
                    )}

                    <div className="overflow-hidden rounded-[16px] bg-white/[0.05]">
                      <Switch
                        label="Welcome me back"
                        sub="Sound on and your apps up when your phone arrives"
                        checked={!!scan?.config.autoWelcome}
                        onChange={(v) => handleConfig({ autoWelcome: v })}
                      />
                      {scan?.config.autoWelcome && (scan.apps?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1.5 px-4 pb-3.5">
                          {(scan.apps ?? []).map((app) => {
                            const picked = (scan.config.welcomeApps ?? []).includes(app.id);
                            return (
                              <button
                                key={app.id}
                                onClick={() => {
                                  const current = scan.config.welcomeApps ?? [];
                                  const next = picked
                                    ? current.filter((x) => x !== app.id)
                                    : [...current, app.id];
                                  handleConfig({ welcomeApps: next });
                                }}
                                className={`rounded-full px-3 py-1.5 text-[12px] transition ${
                                  picked
                                    ? "bg-[#0a84ff] text-white"
                                    : "bg-white/[0.09] text-white/65 hover:bg-white/[0.15]"
                                }`}
                              >
                                {app.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <div className="h-px bg-white/[0.07] ml-4" />
                      <Switch
                        label="Lock when I walk away"
                        sub="Pause media, mute and lock the desk"
                        checked={!!scan?.config.autoLockOnLeave}
                        onChange={(v) => handleConfig({ autoLockOnLeave: v })}
                      />
                    </div>

                    <div className="flex items-center gap-2 px-1">
                      <span className="text-[12px] text-white/45">
                        {!scan?.presence || scan.presence.state === "unknown"
                          ? "Presence tracking on standby"
                          : scan.presence.state === "home"
                            ? `Home — since ${relTime(scan.presence.lastPresentAt)}`
                            : "Away"}
                      </span>
                    </div>

                    {beacon ? (
                      <p className="px-1 text-[12px] leading-relaxed text-white/40">
                        Phone beacon active — {beacon.beaconModel ?? "phone"} at {beacon.ip}.
                        {beacon.rssi == null
                          ? " Signal strength isn't shared by the browser, so distance stays hidden."
                          : ""}
                      </p>
                    ) : (
                      <p className="px-1 text-[12px] leading-relaxed text-white/40">
                        Open the QR remote on your phone and turn on{" "}
                        <span className="text-white/70">Presence beacon</span> so JARVIS can always
                        find it.
                      </p>
                    )}

                    <AnimatePresence>
                      {toast && (
                        <motion.div
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={spring}
                          className="rounded-[14px] bg-white/[0.08] px-4 py-3 text-[13px] text-white/80"
                        >
                          {toast}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}

              {tab === "devices" && (
                <motion.div
                  key="devices"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={spring}
                >
                  {devices.length === 0 ? (
                    <p className="py-20 text-center text-[13px] text-white/40">
                      No devices answered the scan.
                    </p>
                  ) : (
                    <div className="overflow-hidden rounded-[18px] bg-white/[0.05]">
                      {devices.map((d, i) => {
                        const Icon = DEVICE_ICON[d.deviceClass];
                        const z = ZONE[d.proximityZone];
                        const active = selectedId === d.id;
                        return (
                          <div key={d.id}>
                            {i > 0 && <div className="ml-[68px] h-px bg-white/[0.07]" />}
                            <div
                              onClick={() => {
                                setSelectedId(d.id);
                                setTab("radar");
                              }}
                              className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition ${
                                active ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"
                              }`}
                            >
                              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-white/[0.07]">
                                <Icon className="h-[18px] w-[18px] text-white/75" />
                              </div>

                              <div className="min-w-0 flex-1">
                                {editingId === d.id ? (
                                  <div className="flex items-center gap-2">
                                    <input
                                      autoFocus
                                      value={draftLabel}
                                      onChange={(e) => setDraftLabel(e.target.value)}
                                      onKeyDown={(e) => e.key === "Enter" && handleRename(d.id)}
                                      placeholder={d.autoName}
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-40 rounded-lg border border-white/15 bg-black/40 px-2 py-1 text-[13px] text-white outline-none focus:border-[#0a84ff]"
                                    />
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRename(d.id);
                                      }}
                                      className="text-[#30d158]"
                                    >
                                      <Check className="h-4 w-4" />
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingId(null);
                                      }}
                                      className="text-white/40"
                                    >
                                      <X className="h-4 w-4" />
                                    </button>
                                  </div>
                                ) : (
                                  <p className="flex items-center gap-1.5 truncate text-[14px] font-medium text-white">
                                    {d.name}
                                    {d.isUserDevice && (
                                      <span className="rounded-full bg-[#30d158]/20 px-1.5 py-px text-[10px] font-semibold text-[#30d158]">
                                        ME
                                      </span>
                                    )}
                                    {d.favorite && (
                                      <Star className="h-3 w-3 fill-[#ff9f0a] text-[#ff9f0a]" />
                                    )}
                                  </p>
                                )}
                                <p className="truncate text-[12px] text-white/40">
                                  {CLASS_LABEL[d.deviceClass]} · {d.ip}
                                  {d.vendor ? ` · ${d.vendor}` : ""}
                                </p>
                              </div>

                              <span
                                className="hidden shrink-0 text-[11px] font-medium sm:block"
                                style={{ color: z.color }}
                              >
                                {d.distanceMeters != null ? `${d.distanceMeters} m` : z.label}
                              </span>

                              <div className="flex shrink-0 items-center gap-1">
                                <RowBtn
                                  title="Favourite"
                                  on={d.favorite}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleFavorite(d.id);
                                  }}
                                >
                                  <Star className="h-3.5 w-3.5" />
                                </RowBtn>
                                <RowBtn
                                  title="Rename"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingId(d.id);
                                    setDraftLabel(d.label ?? "");
                                  }}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </RowBtn>
                                <RowBtn
                                  title="This is my device"
                                  on={d.isUserDevice}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSetBeacon(d);
                                  }}
                                >
                                  <LocateFixed className="h-3.5 w-3.5" />
                                </RowBtn>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <p className="mt-4 px-1 text-[12px] leading-relaxed text-white/35">
                    Names come from each device&apos;s own hostname and MAC vendor. A private MAC
                    means the phone is hiding its identity — turn off “Randomised MAC” in Wi-Fi
                    settings to keep it recognisable.
                  </p>
                </motion.div>
              )}

              {tab === "log" && (
                <motion.div
                  key="log"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={spring}
                >
                  {events.length === 0 ? (
                    <p className="py-20 text-center text-[13px] text-white/40">
                      Watching for devices coming and going…
                    </p>
                  ) : (
                    <div className="overflow-hidden rounded-[18px] bg-white/[0.05]">
                      {events.map((ev, i) => (
                        <div key={ev.id}>
                          {i > 0 && <div className="ml-4 h-px bg-white/[0.07]" />}
                          <div className="flex items-center justify-between gap-3 px-4 py-3">
                            <span className="flex min-w-0 items-center gap-2.5">
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{
                                  background:
                                    ev.type === "left"
                                      ? "#ff453a"
                                      : ev.type === "joined" || ev.type === "presence"
                                        ? "#30d158"
                                        : ACCENT,
                                }}
                              />
                              <span className="truncate text-[13px] text-white/80">
                                {ev.message}
                              </span>
                            </span>
                            <span className="shrink-0 text-[12px] text-white/35">
                              {relTime(ev.at)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function Detail({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-[13px]">
      <span className="shrink-0 text-white/45">{k}</span>
      <span className="truncate text-right text-white/85">
        {v}
        {note && <span className="ml-1.5 text-white/35">({note})</span>}
      </span>
    </div>
  );
}

function Switch({
  label,
  sub,
  checked,
  onChange,
}: {
  label: string;
  sub?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="min-w-0">
        <span className="block text-[14px] text-white/85">{label}</span>
        {sub && <span className="mt-0.5 block text-[11.5px] leading-snug text-white/40">{sub}</span>}
      </span>
      <button
        onClick={() => onChange(!checked)}
        className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors ${
          checked ? "bg-[#30d158]" : "bg-white/[0.16]"
        }`}
        role="switch"
        aria-checked={checked}
      >
        <motion.span
          layout
          transition={spring}
          className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow ${
            checked ? "left-[23px]" : "left-[3px]"
          }`}
        />
      </button>
    </div>
  );
}

function RowBtn({
  children,
  title,
  on,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  on?: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-full transition active:scale-90 ${
        on ? "bg-[#ff9f0a]/20 text-[#ff9f0a]" : "text-white/40 hover:bg-white/[0.08] hover:text-white/80"
      }`}
    >
      {children}
    </button>
  );
}
