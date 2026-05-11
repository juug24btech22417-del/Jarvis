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
    videoRef,
    isCameraActive,
  } = useFaceRecognition();

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

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
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
    </div>
  );
}