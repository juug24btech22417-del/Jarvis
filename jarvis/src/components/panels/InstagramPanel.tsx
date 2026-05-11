"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, X, Wifi, WifiOff, LogOut, Send, User } from "lucide-react";

interface InstagramStatus {
  loggedIn: boolean;
  username: string | null;
  unreadCount: number;
}

interface Thread {
  id: string;
  title: string;
  participants: Array<{ username: string; fullName: string }>;
  lastMessage?: string;
  timestamp: number;
  unreadCount: number;
  isGroup: boolean;
}

export default function InstagramPanel({
  onClose,
  onSendMessage,
}: {
  onClose: () => void;
  onSendMessage?: (name: string, message: string) => void;
}) {
  const [status, setStatus] = useState<InstagramStatus>({
    loggedIn: false,
    username: null,
    unreadCount: 0,
  });
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  // Login form state
  const [showLogin, setShowLogin] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  // Check status on mount
  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    try {
      const res = await fetch("/api/instagram/status");
      const data = await res.json();
      if (data.success) {
        setStatus({
          loggedIn: data.loggedIn,
          username: data.username,
          unreadCount: data.unreadCount,
        });

        if (data.loggedIn) {
          fetchThreads();
        }
      }
    } catch (error) {
      console.error("[Instagram] Status check failed:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchThreads = async () => {
    try {
      const res = await fetch("/api/instagram/threads");
      const data = await res.json();
      if (data.success) {
        setThreads(data.threads);
      }
    } catch (error) {
      console.error("[Instagram] Fetch threads failed:", error);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setLoading(true);

    try {
      const res = await fetch("/api/instagram/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();

      if (data.success) {
        setShowLogin(false);
        setStatus({
          loggedIn: true,
          username: data.username || username,
          unreadCount: 0,
        });
        fetchThreads();
      } else {
        setLoginError(data.error || "Login failed");
      }
    } catch (error) {
      setLoginError("Login failed. Please check your credentials.");
      console.error("[Instagram] Login error:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/instagram/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus({ loggedIn: false, username: null, unreadCount: 0 });
        setThreads([]);
        setSelectedThread(null);
      }
    } catch (error) {
      console.error("[Instagram] Logout failed:", error);
    }
  };

  const handleSendMessage = async () => {
    if (!selectedThread || !messageInput.trim()) return;

    setSending(true);
    try {
      const recipient = selectedThread.participants[0]?.username || selectedThread.title;
      const res = await fetch("/api/instagram/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient,
          message: messageInput.trim(),
        }),
      });
      const data = await res.json();

      if (data.success) {
        setMessageInput("");
        onSendMessage?.(recipient, messageInput.trim());
        fetchThreads();
      } else {
        alert("Failed to send: " + data.error);
      }
    } catch (error) {
      console.error("[Instagram] Send failed:", error);
      alert("Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));

    if (hours < 24) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else if (hours < 48) {
      return "Yesterday";
    } else {
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 400 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 400 }}
      className="fixed right-0 top-0 h-full w-96 bg-panel-bg/95 backdrop-blur-sm border-l border-panel-border z-40"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-panel-border">
        <div className="flex items-center gap-3">
          <MessageCircle className="w-6 h-6 text-gradient-to-r from-purple-500 to-pink-500" style={{ color: '#e4405f' }} />
          <div>
            <h2 className="font-orbitron text-pink-500 font-bold">INSTAGRAM</h2>
            <div className="flex items-center gap-2">
              {status.loggedIn ? (
                <Wifi className="w-3 h-3 text-green-500" />
              ) : (
                <WifiOff className="w-3 h-3 text-accent-red" />
              )}
              <span className="text-xs text-text-secondary font-rajdhani">
                {status.loggedIn ? `@${status.username}` : "Not logged in"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {status.loggedIn && (
            <button
              onClick={handleLogout}
              className="p-2 hover:bg-accent-red/20 rounded transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4 text-accent-red" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-2 hover:bg-accent-red/20 rounded transition-colors"
          >
            <X className="w-4 h-4 text-accent-red" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto h-[calc(100%-140px)] p-4">
        {!status.loggedIn ? (
          // Login Form
          <div className="flex flex-col items-center justify-center h-full space-y-4">
            <div className="w-full max-w-xs space-y-4">
              <h3 className="text-center font-rajdhani text-xl text-text-primary">
                Login to Instagram
              </h3>
              <form onSubmit={handleLogin} className="space-y-4">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username"
                  className="w-full bg-panel-glass/50 border border-panel-border rounded-lg px-4 py-2 text-text-primary font-rajdhani focus:outline-none focus:border-pink-500"
                  required
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="w-full bg-panel-glass/50 border border-panel-border rounded-lg px-4 py-2 text-text-primary font-rajdhani focus:outline-none focus:border-pink-500"
                  required
                />
                {loginError && (
                  <p className="text-accent-red text-sm font-rajdhani">{loginError}</p>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2 bg-pink-500/20 hover:bg-pink-500/30 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors font-rajdhani text-pink-500"
                >
                  {loading ? "Logging in..." : "Login"}
                </button>
              </form>
              <p className="text-xs text-text-secondary text-center font-rajdhani">
                Note: Use at your own risk. This uses an unofficial API.
              </p>
            </div>
          </div>
        ) : threads.length === 0 ? (
          // No threads
          <div className="flex flex-col items-center justify-center h-full text-text-secondary font-rajdhani">
            <MessageCircle className="w-16 h-16 mb-4 opacity-20" />
            <p>No conversations yet</p>
          </div>
        ) : (
          // Thread List
          <div className="space-y-2">
            {threads.map((thread) => (
              <button
                key={thread.id}
                onClick={() => setSelectedThread(thread)}
                className={`w-full p-3 rounded-lg border transition-colors text-left ${
                  selectedThread?.id === thread.id
                    ? "bg-pink-500/20 border-pink-500"
                    : "bg-panel-glass/30 border-panel-border hover:bg-panel-glass/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-pink-500/30 flex items-center justify-center">
                      <User className="w-5 h-5 text-pink-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-rajdhani font-bold text-text-primary truncate">
                        {thread.title}
                        {thread.isGroup && (
                          <span className="ml-2 text-xs text-text-secondary">(Group)</span>
                        )}
                      </p>
                      <p className="text-xs text-text-secondary truncate">
                        {thread.lastMessage || "No messages"}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-text-secondary">
                      {formatTime(thread.timestamp)}
                    </p>
                    {thread.unreadCount > 0 && (
                      <span className="inline-block mt-1 px-2 py-0.5 bg-pink-500 text-deep-space text-xs rounded-full">
                        {thread.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Message Input (when thread selected) */}
      {selectedThread && status.loggedIn && (
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-panel-border bg-panel-bg">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
              placeholder={`Message ${selectedThread.title}...`}
              className="flex-1 bg-panel-glass/50 border border-panel-border rounded-lg px-4 py-2 text-text-primary font-rajdhani focus:outline-none focus:border-pink-500"
            />
            <button
              onClick={handleSendMessage}
              disabled={sending || !messageInput.trim()}
              className="p-2 bg-pink-500/20 hover:bg-pink-500/30 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              <Send className="w-5 h-5 text-pink-500" />
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
