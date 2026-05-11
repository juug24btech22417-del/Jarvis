"use client";

import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Send, Square, VolumeX, Camera, Monitor } from "lucide-react";
import VoiceVisualizer from "@/components/ui/VoiceVisualizer";
import { useJarvisVoice } from "@/hooks/useVoice";
import { useJarvisStore } from "@/store/jarvis.store";
import { buildSystemPrompt, buildMorningBriefing, JARVISContext } from "@/lib/jarvis/personality";
import { useVolumeControl, useClipboard, useBatteryStatus, useNetworkStatus } from "@/lib/system";
import { addHoverScale, createRipple, animateTyping } from "@/lib/animations/gsap";

interface CommandBarProps {
  onCalculate?: (expression: string, result: string) => void;
  onOpenWhatsapp?: () => void;
  onOpenInstagram?: () => void;
  onOpenTelegram?: () => void;
  onOpenCommHub?: () => void;
  onOpenSecurity?: () => void;
  onOpenVault?: () => void;
  onOpenDungeon?: () => void;
  onOpenHabits?: () => void;
  onOpenTimeCapsule?: () => void;
  onOpenVoiceNotes?: () => void;
  onOpenWeather?: () => void;
  onOpenSpotify?: () => void;
  onOpenNews?: () => void;
  onOpenCalendar?: () => void;
  // New Tier 2 Features
  onOpenSkillTrainer?: () => void;
  onOpenImageGenerator?: () => void;
  onOpenSummarizer?: () => void;
  onOpenWebScraper?: () => void;
  onOpenNASA?: () => void;
  onOpenHuggingFace?: () => void;
  onOpenIFTTT?: () => void;
  onOpenBrowser?: () => void;
  onOpenLocalLLM?: () => void;
  onOpenVision?: () => void;
  // Direct API Automations
  onOpenAutomation?: () => void;
  onOpenFirecrawl?: () => void;
}

export default function CommandBar({ onCalculate, onOpenWhatsapp, onOpenInstagram, onOpenTelegram, onOpenCommHub, onOpenSecurity, onOpenVault, onOpenDungeon, onOpenHabits, onOpenTimeCapsule, onOpenVoiceNotes, onOpenWeather, onOpenSpotify, onOpenNews, onOpenCalendar, onOpenAutomation }: CommandBarProps = {}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const voiceBtnRef = useRef<HTMLButtonElement>(null);
  const sendBtnRef = useRef<HTMLButtonElement>(null);
  const visualizerRef = useRef<HTMLDivElement>(null);
  const [, setStreamingContent] = useState("");
  const { state, isListening, isStreaming, addMessage, setState, messages, userName, tasks, memories, setCurrentVideo, setGeneratedCode, setActivePanel } =
    useJarvisStore();
  const {
    interimTranscript,
    isSupported: voiceSupported,
    speak,
    stopSpeaking,
    lastCommand,
    stopListening,
    hasSpokenRef,
  } = useJarvisVoice();

  const { setVolume, mute, unmute } = useVolumeControl();
  const { readText, writeText } = useClipboard();
  const { getBattery } = useBatteryStatus();
  const { getNetworkInfo } = useNetworkStatus();

  // Screen capture state
  const [isCapturing, setIsCapturing] = useState(false);

  // Open desktop app or web fallback
  const openDesktopApp = async (app: string) => {
    try {
      const response = await fetch("/api/system/openapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app }),
      });
      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`Failed to open ${app}:`, error);
      return { success: false, method: "none" };
    }
  };
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [showCaptureModal, setShowCaptureModal] = useState(false);

  // Track processed commands to avoid duplicates
  const processedCommandRef = useRef("");

  // Screen capture function
  const captureScreenshot = async () => {
    try {
      setIsCapturing(true);
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();

      // Wait for video to load
      await new Promise((resolve) => setTimeout(resolve, 500));

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");

      if (ctx) {
        ctx.drawImage(video, 0, 0);
        const imageUrl = canvas.toDataURL("image/png");
        setCapturedImage(imageUrl);
        setShowCaptureModal(true);

        // Also save to clipboard
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/png")
        );
        if (blob) {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
          ]);
        }
      }

      // Stop all tracks
      stream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      console.error("Screen capture failed:", error);
    } finally {
      setIsCapturing(false);
    }
  };

  // Download captured screenshot
  const downloadScreenshot = () => {
    if (capturedImage) {
      const link = document.createElement("a");
      link.href = capturedImage;
      link.download = `jarvis-screenshot-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  // GSAP hover effects for buttons
  useEffect(() => {
    if (voiceBtnRef.current) {
      addHoverScale(voiceBtnRef.current, 1.1);
    }
    if (sendBtnRef.current) {
      addHoverScale(sendBtnRef.current, 1.1);
    }
  }, []);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Update input with voice transcript while listening
  useEffect(() => {
    if (isListening && interimTranscript) {
      setInput(interimTranscript);
    }
  }, [interimTranscript, isListening]);

  // Process voice command when lastCommand changes
  useEffect(() => {
    if (lastCommand && lastCommand !== processedCommandRef.current) {
      processedCommandRef.current = lastCommand;
      setInput(lastCommand);
      handleSubmit(lastCommand);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastCommand]);

  // Ref to track current state for keyboard handler
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const currentState = stateRef.current;
      console.log("[Keyboard] Key pressed:", e.key, "State:", currentState);

      // Ctrl+Space for quick command
      if (e.ctrlKey && e.code === "Space") {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }

      // EMERGENCY STOP: Space bar stops speech immediately (only when NOT typing in input/textarea)
      // Note: Does NOT stop mic - wake word detection must stay active
      const activeTag = document.activeElement?.tagName;
      const isTyping = activeTag === "INPUT" || activeTag === "TEXTAREA";
      if (e.key === " " && !isTyping) {
        console.log("[Keyboard] EMERGENCY STOP (space bar)");
        e.preventDefault();
        e.stopPropagation();
        // Directly cancel speech synthesis
        if (typeof window !== "undefined" && window.speechSynthesis) {
          window.speechSynthesis.cancel();
        }
        stopSpeaking();
        // Don't stop listening - keep mic ON for wake word
        setState("idle");
        return;
      }

      // EMERGENCY STOP: Escape stops speech (but keeps mic ON for wake word)
      if (e.key === "Escape") {
        console.log("[Keyboard] EMERGENCY STOP (escape)");
        e.preventDefault();
        e.stopPropagation();
        // Directly cancel speech synthesis
        if (typeof window !== "undefined" && window.speechSynthesis) {
          window.speechSynthesis.cancel();
        }
        stopSpeaking();
        // Don't stop listening - keep mic ON for wake word
        setState("idle");
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setState, stopSpeaking]);

  // Process system control commands (volume, clipboard, battery, network)
  const processSystemCommand = async (text: string): Promise<string | null> => {
    const lower = text.toLowerCase();

    // Volume control - "set volume to 30" or "volume 50" - calls system API
    const volumeMatch = lower.match(/(?:set\s+)?volume\s+(?:to\s+)?(\d+)/);
    if (volumeMatch) {
      const level = parseInt(volumeMatch[1], 10);
      if (level >= 0 && level <= 100) {
        try {
          const response = await fetch("/api/system", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "setVolume", value: level }),
          });
          const data = await response.json();
          if (data.success) {
            // Also set browser media volume
            setVolume(level);
            return `System volume set to ${level}%. Your neighbors will be thrilled, Boss.`;
          }
        } catch (e) {
          console.error("Volume control failed:", e);
        }
        return "I couldn't access the system volume controls, Boss.";
      }
    }

    // Mute - system level
    if (lower.match(/mute|turn off (?:the\s+)?sound|silence/)) {
      try {
        const response = await fetch("/api/system", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "mute" }),
        });
        const data = await response.json();
        if (data.success) {
          mute();
          return "System audio muted, Boss.";
        }
      } catch (e) {
        console.error("Mute failed:", e);
      }
      return "I couldn't access the system audio controls, Boss.";
    }

    // Unmute - system level
    if (lower.match(/unmute|turn on (?:the\s+)?sound/)) {
      try {
        const response = await fetch("/api/system", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "unmute" }),
        });
        const data = await response.json();
        if (data.success) {
          unmute();
          return "System audio unmuted, Boss.";
        }
      } catch (e) {
        console.error("Unmute failed:", e);
      }
      return "I couldn't access the system audio controls, Boss.";
    }

    // Battery status
    if (lower.match(/battery|power level|how much charge/)) {
      const battery = await getBattery();
      if (battery) {
        const status = battery.charging ? "charging" : "on battery";
        const timeText = battery.timeRemaining && battery.timeRemaining > 0
          ? ` Approximately ${Math.round(battery.timeRemaining / 60)} minutes remaining.`
          : "";
        const sarcasm = battery.level < 20 ? " Panic mode imminent." : battery.level > 80 ? " Your procrastination is safe for now." : "";
        return `Battery is at ${Math.round(battery.level)}%, ${status}.${timeText}${sarcasm}`;
      }
      return "I'm unable to access battery information on this device. How tragic, Boss.";
    }

    // Network status
    if (lower.match(/network|internet|connection|wifi|online/)) {
      const network = getNetworkInfo();
      const status = network.online ? "connected" : "disconnected";
      const speed = network.downlink > 0 ? ` Estimated speed: ${network.downlink} Mbps.` : "";
      return `Network is ${status}.${speed}`;
    }

    // Clipboard - read
    if (lower.match(/what.*clipboard|clipboard contents|read.*clipboard/)) {
      const text = await readText();
      return text
        ? `Your clipboard contains: "${text.substring(0, 100)}${text.length > 100 ? "..." : ""}"`
        : "Your clipboard is empty or I don't have access, Boss.";
    }

    // Clipboard - write
    const copyMatch = text.match(/(?:copy|save) (?:this to clipboard|to clipboard|:)\s*(.+)/i);
    if (copyMatch || lower.match(/copy this/)) {
      const content = copyMatch ? copyMatch[1] : "Copied from JARVIS";
      const success = await writeText(content);
      return success
        ? "Copied to clipboard, Boss."
        : "I couldn't access the clipboard, Boss.";
    }

    // Open website/app with desktop app support
    const openMatch = lower.match(/open\s+(?:the\s+)?(whatsapp|telegram|instagram|spotify|discord|youtube|chrome|vs code|code|notepad|calculator|file explorer|settings|twitter|x\.com|github|gmail|maps)/);
    if (openMatch) {
      const app = openMatch[1].replace(/\s+/g, "");

      // Apps that support desktop opening
      const desktopApps = ["whatsapp", "telegram", "instagram", "spotify", "discord", "vscode", "code", "notepad", "calculator"];

      if (desktopApps.includes(app)) {
        const result = await openDesktopApp(app === "code" ? "vscode" : app);
        if (result.success) {
          return result.method === "desktop"
            ? `Opening ${openMatch[1]} desktop app, Boss.`
            : `Opening ${openMatch[1]} in browser, Boss.`;
        }
      }

      // Fallback to web URLs
      const urls: Record<string, string> = {
        youtube: "https://youtube.com",
        spotify: "https://open.spotify.com",
        discord: "https://discord.com",
        chrome: "https://google.com",
        vscode: "vscode://",
        code: "vscode://",
        notepad: "notepad:",
        calculator: "calculator:",
        fileexplorer: "file:",
        settings: "ms-settings:",
        twitter: "https://twitter.com",
        "x.com": "https://x.com",
        github: "https://github.com",
        gmail: "https://gmail.com",
        maps: "https://maps.google.com",
      };
      const url = urls[app] || `https://${app}.com`;
      window.open(url, "_blank");
      return `Opening ${openMatch[1]}. Another fascinating destination, Boss.`;
    }

    // FILE SEARCH - Must come BEFORE Google search to catch file lookups
    // Pattern 1: "find my resume.pdf" - has file extension
    // Pattern 2: "find my python file" or "find my resume file"
    // Pattern 3: "where did I save my presentation"
    const fileSearchMatch = lower.match(/\b(?:find|locate|where\s+(?:is|are)|search\s+for)\s+(?:my\s+)?(.+?\.(?:pdf|doc|docx|txt|xlsx|ppt|pptx|jpg|png|mp4|zip))\b/i) ||
                           lower.match(/\b(?:find|locate|search\s+for)\s+(?:my\s+)?(.+?\s+(?:file|document|pdf))\b/i) ||
                           lower.match(/\b(where\s+did\s+i\s+save\s+(?:my\s+)?(.+?)(?:\s+(?:file|document|folder))?)\b/i);

    if (fileSearchMatch) {
      let query = fileSearchMatch[1]?.trim() || fileSearchMatch[2]?.trim();
      // Clean up the query
      if (query) {
        query = query.replace(/\b(file|document|folder)\b/gi, "").trim();
      }
      if (query && query.length > 2) {
        try {
          const response = await fetch("/api/files/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query }),
          });
          const data = await response.json();

          if (data.success && data.results?.length > 0) {
            const file = data.results[0];
            return `Found "${file.name}" in ${file.path}. Your organizational skills continue to amaze, Boss.`;
          }
          return `I couldn't find "${query}". Perhaps try cleaning your desktop, Boss.`;
        } catch {
          return "File search failed. Your files remain mysteriously lost, Boss.";
        }
      }
    }

    // Search Google - skip if user mentioned youtube, has file extension, or is a Playwright automation command
    const searchMatch = lower.match(/(?:search|google|look up|find)\s+(?:for\s+)?(.+)/);
    const hasFileExtension = /\.(pdf|doc|docx|txt|xlsx|ppt|pptx|jpg|png|mp4|zip)\b/i.test(lower);
    const isAmazonPriceCheck = /(?:price of|find the price of|price on|buy|shop for)\s+.+?\s+on\s+amazon/i.test(lower);
    const isFlightSearch = /flights?\s+(?:from\s+)?.+\s+(?:to|from|-)\s+/i.test(lower);
    const isFoodOrder = /(?:order|find|get)\s+.+\s+(?:on|from)\s+(?:zomato|swiggy)/i.test(lower);
    const isWhatsApp = /whatsapp/i.test(lower);
    const isPriceCompare = /compare\s+(?:the\s+)?prices?/i.test(lower);
    const isNewsScrape = /(?:scrape|fetch|latest)\s+.*news/i.test(lower);
    const isJobSearch = /jobs?\s+(?:in|at|on)\s+/i.test(lower);
    const isPlaywrightCmd = isAmazonPriceCheck || isFlightSearch || isFoodOrder || isWhatsApp || isPriceCompare || isNewsScrape || isJobSearch;
    const isYouTubePlay = /(?:play|watch)\s+.+\s+on\s+youtube/i.test(lower);
    const isDirections = /(?:directions?|navigate|route)\s+from\s+/i.test(lower);
    const isJobSearchCmd = /(?:search|find)\s+.+\s+jobs?/i.test(lower);
    const isEmailCompose = /(?:send|compose|write)\s+(?:an?\s+)?email/i.test(lower);
    const isMovieSearch = /(?:book|find|search)\s+(?:movie|tickets?\s+for)/i.test(lower);
    const isWebScrape = /(?:scrape|extract)\s+https?:\/\//i.test(lower);
    const isTracking = /(?:track|where is)\s+(?:my\s+)?(?:package|order|delivery)/i.test(lower);
    const isAutomationCmd = isPlaywrightCmd || isYouTubePlay || isDirections || isJobSearchCmd || isEmailCompose || isMovieSearch || isWebScrape || isTracking;
    
    if (searchMatch && !lower.includes("youtube") && !hasFileExtension && !isAutomationCmd) {
      const query = encodeURIComponent(searchMatch[1]);
      window.open(`https://google.com/search?q=${query}`, "_blank");
      return `Searching Google for "${searchMatch[1]}". Because clearly you couldn't type that yourself, Boss.`;
    }

    // SPOTIFY DIAGNOSTIC
    if (lower.match(/test\s*spotify|spotify status|check spotify/)) {
      try {
        const debugResponse = await fetch("/api/spotify?action=debug");
        const debugData = await debugResponse.json();

        // Working correctly
        if (debugData.tokenRefreshed) {
          return `Spotify is connected and ready, Boss. Token refreshed successfully.`;
        }

        // Show error details
        let status = `Spotify Status: Client ID ${debugData.hasClientId ? "✓" : "✗"}, Secret ${debugData.hasClientSecret ? "✓" : "✗"}, Token ${debugData.hasRefreshToken ? "✓" : "✗"}.`;

        if (debugData.error) {
          status += ` Error: ${debugData.error}.`;
          if (debugData.errorDescription) {
            status += ` ${debugData.errorDescription}.`;
          }
        } else {
          status += ` Token refresh failed.`;
        }

        return `${status} Boss.`;
      } catch (e) {
        return `Spotify diagnostic failed: ${e}, Boss.`;
      }
    }

    // CUSTOM FIXED COMMAND - "play my music" always plays Back in Black by AC/DC
    if (lower.match(/\bplay my music\b/)) {
      try {
        // Check if user said "on youtube"
        if (lower.includes("youtube")) {
          // Play on YouTube
          const response = await fetch("/api/youtube", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "search", query: "Back in Black AC/DC" }),
          });
          const data = await response.json();

          if (data.success && data.videos?.length > 0) {
            const video = data.videos[0];
            setCurrentVideo({
              id: video.id,
              title: video.title,
              channel: video.channel,
              embedUrl: video.embedUrl,
            });
            return `Playing your music: "${video.title}" by ${video.channel}. Because apparently you can't live without it, Boss.`;
          }
          return "I couldn't find your music on YouTube, Boss.";
        }

        // Play on Spotify
        const searchResponse = await fetch("/api/spotify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "search", query: "Back in Black AC/DC" }),
        });
        const searchData = await searchResponse.json();

        if (searchData.success && searchData.results?.tracks?.items?.length > 0) {
          const track = searchData.results.tracks.items[0];
          // Play the track
          await fetch("/api/spotify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "play", uri: track.uri }),
          });
          return `Playing "${track.name}" by ${track.artists.map((a: {name: string}) => a.name).join(", ")}. Your taste is... predictable, Boss.`;
        }
        return "I couldn't find your music. Playing default music instead, Boss.";
      } catch (e) {
        console.error("Custom play my music failed:", e);
        return "I couldn't play your music, Boss.";
      }
    }

    // DIRECT API AUTOMATIONS (No middleware) - Must come BEFORE Spotify
    // These handle commands like "add task", "send email", "save to notion"
    // that might otherwise be caught by Spotify's "play" regex
    // Also handles speech recognition variations: "had it ask to" -> "add task to", "to do" -> "todoist"
    const hasTodoistKeywords = /\b(add task|add to todoist|todoist|remind me to|task\s+(?:to|for|about)|had it ask to|ask to|to do|to do ist)\b/i.test(lower);
    const hasNotionKeywords = /\b(save to notion|add to notion|notion|save this)\b/i.test(lower);
    const hasEmailKeywords = /\b(send email|email\s+.+?\s+(?:at|@)|e?mail\s+(?:to|for))\b/i.test(lower) ||
                              /\b\w+\s+\w*\d*\s+(?:at|@)\s*\w+\s*\.\s*\w+/i.test(text); // matches "name 67 at gmail dot com"
    const hasOpenKeywords = /\b(open automation|show automation|automation panel)\b/i.test(lower);

    if (hasTodoistKeywords || hasNotionKeywords || hasEmailKeywords || hasOpenKeywords) {
      // Open automation panel
      if (lower.includes("open") || lower.includes("show")) {
        onOpenAutomation?.();
        return "Opening Direct Automation panel. Instant API access, Boss.";
      }
      // Direct Todoist add - FIXED for speech recognition
      // Handles: "add task play badminton to todoist", "remind me to play badminton", etc.
      let taskContent = "";
      let dueString = "";

      // Pattern 1: "add task [content] to todoist" or "had it ask to [content] to do"
      const addTaskMatch = text.match(/(?:add|had it ask|ask)\s+(?:a\s+)?(?:task\s+|to\s+)?(.+?)(?:\s+(?:to|for|in))\s+(?:todoist|to do|todo)/i);
      if (addTaskMatch) {
        taskContent = addTaskMatch[1].trim();
      }

      // Pattern 2: "remind me to [content]" (no todoist keyword needed)
      if (!taskContent) {
        const remindMatch = text.match(/remind\s+me\s+to\s+(.+)/i);
        if (remindMatch) {
          taskContent = remindMatch[1].trim();
        }
      }

      // Pattern 3: "task [content]" (direct command)
      if (!taskContent) {
        const taskMatch = text.match(/\btask\s+(.+?)(?:\s+(?:due|by|for|tomorrow|today))/i);
        if (taskMatch) {
          taskContent = taskMatch[1].trim();
        }
      }

      // Extract due date from task content
      if (taskContent) {
        const dueMatch = taskContent.match(/\b(tomorrow|today|next week|in \d+ (?:hour|day)s?)\b/i);
        if (dueMatch) {
          dueString = dueMatch[1];
          taskContent = taskContent.replace(/\b(tomorrow|today|next week|in \d+ (?:hour|day)s?)\b/i, "").trim();
        }

        // Clean up
        taskContent = taskContent.replace(/^(?:to\s+)/, "").trim();
      }

      // Process todoist task
      if (taskContent) {
        fetch("/api/todoist/add-task", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: taskContent,
            dueString: dueString,
          }),
        }).catch(() => {});

        return `Adding "${taskContent}" to Todoist${dueString ? " for " + dueString : ""}. Task created instantly, Boss.`;
      }

      // Direct Notion save
      const notionMatch = lower.match(/(?:save|add)\s+(?:this\s+)?(?:article|page|link|url|note)?\s*(?:to\s+)?notion/i);
      if (notionMatch) {
        // Extract title and URL from command or current context
        const titleMatch = text.match(/title["']?\s*[:\s]+["']?([^"']+)/i);
        const urlMatch = text.match(/(https?:\/\/[^\s]+)/);
        const contentMatch = text.match(/(?:saying|with content|note)?\s*["']?([^"']+)["']?/i);

        const title = titleMatch?.[1] || contentMatch?.[1] || "Saved from JARVIS";

        // Trigger the API call
        fetch("/api/notion/create-page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.substring(0, 100),
            url: urlMatch?.[1],
            content: "Saved via voice command",
          }),
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.success) {
              console.log("[Notion] Saved:", data.url);
            }
          })
          .catch(() => {});

        return `Saved "${title.substring(0, 50)}" to your Notion database. Check your Notion workspace to view it, Boss.`;
      }

      // Direct Email - fixed regex for spoken email addresses with spaces in names
      // "send email to Dhruv Bijapur 67 at gmail dot com saying good morning"
      // Speech recognition: "Dhruv Bijapur 67 at gmail dot com"
      const emailPatterns = [
        // Standard: "send email to name at domain saying message"
        /(?:send|email)\s+(?:an?\s+)?(?:email\s+)?(?:to\s+)?(.+?)(?:\s+(?:saying|with subject|about|that|message|body)\s+)(.+)/i,
        // Simple: "send email to name at domain"
        /(?:send|email)\s+(?:an?\s+)?(?:email\s+)?(?:to\s+)?(.+?)$/i,
      ];

      let emailCommandMatch = null;
      for (const pattern of emailPatterns) {
        const match = text.match(pattern);
        if (match) {
          emailCommandMatch = match;
          break;
        }
      }

      if (emailCommandMatch) {
        let recipientPart = emailCommandMatch[1]?.trim() || "";
        let messageContent = emailCommandMatch[2]?.trim() || "Hello from JARVIS";

        // STEP 1: Extract the email portion before any message keywords
        // Split on common message-starting phrases
        const messageSplit = recipientPart.split(/\s+(?:saying|with subject|about|that|message|body)\s+/i);
        recipientPart = messageSplit[0].trim();

        // STEP 2: Parse the email address
        // Input: "Dhruv Bijapur 67 at gmail dot com"
        // Strategy: Find "at" separator, everything before is local part, after is domain

        let emailAddress = "";

        // Find the "at" separator (spoken as "at")
        const atMatch = recipientPart.match(/\s+at\s+/i);
        if (atMatch) {
          const atIndex = recipientPart.search(/\s+at\s+/i);
          const localPart = recipientPart.substring(0, atIndex).trim();
          const domainPart = recipientPart.substring(atIndex + atMatch[0].length).trim();

          // Process local part: remove all spaces, keep alphanumeric and dots
          const cleanLocal = localPart.toLowerCase().replace(/\s+/g, "");

          // Process domain part: replace "dot" with ".", then remove spaces
          const cleanDomain = domainPart
            .toLowerCase()
            .replace(/\s+dot\s*/gi, ".")
            .replace(/\s+/g, "");

          emailAddress = `${cleanLocal}@${cleanDomain}`;
        } else {
          // No "at" found - try to detect if it's already an email-like string
          emailAddress = recipientPart.toLowerCase().replace(/\s+/g, "");
        }

        // STEP 3: Validate
        // Remove any trailing dots
        emailAddress = emailAddress.replace(/\.+$/, "");

        // Must have exactly one @ and a valid domain
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
        if (emailRegex.test(emailAddress)) {
          const subject = messageContent.substring(0, 50) + (messageContent.length > 50 ? "..." : "");

          // Send the email and await response
          try {
            const res = await fetch("/api/send-email", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                to: emailAddress,
                subject: subject,
                text: messageContent,
              }),
            });

            const data = await res.json();

            if (data.success) {
              return `Email sent to ${emailAddress}, Boss.`;
            } else if (data.error?.includes("not configured")) {
              setActivePanel("automation");
              return `Email is not configured. Opening the automation panel so you can set it up, Boss.`;
            } else {
              return `Failed to send email: ${data.error || "Unknown error"}, Boss.`;
            }
          } catch (err: any) {
            console.error("[Email] Error:", err);
            return `Failed to send email: ${err.message || "Network error"}, Boss.`;
          }
        } else {
          // Invalid email format - open automation panel instead
          setActivePanel("automation");
          return `I couldn't parse that email address. Opening the email panel where you can enter it manually, Boss.`;
        }
      }
    }

    // SPOTIFY CONTROLS
    // Play - matches: play music, play the music, play spotify, play songs, resume music, etc.
    if (lower.match(/\b(play( the| some)?\s+(music|song|songs|spotify|track|audio)|resume( the)?\s+(music|playback)?)\b/)) {
      try {
        const response = await fetch("/api/spotify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "play" }),
        });
        const data = await response.json();

        // Debug logging
        console.log("[Spotify] Play response:", { status: response.status, ok: response.ok, data });

        // Success cases
        if (data.success) {
          if (data.device) {
            return `Playing music on Spotify (${data.device}). Try not to disturb the peace, Boss.`;
          }
          return "Playing music on Spotify, Boss.";
        }

        // Error cases
        if (data.error?.includes("Device") || response.status === 404) {
          return "No active Spotify device found. Please open Spotify on your computer or phone first, Boss.";
        }
        if (data.error) {
          return `Spotify error: ${data.error}, Boss.`;
        }
        return "Spotify returned an unknown response, Boss.";
      } catch (e) {
        console.error("Spotify play failed:", e);
        return "I couldn't connect to Spotify. Make sure JARVIS is running, Boss.";
      }
    }

    // Pause - matches: pause music, pause the music, pause spotify, stop music, stop the song, etc.
    if (lower.match(/\b(pause( the)?\s+(music|song|songs|spotify|track|playback|audio)|stop( the)?\s+(music|song|songs|spotify|track|playback|audio))\b/)) {
      try {
        // First check what's currently playing
        const currentResponse = await fetch("/api/spotify?action=currentTrack");
        const currentData = await currentResponse.json();
        const wasPlaying = currentData.success && currentData.track?.is_playing;

        // Send pause command
        const response = await fetch("/api/spotify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pause" }),
        });
        const data = await response.json();

        if (response.ok && (data.success || data.action === "pause")) {
          if (wasPlaying) {
            return "Music paused. The silence must be deafening, Boss.";
          } else {
            return "Spotify was already paused. As productive as ever, I see, Boss.";
          }
        }
        if (data.error?.includes("Device")) {
          return "No active Spotify device found. Please open Spotify first, Boss.";
        }
        return `Spotify error: ${data.error || "Unknown error"}, Boss.`;
      } catch (e) {
        console.error("Spotify pause failed:", e);
        return "I couldn't pause Spotify. Make sure it's running, Boss.";
      }
    }

    // Next track - matches: next song, next track, skip song, skip track, forward, etc.
    if (lower.match(/\b(next|skip)\s+(song|track|music|this|to the next)|(play next)\b/)) {
      try {
        const response = await fetch("/api/spotify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "next" }),
        });
        const data = await response.json();
        if (response.ok && (data.success || data.action === "next")) return "Next track. Because apparently this one wasn't good enough, Boss.";
      } catch (e) {
        console.error("Spotify next failed:", e);
      }
      return "I couldn't skip to the next track. The music has you trapped, Boss.";
    }

    // Previous track - matches: previous song, previous track, go back, back, last song, etc.
    if (lower.match(/\b(previous|last)\s+(song|track|music)|(go\s+back|play\s+back)\b/)) {
      try {
        const response = await fetch("/api/spotify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "previous" }),
        });
        const data = await response.json();
        if (response.ok && (data.success || data.action === "previous")) return "Going back. Nostalgia is a powerful drug, Boss.";
      } catch (e) {
        console.error("Spotify previous failed:", e);
      }
      return "I couldn't go back. Time travel remains elusive, Boss.";
    }

    // Search and play specific song - matches: play [song name], search for [song], play the song [name], etc.
    // Skip if user mentioned "youtube" - let YouTube handler catch those
    // Skip if contains automation/task keywords to avoid interfering with Direct API commands
    const spotifySearchMatch = lower.match(/\b(play|search for|find|look for)\s+(?:the\s+)?(?:song\s+)?(.+)/);
    const hasAutomationKeywords = /\b(todoist|notion|task|email|remind|add to|save to|jobs?|movie|movies|film|tickets?|flights?|book|scrape|track|directions?)\b/.test(lower);
    if (spotifySearchMatch && !lower.includes("youtube") && !hasAutomationKeywords) {
      const query = spotifySearchMatch[2]?.trim() || spotifySearchMatch[1]?.trim();
      try {
        const response = await fetch("/api/spotify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "search", query }),
        });
        const data = await response.json();
        if (data.success && data.results?.tracks?.items?.length > 0) {
          const track = data.results.tracks.items[0];
          // Play the first result
          await fetch("/api/spotify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "play", uri: track.uri }),
          });
          return `Now playing "${track.name}" by ${track.artists.map((a: {name: string}) => a.name).join(", ")}. Try not to sing along, Boss.`;
        }
      } catch (e) {
        console.error("Spotify search failed:", e);
      }
      return `I couldn't find "${query}". Your musical taste remains a mystery to me, Boss.`;
    }

    // What's playing - matches: what's playing, what song is this, current track, now playing, etc.
    if (lower.match(/\b(what('s| is)?\s+(playing|this song|the song|on)|current(ly)?\s+(playing|song|track)|now playing)\b/)) {
      try {
        const response = await fetch("/api/spotify?action=currentTrack");
        const data = await response.json();
        if (data.success && data.track?.item) {
          const { item } = data.track;
          return `Currently playing: "${item.name}" by ${item.artists.map((a: {name: string}) => a.name).join(", ")}. Marvelous choice, obviously, Boss.`;
        }
        return "Nothing is currently playing on Spotify, Boss.";
      } catch (e) {
        console.error("Spotify current track failed:", e);
      }
      return "I couldn't check what's playing, Boss.";
    }

    // CONSOLE COMMANDS
    // Open console/dev tools
    if (lower.match(/open console|open dev tools|show console|developer tools/)) {
      // Open browser console programmatically doesn't work, but we can simulate
      console.log("%c[Console Opened by Voice Command]", "font-size: 20px; color: #00ff00;");
      return "Opening developer console. Press F12 to see it, Boss.";
    }

    // Clear console
    if (lower.match(/clear console|clean console|clear log/)) {
      console.clear();
      return "Console cleared, Boss.";
    }

    // System info
    if (lower.match(/system info|computer info|device info|what.*system/)) {
      const browserInfo = `Browser: ${navigator.userAgent.split(')')[0]})`;
      const platform = `Platform: ${navigator.platform}`;
      const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ? `Memory: ${(navigator as Navigator & { deviceMemory?: number }).deviceMemory}GB` : 'Memory: Unknown';
      const cores = `Cores: ${navigator.hardwareConcurrency || 'Unknown'}`;
      return `${browserInfo}, ${platform}, ${memory}, ${cores}, Boss.`;
    }

    // Screenshot (uses screen capture API)
    if (lower.match(/take screenshot|capture screen|screenshot/)) {
      try {
        // Trigger the capture function
        captureScreenshot();
        return "Taking screenshot. The image will be copied to your clipboard, Boss.";
      } catch {
        return "Screen capture was cancelled or not available, Boss.";
      }
    }

    // Print page
    if (lower.match(/print page|print this|send to printer/)) {
      window.print();
      return "Print dialog opened, Boss.";
    }

    // Reload page
    if (lower.match(/reload page|refresh page|reload/)) {
      window.location.reload();
      return "Reloading. Because apparently starting over is the solution, Boss.";
    }

    // Fullscreen
    if (lower.match(/fullscreen|full screen/)) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
        return "Exiting fullscreen. Reality awaits, Boss.";
      } else {
        document.documentElement.requestFullscreen();
        return "Entering fullscreen. Escape from reality engaged, Boss.";
      }
    }

    // ===== BATCH 1 FEATURES =====

    // TIMER & ALARMS
    // Set timer - matches: set timer for 5 minutes, timer 10 minutes, countdown 30 seconds
    const timerMatch = lower.match(/(?:set\s+)?timer\s+(?:for\s+)?(\d+)\s*(minutes?|mins?|m|hours?|hrs?|h|seconds?|secs?|s)/);
    if (timerMatch || lower.match(/\b(countdown|start timer)\b/)) {
      try {
        const amount = timerMatch ? parseInt(timerMatch[1]) : 5;
        const unit = timerMatch ? timerMatch[2] : "minutes";
        let minutes = 0;
        let seconds = 0;

        if (unit.startsWith("h")) {
          minutes = amount * 60;
        } else if (unit.startsWith("m")) {
          minutes = amount;
        } else if (unit.startsWith("s")) {
          seconds = amount;
        }

        const response = await fetch("/api/timer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", minutes, seconds, label: `${amount} ${unit} timer` }),
        });
        const data = await response.json();

        if (data.success) {
          return `Timer set for ${amount} ${unit}. As if you couldn't count yourself, Boss.`;
        }
      } catch (e) {
        console.error("Timer failed:", e);
      }
      return "I couldn't set the timer, Boss.";
    }

    // Check timers
    if (lower.match(/check timer|timers status|my timers/)) {
      try {
        const response = await fetch("/api/timer?action=list");
        const data = await response.json();
        if (data.timers?.length === 0) {
          return "No active timers, Boss.";
        }
        const timerList = data.timers.map((t: {label: string, remaining: number}) =>
          `${t.label} (${Math.floor(t.remaining / 60)}m ${t.remaining % 60}s left)`
        ).join(", ");
        return `Active timers: ${timerList}, Boss.`;
      } catch {
        return "I couldn't check timers, Boss.";
      }
    }

    // Set alarm - matches: set alarm for 7am, alarm 8:30, wake me up at 6
    const alarmMatch = lower.match(/(?:set\s+)?alarm\s+(?:for\s+)?(?:wake\s+me\s+up\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (alarmMatch) {
      try {
        let hours = parseInt(alarmMatch[1]);
        const minutes = alarmMatch[2] ? parseInt(alarmMatch[2]) : 0;
        const period = alarmMatch[3]?.toLowerCase();

        if (period === "pm" && hours !== 12) hours += 12;
        if (period === "am" && hours === 12) hours = 0;

        const timeStr = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;

        const response = await fetch("/api/timer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "alarm", label: timeStr }),
        });
        const data = await response.json();

        if (data.success) {
          return `Alarm set for ${timeStr}. Prepare to be jolted from blissful ignorance, Boss.`;
        }
      } catch (e) {
        console.error("Alarm failed:", e);
      }
      return "I couldn't set the alarm, Boss.";
    }

    // CALCULATOR - Detect ANY math-related query
    // Fix common speech recognition errors first
    const fixedText = text
      .replace(/\bsign\s+of\b/gi, "sine of")
      .replace(/\bsign\b/gi, "sine")
      .replace(/\bcause\s+of\b/gi, "cosine of")
      .replace(/\bcause\b/gi, "cos")
      .replace(/\bturn\s+of\b/gi, "tangent of")
      .replace(/\bturn\b/gi, "tan")
      .replace(/\bcourse\s+of\b/gi, "cosine of")
      .replace(/\bcourse\b/gi, "cos");

    const lowerFixed = fixedText.toLowerCase();

    // Check if it contains numbers AND math-related words, or starts with calculation phrases
    const hasMathWords = /(?:plus|minus|times|multiplied|divided|over|square\s+root|sqrt|cube\s+root|cbrt|sine|sin|cosine|cos|tangent|tan|factorial|power|squared|cubed|percent|%|log|ln)/i.test(lowerFixed);
    const hasNumbers = /\d/.test(lowerFixed);
    const startsWithCalc = /^(?:what\s+is|what's|calculate|compute|solve|find|evaluate|\d)/i.test(lowerFixed);
    const isSimpleExpr = /^[\d\s+\-*/().^%!\s]+$/.test(fixedText.trim());

    if ((hasNumbers && (hasMathWords || startsWithCalc)) || isSimpleExpr) {
      try {
        console.log("[Calculator] Detected math query:", fixedText);
        const response = await fetch("/api/calculator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ natural: fixedText }),
        });
        const data = await response.json();

        if (data.success) {
          console.log("[Calculator] Result:", data);
          const formattedExpr = data.expression.replace(/\*\*/g, "^").replace(/\*/g, "×").replace(/\//g, "÷");
          onCalculate?.(formattedExpr, data.formatted);
          return `${formattedExpr} = ${data.formatted}, Boss.`;
        }
      } catch (e) {
        console.error("Calculator failed:", e);
      }
      return "I couldn't calculate that, Boss.";
    }

    // WHATSAPP COMMANDS
    if (lower.includes("whatsapp") || lower.includes("whats app")) {
      // Open WhatsApp - try desktop app first, then web
      if (lower.includes("open") || lower.includes("show") || lower.includes("check") || lower.includes("launch")) {
        const result = await openDesktopApp("whatsapp");
        if (result.success) {
          onOpenWhatsapp?.();
          return result.method === "desktop"
            ? "Opening WhatsApp desktop app, Boss."
            : "Opening WhatsApp Web in browser, Boss.";
        }
      }

      // Send WhatsApp message - matches: "send whatsapp to +1234567890: hello" or "whatsapp mom: running late"
      const sendMatch = lower.match(/(?:send|message|msg)\s+(?:whatsapp\s+)?(?:to\s+)?([+:]?\d+|[a-z]+)[:\s]+\s*(.+)/i);
      if (sendMatch && onOpenWhatsapp) {
        const [, recipient, message] = sendMatch;

        // If recipient is a name (not number), we need to look it up first
        if (!/^\+?\d+$/.test(recipient)) {
          // For now, just open WhatsApp and let user select
          onOpenWhatsapp();
          return `Opening WhatsApp to message ${recipient}. Please select the contact, Boss.`;
        }

        // Send to number directly
        try {
          const response = await fetch("/api/whatsapp/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ number: recipient, message }),
          });
          const data = await response.json();

          if (data.success) {
            return `Message sent to ${recipient}, Boss.`;
          } else {
            return `Failed to send: ${data.error}, Boss.`;
          }
        } catch (e) {
          console.error("WhatsApp send failed:", e);
          return "Couldn't send WhatsApp message, Boss.";
        }
      }
    }

    // INSTAGRAM COMMANDS
    if (lower.includes("instagram") || lower.includes("insta") || lower.includes("dm")) {
      // Open Instagram - opens in browser since no desktop app
      if (lower.includes("open") || lower.includes("show") || lower.includes("check") || lower.includes("launch")) {
        const result = await openDesktopApp("instagram");
        if (result.success) {
          onOpenInstagram?.();
          return "Opening Instagram in browser, Boss.";
        }
      }

      // Send Instagram DM
      const igSendMatch = lower.match(/(?:send|message|msg)\s+(?:instagram|dm|insta)\s+(?:to\s+)?([a-z0-9_.]+)[:\s]+\s*(.+)/i);
      if (igSendMatch && onOpenInstagram) {
        const [, recipient, message] = igSendMatch;

        // For now, open Instagram and let user select
        onOpenInstagram();
        return `Opening Instagram to message ${recipient}. Please select the contact, Boss.`;
      }
    }

    // TELEGRAM COMMANDS
    if (lower.includes("telegram")) {
      // Open Telegram - try desktop app first, then web
      if (lower.includes("open") || lower.includes("show") || lower.includes("check") || lower.includes("messages") || lower.includes("launch")) {
        const result = await openDesktopApp("telegram");
        if (result.success) {
          onOpenTelegram?.();
          return result.method === "desktop"
            ? "Opening Telegram desktop app, Boss."
            : "Opening Telegram Web in browser, Boss.";
        }
      }

      // Send Telegram message
      const telegramSendMatch = lower.match(/(?:send|message|msg)\s+(?:telegram|tg)\s+(?:to\s+)?([^:]+):\s*(.+)/i);
      if (telegramSendMatch && onOpenTelegram) {
        const [, recipient, message] = telegramSendMatch;
        onOpenTelegram();
        return `Opening Telegram to message ${recipient}. Please select the chat, Boss.`;
      }
    }

    // COMMUNICATION HUB COMMANDS
    if (lower.includes("messages") || lower.includes("message hub") || lower.includes("all messages") || lower.includes("communication hub")) {
      onOpenCommHub?.();
      return "Opening Communication Hub, Boss.";
    }

    // SECURITY COMMANDS
    if (lower.includes("security") || lower.includes("intruder") || lower.includes("motion detection") || lower.includes("camera")) {
      if (lower.includes("open") || lower.includes("show") || lower.includes("check") || lower.includes("start") || lower.includes("activate")) {
        onOpenSecurity?.();
        return "Opening security panel, Boss. Stay vigilant.";
      }
    }

    // VAULT COMMANDS
    if (lower.includes("vault") || lower.includes("encrypted") || lower.includes("secure") || lower.includes("private")) {
      if (lower.includes("open") || lower.includes("show") || lower.includes("unlock") || lower.includes("access")) {
        onOpenVault?.();
        return "Opening the vault, Boss. Your secrets are safe.";
      }
    }

    // DUNGEON MASTER COMMANDS
    if (lower.includes("dungeon") || lower.includes("dnd") || lower.includes("d and d") || lower.includes("game master") || lower.includes("rpg") || lower.includes("adventure")) {
      if (lower.includes("open") || lower.includes("start") || lower.includes("play") || lower.includes("show")) {
        onOpenDungeon?.();
        return "Initializing the Dungeon Master. Your adventure awaits, Boss.";
      }
    }

    // HABITS COMMANDS
    if (lower.includes("habit") || lower.includes("goals") || lower.includes("progress") || lower.includes("streak") || lower.includes("reality check")) {
      if (lower.includes("open") || lower.includes("show") || lower.includes("check") || lower.includes("track")) {
        onOpenHabits?.();
        return "Opening Reality Check. Prepare for some uncomfortable truths, Boss.";
      }
    }

    // TIME CAPSULE COMMANDS
    if (lower.includes("time capsule") || lower.includes("memories") || lower.includes("remember") || lower.includes("on this day")) {
      if (lower.includes("open") || lower.includes("show") || lower.includes("check") || lower.includes("view")) {
        onOpenTimeCapsule?.();
        return "Opening the Time Capsule. Let's see what you've been up to, Boss.";
      }
    }

    // VOICE NOTES COMMANDS (Tier 1)
    if (lower.includes("voice note") || lower.includes("voice memo") || lower.includes("record") || lower.includes("recording")) {
      if (lower.includes("open") || lower.includes("show") || lower.includes("start") || lower.includes("record") || lower.includes("new")) {
        onOpenVoiceNotes?.();
        return "Opening Voice Notes. Prepare to be recorded, Boss.";
      }
    }

    // TIER 2: WEATHER PANEL - Only open when explicitly requested
    if (lower.match(/\bopen\s+(?:the\s+)?weather\s+(?:panel|station|app)\b/)) {
      onOpenWeather?.();
      return "Opening Weather Station. Checking atmospheric conditions, Boss.";
    }

    // TIER 2: SPOTIFY COMMANDS
    if (lower.includes("spotify") || lower.includes("music") || lower.includes("song") || lower.includes("playlist")) {
      if (lower.includes("open") || lower.includes("show") || lower.includes("control") || lower.includes("play")) {
        onOpenSpotify?.();
        return "Opening Spotify Control. Let's get the tunes flowing, Boss.";
      }
    }

    // TIER 2: NEWS COMMANDS
    if (lower.match(/\b(news|headlines|what's happening|current events|today's news)\b/)) {
      if (lower.includes("open") || lower.includes("show") || lower.includes("check") || lower.includes("get the") || lower.includes("read the")) {
        onOpenNews?.();
        return "Opening News Briefing. Staying informed is key, Boss.";
      }
    }

    // TIER 2: CALENDAR COMMANDS
    if (lower.match(/\b(calendar|schedule|appointments|meetings|what's on today|my day)\b/)) {
      if (lower.includes("open") || lower.includes("show") || lower.includes("check") || lower.includes("view")) {
        onOpenCalendar?.();
        return "Opening Google Calendar. Let's see what's on the agenda, Boss.";
      }
    }

    // EMAIL BRIEFING - Check emails via voice
    if (lower.match(/\b(check my email|email briefing|what's in my inbox|read my emails|any new emails|unread emails)\b/)) {
      try {
        const response = await fetch("/api/gmail/briefing?summary=true");
        const data = await response.json();

        if (data.success && data.briefing) {
          if (data.demo) {
            return `${data.briefing} (Demo mode - add Gmail API permissions for real data)`;
          }
          return data.briefing;
        }

        return "I couldn't fetch your emails right now, Boss.";
      } catch (error) {
        console.error("[Email Briefing] Error:", error);
        return "Email briefing failed. Check your Gmail connection, Boss.";
      }
    }

    // PRICE TRACKER - Open price tracker panel
    if (lower.match(/\b(price tracker|track prices|amazon deals|price drop|track this product)\b/)) {
      if (lower.includes("open") || lower.includes("show") || lower.includes("check")) {
        setActivePanel("price-tracker");
        return "Opening Price Tracker. Monitoring deals, Boss.";
      }

      // Check for price alerts
      try {
        const response = await fetch("/api/price-tracker?action=alerts");
        const data = await response.json();

        if (data.success) {
          if (data.alerts?.length > 0) {
            const alertCount = data.alerts.length;
            const alertList = data.alerts.slice(0, 3).map((a: any) =>
              `${a.product} is now ${a.currentPrice} (target: ${a.targetPrice})`
            ).join("; ");
            return `${alertCount} price drop${alertCount > 1 ? 's' : ''} detected: ${alertList}, Boss.`;
          }
          return "No price drops detected. I'll keep monitoring, Boss.";
        }
      } catch (error) {
        console.error("[Price Tracker] Error:", error);
        return "Price tracker is unavailable right now, Boss.";
      }
    }

    // TRANSCRIPTION - Meeting transcription
    if (lower.match(/\b(transcription|transcribe|meeting notes|record meeting|meeting transcription|voice to text)\b/)) {
      if (lower.includes("open") || lower.includes("show") || lower.includes("start") || lower.includes("record")) {
        setActivePanel("transcription");
        return "Opening Meeting Transcription. Ready to capture every word, Boss.";
      }

      // Load demo transcription
      if (lower.includes("demo") || lower.includes("example") || lower.includes("test")) {
        try {
          const response = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "demo" }),
          });
          const data = await response.json();
          if (data.success) {
            setActivePanel("transcription");
            return "Demo meeting transcription loaded. The team discussed the authentication refactor and mobile app redesign, Boss.";
          }
        } catch (error) {
          console.error("[Transcription] Demo error:", error);
        }
        setActivePanel("transcription");
        return "Opening transcription panel, Boss.";
      }

      return "Would you like me to open the transcription panel, Boss? You can record or upload meetings for transcription.";
    }

    // SECURITY - Face Recognition
    if (lower.match(/\b(security|face recognition|face unlock|biometric|enable security|disable security)\b/)) {
      if (lower.includes("disable") || lower.includes("turn off") || lower.includes("off")) {
        try {
          const response = await fetch("/api/security", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "toggle", data: { enabled: false } }),
          });
          const data = await response.json();
          if (data.success) {
            return "Face recognition security disabled, Boss.";
          }
        } catch (error) {
          console.error("[Security] Error:", error);
        }
        return "Security system is already off, Boss.";
      }

      if (lower.includes("enable") || lower.includes("turn on") || lower.includes("on")) {
        try {
          const response = await fetch("/api/security", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "toggle", data: { enabled: true } }),
          });
          const data = await response.json();
          if (data.success) {
            return "Face recognition security enabled, Boss. The system is now monitoring.";
          }
        } catch (error) {
          console.error("[Security] Error:", error);
        }
        return "I couldn't enable security right now, Boss.";
      }

      // Check security status
      if (lower.includes("status") || lower.includes("check")) {
        try {
          const response = await fetch("/api/security?action=settings");
          const data = await response.json();
          if (data.success) {
            const status = data.settings.enabled ? "enabled" : "disabled";
            const faces = data.authorizedFacesCount || 0;
            return `Security system is ${status}, Boss. ${faces} authorized face${faces !== 1 ? 's' : ''} registered.`;
          }
        } catch (error) {
          console.error("[Security] Status error:", error);
        }
        return "Security panel is available, Boss.";
      }

      return "Face recognition security is ready. Say 'enable security' or 'disable security' to toggle, Boss.";
    }

    // ===== TIER 2 IMPLEMENTATION: NEW FEATURES =====

    // SKILL TRAINER
    if (lower.match(/\b(skill trainer|learn|learning plan|study|course|tutorial|lesson)\b/)) {
      if (lower.includes("open") || lower.includes("start") || lower.includes("create") || lower.includes("show")) {
        setActivePanel("skill-trainer");
        return "Opening Skill Trainer. Knowledge is power, Boss.";
      }
      // Create learning plan
      const learnMatch = lower.match(/(?:learn|study)\s+(.+?)(?:\s+(?:for|over)\s+(\d+)\s*(day|week|month))?/i);
      if (learnMatch) {
        const topic = learnMatch[1];
        return `Creating a learning plan for ${topic}. Let me prepare your curriculum, Boss.`;
      }
    }

    // IMAGE GENERATOR
    if (lower.match(/\b(generate image|create image|draw|visualize|show me a picture|design)\b/) ||
        lower.match(/\b(image of|picture of|logo|concept art)\b/)) {
      if (lower.includes("open") || lower.includes("show")) {
        setActivePanel("image-generator");
        return "Opening Visual Idea Generator. Time to get creative, Boss.";
      }
      // Generate from prompt
      const genMatch = lower.match(/(?:generate|create|make|draw)\s+(?:an?\s+)?(?:image|picture|logo|design)\s+(?:of\s+)?(.+)/i);
      if (genMatch) {
        const prompt = genMatch[1];
        setActivePanel("image-generator");
        return `Generating image: "${prompt}". Creating visual concepts, Boss.`;
      }
    }

    // CONTENT SUMMARIZER
    if (lower.match(/\b(summarize|summary|tl;dr|too long|key points|main points)\b/) ||
        lower.match(/\b(what did (?:this|the) (?:video|article) say)\b/)) {
      if (lower.includes("open") || lower.includes("show")) {
        setActivePanel("summarizer");
        return "Opening Content Summarizer. TL;DR generator ready, Boss.";
      }
      // Summarize YouTube
      const ytMatch = lower.match(/summarize\s+(?:this\s+)?(?:youtube\s+)?(?:video\s+)?(?:https?:\/\/\S+)?/i);
      if (ytMatch) {
        setActivePanel("summarizer");
        return "Summarizing video content. Extracting the key points, Boss.";
      }
      // Summarize article
      const articleMatch = lower.match(/summarize\s+(?:this\s+)?article[:\s]*(.+)/i);
      if (articleMatch) {
        setActivePanel("summarizer");
        return "Summarizing article. Cutting through the fluff, Boss.";
      }
    }

    // WEB SCRAPER
    if (lower.match(/\b(web scraper|scraper|scrape|extract data|web data)\b/)) {
      setActivePanel("web-scraper");
      return "Opening Web Scraper. What URL should I analyze, Boss?";
    }

    // FIRECRAWL (NEW)
    if (lower.match(/\b(firecrawl|deep scrape|deep crawl|website map|batch scrape)\b/)) {
      setActivePanel("firecrawl");
      return "Firecrawl Web Intelligence engine is ready, Boss. How can I help you extract data today?";
    }

    // NASA API
    if (lower.match(/\b(nasa|space|astronomy|mars|asteroid|neo|apod|earth from space)\b/) ||
        lower.match(/\b(picture of the day|space photo|galaxy|planet)\b/)) {
      if (lower.includes("open") || lower.includes("show") || lower.includes("explore")) {
        setActivePanel("nasa");
        return "Opening NASA Explorer. Space, the final frontier, Boss.";
      }
      // APOD
      if (lower.match(/\b(apod|astronomy picture|space picture|photo of the day)\b/)) {
        setActivePanel("nasa");
        return "Fetching Astronomy Picture of the Day. The universe awaits, Boss.";
      }
      // Mars
      if (lower.match(/\b(mars|rover|red planet)\b/)) {
        setActivePanel("nasa");
        return "Fetching Mars rover photos. Let's see what's happening on Mars, Boss.";
      }
    }

    // HUGGING FACE
    if (lower.match(/\b(hugging face|hf|ai model|sentiment|translate|classify|ner|embedding)\b/) ||
        lower.match(/\b(named entity|zero shot|text analysis)\b/)) {
      if (lower.includes("open") || lower.includes("show") || lower.includes("use")) {
        setActivePanel("huggingface");
        return "Opening Hugging Face Integration. 1000+ AI models at your disposal, Boss.";
      }
      // Quick sentiment
      const sentimentMatch = lower.match(/(?:analyze|check)\s+(?:the\s+)?sentiment(?:\s+of)?:?\s*(.+)/i);
      if (sentimentMatch) {
        return `Analyzing sentiment: "${sentimentMatch[1]}". Processing with AI models, Boss.`;
      }
      // Quick translation
      const translateMatch = lower.match(/(?:translate)\s+(.+?)\s+(?:to|in)\s+(\w+)/i);
      if (translateMatch) {
        return `Translating to ${translateMatch[2]}. Language barriers breaking down, Boss.`;
      }
    }

    // IFTTT AUTOMATION
    if (lower.match(/\b(ifttt|workflow|connect|trigger|applet)\b/) ||
        lower.match(/\b(save to notion|add to todoist|send notification|post to twitter)\b/)) {
      if (lower.includes("open") || lower.includes("show")) {
        setActivePanel("ifttt");
        return "Opening IFTTT Automation. Connecting your apps, Boss.";
      }
    }

    // BROWSER AUTOMATION
    if (lower.match(/\b(automation|browser|selenium|playwright|scrape website|automate)\b/) ||
        lower.match(/\b(fill form|book|reserve|check availability)\b/)) {
      if (lower.includes("open") || lower.includes("show")) {
        setActivePanel("browser");
        return "Opening Browser Automation. Web tasks on autopilot, Boss.";
      }
      // Search flight
      if (lower.match(/\b(search flight|find flight|check flight|book flight)\b/)) {
        setActivePanel("browser");
        return "Launching flight search automation. Finding the best deals, Boss.";
      }
      // Check price
      if (lower.match(/\b(check price|monitor price|track price)\b/)) {
        setActivePanel("browser");
        return "Starting price monitoring. I'll watch for changes, Boss.";
      }
    }

    // LOCAL LLM
    if (lower.match(/\b(local llm|ollama|offline ai|private ai|local model|gpt4all)\b/) ||
        lower.match(/\b(summarize offline|chat offline|document offline)\b/)) {
      if (lower.includes("open") || lower.includes("show")) {
        setActivePanel("local-llm");
        return "Opening Local LLM. 100% offline AI processing, Boss.";
      }
      // Query document
      const docMatch = lower.match(/(?:ask|query)\s+(?:about|regarding)\s+(.+?)\s+(?:in|from)\s+(?:my\s+)?(?:file|document)\s*(.+)?/i);
      if (docMatch) {
        setActivePanel("local-llm");
        return "Querying document with local AI. Your data stays private, Boss.";
      }
    }

    // VISION AI
    if (lower.match(/\b(vision|object detection|face recognition|ocr|text from image|analyze image|what's in this image)\b/) ||
        lower.match(/\b(scan|detect|recognize|identify)\s+(?:objects?|faces?|text)\b/)) {
      if (lower.includes("open") || lower.includes("show")) {
        setActivePanel("vision");
        return "Opening Vision AI. Computer vision activated, Boss.";
      }
      // Quick detect
      if (lower.match(/\b(what's?\s+(?:this|in|on)|identify|recognize)\b/)) {
        setActivePanel("vision");
        return "Analyzing image with computer vision. Processing visual data, Boss.";
      }
    }

    // QUICK NOTES
    // Take note - matches: note that, remember this, take a note, write down
    const noteMatch = lower.match(/(?:note\s+(?:that\s+)?|take\s+a\s+note|remember\s+this|write\s+down)[:\s]*(.+)/i);
    if (noteMatch) {
      try {
        const content = noteMatch[1];
        const response = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", content, title: "Voice Note" }),
        });
        const data = await response.json();

        if (data.success) {
          return `Note saved to ${data.filename}, Boss.`;
        }
      } catch (e) {
        console.error("Note failed:", e);
      }
      return "I couldn't save the note, Boss.";
    }

    // List notes
    if (lower.match(/list my notes|show notes|my notes/)) {
      try {
        const response = await fetch("/api/notes");
        const data = await response.json();
        if (data.notes?.length === 0) {
          return "No notes found, Boss.";
        }
        const noteList = data.notes.slice(0, 5).join(", ");
        return `You have ${data.notes.length} notes: ${noteList}, Boss.`;
      } catch {
        return "I couldn't list notes, Boss.";
      }
    }

    // TRANSLATION
    // Translate - matches: translate hello to Spanish, how do you say apple in French
    const translateMatch = lower.match(/(?:translate|how\s+(?:do\s+you\s+)?say)\s+(.+?)\s+(?:to|in)\s+(spanish|french|german|italian|portuguese|japanese|chinese|korean|russian|arabic|hindi)/i);
    if (translateMatch) {
      try {
        const text = translateMatch[1];
        const langMap: Record<string, string> = {
          spanish: "es",
          french: "fr",
          german: "de",
          italian: "it",
          portuguese: "pt",
          japanese: "ja",
          chinese: "zh",
          korean: "ko",
          russian: "ru",
          arabic: "ar",
          hindi: "hi",
        };
        const to = langMap[translateMatch[2].toLowerCase()];

        const response = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, from: "en", to }),
        });
        const data = await response.json();

        if (data.success) {
          return `"${text}" in ${translateMatch[2]} is "${data.translated}", Boss.`;
        }
      } catch (e) {
        console.error("Translation failed:", e);
      }
      return "I couldn't translate that, Boss.";
    }

    // ===== BATCH 2 FEATURES =====

    // PC STATS
    // Check PC status - matches: check my pc, how's my computer, system status, pc health
    if (lower.match(/\b(check\s+(?:my\s+)?(pc|computer)|how('s| is)\s+(?:my\s+)?(pc|computer|system)|system\s+(status|health)|pc\s+(status|health|stats))\b/)) {
      try {
        const response = await fetch("/api/system/pcstats");
        const data = await response.json();

        if (data.success && data.stats) {
          const stats = data.stats;
          let msg = "PC Status: ";
          if (stats.cpuUsage !== null) msg += `CPU ${stats.cpuUsage}%`;
          if (stats.memoryUsage !== null) msg += `, RAM ${stats.memoryUsage}%`;
          if (stats.battery !== null) msg += `, Battery ${stats.battery}%`;
          if (stats.temperature !== null) msg += `, Temp ${stats.temperature}°C`;
          msg += `, Uptime ${stats.uptime}h`;
          return `${msg}, Boss.`;
        }
      } catch (e) {
        console.error("PC stats failed:", e);
      }
      return "I couldn't check PC stats. Make sure you're on Windows, Boss.";
    }

    // Show top processes - matches: what apps are running, show processes, cpu usage
    if (lower.match(/\b(top\s+processes|running\s+apps|what.*running|show\s+processes|cpu\s+usage|memory\s+usage)\b/)) {
      try {
        const response = await fetch("/api/system/pcstats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "processes" }),
        });
        const data = await response.json();

        if (data.success && data.processes) {
          const top = data.processes.slice(0, 5).map((p: {name: string, memory: number}) =>
            `${p.name} (${p.memory}MB)`
          ).join(", ");
          return `Top processes: ${top}, Boss.`;
        }
      } catch (e) {
        console.error("Process list failed:", e);
      }
      return "I couldn't get process list, Boss.";
    }

    // BRIGHTNESS/DISPLAY CONTROL
    // Set brightness - matches: set brightness to 50, increase brightness, lower brightness
    const brightnessMatch = lower.match(/(?:set\s+)?brightness\s+(?:to\s+)?(\d+)/);
    if (brightnessMatch || lower.match(/\b(brightness\s+(up|down)|increase|decrease|dim|brighten|night\s+mode|day\s+mode)\b/)) {
      try {
        let action = "set";
        let level = brightnessMatch ? parseInt(brightnessMatch[1]) : null;

        // Only check for day/night mode if NO specific number was given
        if (!brightnessMatch) {
          if (lower.includes("up") || lower.includes("increase") || lower.includes("brighten")) {
            action = "adjust";
            level = 10; // Delta
          } else if (lower.includes("down") || lower.includes("decrease") || lower.includes("dim")) {
            action = "adjust";
            level = -10; // Delta
          } else if (lower.includes("night mode") || lower.includes("dark mode") || (lower.includes("night") && !lower.includes("brightness"))) {
            action = "nightMode";
          } else if (lower.includes("day mode") || lower.includes("daylight") || (lower.includes("day") && !lower.includes("brightness"))) {
            action = "dayMode";
          }
        }

        const body: {action: string; level?: number; direction?: string} = { action };
        if (action === "adjust") {
          body.direction = level! > 0 ? "up" : "down";
        } else if (level !== null) {
          body.level = level;
        }

        const response = await fetch("/api/system/display", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await response.json();

        if (data.success) {
          if (action === "nightMode") return "Night mode enabled. Protecting your delicate eyes from photons, Boss.";
          if (action === "dayMode") return "Day mode enabled. Blinding brightness engaged, Boss.";
          return `Brightness set to ${data.brightness}%. As if your retinas could tell the difference, Boss.`;
        }
        // API returned error
        if (data.error) {
          return `I couldn't adjust brightness. ${data.error} Try using your laptop's function keys instead, Boss.`;
        }
      } catch (e) {
        console.error("Brightness failed:", e);
      }
      return "I couldn't adjust brightness. Your monitor doesn't support software control. Use your laptop's Fn+brightness keys instead, Boss.";
    }

    // WINDOW MANAGEMENT
    // Minimize window - matches: minimize all, minimize chrome, minimize this window
    if (lower.match(/\bminimize\s+(?:all|windows?|everything|chrome|spotify|this)\b/)) {
      try {
        let processName = "";
        if (lower.includes("chrome")) processName = "chrome";
        else if (lower.includes("spotify")) processName = "spotify";
        else if (lower.includes("edge")) processName = "msedge";
        else if (lower.includes("firefox")) processName = "firefox";
        else if (lower.includes("code")) processName = "code";

        const response = await fetch("/api/system/windows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "minimize", processName }),
        });
        const data = await response.json();

        if (data.success) {
          return processName
            ? `Minimized ${processName}, Boss.`
            : "Minimized all windows, Boss.";
        }
      } catch (e) {
        console.error("Minimize failed:", e);
      }
      return "I couldn't minimize windows, Boss.";
    }

    // Maximize/restore window
    if (lower.match(/\b(maximize|restore)\s+(?:chrome|spotify|edge|firefox|window|this)\b/)) {
      try {
        let processName = "";
        if (lower.includes("chrome")) processName = "chrome";
        else if (lower.includes("spotify")) processName = "spotify";
        else if (lower.includes("edge")) processName = "msedge";
        else if (lower.includes("firefox")) processName = "firefox";
        else if (lower.includes("code")) processName = "code";

        const action = lower.includes("maximize") ? "maximize" : "restore";

        const response = await fetch("/api/system/windows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, processName }),
        });
        const data = await response.json();

        if (data.success) {
          return `${action.charAt(0).toUpperCase() + action.slice(1)}d ${processName || "window"}, Boss.`;
        }
      } catch (e) {
        console.error("Window management failed:", e);
      }
      return "I couldn't manage the window, Boss.";
    }

    // Close app/window
    if (lower.match(/\b(close|kill)\s+(?:chrome|spotify|edge|firefox|code|notepad|calculator|app)\b/)) {
      try {
        let processName = "";
        if (lower.includes("chrome")) processName = "chrome";
        else if (lower.includes("spotify")) processName = "spotify";
        else if (lower.includes("edge")) processName = "msedge";
        else if (lower.includes("firefox")) processName = "firefox";
        else if (lower.includes("code")) processName = "code";
        else if (lower.includes("notepad")) processName = "notepad";
        else if (lower.includes("calculator")) processName = "calculator";

        if (!processName) {
          return "Please specify which app to close, Boss.";
        }

        const response = await fetch("/api/system/windows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "close", processName }),
        });
        const data = await response.json();

        if (data.success) {
          return `Closed ${processName}, Boss.`;
        }
      } catch (e) {
        console.error("Close app failed:", e);
      }
      return "I couldn't close that app, Boss.";
    }

    // Focus/switch to window
    if (lower.match(/\b(switch\s+to|focus|bring\s+(?:up|to\s+front)|open)\s+(?:the\s+)?(chrome|spotify|edge|firefox|code|notepad)\b/)) {
      try {
        let processName = "";
        if (lower.includes("chrome")) processName = "chrome";
        else if (lower.includes("spotify")) processName = "spotify";
        else if (lower.includes("edge")) processName = "msedge";
        else if (lower.includes("firefox")) processName = "firefox";
        else if (lower.includes("code")) processName = "code";
        else if (lower.includes("notepad")) processName = "notepad";

        const response = await fetch("/api/system/windows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "focus", processName }),
        });
        const data = await response.json();

        if (data.success) {
          return `Switched to ${processName}, Boss.`;
        }
      } catch (e) {
        console.error("Focus window failed:", e);
      }
      return "I couldn't switch to that window, Boss.";
    }

    // Tile/Cascade windows
    if (lower.match(/\b(tile|cascade|arrange)\s+(?:windows?)\b/)) {
      try {
        const action = lower.includes("cascade") ? "cascade" : "tile";
        const response = await fetch("/api/system/windows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const data = await response.json();

        if (data.success) {
          return `${action.charAt(0).toUpperCase() + action.slice(1)}d windows, Boss.`;
        }
      } catch (e) {
        console.error("Window arrangement failed:", e);
      }
      return "I couldn't arrange windows, Boss.";
    }

    // ===== BATCH 3 FEATURES =====

    // YOUTUBE CONTROL
    // Pattern 1: "search youtube for [query]", "play youtube video [query]", "find on youtube [query]"
    // Pattern 2: "play [query] on youtube"
    let youtubeQuery: string | null = null;

    const pattern1 = lower.match(/\b(?:search\s+youtube\s+(?:for\s+)?|play\s+(?:youtube\s+)?video\s+(?:of\s+)?|find\s+(?:on\s+)?youtube)[:\s]*(.+)/i);
    const pattern2 = lower.match(/\bplay\s+(.+?)\s+on\s+youtube/i);

    if (pattern1) youtubeQuery = pattern1[1];
    else if (pattern2) youtubeQuery = pattern2[1];

    if (youtubeQuery) {
      try {
        const query = youtubeQuery;
        console.log("[YouTube] Searching for:", query);

        const response = await fetch("/api/youtube", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "search", query }),
        });

        console.log("[YouTube] Response status:", response.status);
        const data = await response.json();
        console.log("[YouTube] Response data:", data);

        if (data.success && data.videos?.length > 0) {
          const video = data.videos[0];
          console.log("[YouTube] Playing video in UI:", video.id);

          // Set the current video in the store to display in JARVIS UI
          setCurrentVideo({
            id: video.id,
            title: video.title,
            channel: video.channel,
            embedUrl: video.embedUrl,
          });

          return `Now playing "${video.title}" by ${video.channel}. Look at the video player in the interface, Boss.`;
        }
        if (data.error) {
          return `YouTube API error: ${data.error}, Boss.`;
        }
        return "No videos found for that query, Boss.";
      } catch (e) {
        console.error("[YouTube] Search failed:", e);
        return `YouTube error: ${e}, Boss.`;
      }
    }

    // Trending videos
    if (lower.match(/\b(trending\s+(?:videos?|on\s+youtube)|what's\s+trending|popular\s+videos?)\b/)) {
      try {
        const response = await fetch("/api/youtube?action=trending");
        const data = await response.json();

        if (data.success && data.videos?.length > 0) {
          const top = data.videos.slice(0, 3).map((v: {title: string, channel: string}) => `"${v.title}" by ${v.channel}`).join(", ");
          return `Top trending: ${top}, Boss.`;
        }
      } catch (e) {
        console.error("YouTube trending failed:", e);
      }
      return "I couldn't get trending videos, Boss.";
    }

    // ===== COOL FLEX FEATURES =====

    // JOKE / FORTUNE - Tell me a joke, make me laugh, fortune cookie
    if (lower.match(/\b(tell me a joke|make me laugh|got any jokes|fortune cookie|my fortune|give me wisdom|inspire me)\b/)) {
      try {
        const response = await fetch("/api/joke");
        const data = await response.json();

        if (data.success) {
          if (data.type === "joke") {
            return `${data.setup}... ${data.punchline}`;
          } else {
            return `"${data.text}" Words to live by, Boss.`;
          }
        }
      } catch {
        return "My humor circuits need recalibration, Boss.";
      }
      return "I couldn't find a joke, Boss.";
    }

    // NEWS BRIEFING - What's the news, headlines, brief me
    if (lower.match(/\b(what('s| is) the news|headlines|brief me|news update|what happened today|tech news|give me the news)\b/)) {
      try {
        const category = lower.includes("tech") ? "technology" : "general";
        const response = await fetch(`/api/news?category=${category}`);
        const data = await response.json();

        if (data.success && data.articles?.length > 0) {
          const top = data.articles.slice(0, 3).map((a: {title: string, source: string}) => `${a.title} - ${a.source}`).join(". ");
          return `Top headlines: ${top}, Boss.`;
        }
        return "I couldn't fetch the news, Boss.";
      } catch {
        return "News feed is currently unavailable, Boss.";
      }
    }

    // EMERGENCY MODE - Emergency protocol, red alert, danger
    if (lower.match(/\b(emergency protocol|red alert|danger mode|panic button|lockdown)\b/)) {
      // Create emergency visual effect
      const emergencyDiv = document.createElement("div");
      emergencyDiv.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(255, 0, 0, 0.3); z-index: 9999; pointer-events: none;
        animation: pulse 0.5s infinite alternate; border: 10px solid red;
      `;
      document.body.appendChild(emergencyDiv);

      // Remove after 3 seconds
      setTimeout(() => emergencyDiv.remove(), 3000);

      return "EMERGENCY PROTOCOL ACTIVATED. All systems on high alert, Boss.";
    }

    // FOCUS MODE - Focus mode on, work mode, productivity mode
    if (lower.match(/\b(focus mode|work mode|productivity mode|distraction free|concentration mode)\b/)) {
      try {
        // Close common distracting apps
        await fetch("/api/system/windows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "minimize" }),
        });
        return "Focus mode activated. I've minimized all windows, Boss. Time to be productive.";
      } catch {
        return "Focus mode conceptually activated, Boss. Minimize distractions manually.";
      }
    }

    // FUN COMMANDS
    // Coin flip
    if (lower.match(/\b(flip a coin|heads or tails|coin toss)\b/)) {
      const result = Math.random() > 0.5 ? "Heads" : "Tails";
      return `*Coin spins in the air*... It's ${result}, Boss!`;
    }

    // Roll dice
    if (lower.match(/\b(roll a die|roll dice|dice roll)\b/)) {
      const result = Math.floor(Math.random() * 6) + 1;
      return `*Dice rolling*... You rolled a ${result}, Boss!`;
    }

    // Random number
    if (lower.match(/\b(random number|pick a number|give me a number between)\b/)) {
      const match = text.match(/between\s+(\d+)\s+and\s+(\d+)/);
      let min = 1, max = 100;
      if (match) {
        min = parseInt(match[1]);
        max = parseInt(match[2]);
      }
      const result = Math.floor(Math.random() * (max - min + 1)) + min;
      return `Your random number between ${min} and ${max} is... ${result}, Boss!`;
    }

    // Motivation
    if (lower.match(/\b(motivate me|i need motivation|pep talk|inspire me|give me strength)\b/)) {
      const quotes = [
        "Genius is one percent inspiration and ninety-nine percent perspiration. - Thomas Edison",
        "The only way to do great work is to love what you do. - Steve Jobs",
        "Believe you can and you're halfway there. - Theodore Roosevelt",
        "Success is not final, failure is not fatal: it is the courage to continue that counts. - Churchill",
        "The future belongs to those who believe in the beauty of their dreams. - Eleanor Roosevelt",
        "Don't watch the clock; do what it does. Keep going. - Sam Levenson",
        "The best way to predict the future is to create it. - Peter Drucker",
        "You're doing great, Boss. Keep pushing forward!"
      ];
      const quote = quotes[Math.floor(Math.random() * quotes.length)];
      return `${quote}`;
    }

    // Weather check with attitude
    if (lower.match(/\b(should i bring an umbrella|is it going to rain|do i need a jacket|what should i wear today)\b/)) {
      try {
        const response = await fetch("/api/weather?city=London");
        if (!response.ok) {
          return "I can't check the weather right now, Boss. Dress for success anyway.";
        }
        const data = await response.json();
        if (data.temperature !== undefined) {
          let advice = `It's ${data.temperature}°C and ${data.description}. `;
          if (data.description.toLowerCase().includes("rain")) advice += "Definitely bring an umbrella, Boss.";
          else if (data.temperature < 10) advice += "Wear something warm, Boss.";
          else if (data.temperature > 25) advice += "Light clothing recommended, Boss.";
          else advice += "A light jacket should suffice, Boss.";
          return advice;
        }
      } catch {
        return "I can't check the weather right now, Boss. Dress for success anyway.";
      }
    }

    // ===== BADASS FEATURES =====

    // FEATURE 1: LOCK SCREEN - Lock down, secure system, lock my pc
    if (lower.match(/\b(lock\s+(?:down|my\s+pc|computer|workstation)|secure\s+(?:system|my\s+pc)|activate\s+lock)\b/)) {
      try {
        const response = await fetch("/api/system/lock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "lock" }),
        });
        const data = await response.json();
        if (data.success) {
          return "Workstation locked. Don't worry, your secrets are safe with me, Boss.";
        }
      } catch {
        return "I couldn't lock your PC. You'll have to do it manually this time, Boss.";
      }
    }

    // Sleep mode
    if (lower.match(/\b(sleep\s+(?:mode|now)|go\s+to\s+sleep|power\s+nap)\b/)) {
      // Send response BEFORE sleeping (PC can't respond after sleep)
      fetch("/api/system/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sleep" }),
      }).catch(() => {});
      return "Entering sleep mode. Sweet dreams, Boss. I'll be watching.";
    }

    // FEATURE 9: THEME SWITCHING - Change theme, dark mode, iron man theme
    const themeMatch = lower.match(/\b(?:change\s+theme\s+to|switch\s+to|activate|engage)\s+(arc-blue|crimson|stealth|quantum|dark|light|iron\s*man|batman|iron)\b/);
    if (themeMatch || lower.match(/\b(dark\s+mode|light\s+mode|stealth\s+mode|batman\s+mode|iron\s*man\s+mode)\b/)) {
      let theme: "arc-blue" | "crimson" | "stealth" | "quantum" | "batman" | "ironman" = "arc-blue";
      const themeInput = themeMatch ? themeMatch[1] : lower.includes("dark") || lower.includes("batman") ? "batman" : "arc-blue";

      if (themeInput.includes("iron") || themeInput.includes("crimson")) theme = "ironman";
      else if (themeInput.includes("batman") || themeInput.includes("dark") || themeInput.includes("stealth")) theme = "batman";
      else if (themeInput.includes("quantum")) theme = "quantum";
      else if (themeInput.includes("crimson")) theme = "crimson";
      else if (themeInput.includes("stealth")) theme = "stealth";

      // Apply theme
      document.documentElement.setAttribute("data-theme", theme);
      localStorage.setItem("jarvis-theme", theme);

      const themeResponses: Record<string, string> = {
        "arc-blue": "Theme switched to Arc Reactor Blue. Classic and reliable, Boss.",
        "ironman": "IRON MAN THEME ACTIVATED. Welcome to the Mark 85 interface, Boss.",
        "batman": "BATMAN STEALTH MODE ENGAGED. The shadows are your ally, Boss.",
        "quantum": "QUANTUM REALITY UNLOCKED. Physics has no meaning here, Boss.",
        "crimson": "Crimson mode engaged. Stylish choice, Boss.",
        "stealth": "Stealth mode active. Invisible to the naked eye, Boss."
      };

      return themeResponses[theme] || `Theme switched to ${theme}. Looking sharp, Boss.`;
    }

    // FEATURE 17: STOCK/CRYPTO PRICES - Bitcoin price, Tesla stock
    // Pattern 1: "what's the price of tesla", "check bitcoin"
    // Pattern 2: "tesla stock", "bitcoin price"
    const stockPattern1 = lower.match(/\b(?:what'?s?\s+(?:the\s+)?price\s+of|how\s+much\s+is|check|get)\s+(bitcoin|ethereum|btc|eth|tesla|apple|microsoft|nvidia|amd|dogecoin|doge|solana|cardano|sp500|nasdaq)\b/);
    const stockPattern2 = lower.match(/\b(bitcoin|ethereum|btc|eth|tesla|apple|microsoft|nvidia|amd|dogecoin|doge|solana|cardano|sp500|nasdaq)\s+(?:stock|price|crypto)\b/);
    const stockMatch = stockPattern1 || stockPattern2;

    if (stockMatch || lower.match(/\b(?:stock\s+price|crypto\s+price|market\s+price)\b/)) {
      // Extract symbol from match
      let symbol: string | null = null;
      if (stockMatch) {
        symbol = stockMatch[1];
      } else {
        // Try to find any stock/crypto name in the text
        const anyStock = lower.match(/\b(bitcoin|ethereum|btc|eth|tesla|apple|microsoft|nvidia|amd|dogecoin|doge|solana|cardano|sp500|nasdaq)\b/);
        if (anyStock) symbol = anyStock[1];
      }

      if (!symbol) {
        return "I couldn't determine which stock or cryptocurrency you're asking about. Try saying 'Tesla stock' or 'Bitcoin price'.";
      }

      try {
        const response = await fetch("/api/market", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol }),
        });
        const data = await response.json();

        if (data.success) {
          const m = data.data;
          const emoji = m.change >= 0 ? "📈" : "📉";
          const sign = m.change >= 0 ? "+" : "";
          return `${emoji} ${m.name}: $${m.price.toFixed(2)} ${m.currency} (${sign}${m.changePercent.toFixed(2)}%). Your portfolio thanks you, Boss.`;
        }
      } catch {
        return "Market data unavailable. Perhaps you should've sold yesterday, Boss.";
      }
    }

    // FEATURE 19: CODE GENERATION - Create a Python file, generate code for
    const codeGenMatch = lower.match(/\b(?:create|generate|write|make)\s+(?:a|an)?\s*(python|javascript|js|html|css|java|c\+\+|cpp)?\s*(?:code|file|script|function)\s*(?:for|to)?\s*(.+)/i) ||
                         lower.match(/\b(?:write\s+me|show\s+me)\s+(?:some)?\s*(?:code|a\s+function)\s*(?:for|to)?\s*(.+)/i);
    if (codeGenMatch) {
      const prompt = codeGenMatch[2] || codeGenMatch[1];
      const language = codeGenMatch[1] || "auto";
      try {
        const response = await fetch("/api/code/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: `${language} ${prompt}` }),
        });
        const data = await response.json();

        if (data.success) {
          // Store the generated code and open code panel
          setGeneratedCode({
            language: data.language,
            code: data.code,
            description: data.description || "",
          });
          setActivePanel("code");
          return `Generated ${data.language} code. I've opened it in the code panel for you, Boss.`;
        }
      } catch {
        return "Code generation failed. Even AI has limits, Boss.";
      }
    }

    // FEATURE 6: SCREENSHOT ANALYSIS (Enhanced)
    // Analyze screenshot - matches: analyze screen, what's on my screen, describe this, what do you see
    const screenshotMatch = lower.match(/\b(analyze\s+(?:my\s+)?screen|what('s| is)\s+on\s+my\s+screen|describe\s+(?:what\s+you\s+)?see|what\s+do\s+you\s+see|look\s+at\s+my\s+screen|check\s+my\s+screen)\b/);
    const codeAnalysisMatch = lower.match(/\b(is\s+this\s+code\s+correct|review\s+my\s+code|check\s+this\s+code|analyze\s+this\s+code)\b/);
    const translateScreenMatch = lower.match(/\b(translate\s+this\s+text|what\s+does\s+this\s+say|read\s+this)\b/);

    if (screenshotMatch || codeAnalysisMatch || translateScreenMatch) {
      try {
        // First capture screen
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const videoTrack = stream.getVideoTracks()[0];
        const ImageCaptureClass = (window as unknown as {ImageCapture: new (track: MediaStreamTrack) => {grabFrame: () => Promise<ImageBitmap>}}).ImageCapture;
        const imageCapture = new ImageCaptureClass(videoTrack);
        const bitmap = await imageCapture.grabFrame();

        // Convert to canvas and get base64
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(bitmap, 0, 0);
        const base64 = canvas.toDataURL("image/png").split(",")[1];

        // Stop stream
        stream.getTracks().forEach(track => track.stop());

        // Determine question based on match
        let question = "What's in this screenshot?";
        if (codeAnalysisMatch) question = "Review this code. Is it correct? What improvements can be made?";
        if (translateScreenMatch) question = "Translate any text in this image to English";

        // Analyze with AI
        const response = await fetch("/api/screenshot/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: base64, question }),
        });
        const data = await response.json();

        if (data.success) {
          return `I can see: ${data.analysis}, Boss.`;
        }
      } catch (e) {
        console.error("Screenshot analysis failed:", e);
      }
      return "I couldn't analyze the screen. Make sure you allow screen capture, Boss.";
    }

    // VOICE MEMOS
    // Record memo - matches: record memo, start recording, voice memo
    if (lower.match(/\b(record\s+(?:a\s+)?memo|start\s+(?:voice\s+)?recording|voice\s+memo)\b/)) {
      return "To record a memo, use the mic button and I'll save your audio, Boss.";
    }

    // List memos
    if (lower.match(/\b(list|show)\s+(?:my\s+)?(?:voice\s+)?memos?\b/)) {
      try {
        const response = await fetch("/api/voicememos");
        const data = await response.json();

        if (data.memos?.length === 0) {
          return "No voice memos found, Boss.";
        }
        const memoList = data.memos.slice(0, 5).join(", ");
        return `You have ${data.memos.length} voice memos: ${memoList}, Boss.`;
      } catch (e) {
        console.error("Voice memo list failed:", e);
      }
      return "I couldn't list voice memos, Boss.";
    }

    return null;
  };

  // Process offline commands (tasks, memories, calculations)
  const processOfflineCommand = async (text: string) => {
    const lower = text.toLowerCase();

    // Task creation
    if (lower.match(/remind me to|remember to|add task/)) {
      const match = text.match(/(?:remind me to|remember to|add task)\s+(.+)/i);
      if (match) {
        try {
          await fetch("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: match[1],
              priority: "normal",
            }),
          });
          return true;
        } catch (e) {
          console.error("Failed to create task:", e);
        }
      }
    }

    // Memory storage
    if (lower.match(/remember that|save that|note that/)) {
      const match = text.match(/(?:remember that|save that|note that)\s+(.+)/i);
      if (match) {
        try {
          await fetch("/api/memories", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: match[1],
              category: "user_fact",
              source: "conversation",
            }),
          });
          return true;
        } catch (e) {
          console.error("Failed to save memory:", e);
        }
      }
    }

    return false;
  };

  // Process command using LLM-based intent parsing
  const processFlexibleCommand = async (text: string): Promise<string | null> => {
    try {
      const intentResponse = await fetch("/api/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!intentResponse.ok) {
        console.error("[Intent] API error:", intentResponse.status);
        return null;
      }

      const parsed = await intentResponse.json();
      console.log("[Intent] Parsed:", parsed);

      switch (parsed.intent) {
        case "weather": {
          const location = (parsed.params.location as string) || "London";
          try {
            const response = await fetch(`/api/weather?city=${encodeURIComponent(location)}`);
            if (!response.ok) {
              return "I couldn't fetch the weather data, Boss.";
            }
            const data = await response.json();
            // API returns data directly without wrapper
            if (data.temperature !== undefined) {
              return `Current weather in ${data.city || location}: ${data.description}, ${data.temperature}°C. Feels like ${data.feelsLike}°C. Humidity ${data.humidity}%.`;
            }
          } catch {
            return "I couldn't fetch the weather, Boss.";
          }
          return null;
        }

        case "spotify_play": {
          try {
            const response = await fetch("/api/spotify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "play" }),
            });
            const data = await response.json();
            if (data.success) return "Playing music on Spotify, Boss.";
            return "No active Spotify device found. Please open Spotify first, Boss.";
          } catch {
            return "I couldn't connect to Spotify, Boss.";
          }
        }

        case "spotify_pause": {
          try {
            await fetch("/api/spotify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "pause" }),
            });
            return "Music paused on Spotify, Boss.";
          } catch {
            return "I couldn't pause Spotify, Boss.";
          }
        }

        case "spotify_next": {
          try {
            await fetch("/api/spotify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "next" }),
            });
            return "Skipping to the next track, Boss.";
          } catch {
            return "I couldn't skip to the next track, Boss.";
          }
        }

        case "spotify_previous": {
          try {
            await fetch("/api/spotify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "previous" }),
            });
            return "Going back to the previous track, Boss.";
          } catch {
            return "I couldn't go to the previous track, Boss.";
          }
        }

        case "spotify_search": {
          const query = parsed.params.query as string;
          if (!query) return "What song would you like me to play, Boss?";
          try {
            const response = await fetch("/api/spotify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "search", query }),
            });
            const data = await response.json();
            if (data.success && data.results?.tracks?.items?.length > 0) {
              const track = data.results.tracks.items[0];
              await fetch("/api/spotify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "play", uri: track.uri }),
              });
              return `Now playing "${track.name}" by ${track.artists.map((a: {name: string}) => a.name).join(", ")}, Boss.`;
            }
            return `I couldn't find "${query}" on Spotify, Boss.`;
          } catch {
            return "I couldn't search Spotify, Boss.";
          }
        }

        case "spotify_current": {
          try {
            const response = await fetch("/api/spotify?action=currentTrack");
            const data = await response.json();
            if (data.success && data.track?.item) {
              const { item } = data.track;
              return `Currently playing: "${item.name}" by ${item.artists.map((a: {name: string}) => a.name).join(", ")}. Marvelous choice, obviously, Boss.`;
            }
            return "Nothing is currently playing on Spotify, Boss.";
          } catch {
            return "I couldn't check what's playing, Boss.";
          }
        }

        case "youtube_search": {
          const query = parsed.params.query as string;
          if (!query) return "What video would you like me to search for, Boss?";
          try {
            const response = await fetch("/api/youtube", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "search", query }),
            });
            const data = await response.json();
            if (data.success && data.videos?.length > 0) {
              const video = data.videos[0];
              setCurrentVideo({
                id: video.id,
                title: video.title,
                channel: video.channel,
                embedUrl: video.embedUrl,
              });
              return `Now playing "${video.title}" by ${video.channel}. Look at the video player, Boss.`;
            }
            return `I couldn't find "${query}" on YouTube, Boss.`;
          } catch {
            return "I couldn't search YouTube, Boss.";
          }
        }

        case "volume_set": {
          const level = parsed.params.level;
          if (typeof level === "number") {
            try {
              await fetch("/api/system", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "setVolume", value: level }),
              });
              setVolume(level);
              return `Volume set to ${level}%, Boss.`;
            } catch {
              return "I couldn't adjust the volume, Boss.";
            }
          }
          return null;
        }

        case "volume_mute": {
          try {
            await fetch("/api/system", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "mute" }),
            });
            mute();
            return "System audio muted, Boss.";
          } catch {
            return "I couldn't mute the audio, Boss.";
          }
        }

        case "volume_unmute": {
          try {
            await fetch("/api/system", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "unmute" }),
            });
            unmute();
            return "System audio unmuted, Boss.";
          } catch {
            return "I couldn't unmute the audio, Boss.";
          }
        }

        case "battery_status": {
          const battery = await getBattery();
          if (battery) {
            const status = battery.charging ? "charging" : "on battery";
            const timeText = battery.timeRemaining && battery.timeRemaining > 0
              ? ` Approximately ${Math.round(battery.timeRemaining / 60)} minutes remaining.`
              : "";
            return `Battery is at ${Math.round(battery.level)}%, ${status}.${timeText}`;
          }
          return "I couldn't access battery information, Boss.";
        }

        case "pc_stats": {
          try {
            const response = await fetch("/api/system/pcstats");
            const data = await response.json();
            if (data.success && data.stats) {
              const stats = data.stats;
              let msg = "PC Status: ";
              if (stats.cpuUsage !== null) msg += `CPU ${stats.cpuUsage}%`;
              if (stats.memoryUsage !== null) msg += `, RAM ${stats.memoryUsage}%`;
              if (stats.battery !== null) msg += `, Battery ${stats.battery}%`;
              msg += `, Uptime ${stats.uptime}h`;
              return `${msg}, Boss.`;
            }
          } catch {
            return "I couldn't check PC stats, Boss.";
          }
          return null;
        }

        case "amazon_buy": {
          const product = parsed.params.product as string;
          if (product) {
            const searchUrl = `https://www.amazon.in/s?k=${encodeURIComponent(product)}`;
            try {
              fetch("/api/playwright", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "buy", url: searchUrl, selector: product }),
              }).catch(err => console.error("Playwright trigger failed:", err));
              return `Initializing Amazon automation for "${product}", Boss. I'll search for the best match and guide you through the process.`;
            } catch {
              return "I couldn't initialize the shopping automation, Boss.";
            }
          }
          return null;
        }

        case "flight_search": {
          const { from, to, date } = parsed.params;
          if (from && to) {
            fetch("/api/playwright", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "flights", from, to, date }),
            }).catch(e => console.error("Flight search failed:", e));
            return `Searching for flights from ${from} to ${to}, Boss. Stand by.`;
          }
          return "I need a departure and destination city to search for flights, Boss.";
        }

        case "food_order": {
          const { query, platform } = parsed.params;
          if (query) {
            fetch("/api/playwright", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "food", query, platform: platform || "zomato" }),
            }).catch(e => console.error("Food search failed:", e));
            return `Searching for "${query}" on ${platform || "Zomato"}, Boss. Getting your menu ready.`;
          }
          return "What would you like to eat, Boss?";
        }

        case "whatsapp_send": {
          const { contact, message } = parsed.params;
          if (contact) {
            fetch("/api/playwright", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "whatsapp", contact, message: message || "Hey!" }),
            }).catch(e => console.error("WhatsApp failed:", e));
            return `Opening WhatsApp to message "${contact}", Boss.`;
          }
          return "Who should I message on WhatsApp, Boss?";
        }

        case "price_compare": {
          const { product } = parsed.params;
          if (product) {
            fetch("/api/playwright", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "compare", product }),
            }).catch(e => console.error("Price compare failed:", e));
            return `Comparing prices for "${product}" across major stores, Boss.`;
          }
          return "Which product should I compare prices for, Boss?";
        }

        case "play_youtube": {
          const { query } = parsed.params;
          if (query) {
            fetch("/api/playwright", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "youtube", query }),
            }).catch(e => console.error("YouTube failed:", e));
            return `Searching for "${query}" on YouTube, Boss. Music to my ears.`;
          }
          return "What should I play on YouTube, Boss?";
        }

        case "get_directions": {
          const { from, to } = parsed.params;
          if (from && to) {
            fetch("/api/playwright", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "directions", from, to }),
            }).catch(e => console.error("Directions failed:", e));
            return `Getting directions from ${from} to ${to}, Boss. Navigating now.`;
          }
          return "I need a start and end location for directions, Boss.";
        }

        case "job_search": {
          const { query, location } = parsed.params;
          if (query) {
            fetch("/api/playwright", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "jobs", query, location: location || "India" }),
            }).catch(e => console.error("Job search failed:", e));
            return `Searching for "${query}" jobs in ${location || "India"}, Boss. Hope you get the offer.`;
          }
          return "What kind of jobs should I search for, Boss?";
        }

        case "compose_email": {
          const { to, subject, body } = parsed.params;
          if (to) {
            fetch("/api/playwright", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "email", to, subject: subject || "No Subject", body: body || "" }),
            }).catch(e => console.error("Email failed:", e));
            return `Opening Gmail to compose to ${to}, Boss. Professionalism is key.`;
          }
          return "Who are we emailing, Boss?";
        }

        case "book_movies": {
          const { query, city } = parsed.params;
          if (query) {
            fetch("/api/playwright", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "movies", query, city: city || "Mumbai" }),
            }).catch(e => console.error("Movie booking failed:", e));
            return `Finding "${query}" tickets in ${city || "Mumbai"}, Boss. Popcorn ready.`;
          }
          return "Which movie are we booking tickets for, Boss?";
        }

        case "track_package": {
          const { trackingId, courier } = parsed.params;
          if (trackingId) {
            fetch("/api/playwright", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "track", trackingId, courier: courier || "auto" }),
            }).catch(e => console.error("Tracking failed:", e));
            return `Tracking package "${trackingId}", Boss. I'll keep an eye on the courier.`;
          }
          return "What's the tracking ID, Boss?";
        }

        case "web_scrape": {
          const { url, whatToFind } = parsed.params;
          if (url) {
            fetch("/api/playwright", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "scrape", url, whatToFind: whatToFind || "general info" }),
            }).catch(e => console.error("Scrape failed:", e));
            return `Scraping "${url}" for you, Boss. Extracting the data now.`;
          }
          return "I need a URL to scrape, Boss.";
        }

        case "fill_form": {
          const { url, fields } = parsed.params;
          if (url) {
            fetch("/api/playwright", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "fill", url, fields: fields || {} }),
            }).catch(e => console.error("Form fill failed:", e));
            return `Opening ${url} to fill the form for you, Boss.`;
          }
          return "I need a URL to fill the form, Boss.";
        }

        case "search_web": {
          const query = parsed.params.query as string;
          if (query) {
            window.open(`https://google.com/search?q=${encodeURIComponent(query)}`, "_blank");
            return `Searching Google for "${query}", Boss.`;
          }
          return null;
        }

        case "calculator": {
          const expression = parsed.params.expression as string;
          const question = parsed.params.question as string;
          if (expression || question) {
            try {
              const response = await fetch("/api/calculator", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  expression,
                  natural: question || text,
                }),
              });
              const data = await response.json();
              if (data.success) {
                const formattedExpr = data.expression?.replace(/\*\*/g, "^").replace(/\*/g, "×").replace(/\//g, "÷");
                if (formattedExpr) {
                  onCalculate?.(formattedExpr, data.formatted);
                  return `${formattedExpr} = ${data.formatted}, Boss.`;
                }
                return `The answer is ${data.formatted}, Boss.`;
              }
            } catch {
              return "I couldn't calculate that, Boss.";
            }
          }
          return null;
        }

        case "note_create": {
          const content = parsed.params.content as string;
          if (content) {
            try {
              await fetch("/api/notes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "create", content, title: "Voice Note" }),
              });
              return "Note saved, Boss.";
            } catch {
              return "I couldn't save the note, Boss.";
            }
          }
          return null;
        }

        case "open_app": {
          const app = parsed.params.app as string;
          if (app) {
            const urls: Record<string, string> = {
              youtube: "https://youtube.com",
              spotify: "https://open.spotify.com",
              discord: "https://discord.com",
              chrome: "https://google.com",
              vscode: "vscode://",
              notepad: "notepad:",
              calculator: "calculator:",
              settings: "ms-settings:",
              twitter: "https://twitter.com",
              github: "https://github.com",
              gmail: "https://gmail.com",
            };
            const url = urls[app.toLowerCase()] || `https://${app}.com`;
            window.open(url, "_blank");
            return `Opening ${app}, Boss.`;
          }
          return null;
        }

        case "timer_set": {
          const duration = parsed.params.duration as string;
          const unit = parsed.params.unit as string;
          if (duration) {
            try {
              let minutes = 0;
              let seconds = 0;
              const amount = parseInt(duration, 10) || 5;

              if (unit?.startsWith("h")) minutes = amount * 60;
              else if (unit?.startsWith("m")) minutes = amount;
              else if (unit?.startsWith("s")) seconds = amount;
              else minutes = amount; // default to minutes

              await fetch("/api/timer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "create", minutes, seconds, label: `${amount} ${unit || "minutes"} timer` }),
              });
              return `Timer set for ${amount} ${unit || "minutes"}, Boss.`;
            } catch {
              return "I couldn't set the timer, Boss.";
            }
          }
          return null;
        }

        case "alarm_set": {
          const time = parsed.params.time as string;
          if (time) {
            try {
              // Set both internal and system alarm
              await Promise.all([
                // Internal JARVIS alarm
                fetch("/api/timer", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "alarm", label: time }),
                }),
                // System Windows alarm
                fetch("/api/system", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" } ,
                  body: JSON.stringify({ action: "setAlarm", time, label: `JARVIS Alarm: ${time}` }),
                }),
              ]);
              return `Alarm set for ${time}, Boss. I'll notify you both in the interface and with a system notification.`;
            } catch {
              // Still set internal alarm even if system alarm fails
              await fetch("/api/timer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "alarm", label: time }),
              });
              return `Alarm set for ${time}, Boss.`;
            }
          }
          return null;
        }

        case "translate": {
          const text = parsed.params.text as string;
          const language = parsed.params.language as string;
          if (text && language) {
            const langMap: Record<string, string> = {
              spanish: "es", french: "fr", german: "de", italian: "it",
              portuguese: "pt", japanese: "ja", chinese: "zh", korean: "ko",
              russian: "ru", arabic: "ar", hindi: "hi",
            };
            const to = langMap[language.toLowerCase()];
            if (to) {
              try {
                const response = await fetch("/api/translate", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ text, from: "en", to }),
                });
                const data = await response.json();
                if (data.success) return `"${text}" in ${language} is "${data.translated}", Boss.`;
              } catch {
                return "I couldn't translate that, Boss.";
              }
            }
          }
          return null;
        }

        case "screenshot": {
          try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            stream.getTracks().forEach(track => track.stop());
            return "Screen capture dialog opened, Boss.";
          } catch {
            return "Screen capture was cancelled, Boss.";
          }
        }

        case "system_info": {
          const browserInfo = `Browser: ${navigator.userAgent.split(")")[0]})`;
          const platform = `Platform: ${navigator.platform}`;
          const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
            ? `Memory: ${(navigator as Navigator & { deviceMemory?: number }).deviceMemory}GB`
            : "Memory: Unknown";
          const cores = `Cores: ${navigator.hardwareConcurrency || "Unknown"}`;
          return `${browserInfo}, ${platform}, ${memory}, ${cores}, Boss.`;
        }

        case "fullscreen": {
          if (document.fullscreenElement) {
            document.exitFullscreen();
            return "Exiting fullscreen, Boss.";
          } else {
            document.documentElement.requestFullscreen();
            return "Entering fullscreen mode, Boss.";
          }
        }

        case "reload": {
          window.location.reload();
          return "Reloading. Because apparently starting over is the solution, Boss.";
        }

        case "joke": {
          try {
            const response = await fetch("/api/joke");
            const data = await response.json();
            if (data.success) {
              if (data.type === "joke") return `${data.setup}... ${data.punchline}`;
              return `"${data.text}" Words to live by, Boss.`;
            }
          } catch {
            return "My humor circuits need recalibration, Boss.";
          }
          return "I couldn't find a joke, Boss.";
        }

        case "news": {
          try {
            const category = parsed.params.category === "technology" ? "technology" : "general";
            const response = await fetch(`/api/news?category=${category}`);
            const data = await response.json();
            if (data.success && data.articles?.length > 0) {
              const top = data.articles.slice(0, 3).map((a: {title: string, source: string}) => `${a.title} - ${a.source}`).join(". ");
              return `Top headlines: ${top}, Boss.`;
            }
          } catch {
            return "News feed is currently unavailable, Boss.";
          }
          return "I couldn't fetch the news, Boss.";
        }

        case "coin_flip": {
          const result = Math.random() > 0.5 ? "Heads" : "Tails";
          return `*Coin spins in the air*... It's ${result}, Boss!`;
        }

        case "dice_roll": {
          const result = Math.floor(Math.random() * 6) + 1;
          return `*Dice rolling*... You rolled a ${result}, Boss!`;
        }

        case "motivation": {
          const quotes = [
            "Genius is one percent inspiration and ninety-nine percent perspiration. - Thomas Edison",
            "The only way to do great work is to love what you do. - Steve Jobs",
            "Believe you can and you're halfway there. - Theodore Roosevelt",
            "Success is not final, failure is not fatal: it is the courage to continue that counts. - Churchill",
            "The future belongs to those who believe in the beauty of their dreams. - Eleanor Roosevelt",
            "You're doing great, Boss. Keep pushing forward!"
          ];
          const quote = quotes[Math.floor(Math.random() * quotes.length)];
          return `${quote}`;
        }

        case "emergency_mode": {
          const emergencyDiv = document.createElement("div");
          emergencyDiv.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(255, 0, 0, 0.3); z-index: 9999; pointer-events: none;
            animation: pulse 0.5s infinite alternate; border: 10px solid red;
          `;
          document.body.appendChild(emergencyDiv);
          setTimeout(() => emergencyDiv.remove(), 3000);
          return "EMERGENCY PROTOCOL ACTIVATED. All systems on high alert, Boss.";
        }

        case "focus_mode": {
          return "Focus mode activated. Time to be productive, Boss.";
        }

        case "lock_screen": {
          try {
            await fetch("/api/system/lock", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "lock" }),
            });
            return "Workstation locked. Don't worry, your secrets are safe with me, Boss.";
          } catch {
            return "I couldn't lock your PC. You'll have to do it manually this time, Boss.";
          }
        }

        case "file_search": {
          const query = parsed.params.filename as string;
          if (query) {
            try {
              const response = await fetch("/api/files/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query }),
              });
              const data = await response.json();
              if (data.success && data.results?.length > 0) {
                const file = data.results[0];
                return `Found "${file.name}" in ${file.path}. Your organizational skills continue to amaze, Boss.`;
              }
              return `I couldn't find "${query}". Perhaps try cleaning your desktop, Boss.`;
            } catch {
              return "File search failed. Your files remain mysteriously lost, Boss.";
            }
          }
          return null;
        }

        case "theme_switch": {
          const theme = parsed.params.theme as string;
          let themeName: "arc-blue" | "crimson" | "stealth" | "quantum" = "arc-blue";
          if (theme?.includes("crimson") || theme?.includes("iron")) themeName = "crimson";
          else if (theme?.includes("stealth") || theme?.includes("dark") || theme?.includes("batman")) themeName = "stealth";
          else if (theme?.includes("quantum")) themeName = "quantum";

          if (typeof window !== "undefined") {
            document.documentElement.setAttribute("data-theme", themeName);
          }
          const themeNames = { "arc-blue": "Arc Reactor Blue", "crimson": "Iron Man Crimson", "stealth": "Batman Stealth", "quantum": "Quantum Reality" };
          return `Theme switched to ${themeNames[themeName]}. Looking sharp, Boss.`;
        }

        case "stock_price": {
          const symbol = parsed.params.symbol as string;
          if (symbol) {
            try {
              const response = await fetch("/api/market", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ symbol }),
              });
              const data = await response.json();
              if (data.success) {
                const m = data.data;
                const emoji = m.change >= 0 ? "📈" : "📉";
                const sign = m.change >= 0 ? "+" : "";
                return `${emoji} ${m.name}: $${m.price.toFixed(2)} ${m.currency} (${sign}${m.changePercent.toFixed(2)}%). Your portfolio thanks you, Boss.`;
              }
            } catch {
              return "Market data unavailable. Perhaps you should've sold yesterday, Boss.";
            }
          }
          return null;
        }

        case "code_generate": {
          const prompt = parsed.params.prompt as string;
          if (prompt) {
            try {
              const response = await fetch("/api/code/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt }),
              });
              const data = await response.json();
              if (data.success) {
                setGeneratedCode({
                  language: data.language,
                  code: data.code,
                  description: data.description || "",
                });
                setActivePanel("code");
                return `Generated ${data.language} code. I've opened it in the code panel for you, Boss.`;
              }
            } catch {
              return "Code generation failed. Even AI has limits, Boss.";
            }
          }
          return null;
        }

        case "weather": {
          const city = parsed.params?.location || "London";
          try {
            const response = await fetch(`/api/weather?city=${encodeURIComponent(city)}`);
            if (!response.ok) {
              return "I couldn't fetch the weather data, Boss.";
            }
            const data = await response.json();
            if (data.temperature !== undefined) {
              return `Current weather in ${data.city || city}: ${data.description}, ${data.temperature}°C. Feels like ${data.feelsLike}°C. Humidity ${data.humidity}%.`;
            }
          } catch {
            return "I couldn't fetch the weather, Boss.";
          }
          return null;
        }

        case "spotify_control": {
          onOpenSpotify?.();
          return "Opening Spotify Control, Boss.";
        }

        case "news_briefing": {
          onOpenNews?.();
          return "Opening News Briefing, Boss.";
        }

        case "calendar_view": {
          onOpenCalendar?.();
          return "Opening Calendar, Boss.";
        }

        default:
          // For chat and unknown intents, return null to let Claude handle it
          return null;
      }
    } catch (error) {
      console.error("[FlexibleCommand] Error:", error);
      return null;
    }
  };

  // Handle voice toggle - manual mic activation
  const handleVoiceToggle = () => {
    console.log("[CommandBar] Mic button clicked, current state:", state);
    if (state === "listening") {
      // Stop listening - go back to idle
      stopListening();
      setState("idle");
    } else {
      // Start listening manually - this activates mic without wake word
      // Also stop any ongoing speech
      console.log("[CommandBar] Manually activating listening mode");
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      stopSpeaking();
      setInput("");
      hasSpokenRef.current = false; // Reset so we get "Yes, Boss?"
      setState("listening");
    }
  };

  // Build context for JARVIS
  const buildContext = useCallback((): JARVISContext => {
    return {
      userName,
      currentTime: new Date().toLocaleString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      memories: memories.slice(0, 5).map((m) => m.content),
      tasks: tasks.filter((t) => !t.completed).slice(0, 5).map((t) => t.title),
      recentMessages: messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };
  }, [userName, memories, tasks, messages]);

  // Send message to Claude API
  const sendToClaude = async (userMessage: string) => {
    try {
      setState("thinking");
      setStreamingContent("");

      const context = buildContext();
      const systemPrompt = buildSystemPrompt(context);

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, { role: "user", content: userMessage }],
          systemPrompt,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("API error:", errorData);
        throw new Error(errorData.error || "Failed to get response");
      }

      // Check if this is a JSON response (offline mode or mock)
      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        const data = await response.json();
        if (data.content) {
          // Offline/mock response
          addMessage({
            role: "assistant",
            content: data.content,
          });
          speak(data.content);
          setTimeout(() => setState("idle"), 3000);
          return;
        } else if (data.error) {
          // API error - fall back to offline message
          console.error("API returned error:", data.error);
          const fallbackMsg = "I'm having trouble connecting, Boss. Let me answer in offline mode.";
          addMessage({
            role: "assistant",
            content: fallbackMsg,
          });
          speak(fallbackMsg);
          setTimeout(() => setState("idle"), 3000);
          return;
        }
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullResponse = "";
      let buffer = "";

      setState("speaking");

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;

              try {
                const parsed = JSON.parse(data);
                
                // OpenAI / DeepSeek / NVIDIA NIM format
                if (parsed.choices?.[0]?.delta?.content) {
                  fullResponse += parsed.choices[0].delta.content;
                  setStreamingContent(fullResponse);
                }
                // Claude format: content_block_delta
                else if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                  fullResponse += parsed.delta.text;
                  setStreamingContent(fullResponse);
                }
                // Claude alternative format
                else if (parsed.type === "message_delta" && parsed.delta?.content) {
                  fullResponse += parsed.delta.content;
                  setStreamingContent(fullResponse);
                }
              } catch {
                // Ignore parsing errors for incomplete chunks
              }
            }
          }
        }
      }

      // Add complete message
      if (fullResponse) {
        addMessage({
          role: "assistant",
          content: fullResponse,
        });

        // Speak the response
        speak(fullResponse);
        setTimeout(() => setState("idle"), Math.max(3000, fullResponse.length * 50));
      } else {
        // Fallback if no response
        addMessage({
          role: "assistant",
          content: "I received your message, Boss. How can I assist you today?",
        });
        setState("idle");
      }
    } catch (error) {
      console.error("Error sending to Claude:", error);
      addMessage({
        role: "assistant",
        content: "I'm afraid that didn't work, Boss. The AI service may be unavailable. Please try again.",
      });
      setState("idle");
    }
  };

  const handleSubmit = async (text: string = input) => {
    if (!text.trim() || isStreaming) return;

    // Don't stop recognition - let it keep running for wake word detection
    // The mic should stay ON always

    // Clear input immediately
    setInput("");

    // Add user message
    addMessage({
      role: "user",
      content: text,
    });

    // First check for system commands (volume, battery, clipboard, etc.)
    const systemResponse = await processSystemCommand(text);
    if (systemResponse) {
      addMessage({
        role: "assistant",
        content: systemResponse,
      });
      speak(systemResponse);
      return;
    }

    // Try LLM-based flexible intent parsing for natural language commands
    const flexibleResponse = await processFlexibleCommand(text);
    if (flexibleResponse) {
      addMessage({
        role: "assistant",
        content: flexibleResponse,
      });
      speak(flexibleResponse);
      return;
    }

    // Process offline commands (tasks, memories)
    await processOfflineCommand(text);

    await sendToClaude(text);
  };

  // (handleVoiceToggle is defined above)

  // Morning briefing trigger (available for future use)
  const _triggerMorningBriefing = useCallback(() => {
    const context = buildContext();
    const briefing = buildMorningBriefing(context);
    addMessage({
      role: "assistant",
      content: briefing,
    });
    speak(briefing);
    setTimeout(() => setState("idle"), 5000);
  }, [buildContext, addMessage, speak, setState]);

  return (
    <motion.div
      className="fixed bottom-0 left-0 right-0 z-50 px-6 py-4"
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, delay: 5, ease: "easeOut" }}
    >
      <div className="max-w-4xl mx-auto">
        {/* Voice Visualizer */}
        <div className="mb-2">
          <VoiceVisualizer barCount={32} />
        </div>

        <div className="holographic-panel flex items-center gap-3 px-4 py-3">
          {/* Button group - mic and stop buttons side by side with proper spacing */}
          <div className="flex items-center gap-2">
            {/* Stop Speaking button - show when JARVIS is speaking OR thinking */}
            <AnimatePresence mode="wait">
              {(state === "speaking" || state === "thinking") && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  onClick={(e) => {
                    // Ripple effect
                    const btn = e.currentTarget as HTMLButtonElement;
                    createRipple(e, btn, 'rgba(255, 100, 100, 0.4)');
                    console.log("[Button] Stop clicked - forcing speech stop");
                    // Directly cancel speech synthesis
                    if (typeof window !== "undefined" && window.speechSynthesis) {
                      window.speechSynthesis.cancel();
                    }
                    stopSpeaking();
                    setState("idle");
                  }}
                  className="p-3 rounded-full bg-accent-red hover:bg-accent-red/80 animate-pulse flex-shrink-0 relative overflow-hidden"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  title="Stop JARVIS (Space bar or Escape)"
                >
                  <VolumeX className="w-5 h-5 text-white" />
                </motion.button>
              )}
            </AnimatePresence>

            {/* Voice button - shows send icon when listening with text */}
            {/* This button is ALWAYS clickable to manually activate mic */}
            <button
              ref={voiceBtnRef}
              onClick={(e) => {
                createRipple(e, voiceBtnRef.current!, 'rgba(0, 212, 255, 0.4)');
                handleVoiceToggle();
              }}
              className={`p-3 rounded-full transition-colors flex-shrink-0 relative overflow-hidden ${
                isListening
                  ? input.trim()
                    ? "bg-accent-green hover:bg-accent-green/80"
                    : "bg-accent-red animate-pulse"
                  : "bg-panel-glass hover:bg-panel-border"
              }`}
              disabled={!voiceSupported}
              title={
                isListening
                  ? input.trim()
                    ? "Send voice command"
                    : "Stop listening"
                  : "Start voice input (or say 'Hey JARVIS')"
              }
            >
              {isListening ? (
                input.trim() ? (
                  <Send className="w-5 h-5 text-white" />
                ) : (
                  <Square className="w-5 h-5 text-white" />
                )
              ) : (
                <Mic className="w-5 h-5 text-reactor-core" />
              )}
            </button>
          </div>

          {/* Text input */}
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={
                isListening
                  ? "Listening..."
                  : "Say 'Hey JARVIS' or type a command..."
              }
              className="w-full bg-transparent border-none outline-none font-rajdhani text-text-primary placeholder:text-text-secondary/50"
              disabled={isListening}
            />

            {/* Listening indicator */}
            <AnimatePresence>
              {isListening && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex items-center"
                >
                  <div className="flex gap-1">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <motion.div
                        key={i}
                        className="w-1 bg-accent-green rounded-full"
                        animate={{
                          height: [4, 16, 4],
                        }}
                        transition={{
                          duration: 0.5,
                          delay: i * 0.1,
                          repeat: Infinity,
                          ease: "easeInOut",
                        }}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Send button */}
          <button
            ref={sendBtnRef}
            onClick={(e) => {
              createRipple(e, sendBtnRef.current!, 'rgba(0, 212, 255, 0.4)');
              handleSubmit();
            }}
            disabled={!input.trim() || isListening}
            className="p-3 rounded-full bg-panel-glass hover:bg-panel-border disabled:opacity-30 disabled:cursor-not-allowed transition-colors relative overflow-hidden"
          >
            <Send className="w-5 h-5 text-reactor-core" />
          </button>

          {/* Screen Capture button */}
          <button
            onClick={(e) => {
              createRipple(e, e.currentTarget, 'rgba(0, 212, 255, 0.4)');
              captureScreenshot();
            }}
            disabled={isCapturing}
            className="p-3 rounded-full bg-panel-glass hover:bg-panel-border disabled:opacity-30 transition-colors relative overflow-hidden"
            title="Take screenshot (copies to clipboard)"
          >
            {isCapturing ? (
              <div className="w-5 h-5 border-2 border-reactor-core border-t-transparent rounded-full animate-spin" />
            ) : (
              <Camera className="w-5 h-5 text-reactor-core" />
            )}
          </button>
        </div>

        {/* Status indicator */}
        <div className="mt-2 flex justify-center items-center gap-2">
          <span className={`text-xs font-rajdhani font-bold ${
            state === "speaking" ? "text-accent-red animate-pulse" :
            state === "listening" ? "text-accent-green" :
            state === "thinking" ? "text-reactor-core animate-pulse" :
            "text-text-secondary/50"
          }`}>
            {state === "idle" && "JARVIS Ready"}
            {state === "listening" && "● Listening"}
            {state === "thinking" && "◉ Thinking..."}
            {state === "speaking" && "◉ Speaking... (Space to stop)"}
          </span>
        </div>

        {/* Quick commands hint */}
        <div className="mt-1 flex justify-center gap-4 text-xs text-text-secondary/50 font-rajdhani">
          <span>&quot;Hey JARVIS&quot; to wake</span>
          <span>•</span>
          <span>Ctrl+Space to focus</span>
          <span>•</span>
          <span>Escape to cancel</span>
          <span>•</span>
          <span>Click camera for screenshot</span>
        </div>
      </div>

      {/* Screen Capture Modal */}
      <AnimatePresence>
        {showCaptureModal && capturedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => setShowCaptureModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="holographic-panel p-4 max-w-4xl w-full max-h-[80vh] overflow-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Monitor className="w-5 h-5 text-reactor-core" />
                  <span className="font-orbitron text-reactor-core font-bold">SCREENSHOT CAPTURED</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={downloadScreenshot}
                    className="px-4 py-2 bg-reactor-core/20 hover:bg-reactor-core/40 rounded-lg font-rajdhani text-reactor-core transition-colors"
                  >
                    Download
                  </button>
                  <button
                    onClick={() => setShowCaptureModal(false)}
                    className="px-4 py-2 bg-accent-red/20 hover:bg-accent-red/40 rounded-lg font-rajdhani text-accent-red transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
              <img
                src={capturedImage}
                alt="Screenshot"
                className="w-full h-auto rounded-lg border border-panel-border"
              />
              <p className="mt-3 text-center text-xs text-text-secondary/50">
                Image copied to clipboard. Download or close to continue.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
