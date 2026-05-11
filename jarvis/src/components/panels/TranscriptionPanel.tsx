"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  Square,
  Upload,
  Clock,
  Languages,
  Save,
  Trash2,
  Play,
  Pause,
  FileText,
  ChevronDown,
  ChevronUp,
  X,
  Loader2,
  History,
  Download,
  Users,
} from "lucide-react";

interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

interface TranscriptionResult {
  id: string;
  text: string;
  segments: TranscriptionSegment[];
  language: string;
  duration: number;
  createdAt: string;
}

interface TranscriptionPanelProps {
  onClose: () => void;
}

export default function TranscriptionPanel({
  onClose,
}: TranscriptionPanelProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isBotLive, setIsBotLive] = useState(false);
  const [liveTranscription, setLiveTranscription] = useState("");
  const [botStatus, setBotStatus] = useState("Idle");
  const [summary, setSummary] = useState<{
    summary: string;
    decisions: string[];
    actionItems: { task: string; due: string; priority: number }[];
  } | null>(null);
  const [activeTab, setActiveTab] = useState<"transcript" | "summary">("transcript");

  const [currentTranscription, setCurrentTranscription] =
    useState<TranscriptionResult | null>(null);
  const [savedTranscriptions, setSavedTranscriptions] = useState<
    TranscriptionResult[]
  >([]);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedTranscription, setSelectedTranscription] =
    useState<TranscriptionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load saved transcriptions
  useEffect(() => {
    fetchSavedTranscriptions();
  }, []);

  const fetchSavedTranscriptions = async () => {
    try {
      const response = await fetch("/api/transcribe");
      const data = await response.json();
      if (data.success) {
        setSavedTranscriptions(data.transcriptions);
      }
    } catch (err) {
      console.error("Failed to load transcriptions:", err);
    }
  };

  // Recording timer
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRecording]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm",
      });

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await processAudio(blob, "recording.webm");
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start(1000); // Collect data every second
      setIsRecording(true);
      setRecordingTime(0);
      setError(null);
    } catch (err) {
      setError("Could not access microphone. Please check permissions.");
      console.error("Recording error:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const processAudio = async (blob: Blob, filename: string) => {
    setIsProcessing(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", blob, filename);

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
        setCurrentTranscription(data.transcription);
        setSuccessMessage(
          data.demo ? "Demo transcription generated" : "Transcription complete!"
        );
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        setError(data.error || "Transcription failed");
      }
    } catch (err) {
      setError("Failed to transcribe audio");
      console.error("Transcription error:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 25 * 1024 * 1024) {
        setError("File too large. Maximum size is 25MB.");
        return;
      }
      processAudio(file, file.name);
    }
  };

  const saveTranscription = async () => {
    if (!currentTranscription) return;

    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          transcription: currentTranscription,
        }),
      });

      const data = await response.json();
      if (data.success) {
        setSavedTranscriptions((prev) => [data.transcription, ...prev]);
        setSuccessMessage("Transcription saved!");
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err) {
      setError("Failed to save transcription");
    }
  };

  const deleteTranscription = async (id: string) => {
    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          transcription: { id },
        }),
      });

      if (response.ok) {
        setSavedTranscriptions((prev) => prev.filter((t) => t.id !== id));
        if (selectedTranscription?.id === id) {
          setSelectedTranscription(null);
        }
      }
    } catch (err) {
      setError("Failed to delete transcription");
    }
  };

  const generateDemo = async () => {
    setIsProcessing(true);
    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "demo" }),
      });

      const data = await response.json();
      if (data.success) {
        setCurrentTranscription(data.transcription);
        setSavedTranscriptions((prev) => [data.transcription, ...prev]);
        setSuccessMessage("Demo meeting transcription created!");
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err) {
      setError("Failed to generate demo");
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadTranscript = (transcription: TranscriptionResult) => {
    const content = `[Meeting Transcription]
Date: ${new Date(transcription.createdAt).toLocaleString()}
Duration: ${formatTime(Math.floor(transcription.duration))}
Language: ${transcription.language}

Full Text:
${transcription.text}

--- Segments ---
${transcription.segments
  .map(
    (seg) =>
      `[${formatTime(Math.floor(seg.start))}] ${seg.speaker || "Speaker"}: ${
        seg.text
      }`
  )
  .join("\n")}`;

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meeting-${transcription.id}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const renderRecordingInterface = () => (
    <div className="flex flex-col items-center justify-center py-12 space-y-6">
      <div className="relative">
        <motion.div
          animate={
            isRecording
              ? {
                  scale: [1, 1.2, 1],
                  opacity: [0.5, 0.8, 0.5],
                }
              : {}
          }
          transition={{
            duration: 1.5,
            repeat: isRecording ? Infinity : 0,
          }}
          className={`absolute inset-0 rounded-full ${
            isRecording ? "bg-red-500/30" : ""
          }`}
        />
        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isProcessing}
          className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-all ${
            isRecording
              ? "bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/50"
              : "bg-gradient-to-br from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 shadow-lg shadow-cyan-500/30"
          } disabled:opacity-50`}
        >
          {isRecording ? (
            <Square className="w-10 h-10 text-white" fill="white" />
          ) : (
            <Mic className="w-10 h-10 text-white" />
          )}
        </button>
      </div>

      <div className="text-center space-y-2">
        <p className="text-3xl font-mono font-bold text-white">
          {formatTime(recordingTime)}
        </p>
        <p className="text-sm text-white/60">
          {isRecording
            ? "Recording... Click stop when done"
            : "Click to start recording"}
        </p>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing || isRecording}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 transition-colors disabled:opacity-50"
        >
          <Upload className="w-4 h-4" />
          Upload Audio
        </button>

        <button
          onClick={generateDemo}
          disabled={isProcessing || isRecording}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 transition-colors disabled:opacity-50"
        >
          <FileText className="w-4 h-4" />
          Load Demo
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        onChange={handleFileUpload}
        className="hidden"
      />
    </div>
  );

  const renderTranscriptionResult = () => {
    if (!currentTranscription) return null;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-white/60">
              <Clock className="w-4 h-4" />
              {formatTime(Math.floor(currentTranscription.duration))}
            </div>
            <div className="flex items-center gap-2 text-sm text-white/60">
              <Languages className="w-4 h-4" />
              {currentTranscription.language}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadTranscript(currentTranscription)}
              className="p-2 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 transition-colors"
              title="Download transcript"
            >
              <Download className="w-4 h-4" />
            </button>

            <button
              onClick={saveTranscription}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-400 hover:to-blue-500 transition-all"
            >
              <Save className="w-4 h-4" />
              Save
            </button>
          </div>
        </div>

        <div className="p-4 rounded-lg bg-white/5 border border-white/10 max-h-64 overflow-y-auto">
          <p className="text-white/90 whitespace-pre-wrap leading-relaxed">
            {currentTranscription.text}
          </p>
        </div>

        {currentTranscription.segments.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-white/60 flex items-center gap-2">
              <Users className="w-4 h-4" />
              Segments
            </h4>
            <div className="max-h-48 overflow-y-auto space-y-2">
              {currentTranscription.segments.map((seg, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg bg-white/5 border border-white/10"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-xs font-mono text-white/40 shrink-0">
                      {formatTime(Math.floor(seg.start))}
                    </span>
                    <div className="flex-1">
                      {seg.speaker && (
                        <span className="text-xs font-medium text-cyan-400">
                          {seg.speaker}:
                        </span>
                      )}
                      <p className="text-sm text-white/80">{seg.text}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
            <Mic className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Meeting Transcription</h2>
            <p className="text-sm text-white/60">
              Record or upload meetings for transcription
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-white/10 transition-colors"
        >
          <X className="w-5 h-5 text-white/70" />
        </button>
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

        {/* Recording Interface */}
        {!currentTranscription && renderRecordingInterface()}

        {isBotLive && (
          <div className="p-4 rounded-lg bg-cyan-500/10 border border-cyan-500/30 max-h-64 overflow-y-auto">
            <div className="flex items-center gap-2 text-xs font-bold text-cyan-400 mb-2">
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              LIVE TRANSCRIPTION
            </div>
            <p className="text-white/90 whitespace-pre-wrap leading-relaxed text-sm">
              {liveTranscription || "Waiting for audio from meeting..."}
            </p>
          </div>
        )}
        {/* Processing State */}

        {isProcessing && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="w-12 h-12 text-cyan-400 animate-spin" />
            <p className="text-white/70">Transcribing your meeting...This may take a moment.</p>
            <p className="text-sm text-white/50">Using Whisper AI for accurate transcription</p>
          </div>
        )}

        {/* Transcription Result */}
        {currentTranscription && !isProcessing && renderTranscriptionResult()}

        {/* History Section */}
        <div className="mt-8 pt-6 border-t border-white/10">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors"
          >
            <History className="w-4 h-4" />
            Saved Transcriptions ({savedTranscriptions.length})
            {showHistory ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>

          <AnimatePresence>
            {showHistory && savedTranscriptions.length > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mt-4 space-y-2 overflow-hidden"
              >
                {savedTranscriptions.map((trans) => (
                  <div
                    key={trans.id}
                    className="p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors cursor-pointer group"
                    onClick={() => {
                      setSelectedTranscription(
                        selectedTranscription?.id === trans.id ? null : trans
                      );
                      setCurrentTranscription(trans);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white/90 truncate">
                          Meeting {new Date(trans.createdAt).toLocaleString()}
                        </p>
                        <p className="text-xs text-white/50">
                          {formatTime(Math.floor(trans.duration))} ·{" "}
                          {trans.segments.length} segments
                        </p>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTranscription(trans.id);
                        }}
                        className="p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/20 transition-all"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
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
          Supports: WebM, MP3, WAV, M4A (max 25MB) · Powered by OpenAI Whisper
        </p>
      </div>
    </div>
  );
}
