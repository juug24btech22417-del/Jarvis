"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera,
  Upload,
  User,
  Building,
  Briefcase,
  MapPin,
  Sparkles,
  MessageCircle,
  Copy,
  Check,
  Trash2,
  Share2,
  ExternalLink,
  Search,
  BookOpen,
  Send,
  Plus,
} from "lucide-react";
import { useJarvisStore } from "@/store/jarvis.store";

interface ContactDossier {
  id: string;
  avatar: string | null;
  name: string;
  title: string;
  company: string;
  location: string;
  executiveBio: string;
  strengthsAndSkills: string[];
  careerHighlights: string[];
  predictedMutualInterests: string[];
  icebreakersAndTalkingPoints: string[];
  sensitivityTopics: string[];
  followUpDraft: string;
  savedAt: string;
}

export default function FaceCrmPanel() {
  const setActivePanel = useJarvisStore((s) => s.setActivePanel);

  const [dossiers, setDossiers] = useState<ContactDossier[]>([]);
  const [selectedDossier, setSelectedDossier] = useState<ContactDossier | null>(null);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [notes, setNotes] = useState("");
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load saved dossiers from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("jarvis:face-crm:dossiers");
      if (saved) {
        const parsed = JSON.parse(saved);
        setDossiers(parsed);
        if (parsed.length > 0) setSelectedDossier(parsed[0]);
      }
    } catch {}
  }, []);

  const saveDossiers = (list: ContactDossier[]) => {
    setDossiers(list);
    try {
      localStorage.setItem("jarvis:face-crm:dossiers", JSON.stringify(list));
    } catch {}
  };

  // Clipboard paste listener for direct screenshot paste (Ctrl+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = (event) => {
              setPreviewImage(event.target?.result as string);
            };
            reader.readAsDataURL(blob);
          }
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setPreviewImage(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const startCamera = async () => {
    setCameraActive(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (e) {
      console.error("Camera access failed", e);
      setCameraActive(false);
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg");
      setPreviewImage(dataUrl);
    }
    stopCamera();
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const handleBuildDossier = async () => {
    if (!previewImage && !name.trim()) {
      alert("Please upload a photo/screenshot or enter person's name.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/crm/dossier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: previewImage || undefined,
          name: name || undefined,
          company: company || undefined,
          notes: notes || undefined,
        }),
      });

      const json = await res.json();
      if (json.success && json.dossier) {
        const newDossier: ContactDossier = {
          ...json.dossier,
          avatar: previewImage || null,
          savedAt: new Date().toLocaleDateString(),
        };

        const updated = [newDossier, ...dossiers.filter((d) => d.name !== newDossier.name)];
        saveDossiers(updated);
        setSelectedDossier(newDossier);
        setName("");
        setCompany("");
        setNotes("");
        setPreviewImage(null);
      }
    } catch (e) {
      console.error("Failed to build dossier", e);
    } finally {
      setLoading(false);
    }
  };

  const deleteDossier = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = dossiers.filter((d) => d.id !== id);
    saveDossiers(updated);
    if (selectedDossier?.id === id) {
      setSelectedDossier(updated[0] || null);
    }
  };

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const filtered = dossiers.filter(
    (d) =>
      d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="w-full max-w-6xl mx-auto p-4 md:p-6 space-y-6 font-rajdhani text-white">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-zinc-950/80 border border-cyan-500/30 shadow-[0_0_30px_rgba(6,182,212,0.15)]">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-cyan-950/80 border border-cyan-500/50 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
            <Camera className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-orbitron text-xl md:text-2xl font-bold tracking-wider text-cyan-300">
                FACE-TO-CRM · SECRET DOSSIER
              </h1>
              <span className="px-2 py-0.5 rounded text-[11px] font-mono tracking-widest bg-cyan-950/80 border border-cyan-500/40 text-cyan-300">
                EXECUTIVE INTEL
              </span>
            </div>
            <p className="text-xs text-zinc-400 tracking-wide mt-0.5">
              Snap a face or screenshot LinkedIn: JARVIS pulls background, mutual interests, and talking points for your next meeting.
            </p>
          </div>
        </div>

        <div className="text-xs font-mono text-cyan-400 bg-cyan-950/40 border border-cyan-500/30 px-3 py-1.5 rounded-lg flex items-center gap-2">
          <span>{dossiers.length} Saved Dossiers</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Creator / Camera / Inputs (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-5 rounded-2xl bg-zinc-950/70 border border-zinc-800 space-y-4">
            <h2 className="text-sm font-orbitron font-bold text-cyan-300 flex items-center gap-2">
              <Plus className="w-4 h-4 text-cyan-400" />
              CREATE NEW DOSSIER
            </h2>

            {/* Photo / Screenshot Capture Area */}
            <div className="relative border-2 border-dashed border-zinc-700 hover:border-cyan-500/50 rounded-xl p-4 text-center bg-black/40 transition-colors">
              {cameraActive ? (
                <div className="space-y-3">
                  <video ref={videoRef} autoPlay playsInline className="w-full h-44 object-cover rounded-lg border border-cyan-500/50" />
                  <div className="flex justify-center gap-2">
                    <button
                      onClick={capturePhoto}
                      className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white flex items-center gap-1.5"
                    >
                      <Camera className="w-4 h-4" /> Snap Photo
                    </button>
                    <button
                      onClick={stopCamera}
                      className="px-3 py-1.5 rounded-lg bg-zinc-800 text-xs font-semibold text-zinc-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : previewImage ? (
                <div className="relative group">
                  <img
                    src={previewImage}
                    alt="Preview"
                    className="w-full h-44 object-cover rounded-lg border border-cyan-500/40"
                  />
                  <button
                    onClick={() => setPreviewImage(null)}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/80 text-rose-400 hover:text-white border border-rose-500/50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="py-5 space-y-2">
                  <div className="flex justify-center gap-3">
                    <button
                      onClick={startCamera}
                      className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-700 hover:border-cyan-400 text-cyan-400 transition-colors"
                      title="Take webcam photo"
                    >
                      <Camera className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-700 hover:border-cyan-400 text-cyan-400 transition-colors"
                      title="Upload LinkedIn screenshot"
                    >
                      <Upload className="w-5 h-5" />
                    </button>
                  </div>
                  <p className="text-xs text-zinc-400">
                    Snap webcam, upload photo, or <span className="text-cyan-300 font-semibold">Ctrl+V</span> to paste screenshot
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>
              )}
            </div>

            {/* Quick Metadata Inputs */}
            <div className="space-y-2.5">
              <div>
                <label className="text-[11px] font-mono text-zinc-400 uppercase">Contact Name</label>
                <div className="relative mt-1">
                  <User className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Sam Altman, Satya Nadella..."
                    className="w-full pl-9 pr-3 py-2 bg-black/60 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-cyan-400"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-mono text-zinc-400 uppercase">Company / Project</label>
                <div className="relative mt-1">
                  <Building className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" />
                  <input
                    type="text"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="e.g. OpenAI, Microsoft, Stealth..."
                    className="w-full pl-9 pr-3 py-2 bg-black/60 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-cyan-400"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-mono text-zinc-400 uppercase">Context Notes (Where did you meet?)</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Met at Bangalore demo day, discussed GPU clustering and seed funding..."
                  className="w-full mt-1 p-2.5 bg-black/60 border border-zinc-800 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-cyan-400 resize-none font-sans"
                />
              </div>

              {/* Quick Profile Presets */}
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                <span className="text-[10px] font-mono text-zinc-500">Quick Test:</span>
                {[
                  { n: "Satya Nadella", c: "Microsoft" },
                  { n: "Sam Altman", c: "OpenAI" },
                  { n: "Jensen Huang", c: "NVIDIA" },
                ].map((p) => (
                  <button
                    key={p.n}
                    type="button"
                    onClick={() => {
                      setName(p.n);
                      setCompany(p.c);
                      setNotes(`Met during tech keynote, discussing AI infra.`);
                    }}
                    className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-900 border border-zinc-800 text-cyan-300 hover:border-cyan-400 hover:text-white transition-colors cursor-pointer"
                  >
                    +{p.n.split(" ")[0]}
                  </button>
                ))}
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="button"
              onClick={handleBuildDossier}
              disabled={loading || (!previewImage && !name.trim())}
              className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-orbitron font-bold text-xs tracking-wider flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(6,182,212,0.3)] transition-all cursor-pointer"
            >
              <Sparkles className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "COMPILING SECRET DOSSIER..." : "GENERATE EXECUTIVE BRIEFING"}
            </button>
          </div>

          {/* Search / Dossier List */}
          <div className="p-4 rounded-2xl bg-zinc-950/70 border border-zinc-800 space-y-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-zinc-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search saved contacts..."
                className="w-full pl-8 pr-3 py-1.5 bg-black/50 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-cyan-400 font-mono"
              />
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar">
              {filtered.map((d) => (
                <div
                  key={d.id}
                  onClick={() => setSelectedDossier(d)}
                  className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                    selectedDossier?.id === d.id
                      ? "bg-cyan-950/40 border-cyan-400/80 text-white"
                      : "bg-zinc-900/40 border-zinc-800/80 text-zinc-300 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {d.avatar ? (
                      <img src={d.avatar} alt={d.name} className="w-8 h-8 rounded-full object-cover border border-cyan-500/40" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-cyan-950/80 border border-cyan-500/30 flex items-center justify-center text-cyan-300 font-bold text-xs">
                        {d.name.slice(0, 1)}
                      </div>
                    )}
                    <div>
                      <div className="font-semibold text-xs text-zinc-100">{d.name}</div>
                      <div className="text-[11px] text-zinc-400">{d.company} · {d.title}</div>
                    </div>
                  </div>

                  <button
                    onClick={(e) => deleteDossier(d.id, e)}
                    className="p-1 rounded text-zinc-600 hover:text-rose-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Selected Dossier Display (7 cols) */}
        <div className="lg:col-span-7">
          {selectedDossier ? (
            <div className="p-6 rounded-2xl bg-zinc-950/80 border border-cyan-500/30 shadow-[0_0_30px_rgba(6,182,212,0.1)] space-y-5">
              {/* Profile Card Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
                <div className="flex items-center gap-4">
                  {selectedDossier.avatar ? (
                    <img
                      src={selectedDossier.avatar}
                      alt={selectedDossier.name}
                      className="w-16 h-16 rounded-2xl object-cover border-2 border-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.3)]"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-2xl bg-cyan-950 border border-cyan-500/40 flex items-center justify-center text-cyan-300 font-bold text-2xl font-orbitron">
                      {selectedDossier.name.slice(0, 1)}
                    </div>
                  )}
                  <div>
                    <h2 className="text-xl font-bold font-orbitron text-cyan-300">{selectedDossier.name}</h2>
                    <p className="text-xs text-zinc-300 font-medium">
                      {selectedDossier.title} @ <span className="text-cyan-400">{selectedDossier.company}</span>
                    </p>
                    <p className="text-[11px] text-zinc-500 flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3 h-3" /> {selectedDossier.location || "Bengaluru, India"}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const text = `Dossier: ${selectedDossier.name} (${selectedDossier.company})\n${selectedDossier.executiveBio}\n\nTalking Points:\n${selectedDossier.icebreakersAndTalkingPoints.map((p) => `• ${p}`).join("\n")}`;
                      copyText(text, "full-dossier");
                    }}
                    className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 hover:border-cyan-400 text-xs font-semibold text-zinc-300 flex items-center gap-1.5 transition-all"
                  >
                    {copiedKey === "full-dossier" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    Copy Briefing
                  </button>
                </div>
              </div>

              {/* Skills Tags */}
              <div className="flex flex-wrap gap-1.5">
                {selectedDossier.strengthsAndSkills?.map((skill, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded-md bg-cyan-950/60 border border-cyan-500/30 text-[11px] text-cyan-300 font-mono"
                  >
                    {skill}
                  </span>
                ))}
              </div>

              {/* Executive Bio */}
              <div className="p-3.5 rounded-xl bg-zinc-900/50 border border-zinc-800">
                <div className="text-[11px] font-mono text-cyan-400 uppercase mb-1">Executive Summary</div>
                <p className="text-xs md:text-sm text-zinc-200 font-sans leading-relaxed">
                  {selectedDossier.executiveBio}
                </p>
              </div>

              {/* Talking Points & Icebreakers */}
              <div className="space-y-2.5">
                <div className="text-xs font-orbitron font-bold text-cyan-300 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-cyan-400" />
                  TALKING POINTS FOR NEXT MEETING
                </div>
                <div className="space-y-2">
                  {selectedDossier.icebreakersAndTalkingPoints?.map((point, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-lg bg-zinc-900/40 border border-zinc-800/90 flex items-start justify-between gap-2 hover:border-cyan-500/30 transition-all"
                    >
                      <p className="text-xs text-zinc-200 font-sans leading-relaxed">
                        <span className="text-cyan-400 font-bold mr-1">#{i + 1}</span> {point}
                      </p>
                      <button
                        onClick={() => copyText(point, `point-${i}`)}
                        className="p-1 rounded text-zinc-500 hover:text-cyan-300 flex-shrink-0"
                      >
                        {copiedKey === `point-${i}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Mutual Interests & Sensitivities */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-zinc-900/40 border border-zinc-800">
                  <div className="text-[11px] font-mono text-emerald-400 uppercase mb-1">Predicted Mutual Interests</div>
                  <ul className="text-xs text-zinc-300 space-y-1 list-disc list-inside">
                    {selectedDossier.predictedMutualInterests?.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>

                <div className="p-3 rounded-lg bg-zinc-900/40 border border-zinc-800">
                  <div className="text-[11px] font-mono text-amber-400 uppercase mb-1">Topics To Avoid</div>
                  <ul className="text-xs text-zinc-300 space-y-1 list-disc list-inside">
                    {selectedDossier.sensitivityTopics?.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Instant WhatsApp / Follow-Up Draft */}
              <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-950/20 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-mono text-emerald-400 uppercase">
                  <span className="flex items-center gap-1.5">
                    <MessageCircle className="w-3.5 h-3.5" />
                    AI-CRAFTED FOLLOW-UP MESSAGE
                  </span>
                  <span>READY TO SEND</span>
                </div>
                <p className="text-xs text-zinc-200 font-sans italic bg-black/40 p-2.5 rounded border border-zinc-800">
                  "{selectedDossier.followUpDraft}"
                </p>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={() => copyText(selectedDossier.followUpDraft, "follow-up")}
                    className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 flex items-center gap-1.5"
                  >
                    {copiedKey === "follow-up" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    Copy Message
                  </button>
                  <button
                    onClick={() => {
                      setActivePanel("whatsapp");
                    }}
                    className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white flex items-center gap-1.5 shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Open WhatsApp to Send
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full min-h-[400px] flex flex-col items-center justify-center p-8 rounded-2xl bg-zinc-950/40 border border-zinc-800/80 text-center space-y-3">
              <div className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 text-cyan-400">
                <User className="w-8 h-8" />
              </div>
              <h3 className="font-orbitron text-base text-zinc-300">NO DOSSIER SELECTED</h3>
              <p className="text-xs text-zinc-500 max-w-sm">
                Upload a photo, paste a LinkedIn screenshot, or select an existing contact on the left to view their secret intelligence brief.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
