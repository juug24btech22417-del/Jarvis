"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cpu,
  MessageSquare,
  Languages,
  Smile,
  HelpCircle,
  FileText,
  Tag,
  Loader2,
  Send,
  Copy,
  Check,
  Sparkles,
  Bot,
  User,
  Zap,
  AlertCircle,
  Globe,
  Brain,
  AlignLeft,
  MessageCircle,
} from "lucide-react";

const TASKS = [
  { id: "summarization", name: "Summarize", icon: FileText, desc: "TL;DR", color: "from-violet-500 to-purple-600" },
  { id: "translation", name: "Translate", icon: Languages, desc: "Global", color: "from-blue-500 to-cyan-600" },
  { id: "sentiment", name: "Sentiment", icon: Smile, desc: "Analyze", color: "from-emerald-500 to-teal-600" },
  { id: "qa", name: "Q&A", icon: HelpCircle, desc: "Extract", color: "from-amber-500 to-orange-600" },
  { id: "generate", name: "Generate", icon: Sparkles, desc: "Create", color: "from-rose-500 to-pink-600" },
  { id: "zero-shot", name: "Classify", icon: Tag, desc: "Sort", color: "from-indigo-500 to-blue-600" },
];

const LANGUAGES = [
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "pt", name: "Português" },
  { code: "hi", name: "हिन्दी" },
  { code: "zh", name: "中文" },
  { code: "ja", name: "日本語" },
];

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  error?: boolean;
  fallback?: boolean;
}

export default function HuggingFacePanel() {
  const [mode, setMode] = useState<"tasks" | "chat">("tasks");
  const [selectedTask, setSelectedTask] = useState("summarization");
  const [input, setInput] = useState("");
  const [context, setContext] = useState("");
  const [labels, setLabels] = useState("positive, negative, neutral");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [targetLang, setTargetLang] = useState("es");
  const [showWelcome, setShowWelcome] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleChatSubmit = async () => {
    if (!chatInput.trim()) return;
    const userMessage = chatInput.trim();
    setChatMessages((prev) => [...prev, { role: "user", content: userMessage, timestamp: new Date() }]);
    setChatInput("");
    setShowWelcome(false);
    setLoading(true);

    try {
      const res = await fetch("/api/huggingface", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "generate",
          inputs: `User: ${userMessage}\nAssistant:`,
          options: { maxTokens: 150, temperature: 0.8 },
        }),
      });

      const data = await res.json();
      if (data.success && data.generated_text) {
        const aiResponse = data.generated_text.trim().replace(/^User:/i, "").replace(/^Assistant:/i, "").trim();
        setChatMessages((prev) => [...prev, { role: "assistant", content: aiResponse || "Hello! How can I help you?", timestamp: new Date(), fallback: data.fallback }]);
      } else {
        setChatMessages((prev) => [...prev, { role: "assistant", content: `Error: ${data.error || "Failed to get response"}`, timestamp: new Date(), error: true }]);
      }
    } catch (err: any) {
      setChatMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err.message || "Connection failed"}`, timestamp: new Date(), error: true }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!input && selectedTask !== "qa") return;
    if (selectedTask === "qa" && (!input || !context)) {
      setError("Q&A requires both a question AND context text.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const body: any = { task: selectedTask, inputs: input };
      if (selectedTask === "qa") {
        body.inputs = { question: input, context };
      } else if (selectedTask === "zero-shot") {
        body.inputs = { text: input, labels: labels.split(",").map((l) => l.trim()) };
      } else if (selectedTask === "translation") {
        body.options = { targetLang };
      }

      const res = await fetch("/api/huggingface", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.success) {
        setResult(data);
      } else {
        setError(data.error || "Request failed");
      }
    } catch (err: any) {
      setError(err.message || "Network error");
    } finally {
      setLoading(false);
    }
  };

  const copyResult = () => {
    navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const selectedTaskData = TASKS.find(t => t.id === selectedTask);

  return (
    <div className="h-full flex flex-col relative overflow-hidden">
      {/* Ambient Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -right-1/2 w-full h-full bg-gradient-to-bl from-violet-500/10 via-fuchsia-500/5 to-transparent rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-1/2 -left-1/2 w-full h-full bg-gradient-to-tr from-indigo-500/10 via-blue-500/5 to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      {/* Glass Header */}
      <div className="relative p-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="absolute inset-0 bg-gradient-to-br from-violet-500 to-fuchsia-600 rounded-2xl blur-lg opacity-50 group-hover:opacity-70 transition-opacity" />
              <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500/90 to-fuchsia-600/90 backdrop-blur-xl border border-white/20 flex items-center justify-center shadow-2xl">
                <Brain className="w-6 h-6 text-white" />
              </div>
            </div>
            <div>
              <h3 className="text-xl font-bold bg-gradient-to-r from-white via-violet-100 to-fuchsia-200 bg-clip-text text-transparent">
                Neural Studio
              </h3>
              <p className="text-xs text-violet-300/60 font-medium tracking-wide uppercase">
                AI Model Playground
              </p>
            </div>
          </div>

          {/* Mode Switcher */}
          <div className="flex p-1 rounded-2xl bg-black/20 backdrop-blur-xl border border-white/10">
            {[
              { id: "tasks", icon: Zap, label: "Tasks" },
              { id: "chat", icon: MessageCircle, label: "Chat" },
            ].map((m) => {
              const Icon = m.icon;
              const isActive = mode === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id as "tasks" | "chat")}
                  className={`relative px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-300 flex items-center gap-2 ${
                    isActive ? "text-white" : "text-white/40 hover:text-white/70"
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="hfMode"
                      className="absolute inset-0 bg-gradient-to-r from-violet-500/80 to-fuchsia-500/80 rounded-xl border border-white/20"
                      transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5">
                    <Icon className="w-3.5 h-3.5" />
                    {m.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 overflow-auto px-6 pb-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
          <AnimatePresence mode="wait">
            {mode === "tasks" ? (
              <motion.div
                key="tasks"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-5"
              >
                {/* Task Grid */}
                <div className="grid grid-cols-3 gap-3">
                  {TASKS.map((task, idx) => {
                    const Icon = task.icon;
                    const isActive = selectedTask === task.id;
                    return (
                      <motion.button
                        key={task.id}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: idx * 0.05 }}
                        onClick={() => { setSelectedTask(task.id); setResult(null); setError(null); }}
                        className={`group relative p-4 rounded-2xl transition-all duration-300 ${
                          isActive
                            ? "bg-white/10 border-white/30"
                            : "bg-white/5 border-white/10 hover:bg-white/10"
                        } border backdrop-blur-md`}
                      >
                        {isActive && (
                          <motion.div
                            layoutId="activeTask"
                            className={`absolute inset-0 bg-gradient-to-br ${task.color} opacity-20 rounded-2xl`}
                            transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                          />
                        )}
                        <div className="relative flex flex-col items-center gap-2">
                          <div className={`p-2.5 rounded-xl ${isActive ? `bg-gradient-to-br ${task.color}` : "bg-white/10"}`}>
                            <Icon className="w-5 h-5 text-white" />
                          </div>
                          <span className={`text-xs font-semibold ${isActive ? "text-white" : "text-white/60"}`}>
                            {task.name}
                          </span>
                          <span className="text-[9px] text-white/40 uppercase tracking-wider">{task.desc}</span>
                        </div>
                      </motion.button>
                    );
                  })}
                </div>

                {/* Language Selector for Translation */}
                {selectedTask === "translation" && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <Globe className="w-4 h-4 text-blue-400" />
                      <span className="text-xs font-medium text-white/80">Target Language</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {LANGUAGES.map((lang) => (
                        <button
                          key={lang.code}
                          onClick={() => setTargetLang(lang.code)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                            targetLang === lang.code
                              ? "bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg shadow-blue-500/25"
                              : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
                          }`}
                        >
                          {lang.name}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* Input Section */}
                <div className="p-5 rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10">
                  <div className="flex items-center gap-2 mb-4">
                    <div className={`p-1.5 rounded-lg bg-gradient-to-br ${selectedTaskData?.color}`}>
                      {selectedTaskData && <selectedTaskData.icon className="w-4 h-4 text-white" />}
                    </div>
                    <span className="text-sm font-semibold text-white/80">{selectedTaskData?.name}</span>
                  </div>

                  {selectedTask === "qa" ? (
                    <div className="space-y-4">
                      <div>
                        <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Context</label>
                        <textarea
                          value={context}
                          onChange={(e) => setContext(e.target.value)}
                          placeholder="Paste your context here..."
                          className="w-full h-24 px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-white/30 focus:outline-none resize-none text-sm transition-all"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Question</label>
                        <input
                          type="text"
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          placeholder="What do you want to know?"
                          className="w-full px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-white/30 focus:outline-none text-sm transition-all"
                        />
                      </div>
                    </div>
                  ) : selectedTask === "zero-shot" ? (
                    <div className="space-y-4">
                      <div>
                        <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Text to Classify</label>
                        <input
                          type="text"
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          placeholder="Enter text..."
                          className="w-full px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-white/30 focus:outline-none text-sm transition-all"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Labels (comma separated)</label>
                        <input
                          type="text"
                          value={labels}
                          onChange={(e) => setLabels(e.target.value)}
                          placeholder="e.g. positive, negative, neutral"
                          className="w-full px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-white/30 focus:outline-none text-sm transition-all"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Input Text</label>
                      <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={`Enter text to ${selectedTaskData?.name.toLowerCase()}...`}
                        className="w-full h-28 px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-white/30 focus:outline-none resize-none text-sm transition-all"
                      />
                    </div>
                  )}

                  <button
                    onClick={handleSubmit}
                    disabled={loading || (!input && selectedTask !== "qa")}
                    className="mt-4 w-full py-3 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-semibold flex items-center justify-center gap-2 hover:from-violet-400 hover:to-fuchsia-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-violet-500/25"
                  >
                    {loading ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                    ) : (
                      <><Sparkles className="w-4 h-4" /> Run {selectedTaskData?.name}</>
                    )}
                  </button>
                </div>

                {/* Error */}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 backdrop-blur-md flex items-center gap-3"
                  >
                    <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                    <p className="text-sm text-red-300">{error}</p>
                  </motion.div>
                )}

                {/* Result */}
                {result && <ResultCard result={result} selectedTask={selectedTask} selectedTaskData={selectedTaskData} copyResult={copyResult} copied={copied} input={input} />}
              </motion.div>
            ) : (
              <ChatMode
                chatMessages={chatMessages}
                chatInput={chatInput}
                setChatInput={setChatInput}
                handleChatSubmit={handleChatSubmit}
                loading={loading}
                showWelcome={showWelcome}
                chatEndRef={chatEndRef}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function ResultCard({ result, selectedTask, selectedTaskData, copyResult, copied, input }: any) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="p-5 rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-semibold text-white/80">Result</span>
        </div>
        <div className="flex items-center gap-2">
          {result.fallback && (
            <span className="text-[10px] px-2 py-1 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
              Fallback
            </span>
          )}
          <button
            onClick={copyResult}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-all"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div className="bg-black/20 rounded-2xl p-4 border border-white/5">
        {selectedTask === "sentiment" && result.sentiment && (
          <div className="space-y-3">
            {result.sentiment.map((s: any, idx: number) => (
              <div key={idx}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-white/80 capitalize">{s.label}</span>
                  <span className="text-xs text-white/50">{(s.score * 100).toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${s.score * 100}%` }}
                    transition={{ duration: 0.8, delay: idx * 0.1 }}
                    className={`h-full rounded-full bg-gradient-to-r ${selectedTaskData?.color}`}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedTask === "translation" && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-white/5 border border-white/10">
              <span className="text-[10px] text-white/40 uppercase tracking-wider">Original</span>
              <p className="text-white/60 text-sm mt-1">{input}</p>
            </div>
            <div className="flex justify-center">
              <div className="p-2 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500">
                <Languages className="w-4 h-4 text-white" />
              </div>
            </div>
            <div className="p-3 rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-white/20">
              <span className="text-[10px] text-violet-300 uppercase tracking-wider">Translation</span>
              <p className="text-white text-lg font-medium mt-1">{result.translation}</p>
            </div>
          </div>
        )}

        {selectedTask === "summarization" && (
          <div className="relative">
            <AlignLeft className="absolute top-0 left-0 w-5 h-5 text-violet-400/30" />
            <p className="text-white/80 leading-relaxed pl-7">{result.summary}</p>
          </div>
        )}

        {selectedTask === "qa" && (
          <div className="space-y-3">
            <div className="text-white font-medium text-lg">{result.answer}</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(result.score || 0) * 100}%` }}
                  transition={{ duration: 0.8 }}
                  className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full"
                />
              </div>
              <span className="text-xs text-white/50">{((result.score || 0) * 100).toFixed(1)}% confidence</span>
            </div>
          </div>
        )}

        {selectedTask === "generate" && (
          <div className="text-white/80 leading-relaxed whitespace-pre-wrap">{result.generated_text}</div>
        )}

        {selectedTask === "zero-shot" && result.classifications?.[0] && (
          <div className="space-y-3">
            {result.classifications[0].labels.map((label: string, idx: number) => (
              <div key={idx}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-white/80 capitalize">{label}</span>
                  <span className="text-xs text-white/50">{(result.classifications[0].scores[idx] * 100).toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${result.classifications[0].scores[idx] * 100}%` }}
                    transition={{ duration: 0.8, delay: idx * 0.1 }}
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-blue-500"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function ChatMode({ chatMessages, chatInput, setChatInput, handleChatSubmit, loading, showWelcome, chatEndRef }: any) {
  return (
    <motion.div
      key="chat"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="h-full flex flex-col"
    >
      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
        {showWelcome && chatMessages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="h-full flex flex-col items-center justify-center text-center py-12"
          >
            <div className="relative mb-6">
              <div className="absolute inset-0 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-full blur-2xl opacity-30" />
              <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-white/20 flex items-center justify-center backdrop-blur-md">
                <Bot className="w-10 h-10 text-violet-300" />
              </div>
            </div>
            <h4 className="text-xl font-bold text-white mb-2">AI Assistant</h4>
            <p className="text-sm text-white/40 max-w-xs">
              Ask me anything. I'm powered by advanced language models to help with your questions.
            </p>
          </motion.div>
        )}

        {chatMessages.map((msg: ChatMessage, idx: number) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
              msg.role === "user"
                ? "bg-gradient-to-br from-violet-500 to-fuchsia-500"
                : "bg-white/10 border border-white/20"
            }`}>
              {msg.role === "user" ? <User className="w-4 h-4 text-white" /> : <Bot className="w-4 h-4 text-violet-300" />}
            </div>
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
              msg.role === "user"
                ? "bg-gradient-to-br from-violet-500/90 to-fuchsia-500/90 text-white"
                : msg.error
                ? "bg-red-500/10 border border-red-500/30 text-red-200"
                : msg.fallback
                ? "bg-amber-500/10 border border-amber-500/30 text-amber-100"
                : "bg-white/10 border border-white/20 text-white/90"
            }`}>
              <div>{msg.content}</div>
              {msg.fallback && (
                <div className="text-[10px] text-amber-400/70 mt-1.5 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Using fallback mode
                </div>
              )}
            </div>
          </motion.div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Chat Input */}
      <div className="p-4 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10">
        <div className="flex gap-2">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChatSubmit(); } }}
            placeholder="Type your message..."
            className="flex-1 px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-white/30 focus:outline-none text-sm transition-all"
          />
          <button
            onClick={handleChatSubmit}
            disabled={loading || !chatInput.trim()}
            className="px-4 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:from-violet-400 hover:to-fuchsia-400 disabled:opacity-50 transition-all"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
