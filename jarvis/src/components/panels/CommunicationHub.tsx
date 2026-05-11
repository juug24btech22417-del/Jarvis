"use client";

import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, X, Wifi, WifiOff, Send, Users, Phone, Camera, MessageCircle } from "lucide-react";
import { animateStagger, animatePanelOpen, animatePanelClose, addHoverScale, createRipple } from "@/lib/animations/gsap";

type Platform = "whatsapp" | "instagram" | "telegram" | "all";

interface TelegramMessage {
  message_id: number;
  chat: { id: number; first_name?: string; username?: string };
  text?: string;
  voice?: { file_id: string; duration: number };
  date: number;
}

interface Conversation {
  id: string;
  platform: "whatsapp" | "instagram" | "telegram";
  name: string;
  lastMessage: string;
  timestamp: number;
  unreadCount: number;
  isGroup: boolean;
  avatar?: string;
}

export default function CommunicationHub({
  onClose,
  onSendMessage,
}: {
  onClose: () => void;
  onSendMessage?: (platform: string, name: string, message: string) => void;
}) {
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>("all");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  const panelRef = useRef<HTMLDivElement>(null);
  const convListRef = useRef<HTMLDivElement>(null);
  const sendBtnRef = useRef<HTMLButtonElement>(null);

  // Platform connection status
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [instagramConnected, setInstagramConnected] = useState(false);
  const [telegramConnected, setTelegramConnected] = useState(false);

  // GSAP entrance animation
  useLayoutEffect(() => {
    if (panelRef.current) {
      animatePanelOpen(panelRef.current, 'top');
    }
  }, []);

  // Stagger animate conversations
  useEffect(() => {
    if (convListRef.current && conversations.length > 0) {
      const items = convListRef.current.querySelectorAll('.conversation-item');
      animateStagger(items, 0.05);
    }
  }, [conversations]);

  // Add hover effects
  useEffect(() => {
    if (sendBtnRef.current) {
      addHoverScale(sendBtnRef.current, 1.1);
    }
  }, []);

  // Handle close with animation
  const handleClose = () => {
    if (panelRef.current) {
      animatePanelClose(panelRef.current, 'top', onClose);
    } else {
      onClose();
    }
  };

  // Fetch conversations from all platforms
  useEffect(() => {
    fetchConversations();
    const interval = setInterval(fetchConversations, 10000); // Poll every 10 seconds
    return () => clearInterval(interval);
  }, [selectedPlatform]);

  const fetchConversations = async () => {
    setLoading(true);
    const allConversations: Conversation[] = [];

    // Fetch WhatsApp
    if (selectedPlatform === "all" || selectedPlatform === "whatsapp") {
      try {
        const res = await fetch("/api/whatsapp/status");
        const status = await res.json();
        setWhatsappConnected(status.ready);

        if (status.ready) {
          const chatsRes = await fetch("/api/whatsapp/chats");
          const chatsData = await chatsRes.json();
          if (chatsData.success) {
            const whatsappConvs: Conversation[] = chatsData.chats.map((chat: any) => ({
              id: `wa-${chat.id}`,
              platform: "whatsapp" as const,
              name: chat.name,
              lastMessage: chat.lastMessage,
              timestamp: chat.timestamp,
              unreadCount: chat.unreadCount,
              isGroup: chat.isGroup,
            }));
            allConversations.push(...whatsappConvs);
          }
        }
      } catch (error) {
        console.error("[CommHub] WhatsApp fetch failed:", error);
      }
    }

    // Fetch Instagram
    if (selectedPlatform === "all" || selectedPlatform === "instagram") {
      try {
        const res = await fetch("/api/instagram/status");
        const status = await res.json();
        setInstagramConnected(status.loggedIn);

        if (status.loggedIn) {
          const threadsRes = await fetch("/api/instagram/threads");
          const threadsData = await threadsRes.json();
          if (threadsData.success) {
            const instagramConvs: Conversation[] = threadsData.threads.map((thread: any) => ({
              id: `ig-${thread.id}`,
              platform: "instagram" as const,
              name: thread.title,
              lastMessage: thread.lastMessage,
              timestamp: thread.timestamp,
              unreadCount: thread.unreadCount,
              isGroup: thread.isGroup,
            }));
            allConversations.push(...instagramConvs);
          }
        }
      } catch (error) {
        console.error("[CommHub] Instagram fetch failed:", error);
      }
    }

    // Fetch Telegram
    if (selectedPlatform === "all" || selectedPlatform === "telegram") {
      try {
        const res = await fetch("/api/telegram/poll");
        const data = await res.json();
        setTelegramConnected(data.success && data.chats.length > 0);

        if (data.success && data.messages) {
          // Group messages by chat
          const chatMessages = new Map<number, TelegramMessage>();
          data.messages.forEach((msg: TelegramMessage) => {
            if (!chatMessages.has(msg.chat.id) || chatMessages.get(msg.chat.id)!.date < msg.date) {
              chatMessages.set(msg.chat.id, msg);
            }
          });

          const telegramConvs: Conversation[] = data.chats.map((chat: any) => {
            const lastMsg = chatMessages.get(chat.id);
            return {
              id: `tg-${chat.id}`,
              platform: "telegram" as const,
              name: chat.name,
              lastMessage: lastMsg?.text || "",
              timestamp: lastMsg?.date || 0,
              unreadCount: 0,
              isGroup: false,
            };
          });
          allConversations.push(...telegramConvs);
        }
      } catch (error) {
        console.error("[CommHub] Telegram fetch failed:", error);
      }
    }

    // Sort by timestamp
    allConversations.sort((a, b) => b.timestamp - a.timestamp);
    setConversations(allConversations);
    setLoading(false);
  };

  const handleSendMessage = async () => {
    if (!selectedConversation || !messageInput.trim()) return;

    setSending(true);
    try {
      const [platform, recipientId] = selectedConversation.id.split("-");
      const number = recipientId.split("@")[0];

      if (platform === "wa") {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            number,
            message: messageInput.trim(),
          }),
        });
        const data = await res.json();
        if (data.success) {
          onSendMessage?.("WhatsApp", selectedConversation.name, messageInput.trim());
        }
      } else if (platform === "ig") {
        const res = await fetch("/api/instagram/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: selectedConversation.name,
            message: messageInput.trim(),
          }),
        });
        const data = await res.json();
        if (data.success) {
          onSendMessage?.("Instagram", selectedConversation.name, messageInput.trim());
        }
      } else if (platform === "tg") {
        const chatId = parseInt(recipientId);
        const res = await fetch("/api/telegram/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId,
            text: messageInput.trim(),
          }),
        });
        const data = await res.json();
        if (data.success) {
          onSendMessage?.("Telegram", selectedConversation.name, messageInput.trim());
        }
      }

      setMessageInput("");
      fetchConversations();
    } catch (error) {
      console.error("[CommHub] Send failed:", error);
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

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case "whatsapp":
        return <Phone className="w-5 h-5 text-green-500" />;
      case "instagram":
        return <Camera className="w-5 h-5 text-pink-500" />;
      case "telegram":
        return <MessageCircle className="w-5 h-5 text-cyan-500" />;
      default:
        return <MessageSquare className="w-5 h-5" />;
    }
  };

  const getPlatformColor = (platform: string) => {
    switch (platform) {
      case "whatsapp":
        return "border-green-500/50 hover:bg-green-500/10";
      case "instagram":
        return "border-pink-500/50 hover:bg-pink-500/10";
      case "telegram":
        return "border-cyan-500/50 hover:bg-cyan-500/10";
      default:
        return "border-panel-border hover:bg-panel-glass/50";
    }
  };

  return (
    <div
      ref={panelRef}
      className="fixed top-24 left-1/2 -translate-x-1/2 w-[600px] max-h-[70vh] bg-panel-bg/95 backdrop-blur-sm border border-panel-border rounded-xl z-50 shadow-2xl will-change-transform"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-panel-border">
        <div className="flex items-center gap-3">
          <MessageSquare className="w-6 h-6 text-reactor-core" />
          <div>
            <h2 className="font-orbitron text-reactor-core font-bold">COMMUNICATION HUB</h2>
            <div className="flex items-center gap-3 text-xs font-rajdhani">
              <span className="flex items-center gap-1">
                <Wifi className={`w-3 h-3 ${whatsappConnected ? "text-green-500" : "text-gray-500"}`} />
                WhatsApp
              </span>
              <span className="flex items-center gap-1">
                <Wifi className={`w-3 h-3 ${instagramConnected ? "text-green-500" : "text-gray-500"}`} />
                Instagram
              </span>
              <span className="flex items-center gap-1">
                <Wifi className={`w-3 h-3 ${telegramConnected ? "text-green-500" : "text-gray-500"}`} />
                Telegram
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleClose}
            className="p-2 hover:bg-accent-red/20 rounded transition-colors"
          >
            <X className="w-4 h-4 text-accent-red" />
          </button>
        </div>
      </div>

      {/* Platform Filter */}
      <div className="flex gap-2 p-4 border-b border-panel-border/50">
        <button
          onClick={() => setSelectedPlatform("all")}
          className={`px-4 py-2 rounded-lg font-rajdhani text-sm transition-colors ${
            selectedPlatform === "all"
              ? "bg-reactor-core/30 text-reactor-core border border-reactor-core"
              : "bg-panel-glass/30 text-text-secondary hover:bg-panel-glass/50"
          }`}
        >
          All
        </button>
        <button
          onClick={() => setSelectedPlatform("whatsapp")}
          className={`px-4 py-2 rounded-lg font-rajdhani text-sm transition-colors flex items-center gap-2 ${
            selectedPlatform === "whatsapp"
              ? "bg-green-500/30 text-green-400 border border-green-500"
              : "bg-panel-glass/30 text-text-secondary hover:bg-panel-glass/50"
          }`}
        >
          <Phone className="w-4 h-4" />
          WhatsApp
        </button>
        <button
          onClick={() => setSelectedPlatform("instagram")}
          className={`px-4 py-2 rounded-lg font-rajdhani text-sm transition-colors flex items-center gap-2 ${
            selectedPlatform === "instagram"
              ? "bg-pink-500/30 text-pink-400 border border-pink-500"
              : "bg-panel-glass/30 text-text-secondary hover:bg-panel-glass/50"
          }`}
        >
          <Camera className="w-4 h-4" />
          Instagram
        </button>
        <button
          onClick={() => setSelectedPlatform("telegram")}
          className={`px-4 py-2 rounded-lg font-rajdhani text-sm transition-colors flex items-center gap-2 ${
            selectedPlatform === "telegram"
              ? "bg-cyan-500/30 text-cyan-400 border border-cyan-500"
              : "bg-panel-glass/30 text-text-secondary hover:bg-panel-glass/50"
          }`}
        >
          <MessageCircle className="w-4 h-4" />
          Telegram
        </button>
      </div>

      {/* Content */}
      <div className="flex h-[400px]">
        {/* Conversations List */}
        <div ref={convListRef} className="w-1/2 border-r border-panel-border overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full text-text-secondary font-rajdhani">
              Loading...
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex items-center justify-center h-full text-text-secondary font-rajdhani">
              No conversations
            </div>
          ) : (
            <div className="divide-y divide-panel-border/30">
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => setSelectedConversation(conv)}
                  className={`conversation-item w-full p-3 text-left transition-colors ${
                    selectedConversation?.id === conv.id
                      ? "bg-reactor-core/20"
                      : getPlatformColor(conv.platform)
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-panel-glass/50 flex items-center justify-center">
                      {getPlatformIcon(conv.platform)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="font-rajdhani font-bold text-text-primary truncate text-sm">
                          {conv.name}
                        </p>
                        <span className="text-xs text-text-secondary">
                          {formatTime(conv.timestamp)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-text-secondary truncate">
                          {conv.lastMessage || "No messages"}
                        </p>
                        {conv.unreadCount > 0 && (
                          <span className="ml-2 px-1.5 py-0.5 bg-reactor-core text-deep-space text-xs rounded-full">
                            {conv.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Message Area */}
        <div className="w-1/2 flex flex-col">
          {selectedConversation ? (
            <>
              {/* Chat Header */}
              <div className="p-3 border-b border-panel-border flex items-center gap-2">
                {getPlatformIcon(selectedConversation.platform)}
                <span className="font-rajdhani font-bold text-text-primary">
                  {selectedConversation.name}
                </span>
                {selectedConversation.isGroup && (
                  <span className="text-xs text-text-secondary">(Group)</span>
                )}
              </div>

              {/* Empty State / Messages */}
              <div className="flex-1 flex items-center justify-center text-text-secondary font-rajdhani text-sm">
                <div className="text-center p-4">
                  <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-20" />
                  <p>Conversation loaded here</p>
                  <p className="text-xs mt-2">Message history coming soon</p>
                </div>
              </div>

              {/* Message Input */}
              <div className="p-3 border-t border-panel-border">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
                    placeholder="Type a message..."
                    className="flex-1 bg-panel-glass/50 border border-panel-border rounded-lg px-3 py-2 text-text-primary font-rajdhani text-sm focus:outline-none focus:border-reactor-core"
                  />
                  <button
                    ref={sendBtnRef}
                    onClick={(e) => {
                      createRipple(e, sendBtnRef.current!, 'rgba(0, 212, 255, 0.4)');
                      handleSendMessage();
                    }}
                    disabled={sending || !messageInput.trim()}
                    className="p-2 bg-reactor-core/20 hover:bg-reactor-core/30 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors relative overflow-hidden"
                  >
                    <Send className="w-4 h-4 text-reactor-core" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-text-secondary font-rajdhani text-sm">
              <div className="text-center">
                <Users className="w-12 h-12 mx-auto mb-2 opacity-20" />
                <p>Select a conversation</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
