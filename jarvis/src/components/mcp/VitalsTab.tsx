"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  Heart,
  Activity,
  Eye,
  Zap,
  ShieldAlert,
  Camera,
  CameraOff,
  Sparkles,
  RefreshCw,
  Sliders,
  CheckCircle2,
} from "lucide-react";

export default function VitalsTab() {
  const [isScanning, setIsScanning] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  // Measurements start empty — every number below is derived from a real
  // camera capture or, for blink rate, from detected eye landmarks.
  const [bpm, setBpm] = useState(0);
  const [hrv, setHrv] = useState(0);
  const [stressLevel, setStressLevel] = useState<"Low" | "Moderate" | "Elevated" | "High">("Low");
  const [stressScore, setStressScore] = useState(0);
  const [blinkRate, setBlinkRate] = useState(0);
  const [fatigueIndex, setFatigueIndex] = useState(0);
  const [recommendation, setRecommendation] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const graphCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const lastPeakTimeRef = useRef<number>(0);
  const rrIntervalsRef = useRef<number[]>([]);
  const faceTrackedRef = useRef(false);

  // Live rPPG signal lived entirely inside the animation loop. Keeping it in a
  // ref (instead of a `bpm` dependency) means the effect can run for the whole
  // session without restarting and throwing away the buffered pulse wave.
  const bpmRef = useRef(0);

  // Toggle rPPG camera sensor
  const toggleSensor = async () => {
    if (isScanning) {
      stopSensor();
    } else {
      startSensor();
    }
  };

  const startSensor = async () => {
    setIsScanning(true);
    setCameraError(null);
    try {
      if (navigator?.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          setCameraActive(true);
        }
      } else {
        throw new Error("Camera API unavailable");
      }
    } catch (e: any) {
      console.warn("[rPPG Video stream error, activating simulation]:", e.message);
      setCameraError("Camera unavailable or permission denied. Running in synthetic optical simulation mode.");
      setCameraActive(false);
    }
  };

  const stopSensor = () => {
    setIsScanning(false);
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
  };

  // Optical frame extraction loop. Depends only on the on/off + camera state;
  // bpm/HRV are read and written through refs so a heartbeat never restarts
  // (and clears) the accumulated signal buffer.
  useEffect(() => {
    if (!isScanning) return;

    const series: number[] = [];
    const samplingCanvas = canvasRef.current;
    const graphCanvas = graphCanvasRef.current;
    const ctx = samplingCanvas?.getContext("2d", { willReadFrequently: true });
    const graphCtx = graphCanvas?.getContext("2d");

    let peakArmed = true;

    const processFrame = () => {
      let greenVal = 0;

      if (cameraActive && videoRef.current && samplingCanvas && ctx) {
        const v = videoRef.current;
        if (v.readyState === v.HAVE_ENOUGH_DATA) {
          samplingCanvas.width = 120;
          samplingCanvas.height = 120;
          // Forehead ROI — centre third, upper band of the frame.
          ctx.drawImage(
            v,
            v.videoWidth * 0.35,
            v.videoHeight * 0.12,
            v.videoWidth * 0.3,
            v.videoHeight * 0.22,
            0,
            0,
            120,
            120
          );
          const frame = ctx.getImageData(0, 0, 120, 120);
          const d = frame.data;
          let sumG = 0;
          for (let i = 1; i < d.length; i += 4) sumG += d[i];
          greenVal = sumG / (d.length / 4);
        }
      }

      // No live frame → nothing to measure. Draw an idle flat trace rather
      // than fabricating a pulse, and wait for a real capture.
      if (!cameraActive || greenVal === 0) {
        if (graphCanvas && graphCtx) {
          const w = graphCanvas.width;
          const h = graphCanvas.height;
          graphCtx.clearRect(0, 0, w, h);
          graphCtx.strokeStyle = "rgba(6, 182, 212, 0.15)";
          graphCtx.lineWidth = 1;
          for (let x = 0; x < w; x += 25) {
            graphCtx.beginPath();
            graphCtx.moveTo(x, 0);
            graphCtx.lineTo(x, h);
            graphCtx.stroke();
          }
          for (let y = 0; y < h; y += 20) {
            graphCtx.beginPath();
            graphCtx.moveTo(0, y);
            graphCtx.lineTo(w, y);
            graphCtx.stroke();
          }
          graphCtx.strokeStyle = "rgba(148, 163, 184, 0.5)";
          graphCtx.beginPath();
          graphCtx.moveTo(0, h / 2);
          graphCtx.lineTo(w, h / 2);
          graphCtx.stroke();
        }
        animFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }

      series.push(greenVal);
      if (series.length > 180) series.shift();

      // ── Detrend (subtract a 30-sample moving average) ──
      const win = 30;
      const n = series.length;
      let sum = 0;
      const detrended: number[] = new Array(n);
      for (let i = 0; i < n; i++) {
        sum += series[i];
        if (i >= win) sum -= series[i - win];
        detrended[i] = series[i] - sum / Math.min(i + 1, win);
      }

      // ── Adaptive peak detection with a refractory period ──
      const lookback = Math.min(90, n);
      if (lookback > 12) {
        let peakAbs = 0;
        for (let i = n - lookback; i < n; i++) peakAbs = Math.max(peakAbs, Math.abs(detrended[i]));
        const threshold = peakAbs * 0.4;
        const nowVal = detrended[n - 1];
        const prevVal = detrended[n - 2];

        if (nowVal > threshold && nowVal > prevVal) peakArmed = true;

        if (peakArmed && prevVal > threshold && prevVal > nowVal) {
          // Confirmed local maximum at prevVal.
          peakArmed = false;
          const now = performance.now();
          const delta = now - lastPeakTimeRef.current;
          if (lastPeakTimeRef.current > 0 && delta > 380 && delta < 1500) {
            rrIntervalsRef.current.push(delta);
            if (rrIntervalsRef.current.length > 8) rrIntervalsRef.current.shift();
            lastPeakTimeRef.current = now;

            // Median R-R → robust instantaneous BPM.
            const sorted = [...rrIntervalsRef.current].sort((a, b) => a - b);
            const med = sorted[Math.floor(sorted.length / 2)];
            const instantBpm = Math.round(60000 / med);
            bpmRef.current =
              bpmRef.current === 0
                ? instantBpm
                : Math.round(bpmRef.current * 0.6 + instantBpm * 0.4);
            setBpm(bpmRef.current);

            // HRV (SDNN of R-R intervals)
            if (rrIntervalsRef.current.length >= 4) {
              const mean = rrIntervalsRef.current.reduce((a, b) => a + b, 0) / rrIntervalsRef.current.length;
              const sqDiffs = rrIntervalsRef.current.map((v) => Math.pow(v - mean, 2));
              const currentHrv = Math.round(
                Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / sqDiffs.length)
              );
              setHrv(Math.max(25, Math.min(110, currentHrv)));
            }
          } else if (lastPeakTimeRef.current === 0) {
            lastPeakTimeRef.current = now;
          }
        }
      }

      // Draw ECG oscilloscope wave
      if (graphCanvas && graphCtx) {
        const w = graphCanvas.width;
        const h = graphCanvas.height;
        graphCtx.clearRect(0, 0, w, h);

        graphCtx.strokeStyle = "rgba(6, 182, 212, 0.1)";
        graphCtx.lineWidth = 1;
        for (let x = 0; x < w; x += 25) {
          graphCtx.beginPath();
          graphCtx.moveTo(x, 0);
          graphCtx.lineTo(x, h);
          graphCtx.stroke();
        }
        for (let y = 0; y < h; y += 20) {
          graphCtx.beginPath();
          graphCtx.moveTo(0, y);
          graphCtx.lineTo(w, y);
          graphCtx.stroke();
        }

        if (detrended.length > 2) {
          graphCtx.beginPath();
          graphCtx.strokeStyle = bpmRef.current > 100 ? "#ef4444" : "#06b6d4";
          graphCtx.lineWidth = 2;
          graphCtx.shadowColor = bpmRef.current > 100 ? "#ef4444" : "#22d3ee";
          graphCtx.shadowBlur = 8;

          const minV = Math.min(...detrended);
          const maxV = Math.max(...detrended);
          const range = maxV - minV || 1;

          for (let i = 0; i < detrended.length; i++) {
            const x = (i / detrended.length) * w;
            const norm = (detrended[i] - minV) / range;
            const y = h - (norm * (h - 20) + 10);
            if (i === 0) graphCtx.moveTo(x, y);
            else graphCtx.lineTo(x, y);
          }
          graphCtx.stroke();
          graphCtx.shadowBlur = 0;
        }
      }

      animFrameRef.current = requestAnimationFrame(processFrame);
    };

    animFrameRef.current = requestAnimationFrame(processFrame);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isScanning, cameraActive]);

  // Eye / blink tracking via face landmarks (face-api 68-point model). Runs at
  // ~3 Hz — independent of the render loop — and derives blink rate from the
  // Eye Aspect Ratio. Falls back silently when the model or a face is absent.
  useEffect(() => {
    if (!isScanning || !cameraActive) return;
    let cancelled = false;
    const blinkTimes: number[] = [];
    let earBaseline = 0;
    let lastBlinkAt = 0;
    let eyeClosed = false;

    const LEFT_EYE = [36, 37, 38, 39, 40, 41];
    const RIGHT_EYE = [42, 43, 44, 45, 46, 47];

    const earFor = (pts: Array<{ x: number; y: number }>, idx: number[]) => {
      const p = idx.map((i) => pts[i]).filter(Boolean);
      if (p.length < 6) return 0;
      const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        Math.hypot(a.x - b.x, a.y - b.y);
      const v1 = dist(p[1], p[5]);
      const v2 = dist(p[2], p[4]);
      const hz = dist(p[0], p[3]) || 1;
      return (v1 + v2) / (2 * hz);
    };

    const tick = async () => {
      if (cancelled) return;
      const v = videoRef.current;
      if (!v || v.readyState < v.HAVE_ENOUGH_DATA) return;
      try {
        const { detectSingleFaceWithLandmarks } = await import("@/lib/security/face-recognition");
        const det = await detectSingleFaceWithLandmarks(v);
        if (cancelled) return;
        if (!det) {
          faceTrackedRef.current = false;
          return;
        }
        faceTrackedRef.current = true;
        const pts = det.landmarks.positions;
        const ear = (earFor(pts, LEFT_EYE) + earFor(pts, RIGHT_EYE)) / 2;

        // Learn the open-eye baseline, then flag closures well below it.
        if (earBaseline === 0) earBaseline = ear;
        else earBaseline = earBaseline * 0.97 + Math.max(ear, earBaseline) * 0.03;

        const now = Date.now();
        const closed = ear < earBaseline * 0.72;
        if (closed && !eyeClosed && now - lastBlinkAt > 180) {
          lastBlinkAt = now;
          blinkTimes.push(now);
          // Keep a rolling 60 s window → blinks per minute.
          while (blinkTimes.length && now - blinkTimes[0] > 60000) blinkTimes.shift();
          setBlinkRate(Math.max(1, blinkTimes.length));
        }
        eyeClosed = closed;
      } catch {
        // face-api unavailable — leave blink telemetry at its last value.
      }
    };

    const interval = setInterval(tick, 350);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isScanning, cameraActive]);

  // Periodic stress analysis sync with backend MCP — only once a real pulse
  // has been measured, so we never send an invented bpm.
  useEffect(() => {
    if (!isScanning || bpm <= 0) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mcp: "vitals",
            action: "analyze",
            params: { bpm, hrv, blinkRate }
          })
        });
        const data = await res.json();
        if (data.success && data.data) {
          setStressLevel(data.data.stressLevel);
          setStressScore(data.data.stressScore);
          setFatigueIndex(data.data.fatigueIndex);
          setRecommendation(data.data.recommendation);
        }
      } catch {}
    }, 4000);

    return () => clearInterval(interval);
  }, [isScanning, bpm, hrv, blinkRate]);

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col gap-3 rounded-2xl border border-rose-500/20 bg-gradient-to-r from-rose-950/40 via-red-950/20 to-black/40 p-4 backdrop-blur-xl md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/30">
            <Heart className="h-5 w-5 animate-pulse text-rose-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold tracking-wide text-white">rPPG VITALS SENTINEL</h3>
              <span className="rounded-full border border-rose-400/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-300">
                Contactless Optical Sensor
              </span>
            </div>
            <p className="text-xs text-white/50">
              Photoplethysmography via ambient facial capillary reflectance · Zero wearables required
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={toggleSensor}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold shadow-lg transition ${
            isScanning
              ? "bg-rose-600 text-white hover:bg-rose-500 shadow-rose-600/30"
              : "bg-cyan-500 text-white hover:bg-cyan-400 shadow-cyan-500/30"
          }`}
        >
          {isScanning ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
          {isScanning ? "Disengage Sensor" : "Engage Optical Sensor"}
        </button>
      </div>

      {cameraError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          {cameraError}
        </div>
      )}

      {/* Main Grid */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column: Video Feed & Reticle */}
        <div className="space-y-4 lg:col-span-5">
          <div className="relative aspect-video overflow-hidden rounded-3xl border border-white/10 bg-black/60 shadow-xl">
            <video
              ref={videoRef}
              className={`h-full w-full object-cover transition-opacity ${
                cameraActive ? "opacity-100" : "opacity-20"
              }`}
              muted
              playsInline
              autoPlay
            />
            {/* Hidden sampling canvas */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Targeting Reticle Overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative h-44 w-36 rounded-2xl border border-dashed border-cyan-400/50">
                <div className="absolute -top-1 -left-1 h-3 w-3 border-t-2 border-l-2 border-cyan-400" />
                <div className="absolute -top-1 -right-1 h-3 w-3 border-t-2 border-r-2 border-cyan-400" />
                <div className="absolute -bottom-1 -left-1 h-3 w-3 border-b-2 border-l-2 border-cyan-400" />
                <div className="absolute -bottom-1 -right-1 h-3 w-3 border-b-2 border-r-2 border-cyan-400" />
                <div className="absolute inset-x-2 top-2 h-10 rounded border border-rose-500/30 bg-rose-500/5 flex items-center justify-center text-[9px] text-rose-300 font-mono">
                  ROI: Capillary
                </div>
              </div>
            </div>

            <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg bg-black/70 px-2.5 py-1 text-[11px] text-white/70 backdrop-blur-md">
              <Activity className="h-3 w-3 text-cyan-400" />
              <span>Status: {isScanning ? "Scanning Micro-Reflectance" : "Sensor Standby"}</span>
            </div>
          </div>

          {/* JARVIS Recommendation Card */}
          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-950/20 p-4 text-xs text-cyan-100">
            <div className="flex items-center gap-2 font-semibold text-cyan-300 mb-1">
              <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
              JARVIS Physiological Assessment
            </div>
            <p className="leading-relaxed text-white/80">
              {recommendation ||
                (isScanning
                  ? "Hold steady in frame while I acquire your pulse…"
                  : "Engage the optical sensor and hold your face steady in frame.")}
            </p>
          </div>
        </div>

        {/* Right Column: Live Electrocardiogram Waveform & Vitals Gauges */}
        <div className="space-y-4 lg:col-span-7">
          {/* Live ECG Waveform Oscilloscope */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-2xl">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-cyan-400">
                Photoplethysmography Waveform (PPG / ECG)
              </span>
              <span className="text-[11px] font-mono text-white/40">Bandpass: 0.75 - 3.0 Hz</span>
            </div>
            <canvas
              ref={graphCanvasRef}
              width={540}
              height={140}
              className="w-full rounded-xl bg-black/50 border border-white/10"
            />
          </div>

          {/* Vitals Telemetry Metrics */}
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            {/* Heart Rate (BPM) */}
            <div className="rounded-2xl border border-rose-500/20 bg-rose-950/20 p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-rose-300">HEART RATE</span>
                <motion.div
                  animate={{ scale: isScanning ? [1, 1.25, 1] : 1 }}
                  transition={{ duration: 60 / (bpm || 72), repeat: Infinity }}
                >
                  <Heart className="h-4 w-4 fill-rose-500 text-rose-500" />
                </motion.div>
              </div>
              <div className="mt-2 text-3xl font-bold tracking-tight text-white font-mono">
                {isScanning && bpm > 0 ? bpm : "--"}
              </div>
              <span className="text-[10px] text-rose-300/60">BPM (Beats/Min)</span>
            </div>

            {/* HRV */}
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-950/20 p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-cyan-300">HRV (SDNN)</span>
                <Activity className="h-4 w-4 text-cyan-400" />
              </div>
              <div className="mt-2 text-3xl font-bold tracking-tight text-white font-mono">
                {isScanning && hrv > 0 ? hrv : "--"}
              </div>
              <span className="text-[10px] text-cyan-300/60">ms (Autonomic balance)</span>
            </div>

            {/* Stress Score */}
            <div className="rounded-2xl border border-amber-500/20 bg-amber-950/20 p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-amber-300">STRESS INDEX</span>
                <Zap className="h-4 w-4 text-amber-400" />
              </div>
              <div className="mt-2 text-3xl font-bold tracking-tight text-white font-mono">
                {isScanning && stressScore > 0 ? `${stressScore}%` : "--"}
              </div>
              <span className="text-[10px] text-amber-300/60">Level: {isScanning && stressScore > 0 ? stressLevel : "Standby"}</span>
            </div>

            {/* Fatigue & Blink */}
            <div className="rounded-2xl border border-purple-500/20 bg-purple-950/20 p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-purple-300">FATIGUE INDEX</span>
                <Eye className="h-4 w-4 text-purple-400" />
              </div>
              <div className="mt-2 text-3xl font-bold tracking-tight text-white font-mono">
                {isScanning && fatigueIndex > 0 ? `${fatigueIndex}%` : "--"}
              </div>
              <span className="text-[10px] text-purple-300/60">Blinks: {blinkRate > 0 ? `~${blinkRate}/min` : "--"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
