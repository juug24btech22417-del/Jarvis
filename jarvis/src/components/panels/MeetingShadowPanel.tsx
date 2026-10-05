"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Ear,
  Mic,
  MicOff,
  Volume2,
  Sparkles,
  Shield,
  HelpCircle,
  TrendingUp,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  MessageSquare,
  Radio,
  Zap,
} from "lucide-react";
import { useJarvisStore } from "@/store/jarvis.store";

interface ShadowResponse {
  summary: string;
  talkingPoints: string[];
  counterArguments: string[];
  factsAndStats: string[];
  questionsToAsk: string[];
  whisperSoundbite: string;
}

export default function MeetingShadowPanel() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [meetingTopic, setMeetingTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ShadowResponse | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<string | null>(null);
  const [whispering, setWhispering] = useState(false);
  const [autoShadow, setAutoShadow] = useState(true);
  const [meetingBotSync, setMeetingBotSync] = useState(false);

  const recognitionRef = useRef<any>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Poll MeetingBot for live captions if sync is active
  useEffect(() => {
    if (!meetingBotSync) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/meeting");
        const json = await res.json();
        if (json.isActive && json.captions && json.captions.length > 0) {
          const recentText = json.captions
            .slice(-10)
            .map((c: any) => `${c.speaker || "Attendee"}: ${c.text}`)
            .join("\n");
          if (recentText && recentText !== transcript) {
            setTranscript(recentText);
            fetchShadow(recentText);
          }
        }
      } catch {}
    }, 4000);

    return () => clearInterval(interval);
  }, [meetingBotSync, transcript]);

  // Setup Web Speech API for live microphone transcript
  useEffect(() => {
    if (typeof window !== "undefined" && ("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";

      rec.onresult = (event: any) => {
        let finalTrans = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTrans += event.results[i][0].transcript + " ";
          }
        }
        if (finalTrans.trim()) {
          setTranscript((prev) => {
            const next = (prev + " " + finalTrans).trim().slice(-3500);
            if (autoShadow) {
              if (debounceRef.current) clearTimeout(debounceRef.current);
              debounceRef.current = setTimeout(() => fetchShadow(next), 2200);
            }
            return next;
          });
        }
      };

      rec.onerror = (e: any) => {
        console.warn("[MeetingShadow] Speech recognition error:", e);
      };

      rec.onend = () => {
        if (isListening) {
          try {
            rec.start();
          } catch {}
        }
      };

      recognitionRef.current = rec;
    }
  }, [isListening, autoShadow]);

  const toggleMic = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition is not supported in this browser. You can type or paste meeting snippets.");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        console.error("Mic start failed", e);
      }
    }
  };

  const fetchShadow = async (textToUse?: string) => {
    const text = textToUse || transcript;
    if (!text.trim()) return;

    setLoading(true);
    try {
      const res = await fetch("/api/meeting/shadow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcriptSnippet: text,
          meetingTopic: meetingTopic || undefined,
        }),
      });

      const resData = await res.json();
      if (resData.success) {
        setData(resData);
      }
    } catch (e) {
      console.error("[MeetingShadow] Error:", e);
    } finally {
      setLoading(false);
    }
  };

  const whisper = (text: string) => {
    if (!window.speechSynthesis) return;
    if (whispering) {
      window.speechSynthesis.cancel();
      setWhispering(false);
      return;
    }

    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.1;
    utter.pitch = 0.95;
    utter.volume = 0.6; // private whisper volume
    utter.onend = () => setWhispering(false);
    utter.onerror = () => setWhispering(false);
    setWhispering(true);
    window.speechSynthesis.speak(utter);
  };

  const copyItem = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(id);
    setTimeout(() => setCopiedIdx(null), 1800);
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-4 md:p-6 space-y-6 font-rajdhani text-white">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-zinc-950/80 border border-cyan-500/30 shadow-[0_0_30px_rgba(6,182,212,0.15)]">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-cyan-950/80 border border-cyan-500/50 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
            <Ear className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-orbitron text-xl md:text-2xl font-bold tracking-wider text-cyan-300">
                REAL-TIME MEETING SHADOW
              </h1>
              <span className="px-2 py-0.5 rounded text-[11px] font-mono tracking-widest bg-cyan-950/80 border border-cyan-500/40 text-cyan-300">
                PRIVATE EARPIECE AI
              </span>
            </div>
            <p className="text-xs text-zinc-400 tracking-wide mt-0.5">
              Live stealth briefing during calls: talking points, counter-arguments, verified benchmarks &amp; high-IQ questions.
            </p>
          </div>
        </div>

        {/* Live Controls */}
        <div className="flex items-center flex-wrap gap-2.5">
          <button
            onClick={() => setMeetingBotSync(!meetingBotSync)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-all ${
              meetingBotSync
                ? "bg-cyan-950/80 border-cyan-400 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.3)]"
                : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            {meetingBotSync ? "Meet Bot Sync: ON" : "Sync Meet Bot"}
          </button>

          <button
            onClick={toggleMic}
            className={`px-4 py-2 rounded-xl text-xs font-bold font-orbitron flex items-center gap-2 border transition-all ${
              isListening
                ? "bg-rose-950/80 border-rose-500 text-rose-300 shadow-[0_0_20px_rgba(244,63,94,0.4)] animate-pulse"
                : "bg-cyan-950/60 border-cyan-500/40 text-cyan-300 hover:bg-cyan-900/60"
            }`}
          >
            {isListening ? <Mic className="w-4 h-4 text-rose-400" /> : <MicOff className="w-4 h-4" />}
            {isListening ? "EARPIECE LISTENING..." : "START LISTENING MIC"}
          </button>
        </div>
      </div>

      {/* Input / Live Transcript Stream Box */}
      <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/60 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono text-zinc-400">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-cyan-400">
              <MessageSquare className="w-3.5 h-3.5" />
              LIVE CONVERSATION STREAM
            </span>
            {isListening && (
              <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" /> ACTIVE
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={meetingTopic}
              onChange={(e) => setMeetingTopic(e.target.value)}
              placeholder="Topic (e.g. Series A Pitch, Tech Architecture, Salary Negotiation)..."
              className="px-2.5 py-1 bg-black/60 border border-zinc-700 rounded text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-400 w-64"
            />
            <button
              type="button"
              onClick={() => fetchShadow()}
              disabled={loading || !transcript.trim()}
              className="px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold flex items-center gap-1.5 text-xs transition-all cursor-pointer"
            >
              <Zap className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Analyzing..." : "Analyze"}
            </button>
          </div>
        </div>

        <textarea
          rows={3}
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Speak into microphone or paste what attendees are saying right now..."
          className="w-full bg-black/50 border border-zinc-800 rounded-lg p-3 text-xs md:text-sm text-zinc-200 font-mono focus:outline-none focus:border-cyan-500/50 resize-none placeholder:text-zinc-600 font-sans"
        />

        {/* Quick test buttons */}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
          <span className="text-zinc-500 font-mono">Quick Simulators:</span>
          <button
            type="button"
            onClick={() => {
              const sim = "Client says: We want to rebuild the entire mobile app in flutter from scratch next month, but we only have 2 junior developers and 4 weeks. What do you think?";
              setTranscript(sim);
              fetchShadow(sim);
            }}
            className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 hover:border-cyan-500/40 text-zinc-300 hover:text-white transition-colors cursor-pointer"
          >
            Impossible Timeline Demo
          </button>
          <button
            type="button"
            onClick={() => {
              const sim = "VP says: Let's cut cloud infrastructure budget by 50% immediately to hit Q3 profitability. What will break if we downgrade our database cluster?";
              setTranscript(sim);
              fetchShadow(sim);
            }}
            className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 hover:border-cyan-500/40 text-zinc-300 hover:text-white transition-colors cursor-pointer"
          >
            Budget Cuts Demo
          </button>
          <button
            type="button"
            onClick={() => {
              const sim = "Candidate/Vendor says: We don't need automated tests or staging environments, we ship directly to prod with full confidence.";
              setTranscript(sim);
              fetchShadow(sim);
            }}
            className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 hover:border-cyan-500/40 text-zinc-300 hover:text-white transition-colors cursor-pointer"
          >
            Vendor Risk Demo
          </button>
        </div>
      </div>

      {/* Main Tactical Intelligence Output */}
      {data && (
        <div className="space-y-4">
          {/* Earpiece Whisper Banner */}
          <div className="p-4 rounded-xl border border-cyan-500/40 bg-cyan-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-[0_0_25px_rgba(6,182,212,0.15)]">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyan-900/40 border border-cyan-500/40 text-cyan-300">
                <Volume2 className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[11px] font-mono text-cyan-400 font-bold uppercase tracking-wider">
                  🎧 PRIVATE EARPIECE SOUNDBITE (SAY THIS NOW)
                </div>
                <div className="text-sm md:text-base font-semibold text-white mt-0.5 font-sans">
                  "{data.whisperSoundbite}"
                </div>
              </div>
            </div>

            <button
              onClick={() => whisper(data.whisperSoundbite)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all flex-shrink-0 ${
                whispering
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                  : "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30"
              }`}
            >
              <Volume2 className="w-3.5 h-3.5" />
              {whispering ? "Stop Earpiece Voice" : "Whisper into Headphones"}
            </button>
          </div>

          {/* 4 Intelligence Quadrants */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 1. Live Talking Points */}
            <div className="p-4 rounded-xl border border-cyan-500/30 bg-zinc-950/70 space-y-3">
              <div className="flex items-center justify-between text-xs font-orbitron font-bold text-cyan-300">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-cyan-400" />
                  1. LIVE TALKING POINTS
                </span>
                <span className="text-[10px] text-zinc-500 font-mono">3 READY</span>
              </div>
              <div className="space-y-2">
                {data.talkingPoints.map((tp, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800 hover:border-cyan-500/30 transition-colors flex items-start justify-between gap-2"
                  >
                    <p className="text-xs text-zinc-200 font-sans leading-relaxed">
                      <span className="text-cyan-400 font-bold mr-1">#{idx + 1}</span> {tp}
                    </p>
                    <button
                      onClick={() => copyItem(tp, `tp-${idx}`)}
                      className="p-1 rounded text-zinc-500 hover:text-cyan-300 transition-colors flex-shrink-0"
                      title="Copy"
                    >
                      {copiedIdx === `tp-${idx}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* 2. Counter-Arguments */}
            <div className="p-4 rounded-xl border border-amber-500/30 bg-zinc-950/70 space-y-3">
              <div className="flex items-center justify-between text-xs font-orbitron font-bold text-amber-300">
                <span className="flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-amber-400" />
                  2. COUNTER-ARGUMENTS &amp; DEFENSE
                </span>
                <span className="text-[10px] text-zinc-500 font-mono">PUSHBACK</span>
              </div>
              <div className="space-y-2">
                {data.counterArguments.map((ca, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800 hover:border-amber-500/30 transition-colors flex items-start justify-between gap-2"
                  >
                    <p className="text-xs text-zinc-200 font-sans leading-relaxed">
                      <span className="text-amber-400 font-bold mr-1">⚔️</span> {ca}
                    </p>
                    <button
                      onClick={() => copyItem(ca, `ca-${idx}`)}
                      className="p-1 rounded text-zinc-500 hover:text-amber-300 transition-colors flex-shrink-0"
                      title="Copy"
                    >
                      {copiedIdx === `ca-${idx}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. Facts & Benchmarks */}
            <div className="p-4 rounded-xl border border-blue-500/30 bg-zinc-950/70 space-y-3">
              <div className="flex items-center justify-between text-xs font-orbitron font-bold text-blue-300">
                <span className="flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-blue-400" />
                  3. VERIFIED FACTS &amp; CITATIONS
                </span>
                <span className="text-[10px] text-zinc-500 font-mono">AUTHORITY</span>
              </div>
              <div className="space-y-2">
                {data.factsAndStats.map((fs, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800 hover:border-blue-500/30 transition-colors flex items-start justify-between gap-2"
                  >
                    <p className="text-xs text-zinc-200 font-sans leading-relaxed">
                      <span className="text-blue-400 font-bold mr-1">📊</span> {fs}
                    </p>
                    <button
                      onClick={() => copyItem(fs, `fs-${idx}`)}
                      className="p-1 rounded text-zinc-500 hover:text-blue-300 transition-colors flex-shrink-0"
                      title="Copy"
                    >
                      {copiedIdx === `fs-${idx}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* 4. High-IQ Questions */}
            <div className="p-4 rounded-xl border border-emerald-500/30 bg-zinc-950/70 space-y-3">
              <div className="flex items-center justify-between text-xs font-orbitron font-bold text-emerald-300">
                <span className="flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4 text-emerald-400" />
                  4. KILLER QUESTIONS TO ASK
                </span>
                <span className="text-[10px] text-zinc-500 font-mono">STEER MEETING</span>
              </div>
              <div className="space-y-2">
                {data.questionsToAsk.map((q, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800 hover:border-emerald-500/30 transition-colors flex items-start justify-between gap-2"
                  >
                    <p className="text-xs text-zinc-200 font-sans leading-relaxed">
                      <span className="text-emerald-400 font-bold mr-1">❓</span> {q}
                    </p>
                    <button
                      onClick={() => copyItem(q, `q-${idx}`)}
                      className="p-1 rounded text-zinc-500 hover:text-emerald-300 transition-colors flex-shrink-0"
                      title="Copy"
                    >
                      {copiedIdx === `q-${idx}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
