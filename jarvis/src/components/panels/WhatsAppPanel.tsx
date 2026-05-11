"use client";

import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, X, Wifi, WifiOff, RefreshCw, LogOut, Send, Phone } from "lucide-react";
import {
  animatePanelOpen,
  animatePanelClose,
  animateStagger,
  addHoverScale,
  createRipple,
  createPulseAnimation,
  createShakeAnimation,
} from "@/lib/animations/gsap";

interface WhatsAppStatus {
  connected: boolean;
  ready: boolean;
  qrCode: string | null;
  initializing: boolean;
  authenticated?: boolean;
}

interface Chat {
  id: string;
  name: string;
  unreadCount: number;
  timestamp: number;
  lastMessage: string;
  isGroup: boolean;
}

export default function WhatsAppPanel({
  onClose,
  onSendMessage,
}: {
  onClose: () => void;
  onSendMessage?: (number: string, message: string) => void;
}) {
  const [status, setStatus] = useState<WhatsAppStatus>({
    connected: false,
    ready: false,
    qrCode: null,
    initializing: false,
  });
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const qrRef = useRef<HTMLImageElement>(null);
  const chatListRef = useRef<HTMLDivElement>(null);
  const sendBtnRef = useRef<HTMLButtonElement>(null);
  const statusIndicatorRef = useRef<HTMLDivElement>(null);

  // GSAP Panel entrance animation
  useLayoutEffect(() => {
    if (panelRef.current) {
      animatePanelOpen(panelRef.current, 'right');
    }
  }, []);

  // Animate chat list when loaded
  useEffect(() => {
    if (chatListRef.current && chats.length > 0) {
      const chatItems = chatListRef.current.querySelectorAll('.chat-item');
      animateStagger(chatItems, 0.05);
    }
  }, [chats]);

  // Pulse animation for QR code
  useEffect(() => {
    if (qrRef.current && status.qrCode) {
      createPulseAnimation(qrRef.current, '#22c55e');
    }
  }, [status.qrCode]);

  // Add hover effects to interactive elements
  useEffect(() => {
    if (sendBtnRef.current) {
      addHoverScale(sendBtnRef.current, 1.1);
    }
  }, []);

  // Handle panel close with GSAP
  const handleClose = () => {
    if (panelRef.current) {
      animatePanelClose(panelRef.current, 'right', onClose);
    } else {
      onClose();
    }
  };

  // Initialize WhatsApp on mount (only once)
  const [hasInitialized, setHasInitialized] = useState(false);
  useEffect(() => {
    if (!hasInitialized) {
      setHasInitialized(true);
      initializeWhatsApp();
    }
  }, [hasInitialized]);

  // Poll status every 2 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      checkStatus();
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const initializeWhatsApp = async () => {
    try {
      setStatus((prev) => ({ ...prev, initializing: true }));
      setInitError(null);
      const res = await fetch("/api/whatsapp/init", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setStatus(data);
      } else {
        setInitError(data.error || "Failed to initialize");
        if (panelRef.current) {
          createShakeAnimation(panelRef.current);
        }
      }
    } catch (error) {
      setInitError("Connection failed");
      if (panelRef.current) {
        createShakeAnimation(panelRef.current);
      }
    } finally {
      setLoading(false);
    }
  };

  const checkStatus = async () => {
    try {
      const res = await fetch("/api/whatsapp/status");
      const data = await res.json();
      setStatus(data);
      if (data.ready && chats.length === 0) {
        fetchChats();
      }
    } catch (error) {
      console.error("[WhatsApp] Status check failed:", error);
    }
  };

  const fetchChats = async () => {
    try {
      const res = await fetch("/api/whatsapp/chats");
      const data = await res.json();
      if (data.success) {
        setChats(data.chats);
      }
    } catch (error) {
      console.error("[WhatsApp] Fetch chats failed:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/whatsapp/logout", { method: "POST" });
      setStatus({
        connected: false,
        ready: false,
        qrCode: null,
        initializing: false,
      });
      setChats([]);
      setSelectedChat(null);
    } catch (error) {
      console.error("[WhatsApp] Logout failed:", error);
      if (panelRef.current) {
        createShakeAnimation(panelRef.current);
      }
    }
  };

  const handleSendMessage = async (e?: React.MouseEvent) => {
    if (!selectedChat || !messageInput.trim()) return;

    // Add ripple effect
    if (e && sendBtnRef.current) {
      createRipple(e, sendBtnRef.current, 'rgba(34, 197, 94, 0.4)');
    }

    setSending(true);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          number: selectedChat.id,
          message: messageInput.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessageInput("");
        onSendMessage?.(selectedChat.name, messageInput.trim());
        fetchChats();
      } else {
        if (panelRef.current) {
          createShakeAnimation(panelRef.current);
        }
      }
    } catch (error) {
      console.error("[WhatsApp] Send failed:", error);
      if (panelRef.current) {
        createShakeAnimation(panelRef.current);
      }
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
    <div
      ref={panelRef}
      className="fixed right-0 top-0 h-full w-96 bg-panel-bg/95 backdrop-blur-sm border-l border-panel-border z-40 will-change-transform"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-panel-border">
        <div className="flex items-center gap-3">
          <MessageSquare className="w-6 h-6 text-green-500" />
          <div>
            <h2 className="font-orbitron text-green-500 font-bold">WHATSAPP</h2>
            <div className="flex items-center gap-2">
              {status.ready ? (
                <>
                  <Wifi className="w-3 h-3 text-green-500" />
                  <span className="text-xs text-text-secondary font-rajdhani">Connected</span>
                </>
              ) : status.initializing ? (
                <>
                  <RefreshCw className="w-3 h-3 text-yellow-500 animate-spin" />
                  <span className="text-xs text-yellow-500 font-rajdhani">Initializing...</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3 h-3 text-accent-red" />
                  <span className="text-xs text-accent-red font-rajdhani">Disconnected</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {status.ready && (
            <button
              onClick={handleLogout}
              className="p-2 hover:bg-accent-red/20 rounded transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4 text-accent-red" />
            </button>
          )}
          <button
            onClick={handleClose}
            className="p-2 hover:bg-accent-red/20 rounded transition-colors"
          >
            <X className="w-4 h-4 text-accent-red" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto h-[calc(100%-140px)] p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw className="w-8 h-8 text-green-500 animate-spin" />
          </div>
        ) : initError ? (
          <div className="flex flex-col items-center justify-center h-full space-y-4">
            <p className="text-accent-red font-rajdhani">{initError}</p>
            <button
              onClick={initializeWhatsApp}
              className="px-4 py-2 bg-green-500/20 hover:bg-green-500/30 text-green-500 rounded-lg font-rajdhani transition-colors"
            >
              Retry
            </button>
          </div>
        ) : status.qrCode ? (
          <div className="flex flex-col items-center justify-center h-full space-y-4">
            <div className="text-center space-y-2">
              <p className="font-orbitron text-green-500">Scan QR Code</p>
              <p className="text-xs text-text-secondary font-rajdhani">
                Open WhatsApp on your phone & scan
              </p>
            </div>
            <img
              ref={qrRef}
              src={status.qrCode}
              alt="WhatsApp QR Code"
              className="w-48 h-48 rounded-lg border-2 border-green-500/30"
            />
            <p className="text-xs text-text-secondary font-rajdhani animate-pulse">
              Waiting for scan...
            </p>
          </div>
        ) : status.authenticated && !status.ready ? (
          <div className="flex flex-col items-center justify-center h-full space-y-4">
            <RefreshCw className="w-8 h-8 text-yellow-500 animate-spin" />
            <p className="font-rajdhani text-yellow-500">Syncing chats...</p>
          </div>
        ) : !status.ready ? (
          <div className="flex flex-col items-center justify-center h-full space-y-4">
            <button
              onClick={initializeWhatsApp}
              className="px-6 py-3 bg-green-500/20 hover:bg-green-500/30 text-green-500 rounded-lg font-rajdhani transition-colors"
            >
              Initialize WhatsApp
            </button>
          </div>
        ) : chats.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-secondary font-rajdhani">
            <MessageSquare className="w-16 h-16 mb-4 opacity-20" />
            <p>No conversations yet</p>
          </div>
        ) : selectedChat ? (
          <div className="h-full flex flex-col">
            {/* Chat Header */}
            <div className="flex items-center justify-between p-3 border-b border-panel-border mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                  <Phone className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <p className="font-rajdhani font-bold text-text-primary">{selectedChat.name}</p>
                  <p className="text-xs text-text-secondary">{selectedChat.id}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedChat(null)}
                className="text-xs text-text-secondary hover:text-text-primary"
              >
                Back
              </button>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto space-y-2 mb-4">
              <div className="bg-panel-glass/30 p-3 rounded-lg">
                <p className="text-sm text-text-secondary font-rajdhani">{selectedChat.lastMessage}</p>
                <p className="text-xs text-text-secondary mt-1">
                  {formatTime(selectedChat.timestamp)}
                </p>
              </div>
            </div>

            {/* Message Input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
                placeholder="Type a message..."
                className="flex-1 bg-panel-glass/50 border border-panel-border rounded-lg px-4 py-2 text-text-primary font-rajdhani focus:outline-none focus:border-green-500"
              />
              <button
                ref={sendBtnRef}
                onClick={(e) => handleSendMessage(e)}
                disabled={sending || !messageInput.trim()}
                className="p-2 bg-green-500/20 hover:bg-green-500/30 disabled:opacity-50 rounded-lg transition-colors relative overflow-hidden"
              >
                <Send className="w-5 h-5 text-green-500" />
              </button>
            </div>
          </div>
        ) : (
          <div ref={chatListRef} className="space-y-2">
            {chats.map((chat) => (
              <button
                key={chat.id}
                onClick={() => setSelectedChat(chat)}
                className="chat-item w-full p-3 rounded-lg border border-panel-border hover:border-green-500/50 hover:bg-panel-glass/50 transition-all text-left"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                      <Phone className="w-5 h-5 text-green-500" />
                    </div>
                    <div>
                      <p className="font-rajdhani font-bold text-text-primary">{chat.name}</p>
                      <p className="text-xs text-text-secondary truncate max-w-[150px]">
                        {chat.lastMessage}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-text-secondary">{formatTime(chat.timestamp)}</p>
                    {chat.unreadCount > 0 && (
                      <span className="inline-block mt-1 px-2 py-0.5 bg-green-500 text-deep-space text-xs rounded-full">
                        {chat.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
