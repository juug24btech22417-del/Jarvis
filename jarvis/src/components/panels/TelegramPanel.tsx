"use client";

import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { motion } from "framer-motion";
import {
  Send,
  X,
  MessageCircle,
  Wifi,
  WifiOff,
  Mic,
  MicOff,
  User,
} from "lucide-react";
import {
  animatePanelOpen,
  animatePanelClose,
  animateStagger,
  animateMessageAppear,
  createRipple,
  addHoverScale,
  createShakeAnimation,
} from "@/lib/animations/gsap";

interface TelegramMessage {
  message_id: number;
  chat: { id: number; first_name?: string; username?: string };
  from?: { id: number; is_bot: boolean };
  text?: string;
  voice?: { file_id: string; duration: number };
  date: number;
  isFromMe?: boolean;
}

interface Chat {
  id: number;
  name: string;
  username?: string;
}

export default function TelegramPanel({
  onClose,
}: {
  onClose: () => void;
}) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<TelegramMessage[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState("");
  const [botInfo, setBotInfo] = useState<{ name: string; username: string } | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const chatListRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sendBtnRef = useRef<HTMLButtonElement>(null);

  // GSAP Panel entrance animation
  useLayoutEffect(() => {
    if (panelRef.current) {
      animatePanelOpen(panelRef.current, 'right');
    }
  }, []);

  // Animate chat list when it updates
  useEffect(() => {
    if (chatListRef.current && chats.length > 0) {
      const chatItems = chatListRef.current.querySelectorAll('.chat-item');
      animateStagger(chatItems, 0.05);
    }
  }, [chats]);

  // Animate messages when they update
  useEffect(() => {
    if (messagesRef.current) {
      const msgItems = messagesRef.current.querySelectorAll('.message-item');
      const lastMsg = msgItems[msgItems.length - 1];
      if (lastMsg) {
        const isFromMe = lastMsg.classList.contains('message-from-me');
        animateMessageAppear(lastMsg as HTMLElement, isFromMe);
      }
    }
  }, [messages]);

  // Add hover effects to interactive elements
  useEffect(() => {
    if (sendBtnRef.current) {
      addHoverScale(sendBtnRef.current, 1.1);
    }
  }, []);

  // Handle panel close with animation
  const handleClose = () => {
    if (panelRef.current) {
      animatePanelClose(panelRef.current, 'right', onClose);
    } else {
      onClose();
    }
  };

  // Check bot status on mount
  useEffect(() => {
    checkStatus();
    pollMessages();
    const interval = setInterval(pollMessages, 5000);
    return () => clearInterval(interval);
  }, []);

  const checkStatus = async () => {
    try {
      const res = await fetch("/api/telegram/status");
      const data = await res.json();
      if (data.success) {
        setBotInfo({ name: data.botName, username: data.botUsername });
      } else {
        setError(data.error || "Bot not connected");
      }
    } catch (err) {
      setError("Cannot connect to Telegram");
    }
  };

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, selectedChat]);

  // Initialize speech recognition
  useEffect(() => {
    if (typeof window !== "undefined" && "SpeechRecognition" in window || "webkitSpeechRecognition" in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = "en-US";

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setMessageInput((prev) => prev + (prev ? " " : "") + transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = () => {
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  const pollMessages = async () => {
    try {
      const res = await fetch("/api/telegram/poll");
      const data = await res.json();
      if (data.success) {
        setChats(data.chats);
        setMessages(data.messages);
        setError("");
      } else {
        setError(data.error || "Failed to poll");
      }
    } catch (err) {
      setError("Connection error");
    }
  };

  const handleSend = async (e?: React.MouseEvent) => {
    if (!selectedChat || !messageInput.trim()) return;

    // Add ripple effect if clicked
    if (e && sendBtnRef.current) {
      createRipple(e, sendBtnRef.current, 'rgba(0, 212, 255, 0.4)');
    }

    setSending(true);
    try {
      const res = await fetch("/api/telegram/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: selectedChat.id,
          text: messageInput.trim(),
        }),
      });

      const data = await res.json();
      if (data.success) {
        setMessageInput("");
        // Refresh messages
        pollMessages();
      } else {
        setError(data.error || "Failed to send");
        // Shake animation for error
        if (panelRef.current) {
          createShakeAnimation(panelRef.current);
        }
      }
    } catch (err) {
      setError("Send failed");
      // Shake animation for error
      if (panelRef.current) {
        createShakeAnimation(panelRef.current);
      }
    } finally {
      setSending(false);
    }
  };

  const toggleVoiceInput = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition not supported in your browser");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const getChatMessages = (chatId: number) => {
    return messages
      .filter((m) => m.chat.id === chatId)
      .sort((a, b) => a.date - b.date);
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const hasNewMessages = messages.length > 0;

  return (
    <div
      ref={panelRef}
      className="fixed right-0 top-0 h-full w-96 bg-panel-bg/95 backdrop-blur-sm border-l border-panel-border z-40 will-change-transform"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-panel-border">
        <div className="flex items-center gap-3">
          <MessageCircle className="w-6 h-6" style={{ color: "#0088cc" }} />
          <div>
            <h2 className="font-orbitron font-bold" style={{ color: "#0088cc" }}>
              TELEGRAM
            </h2>
            <div className="flex items-center gap-2">
              {botInfo ? (
                <>
                  <Wifi className="w-3 h-3 text-green-500" />
                  <span className="text-xs text-text-secondary font-rajdhani">
                    @{botInfo.username}
                  </span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3 h-3 text-accent-red" />
                  <span className="text-xs text-accent-red font-rajdhani">
                    {error || "Not connected"}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={handleClose}
          className="p-2 hover:bg-accent-red/20 rounded transition-colors"
        >
          <X className="w-4 h-4 text-accent-red" />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-accent-red/20 text-accent-red text-sm font-rajdhani">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex h-[calc(100%-140px)]">
        {/* Chat List */}
        <div ref={chatListRef} className="w-1/3 border-r border-panel-border overflow-y-auto">
          {chats.length === 0 ? (
            <div className="p-4 text-text-secondary text-xs font-rajdhani text-center space-y-3">
              <div className="w-12 h-12 mx-auto rounded-full bg-cyan-500/20 flex items-center justify-center">
                <MessageCircle className="w-6 h-6 text-cyan-500" />
              </div>
              {error ? (
                <>
                  <p className="font-bold text-accent-red">Setup Required</p>
                  <p className="text-text-secondary">
                    {error.includes("not configured")
                      ? "Add your TELEGRAM_BOT_TOKEN to .env.local and restart JARVIS"
                      : error}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-bold text-cyan-500">No conversations yet</p>
                  <p className="text-text-secondary">
                    1. Open Telegram app on your phone<br/>
                    2. Find your bot: {botInfo ? `@${botInfo.username}` : "(loading...)"}<br/>
                    3. Send any message to it
                  </p>
                  <p className="text-[10px] opacity-60 border-t border-panel-border pt-2 mt-2">
                    Note: Telegram bots can only see messages sent TO them,
                    not your existing chats
                  </p>
                </>
              )}
              <button
                onClick={() => { checkStatus(); pollMessages(); }}
                className="px-3 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 rounded text-cyan-500 text-xs transition-colors"
              >
                {error ? "Retry Connection" : "Check for Messages"}
              </button>
            </div>
          ) : (
            <div className="space-y-1 p-2">
              {chats.map((chat) => {
                const chatMessages = getChatMessages(chat.id);
                const lastMessage = chatMessages[chatMessages.length - 1];
                const isSelected = selectedChat?.id === chat.id;

                return (
                  <button
                    key={chat.id}
                    onClick={() => setSelectedChat(chat)}
                    className={`chat-item w-full p-2 rounded text-left transition-colors ${
                      isSelected
                        ? "bg-cyan-500/20 border border-cyan-500"
                        : "hover:bg-panel-glass/30"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-cyan-500/30 flex items-center justify-center">
                        <User className="w-4 h-4 text-cyan-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-rajdhani font-bold text-text-primary text-xs truncate">
                          {chat.name}
                        </p>
                        <p className="text-[10px] text-text-secondary truncate">
                          {lastMessage?.text || "No messages"}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Messages */}
        <div ref={messagesRef} className="flex-1 flex flex-col">
          {!selectedChat ? (
            <div className="flex-1 flex items-center justify-center text-text-secondary font-rajdhani text-sm">
              Select a chat to view messages
            </div>
          ) : (
            <>
              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {getChatMessages(selectedChat.id).map((msg) => (
                  <div
                    key={msg.message_id}
                    className={`message-item flex ${
                      msg.isFromMe || msg.from?.is_bot ? "justify-end message-from-me" : "justify-start"
                    } ${msg.text ? "" : "opacity-50"}`}
                  >
                    <div
                      className={`max-w-[80%] p-3 rounded-lg ${
                        msg.isFromMe || msg.from?.is_bot
                          ? "bg-cyan-500/20 ml-auto"
                          : "bg-panel-glass/50"
                      }`}
                    >
                      {msg.voice && (
                        <div className="flex items-center gap-2 text-cyan-500 text-xs mb-1">
                          <Mic className="w-3 h-3" />
                          <span>Voice message ({msg.voice.duration}s)</span>
                        </div>
                      )}
                      <p className="text-sm font-rajdhani text-text-primary">
                        {msg.text || "[Voice message]"}
                      </p>
                      <p className="text-[10px] text-text-secondary mt-1">
                        {formatTime(msg.date)}
                        {msg.isFromMe && " • Sent"}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <div className="p-4 border-t border-panel-border">
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleVoiceInput}
                    className={`p-2 rounded-lg transition-colors ${
                      isListening
                        ? "bg-accent-red/20 text-accent-red animate-pulse"
                        : "bg-panel-glass/50 hover:bg-panel-glass/80 text-text-secondary"
                    }`}
                    title={isListening ? "Stop listening" : "Voice to text"}
                  >
                    {isListening ? (
                      <MicOff className="w-5 h-5" />
                    ) : (
                      <Mic className="w-5 h-5" />
                    )}
                  </button>
                  <input
                    type="text"
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && handleSend()}
                    placeholder="Type a message..."
                    className="flex-1 bg-panel-glass/50 border border-panel-border rounded-lg px-4 py-2 text-text-primary font-rajdhani focus:outline-none focus:border-cyan-500"
                  />
                  <button
                    ref={sendBtnRef}
                    onClick={(e) => handleSend(e)}
                    disabled={sending || !messageInput.trim()}
                    className="p-2 bg-cyan-500/20 hover:bg-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors relative overflow-hidden"
                  >
                    <Send className="w-5 h-5" style={{ color: "#0088cc" }} />
                  </button>
                </div>
                {isListening && (
                  <p className="text-xs text-accent-red mt-2 font-rajdhani animate-pulse">
                    Listening...
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
