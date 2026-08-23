import { useEffect, useRef } from "react";
import { useJarvisStore } from "@/store/jarvis.store";
import { useTextToSpeech } from "./useVoice";

const SENTINEL_INTERVAL = 45000; // 45 seconds between passive checks
const MIN_STABLE_TIME = 5000; // Wait 5 seconds after speaking/active to check

export function useJarvisSentinel() {
  const { sentinelActive, isMuted, state } = useJarvisStore();
  const { speak } = useTextToSpeech();
  const lastCheckRef = useRef<number>(0);
  const isCheckingRef = useRef(false);

  useEffect(() => {
    if (!sentinelActive || state === "thinking") return;

    const runSentinelCheck = async () => {
      // Don't check if we're already checking or if JARVIS is busy
      if (isCheckingRef.current || state === "speaking") return;

      const now = Date.now();
      if (now - lastCheckRef.current < SENTINEL_INTERVAL) return;

      console.log("[Sentinel] Initiating passive observation...");
      isCheckingRef.current = true;
      lastCheckRef.current = now;

      try {
        // 1. Capture screen
        const captureRes = await fetch("/api/screenshot/capture");
        const captureData = await captureRes.json();

        if (!captureData.success) {
          console.error("[Sentinel] Capture failed:", captureData.error);
          isCheckingRef.current = false;
          return;
        }

        // 2. Analyze screen
        const analyzeRes = await fetch("/api/sentinel/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: captureData.image }),
        });
        const analyzeData = await analyzeRes.json();

        // 3. Proactively comment and trigger actions if noteworthy
        if (analyzeData.success && analyzeData.proactive) {
          // Store active suggestion in Zustand store if action details are present
          if (analyzeData.action) {
            const suggestionId = Math.random().toString(36).substring(7);
            const suggestion = {
              id: suggestionId,
              type: analyzeData.action.type,
              title: analyzeData.action.title,
              details: analyzeData.action.details,
              comment: analyzeData.comment,
              metadata: analyzeData.action.metadata || {},
            };
            useJarvisStore.getState().setActiveSuggestion(suggestion);

            // Send Telegram push notification with interactive inline buttons
            try {
              let text = `⚡ <b>Jarvis Sentinel Suggestion</b>\n\n${analyzeData.comment || ""}\n\n<b>Title:</b> ${suggestion.title}\n<b>Details:</b> ${suggestion.details}`;
              let buttons: any[] = [];
              if (suggestion.type === "task") {
                buttons = [
                  [
                    { text: "💼 Add Task", callback_data: `/task ${suggestion.title}` },
                    { text: "❌ Ignore", callback_data: "ignore_suggestion" }
                  ]
                ];
              } else if (suggestion.type === "reminder") {
                buttons = [
                  [
                    { text: "⏰ Set Reminder", callback_data: `/remind tomorrow ${suggestion.title}` },
                    { text: "❌ Ignore", callback_data: "ignore_suggestion" }
                  ]
                ];
              } else if (suggestion.type === "security_risk") {
                text = `⚠️ <b>SECURITY RISK ALERT</b> ⚠️\n\n${analyzeData.comment || ""}\n\n<b>Risk:</b> ${suggestion.title}\n<b>Resolution:</b> ${suggestion.details}`;
                buttons = [
                  [
                    { text: "🔒 Lock Laptop", callback_data: "/lock" },
                    { text: "❌ Ignore", callback_data: "ignore_suggestion" }
                  ]
                ];
              } else if (suggestion.type === "debug" && suggestion.metadata?.command) {
                text += `\n\n<b>Suggested Command:</b> <code>${suggestion.metadata.command}</code>`;
                buttons = [
                  [
                    { text: "❌ Dismiss", callback_data: "ignore_suggestion" }
                  ]
                ];
              } else {
                buttons = [
                  [
                    { text: "❌ Dismiss", callback_data: "ignore_suggestion" }
                  ]
                ];
              }

              await fetch("/api/telegram/notify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  text,
                  buttons,
                  parseMode: "HTML"
                }),
              });
            } catch (notifyErr) {
              console.error("[Sentinel] Failed to send Telegram notification:", notifyErr);
            }
          }

          if (analyzeData.comment) {
            console.log("[Sentinel] Proactive comment:", analyzeData.comment);
            
            // Only speak if not muted
            if (!isMuted) {
              speak(analyzeData.comment);
            }
          }
        } else {
          console.log("[Sentinel] Nothing noteworthy observed.");
        }
      } catch (error) {
        console.error("[Sentinel] Error during check:", error);
      } finally {
        isCheckingRef.current = false;
      }
    };

    const interval = setInterval(runSentinelCheck, 10000); // Check every 10s if it's time
    return () => clearInterval(interval);
  }, [sentinelActive, isMuted, state, speak]);
}
