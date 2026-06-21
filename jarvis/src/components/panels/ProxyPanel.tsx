"use client";

import { motion } from "framer-motion";
import { X, ShieldAlert, Cpu, Download, ToggleLeft, ToggleRight, Radio, Globe, HelpCircle } from "lucide-react";
import { useEffect, useState } from "react";

interface ProxyPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ProxyPanel({ isOpen, onClose }: ProxyPanelProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"chrome" | "cert" | "help">("chrome");

  const checkStatus = async () => {
    try {
      const res = await fetch("/api/proxy/control");
      const data = await res.json();
      if (data.success && data.status) {
        setIsRunning(data.status.running);
      }
    } catch (e) {
      console.error("Failed to check proxy status:", e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      checkStatus();
      // Add initial helper logs
      setLogs([
        "Proxy control interface initialized.",
        "Awaiting instruction..."
      ]);
    }
  }, [isOpen]);

  const toggleProxy = async () => {
    setLoading(true);
    const action = isRunning ? "stop" : "start";
    const timestamp = new Date().toLocaleTimeString();
    
    setLogs((prev) => [...prev, `[${timestamp}] Requesting proxy ${action}...`]);
    
    try {
      const res = await fetch("/api/proxy/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      
      if (data.success) {
        setIsRunning(data.status.running);
        setLogs((prev) => [
          ...prev,
          `[${timestamp}] Proxy successfully ${action === "start" ? "started on port " + data.status.port : "stopped"}.`
        ]);
        if (action === "start") {
          setLogs((prev) => [
            ...prev,
            `[${timestamp}] ROOT Certificate generated. Please download and trust the certificate to enable HTTPS injection.`
          ]);
        }
      } else {
        setLogs((prev) => [...prev, `[${timestamp}] ERROR: ${data.error || "Failed execution"}`]);
      }
    } catch (error: any) {
      setLogs((prev) => [...prev, `[${timestamp}] Connection failed: ${error?.message || error}`]);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed top-4 right-4 z-50 w-[420px] h-[650px] bg-slate-950/95 border border-cyan-500/30
                 rounded-xl overflow-hidden shadow-2xl shadow-cyan-500/20 flex flex-col backdrop-blur-md"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900/80 border-b border-cyan-500/20">
        <div className="flex items-center gap-2">
          <Radio className={`w-4 h-4 ${isRunning ? "text-emerald-400 animate-pulse" : "text-cyan-400"}`} />
          <span className="text-sm font-semibold tracking-wider text-cyan-400 font-mono">AUTONOMOUS PROXY CORE</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-red-500/20 rounded transition-colors">
          <X className="w-4 h-4 text-cyan-400" />
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        
        {/* Toggle Switch */}
        <div className="bg-slate-900/50 border border-cyan-500/10 rounded-lg p-4 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-white">Proxy Injection Link</h4>
            <p className="text-xs text-slate-400">Inject JARVIS directly into active browsers</p>
          </div>
          <button 
            onClick={toggleProxy} 
            disabled={loading}
            className="focus:outline-none disabled:opacity-50 transition-transform active:scale-95"
          >
            {isRunning ? (
              <ToggleRight className="w-12 h-12 text-emerald-400" />
            ) : (
              <ToggleLeft className="w-12 h-12 text-slate-500" />
            )}
          </button>
        </div>

        {/* State Display */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-900/40 border border-cyan-500/10 rounded-lg p-3 text-center">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">Status</span>
            <div className="flex items-center justify-center gap-2 mt-1">
              <span className={`w-2.5 h-2.5 rounded-full ${isRunning ? "bg-emerald-400 shadow-md shadow-emerald-500" : "bg-red-500"}`} />
              <span className="text-sm font-bold text-white font-mono">{isRunning ? "ACTIVE" : "OFFLINE"}</span>
            </div>
          </div>
          <div className="bg-slate-900/40 border border-cyan-500/10 rounded-lg p-3 text-center">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">Intercept Port</span>
            <div className="text-sm font-bold text-cyan-400 font-mono mt-1">8080</div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-cyan-500/15">
          <button
            onClick={() => setActiveTab("chrome")}
            className={`flex-1 pb-2 text-xs font-semibold ${
              activeTab === "chrome" ? "text-cyan-400 border-b-2 border-cyan-500" : "text-slate-400"
            }`}
          >
            <div className="flex items-center justify-center gap-1">
              <Globe className="w-3.5 h-3.5" />
              <span>Browsers</span>
            </div>
          </button>
          <button
            onClick={() => setActiveTab("cert")}
            className={`flex-1 pb-2 text-xs font-semibold ${
              activeTab === "cert" ? "text-cyan-400 border-b-2 border-cyan-500" : "text-slate-400"
            }`}
          >
            <div className="flex items-center justify-center gap-1">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>SSL Certificate</span>
            </div>
          </button>
          <button
            onClick={() => setActiveTab("help")}
            className={`flex-1 pb-2 text-xs font-semibold ${
              activeTab === "help" ? "text-cyan-400 border-b-2 border-cyan-500" : "text-slate-400"
            }`}
          >
            <div className="flex items-center justify-center gap-1">
              <HelpCircle className="w-3.5 h-3.5" />
              <span>FAQ</span>
            </div>
          </button>
        </div>

        {/* Tab content */}
        <div className="bg-slate-900/30 border border-cyan-500/10 rounded-lg p-3 min-h-[160px] text-xs leading-relaxed text-slate-300">
          {activeTab === "chrome" && (
            <div className="space-y-2">
              <p className="font-semibold text-cyan-400">Launch Chrome / Edge / Comet:</p>
              <p>To start browsing with JARVIS injected, launch your browser via terminal or shortcut with these flags:</p>
              <div className="bg-black/60 p-2 rounded font-mono text-[10px] text-cyan-200 select-all overflow-x-auto whitespace-pre-wrap">
                chrome.exe --proxy-server="http://localhost:8080" --ignore-certificate-errors
              </div>
              <p className="text-[10px] text-slate-400 italic">
                * Note: For Edge, replace chrome.exe with msedge.exe. For Comet, use comet.exe.
              </p>
            </div>
          )}

          {activeTab === "cert" && (
            <div className="space-y-3">
              <p className="font-semibold text-cyan-400">Trust JARVIS SSL Certificate:</p>
              <p>Because JARVIS decrypts and injects into HTTPS sites, your browser requires you to trust the local CA root certificate once.</p>
              
              <a
                href="/api/proxy/cert"
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-medium rounded text-[11px] transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download CA Certificate</span>
              </a>

              <div className="space-y-1 mt-2 text-[10px] text-slate-400">
                <p>1. Double-click the downloaded <code className="text-cyan-300">jarvis-ca.pem</code> file.</p>
                <p>2. Select "Install Certificate" &gt; "Local Machine".</p>
                <p>3. Choose "Place all certificates in the following store".</p>
                <p>4. Click Browse and select <code className="text-cyan-300">Trusted Root Certification Authorities</code>.</p>
              </div>
            </div>
          )}

          {activeTab === "help" && (
            <div className="space-y-2">
              <p className="font-semibold text-cyan-400">How it works:</p>
              <p>JARVIS intercepts the incoming page HTML, adds a stylish Arc Reactor floating button, and lets you speak/type prompts using context on the active webpage.</p>
              <p className="font-semibold text-cyan-400 mt-2">Hotkey:</p>
              <p>Press <kbd className="bg-slate-800 px-1 rounded border border-slate-700 font-mono text-cyan-300">Ctrl + Shift + J</kbd> inside any page to toggle the JARVIS command bar.</p>
            </div>
          )}
        </div>
      </div>

      {/* Terminal Log Output */}
      <div className="h-44 bg-slate-950 border-t border-cyan-500/25 p-3 overflow-y-auto font-mono text-[11px]">
        <div className="flex items-center gap-1.5 mb-2 text-cyan-400/70 font-semibold uppercase tracking-wider">
          <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          <span>Console Logs</span>
        </div>
        <div className="space-y-1">
          {logs.map((log, i) => (
            <div key={i} className="text-cyan-200/80 border-l-2 border-cyan-500/20 pl-2">
              {log}
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
