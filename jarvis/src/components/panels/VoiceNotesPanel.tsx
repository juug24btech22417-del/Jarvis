"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  Square,
  Play,
  Pause,
  Trash2,
  Download,
  X,
  AudioWaveform,
  Clock,
} from "lucide-react";
import gsap from "gsap";

interface VoiceMemo {
  id: string;
  filename: string;
  created: string;
  transcript?: string;
  duration?: number;
  audioUrl?: string;
}

interface VoiceNotesPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function VoiceNotesPanel({ isOpen, onClose }: VoiceNotesPanelProps) {
  const [memos, setMemos] = useState<VoiceMemo[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Fetch existing memos
  const fetchMemos = useCallback(async () => {
    try {
      const response = await fetch("/api/voicememos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list" }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setMemos(data.memos);
        }
      }
    } catch (err) {
      console.error("Failed to fetch memos:", err);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchMemos();
      gsap.fromTo(
        ".voice-notes-panel",
        { opacity: 0, scale: 0.95, y: 20 },
        { opacity: 1, scale: 1, y: 0, duration: 0.3, ease: "power2.out" }
      );
    }
  }, [isOpen, fetchMemos]);

  // Recording timer
  useEffect(() => {
    if (isRecording) {
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } else {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    }
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, [isRecording]);

  // Format time
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Start recording
  const startRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Set up audio visualization
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);

      // Start visualization
      visualizeAudio();

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4",
      });

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        await saveRecording(audioBlob);

        // Stop visualization
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        if (audioContextRef.current) {
          audioContextRef.current.close();
        }

        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
    } catch (err) {
      console.error("Failed to start recording:", err);
      setError("Microphone access denied or not available");
    }
  };

  // Visualize audio
  const visualizeAudio = () => {
    if (!canvasRef.current || !analyserRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!isRecording) return;

      animationFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.fillStyle = "rgba(10, 15, 30, 0.3)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * canvas.height;

        const gradient = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
        gradient.addColorStop(0, "#00d4ff");
        gradient.addColorStop(1, "#7ee8fa");

        ctx.fillStyle = gradient;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

        x += barWidth + 1;
      }
    };

    draw();
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // Save recording
  const saveRecording = async (audioBlob: Blob) => {
    setIsLoading(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = async () => {
        const base64Audio = (reader.result as string).split(",")[1];

        const response = await fetch("/api/voicememos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save",
            audioBase64: base64Audio,
            filename: `memo-${Date.now()}`,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            await fetchMemos();
          }
        }
        setIsLoading(false);
      };
    } catch (err) {
      console.error("Failed to save recording:", err);
      setIsLoading(false);
    }
  };

  // Play memo
  const playMemo = async (memo: VoiceMemo) => {
    try {
      // Stop current playback
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      // Get audio data
      const response = await fetch("/api/voicememos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "get",
          filename: memo.filename,
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        const audio = new Audio(url);
        audioRef.current = audio;

        audio.onended = () => {
          setPlayingId(null);
          setCurrentTime(0);
        };

        audio.ontimeupdate = () => {
          setCurrentTime(audio.currentTime);
        };

        await audio.play();
        setPlayingId(memo.id);
      }
    } catch (err) {
      console.error("Failed to play memo:", err);
    }
  };

  // Pause memo
  const pauseMemo = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setPlayingId(null);
    }
  };

  // Delete memo
  const deleteMemo = async (memo: VoiceMemo) => {
    try {
      const response = await fetch("/api/voicememos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          filename: memo.filename,
        }),
      });

      if (response.ok) {
        setMemos((prev) => prev.filter((m) => m.id !== memo.id));
      }
    } catch (err) {
      console.error("Failed to delete memo:", err);
    }
  };

  // Download memo
  const downloadMemo = async (memo: VoiceMemo) => {
    try {
      const response = await fetch("/api/voicememos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "get",
          filename: memo.filename,
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = memo.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("Failed to download memo:", err);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (mediaRecorderRef.current && isRecording) {
        mediaRecorderRef.current.stop();
      }
    };
  }, [isRecording]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.2 }}
          className="voice-notes-panel w-full max-w-lg mx-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="holographic-panel p-6 max-h-[80vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-reactor-core/20">
                  <AudioWaveform className="w-6 h-6 text-reactor-core" />
                </div>
                <div>
                  <h2 className="font-orbitron text-reactor-core font-bold text-lg">
                    VOICE NOTES
                  </h2>
                  <p className="font-rajdhani text-text-secondary text-sm">
                    {memos.length} {memos.length === 1 ? "recording" : "recordings"}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-panel-glass rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-text-secondary" />
              </button>
            </div>

            {/* Error */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-4 p-3 bg-accent-red/20 border border-accent-red/50 rounded-lg"
              >
                <p className="text-accent-red text-sm">{error}</p>
              </motion.div>
            )}

            {/* Recording Section */}
            <div className="mb-6 p-4 bg-panel-glass/50 rounded-xl border border-panel-border">
              {/* Visualizer */}
              <canvas
                ref={canvasRef}
                width={400}
                height={60}
                className="w-full h-16 rounded-lg bg-deep-space/50 mb-4"
              />

              {/* Recording Controls */}
              <div className="flex items-center justify-center gap-4">
                {!isRecording ? (
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={startRecording}
                    disabled={isLoading}
                    className="flex items-center gap-2 px-6 py-3 bg-accent-red hover:bg-accent-red/80 rounded-full font-orbitron text-white transition-colors disabled:opacity-50"
                  >
                    <Mic className="w-5 h-5" />
                    RECORD
                  </motion.button>
                ) : (
                  <>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2 text-accent-red">
                        <motion.div
                          animate={{ scale: [1, 1.2, 1] }}
                          transition={{ duration: 1, repeat: Infinity }}
                          className="w-3 h-3 rounded-full bg-accent-red"
                        />
                        <Clock className="w-4 h-4" />
                        <span className="font-orbitron text-xl">
                          {formatTime(recordingTime)}
                        </span>
                      </div>
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={stopRecording}
                        className="flex items-center gap-2 px-6 py-3 bg-text-secondary hover:bg-text-secondary/80 rounded-full font-orbitron text-deep-space"
                      >
                        <Square className="w-5 h-5 fill-current" />
                        STOP
                      </motion.button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Memos List */}
            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {memos.length === 0 ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-center py-8"
                  >
                    <AudioWaveform className="w-12 h-12 text-text-secondary/30 mx-auto mb-3" />
                    <p className="text-text-secondary/50 font-rajdhani">
                      No voice recordings yet.
                    </p>
                    <p className="text-text-secondary/30 text-sm">
                      Click record to start capturing audio.
                    </p>
                  </motion.div>
                ) : (
                  memos.map((memo, index) => (
                    <motion.div
                      key={memo.id}
                      layout
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      transition={{ delay: index * 0.05 }}
                      className="flex items-center gap-3 p-3 bg-panel-glass/30 rounded-lg border border-panel-border/50 hover:border-reactor-core/50 transition-colors"
                    >
                      {/* Play/Pause Button */}
                      <button
                        onClick={() =>
                          playingId === memo.id ? pauseMemo() : playMemo(memo)
                        }
                        className="p-2 rounded-full bg-reactor-core/20 hover:bg-reactor-core/40 transition-colors"
                      >
                        {playingId === memo.id ? (
                          <Pause className="w-4 h-4 text-reactor-core" />
                        ) : (
                          <Play className="w-4 h-4 text-reactor-core" />
                        )}
                      </button>

                      {/* Memo Info */}
                      <div className="flex-1 min-w-0">
                        <p className="font-rajdhani text-text-secondary text-sm truncate">
                          {memo.filename.replace("memo-", "Recording ")}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-text-secondary/50">
                          <Clock className="w-3 h-3" />
                          <span>
                            {new Date(memo.created).toLocaleString("en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => downloadMemo(memo)}
                          className="p-2 hover:bg-panel-glass rounded transition-colors"
                          title="Download"
                        >
                          <Download className="w-4 h-4 text-text-secondary" />
                        </button>
                        <button
                          onClick={() => deleteMemo(memo)}
                          className="p-2 hover:bg-accent-red/20 rounded transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4 text-accent-red" />
                        </button>
                      </div>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>

            {/* Footer */}
            <div className="mt-6 pt-4 border-t border-panel-border text-center">
              <p className="text-xs text-text-secondary/40">
                Recordings are saved locally and persist across sessions
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
