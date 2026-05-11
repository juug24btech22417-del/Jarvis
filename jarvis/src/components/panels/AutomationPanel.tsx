"use client";

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  BookOpen,
  CheckSquare,
  Mail,
  Loader2,
  Check,
  AlertCircle,
  X,
  Upload,
  FileText,
  Image,
  Paperclip,
  Trash2,
  Send,
  Sparkles,
  Wand2,
  Edit3,
  User,
  Briefcase,
  Clock,
  Heart,
  Video,
  Globe
} from "lucide-react";
import MeetingBotPanel from "./MeetingBotPanel";
import ResearchPanel from "./ResearchPanel";

interface FileAttachment {
  id: string;
  file: File;
  name: string;
  size: string;
  type: string;
  preview?: string;
}

interface AIEmailContext {
  recipientName: string;
  purpose: string;
  tone: "professional" | "casual" | "urgent" | "friendly" | "formal";
  keyPoints: string;
}

export default function AutomationPanel() {
  const [activeTab, setActiveTab] = useState<"notion" | "todoist" | "meeting" | "research" | "email">("notion");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form states
  const [notionData, setNotionData] = useState({ title: "", url: "", content: "", tags: "" });
  const [todoistData, setTodoistData] = useState({ content: "", dueString: "", priority: 1 });
  const [emailData, setEmailData] = useState({ to: "", subject: "", text: "" });
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);

  // AI Email Composer states
  const [emailMode, setEmailMode] = useState<"manual" | "ai">("manual");
  const [aiContext, setAiContext] = useState<AIEmailContext>({
    recipientName: "",
    purpose: "",
    tone: "professional",
    keyPoints: "",
  });
  const [aiGenerated, setAiGenerated] = useState<{ subject: string; body: string } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    addFiles(files);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    addFiles(files);
  };

  const addFiles = (files: File[]) => {
    const newAttachments: FileAttachment[] = files.map((file) => ({
      id: Math.random().toString(36).substring(2, 15),
      file,
      name: file.name,
      size: formatFileSize(file.size),
      type: file.type,
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
    }));

    setAttachments((prev) => [...prev, ...newAttachments]);
  };

  // AI Email Generator using OpenRouter
  const generateAIEmail = async () => {
    if (!aiContext.purpose) {
      setResult({ success: false, message: "Please enter a purpose for the email" });
      return;
    }
    setAiLoading(true);
    setResult(null);

    try {
      const systemPrompt = `You are an expert email writing assistant. Write professional, well-structured emails based on the context provided.
Your response must be in this exact format:
SUBJECT: [concise, clear subject line]

BODY:
[well-formatted email body with appropriate greeting and closing]

Make the email sound natural and professional. Do not include any explanations or notes outside the email format.`;

      const userPrompt = `Write an email with the following details:

Recipient: ${aiContext.recipientName || "Recipient"}
Purpose: ${aiContext.purpose}
Tone: ${aiContext.tone}
${aiContext.keyPoints ? `Key points to include:\n${aiContext.keyPoints}` : ""}`;

      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const res = await fetch("/api/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 800,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error ${res.status}`);
      }

      const data = await res.json();

      if (data.success && data.content) {
        // Parse the generated text
        const text = data.content;
        let subject = "";
        let body = "";

        // Try to extract subject and body
        const subjectMatch = text.match(/SUBJECT:\s*(.+?)(?:\n|$)/i);
        const bodyMatch = text.match(/BODY:\s*([\s\S]+)/i);

        if (subjectMatch) {
          subject = subjectMatch[1].trim();
        }

        if (bodyMatch) {
          body = bodyMatch[1].trim();
        } else {
          // If no BODY marker, use text after SUBJECT or everything
          body = subjectMatch ? text.split(/SUBJECT:.+?(?:\n|$)/i)[1]?.trim() || text : text;
        }

        // Clean up
        subject = subject.replace(/^["']|["']$/g, ""); // Remove quotes

        setAiGenerated({ subject, body });
        setEmailData({
          to: emailData.to,
          subject: subject,
          text: body,
        });
      } else {
        setResult({ success: false, message: data.error || "AI generation failed. Please try again." });
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        setResult({ success: false, message: "Request timed out. Please try again." });
      } else {
        setResult({ success: false, message: err.message || "AI generation failed" });
      }
    } finally {
      setAiLoading(false);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const attachment = prev.find((a) => a.id === id);
      if (attachment?.preview) {
        URL.revokeObjectURL(attachment.preview);
      }
      return prev.filter((a) => a.id !== id);
    });
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith("image/")) return Image;
    return FileText;
  };

  const handleNotionSubmit = async () => {
    if (!notionData.title) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/notion/create-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...notionData,
          tags: notionData.tags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ success: true, message: "Saved to Notion!" });
        setNotionData({ title: "", url: "", content: "", tags: "" });
      } else {
        setResult({ success: false, message: data.error || "Failed to save" });
      }
    } catch (err) {
      setResult({ success: false, message: String(err) });
    } finally {
      setLoading(false);
    }
  };

  const handleTodoistSubmit = async () => {
    if (!todoistData.content) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/todoist/add-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(todoistData),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ success: true, message: "Task added to Todoist!" });
        setTodoistData({ content: "", dueString: "", priority: 1 });
      } else {
        setResult({ success: false, message: data.error || "Failed to add task" });
      }
    } catch (err) {
      setResult({ success: false, message: String(err) });
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSubmit = async () => {
    if (!emailData.to || !emailData.subject) return;
    setLoading(true);
    setResult(null);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append("to", emailData.to);
      formData.append("subject", emailData.subject);
      formData.append("text", emailData.text);
      formData.append("html", `<p>${emailData.text}</p>`);

      // Add all attachments
      attachments.forEach((att, index) => {
        formData.append(`attachment${index}`, att.file);
      });

      const res = await fetch("/api/send-email", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (data.success) {
        const attachmentCount = attachments.length;
        setResult({
          success: true,
          message: `Email sent${attachmentCount > 0 ? ` with ${attachmentCount} attachment${attachmentCount > 1 ? 's' : ''}` : ''}!`,
        });
        setEmailData({ to: "", subject: "", text: "" });
        setAttachments([]);
      } else {
        setResult({ success: false, message: data.error || data.details || "Failed to send" });
      }
    } catch (err: any) {
      setResult({ success: false, message: err.message || "Failed to send email" });
    } finally {
      setLoading(false);
      setUploadProgress(0);
    }
  };

  const tabs = [
    { id: "notion" as const, icon: BookOpen, label: "Notion", desc: "Save to Database" },
    { id: "todoist" as const, icon: CheckSquare, label: "Todoist", desc: "Add Tasks" },
    { id: "email" as const, icon: Mail, label: "Email", desc: "Send Messages" },
    { id: "meeting" as const, icon: Video, label: "Bot", desc: "Attend Meeting" },
    { id: "research" as const, icon: Globe, label: "Research", desc: "Deep Dive" },
  ];

  const totalAttachmentSize = attachments.reduce((sum, att) => sum + att.file.size, 0);
  const formattedTotalSize = formatFileSize(totalAttachmentSize);

  return (
    <div className="h-full flex flex-col relative overflow-hidden">
      {/* Ambient Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-transparent rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-violet-500/10 via-fuchsia-500/5 to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      {/* Glass Header */}
      <div className="relative p-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl blur-lg opacity-50 group-hover:opacity-70 transition-opacity" />
              <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500/90 to-purple-600/90 backdrop-blur-xl border border-white/20 flex items-center justify-center shadow-2xl">
                <Zap className="w-6 h-6 text-white" />
              </div>
            </div>
            <div>
              <h3 className="text-xl font-bold bg-gradient-to-r from-white via-indigo-100 to-purple-200 bg-clip-text text-transparent">
                Direct Connect
              </h3>
              <p className="text-xs text-indigo-300/60 font-medium tracking-wide uppercase">
                API Integrations Hub
              </p>
            </div>
          </div>
        </div>

        {/* Premium Tab Navigation */}
        <div className="mt-6 flex p-1.5 rounded-2xl bg-black/20 backdrop-blur-xl border border-white/10">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  setResult(null);
                }}
                className={`relative flex-1 flex flex-col items-center gap-1 px-3 py-3 rounded-xl transition-all duration-300 ${
                  isActive ? "text-white" : "text-white/40 hover:text-white/70"
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="automationTab"
                    className="absolute inset-0 bg-gradient-to-br from-indigo-500/80 to-purple-600/80 rounded-xl border border-white/20 shadow-lg"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                  />
                )}
                <span className="relative z-10">
                  <Icon className="w-5 h-5" />
                </span>
                <span className="relative z-10 text-[10px] font-semibold tracking-wider uppercase">
                  {tab.label}
                </span>
                <span className="relative z-10 text-[8px] text-white/50">{tab.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 overflow-auto px-6 pb-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
          <AnimatePresence mode="wait">
            {activeTab === "notion" && (
              <motion.div
                key="notion"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-4"
              >
                <div className="p-5 rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10">
                  <div className="flex items-center gap-2 mb-4">
                    <BookOpen className="w-5 h-5 text-indigo-400" />
                    <span className="text-sm font-semibold text-white/80">Save to Notion Database</span>
                  </div>

                  <div className="space-y-3">
                    <input
                      type="text"
                      value={notionData.title}
                      onChange={(e) => setNotionData({ ...notionData, title: e.target.value })}
                      placeholder="Page Title"
                      className="w-full px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-white/30 focus:outline-none text-sm transition-all"
                    />
                    <input
                      type="url"
                      value={notionData.url}
                      onChange={(e) => setNotionData({ ...notionData, url: e.target.value })}
                      placeholder="URL (optional)"
                      className="w-full px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-white/30 focus:outline-none text-sm transition-all"
                    />
                    <textarea
                      value={notionData.content}
                      onChange={(e) => setNotionData({ ...notionData, content: e.target.value })}
                      placeholder="Notes and content..."
                      className="w-full h-24 px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-white/30 focus:outline-none resize-none text-sm transition-all"
                    />
                    <input
                      type="text"
                      value={notionData.tags}
                      onChange={(e) => setNotionData({ ...notionData, tags: e.target.value })}
                      placeholder="Tags: work, important, read-later (comma separated)"
                      className="w-full px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-white/30 focus:outline-none text-sm transition-all"
                    />
                  </div>

                  <button
                    onClick={handleNotionSubmit}
                    disabled={loading || !notionData.title}
                    className="mt-4 w-full py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-semibold flex items-center justify-center gap-2 hover:from-indigo-400 hover:to-purple-400 disabled:opacity-50 transition-all shadow-lg shadow-indigo-500/25"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><BookOpen className="w-4 h-4" /> Save to Notion</>}
                  </button>
                </div>

                <SetupInstructions service="notion" />
              </motion.div>
            )}

            {activeTab === "todoist" && (
              <motion.div
                key="todoist"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-4"
              >
                <div className="p-5 rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10">
                  <div className="flex items-center gap-2 mb-4">
                    <CheckSquare className="w-5 h-5 text-emerald-400" />
                    <span className="text-sm font-semibold text-white/80">Add Todoist Task</span>
                  </div>

                  <div className="space-y-3">
                    <input
                      type="text"
                      value={todoistData.content}
                      onChange={(e) => setTodoistData({ ...todoistData, content: e.target.value })}
                      placeholder="What needs to be done?"
                      className="w-full px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-white/30 focus:outline-none text-sm transition-all"
                    />
                    <input
                      type="text"
                      value={todoistData.dueString}
                      onChange={(e) => setTodoistData({ ...todoistData, dueString: e.target.value })}
                      placeholder="Due date: tomorrow, next week, Jan 15"
                      className="w-full px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-white/30 focus:outline-none text-sm transition-all"
                    />
                    <select
                      value={todoistData.priority}
                      onChange={(e) => setTodoistData({ ...todoistData, priority: parseInt(e.target.value) })}
                      className="w-full px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white focus:border-white/30 focus:outline-none text-sm transition-all [color-scheme:dark]"
                    >
                      <option value={1}>Normal Priority</option>
                      <option value={2}>Medium Priority</option>
                      <option value={3}>High Priority</option>
                      <option value={4}>Urgent</option>
                    </select>
                  </div>

                  <button
                    onClick={handleTodoistSubmit}
                    disabled={loading || !todoistData.content}
                    className="mt-4 w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-semibold flex items-center justify-center gap-2 hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50 transition-all shadow-lg shadow-emerald-500/25"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckSquare className="w-4 h-4" /> Add Task</>}
                  </button>
                </div>

                <SetupInstructions service="todoist" />
              </motion.div>
            )}

            {activeTab === "meeting" && (
              <motion.div
                key="meeting"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-4"
              >
                <MeetingBotPanel />
              </motion.div>
            )}

            {activeTab === "research" && (
              <motion.div
                key="research"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-4"
              >
                <ResearchPanel />
              </motion.div>
            )}

            {activeTab === "email" && (
              <motion.div
                key="email"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-4"
              >
                {/* Mode Switcher */}
                <div className="p-1.5 rounded-2xl bg-black/20 backdrop-blur-xl border border-white/10 flex">
                  <button
                    onClick={() => setEmailMode("manual")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                      emailMode === "manual"
                        ? "bg-gradient-to-r from-rose-500/80 to-pink-500/80 text-white"
                        : "text-white/50 hover:text-white/70"
                    }`}
                  >
                    <Edit3 className="w-4 h-4" />
                    Manual Compose
                  </button>
                  <button
                    onClick={() => setEmailMode("ai")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                      emailMode === "ai"
                        ? "bg-gradient-to-r from-violet-500/80 to-fuchsia-500/80 text-white"
                        : "text-white/50 hover:text-white/70"
                    }`}
                  >
                    <Wand2 className="w-4 h-4" />
                    AI Compose
                  </button>
                </div>

                {emailMode === "manual" ? (
                  <div className="p-5 rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10">
                    <div className="flex items-center gap-2 mb-4">
                      <Mail className="w-5 h-5 text-rose-400" />
                      <span className="text-sm font-semibold text-white/80">Compose Email</span>
                    </div>

                    <div className="space-y-3">
                      <input
                        type="email"
                        value={emailData.to}
                        onChange={(e) => setEmailData({ ...emailData, to: e.target.value })}
                        placeholder="To: recipient@example.com"
                        className="w-full px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-white/30 focus:outline-none text-sm transition-all"
                      />
                      <input
                        type="text"
                        value={emailData.subject}
                        onChange={(e) => setEmailData({ ...emailData, subject: e.target.value })}
                        placeholder="Subject"
                        className="w-full px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-white/30 focus:outline-none text-sm transition-all"
                      />
                      <textarea
                        value={emailData.text}
                        onChange={(e) => setEmailData({ ...emailData, text: e.target.value })}
                        placeholder="Write your message..."
                        className="w-full h-28 px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-white/30 focus:outline-none resize-none text-sm transition-all"
                      />
                    </div>

                  {/* File Attachments Section */}
                  <div className="mt-4 space-y-3">
                    {/* Drag & Drop Zone */}
                    <div
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`relative p-6 rounded-2xl border-2 border-dashed transition-all cursor-pointer ${
                        isDragging
                          ? "border-rose-400 bg-rose-500/10"
                          : "border-white/20 bg-white/5 hover:border-white/40 hover:bg-white/10"
                      }`}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      <div className="flex flex-col items-center gap-2">
                        <div className={`p-3 rounded-full transition-all ${
                          isDragging ? "bg-rose-500/20" : "bg-white/10"
                        }`}>
                          <Upload className={`w-6 h-6 transition-all ${
                            isDragging ? "text-rose-400" : "text-white/60"
                          }`} />
                        </div>
                        <p className="text-sm text-white/60 text-center">
                          {isDragging ? (
                            "Drop files here"
                          ) : (
                            <>Drag & drop files or <span className="text-rose-400">browse</span></>
                          )}
                        </p>
                        <p className="text-[10px] text-white/40">
                          Any file type • Multiple files allowed
                        </p>
                      </div>
                    </div>

                    {/* Attached Files List */}
                    <AnimatePresence>
                      {attachments.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="space-y-2"
                        >
                          <div className="flex items-center justify-between text-xs text-white/50">
                            <span>{attachments.length} file{attachments.length > 1 ? 's' : ''} attached</span>
                            <span>Total: {formattedTotalSize}</span>
                          </div>

                          <div className="space-y-2 max-h-40 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
                            {attachments.map((attachment) => {
                              const FileIcon = getFileIcon(attachment.type);
                              return (
                                <motion.div
                                  key={attachment.id}
                                  initial={{ opacity: 0, x: -20 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  exit={{ opacity: 0, x: 20 }}
                                  className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 group hover:bg-white/10 transition-all"
                                >
                                  <div className="relative w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center shrink-0 overflow-hidden">
                                    {attachment.preview ? (
                                      <img
                                        src={attachment.preview}
                                        alt={attachment.name}
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <FileIcon className="w-5 h-5 text-white/60" />
                                    )}
                                  </div>

                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm text-white/80 truncate">{attachment.name}</p>
                                    <p className="text-[10px] text-white/40">{attachment.size}</p>
                                  </div>

                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      removeAttachment(attachment.id);
                                    }}
                                    className="p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-all"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </motion.div>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <button
                    onClick={handleEmailSubmit}
                    disabled={loading || !emailData.to || !emailData.subject}
                    className="mt-4 w-full py-3 rounded-xl bg-gradient-to-r from-rose-500 to-pink-500 text-white font-semibold flex items-center justify-center gap-2 hover:from-rose-400 hover:to-pink-400 disabled:opacity-50 transition-all shadow-lg shadow-rose-500/25"
                  >
                    {loading ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        Send Email
                        {attachments.length > 0 && ` (${attachments.length})`}
                      </>
                    )}
                  </button>
                </div>
              ) : (
                /* AI Compose Mode */
                <div className="space-y-4">
                  {/* AI Context Input */}
                  <div className="p-5 rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10">
                    <div className="flex items-center gap-2 mb-4">
                      <Sparkles className="w-5 h-5 text-violet-400" />
                      <span className="text-sm font-semibold text-white/80">AI Email Composer</span>
                    </div>

                    <div className="space-y-3">
                      <input
                        type="email"
                        value={emailData.to}
                        onChange={(e) => setEmailData({ ...emailData, to: e.target.value })}
                        placeholder="To: recipient@example.com"
                        className="w-full px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-violet-500/50 focus:outline-none text-sm transition-all"
                      />

                      <input
                        type="text"
                        value={aiContext.recipientName}
                        onChange={(e) => setAiContext({ ...aiContext, recipientName: e.target.value })}
                        placeholder="Recipient name (e.g., John Smith)"
                        className="w-full px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-violet-500/50 focus:outline-none text-sm transition-all"
                      />

                      <textarea
                        value={aiContext.purpose}
                        onChange={(e) => setAiContext({ ...aiContext, purpose: e.target.value })}
                        placeholder="What is this email about? (e.g., Requesting a meeting to discuss project timeline)"
                        className="w-full h-20 px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-violet-500/50 focus:outline-none resize-none text-sm transition-all"
                      />

                      {/* Tone Selector */}
                      <div className="space-y-2">
                        <label className="text-xs text-white/50 font-medium">Tone</label>
                        <div className="flex flex-wrap gap-2">
                          {[
                            { id: "professional", label: "Professional", icon: Briefcase },
                            { id: "casual", label: "Casual", icon: User },
                            { id: "formal", label: "Formal", icon: Sparkles },
                            { id: "friendly", label: "Friendly", icon: Heart },
                            { id: "urgent", label: "Urgent", icon: Clock },
                          ].map((tone) => {
                            const Icon = tone.icon;
                            const isSelected = aiContext.tone === tone.id;
                            return (
                              <button
                                key={tone.id}
                                onClick={() => setAiContext({ ...aiContext, tone: tone.id as any })}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                                  isSelected
                                    ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white border border-white/20"
                                    : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10 hover:text-white/70"
                                }`}
                              >
                                <Icon className="w-3 h-3" />
                                {tone.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <textarea
                        value={aiContext.keyPoints}
                        onChange={(e) => setAiContext({ ...aiContext, keyPoints: e.target.value })}
                        placeholder="Key points to include (optional)"
                        className="w-full h-16 px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-violet-500/50 focus:outline-none resize-none text-sm transition-all"
                      />

                      <button
                        onClick={generateAIEmail}
                        disabled={aiLoading || !aiContext.purpose}
                        className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-semibold flex items-center justify-center gap-2 hover:from-violet-400 hover:to-fuchsia-400 disabled:opacity-50 transition-all shadow-lg shadow-violet-500/25"
                      >
                        {aiLoading ? (
                          <><Loader2 className="w-4 h-4 animate-spin" /> Writing...</>
                        ) : (
                          <><Wand2 className="w-4 h-4" /> Generate Email</>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* AI Generated Preview */}
                  <AnimatePresence>
                    {aiGenerated && (
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="p-5 rounded-3xl bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 backdrop-blur-xl border border-violet-500/30"
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <Sparkles className="w-4 h-4 text-violet-400" />
                          <span className="text-sm font-semibold text-violet-200">AI Generated</span>
                          <span className="text-[10px] text-violet-300/50 ml-auto">Edit before sending</span>
                        </div>

                        <div className="space-y-3">
                          <input
                            type="text"
                            value={emailData.subject}
                            onChange={(e) => setEmailData({ ...emailData, subject: e.target.value })}
                            placeholder="Subject"
                            className="w-full px-4 py-2.5 bg-black/30 border border-violet-500/30 rounded-xl text-white placeholder-white/30 focus:border-violet-500/50 focus:outline-none text-sm transition-all"
                          />
                          <textarea
                            value={emailData.text}
                            onChange={(e) => setEmailData({ ...emailData, text: e.target.value })}
                            placeholder="Email body..."
                            className="w-full h-32 px-4 py-3 bg-black/30 border border-violet-500/30 rounded-xl text-white placeholder-white/30 focus:border-violet-500/50 focus:outline-none resize-none text-sm transition-all"
                          />
                        </div>

                        {/* File Attachments Section for AI Mode */}
                        <div className="mt-4 space-y-3">
                          <div
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                            className={`relative p-4 rounded-2xl border-2 border-dashed transition-all cursor-pointer ${
                              isDragging
                                ? "border-violet-400 bg-violet-500/10"
                                : "border-violet-500/30 bg-black/20 hover:border-violet-500/50"
                            }`}
                          >
                            <input
                              ref={fileInputRef}
                              type="file"
                              multiple
                              onChange={handleFileSelect}
                              className="hidden"
                            />
                            <div className="flex flex-col items-center gap-1.5">
                              <Upload className={`w-5 h-5 ${isDragging ? "text-violet-400" : "text-violet-400/60"}`} />
                              <p className="text-xs text-white/50 text-center">
                                {isDragging ? "Drop files here" : <>Add attachments</>}
                              </p>
                            </div>
                          </div>

                          <AnimatePresence>
                            {attachments.length > 0 && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                className="space-y-2"
                              >
                                <div className="flex items-center justify-between text-xs text-white/50">
                                  <span>{attachments.length} file{attachments.length > 1 ? 's' : ''}</span>
                                  <span>{formattedTotalSize}</span>
                                </div>
                                <div className="space-y-1.5 max-h-32 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
                                  {attachments.map((attachment) => {
                                    const FileIcon = getFileIcon(attachment.type);
                                    return (
                                      <motion.div
                                        key={attachment.id}
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: 20 }}
                                        className="flex items-center gap-2 p-2 rounded-lg bg-black/20 border border-white/10"
                                      >
                                        <FileIcon className="w-4 h-4 text-white/50" />
                                        <span className="text-xs text-white/70 truncate flex-1">{attachment.name}</span>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            removeAttachment(attachment.id);
                                          }}
                                          className="p-1 rounded hover:bg-red-500/20 text-white/40 hover:text-red-400"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      </motion.div>
                                    );
                                  })}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>

                        <button
                          onClick={handleEmailSubmit}
                          disabled={loading || !emailData.to || !emailData.subject}
                          className="mt-4 w-full py-3 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-semibold flex items-center justify-center gap-2 hover:from-violet-400 hover:to-fuchsia-400 disabled:opacity-50 transition-all shadow-lg shadow-violet-500/25"
                        >
                          {loading ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
                          ) : (
                            <><Send className="w-4 h-4" /> Send Email</>
                          )}
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {!aiGenerated && (
                    <div className="p-4 rounded-2xl bg-violet-500/5 border border-violet-500/20 backdrop-blur-sm">
                      <p className="text-xs text-violet-300/70 text-center">
                        <Sparkles className="w-3 h-3 inline mr-1" />
                        AI will write a professional email based on your context. You can edit before sending.
                      </p>
                    </div>
                  )}
                </div>
              )}

                <SetupInstructions service="email" />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Result */}
          <AnimatePresence>
            {result && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                className={`p-4 rounded-2xl flex items-center gap-3 ${
                  result.success
                    ? "bg-emerald-500/10 border border-emerald-500/30 backdrop-blur-md"
                    : "bg-red-500/10 border border-red-500/30 backdrop-blur-md"
                }`}
              >
                {result.success ? (
                  <Check className="w-5 h-5 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                )}
                <span className={result.success ? "text-emerald-100" : "text-red-100"}>
                  {result.message}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function SetupInstructions({ service }: { service: "notion" | "todoist" | "email" }) {
  const instructions = {
    notion: {
      steps: [
        "Go to notion.so/my-integrations",
        "Create new integration",
        "Copy token to NOTION_TOKEN",
        "Create database, share with integration",
        "Copy database ID to NOTION_DATABASE_ID",
      ],
      color: "text-indigo-400",
    },
    todoist: {
      steps: [
        "Go to todoist.com/app/settings/integrations",
        "Copy API token",
        "Add to TODOIST_API_TOKEN in .env.local",
      ],
      color: "text-emerald-400",
    },
    email: {
      steps: [
        "Enable 2FA on Google account",
        "Go to myaccount.google.com/apppasswords",
        "Generate App Password for 'Mail'",
        "Add EMAIL_USER and EMAIL_PASS to .env.local",
      ],
      color: "text-rose-400",
    },
  };

  const info = instructions[service];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.3 }}
      className="p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm"
    >
      <p className={`text-xs font-semibold mb-2 uppercase tracking-wider ${info.color}`}>Setup Guide</p>
      <div className="space-y-1.5">
        {info.steps.map((step, idx) => (
          <div key={idx} className="flex items-start gap-2 text-xs text-white/50">
            <span className={`font-mono ${info.color}`}>{idx + 1}.</span>
            <span>{step}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
