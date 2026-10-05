"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone,
  PhoneCall,
  PhoneOff,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  ExternalLink,
  Bot,
  User,
  ShieldCheck,
  Radio,
  Send,
  Sparkles,
  Clock,
  Activity,
  QrCode,
  Info,
  AlertCircle,
  Ear,
} from "lucide-react";

interface CallTranscriptItem {
  role: "jarvis" | "counterparty" | "system";
  text: string;
  time: string;
}

// ── Browser speech primitives (free, no API key) ───────────────────────────
// Web Speech API: SpeechSynthesis for JARVIS's voice, SpeechRecognition for
// listening. Both ship with Chromium/Edge — free forever, nothing billed.

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: any) => void) | null;
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/** Highest-quality available system voice — chosen at runtime, never pinned. */
function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const score = (v: SpeechSynthesisVoice) => {
    let s = 0;
    if (/en[-_]GB/i.test(v.lang)) s += 3;
    else if (/^en/i.test(v.lang)) s += 2;
    if (/google/i.test(v.name)) s += 2;
    if (/natural|neural|online/i.test(v.name)) s += 1;
    if (/male|daniel|arthur|george|oliver|rishi/i.test(v.name)) s += 1;
    if (v.localService) s += 1;
    return s;
  };
  return [...voices].sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Simple QR code via Google Charts API (free, no key). */
function QrImage({ url }: { url: string }) {
  const encoded = encodeURIComponent(url);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://chart.googleapis.com/chart?cht=qr&chl=${encoded}&chs=160x160&choe=UTF-8`}
      alt="Scan to join the call"
      className="rounded-xl border border-cyan-500/30"
      width={160}
      height={160}
    />
  );
}

function normalizeForTel(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return raw.trim().startsWith("+") ? `+${digits}` : digits.length === 10 ? `+91${digits}` : `+${digits}`;
}

/** True on phones/tablets where a `tel:` link can actually place a call. */
function isHandheld(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Mobi|Android|iPhone|iPad|iPod/i.test(ua) || (navigator.maxTouchPoints > 1 && /Mac/.test(ua));
}

export default function DiplomatTab({ initialNumber }: { initialNumber?: string | null } = {}) {
  const [phoneNumber, setPhoneNumber] = useState(initialNumber ?? "");
  const [objective, setObjective] = useState("");
  const [isCalling, setIsCalling] = useState(false);
  const [callStatus, setCallStatus] = useState<"idle" | "dialing" | "ringing" | "connected" | "ended">("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [transcript, setTranscript] = useState<CallTranscriptItem[]>([]);
  const [webrtcUrl, setWebrtcUrl] = useState<string | null>(null);
  const [telecomNotice, setTelecomNotice] = useState<string>("");
  const [counterpartyInput, setCounterpartyInput] = useState("");
  const [isGeneratingReply, setIsGeneratingReply] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [callMode, setCallMode] = useState<"twilio_pstn" | "webrtc_free">("webrtc_free");
  const [error, setError] = useState<string | null>(null);

  // Live listening state.
  const [sttSupported, setSttSupported] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [handheld, setHandheld] = useState(false);
  const [numberCopied, setNumberCopied] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [showRoomEmbed, setShowRoomEmbed] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldListenRef = useRef(false);
  const callIdRef = useRef<string | null>(null);
  const objectiveRef = useRef("");
  const mutedRef = useRef(false);
  const busyRef = useRef(false);
  const handleUtteranceRef = useRef<(text: string) => void>(() => {});

  useEffect(() => {
    callIdRef.current = callId;
  }, [callId]);
  useEffect(() => {
    objectiveRef.current = objective;
  }, [objective]);
  useEffect(() => {
    mutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    setSttSupported(!!getRecognitionCtor());
    setHandheld(isHandheld());
    if (typeof window !== "undefined" && !window.speechSynthesis) setVoiceSupported(false);
  }, []);

  // A voice/text command can hand us a number to dial when the tab opens.
  useEffect(() => {
    if (initialNumber) setPhoneNumber(initialNumber);
  }, [initialNumber]);

  // Auto-scroll transcript.
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [transcript, interim]);

  // Call duration counter.
  useEffect(() => {
    if (callStatus === "connected") {
      timerRef.current = setInterval(() => setCallDuration((prev) => prev + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callStatus]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const append = useCallback((item: CallTranscriptItem) => {
    setTranscript((prev) => [...prev, item]);
  }, []);

  /** Speak JARVIS's line through the system voice. */
  const speak = useCallback((text: string) => {
    if (!text || mutedRef.current) return;
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) utter.voice = voice;
    utter.rate = 1.02;
    utter.pitch = 0.95;
    window.speechSynthesis.speak(utter);
  }, []);

  // Pick up voices once they finish loading (they load asynchronously).
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const onVoices = () => setVoiceSupported(window.speechSynthesis.getVoices().length > 0);
    onVoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", onVoices);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", onVoices);
  }, []);

  /** Send one recognised utterance to the dialogue endpoint and speak the reply. */
  const handleUtterance = useCallback(
    async (userText: string) => {
      const id = callIdRef.current;
      const text = userText.trim();
      if (!id || !text || busyRef.current) return;
      busyRef.current = true;
      setInterim("");
      append({ role: "counterparty", text, time: new Date().toLocaleTimeString() });
      setIsGeneratingReply(true);
      try {
        const res = await fetch("/api/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mcp: "diplomat",
            action: "dialogue",
            params: { callId: id, message: text, objective: objectiveRef.current },
          }),
        });
        const data = await res.json();
        if (data.success && data.data?.jarvisResponse) {
          append({ role: "jarvis", text: data.data.jarvisResponse, time: new Date().toLocaleTimeString() });
          speak(data.data.jarvisResponse);
          if (data.data.shouldHangup) {
            shouldListenRef.current = false;
            recognitionRef.current?.stop();
            setIsListening(false);
          }
        } else if (data.error) {
          setError(data.error);
        }
      } catch (e: any) {
        setError(`Dialogue failed: ${e.message}`);
      } finally {
        setIsGeneratingReply(false);
        busyRef.current = false;
      }
    },
    [append, speak]
  );

  useEffect(() => {
    handleUtteranceRef.current = handleUtterance;
  }, [handleUtterance]);

  const startListening = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setSttSupported(false);
      return;
    }
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-IN";
    rec.onresult = (e: any) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      if (interimText) setInterim(interimText);
      if (finalText.trim()) handleUtteranceRef.current(finalText);
    };
    rec.onerror = (e: any) => {
      if (e?.error && e.error !== "no-speech" && e.error !== "aborted") {
        setError(`Microphone: ${e.error}`);
      }
    };
    rec.onend = () => {
      // Browsers stop recognition after silence — resume while in a call.
      if (shouldListenRef.current) {
        try {
          rec.start();
        } catch {
          /* already started */
        }
      } else {
        setIsListening(false);
      }
    };
    recognitionRef.current = rec;
    shouldListenRef.current = true;
    try {
      rec.start();
      setIsListening(true);
      setError(null);
    } catch {
      /* ignore duplicate start */
    }
  }, []);

  const stopListening = useCallback(() => {
    shouldListenRef.current = false;
    setIsListening(false);
    setInterim("");
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
  }, []);

  const handleStartCall = async () => {
    if (!phoneNumber.trim()) return;
    setIsCalling(true);
    setError(null);
    setCallStatus("dialing");
    setCallDuration(0);
    setTranscript([{ role: "system", text: `Opening a voice channel to ${phoneNumber}…`, time: new Date().toLocaleTimeString() }]);

    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mcp: "diplomat",
          action: "make_call",
          params: { to: phoneNumber, objective: objective.trim() || undefined },
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || "Could not start the call.");
        setCallStatus("ended");
        return;
      }
      setCallId(data.data.callId);
      callIdRef.current = data.data.callId;
      setWebrtcUrl(data.data.webrtcRoomUrl);
      // Internet-only path is the default — surface the room straight away so
      // neither side needs a phone call to get talking.
      setShowRoomEmbed(true);
      setTelecomNotice(data.data.telecomNotice || "");
      setCallMode(data.data.mode);
      setTranscript(Array.isArray(data.data.transcript) ? data.data.transcript : []);
      setCallStatus("connected");

      const opener = data.data.transcript?.find((t: CallTranscriptItem) => t.role === "jarvis")?.text;
      if (opener) speak(opener);
      startListening();
    } catch (e: any) {
      setCallStatus("ended");
      setError(`Connection error: ${e.message}`);
    } finally {
      setIsCalling(false);
    }
  };

  // On a phone this really dials. On a desktop there is no dialer, so `tel:`
  // just pops an "open with" chooser (Brave/Chrome/…) — which is confusing.
  // There we copy the number instead and tell the user to dial it on a phone.
  const handleDialWithPhone = async () => {
    const tel = normalizeForTel(phoneNumber);
    if (!tel) return;
    if (handheld) {
      window.location.href = `tel:${tel}`;
      return;
    }
    try {
      await navigator.clipboard.writeText(tel);
      setNumberCopied(true);
      setTimeout(() => setNumberCopied(false), 2500);
    } catch {
      /* clipboard blocked — the number is visible in the field anyway */
    }
  };

  const handleSendCounterpartyUtterance = () => {
    if (!counterpartyInput.trim()) return;
    const text = counterpartyInput.trim();
    setCounterpartyInput("");
    handleUtterance(text);
  };

  const handleCopyInvite = async () => {
    if (!webrtcUrl) return;
    try {
      await navigator.clipboard.writeText(`Join my JARVIS call: ${webrtcUrl}`);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2500);
    } catch {
      /* clipboard blocked — the link is visible on screen */
    }
  };

  const handleEndCall = async () => {
    stopListening();
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    setCallStatus("ended");
    const id = callIdRef.current;
    if (id) {
      try {
        await fetch("/api/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mcp: "diplomat", action: "hangup", params: { callId: id } }),
        });
      } catch {
        /* ignore */
      }
    }
  };

  // Stop the mic when the tab unmounts.
  useEffect(() => () => stopListening(), [stopListening]);

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col gap-3 rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-cyan-950/40 via-blue-950/20 to-black/40 p-4 backdrop-blur-xl md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-500/30">
            <Radio className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold tracking-wide text-white">PROJECT DIPLOMAT</h3>
              <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                Voice AI Agent
              </span>
            </div>
            <p className="text-xs text-white/50">
              JARVIS listens through your mic and speaks on the line · free WebRTC duplex
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-white/70">
            <ShieldCheck className="h-3.5 w-3.5 text-cyan-400" />
            {callMode === "twilio_pstn" ? "PSTN Carrier" : "Free WebRTC Mode"}
          </span>
        </div>
      </div>

      {/* Operating guide */}
      <div className="rounded-xl border border-blue-500/20 bg-blue-950/20 text-xs text-blue-200">
        <button
          type="button"
          onClick={() => setShowGuide((v) => !v)}
          className="flex w-full items-center gap-2 p-3 text-left"
        >
          <Info className="h-4 w-4 text-blue-400 shrink-0" />
          <span className="font-semibold text-blue-300">How to use this — step by step</span>
          <span className="ml-auto text-blue-300/70">{showGuide ? "Hide" : "Show"}</span>
        </button>
        {showGuide && (
          <div className="space-y-3 border-t border-blue-500/20 p-3 pt-3">
            <ol className="list-decimal space-y-1.5 pl-4 leading-relaxed">
              <li>
                Type the number (with country code) and what you want achieved, then press{" "}
                <strong>Start AI Call</strong>. JARVIS comes online, says its opening line and starts
                listening through this machine&apos;s microphone.
              </li>
              <li>
                Press <strong>Copy invite message</strong> and send it to the person (WhatsApp, SMS, email —
                any channel). They just open the link in a browser; no app, no account, no phone call.
              </li>
              <li>
                Speaks normally — JARVIS hears both sides through the mic, thinks, and replies out loud.
                Anything it says appears in the transcript on the right.
              </li>
              <li>
                Prefer a real phone call anyway? Then dial the number on a phone and put it on speaker next
                to this machine — JARVIS will hear it and talk back. This is optional.
              </li>
            </ol>
            <p className="text-blue-300/70">
              <strong className="text-blue-200">No phone call is needed.</strong> This works like a WhatsApp
              call but without the app: the other person just opens the room link in any browser. Everything
              is free — browser speech recognition, browser voice, and a free Jitsi room. The phone method
              above is only a fallback for someone who cannot open a link.
            </p>
          </div>
        )}
      </div>

      {(error || !sttSupported || !voiceSupported) && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            {error ||
              (!sttSupported
                ? "Speech recognition is unavailable in this browser — use Chrome or Edge to let JARVIS listen, or type what the recipient says below."
                : "No system voice was found — JARVIS can still listen, but replies may be silent.")}
          </span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column */}
        <div className="space-y-4 lg:col-span-5">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-2xl shadow-xl">
            <label className="text-xs font-medium uppercase tracking-wider text-cyan-400">
              Target Phone Number
            </label>
            <div className="relative mt-2">
              <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value.replace(/[^\d+\s-]/g, ""))}
                placeholder="Include country code, e.g. +919606571200"
                className="w-full rounded-xl border border-white/10 bg-black/40 py-2.5 pl-10 pr-3 text-sm font-mono text-white placeholder:text-white/30 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/20"
              />
            </div>

            <div className="mt-4">
              <label className="text-xs font-medium uppercase tracking-wider text-white/60">
                Call Objective
              </label>
              <textarea
                rows={2}
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="What should JARVIS accomplish on this call?"
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white placeholder:text-white/30 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/20"
              />
            </div>

            {/* Action Buttons */}
            <div className="mt-5 flex flex-col gap-2">
              {callStatus !== "connected" ? (
                <button
                  type="button"
                  onClick={handleStartCall}
                  disabled={isCalling || !phoneNumber.trim()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-3 text-sm font-medium text-white shadow-[0_0_20px_rgba(16,185,129,0.4)] transition hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50"
                >
                  <PhoneCall className="h-4 w-4" />
                  {isCalling ? "Connecting…" : "Start Internet Call (no phone)"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleEndCall}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 py-3 text-sm font-medium text-white shadow-[0_0_20px_rgba(239,68,68,0.4)] transition hover:from-rose-500 hover:to-red-500"
                >
                  <PhoneOff className="h-4 w-4" />
                  End Call
                </button>
              )}

              <button
                type="button"
                onClick={handleDialWithPhone}
                disabled={!phoneNumber.trim()}
                className="flex items-center justify-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 py-2.5 text-xs font-medium text-cyan-300 transition hover:bg-cyan-500/20 disabled:opacity-40"
              >
                <Phone className="h-3.5 w-3.5" />
                {handheld
                  ? "Call on this device"
                  : numberCopied
                  ? "Number copied — dial it on a phone"
                  : "Copy number (desktop has no dialer)"}
              </button>
            </div>

            {/* WebRTC Room Link */}
            {webrtcUrl && (
              <div className="mt-4 rounded-xl border border-cyan-500/20 bg-cyan-950/20 p-3 text-xs text-white/70">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-cyan-300">Live WebRTC Room:</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowQr(!showQr)}
                      className="flex items-center gap-1 text-cyan-400 hover:underline"
                    >
                      <QrCode className="h-3.5 w-3.5" />
                      {showQr ? "Hide QR" : "Show QR"}
                    </button>
                    <a
                      href={webrtcUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-cyan-400 hover:underline"
                    >
                      Open <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
                <div className="mb-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRoomEmbed((v) => !v)}
                    className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium text-cyan-300 transition hover:bg-cyan-500/20"
                  >
                    {showRoomEmbed ? "Hide in-app room" : "Join room in this window"}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyInvite}
                    className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/70 transition hover:text-white"
                  >
                    {inviteCopied ? "Invite copied" : "Copy invite message"}
                  </button>
                </div>
                {showQr && (
                  <div className="flex justify-center mt-2 mb-2">
                    <QrImage url={webrtcUrl} />
                  </div>
                )}
                <p className="text-[11px] text-white/40">
                  Share this link with the recipient to connect live audio — free, no app needed.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Call Stage */}
        <div className="space-y-4 lg:col-span-7">
          <div className="flex h-full min-h-[460px] flex-col rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-2xl">
            {/* Call Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-3">
                <div
                  className={`grid h-9 w-9 place-items-center rounded-xl ${
                    callStatus === "connected"
                      ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-400/40"
                      : "bg-white/5 text-white/40"
                  }`}
                >
                  <Activity className={`h-4 w-4 ${callStatus === "connected" ? "animate-pulse" : ""}`} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">
                      {callStatus === "connected"
                        ? `Call Active: ${phoneNumber}`
                        : callStatus === "dialing"
                        ? "Dialing…"
                        : callStatus === "ended"
                        ? "Call Ended"
                        : "Diplomat Standby"}
                    </span>
                    <span
                      className={`h-2 w-2 rounded-full ${
                        callStatus === "connected" ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-white/30"
                      }`}
                    />
                  </div>
                  <span className="text-xs text-white/40">
                    Status: <span className="uppercase text-cyan-400 font-mono">{callStatus}</span>
                  </span>
                </div>
              </div>

              {callStatus === "connected" && (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1 text-xs font-mono text-cyan-300">
                    <Clock className="h-3 w-3" />
                    {formatDuration(callDuration)}
                  </div>
                  <button
                    type="button"
                    onClick={() => (isListening ? stopListening() : startListening())}
                    className={`rounded-lg border p-1.5 transition ${
                      isListening
                        ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
                        : "border-white/10 bg-white/5 text-white/60"
                    }`}
                    title={isListening ? "Stop listening" : "Start listening"}
                  >
                    <Ear className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !isMuted;
                      setIsMuted(next);
                      if (next && typeof window !== "undefined") window.speechSynthesis?.cancel();
                    }}
                    className={`rounded-lg border p-1.5 transition ${
                      isMuted ? "border-amber-500/30 bg-amber-500/20 text-amber-300" : "border-white/10 bg-white/5 text-white/60"
                    }`}
                    title={isMuted ? "Unmute JARVIS's voice" : "Mute JARVIS's voice"}
                  >
                    {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </button>
                </div>
              )}
            </div>

            {/* Listening pill */}
            {callStatus === "connected" && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/20 px-3 py-2">
                <div className="flex items-center gap-2 text-[11px]">
                  {isListening ? (
                    <>
                      <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-emerald-300">Listening to the call…</span>
                    </>
                  ) : (
                    <>
                      <MicOff className="h-3.5 w-3.5 text-white/40" />
                      <span className="text-white/40">Microphone off</span>
                    </>
                  )}
                </div>
                {interim && (
                  <span className="truncate text-[11px] italic text-white/50">&ldquo;{interim}&rdquo;</span>
                )}
              </div>
            )}

            {/* Audio Waveform Animation */}
            {callStatus === "connected" && (
              <div className="my-3 flex items-center justify-center gap-1 rounded-xl bg-cyan-950/10 py-3 border border-cyan-500/10">
                {[40, 65, 80, 45, 90, 70, 30, 85, 95, 60, 40, 75, 55, 85, 35].map((h, i) => (
                  <motion.div
                    key={i}
                    className="w-1 rounded-full bg-cyan-400"
                    animate={{ height: [10, h * 0.45, 8], opacity: [0.4, 0.9, 0.4] }}
                    transition={{ duration: 0.8 + (i % 3) * 0.2, repeat: Infinity, ease: "easeInOut" }}
                  />
                ))}
              </div>
            )}

            {/* In-app free WebRTC room (Jitsi) */}
            {showRoomEmbed && webrtcUrl && (
              <div className="mb-3">
                <iframe
                  src={webrtcUrl}
                  title="JARVIS Diplomat WebRTC room"
                  allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write"
                  className="h-[300px] w-full rounded-2xl border border-cyan-500/20 bg-black/40"
                />
                <p className="mt-1 text-[10px] text-white/40">
                  Free Jitsi room — both sides can be in the call from here. JARVIS keeps listening through
                  this machine&apos;s microphone.
                </p>
              </div>
            )}

            {/* Live Transcript Box */}
            <div
              ref={chatScrollRef}
              className="flex-1 space-y-3 overflow-y-auto rounded-2xl bg-black/30 p-4 text-xs font-sans"
              style={{ maxHeight: "280px" }}
            >
              {transcript.length === 0 ? (
                <div className="flex h-full items-center justify-center text-center text-white/30">
                  Ready to dial. Press &ldquo;Start AI Call&rdquo; to bring JARVIS on the line.
                </div>
              ) : (
                transcript.map((item, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-col gap-1 ${
                      item.role === "jarvis" ? "items-start" : item.role === "counterparty" ? "items-end" : "items-center"
                    }`}
                  >
                    {item.role === "system" ? (
                      <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-[10px] text-white/40">
                        {item.text}
                      </span>
                    ) : (
                      <div
                        className={`max-w-[85%] rounded-2xl p-3 ${
                          item.role === "jarvis"
                            ? "border border-cyan-500/20 bg-cyan-950/30 text-cyan-100"
                            : "border border-white/10 bg-white/10 text-white"
                        }`}
                      >
                        <div className="mb-1 flex items-center gap-1.5 text-[10px] opacity-60">
                          {item.role === "jarvis" ? <Bot className="h-3 w-3 text-cyan-400" /> : <User className="h-3 w-3" />}
                          <span className="font-semibold">{item.role === "jarvis" ? "JARVIS (AI Voice)" : "Recipient"}</span>
                          <span>· {item.time}</span>
                        </div>
                        <p className="text-xs leading-relaxed">{item.text}</p>
                      </div>
                    )}
                  </div>
                ))
              )}
              {isGeneratingReply && (
                <div className="flex items-center gap-2 text-cyan-400 text-xs italic">
                  <Sparkles className="h-3.5 w-3.5 animate-spin" />
                  JARVIS is thinking…
                </div>
              )}
            </div>

            {/* Manual transcript fallback (also useful when the mic is muted) */}
            {callStatus === "connected" && (
              <div className="mt-3 space-y-2">
                <p className="text-[10px] text-white/40 px-1">
                  Type what the recipient says (or when speech recognition isn&apos;t available):
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={counterpartyInput}
                    onChange={(e) => setCounterpartyInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSendCounterpartyUtterance()}
                    placeholder="e.g. Hello, who is this?"
                    className="flex-1 rounded-xl border border-white/10 bg-black/40 px-3.5 py-2 text-xs text-white placeholder:text-white/30 focus:border-cyan-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleSendCounterpartyUtterance}
                    disabled={isGeneratingReply || !counterpartyInput.trim()}
                    className="flex items-center gap-1 rounded-xl bg-cyan-500 px-3 py-2 text-xs font-medium text-white transition hover:bg-cyan-400 disabled:opacity-40"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Reply
                  </button>
                </div>
              </div>
            )}

            {/* Telecom notice */}
            {telecomNotice && callStatus === "connected" && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-[10px] text-white/40">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400/60" />
                {telecomNotice}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
