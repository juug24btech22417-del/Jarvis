"use client";

import { useEffect, useState, Suspense, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  Smartphone,
  Send,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  Zap,
  Camera,
  Scan,
  Plus,
  Trash2,
  Volume2,
  VolumeX,
  MessageSquare,
  Sparkles,
  Radio,
  Crosshair,
  Layers,
  Lock,
  Play,
  Pause,
  SkipForward,
  Volume1,
  Shield,
  Bell,
} from "lucide-react";

interface TeleportPayload {
  id: string;
  type: "text" | "url" | "note" | "code" | "clipboard" | "image";
  title: string;
  content: string;
  createdAt: number;
  source: "pc" | "phone" | "jarvis";
}

interface ChatBubble {
  id: string;
  role: "user" | "jarvis";
  text: string;
  timestamp: number;
}

interface RoomObject {
  id: string;
  name: string;
  category: string;
  quadrant: string;
  x: number;
  y: number;
  distanceEstimateCm: number;
  description?: string;
  lastTagged: number;
}

type TabType = "chat" | "beam" | "scanner" | "remote";

function TeleportContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const tabParam = searchParams.get("tab");

  const [tab, setTab] = useState<TabType>(
    tabParam === "scanner" ? "scanner" : tabParam === "beam" ? "beam" : tabParam === "remote" ? "remote" : "chat"
  );
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<TeleportPayload | null>(null);
  const [copied, setCopied] = useState(false);

  // Chat State
  const [chatMessages, setChatMessages] = useState<ChatBubble[]>([
    {
      id: "welcome",
      role: "jarvis",
      text: "Quantum mobile relay established, Boss. I'm standing by for your directives.",
      timestamp: Date.now(),
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatThinking, setChatThinking] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Room Scanner Camera State
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [snapshotImg, setSnapshotImg] = useState<string | null>(null);
  const [aiScanning, setAiScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Room Scanner Form State
  const [objects, setObjects] = useState<RoomObject[]>([]);
  const [newObjName, setNewObjName] = useState("");
  const [newObjDesc, setNewObjDesc] = useState("");
  const [newObjCategory, setNewObjCategory] = useState("electronics");
  const [selectedQuadrant, setSelectedQuadrant] = useState("mid-center");
  const [tagSending, setTagSending] = useState(false);
  const [tagSuccess, setTagSuccess] = useState<string | null>(null);
  const [scannerLoading, setScannerLoading] = useState(false);

  // Phone Sonar Ping Alert State
  const [sonarAlertActive, setSonarAlertActive] = useState(false);

  // Remote Control state
  const [remoteStatus, setRemoteStatus] = useState<string | null>(null);

  const QUADRANT_COORDS: Record<string, { x: number; y: number; label: string }> = {
    "top-left": { x: 0.18, y: 0.22, label: "Back Left" },
    "top-center": { x: 0.5, y: 0.22, label: "Back Center" },
    "top-right": { x: 0.82, y: 0.22, label: "Back Right" },
    "mid-left": { x: 0.18, y: 0.5, label: "Mid Left" },
    "mid-center": { x: 0.5, y: 0.5, label: "Center Desk" },
    "mid-right": { x: 0.82, y: 0.5, label: "Mid Right" },
    "bottom-left": { x: 0.18, y: 0.78, label: "Front Left" },
    "bottom-center": { x: 0.5, y: 0.78, label: "Front Center" },
    "bottom-right": { x: 0.82, y: 0.78, label: "Front Right" },
  };

  const CATEGORIES = ["electronics", "keys", "drink", "stationery", "wearable", "other"];
  const CAT_EMOJI: Record<string, string> = {
    electronics: "💻",
    keys: "🔑",
    drink: "☕",
    stationery: "✏️",
    wearable: "⌚",
    other: "📦",
  };

  // TTS helper
  const speakText = useCallback(
    (text: string) => {
      if (voiceMuted || typeof window === "undefined" || !("speechSynthesis" in window)) return;
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = 1.05;
        utter.pitch = 0.95;
        const voices = window.speechSynthesis.getVoices();
        const preferred = voices.find(
          (v) =>
            v.lang.startsWith("en") &&
            (v.name.includes("Male") || v.name.includes("UK") || v.name.includes("Daniel"))
        );
        if (preferred) utter.voice = preferred;
        window.speechSynthesis.speak(utter);
      } catch {}
    },
    [voiceMuted]
  );

  // Check Sonar Ping from PC — the PC can raise this from the radar or the
  // workstation remote, so announce once and keep pulsing until it clears.
  const sonarWasActive = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/teleport?pingCheck=1", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        const active = !!data?.phonePingActive;
        setSonarAlertActive(active);
        if (typeof navigator !== "undefined" && "vibrate" in navigator && active) {
          navigator.vibrate(sonarWasActive.current ? [300, 180, 300] : [500, 200, 500, 200, 700]);
        }
        if (active && !sonarWasActive.current) {
          speakText("Sonar ping received from Stark console! Location beacon active!");
        }
        sonarWasActive.current = active;
      } catch {}
    };
    tick();
    const timer = setInterval(tick, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [speakText]);

  // A real ring tone. Speech alone is silent on plenty of Android builds, and
  // "the phone doesn't make a sound" was the whole complaint.
  const sonarAudio = useRef<{
    ctx: AudioContext | null;
    timer: ReturnType<typeof setInterval> | null;
  }>({ ctx: null, timer: null });

  useEffect(() => {
    const unlock = () => {
      const st = sonarAudio.current;
      try {
        if (!st.ctx) {
          const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          st.ctx = new Ctor();
        }
        if (st.ctx.state === "suspended") void st.ctx.resume();
      } catch {
        /* audio unavailable — the overlay and vibration still fire */
      }
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    const st = sonarAudio.current;
    if (!sonarAlertActive) {
      if (st.timer) {
        clearInterval(st.timer);
        st.timer = null;
      }
      return;
    }
    const blip = (freq: number, dur: number) => {
      const ctx = st.ctx;
      if (!ctx || ctx.state === "suspended") return;
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(ctx.destination);
        const t = ctx.currentTime;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.start(t);
        osc.stop(t + dur + 0.03);
      } catch {
        /* ignore a transient audio failure */
      }
    };
    blip(1046, 0.3);
    window.setTimeout(() => blip(784, 0.3), 220);
    st.timer = setInterval(() => {
      blip(1046, 0.3);
      window.setTimeout(() => blip(784, 0.3), 220);
    }, 1150);
    return () => {
      if (st.timer) {
        clearInterval(st.timer);
        st.timer = null;
      }
    };
  }, [sonarAlertActive]);

  // Fetch PC Payload
  const BASE = id ? `/api/teleport?id=${id}` : "/api/teleport";
  const fetchPayload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(BASE);
      const data = await res.json();
      if (data?.success && data.payload) {
        setPayload(data.payload);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [BASE]);

  // Fetch Room Scanner Objects
  const fetchObjects = useCallback(async () => {
    setScannerLoading(true);
    try {
      const res = await fetch("/api/room-scanner");
      const data = await res.json();
      if (data?.success) setObjects(data.objects || []);
    } catch (e) {
      console.error(e);
    } finally {
      setScannerLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPayload();
  }, [fetchPayload]);

  useEffect(() => {
    if (tab === "scanner") {
      fetchObjects();
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [tab, fetchObjects]);

  // Scroll chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, chatThinking]);

  // Camera Management
  const startCamera = async () => {
    setCameraError(null);
    try {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setCameraError("Browser camera API restricted over HTTP. Use photo snap below.");
        setCameraActive(false);
        return;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraActive(true);
    } catch (err: any) {
      console.warn("[MobileScanner] Camera error:", err);
      setCameraError("Camera access restricted. Use instant photo snap button below.");
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  // AI Scan from phone photo
  const handleAiScanFromPhone = async (imgData?: string) => {
    const targetImg = imgData || snapshotImg;
    if (!targetImg) return;
    setAiScanning(true);
    try {
      const res = await fetch("/api/room-scanner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ai-scan", image: targetImg }),
      });
      const data = await res.json();
      if (data?.success) {
        setObjects(data.objects || []);
        setTagSuccess(`AI Scan locked ${data.detectedCount || data.objects?.length} objects to memory!`);
        if (data.announcement) speakText(data.announcement);
        setTimeout(() => setTagSuccess(null), 4000);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setAiScanning(false);
    }
  };

  // Capture photo snapshot from live video
  const takeSnapshot = () => {
    if (!videoRef.current) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        setSnapshotImg(dataUrl);
        handleAiScanFromPhone(dataUrl);
      }
    } catch (e) {
      console.warn("[MobileScanner] Snapshot error:", e);
    }
  };

  // Handle Photo File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setSnapshotImg(dataUrl);
      handleAiScanFromPhone(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  // Execute PC Remote Command
  const handleRemoteCommand = async (command: string, desc: string) => {
    setRemoteStatus(`Executing ${desc}...`);
    try {
      const res = await fetch("/api/teleport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "command", command }),
      });
      const data = await res.json();
      if (data?.success) {
        setRemoteStatus(`✓ ${desc} complete`);
        setTimeout(() => setRemoteStatus(null), 2500);
      }
    } catch {
      setRemoteStatus("Failed to send command");
      setTimeout(() => setRemoteStatus(null), 2500);
    }
  };

  // Two-Way Interactive Chat Send
  const handleSendChat = async (presetText?: string) => {
    const text = (presetText || chatInput).trim();
    if (!text || chatThinking) return;

    const userMsg: ChatBubble = {
      id: `u-${Date.now()}`,
      role: "user",
      text,
      timestamp: Date.now(),
    };

    setChatMessages((prev) => [...prev, userMsg]);
    if (!presetText) setChatInput("");
    setChatThinking(true);

    try {
      const res = await fetch("/api/teleport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat",
          type: text.startsWith("http") ? "url" : "text",
          title: "Phone Directive",
          content: text,
        }),
      });

      const data = await res.json();
      const reply = data?.reply || "Directive received and logged to Stark mainframe, Boss.";

      const jarvisMsg: ChatBubble = {
        id: `j-${Date.now()}`,
        role: "jarvis",
        text: reply,
        timestamp: Date.now(),
      };

      setChatMessages((prev) => [...prev, jarvisMsg]);
      speakText(reply);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "jarvis",
          text: "Relay disruption detected, Boss. Please verify your phone is on the same Wi-Fi as your PC.",
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setChatThinking(false);
    }
  };

  // Tag object manually to Room Scanner
  const handleTagObject = async () => {
    if (!newObjName.trim() || tagSending) return;
    setTagSending(true);
    try {
      const coords = QUADRANT_COORDS[selectedQuadrant] || { x: 0.5, y: 0.5 };
      const res = await fetch("/api/room-scanner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "tag",
          object: {
            name: newObjName.trim(),
            category: newObjCategory,
            description: newObjDesc.trim() || undefined,
            x: coords.x,
            y: coords.y,
          },
        }),
      });
      const data = await res.json();
      if (data?.success) {
        setTagSuccess(`"${newObjName}" stored at ${coords.label || data.object.quadrant}!`);
        setNewObjName("");
        setNewObjDesc("");
        setSnapshotImg(null);
        setObjects(data.objects || []);
        setTimeout(() => setTagSuccess(null), 3500);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setTagSending(false);
    }
  };

  const handleDeleteObject = async (objId: string) => {
    try {
      await fetch("/api/room-scanner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: objId }),
      });
      setObjects((o) => o.filter((obj) => obj.id !== objId));
    } catch (e) {
      console.error(e);
    }
  };

  const handleCopy = () => {
    if (!payload?.content) return;
    navigator.clipboard.writeText(payload.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="min-h-screen bg-[#020813] text-cyan-50 font-sans flex flex-col antialiased selection:bg-cyan-500 selection:text-black"
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* ── SONAR PING OVERLAY ALERT ── */}
      {sonarAlertActive && (
        <div className="fixed inset-0 z-50 bg-cyan-500/90 text-black flex flex-col items-center justify-center p-6 text-center animate-pulse">
          <Radio className="w-16 h-16 animate-spin mb-4" />
          <h2 className="text-xl font-bold font-mono tracking-widest">STARK SONAR LOCATOR ACTIVE!</h2>
          <p className="text-xs font-semibold mt-2">Console is tracking phone beacon position.</p>
          <button
            onClick={() => setSonarAlertActive(false)}
            className="mt-6 px-6 py-2.5 rounded-xl bg-black text-cyan-300 font-bold text-xs"
          >
            DISMISS ALERT
          </button>
        </div>
      )}

      {/* ── STARK HOLOGRAPHIC HEADER ── */}
      <header className="sticky top-0 z-30 px-4 py-3 bg-[#020813]/90 backdrop-blur-xl border-b border-cyan-500/25 flex items-center justify-between shadow-[0_4px_24px_rgba(0,212,255,0.15)]">
        <div className="flex items-center gap-2.5">
          <div className="relative w-8 h-8 rounded-full border border-cyan-400/50 flex items-center justify-center bg-cyan-950/40 shadow-[0_0_15px_rgba(0,243,255,0.4)]">
            <div className="w-4 h-4 rounded-full border border-cyan-300 animate-spin opacity-80" />
            <div className="absolute w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#00f3ff]" />
          </div>
          <div>
            <h1 className="text-xs font-bold tracking-[0.2em] text-cyan-300 font-mono flex items-center gap-1.5">
              J.A.R.V.I.S.
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </h1>
            <p className="text-[9px] text-cyan-400/60 font-mono tracking-wider">
              QUANTUM COMMAND RELAY
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {tab === "chat" && (
            <button
              onClick={() => setVoiceMuted(!voiceMuted)}
              className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-400/20 text-cyan-300 active:scale-95 transition-all"
              title={voiceMuted ? "Unmute Voice" : "Mute Voice"}
            >
              {voiceMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={() => {
              if (tab === "beam") fetchPayload();
              if (tab === "scanner") fetchObjects();
            }}
            className="p-2 rounded-xl bg-white/5 border border-white/10 text-cyan-300 hover:text-white active:scale-95 transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${loading || scannerLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      {/* ── HOLOGRAPHIC TABS ── */}
      <div className="px-3 py-2 bg-[#020813]/70 backdrop-blur-md border-b border-white/5 sticky top-[57px] z-20">
        <div className="grid grid-cols-4 gap-1 bg-black/50 p-1 rounded-xl border border-cyan-500/20">
          <button
            onClick={() => setTab("chat")}
            className={`py-2 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-all ${
              tab === "chat"
                ? "bg-cyan-500 text-black font-bold shadow-md shadow-cyan-500/30"
                : "text-white/60 hover:text-white"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Chat
          </button>
          <button
            onClick={() => setTab("beam")}
            className={`py-2 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-all ${
              tab === "beam"
                ? "bg-cyan-500 text-black font-bold shadow-md shadow-cyan-500/30"
                : "text-white/60 hover:text-white"
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            Beam
          </button>
          <button
            onClick={() => setTab("scanner")}
            className={`py-2 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-all ${
              tab === "scanner"
                ? "bg-cyan-500 text-black font-bold shadow-md shadow-cyan-500/30"
                : "text-white/60 hover:text-white"
            }`}
          >
            <Scan className="w-3.5 h-3.5" />
            Scan
          </button>
          <button
            onClick={() => setTab("remote")}
            className={`py-2 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-all ${
              tab === "remote"
                ? "bg-cyan-500 text-black font-bold shadow-md shadow-cyan-500/30"
                : "text-white/60 hover:text-white"
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            Remote
          </button>
        </div>
      </div>

      {/* ── TAB 1: TWO-WAY INTERACTIVE JARVIS AI CHAT ── */}
      {tab === "chat" && (
        <main className="flex-1 flex flex-col p-4 max-w-lg w-full mx-auto justify-between overflow-hidden">
          {/* Chat Stream */}
          <div
            ref={chatScrollRef}
            className="flex-1 overflow-y-auto space-y-3 pr-1 mb-3 no-scrollbar"
            style={{ maxHeight: "calc(100vh - 240px)" }}
          >
            {chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.role === "user" ? "items-end" : "items-start"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1 px-1">
                  <span
                    className={`font-mono text-[9px] uppercase tracking-wider ${
                      msg.role === "user" ? "text-emerald-400 font-bold" : "text-cyan-400 font-bold"
                    }`}
                  >
                    {msg.role === "user" ? "BOSS" : "J.A.R.V.I.S."}
                  </span>
                  <span className="text-[9px] text-white/30 font-mono">
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div
                  className={`p-3.5 rounded-2xl text-[13px] leading-relaxed max-w-[85%] break-words ${
                    msg.role === "user"
                      ? "bg-emerald-500/15 border border-emerald-400/30 text-emerald-100 rounded-tr-sm shadow-md shadow-emerald-950/40"
                      : "bg-[#05162a]/90 border border-cyan-400/30 text-cyan-50 rounded-tl-sm shadow-md shadow-cyan-950/40"
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}

            {chatThinking && (
              <div className="flex items-center gap-2 p-3 rounded-2xl bg-[#05162a]/60 border border-cyan-500/20 w-fit">
                <div className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                <span className="font-mono text-[11px] text-cyan-300 animate-pulse tracking-wider">
                  JARVIS THINKING...
                </span>
              </div>
            )}
          </div>

          {/* Quick Directives */}
          <div className="flex gap-1.5 overflow-x-auto py-1 mb-2 no-scrollbar">
            {[
              "Where is my charger?",
              "Where are my keys?",
              "Status report",
              "Lock workstation",
              "Play music",
            ].map((pill) => (
              <button
                key={pill}
                onClick={() => handleSendChat(pill)}
                className="px-2.5 py-1 rounded-lg bg-cyan-950/40 border border-cyan-500/30 text-[10px] font-mono text-cyan-300 whitespace-nowrap active:scale-95 hover:text-white"
              >
                + {pill}
              </button>
            ))}
          </div>

          {/* Chat Input Bar */}
          <div className="relative pt-1 border-t border-cyan-500/15">
            <div className="flex items-center gap-2 bg-[#061224]/90 p-1.5 rounded-2xl border border-cyan-500/30 shadow-lg">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
                placeholder="Give directive to JARVIS..."
                className="flex-1 bg-transparent px-3 py-2 text-xs text-white placeholder-white/25 focus:outline-none font-sans"
              />
              <button
                onClick={() => handleSendChat()}
                disabled={!chatInput.trim() || chatThinking}
                className="p-2.5 rounded-xl bg-cyan-500 text-black font-bold disabled:opacity-30 active:scale-95 transition-all shadow-md shadow-cyan-500/20"
                title="Send Directive"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </main>
      )}

      {/* ── TAB 2: QUANTUM BEAM SYNC ── */}
      {tab === "beam" && (
        <main className="flex-1 flex flex-col gap-4 p-4 max-w-lg w-full mx-auto overflow-y-auto">
          {/* Active PC Beam */}
          <div className="rounded-2xl border border-cyan-500/30 bg-[#061426]/90 p-4 space-y-3 shadow-xl">
            <div className="flex items-center justify-between pb-2 border-b border-cyan-500/15">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                <span className="text-xs font-mono font-bold text-white tracking-wider uppercase">
                  {payload?.title || "Active Beam"}
                </span>
              </div>
              <span className="text-[10px] font-mono text-cyan-400/60 uppercase">
                {payload?.type || "DATA"}
              </span>
            </div>

            <div className="p-3 bg-black/60 rounded-xl border border-white/5 font-mono text-xs text-cyan-100 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
              {payload?.content || "Waiting for beamed stream from PC..."}
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-white/40 font-mono">
                {payload?.createdAt ? new Date(payload.createdAt).toLocaleTimeString() : "Idle"}
              </span>
              <button
                onClick={handleCopy}
                disabled={!payload?.content}
                className="px-3 py-1.5 rounded-xl bg-cyan-500 text-black font-bold text-xs flex items-center gap-1.5 shadow-md shadow-cyan-500/25 active:scale-95 transition-transform"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? "Copied" : "Copy to Phone"}</span>
              </button>
            </div>
          </div>
        </main>
      )}

      {/* ── TAB 3: SPATIAL ROOM SCANNER ── */}
      {tab === "scanner" && (
        <main className="flex-1 flex flex-col gap-4 p-4 max-w-lg w-full mx-auto overflow-y-auto">
          {/* High Priority 1-Tap AI Camera Scan */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-cyan-950/60 via-[#061426] to-black border-2 border-cyan-400/40 shadow-[0_0_30px_rgba(0,212,255,0.2)] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                AI Spatial Desk Scan
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300">
                GEMINI VISION
              </span>
            </div>
            <p className="text-xs text-white/70 leading-relaxed font-sans">
              Snap a picture of your desk. JARVIS automatically detects your charger, keys, mug, and accessories and locks their coordinates into memory!
            </p>

            <label className="w-full py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-black font-bold text-xs flex items-center justify-center gap-2 cursor-pointer active:scale-98 transition-all shadow-lg shadow-cyan-500/30">
              <Camera className="w-4 h-4" />
              <span>{aiScanning ? "AI ANALYZING WORKSPACE..." : "SNAP PHOTO & AI SCAN"}</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileUpload}
                disabled={aiScanning}
                className="hidden"
              />
            </label>
          </div>

          {/* Camera Viewfinder (if supported) */}
          <div className="relative w-full aspect-video bg-black rounded-2xl border border-cyan-500/30 overflow-hidden flex items-center justify-center">
            {snapshotImg ? (
              <img src={snapshotImg} alt="Desk Snapshot" className="w-full h-full object-cover" />
            ) : cameraActive ? (
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            ) : (
              <div className="text-center p-4 text-xs font-mono text-cyan-400/60 flex flex-col items-center gap-2">
                <Camera className="w-8 h-8 opacity-40" />
                <span>Tap &quot;SNAP PHOTO &amp; AI SCAN&quot; above to capture desk.</span>
              </div>
            )}

            {/* Reticle */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-24 h-24 border border-cyan-400/40 rounded-full flex items-center justify-center">
                <Crosshair className="w-6 h-6 text-cyan-400/60" />
              </div>
            </div>

            {aiScanning && (
              <div className="absolute inset-0 bg-cyan-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-2 font-mono text-xs text-cyan-300">
                <Sparkles className="w-6 h-6 animate-spin text-cyan-400" />
                <p>MAPPING OBJECT COORDINATES...</p>
              </div>
            )}
          </div>

          {tagSuccess && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-xs flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              {tagSuccess}
            </div>
          )}

          {/* Currently Tagged Objects List */}
          <div className="space-y-2">
            <span className="text-[11px] font-mono text-cyan-400/70 uppercase tracking-wider block px-1">
              Active Desk Memory ({objects.length} items)
            </span>
            <div className="space-y-1.5">
              {objects.map((o) => (
                <div
                  key={o.id}
                  className="p-3 rounded-xl bg-black/50 border border-white/8 flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">{CAT_EMOJI[o.category] || "📦"}</span>
                    <div>
                      <p className="text-xs font-semibold text-white">{o.name}</p>
                      <p className="text-[10px] text-cyan-300/60 font-mono">
                        {QUADRANT_COORDS[o.quadrant]?.label || o.quadrant} · ~{o.distanceEstimateCm}cm
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteObject(o.id)}
                    className="p-1.5 rounded-lg text-white/30 hover:text-rose-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </main>
      )}

      {/* ── TAB 4: PC REMOTE CONTROL ── */}
      {tab === "remote" && (
        <main className="flex-1 flex flex-col gap-4 p-4 max-w-lg w-full mx-auto overflow-y-auto">
          <div className="p-4 rounded-2xl bg-black/60 border border-cyan-500/30 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-cyan-500/20">
              <span className="text-xs font-mono font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-cyan-400" />
                Workstation Remote Bridge
              </span>
              <span className="text-[10px] font-mono text-emerald-400">ONLINE</span>
            </div>

            {remoteStatus && (
              <div className="p-2.5 rounded-xl bg-cyan-500/20 border border-cyan-400/40 text-xs font-mono text-cyan-200 text-center">
                {remoteStatus}
              </div>
            )}

            {/* Media Controls */}
            <div className="space-y-2">
              <span className="text-[10px] font-mono text-white/50 uppercase">Media & Volume</span>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => handleRemoteCommand("playpause", "Play/Pause")}
                  className="py-3 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/30 text-cyan-200 text-xs font-mono font-bold flex flex-col items-center gap-1 active:scale-95"
                >
                  <Play className="w-4 h-4" />
                  <span>Play / Pause</span>
                </button>
                <button
                  onClick={() => handleRemoteCommand("volumeup", "Volume Up")}
                  className="py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-mono flex flex-col items-center gap-1 active:scale-95"
                >
                  <Volume2 className="w-4 h-4" />
                  <span>Volume +</span>
                </button>
                <button
                  onClick={() => handleRemoteCommand("volumedown", "Volume Down")}
                  className="py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-mono flex flex-col items-center gap-1 active:scale-95"
                >
                  <Volume1 className="w-4 h-4" />
                  <span>Volume -</span>
                </button>
              </div>
            </div>

            {/* Security Controls */}
            <div className="space-y-2 pt-2 border-t border-white/10">
              <span className="text-[10px] font-mono text-white/50 uppercase">Security & Radar</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleRemoteCommand("lock", "Lock PC")}
                  className="py-3 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 text-xs font-mono font-bold flex items-center justify-center gap-2 active:scale-95"
                >
                  <Lock className="w-4 h-4" />
                  <span>Lock Workstation</span>
                </button>
                <button
                  onClick={async () => {
                    await fetch("/api/teleport", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "ping-phone" }),
                    });
                    setSonarAlertActive(true);
                  }}
                  className="py-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-mono font-bold flex items-center justify-center gap-2 active:scale-95"
                >
                  <Radio className="w-4 h-4" />
                  <span>Test Sonar Ping</span>
                </button>
              </div>
            </div>
          </div>
        </main>
      )}
    </div>
  );
}

export default function TeleportPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#020813] flex items-center justify-center text-cyan-400 font-mono text-xs">
          STABILIZING QUANTUM LINK...
        </div>
      }
    >
      <TeleportContent />
    </Suspense>
  );
}
