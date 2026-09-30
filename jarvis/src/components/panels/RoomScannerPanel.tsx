"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Scan,
  Crosshair,
  Search,
  MapPin,
  Plus,
  Trash2,
  Camera,
  Volume2,
  Compass,
  CheckCircle2,
  Sparkles,
  Target,
  RefreshCw,
  Smartphone,
  QrCode,
  Copy,
  Check,
  ExternalLink,
} from "lucide-react";
import { useJarvisVoice } from "@/hooks/useVoice";

interface DeskObject {
  id: string;
  name: string;
  category: "electronics" | "keys" | "drink" | "stationery" | "wearable" | "other";
  quadrant: string;
  x: number;
  y: number;
  width: number;
  height: number;
  distanceEstimateCm: number;
  description?: string;
  lastTagged: number;
}

export default function RoomScannerPanel({ onClose }: { onClose: () => void }) {
  const [objects, setObjects] = useState<DeskObject[]>([]);
  const [targetObject, setTargetObject] = useState<DeskObject | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [isTagging, setIsTagging] = useState(false);
  const [newObjName, setNewObjName] = useState("");
  const [clickPos, setClickPos] = useState<{ x: number; y: number } | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [desktopImg, setDesktopImg] = useState<string | null>(null);
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [phoneScannerUrl, setPhoneScannerUrl] = useState("");
  const [copiedPhoneUrl, setCopiedPhoneUrl] = useState(false);
  const [isAiScanning, setIsAiScanning] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const { speak } = useJarvisVoice();

  // Fetch Phone Scanner URL
  useEffect(() => {
    fetch("/api/teleport")
      .then((r) => r.json())
      .then((d) => {
        const host = d?.lanIp ? `${d.lanIp}:3000` : (typeof window !== "undefined" ? window.location.host : "localhost:3000");
        setPhoneScannerUrl(`http://${host}/teleport?tab=scanner`);
      })
      .catch(() => {
        if (typeof window !== "undefined") {
          setPhoneScannerUrl(`${window.location.origin}/teleport?tab=scanner`);
        }
      });
  }, []);

  // Camera starter
  const startCamera = async () => {
    setCameraLoading(true);
    setDesktopImg(null);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraActive(true);
    } catch (err) {
      console.warn("[RoomScanner] Webcam unavailable:", err);
      setCameraActive(false);
    } finally {
      setCameraLoading(false);
    }
  };

  // Initialize Webcam on mount
  useEffect(() => {
    startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setDesktopImg(event.target?.result as string);
      setCameraActive(false);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
    reader.readAsDataURL(file);
  };

  // Fetch objects
  const fetchObjects = useCallback(async () => {
    try {
      const res = await fetch("/api/room-scanner");
      const data = await res.json();
      if (data?.success) {
        setObjects(data.objects || []);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Live polling for phone-tagged objects
  useEffect(() => {
    fetchObjects();
    const interval = setInterval(fetchObjects, 3000);
    return () => clearInterval(interval);
  }, [fetchObjects]);

  // Handle Search / "Where is my charger?"
  const handleLocate = async (queryText?: string) => {
    const q = queryText || searchQuery;
    if (!q.trim()) return;

    try {
      const res = await fetch("/api/room-scanner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "locate", query: q }),
      });
      const data = await res.json();
      if (data?.found && data.object) {
        setTargetObject(data.object);
        setAnnouncement(data.announcement);
        speak(data.announcement);
      } else {
        const notFoundMsg = data.message || `No item matching "${q}" was found.`;
        setAnnouncement(notFoundMsg);
        speak(notFoundMsg);
        setTargetObject(null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // AI Auto-Scan using Gemini Vision
  const handleAiAutoScan = async () => {
    let imgData: string | null = desktopImg;

    if (!imgData && videoRef.current && cameraActive) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = videoRef.current.videoWidth || 1280;
        canvas.height = videoRef.current.videoHeight || 720;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          imgData = canvas.toDataURL("image/jpeg", 0.85);
        }
      } catch (e) {
        console.warn("[RoomScanner] Frame capture failed:", e);
      }
    }

    if (!imgData) {
      imgData = "sample";
    }

    setIsAiScanning(true);
    try {
      const res = await fetch("/api/room-scanner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ai-scan", image: imgData }),
      });
      const data = await res.json();
      if (data?.success) {
        setObjects(data.objects || []);
        if (data.announcement) {
          setAnnouncement(data.announcement);
          speak(data.announcement);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsAiScanning(false);
    }
  };

  // Click on camera feed to tag object
  const handleCameraClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setClickPos({ x, y });
    setIsTagging(true);
    setNewObjName("");
  };

  const handleSaveTag = async () => {
    if (!clickPos || !newObjName.trim()) return;
    try {
      const res = await fetch("/api/room-scanner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "tag",
          object: {
            name: newObjName.trim(),
            x: clickPos.x,
            y: clickPos.y,
            width: 0.12,
            height: 0.12,
            category: "electronics",
          },
        }),
      });
      const data = await res.json();
      if (data?.success) {
        setObjects(data.objects || []);
        setIsTagging(false);
        setClickPos(null);
        speak(`Registered ${newObjName.trim()} to desk spatial memory.`);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteObject = async (id: string, name: string) => {
    try {
      const res = await fetch("/api/room-scanner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      const data = await res.json();
      if (data?.success) {
        setObjects(data.objects || []);
        if (targetObject?.id === id) setTargetObject(null);
        speak(`Removed ${name} from spatial memory.`);
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl bg-[#030914]/95 border border-cyan-500/40 rounded-2xl shadow-[0_0_60px_rgba(0,212,255,0.25)] overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyan-500/20 bg-cyan-950/20">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_15px_rgba(0,212,255,0.3)]">
              <Scan className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="font-orbitron text-sm font-bold text-cyan-300 tracking-wider flex items-center gap-2">
                SPATIAL DESK & ROOM SCANNER
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 font-mono">
                  HUD LIDAR
                </span>
              </h2>
              <p className="text-[11px] font-rajdhani text-text-secondary">
                Spatial Coordinate Memory · Object Location Radar · Reticle Target Lock
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleAiAutoScan}
              disabled={isAiScanning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-black font-bold text-xs hover:brightness-110 active:scale-95 transition-all shadow-md shadow-cyan-500/25"
              title="Auto-detect all desk objects using Gemini Vision"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isAiScanning ? "animate-spin" : ""}`} />
              <span>{isAiScanning ? "AI SCANNING..." : "AI AUTO-SCAN"}</span>
            </button>
            <button
              onClick={() => setShowPhoneModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/15 border border-cyan-400/30 text-xs font-rajdhani text-cyan-300 hover:bg-cyan-500/25 transition-all shadow-sm"
              title="Open scanner on your phone"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Scan with Phone</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-text-secondary hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Phone Scanner QR Modal Overlay */}
        <AnimatePresence>
          {showPhoneModal && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
              onClick={() => setShowPhoneModal(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="w-full max-w-sm bg-[#061224] border border-cyan-500/40 rounded-2xl p-6 shadow-[0_0_50px_rgba(0,212,255,0.3)] text-center space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between pb-2 border-b border-cyan-500/20">
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-cyan-400" />
                    <span className="font-orbitron text-xs font-bold text-white tracking-wider">
                      PHONE ROOM SCANNER
                    </span>
                  </div>
                  <button
                    onClick={() => setShowPhoneModal(false)}
                    className="p-1 rounded-lg text-white/50 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <p className="text-xs text-cyan-100/70 leading-relaxed font-sans">
                  Point your phone camera at this QR code to launch the Mobile Spatial Scanner. Tag objects from your phone and JARVIS will store them in memory!
                </p>

                <div className="p-3 bg-white rounded-2xl mx-auto inline-block shadow-lg">
                  {phoneScannerUrl ? (
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
                        phoneScannerUrl
                      )}`}
                      alt="Phone Scanner QR"
                      className="w-48 h-48 block"
                    />
                  ) : (
                    <div className="w-48 h-48 flex items-center justify-center text-black font-mono text-xs">
                      Generating QR...
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="p-2 bg-black/50 border border-white/10 rounded-xl text-[11px] font-mono text-cyan-300 break-all select-all">
                    {phoneScannerUrl || "http://localhost:3000/teleport?tab=scanner"}
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(phoneScannerUrl);
                        setCopiedPhoneUrl(true);
                        setTimeout(() => setCopiedPhoneUrl(false), 2000);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/30 text-xs font-mono text-cyan-300 flex items-center gap-1.5 transition-colors"
                    >
                      {copiedPhoneUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedPhoneUrl ? "Copied Link!" : "Copy Link"}
                    </button>
                    {phoneScannerUrl && (
                      <a
                        href={phoneScannerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 text-xs font-mono text-white/80 flex items-center gap-1.5 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open
                      </a>
                    )}
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Camera Viewport with Stark Reticle (7 cols) */}
          <div className="lg:col-span-7 flex flex-col gap-3">
            {/* Viewport Box */}
            <div
              onClick={handleCameraClick}
              className="relative w-full aspect-video bg-[#02050f] rounded-2xl border-2 border-cyan-500/40 overflow-hidden shadow-[0_0_30px_rgba(0,212,255,0.2)] cursor-crosshair group"
            >
              {desktopImg ? (
                <img
                  src={desktopImg}
                  alt="Desk View"
                  className="w-full h-full object-cover"
                />
              ) : cameraActive ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center font-mono text-xs text-cyan-400/80 p-6 text-center gap-3">
                  <Camera className="w-10 h-10 animate-pulse text-cyan-400" />
                  <p className="text-white text-xs font-semibold">Webcam Inactive or Permission Needed</p>
                  <p className="text-[11px] text-cyan-400/60 max-w-sm">
                    Activate your desktop webcam, upload a photo of your desk, or scan using your phone camera.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        startCamera();
                      }}
                      className="px-3.5 py-1.5 rounded-xl bg-cyan-500 text-black font-bold text-xs flex items-center gap-1.5 shadow-md shadow-cyan-500/25 active:scale-95"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      {cameraLoading ? "Connecting..." : "Start Camera"}
                    </button>
                    <label
                      onClick={(e) => e.stopPropagation()}
                      className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs text-white cursor-pointer active:scale-95 flex items-center gap-1.5"
                    >
                      <span>Upload Photo</span>
                      <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                    </label>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowPhoneModal(true);
                      }}
                      className="px-3.5 py-1.5 rounded-xl bg-cyan-500/15 border border-cyan-400/30 text-xs text-cyan-300 active:scale-95 flex items-center gap-1"
                    >
                      <Smartphone className="w-3.5 h-3.5" />
                      Scan on Phone
                    </button>
                  </div>
                </div>
              )}

              {/* 3D Perspective Grid Overlay */}
              <div className="absolute inset-0 pointer-events-none opacity-30">
                <div className="w-full h-full grid grid-cols-3 grid-rows-3 border border-cyan-400/30">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} className="border border-cyan-400/20 relative">
                      <span className="absolute top-1 left-1.5 text-[8px] font-mono text-cyan-400/50">
                        SEC-{i + 1}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* AI Scanning Laser Sweep Bar */}
              {isAiScanning && (
                <div className="absolute inset-0 pointer-events-none overflow-hidden z-20">
                  <div className="w-full h-1 bg-cyan-400 shadow-[0_0_20px_#00f3ff] animate-bounce" />
                  <div className="absolute inset-0 bg-cyan-500/10 backdrop-blur-[1px] flex items-center justify-center">
                    <div className="p-3 rounded-2xl bg-black/80 border border-cyan-400/50 font-mono text-xs text-cyan-300 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 animate-spin text-cyan-400" />
                      <span>GEMINI VISION ANALYZING WORKSPACE...</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Existing Tagged Object Reticles */}
              {objects.map((obj) => {
                const isTarget = targetObject?.id === obj.id;
                return (
                  <div
                    key={obj.id}
                    className="absolute pointer-events-none transition-all duration-500"
                    style={{
                      left: `${obj.x * 100}%`,
                      top: `${obj.y * 100}%`,
                      transform: "translate(-50%, -50%)",
                    }}
                  >
                    {/* Targeting Box */}
                    <div
                      className={`w-14 h-14 rounded-lg border-2 flex items-center justify-center transition-all ${
                        isTarget
                          ? "border-[#ffd700] shadow-[0_0_20px_#ffd700] animate-pulse scale-125"
                          : "border-cyan-400/70 shadow-[0_0_10px_rgba(0,212,255,0.4)]"
                      }`}
                    >
                      <Crosshair
                        className={`w-5 h-5 ${isTarget ? "text-[#ffd700]" : "text-cyan-400"}`}
                      />
                    </div>
                    {/* Label Badge */}
                    <div
                      className={`absolute top-full mt-1 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded text-[10px] font-mono font-bold whitespace-nowrap shadow-md ${
                        isTarget
                          ? "bg-[#ffd700] text-black"
                          : "bg-black/80 border border-cyan-400/50 text-cyan-300"
                      }`}
                    >
                      {obj.name} ({obj.distanceEstimateCm}cm)
                    </div>
                  </div>
                );
              })}

              {/* Tagging In-Progress Reticle */}
              {clickPos && isTagging && (
                <div
                  className="absolute pointer-events-none w-16 h-16 rounded-full border-2 border-white animate-ping"
                  style={{
                    left: `${clickPos.x * 100}%`,
                    top: `${clickPos.y * 100}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                />
              )}

              {/* Instructions banner on hover */}
              <div className="absolute bottom-2 left-2 right-2 px-3 py-1.5 rounded-lg bg-black/70 backdrop-blur-sm border border-cyan-500/20 text-[10px] font-mono text-cyan-300/80 flex items-center justify-between">
                <span>CLICK ANYWHERE ON DESK TO TAG AN OBJECT</span>
                <span className="text-cyan-400 font-bold">RADAR SYNC ACTIVE</span>
              </div>
            </div>

            {/* Tagging Input Modal / Drawer */}
            {isTagging && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3.5 rounded-xl bg-cyan-950/40 border border-cyan-400/50 flex items-center gap-2"
              >
                <div className="flex-1 flex flex-col gap-1">
                  <span className="text-[10px] font-mono text-cyan-300 uppercase">
                    Locking Coordinates: X: {Math.round((clickPos?.x || 0) * 100)}% · Y:{" "}
                    {Math.round((clickPos?.y || 0) * 100)}%
                  </span>
                  <input
                    type="text"
                    value={newObjName}
                    onChange={(e) => setNewObjName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveTag()}
                    placeholder="Enter item name (e.g. Phone, Keys, Mug, Charger)..."
                    autoFocus
                    className="bg-black/70 border border-cyan-500/30 rounded-lg px-3 py-1.5 text-xs text-white placeholder-cyan-400/30 font-mono focus:outline-none focus:border-cyan-400"
                  />
                </div>
                <button
                  onClick={handleSaveTag}
                  disabled={!newObjName.trim()}
                  className="px-4 py-2 rounded-lg bg-cyan-500 text-black font-bold text-xs font-mono hover:bg-cyan-400 disabled:opacity-40"
                >
                  SAVE
                </button>
                <button
                  onClick={() => setIsTagging(false)}
                  className="px-3 py-2 rounded-lg bg-white/10 text-white text-xs font-mono"
                >
                  CANCEL
                </button>
              </motion.div>
            )}

            {/* Announcement Banner */}
            {announcement && (
              <div className="p-3 rounded-xl bg-cyan-900/30 border border-cyan-400/40 flex items-center gap-2 text-xs font-mono text-cyan-200">
                <Volume2 className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>{announcement}</span>
              </div>
            )}
          </div>

          {/* Right Column: Search Query & Spatial Memory Registry (5 cols) */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {/* Find Object Search Bar */}
            <div className="bg-black/50 border border-cyan-500/20 rounded-2xl p-4 flex flex-col gap-3">
              <span className="text-xs font-mono text-cyan-400/80 uppercase tracking-wider flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5" /> Locate Object (&quot;Where is my...&quot;)
              </span>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLocate()}
                  placeholder="Where is my charger / keys / mug?..."
                  className="flex-1 bg-black/70 border border-cyan-500/30 rounded-xl px-3 py-2 text-xs text-white placeholder-cyan-400/30 font-mono focus:outline-none focus:border-cyan-400"
                />
                <button
                  onClick={() => handleLocate()}
                  disabled={!searchQuery.trim()}
                  className="px-4 py-2 rounded-xl bg-cyan-500 text-black font-bold text-xs font-mono hover:bg-cyan-400 disabled:opacity-40 flex items-center gap-1"
                >
                  <Target className="w-3.5 h-3.5" /> LOCATE
                </button>
              </div>

              {/* Quick Query Pills */}
              <div className="flex flex-wrap gap-1.5">
                {["charger", "keys", "mug"].map((pill) => (
                  <button
                    key={pill}
                    onClick={() => {
                      setSearchQuery(pill);
                      handleLocate(pill);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-cyan-950/40 border border-cyan-500/30 text-[10px] font-mono text-cyan-300 hover:text-white transition-colors"
                  >
                    Where is my {pill}?
                  </button>
                ))}
              </div>
            </div>

            {/* Spatial Memory Objects List */}
            <div className="flex flex-col gap-2.5">
              <span className="text-xs font-mono text-cyan-400/80 uppercase tracking-wider flex items-center justify-between">
                <span>Desk Spatial Registry ({objects.length})</span>
                <span className="text-[10px] text-cyan-400/50">Stored in Memory</span>
              </span>

              <div className="flex flex-col gap-2 max-h-[38vh] overflow-y-auto pr-1">
                {objects.length === 0 ? (
                  <div className="p-6 text-center text-xs font-mono text-cyan-400/40 border border-dashed border-cyan-500/20 rounded-xl">
                    No desk objects registered yet. Click on the camera feed to tag your first item!
                  </div>
                ) : (
                  objects.map((obj) => {
                    const isTarget = targetObject?.id === obj.id;
                    return (
                      <div
                        key={obj.id}
                        className={`p-3 rounded-xl border transition-all flex items-center justify-between text-xs font-mono ${
                          isTarget
                            ? "bg-[#ffd700]/10 border-[#ffd700] shadow-[0_0_15px_rgba(255,215,0,0.2)]"
                            : "bg-black/40 border-cyan-500/20 hover:border-cyan-500/40"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-3 h-3 rounded-full ${
                              isTarget ? "bg-[#ffd700] animate-ping" : "bg-cyan-400"
                            }`}
                          />
                          <div>
                            <div className="font-bold text-white flex items-center gap-2">
                              {obj.name}
                              <span className="text-[10px] font-normal text-cyan-400/70">
                                ({obj.quadrant})
                              </span>
                            </div>
                            <div className="text-[10px] text-cyan-400/50">
                              Dist: ~{obj.distanceEstimateCm}cm · X:{Math.round(obj.x * 100)}% Y:
                              {Math.round(obj.y * 100)}%
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => {
                              setTargetObject(obj);
                              const text = `Target locked. Your ${obj.name} is in the ${obj.quadrant}, approximately ${obj.distanceEstimateCm} centimeters away.`;
                              setAnnouncement(text);
                              speak(text);
                            }}
                            className="px-2.5 py-1 rounded bg-cyan-500/20 border border-cyan-400/30 text-cyan-300 text-[10px] hover:bg-cyan-500/30 transition-colors flex items-center gap-1"
                          >
                            <Crosshair className="w-3 h-3" /> Focus
                          </button>
                          <button
                            onClick={() => handleDeleteObject(obj.id, obj.name)}
                            className="p-1 rounded text-red-400/70 hover:text-red-400 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-cyan-500/20 bg-cyan-950/10 flex items-center justify-between text-[11px] font-mono text-cyan-400/60">
          <span>STARK SPATIAL POSITIONING PROTOCOL ACTIVE</span>
          <span>CALIBRATED TO DESK PLANE (3x3 LIDAR QUADRANTS)</span>
        </div>
      </div>
    </motion.div>
  );
}
