"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Cpu,
  MessageSquare,
  FileText,
  FolderOpen,
  RefreshCw,
  Play,
  Loader2,
  Check,
  AlertCircle,
  ExternalLink,
  Power,
  HardDrive,
} from "lucide-react";

export default function LocalLLMPanel() {
  const [action, setAction] = useState<"chat" | "summarize" | "query-document">("chat");
  const [input, setInput] = useState("");
  const [filePath, setFilePath] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const body: any = { action };
      if (action === "chat") {
        body.query = input;
      } else if (action === "summarize") {
        body.text = input;
      } else if (action === "query-document") {
        body.filePath = filePath;
        body.query = input;
      }

      const res = await fetch("/api/local-llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.success) {
        setResult(data);
      } else {
        setError(data.error || "Failed to process");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-green-900/20 to-emerald-900/20 rounded-2xl border border-green-500/30 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-green-500/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
            <Cpu className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-green-400">Local LLM</h3>
            <p className="text-xs text-green-400/60">Offline AI Processing</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Benefits */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { icon: Power, text: "100% Free" },
            { icon: RefreshCw, text: "Works Offline" },
            { icon: HardDrive, text: "Private" },
            { icon: Cpu, text: "Fast (Local)" },
          ].map((item) => (
            <div
              key={item.text}
              className="flex items-center gap-2 p-2 bg-green-500/10 rounded-lg"
            >
              <item.icon className="w-4 h-4 text-green-400" />
              <span className="text-xs text-green-100/70">{item.text}</span>
            </div>
          ))}
        </div>

        {/* Action Selector */}
        <div className="flex gap-2 p-1 bg-green-500/10 rounded-xl">
          {[
            { id: "chat", icon: MessageSquare, label: "Chat" },
            { id: "summarize", icon: FileText, label: "Summarize" },
            { id: "query-document", icon: FolderOpen, label: "Query File" },
          ].map((a) => (
            <button
              key={a.id}
              onClick={() => {
                setAction(a.id as typeof action);
                setInput("");
                setResult(null);
                setError(null);
              }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${
                action === a.id
                  ? "bg-green-500 text-white"
                  : "text-green-400 hover:bg-green-500/10"
              }`}
            >
              <a.icon className="w-4 h-4" />
              {a.label}
            </button>
          ))}
        </div>

        {/* Input Area */}
        <div className="space-y-3">
          {action === "query-document" && (
            <div>
              <label className="text-green-400 text-xs font-medium mb-1 block">
                File Path
              </label>
              <input
                type="text"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                placeholder="C:\\Users\\...\\document.txt"
                className="w-full px-4 py-3 bg-green-500/10 border border-green-500/30 rounded-xl text-white placeholder-green-400/40 focus:border-green-400 focus:outline-none text-sm"
              />
            </div>
          )}

          <div>
            <label className="text-green-400 text-xs font-medium mb-1 block">
              {action === "chat" && "Message"}
              {action === "summarize" && "Text to Summarize"}
              {action === "query-document" && "Question about Document"}
            </label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                action === "chat"
                  ? "Ask anything..."
                  : action === "summarize"
                  ? "Paste long text here..."
                  : "What do you want to know about the document?"
              }
              className="w-full h-24 px-4 py-3 bg-green-500/10 border border-green-500/30 rounded-xl text-white placeholder-green-400/40 focus:border-green-400 focus:outline-none resize-none"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading || (!input && action !== "query-document") || (action === "query-document" && !filePath)}
            className="w-full py-3 bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl text-white font-medium flex items-center justify-center gap-2 hover:from-green-400 hover:to-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Processing locally...
              </>
            ) : (
              <>
                <Play className="w-5 h-5" />
                Run Local AI
              </>
            )}
          </button>
        </div>

        {/* Error / Setup */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-yellow-100 mb-3">{error}</p>
                <h5 className="text-xs font-medium text-yellow-400 mb-2">
                  Setup Instructions
                </h5>
                <ol className="text-xs text-yellow-100/70 space-y-1 list-decimal list-inside">
                  <li>Download Ollama from ollama.ai</li>
                  <li>Open terminal and run: ollama serve</li>
                  <li>Pull a model: ollama pull llama2</li>
                  <li>Keep terminal open while using</li>
                </ol>
                <a
                  href="https://ollama.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-2 text-xs text-yellow-400 hover:underline"
                >
                  Download Ollama
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </motion.div>
        )}

        {/* Result */}
        {result && !error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-green-500/5 rounded-xl p-4 border border-green-500/20"
          >
            <div className="flex items-center gap-2 mb-3">
              <Check className="w-4 h-4 text-green-400" />
              <span className="text-xs font-medium text-green-400">
                {result.mode === "local" ? "Local AI Response" : "Response"}
              </span>
            </div>
            <div className="text-green-100/90 whitespace-pre-wrap text-sm leading-relaxed">
              {result.response || result.answer || result.summary}
            </div>
            {result.documentLength && (
              <p className="text-xs text-green-400/60 mt-2">
                Document size: {result.documentLength.toLocaleString()} chars
              </p>
            )}
          </motion.div>
        )}

        {/* Available Models */}
        {!result && !error && (
          <div className="bg-green-500/5 rounded-xl p-4 border border-green-500/20">
            <h4 className="text-sm font-medium text-green-400 mb-3">
              Recommended Models
            </h4>
            <div className="space-y-2">
              {[
                { name: "llama2", size: "3.8GB", desc: "General purpose" },
                { name: "mistral", size: "4.1GB", desc: "Fast & capable" },
                { name: "codellama", size: "3.8GB", desc: "Code generation" },
              ].map((model) => (
                <div
                  key={model.name}
                  className="flex items-center justify-between p-2 bg-green-500/10 rounded-lg"
                >
                  <span className="text-sm text-green-100">{model.name}</span>
                  <div className="text-right">
                    <span className="text-xs text-green-400">{model.size}</span>
                    <p className="text-xs text-green-400/60">{model.desc}</p>
                  </div>
                </div>
              ))}
            </div>          </div>
        )}
      </div>
    </div>
  );
}
