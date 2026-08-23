"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  UserPlus,
  UserMinus,
  Camera,
  Power,
  Lock,
  Unlock,
  History,
  AlertTriangle,
  CheckCircle,
  X,
  Loader2,
  Settings,
  User,
  Eye,
  EyeOff,
  Video,
  VideoOff,
  Scan,
} from "lucide-react";
import { useFaceRecognition } from "@/hooks/useFaceRecognition";
import { useTextToSpeech } from "@/hooks/useVoice";

interface SecuritySettings {
  enabled: boolean;
  strictMode: boolean;
  autoLockTimeout: number;
}

interface AuthorizedFace {
  id: string;
  name: string;
  createdAt: string;
}

interface SecurityEvent {
  id: string;
  type: "access_granted" | "access_denied" | "system_enabled" | "system_disabled" | "face_registered" | "face_removed";
  timestamp: string;
  details: string;
}

const drawMesh = (ctx: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>) => {
  const drawPath = (indices: number[], loop = false) => {
    if (indices.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(points[indices[0]].x, points[indices[0]].y);
    for (let i = 1; i < indices.length; i++) {
      if (points[indices[i]]) {
        ctx.lineTo(points[indices[i]].x, points[indices[i]].y);
      }
    }
    if (loop) ctx.closePath();
    ctx.stroke();
  };

  // Jaw
  drawPath([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  // Eyebrows
  drawPath([17, 18, 19, 20, 21]);
  drawPath([22, 23, 24, 25, 26]);
  // Nose
  drawPath([27, 28, 29, 30]);
  drawPath([31, 32, 33, 34, 35]);
  // Eyes
  drawPath([36, 37, 38, 39, 40, 41], true);
  drawPath([42, 43, 44, 45, 46, 47], true);
  // Mouth
  drawPath([48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59], true);
  drawPath([60, 61, 62, 63, 64, 65, 66, 67], true);
};

export default function SecurityPanel({
  onClose,
}: {
  onClose: () => void;
}) {
  const {
    isLoading: faceLoading,
    isReady: faceReady,
    error: faceError,
    startCamera,
    stopCamera,
    captureAndExtract,
    registerFace,
    matchAgainstStored,
    videoRef,
    isCameraActive,
    stream,
  } = useFaceRecognition();

  const { speak } = useTextToSpeech();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [detectedStatus, setDetectedStatus] = useState<string>("System Standby");
  const [matchName, setMatchName] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const unknownFaceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isAlertSentRef = useRef<boolean>(false);
  const lastSpeechTimeRef = useRef<{ welcome: number; warning: number }>({ welcome: 0, warning: 0 });
  const latestDetectionRef = useRef<any>(null);

  const [settings, setSettings] = useState<SecuritySettings>({
    enabled: false,
    strictMode: false,
    autoLockTimeout: 5,
  });
  const [authorizedFaces, setAuthorizedFaces] = useState<AuthorizedFace[]>([]);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRegistering, setIsRegistering] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newFaceName, setNewFaceName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);

  // Load security data
  useEffect(() => {
    fetchSecurityData();
  }, []);

  // Update error when face recognition has issues
  useEffect(() => {
    if (faceError) {
      setError(faceError);
    }
  }, [faceError]);

  // Bind camera stream to video element when video element is rendered and stream is active
  useEffect(() => {
    if (showCamera && videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [showCamera, stream, videoRef]);

  const triggerTelegramThreatAlert = async (video: HTMLVideoElement) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const imageData = canvas.toDataURL("image/jpeg", 0.85);

      const timestamp = new Date().toLocaleTimeString();
      const message = `⚠️ [Sentinel Eyes Alert] Unauthorized presence detected at ${timestamp}!`;
      
      const response = await fetch("/api/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "alert",
          data: {
            imageData,
            message,
          },
        }),
      });
      const data = await response.json();
      if (data.success) {
        console.log("Telegram security threat alert pushed successfully");
        fetchSecurityData();
      } else {
        console.error("Failed to push Telegram threat alert:", data.error);
      }
    } catch (e) {
      console.error("Error triggering threat alert:", e);
    }
  };

  // Ref to track recognition state for the rendering loop without stale closures
  const recognitionStateRef = useRef<{ isAuthorized: boolean; name: string | null; confidence: number | null }>({
    isAuthorized: false,
    name: null,
    confidence: null,
  });

  // Real-time Holographic Scan HUD Loop & Background Detector
  useEffect(() => {
    if (!showCamera || !videoRef.current || !faceReady) {
      setDetectedStatus("System Standby");
      setMatchName(null);
      setConfidence(null);
      latestDetectionRef.current = null;
      recognitionStateRef.current = {
        isAuthorized: false,
        name: null,
        confidence: null,
      };
      isAlertSentRef.current = false;
      if (unknownFaceTimerRef.current) {
        clearTimeout(unknownFaceTimerRef.current);
        unknownFaceTimerRef.current = null;
      }
      return;
    }

    let active = true;
    let animationFrameId: number;
    let detectionTimeoutId: NodeJS.Timeout;

    let laserY = 0;
    let laserDirection = 1;

    // Background-tolerant Detection Loop: Runs every 750ms using standard setTimeout
    // Since it's using setTimeout instead of requestAnimationFrame, it continues to run
    // in background tabs or when the window is hidden.
    const startDetectionLoop = async () => {
      const { detectSingleFaceWithLandmarks } = await import("@/lib/security/face-recognition");

      const runDetection = async () => {
        if (!active) return;

        const video = videoRef.current;
        if (video && !video.paused && !video.ended && video.videoWidth && video.videoHeight) {
          try {
            const detection = await detectSingleFaceWithLandmarks(video);
            latestDetectionRef.current = detection;

            if (detection) {
              const { descriptor } = detection;
              const descArray = Array.from(descriptor);
              const threshold = settings.strictMode ? 0.50 : 0.55;
              const localMatch = matchAgainstStored(descArray, threshold);
              
              console.log('[Sentinel] Face scanned. Match result:', localMatch, 'Threshold:', threshold);

              const isAuthorized = localMatch !== null;

              if (isAuthorized) {
                const confVal = localMatch.distance ? 1 - localMatch.distance : 0.8;
                setDetectedStatus("Access Granted");
                setMatchName(localMatch.name);
                setConfidence(confVal);

                recognitionStateRef.current = {
                  isAuthorized: true,
                  name: localMatch.name,
                  confidence: confVal,
                };

                if (unknownFaceTimerRef.current) {
                  clearTimeout(unknownFaceTimerRef.current);
                  unknownFaceTimerRef.current = null;
                }

                // 45 seconds Speech Cooldown for welcome message
                const now = Date.now();
                if (now - lastSpeechTimeRef.current.welcome > 45000) {
                  speak(`Access granted. Welcome back, ${localMatch.name}.`);
                  lastSpeechTimeRef.current.welcome = now;
                  lastSpeechTimeRef.current.warning = 0; // Reset warning cooldown on identity switch
                }
                isAlertSentRef.current = false;
              } else {
                setDetectedStatus("UNAUTHORIZED SUBJECT");
                setMatchName("UNKNOWN");
                setConfidence(null);

                recognitionStateRef.current = {
                  isAuthorized: false,
                  name: "UNKNOWN",
                  confidence: null,
                };

                // 45 seconds Speech Cooldown for warning message
                const now = Date.now();
                if (now - lastSpeechTimeRef.current.warning > 45000) {
                  speak("Warning. Unidentified subject detected.");
                  lastSpeechTimeRef.current.warning = now;
                  lastSpeechTimeRef.current.welcome = 0; // Reset welcome cooldown on identity switch
                }

                if (!unknownFaceTimerRef.current && !isAlertSentRef.current) {
                  unknownFaceTimerRef.current = setTimeout(async () => {
                    if (active && !isAlertSentRef.current) {
                      isAlertSentRef.current = true;
                      await triggerTelegramThreatAlert(video);
                    }
                  }, 4000);
                }
              }
            } else {
              setDetectedStatus("Scanning presence...");
              setMatchName(null);
              setConfidence(null);

              recognitionStateRef.current = {
                isAuthorized: false,
                name: null,
                confidence: null,
              };

              if (unknownFaceTimerRef.current) {
                clearTimeout(unknownFaceTimerRef.current);
                unknownFaceTimerRef.current = null;
              }
            }
          } catch (err) {
            console.error("Detection error in loop", err);
          }
        }

        // Schedule next detection.
        // Standard timeouts persist in background tabs (though throttled to ~1-2s, which is perfect for security checks).
        if (active) {
          detectionTimeoutId = setTimeout(runDetection, 750);
        }
      };

      runDetection();
    };

    // HUD Animation / Canvas Drawing Loop: Runs at 60fps when active
    const startDrawingLoop = () => {
      const drawHUD = () => {
        if (!active) return;

        const video = videoRef.current;
        const canvas = canvasRef.current;

        if (!video || !canvas || video.paused || video.ended || !video.videoWidth || !video.videoHeight) {
          animationFrameId = requestAnimationFrame(drawHUD);
          return;
        }

        // Sync canvas dimensions
        if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
          canvas.width = video.clientWidth;
          canvas.height = video.clientHeight;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          animationFrameId = requestAnimationFrame(drawHUD);
          return;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw sci-fi border grid overlay
        ctx.strokeStyle = "rgba(6, 182, 212, 0.1)";
        ctx.lineWidth = 1;
        for (let y = 15; y < canvas.height; y += 30) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(canvas.width, y);
          ctx.stroke();
        }
        for (let x = 15; x < canvas.width; x += 30) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, canvas.height);
          ctx.stroke();
        }

        // Laser scan sweep line
        laserY += 2.5 * laserDirection;
        if (laserY >= canvas.height) {
          laserY = canvas.height;
          laserDirection = -1;
        } else if (laserY <= 0) {
          laserY = 0;
          laserDirection = 1;
        }

        const detection = latestDetectionRef.current;

        if (detection) {
          const { box, landmarks } = detection;

          const scaleX = canvas.width / video.videoWidth;
          const scaleY = canvas.height / video.videoHeight;

          const x = box.x * scaleX;
          const y = box.y * scaleY;
          const w = box.width * scaleX;
          const h = box.height * scaleY;

          // Read state from ref to avoid closures issues
          const recState = recognitionStateRef.current;
          const isAuthorized = recState.isAuthorized;

          // Draw HUD face frame corner brackets
          ctx.strokeStyle = isAuthorized ? "rgba(34, 197, 94, 0.8)" : "rgba(239, 68, 68, 0.8)";
          ctx.lineWidth = 2;
          
          const len = 12;
          ctx.beginPath(); ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x + w, y + len); ctx.lineTo(x + w, y); ctx.lineTo(x + w - len, y); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x, y + h - len); ctx.lineTo(x, y + h); ctx.lineTo(x + len, y + h); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x + w, y + h - len); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - len, y + h); ctx.stroke();

          // Glowing face background
          ctx.fillStyle = isAuthorized ? "rgba(34, 197, 94, 0.04)" : "rgba(239, 68, 68, 0.04)";
          ctx.fillRect(x, y, w, h);

          // Draw facial landmarks
          const pts = landmarks.positions;
          ctx.fillStyle = isAuthorized ? "rgba(34, 197, 94, 0.9)" : "rgba(239, 68, 68, 0.9)";
          for (const pt of pts) {
            ctx.beginPath();
            ctx.arc(pt.x * scaleX, pt.y * scaleY, 1.2, 0, 2 * Math.PI);
            ctx.fill();
          }

          // Draw facial mesh connections
          ctx.strokeStyle = isAuthorized ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)";
          ctx.lineWidth = 1;
          const mappedPts = pts.map((p: any) => ({ x: p.x * scaleX, y: p.y * scaleY }));
          drawMesh(ctx, mappedPts);

          // Scanning laser inside face box
          ctx.strokeStyle = isAuthorized ? "rgba(34, 197, 94, 0.6)" : "rgba(239, 68, 68, 0.6)";
          ctx.beginPath();
          const laserFaceY = y + (laserY % h);
          ctx.moveTo(x, laserFaceY);
          ctx.lineTo(x + w, laserFaceY);
          ctx.stroke();

          // Draw HUD text overlays
          ctx.fillStyle = isAuthorized ? "#22c55e" : "#ef4444";
          ctx.font = "bold 9px monospace";
          const statusText = isAuthorized ? `AUTHORIZED: ${recState.name!.toUpperCase()}` : "UNAUTHORIZED SUBJECT DETECTED";
          ctx.fillText(statusText, x, y - 6);

          ctx.font = "8px monospace";
          ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
          const confVal = isAuthorized && recState.confidence !== null ? (100 * recState.confidence).toFixed(1) + "%" : "N/A";
          ctx.fillText(`CONF: ${confVal}`, x, y + h + 10);
          ctx.fillText(`LOC: ${Math.round(x)}, ${Math.round(y)}`, x, y + h + 18);
        } else {
          // Sweeping laser lines
          ctx.strokeStyle = "rgba(6, 182, 212, 0.35)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, laserY);
          ctx.lineTo(canvas.width, laserY);
          ctx.stroke();

          // Targeting reticle
          ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
          ctx.beginPath();
          ctx.arc(canvas.width / 2, canvas.height / 2, 20, 0, 2 * Math.PI);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(canvas.width / 2 - 28, canvas.height / 2);
          ctx.lineTo(canvas.width / 2 + 28, canvas.height / 2);
          ctx.moveTo(canvas.width / 2, canvas.height / 2 - 28);
          ctx.lineTo(canvas.width / 2, canvas.height / 2 + 28);
          ctx.stroke();
        }

        animationFrameId = requestAnimationFrame(drawHUD);
      };

      drawHUD();
    };

    startDetectionLoop();
    startDrawingLoop();

    return () => {
      active = false;
      cancelAnimationFrame(animationFrameId);
      clearTimeout(detectionTimeoutId);
      if (unknownFaceTimerRef.current) {
        clearTimeout(unknownFaceTimerRef.current);
      }
    };
  }, [showCamera, faceReady, settings.strictMode, matchAgainstStored]);

  const fetchSecurityData = async () => {
    try {
      const response = await fetch("/api/security");
      const data = await response.json();
      if (data.success) {
        setSettings(data.settings);
        setAuthorizedFaces(data.faces || []);
        setEvents(data.events || []);
      }
    } catch (err) {
      console.error("Failed to load security data:", err);
      setError("Failed to load security data");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSecurity = async () => {
    const newEnabled = !settings.enabled;
    try {
      const response = await fetch("/api/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle",
          data: { enabled: newEnabled },
        }),
      });

      const data = await response.json();
      if (data.success) {
        setSettings((prev) => ({ ...prev, enabled: newEnabled }));
        setSuccessMessage(
          `Security system ${newEnabled ? "enabled" : "disabled"}`
        );
        setTimeout(() => setSuccessMessage(null), 3000);
        fetchSecurityData();
      }
    } catch (err) {
      setError("Failed to toggle security");
    }
  };

  const updateSettings = async (newSettings: Partial<SecuritySettings>) => {
    try {
      const response = await fetch("/api/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "settings",
          data: newSettings,
        }),
      });

      const data = await response.json();
      if (data.success) {
        setSettings(data.settings);
      }
    } catch (err) {
      setError("Failed to update settings");
    }
  };

  const handleStartCamera = async () => {
    try {
      await startCamera();
      setShowCamera(true);
      setError(null);
    } catch (err) {
      setError("Failed to access camera");
    }
  };

  const handleStopCamera = () => {
    stopCamera();
    setShowCamera(false);
  };

  const handleRegisterWithCamera = async () => {
    if (!newFaceName.trim()) {
      setError("Please enter a name");
      return;
    }

    if (!faceReady) {
      setError("Face recognition not ready. Please wait.");
      return;
    }

    setIsRegistering(true);
    setError(null);

    try {
      // Capture face and register
      const result = await registerFace(newFaceName);

      if (result.success) {
        setAuthorizedFaces((prev) => [
          ...prev,
          { id: result.face.id, name: result.face.name, createdAt: result.face.createdAt },
        ]);
        setNewFaceName("");
        setSuccessMessage(`Face registered for ${result.face.name}`);
        setTimeout(() => setSuccessMessage(null), 3000);
        handleStopCamera();
        fetchSecurityData();
      } else {
        setError(result.error || "Registration failed");
      }
    } catch (err) {
      setError("Failed to register face");
    } finally {
      setIsRegistering(false);
    }
  };

  const registerFaceDemo = async () => {
    // For demo/testing without camera - uses mock descriptor
    if (!newFaceName.trim()) {
      setError("Please enter a name");
      return;
    }

    setIsRegistering(true);
    setError(null);

    try {
      const mockDescriptor = Array.from({ length: 128 }, () =>
        Math.random() * 2 - 1
      );

      const response = await fetch("/api/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          data: { name: newFaceName, descriptor: mockDescriptor },
        }),
      });

      const data = await response.json();
      if (data.success) {
        setAuthorizedFaces((prev) => [
          ...prev,
          { id: data.face.id, name: data.face.name, createdAt: data.face.createdAt },
        ]);
        setNewFaceName("");
        setSuccessMessage(`Face registered for ${data.face.name}`);
        setTimeout(() => setSuccessMessage(null), 3000);
        fetchSecurityData();
      } else {
        setError(data.error || "Registration failed");
      }
    } catch (err) {
      setError("Failed to register face");
    } finally {
      setIsRegistering(false);
    }
  };

  const removeFace = async (faceId: string) => {
    try {
      const response = await fetch("/api/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove",
          data: { faceId },
        }),
      });

      const data = await response.json();
      if (data.success) {
        setAuthorizedFaces((prev) => prev.filter((f) => f.id !== faceId));
        setSuccessMessage(`Removed face for ${data.removed}`);
        setTimeout(() => setSuccessMessage(null), 3000);
        fetchSecurityData();
      }
    } catch (err) {
      setError("Failed to remove face");
    }
  };

  const activateDemo = async () => {
    try {
      const response = await fetch("/api/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "demo" }),
      });

      const data = await response.json();
      if (data.success) {
        setSettings((prev) => ({ ...prev, enabled: true }));
        fetchSecurityData();
        setSuccessMessage("Demo mode activated with sample faces");
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err) {
      setError("Failed to activate demo mode");
    }
  };

  const getEventIcon = (type: SecurityEvent["type"]) => {
    switch (type) {
      case "access_granted":
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case "access_denied":
        return <AlertTriangle className="w-4 h-4 text-red-400" />;
      case "system_enabled":
        return <ShieldCheck className="w-4 h-4 text-cyan-400" />;
      case "system_disabled":
        return <Shield className="w-4 h-4 text-white/40" />;
      case "face_registered":
        return <UserPlus className="w-4 h-4 text-green-400" />;
      case "face_removed":
        return <UserMinus className="w-4 h-4 text-yellow-400" />;
      default:
        return <Shield className="w-4 h-4 text-white/40" />;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 400 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 400 }}
      className="fixed right-0 top-0 h-full w-96 bg-panel-bg/95 backdrop-blur-sm border-l border-panel-border z-50 flex flex-col"
    >
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
        </div>
      ) : (
        <>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              settings.enabled
                ? "bg-gradient-to-br from-green-500 to-cyan-600"
                : "bg-gradient-to-br from-gray-500 to-gray-600"
            }`}
          >
            {settings.enabled ? (
              <ShieldCheck className="w-5 h-5 text-white" />
            ) : (
              <Shield className="w-5 h-5 text-white" />
            )}
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Face Recognition Security</h2>
            <p className="text-sm text-white/60">
              {settings.enabled ? "System Active" : "System Inactive"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleSecurity}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
              settings.enabled
                ? "bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30"
                : "bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30"
            }`}
          >
            <Power className="w-4 h-4" />
            {settings.enabled ? "ON" : "OFF"}
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5 text-white/70" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Status Messages */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="p-3 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 text-sm"
            >
              {error}
            </motion.div>
          )}
          {successMessage && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="p-3 rounded-lg bg-green-500/20 border border-green-500/30 text-green-400 text-sm"
            >
              {successMessage}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Camera Preview */}
        <AnimatePresence>
          {showCamera && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden rounded-lg border border-cyan-500/30"
            >
              <div className="relative bg-black rounded-lg overflow-hidden">
                <video
                  ref={videoRef as React.RefObject<HTMLVideoElement>}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-48 object-cover"
                />
                <canvas
                  ref={canvasRef}
                  className="absolute top-0 left-0 w-full h-full pointer-events-none"
                />
                {/* Sleek hologram info bar */}
                <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/85 to-black/0 p-2 flex justify-between items-end text-[10px] font-mono pointer-events-none text-cyan-400">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-ping" />
                      <span>HUD: ACTIVE</span>
                    </div>
                    <div className="text-white/60">STATUS: {detectedStatus}</div>
                  </div>
                  {matchName && (
                    <div className="text-right">
                      <div className="text-green-400 font-bold">MATCH: {matchName}</div>
                      {confidence !== null && (
                        <div className="text-white/60">CONFIDENCE: {(confidence * 100).toFixed(1)}%</div>
                      )}
                    </div>
                  )}
                </div>
                <div className="absolute top-2 left-2 flex items-center gap-2">
                  <span className="px-2 py-1 bg-red-500 text-white text-xs rounded flex items-center gap-1">
                    <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                    LIVE
                  </span>
                  {!faceReady && faceLoading && (
                    <span className="px-2 py-1 bg-yellow-500 text-black text-xs rounded flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Loading models...
                    </span>
                  )}
                </div>
                <button
                  onClick={handleStopCamera}
                  className="absolute top-2 right-2 p-2 bg-black/50 text-white rounded-lg hover:bg-black/70"
                >
                  <VideoOff className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Status Card */}
        <div className="p-4 rounded-lg bg-white/5 border border-white/10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center ${
                  settings.enabled
                    ? "bg-green-500/20 animate-pulse"
                    : "bg-gray-500/20"
                }`}
              >
                {settings.enabled ? (
                  <Lock className="w-6 h-6 text-green-400" />
                ) : (
                  <Unlock className="w-6 h-6 text-gray-400" />
                )}
              </div>
              <div>
                <p className="text-lg font-medium text-white">
                  {settings.enabled ? "Protected" : "Unprotected"}
                </p>
                <p className="text-sm text-white/60">
                  {authorizedFaces.length} authorized face
                  {authorizedFaces.length !== 1 ? "s" : ""} registered
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
            >
              <Settings className="w-4 h-4 text-white/60" />
            </button>
          </div>

          <AnimatePresence>
            {showSettings && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="space-y-3 pt-4 border-t border-white/10"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/70">Strict Mode</span>
                  <button
                    onClick={() =>
                      updateSettings({ strictMode: !settings.strictMode })
                    }
                    className={`w-12 h-6 rounded-full transition-colors ${
                      settings.strictMode ? "bg-cyan-500" : "bg-white/20"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-white transition-transform ${
                        settings.strictMode ? "translate-x-6" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/70">Auto-lock Timeout</span>
                  <select
                    value={settings.autoLockTimeout}
                    onChange={(e) =>
                      updateSettings({
                        autoLockTimeout: parseInt(e.target.value),
                      })
                    }
                    className="bg-white/5 border border-white/10 rounded px-3 py-1 text-sm text-white"
                  >
                    <option value={1}>1 minute</option>
                    <option value={5}>5 minutes</option>
                    <option value={15}>15 minutes</option>
                    <option value={30}>30 minutes</option>
                  </select>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Authorized Faces */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white/70">Authorized Faces</h3>
            <button
              onClick={activateDemo}
              className="text-xs text-cyan-400 hover:text-cyan-300"
            >
              Load Demo
            </button>
          </div>

          {/* Add New Face */}
          <div className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-3">
            <input
              type="text"
              value={newFaceName}
              onChange={(e) => setNewFaceName(e.target.value)}
              placeholder="Enter name..."
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50"
            />

            <div className="flex gap-2">
              {!showCamera ? (
                <button
                  onClick={handleStartCamera}
                  disabled={!faceReady || isRegistering}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm hover:from-cyan-400 hover:to-blue-500 transition-all disabled:opacity-50"
                >
                  {faceLoading && !faceReady ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Camera className="w-4 h-4" />
                      Scan Face
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={handleRegisterWithCamera}
                  disabled={isRegistering || !newFaceName.trim() || !faceReady}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 text-white text-sm hover:from-green-400 hover:to-emerald-500 transition-all disabled:opacity-50"
                >
                  {isRegistering ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Scan className="w-4 h-4" />
                      Capture & Register
                    </>
                  )}
                </button>
              )}

              <button
                onClick={registerFaceDemo}
                disabled={isRegistering || !newFaceName.trim()}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white/10 text-white/70 text-sm hover:bg-white/20 transition-all disabled:opacity-50"
                title="Demo mode - registers without camera"
              >
                <UserPlus className="w-4 h-4" />
                Demo
              </button>
            </div>

            {faceReady && (
              <p className="text-xs text-cyan-400/60 text-center">
                Using face-api.js for real face recognition
              </p>
            )}
          </div>

          {/* Face List */}
          <div className="space-y-2">
            {authorizedFaces.length === 0 ? (
              <p className="text-sm text-white/40 text-center py-4">
                No authorized faces registered
              </p>
            ) : (
              authorizedFaces.map((face) => (
                <div
                  key={face.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                      <span className="text-sm font-medium text-white">
                        {face.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm text-white">{face.name}</p>
                      <p className="text-xs text-white/40">
                        {new Date(face.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => removeFace(face.id)}
                    className="p-2 rounded-lg hover:bg-red-500/20 transition-colors"
                  >
                    <UserMinus className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Event Log */}
        <div className="mt-6 pt-6 border-t border-white/10">
          <button
            onClick={() => setShowEvents(!showEvents)}
            className="flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors"
          >
            <History className="w-4 h-4" />
            Security Events ({events.length})
          </button>

          <AnimatePresence>
            {showEvents && events.length > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mt-4 space-y-2 overflow-hidden"
              >
                {events.slice(0, 10).map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center gap-3 p-2 rounded-lg bg-white/5 border border-white/10"
                  >
                    {getEventIcon(event.type)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white/80 truncate">
                        {event.details}
                      </p>
                      <p className="text-xs text-white/40">
                        {new Date(event.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-white/10">
        <p className="text-xs text-white/40 text-center">
          Face recognition powered by face-api.js · All data stored locally
        </p>
      </div>
      </>
      )}
    </motion.div>
  );
}