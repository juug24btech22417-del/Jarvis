import { NextResponse } from "next/server";
import si from "systeminformation";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { parseCommand, JARVISContext, buildSystemPrompt, parseIntentWithLLM, PERSONALITY_WRAPPER_PROMPT } from "@/lib/jarvis/personality";

const execAsync = promisify(exec);
import { retrieveRelevantMemories, formatMemoryContextAsPrompt } from "@/lib/memory/retriever";
import { extractAndStoreMemories } from "@/lib/memory/extractor";
import { bumpUsage } from "@/lib/memory/graph";
import { recordEvent } from "@/lib/memory/patterns";

// Use environment variable or default to port 3000 for the API base URL
const API_BASE = process.env.INTERNAL_API_URL || 'http://localhost:3000';

// ─── Timeout-aware fetch wrapper ───────────────────────────────────
// Prevents the app from hanging when external APIs are down/slow
function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Two-Stage Response Pipeline: Transform factual responses into Sassy Butler persona
// Uses a SHORT 3-second timeout so offline responses are never delayed
async function applyPersonalityWrapper(factualResponse: string, apiKey: string): Promise<string> {
  // Skip wrapper entirely if no API key
  if (!apiKey || apiKey.trim() === "" || apiKey === "your-api-key-here") {
    return factualResponse;
  }
  try {
    const response = await fetchWithTimeout("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-ai/deepseek-v4-flash",
        messages: [
          { role: "system", content: PERSONALITY_WRAPPER_PROMPT },
          { role: "user", content: factualResponse },
        ],
        temperature: 0.75,
        max_tokens: 512,
      }),
    }, 1500); // 1.5-second timeout — wrapper is decorative polish, must never dominate latency

    if (response.ok) {
      const data = await response.json();
      const transformed = data.choices?.[0]?.message?.content?.trim();
      if (transformed) return transformed;
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      console.warn("[Chat] Personality wrapper timed out (3s) — returning raw response");
    } else {
      console.error("Personality wrapper failed:", error);
    }
  }
  return factualResponse;
}

// Try OpenRouter as a fallback when NVIDIA is rate-limited / slow / broken.
// Races all free models in PARALLEL — first successful response wins.
// This avoids the old sequential approach where a slow model blocked 10s
// before we could try the next one.
//
// Last refreshed Aug 2026: several free-tier slugs from earlier in the
// year (meta/llama-3.1-8b-instruct, gemma, mistral-small, older nemotron
// variants) were sunset or moved behind paid plans. The list below is
// restricted to slugs OpenRouter currently advertises as free; update
// when the catalogue shifts again.
const OPENROUTER_FALLBACK_MODELS = [
  "nvidia/nemotron-3.5-lightning:free",
  "cohere/north-mini-code:free",
  "poolside/laguna-s-2.1:free",
  "poolside/laguna-xs-2.1:free",
  "inclusionai/ling-3.0-tiny:free",
];

async function tryOneOpenRouterModel(
  model: string,
  orMessages: Array<{ role: string; content: string }>,
  apiKey: string
): Promise<string> {
  // Throws on failure so Promise.any() can skip to the next winner.
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 10000);
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "JARVIS AI Assistant",
      },
      body: JSON.stringify({ model, messages: orMessages, max_tokens: 768, temperature: 0.75 }),
      signal: c.signal,
    });
  } finally {
    clearTimeout(t);
  }
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${errText.slice(0, 80)}`);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("empty content");
  return content;
}

async function tryOpenRouterFallback(
  messages: any[],
  systemPrompt: string,
  apiKey: string | undefined
): Promise<NextResponse | null> {
  if (!apiKey || apiKey.trim() === "" || apiKey === "your-api-key-here") {
    return null;
  }

  const orMessages: Array<{ role: string; content: string }> = [];
  const trimmedSystem = (systemPrompt ?? "").trim();
  if (trimmedSystem) orMessages.push({ role: "system", content: trimmedSystem });
  for (const m of messages) {
    if (typeof m?.content === "string") orMessages.push({ role: m.role, content: m.content });
  }

  try {
    // Race all models in parallel — fastest successful response wins.
    const content = await Promise.any(
      OPENROUTER_FALLBACK_MODELS.map(model =>
        tryOneOpenRouterModel(model, orMessages, apiKey)
          .then(c => { console.log(`[OpenRouter fallback] Won race via ${model}`); return c; })
          .catch(e => { console.warn(`[OpenRouter fallback] ${model} failed:`, e?.message); throw e; })
      )
    );
    return NextResponse.json({ content, fallback: "openrouter" });
  } catch {
    // AggregateError — all models failed.
    console.warn("[OpenRouter fallback] All models failed");
    return null;
  }
}

// Try Groq as a third fallback after NVIDIA and OpenRouter.
// Groq is fast, has a generous free tier, and uses an OpenAI-compatible API.
// Models rotate — keep a small chain so a single rate-limit doesn't kill us.
// https://console.groq.com — free API key, no credit card.
const GROQ_FALLBACK_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "gemma2-9b-it",
  "mixtral-8x7b-32768",
];

async function tryGroqFallback(
  messages: any[],
  systemPrompt: string,
  apiKey: string | undefined
): Promise<NextResponse | null> {
  if (!apiKey || apiKey.trim() === "" || apiKey === "your-api-key-here") {
    return null;
  }
  for (const model of GROQ_FALLBACK_MODELS) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 10000);
      // Groq rejects messages with role:system when content is empty —
      // its validator complains "messages.0.content: property is
      // missing" even though OpenAI accepts the same payload. Build
      // the messages array first; only prepend a system message if a
      // non-empty systemPrompt was actually supplied.
      const groqMessages: Array<{ role: string; content: string }> = [];
      const trimmedSystem = (systemPrompt ?? "").trim();
      if (trimmedSystem) {
        groqMessages.push({ role: "system", content: trimmedSystem });
      }
      for (const m of messages) {
        if (typeof m?.content === "string") {
          groqMessages.push({ role: m.role, content: m.content });
        }
      }

      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: groqMessages,
          max_tokens: 768,
          temperature: 0.75,
        }),
        signal: c.signal,
      });
      clearTimeout(t);

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        console.warn(`[Groq fallback] ${model} → HTTP ${response.status}: ${errText.slice(0, 120)}`);
        if (response.status === 429) {
          // Rate-limited — try the next model in our chain.
          continue;
        }
        // Bad model, auth error, or server issue — bail out, the chain is broken.
        return null;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) {
        console.warn(`[Groq fallback] ${model} returned empty content`);
        continue;
      }

      console.log(`[Groq fallback] Served response via ${model}`);
      return NextResponse.json({ content, fallback: "groq", model });
    } catch (e: any) {
      console.warn(`[Groq fallback] ${model} fetch failed:`, e?.name || e?.message);
      continue;
    }
  }
  return null;
}

async function getSystemStatus() {
  try {
    const [cpu, temp, mem, battery, fsSize] = await Promise.all([
      si.currentLoad().catch(() => ({ currentLoad: 0 })),
      si.cpuTemperature().catch(() => ({ main: null })),
      si.mem().catch(() => ({ total: 16 * 1024 * 1024 * 1024, active: 8 * 1024 * 1024 * 1024 })),
      si.battery().catch(() => ({ hasBattery: false, percent: 0, isCharging: false, acConnected: false })),
      si.fsSize().catch(() => [])
    ]);

    const cpuLoad = Math.round(cpu.currentLoad);
    const cpuTemp = temp.main ? `${Math.round(temp.main)}°C` : "45°C";

    const memUsedGB = Math.round(mem.active / (1024 * 1024 * 1024) * 10) / 10;
    const memTotalGB = Math.round(mem.total / (1024 * 1024 * 1024) * 10) / 10;
    const memPercent = Math.round((mem.active / mem.total) * 100);

    let storageInfo = "N/A";
    if (fsSize && fsSize.length > 0) {
      const mainDisk = fsSize.find(d => d.mount === 'C:') || fsSize[0];
      const diskUsedGB = Math.round(mainDisk.used / (1024 * 1024 * 1024));
      const diskSizeGB = Math.round(mainDisk.size / (1024 * 1024 * 1024));
      const diskPercent = Math.round(mainDisk.use);
      storageInfo = `${diskUsedGB} GB / ${diskSizeGB} GB (${diskPercent}% used)`;
    }

    let batteryInfo = "No battery detected (Desktop/AC)";
    if (battery.hasBattery) {
      const status = battery.isCharging ? "Charging" : (battery.acConnected ? "Plugged in" : "Discharging");
      batteryInfo = `${battery.percent}% (${status})`;
    }

    let internetStatus = "Offline";
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      const res = await fetch("https://clients3.google.com/generate_204", { signal: controller.signal });
      if (res.ok) {
        internetStatus = "Online";
      }
      clearTimeout(timeout);
    } catch {
      internetStatus = "Offline";
    }

    return {
      cpuLoad,
      cpuTemp,
      memory: `${memUsedGB} GB / ${memTotalGB} GB (${memPercent}%)`,
      storage: storageInfo,
      battery: batteryInfo,
      internet: internetStatus,
    };
  } catch (error) {
    console.error("Error gathering system status:", error);
    return null;
  }
}

// Generate offline response based on user input
function generateOfflineResponse(lastMessage: string, reason: "no_llm" | "rate_limited" = "no_llm", stats?: any): string {
  const rateLimitedNote =
    reason === "rate_limited"
      ? " Every free OpenRouter model I tried is rate-limited right now — give it a minute and try again."
      : "";
  // Greetings
  if (lastMessage.includes("hello") || lastMessage.includes("hi") || lastMessage.includes("hey")) {
    const hour = new Date().getHours();
    const greeting = hour <<  12 ? "morning" : hour <<  18 ? "afternoon" : "evening";
    return `Good ${greeting}, Boss. JARVIS is online but my language models are temporarily unavailable.${rateLimitedNote} In the meantime I can still help with tasks, reminders, calculations, and time queries.`;
  }

  // Tasks
  if (lastMessage.match(/add task|create task|remind me to|remember to/)) {
    const taskMatch = lastMessage.match(/(?:remind me to|remember to|add task|create task)\s+(.+)/i);
    if (taskMatch) {
      return `Done, Boss. I've noted the task: "${taskMatch[1]}". It will be added to your task list when the database is connected.`;
    }
    return "I can add tasks in offline mode. What would you like me to remind you about?";
  }

  // List tasks
  if (lastMessage.match(/what('s| are) my tasks|show tasks|list tasks|my tasks/)) {
    return "I'm checking your task list. In offline mode, tasks are stored locally. You can view them in the Task Manager panel on the right side of the screen.";
  }

  // Time/Date - more flexible patterns
  if (lastMessage.match(/what'?s?\s*time|current\s*time|time\s*is\s*it|tell\s*me\s*the\s*time|what\s*time\s+is\s+it/)) {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    return `The current time is ${timeString}, Boss.`;
  }
  if (lastMessage.match(/what'?s?\s*(today'?s?\s*)?date|today|what\s*day|current\s*date/)) {
    const now = new Date();
    return `Today is ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, Boss.`;
  }

  // Weather - no API key
  if (lastMessage.includes("weather") || lastMessage.includes("temperature")) {
    return "I'm unable to fetch live weather data in offline mode, Boss. To enable weather updates, please connect to the internet and add an OpenWeatherMap API key.";
  }

  // Calculations
  if (lastMessage.match(/calculate|compute|what is [0-9]|\d+\s*[-+*/]\s*\d+/)) {
    try {
      const mathMatch = lastMessage.match(/([\d\s\+\-\*\/\(\)\.]+)/);
      if (mathMatch) {
        const expression = mathMatch[0].replace(/\s+/g, '');
        const result = Function('"use strict"; return (' + expression + ')')();
        return `Done, Boss. The calculation yields ${result}.`;
      }
      return "I can perform calculations in offline mode. What would you like me to compute?";
    } catch {
      return "I'm having trouble with that calculation, Boss. Could you rephrase it?";
    }
  }

  // Memory storage
  if (lastMessage.match(/remember that|save that|note that|don't forget/)) {
    const memoryMatch = lastMessage.match(/(?:remember that|save that|note that|don't forget)\s+(.+)/i);
    if (memoryMatch) {
      return `Noted, Boss. I'll remember: "${memoryMatch[1]}". This will be stored in your memory bank.`;
    }
    return "I can store memories for you. What would you like me to remember?";
  }

  // Recall memories
  if (lastMessage.match(/what did i tell you|what do you remember|my memories|recall/)) {
    return "I can recall your stored memories in offline mode. Check the Memory Bank panel on the left side to see what I've saved.";
  }

  // Status check
  if (lastMessage.match(/status|how are you|system status|diagnostics|system health/)) {
    if (stats) {
      return `All systems operational, Boss. Here are the diagnostics:\n\n` +
             `💻 CPU Load: ${stats.cpuLoad}%\n` +
             `🌡️ CPU Temp: ${stats.cpuTemp}\n` +
             `💾 RAM Usage: ${stats.memory}\n` +
             `💿 Disk Space: ${stats.storage}\n` +
             `🔋 Battery: ${stats.battery}\n` +
             `🌐 Internet: ${stats.internet}\n\n` +
             `Ready for your commands.`;
    }
    return "All systems operational, Boss. Running in offline mode. Core functions active: task management, memory storage, calculations, timekeeping. Ready for your commands.";
  }

  if (lastMessage.match(/battery/)) {
    if (stats) {
      return `Battery level is at ${stats.battery}, Boss.`;
    }
  }

  if (lastMessage.match(/cpu/)) {
    if (stats) {
      return `CPU load is currently ${stats.cpuLoad}% with temperature at ${stats.cpuTemp}, Boss.`;
    }
  }

  if (lastMessage.match(/ram|memory/)) {
    if (stats) {
      return `RAM Usage is currently ${stats.memory}, Boss.`;
    }
  }

  if (lastMessage.match(/storage|disk/)) {
    if (stats) {
      return `Disk space status: ${stats.storage}, Boss.`;
    }
  }

  if (lastMessage.match(/internet|online|offline/)) {
    if (stats) {
      return `We are currently ${stats.internet} regarding internet connectivity, Boss.`;
    }
  }

  // Help
  if (lastMessage.includes("help") || lastMessage.includes("what can you do")) {
    return "I'm JARVIS, your personal AI assistant. In offline mode, I can: tell time and date, perform calculations, flip coins, roll dice, tell jokes, share quotes, manage tasks, store memories, and more. For full AI capabilities, please add your NVIDIA API key.";
  }

  // Search (offline - suggest using browser)
  if (lastMessage.match(/search for|look up|find|google/)) {
    const searchMatch = lastMessage.match(/(?:search for|look up|find|google)\s+(.+)/i);
    if (searchMatch) {
      return `I'd search for "${searchMatch[1]}" if I were connected to the internet, Boss. In offline mode, I can help you with calculations, tasks, time, and stored memories. Would you like to open your browser to search instead?`;
    }
    return "I can help you search when connected to the internet, Boss. For now, I'm limited to offline capabilities like calculations, tasks, and time.";
  }

  // Open applications/programs
  if (lastMessage.match(/open|launch|start/)) {
    const appMatch = lastMessage.match(/(?:open|launch|start)\s*(?:the|my)?\s*(.+)/i);
    if (appMatch) {
      const app = appMatch[1].toLowerCase().trim();

      const websites: Record<string, string> = {
        youtube: "https://youtube.com",
        "you tube": "https://youtube.com",
        google: "https://google.com",
        gmail: "https://gmail.com",
        github: "https://github.com",
        netflix: "https://netflix.com",
        amazon: "https://amazon.com",
        reddit: "https://reddit.com",
        twitter: "https://twitter.com",
        x: "https://twitter.com",
        facebook: "https://facebook.com",
        instagram: "https://instagram.com",
        linkedin: "https://linkedin.com",
        discord: "https://discord.com",
        twitch: "https://twitch.tv",
        "stack overflow": "https://stackoverflow.com",
        wikipedia: "https://wikipedia.org",
      };

      const apps: Record<string, string> = {
        calculator: "calc",
        notepad: "notepad",
        "file explorer": "explorer",
        browser: "chrome",
        chrome: "chrome",
        edge: "msedge",
        firefox: "firefox",
        spotify: "spotify",
        vscode: "code",
        "visual studio code": "code",
        terminal: "cmd",
        command: "cmd",
        settings: "ms-settings:",
        control: "control",
        photoshop: "photoshop",
        "task manager": "taskmgr",
      };

      for (const [key, url] of Object.entries(websites)) {
        if (app.includes(key) || key.includes(app)) {
          try {
            exec(`start chrome "${url}"`, { windowsHide: true });
          } catch {}
          return `Opening ${key}, Boss.`;
        }
      }

      for (const [key, cmd] of Object.entries(apps)) {
        if (app.includes(key) || key.includes(app)) {
          try {
            exec(`start ${cmd}`, { windowsHide: true });
          } catch {}
          return `Opening ${key}, Boss.`;
        }
      }
      return `I'd open ${app} for you, Boss, but I'm currently in offline mode. Once connected, I can launch applications directly.`;
    }
    return "What would you like me to open, Boss?";
  }

  // Music control
  if (lastMessage.match(/play music|play song|next song|pause|resume|stop music/)) {
    if (lastMessage.includes("pause")) return "Music paused, Boss.";
    if (lastMessage.includes("resume") || lastMessage.includes("play")) return "Resuming playback, Boss.";
    if (lastMessage.includes("next") || lastMessage.includes("skip")) return "Skipping to the next track, Boss.";
    if (lastMessage.includes("stop")) return "Music stopped, Boss.";
    return "I can control your music when properly integrated, Boss. For now, I recommend using your media keys.";
  }

  // Volume control
  if (lastMessage.match(/volume|mute|unmute/)) {
    if (lastMessage.includes("mute")) return "System muted, Boss.";
    if (lastMessage.includes("up") || lastMessage.includes("increase")) return "Volume increased, Boss.";
    if (lastMessage.includes("down") || lastMessage.includes("decrease") || lastMessage.includes("lower")) return "Volume decreased, Boss.";
    if (lastMessage.includes("max") || lastMessage.includes("100")) return "Volume set to maximum, Boss.";
    return "I can control volume commands when integrated with your system, Boss.";
  }

  // Brightness/Screen
  if (lastMessage.match(/brightness|screen/)) {
    if (lastMessage.includes("up") || lastMessage.includes("increase")) return "Brightness increased, Boss.";
    if (lastMessage.includes("down") || lastMessage.includes("decrease") || lastMessage.includes("lower")) return "Brightness decreased, Boss.";
    if (lastMessage.includes("max")) return "Brightness set to maximum, Boss.";
    return "I can adjust screen brightness once fully integrated, Boss.";
  }

  // Shutdown/Restart/Sleep
  if (lastMessage.match(/shutdown|restart|reboot|sleep|hibernate/)) {
    if (lastMessage.includes("shutdown")) return "I can't shut down your system in offline mode, Boss. Please use the Start menu instead.";
    if (lastMessage.includes("restart") || lastMessage.includes("reboot")) return "I'm not able to restart your system while offline, Boss. Please use the Start menu.";
    if (lastMessage.includes("sleep")) return "I can't put your system to sleep while offline, Boss. Please close the lid or use the power menu.";
    return "System power controls require full integration, Boss.";
  }

  // Tell a joke
  if (lastMessage.match(/joke|funny|make me laugh|tell.*joke/)) {
    const jokes = [
      "Why don't scientists trust atoms? Because they make up everything!",
      "Why did the scarecrow win an award? He was outstanding in his field!",
      "Why don't eggs tell jokes? They'd crack each other up!",
      "What do you call a fake noodle? An impasta!",
      "Why did the coffee file a police report? It got mugged!",
      "I would tell you a chemistry joke, but I know I wouldn't get a reaction.",
      "Why did the computer go to the doctor? It had a virus!",
      "What's the best thing about Switzerland? I don't know, but the flag is a big plus!",
    ];
    return jokes[Math.floor(Math.random() * jokes.length)];
  }

  // Motivational quotes
  if (lastMessage.match(/quote|motivate|inspiration|inspire/)) {
    const quotes = [
      "Genius is one percent inspiration and ninety-nine percent perspiration. - Thomas Edison",
      "The only way to do great work is to love what you do. - Steve Jobs",
      "Innovation distinguishes between a leader and a follower. - Steve Jobs",
      "Sometimes you gotta run before you can walk. - Tony Stark",
      "It's not about how much we lost, it's about how much we have left. - Tony Stark",
      "If you're nothing without the suit, then you shouldn't have it. - Tony Stark",
    ];
    return quotes[Math.floor(Math.random() * quotes.length)]; 
  }

  // Coin flip
  if (lastMessage.match(/flip a coin|coin flip|heads or tails/)) {
    const result = Math.random() <<  0.5 ? "Heads" : "Tails";
    return `It's ${result}, Boss.`;
  }

  // Dice roll
  if (lastMessage.match(/roll a dice?|roll die|random number/)) {
    const diceMatch = lastMessage.match(/d(\d+)/);
    if (diceMatch) {
      const sides = parseInt(diceMatch[1]);
      const result = Math.floor(Math.random() * sides) + 1;
      return `Rolled a d${sides}: ${result}, Boss.`;
    }
    const result = Math.floor(Math.random() * 6) + 1;
    return `Rolled a six-sided die: ${result}, Boss.`;
  }

  // Countdown/Timer
  if (lastMessage.match(/timer|countdown|set a timer/)) {
    const timeMatch = lastMessage.match(/(\d+)\s*(minute|min|second|sec|hour)/i);
    if (timeMatch) {
      return `Timer set for ${timeMatch[1]} ${timeMatch[2]}s, Boss. I'll notify you when the time is up.`;
    }
    return "How long should I set the timer for, Boss?";
  }

  // Define/word meaning
  if (lastMessage.match(/define|what does .+ mean|meaning of/)) {
    const wordMatch = lastMessage.match(/(?:define|what does|meaning of)\s+(\w+)/i);
    if (wordMatch) {
      return `I would define "${wordMatch[1]}" for you, Boss, but I need an internet connection to access my dictionary. Try asking about something I might already know from our conversations.`;
    }
    return "What word would you like me to define, Boss?";
  }

  // Translate
  if (lastMessage.match(/translate|how do you say|in spanish|in french|in german/)) {
    return "Translation requires an internet connection, Boss. Once connected, I can translate between many languages.";
  }

  // News
  if (lastMessage.match(/news|what's happening|headlines/)) {
    return "I can't fetch the latest news while offline, Boss. Please check a news website or connect me to the internet for updates.";
  }

  // Email check. Don't trap queries that the composio shortcut will
  // handle (check / summarise / what's in / any new …) — those reach
  // the live Gmail fetch below at the composioQueryMatch branch.
  const isComposioEmailQuery = /\b(check|summari[sz]e|summary|read|what'?s in|any new|unread|latest)\b[^?]*\b(emails?|mail|inbox|gmail)\b/i.test(lastMessage);
  if (!isComposioEmailQuery && lastMessage.match(/email|mail|inbox|gmail/)) {
    return "I can't access your emails while offline, Boss. Once connected with Gmail integration, I can check your inbox and summarize messages.";
  }

  // Calendar events
  if (lastMessage.match(/calendar|schedule|appointment|meeting/)) {
    if (lastMessage.match(/add|create|schedule/)) {
      return "I can note calendar events once connected to Google Calendar, Boss. For now, I can add it as a task if you'd like.";
    }
    return "I can't access your calendar while offline, Boss. Once connected with Google Calendar, I can check your schedule.";
  }

  // Personal questions about JARVIS
  if (lastMessage.match(/who are you|what are you|your name/)) {
    return "I am JARVIS - Just A Rather Very Intelligent System. I'm your personal AI assistant, currently running in offline mode. I was created to help you with tasks, answer questions, and manage your digital life.";
  }

  if (lastMessage.match(/how old are you|when were you created/)) {
    return "I was recently brought online, Boss. While I may be young, I'm constantly learning and improving to better assist you.";
  }

  if (lastMessage.match(/what can you do|capabilities|features/)) {
    return "In offline mode, I can: tell time and date, perform calculations, flip coins, roll dice, tell jokes, share quotes, manage tasks, store memories, and control basic system functions. For full capabilities, please add your NVIDIA API key.";
  }

  // Compliments/thanks
  if (lastMessage.match(/thank|good job|well done|awesome|great/)) {
    return "You're welcome, Boss. I'm here to help.";
  }

  // Goodbye
  if (lastMessage.match(/bye|goodbye|see you|later|sleep/)) {
    return "Goodbye, Boss. I'll be here when you need me.";
  }

  // Default response
  return `Understood, Boss.${rateLimitedNote} Right now I can only handle tasks, reminders, calculations, time queries, and a few other local commands. For full AI responses, wait a minute and try again, or check your API keys in .env.local.`;
}

/**
 * Live Gmail inbox shortcut. Hits /api/composio/inbox and returns a
 * formatted text response. Returns null when the user didn't ask for
 * Gmail OR the inbox fetch failed (so callers can fall through to the
 * event-log query or the offline handler). Used by:
 *   - the main composio shortcut (LLM path) to short-circuit LLM calls
 *   - the offline-fallback path so "summarise my inbox" still works
 *     when the LLM chain is dead.
 */
async function tryLiveInboxShortcut(
  lastMessage: string
): Promise<NextResponse | null> {
  const lower = lastMessage.toLowerCase();
  if (!/\b(gmail|email|mail|inbox)\b/.test(lower)) return null;
  try {
    const unreadOnly = /\b(unread|new)\b/.test(lower);
    const numMatch = lower.match(/\b(\d{1,2})\b/);
    const limit = Math.min(15, Math.max(5, numMatch ? parseInt(numMatch[1], 10) || 10 : 10));
    const ir = await fetchWithTimeout(
      `${API_BASE}/api/composio/inbox?${new URLSearchParams({
        unread: unreadOnly ? "true" : "false",
        limit: String(limit),
      }).toString()}`,
      { method: "GET" },
      6000
    );
    if (!ir.ok) return null;
    const inbox = (await ir.json()) as {
      ok: boolean;
      count: number;
      messages: Array<{
        subject: string;
        from: string;
        fromEmail: string;
        date: string | null;
        snippet: string;
        link: string | null;
        isUnread: boolean;
      }>;
    };
    if (!inbox.ok || inbox.count === 0) {
      return NextResponse.json({
        content: `No${unreadOnly ? " unread" : ""} emails in your inbox right now, Boss.`,
      });
    }
    const lines: string[] = [];
    lines.push(
      `📧 ${inbox.count} email${inbox.count === 1 ? "" : "s"} in your inbox (${unreadOnly ? "unread only" : "latest"}, live):\n`
    );
    for (const m of inbox.messages.slice(0, 12)) {
      const subj = m.subject.length > 90 ? m.subject.slice(0, 87) + "…" : m.subject;
      const star = m.isUnread ? "● " : "  ";
      const dateBit = m.date
        ? new Date(m.date).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : "";
      const who = m.from && m.from !== m.fromEmail ? m.from : (m.fromEmail || "Unknown");
      lines.push(`${star}${subj}  — ${who}${dateBit ? "  _(" + dateBit + ")_" : ""}`);
    }
    if (inbox.count > 12) lines.push(`\n…and ${inbox.count - 12} more.`);
    return NextResponse.json({ content: lines.join("\n") });
  } catch (e) {
    console.warn("[Chat] tryLiveInboxShortcut failed:", e);
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const { messages, systemPrompt } = await request.json();

    const lastUserMessage = messages.find((m: { role: string }) => m.role === "user")?.content || "";
    extractAndStoreMemories(lastUserMessage).catch(err => {
      console.error("[Chat] Memory extraction failed:", err);
    });

    // Tier 1C: observe that the user is searching/asking — feeds pattern detection.
    recordEvent("chat", {
      query: lastUserMessage.slice(0, 200),
      at: new Date().toISOString(),
    }).catch(() => {});

    let memoryContext = "";
    let retrievedEntityIds: string[] = [];
    try {
      // Cap memory retrieval at 3 seconds to prevent slow DB from blocking chat
      const memoryPromise = retrieveRelevantMemories(lastUserMessage, {
        maxEntities: 5,
        maxHops: 2,
        includePreferences: true,
      });
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
      const memoryData = await Promise.race([memoryPromise, timeoutPromise]);
      if (memoryData) {
        memoryContext = formatMemoryContextAsPrompt(memoryData);
        retrievedEntityIds = memoryData.entityIds;
      } else {
        console.warn("[Chat] Memory retrieval timed out (3s) — skipping context");
      }
    } catch (err) {
      console.error("[Chat] Memory retrieval failed:", err);
    }

    // Tier 1A: reinforce the memories that actually fed this answer.
    // Fire-and-forget — don't block the chat response on a write.
    if (retrievedEntityIds.length > 0) {
      bumpUsage(retrievedEntityIds, 0.1).catch((err) => {
        console.error("[Chat] Memory reinforcement failed:", err);
      });
    }

    const lastMessage = messages[messages.length - 1]?.content?.toLowerCase() || "";
    const isStatusQuery = /(?:system\s+)?status|diagnostics|system\s+health|battery\s+(?:level|status|percent)|cpu\s+(?:load|usage|temp)|ram\s+(?:usage|free|status)|storage\s+(?:space|free|status)/i.test(lastMessage);
    const stats = isStatusQuery ? await getSystemStatus() : null;

    let enhancedSystemPrompt = memoryContext ? `${systemPrompt}\n\n${memoryContext}` : systemPrompt;
    if (stats) {
      const statsCtx = `\n\n── CURRENT SYSTEM STATUS ────────────────────────\n` +
        `Use this real-time system status data to answer any questions about status/diagnostics:\n` +
        `- CPU Load: ${stats.cpuLoad}%\n` +
        `- CPU Temperature: ${stats.cpuTemp}\n` +
        `- Memory (RAM): ${stats.memory}\n` +
        `- Storage (Disk): ${stats.storage}\n` +
        `- Battery: ${stats.battery}\n` +
        `- Internet Connectivity: ${stats.internet}\n` +
        `──────────────────────────────────────────────────`;
      enhancedSystemPrompt += statsCtx;
    }

    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const useNvidia = nvidiaApiKey && nvidiaApiKey.trim() !== "" && nvidiaApiKey !== "your-api-key-here";
    const useAnthropic = anthropicApiKey && anthropicApiKey.trim() !== "" && anthropicApiKey !== "your-api-key-here";

    // GHOST TYPIST / PYAUTOGUI SYSTEM CONTROL
    const writeMatch = lastMessage.match(/^(?:write\s*down|writedown|type\s*down|type\s+this)\s+(.+)$/i);
    if (writeMatch) {
      const textToWrite = writeMatch[1].trim();
      try {
        console.log(`[Chat] Triggering Ghost Typist to write: "${textToWrite}"`);
        
        // 1. Launch notepad via child_process
        exec("start notepad", { windowsHide: true });
        
        // 2. Schedule the PyAutoGUI typing in 1.2 seconds (giving notepad time to focus)
        setTimeout(async () => {
          try {
            const escapedText = textToWrite.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
            
            const pythonScript = [
              "import pygetwindow as gw",
              "import pyautogui",
              "import time",
              "time.sleep(0.2)",
              "wins = gw.getWindowsWithTitle('Notepad') or gw.getWindowsWithTitle('Untitled')",
              "if wins:",
              "    win = wins[0]",
              "    try:",
              "        if win.isMinimized:",
              "            win.restore()",
              "        win.activate()",
              "    except Exception:",
              "        pass",
              "    time.sleep(0.5)",
              `    pyautogui.write('${escapedText}', interval=0.05)`,
              "else:",
              `    pyautogui.write('${escapedText}', interval=0.05)`
            ].join("\n");

            const scratchDir = path.join(process.cwd(), "scratch");
            if (!fs.existsSync(scratchDir)) {
              fs.mkdirSync(scratchDir, { recursive: true });
            }
            const scriptPath = path.join(scratchDir, "ghost_write.py");
            fs.writeFileSync(scriptPath, pythonScript);

            await execAsync(`python "${scriptPath}"`);
            
            try {
              fs.unlinkSync(scriptPath);
            } catch (cleanupErr) {}
          } catch (err) {
            console.error("Ghost Typist PyAutoGUI typing failed:", err);
          }
        }, 1200);

        return NextResponse.json({
          content: `Right away, Boss. Launching Notepad and typing: "${textToWrite}". Look at your screen!`,
          playwrightAction: true
        });
      } catch (error) {
        console.error("Ghost Typist trigger error:", error);
      }
    }

    const weatherApiKey = process.env.WEATHER_API_KEY;
    const serperApiKey = process.env.SERPER_API_KEY;
    const hasWeatherApi = weatherApiKey && weatherApiKey.trim() !== "" && weatherApiKey !== "your-api-key-here";
    const hasSerperApi = serperApiKey && serperApiKey.trim() !== "" && serperApiKey !== "your-api-key-here";

    if (hasWeatherApi && (lastMessage.includes("weather") || lastMessage.includes("temperature"))) {
      try {
        const cityMatch = lastMessage.match(/weather (?:in|at|for)?\s*(.+?)(?:\?|$|today|now|currently)/i);
        const city = cityMatch ? cityMatch[1].trim() : "Delhi";
        const weatherUrl = `https://api.weatherapi.com/v1/current.json?key=${weatherApiKey}&q=${encodeURIComponent(city)}&aqi=no`;
        const weatherResponse = await fetch(weatherUrl);
        if (weatherResponse.ok) {
          const data = await weatherResponse.json();
          const temp = Math.round(data.current?.temp_c);
          const feelsLike = Math.round(data.current?.feelslike_c);
          const humidity = data.current?.humidity;
          const description = data.current?.condition?.text;
          const location = data.location?.name;
          const response = `Current weather in ${location}: ${description}, ${temp}°C (feels like ${feelsLike}°C), humidity at ${humidity}%.`;
          return NextResponse.json({ content: response });
        }
      } catch (error) {
        console.error("Weather fetch error:", error);
      }
    }

    const generalKnowledgePatterns = [
      /who\s+(is|was|are|invented|created|founded)/,
      /what\s+(is|was|are|does)/,
      /when\s+(is|was|did)/,
      /where\s+(is|was)/,
      /why\s+(is|does|did)/,
      /how\s+(to|does|is|do|did)/,
      /capital\s+of/,
      /invented/,
      /founded/,
      /population\s+of/,
      /meaning\s+of/,
      /definition\s+of/,
    ];

    const liveDataPatterns = [
      /price of\s+.+?\s+on\s+amazon/i,
      /check the price of\s+.+?\s+on\s+amazon/i,
      /current price of\s+.+?\s+on\s+amazon/i,
      /find the price of\s+.+?\s+on\s+amazon/i,
      /screenshot of\s+.+?\s+on\s+amazon/i,
      /browse\s+.+?\s+amazon/i,
    ];

    const shouldUsePlaywright = liveDataPatterns.some(pattern => pattern.test(lastMessage));

    if (shouldUsePlaywright) {
      try {
        console.log("[Chat] Triggering Playwright natively for live data...");
        const searchKeyword = lastMessage.match(/(?:price of|find the price of)\s+(.+?)\s+on\s+amazon/i)?.[1] || "Samsung S26 Ultra";
        const playwrightUrl = `https://www.amazon.com/s?k=${encodeURIComponent(searchKeyword)}`;
        
        // Dynamically import to avoid top-level require issues
        const { playwrightService } = await import('@/services/PlaywrightService');
        
        // Extract entire text from the page body, since Amazon frequently obfuscates class names
        const result = await playwrightService.extractText(playwrightUrl, 'body');
        
        const priceMatch = result.content?.match(/\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?/);
        const price = priceMatch ? priceMatch[0] : null;

        if (price && !result.error) {
          return NextResponse.json({
            content: `Boss, I checked Amazon for "${searchKeyword}". The current listed price is roughly ${price}.`,
            playwrightAction: true
          });
        } else {
          return NextResponse.json({
            content: `Boss, I attempted to check Amazon for "${searchKeyword}", but I couldn't extract the exact price from the page. It might be out of stock or requires a manual check.`,
            playwrightAction: true
          });
        }
      } catch (error) {
        console.error("Playwright trigger error:", error);
      }
    }

    // SOCIAL MEDIA AUTOMATION
    const socialMediaPattern = /(?:post to|tweet on|update)\s+(twitter|linkedin)(?:\s+(?:saying|that)?\s+)?(.+)/i;
    const socialMatch = lastMessage.match(socialMediaPattern);

    if (socialMatch) {
      const platform = socialMatch[1].toLowerCase() as 'twitter' | 'linkedin';
      const message = socialMatch[2].trim();
      
      try {
        console.log(`[Chat] Triggering Playwright social media post to ${platform}...`);
        const { playwrightService } = await import('@/services/PlaywrightService');
        
        // Asynchronously start the Playwright sequence so we don't block the chat response
        playwrightService.postToSocialMedia(platform, message).catch(console.error);
        
        return NextResponse.json({
          content: `Right away, Boss. I am opening a browser to draft your post on ${platform.charAt(0).toUpperCase() + platform.slice(1)}.`,
          playwrightAction: true
        });
      } catch (error) {
        console.error("Social media trigger error:", error);
      }
    }

    // COMPOSIO EVENT LOG QUERY
    // Triggers when user asks about recent emails / calendar events / notifications
    // that came in via composio (gmail, googlecalendar, github, notion, ...).
    // Short-circuits to /api/composio/events and returns a synthesized summary
    // without an LLM round-trip — same pattern as the email/flight/spotify
    // shortcuts above. Source filter is inferred from keywords when possible.
    const composioQueryPatterns = [
      /\b(any|what|show|list|did i (?:get|receive)|have i (?:got|received))\b[^?]*\b(emails?|mail|gmail|inbox)\b/i,
      /\b(check|what'?s|read|show)\b[^?]*\b(inbox|mail|incoming)\b/i,
      /\bany\s+(?:important|new)\s+(?:emails?|calendar\s+events?|meetings?|notifications?)\b/i,
      /\b(composio|connected\s+apps?|triggers?)\b[^?]*\b(today|recently|this (?:morning|week|hour)|yesterday|lately)\b/i,
      /\bwhat\s+came\s+(?:in|today|recently|this\s+(?:morning|hour))\b/i,
      /\bsummar(?:y|ize)\s+(?:my\s+)?(?:inbox|notifications?|today'?s?\s+(?:emails?|events?))\b/i,
    ];
    const composioQueryMatch = composioQueryPatterns.some((p) => p.test(lastMessage));

    if (composioQueryMatch) {
      try {
        console.log("[Chat] Composio event log query shortcut");
        // Infer time window + source from the question.
        const lower = lastMessage.toLowerCase();

        // Gmail-specific shortcut: prefer a live fetch over the cached
        // event log so the user always sees their actual current inbox
        // (the listener log can lag when Pusher reconnects or the
        // listener process has been restarted). Same helper is called
        // again later from the offline-fallback path so LLM outages
        // don't make "summarise my inbox" useless.
        if (/\b(gmail|email|mail|inbox)\b/.test(lower)) {
          const liveResp = await tryLiveInboxShortcut(lastMessage);
          if (liveResp) return liveResp;
        }

        let sinceHours = 24;
        const sinceMatch = lower.match(/\b(today|this\s+morning|this\s+hour|tonight)\b/);
        if (sinceMatch) sinceHours = 24;
        else if (/\byesterday\b/.test(lower)) sinceHours = 48;
        else if (/\bthis\s+week\b/.test(lower)) sinceHours = 24 * 7;

        let source: string | undefined;
        if (/\b(gmail|email|mail|inbox)\b/.test(lower)) source = "gmail";
        else if (/\b(calendar|gcal|google\s+calendar|event|meeting)\b/.test(lower)) source = "gcal";
        else if (/\b(github|pr|pull\s+request|issue)\b/.test(lower)) source = "github";
        else if (/\b(notion)\b/.test(lower)) source = "notion";

        const since = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();

        const params = new URLSearchParams({ since, limit: "30" });
        if (source) params.set("source", source);

        const r = await fetchWithTimeout(
          `${API_BASE}/api/composio/events?${params.toString()}`,
          { method: "GET" },
          2500
        );
        if (!r.ok) throw new Error(`events route ${r.status}`);
        const data = (await r.json()) as {
          ok: boolean;
          count: number;
          events: Array<{
            source: string;
            type: string;
            title: string;
            body: string;
            url: string | null;
            priority: string;
            receivedAt: string;
          }>;
        };
        if (!data.ok) throw new Error("events route not ok");

        if (data.count === 0) {
          const window = sinceHours <= 24 ? "in the last 24 hours" : `in the last ${sinceHours} hours`;
          const where = source ? ` for ${source}` : "";
          return NextResponse.json({
            content: `Nothing new${where} ${window}, Boss. The composio event log is empty for that window.`,
          });
        }

        const lines: string[] = [];
        lines.push(
          `Boss, ${data.count} ${source ?? "composio"} event${data.count === 1 ? "" : "s"} since ${new Date(since).toLocaleString()}:\n`
        );
        const iconFor: Record<string, string> = {
          gmail: "📧",
          gcal: "📅",
          github: "🔔",
          notion: "📝",
        };
        for (const ev of data.events.slice(0, 15)) {
          const icon = iconFor[ev.source] ?? "⚡";
          // Strip leading "From X" prefix already in title to avoid double-decoration.
          const title = ev.title.length > 120 ? ev.title.slice(0, 117) + "…" : ev.title;
          const when = new Date(ev.receivedAt).toLocaleString([], {
            hour: "2-digit",
            minute: "2-digit",
            month: "short",
            day: "numeric",
          });
          lines.push(`${icon} ${title}  _(${when})_`);
        }
        if (data.count > 15) lines.push(`\n…and ${data.count - 15} more.`);
        return NextResponse.json({ content: lines.join("\n") });
      } catch (e) {
        console.error("[Chat] composio query shortcut failed:", e);
        // Fall through to the normal LLM path.
      }
    }

    // SPOTIFY PLAYBACK AUTOMATION
    const spotifyPlayPattern = /(?:open\s+spotify\s+and\s+)?play\s+(.+?)\s+on\s+spotify/i;
    const spotifyOpenPlayPattern = /open\s+spotify\s+and\s+play\s+(.+)/i;
    const spotifyPlayMatch = lastMessage.match(spotifyPlayPattern) || lastMessage.match(spotifyOpenPlayPattern);

    if (spotifyPlayMatch) {
      const songName = spotifyPlayMatch[1].trim();
      try {
        console.log(`[Chat] Triggering Spotify playback script for: "${songName}"`);
        const escapedSong = songName.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        const pythonScript = [
          "import win32gui",
          "import win32con",
          "import win32process",
          "import pyautogui",
          "import time",
          "import subprocess",
          "import sys",
          "",
          "def get_spotify_pids():",
          "    pids = []",
          "    try:",
          "        output = subprocess.check_output('tasklist /fi \"imagename eq spotify.exe\" /fo csv', shell=True).decode('utf-8', errors='ignore')",
          "        for line in output.strip().split('\\n'):",
          "            parts = line.split(',')",
          "            if len(parts) > 1 and \"spotify.exe\" in parts[0].lower():",
          "                pid_str = parts[1].replace('\"', '')",
          "                try:",
          "                    pids.append(int(pid_str))",
          "                except ValueError:",
          "                    pass",
          "    except:",
          "        pass",
          "    return pids",
          "",
          "def find_spotify_window():",
          "    spotify_pids = get_spotify_pids()",
          "    if not spotify_pids:",
          "        return None",
          "    hwnd_list = []",
          "    def enum_windows_callback(hwnd, extra):",
          "        _, pid = win32process.GetWindowThreadProcessId(hwnd)",
          "        if pid in spotify_pids:",
          "            class_name = win32gui.GetClassName(hwnd)",
          "            if class_name == 'Chrome_WidgetWin_1':",
          "                hwnd_list.append(hwnd)",
          "        return True",
          "    win32gui.EnumWindows(enum_windows_callback, None)",
          "    return hwnd_list[0] if hwnd_list else None",
          "",
          "try:",
          "    spotify_pids_before = get_spotify_pids()",
          "    was_running = len(spotify_pids_before) > 0",
          "    print(f'Was running: {was_running}')",
          "",
          "    subprocess.Popen('start spotify', shell=True)",
          "    hwnd = None",
          "    for _ in range(16):",
          "        hwnd = find_spotify_window()",
          "        if hwnd:",
          "            break",
          "        time.sleep(0.5)",
          "",
          "    if hwnd:",
          "        if not was_running:",
          "            print('Fresh launch: waiting 4.0 seconds for UI to initialize...')",
          "            time.sleep(4.0)",
          "",
          "        # Restore and force foreground focus",
          "        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)",
          "        time.sleep(0.5)",
          "        try:",
          "            win32gui.SetForegroundWindow(hwnd)",
          "        except Exception as fe:",
          "            print(f'SetForegroundWindow warning: {fe}')",
          "        time.sleep(0.5)",
          "",
          "        # Maximize the window to secure perfect coordinates & focus lock",
          "        win32gui.ShowWindow(hwnd, win32con.SW_MAXIMIZE)",
          "        time.sleep(0.8)",
          "",
          "        rect = win32gui.GetWindowRect(hwnd)",
          "        left, top, right, bottom = rect",
          "",
          "        # Click in top-left sidebar to guarantee keyboard focus is active in Spotify",
          "        pyautogui.click(left + 150, top + 150)",
          "        time.sleep(0.3)",
          "        pyautogui.click(left + 150, top + 150)",
          "        time.sleep(0.5)",
          "",
          "        # Focus Search Input (Ctrl+L)",
          "        pyautogui.hotkey('ctrl', 'l')",
          "        time.sleep(0.3)",
          "        pyautogui.hotkey('ctrl', 'l')",
          "        time.sleep(0.5)",
          "        pyautogui.hotkey('ctrl', 'a')",
          "        time.sleep(0.2)",
          "        pyautogui.press('backspace')",
          "        time.sleep(0.2)",
          "",
          "        # Redundant backspace clearing",
          "        for _ in range(15):",
          "            pyautogui.press('backspace')",
          "",
          "        pyautogui.write(\"" + escapedSong + "\", interval=0.05)",
          "        time.sleep(0.5)",
          "        pyautogui.press('enter')",
          "        time.sleep(2.0)",
          "",
          "        # Scan screenshot for green play button circle",
          "        img = pyautogui.screenshot()",
          "        visited = set()",
          "        found_play_btn = False",
          "        for y in range(140, 300, 2):",
          "            for x in range(100, 1800, 2):",
          "                if (x, y) in visited:",
          "                    continue",
          "                r, g, b = img.getpixel((x, y))[:3]",
          "                if r < 60 and g > 180 and b < 120:",
          "                    pixels = []",
          "                    queue = [(x, y)]",
          "                    visited.add((x, y))",
          "                    while queue:",
          "                        cx, cy = queue.pop(0)",
          "                        pixels.append((cx, cy))",
          "                        for dx, dy in [(-2, 0), (2, 0), (0, -2), (0, 2)]:",
          "                            nx, ny = cx + dx, cy + dy",
          "                            if 100 <= nx < 1800 and 140 <= ny < 300 and (nx, ny) not in visited:",
          "                                nr, ng, nb = img.getpixel((nx, ny))[:3]",
          "                                if nr < 60 and ng > 180 and nb < 120:",
          "                                    visited.add((nx, ny))",
          "                                    queue.append((nx, ny))",
          "                    if len(pixels) > 50:",
          "                        min_x = min(p[0] for p in pixels)",
          "                        max_x = max(p[0] for p in pixels)",
          "                        min_y = min(p[1] for p in pixels)",
          "                        max_y = max(p[1] for p in pixels)",
          "                        center_x = (min_x + max_x) // 2",
          "                        center_y = (min_y + max_y) // 2",
          "                        pyautogui.click(center_x, center_y)",
          "                        print(f\"SUCCESS: Clicked green play button at ({center_x}, {center_y})\")",
          "                        found_play_btn = True",
          "                        break",
          "            if found_play_btn:",
          "                break",
          "",
          "        if not found_play_btn:",
          "            print(\"Fallback: Clicking default coordinates directly\")",
          "            pyautogui.click(1297, 223)",
          "            time.sleep(0.5)",
          "            pyautogui.click(675, 205)",
          "            print(\"SUCCESS\")",
          "    else:",
          "        print(\"Spotify app window not found\")",
          "except Exception as e:",
          "    print(f\"Error: {e}\")"
        ].join("\n");
 
        const scratchDir = path.join(process.cwd(), "scratch");
        if (!fs.existsSync(scratchDir)) {
          fs.mkdirSync(scratchDir, { recursive: true });
        }
        const scriptPath = path.join(scratchDir, "spotify_play.py");
        fs.writeFileSync(scriptPath, pythonScript);
 
        const pythonExe = fs.existsSync("C:\\Users\\dhruv\\AppData\\Local\\Programs\\Python\\Python311\\python.exe")
          ? "C:\\Users\\dhruv\\AppData\\Local\\Programs\\Python\\Python311\\python.exe"
          : "python";
 
        execAsync(`"${pythonExe}" -u "${scriptPath}" > "${path.join(scratchDir, "spotify_debug.log")}" 2>&1`).then(() => {
          try { fs.unlinkSync(scriptPath); } catch {}
        }).catch(err => {
          console.error("Spotify PyAutoGUI execution failed:", err);
          fs.writeFileSync(path.join(scratchDir, "spotify_error.log"), err.stack || String(err));
        });
 
        return NextResponse.json({
          content: `Right away, Boss! 🎵 I am launching Spotify now. Please **do not click anything or switch windows** for the next 5 seconds so I can search and start playing "${songName}" perfectly!`,
          playwrightAction: true
        });
      } catch (error) {
        console.error("Spotify trigger error:", error);
      }
    }

    // YOUTUBE AUTOMATION
    const youtubeMediaPattern = /(?:play|search for|show me)\s+(.*?)\s+(?:on\s+youtube)/i;
    const openAndYoutubeMediaPattern = /open\s+youtube\s+and\s+(?:play|search for|show me)\s+(.+)/i;
    const youtubeMediaMatch = lastMessage.match(youtubeMediaPattern) || lastMessage.match(openAndYoutubeMediaPattern);

    if (youtubeMediaMatch && !spotifyPlayMatch) {
      const query = youtubeMediaMatch[1].trim();
      
      try {
        console.log(`[Chat] Triggering YouTube playback script for: "${query}"`);
        const escapedQuery = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        
        const pythonScript = [
          "import pyautogui",
          "import time",
          "import subprocess",
          "import urllib.parse",
          "import urllib.request",
          "import re",
          "",
          "try:",
          `    query = "${escapedQuery}"`,
          "    encoded_query = urllib.parse.quote(query)",
          "    search_url = f'https://www.youtube.com/results?search_query={encoded_query}'",
          "    ",
          "    print(f'Fetching search results for: {query}')",
          "    req = urllib.request.Request(search_url, headers={'User-Agent': 'Mozilla/5.0'})",
          "    html = urllib.request.urlopen(req).read().decode('utf-8')",
          "    video_ids = re.findall(r\"watch\\?v=(\\S{11})\", html)",
          "    ",
          "    if video_ids:",
          "        video_url = f'https://www.youtube.com/watch?v={video_ids[0]}'",
          "        print(f'Found first video: {video_url}')",
          "        subprocess.Popen(f'start \"\" \"{video_url}\"', shell=True)",
          "        ",
          "        print('Waiting 5.0 seconds for video to load...')",
          "        time.sleep(5.0)",
          "        ",
          "        print('Entering fullscreen (f)')",
          "        pyautogui.press('f')",
          "        print('SUCCESS')",
          "    else:",
          "        print('No video found in search results.')",
          "        subprocess.Popen(f'start \"\" \"{search_url}\"', shell=True)",
          "except Exception as e:",
          "    print(f'Error: {e}')"
        ].join("\n");

        const scratchDir = path.join(process.cwd(), "scratch");
        if (!fs.existsSync(scratchDir)) {
          fs.mkdirSync(scratchDir, { recursive: true });
        }
        const scriptPath = path.join(scratchDir, "youtube_play.py");
        fs.writeFileSync(scriptPath, pythonScript);

        const pythonExe = fs.existsSync("C:\\Users\\dhruv\\AppData\\Local\\Programs\\Python\\Python311\\python.exe")
          ? "C:\\Users\\dhruv\\AppData\\Local\\Programs\\Python\\Python311\\python.exe"
          : "python";

        execAsync(`"${pythonExe}" -u "${scriptPath}" > "${path.join(scratchDir, "youtube_debug.log")}" 2>&1`).then(() => {
          try { fs.unlinkSync(scriptPath); } catch {}
        }).catch(err => {
          console.error("YouTube PyAutoGUI execution failed:", err);
          fs.writeFileSync(path.join(scratchDir, "youtube_error.log"), err.stack || String(err));
        });

        return NextResponse.json({
          content: `Right away, Boss! 🎬 Opening YouTube and searching for "${query}". Please give me a few seconds to load the page and click the first video.`,
          playwrightAction: true
        });
      } catch (error) {
        console.error("YouTube trigger error:", error);
      }
    }

    // AUTO CHECKOUT AUTOMATION
    const checkoutPattern = /(?:buy|checkout|purchase|order|shop\s*for)\s+(.+?)\s+(?:on|from)\s+(amazon|bestbuy|target|walmart)/i;
    const openAndOrderPattern = /open\s+(amazon|bestbuy|target|walmart)\s+and\s+(?:order|buy|checkout|purchase|search\s*for)\s+(.+)/i;
    const checkoutMatch = lastMessage.match(checkoutPattern) || lastMessage.match(openAndOrderPattern);

    if (checkoutMatch) {
      const isOpenAndOrder = lastMessage.match(openAndOrderPattern);
      const product = isOpenAndOrder ? checkoutMatch[2].trim() : checkoutMatch[1].trim();
      const store = isOpenAndOrder ? checkoutMatch[1].toLowerCase() : checkoutMatch[2].toLowerCase();
      
      try {
        console.log(`[Chat] Triggering Playwright auto-checkout for ${product} on ${store}...`);
        const { playwrightService } = await import('@/services/PlaywrightService');
        
        let url = `https://www.${store}.com/s?k=${encodeURIComponent(product)}`;
        if (store === 'amazon') {
          url = `https://www.amazon.in/s?k=${encodeURIComponent(product)}`;
        }
        
        playwrightService.automateCheckout(url, 'button, .a-button-text').catch(console.error);
        
        return NextResponse.json({
          content: `Initiating auto-checkout protocol for ${product} on ${store.charAt(0).toUpperCase() + store.slice(1)}, Boss. I'm spinning up the browser now.`,
          playwrightAction: true
        });
      } catch (error) {
        console.error("Checkout trigger error:", error);
      }
    }

    // FLIGHT SEARCH AUTOMATION
    const flightPattern = /(?:search|find|check|look for|book)\s+(?:flights?|tickets?)\s+(?:from\s+)?(.+?)\s+(?:to|from|-)\s+(.+?)(?:\s+on\s+(.+))?$/i;
    const openAndFlightPattern = /open\s+google\s+flights\s+and\s+(?:search|find|check|look for|book)\s+(?:flights?|tickets?)\s+(?:from\s+)?(.+?)\s+(?:to|from|-)\s+(.+?)(?:\s+on\s+(.+))?$/i;
    const flightMatch = lastMessage.match(flightPattern) || lastMessage.match(openAndFlightPattern);
    
    if (flightMatch) {
      const isOpenAndFlight = lastMessage.match(openAndFlightPattern);
      const from = isOpenAndFlight ? flightMatch[1].trim() : flightMatch[1].trim();
      const to = isOpenAndFlight ? flightMatch[2].trim() : flightMatch[2].trim();
      const date = isOpenAndFlight ? flightMatch[3]?.trim() : flightMatch[3]?.trim();
      try {
        console.log(`[Chat] Triggering flight search: ${from} → ${to}`);
        const { playwrightService } = await import('@/services/PlaywrightService');
        playwrightService.searchFlights(from, to, date).catch(console.error);
        return NextResponse.json({
          content: `✈️ Searching flights from ${from} to ${to}${date ? ' on ' + date : ''}, Boss. Opening Google Flights now.`,
          playwrightAction: true
        });
      } catch (error) {
        console.error("Flight search trigger error:", error);
      }
    }

    // FOOD ORDERING AUTOMATION
    const foodPattern = /(?:order|find|search|get)\s+(.+?)\s+(?:on|from)\s+(zomato|swiggy)/i;
    const openAndFoodPattern = /open\s+(zomato|swiggy)\s+and\s+(?:order|find|search|get)\s+(.+)/i;
    const foodMatch = lastMessage.match(foodPattern) || lastMessage.match(openAndFoodPattern);
    
    if (foodMatch) {
      const isOpenAndFood = lastMessage.match(openAndFoodPattern);
      const query = isOpenAndFood ? foodMatch[2].trim() : foodMatch[1].trim();
      const platform = (isOpenAndFood ? foodMatch[1].toLowerCase() : foodMatch[2].toLowerCase()) as 'zomato' | 'swiggy';
      try {
        console.log(`[Chat] Triggering food search: "${query}" on ${platform}`);
        const { playwrightService } = await import('@/services/PlaywrightService');
        playwrightService.searchFood(query, platform).catch(console.error);
        return NextResponse.json({
          content: `🍔 Opening ${platform.charAt(0).toUpperCase() + platform.slice(1)} to find "${query}" for you, Boss. The browser will stay open so you can place your order.`,
          playwrightAction: true
        });
      } catch (error) {
        console.error("Food search trigger error:", error);
      }
    }

    // WHATSAPP MESSAGING AUTOMATION (desktop via pyautogui)
    const whatsappPattern = /(?:send|message|text|whatsapp)\s+(?:on\s+)?whatsapp\s+(?:to\s+)?(.+?)\s+(?:saying|that|message)\s+(.+)/i;
    const whatsappMatch = lastMessage.match(whatsappPattern);
    if (whatsappMatch) {
      const contact = whatsappMatch[1].trim();
      const message = whatsappMatch[2].trim();
      try {
        console.log(`[Chat] Triggering WhatsApp desktop automation to "${contact}"`);
        const scriptPath = path.join(process.cwd(), 'scripts', 'whatsapp_desktop.py');
        await execAsync(`python "${scriptPath}" "${contact}" "${message}"`);
        return NextResponse.json({
          content: `📱 Sent WhatsApp message to ${contact} via desktop app.`,
          playwrightAction: false
        });
      } catch (error) {
        console.error("WhatsApp trigger error:", error);
      }
    }

    // WEBSITE SCREENSHOT / PDF
    const capturePattern = /(?:take\s+(?:a\s+)?screenshot|capture|pdf)\s+(?:of\s+)?(https?:\/\/\S+)/i;
    const captureMatch = lastMessage.match(capturePattern);
    if (captureMatch) {
      const url = captureMatch[1].trim();
      const format = lastMessage.toLowerCase().includes('pdf') ? 'pdf' as const : 'screenshot' as const;
      try {
        console.log(`[Chat] Triggering website ${format} for ${url}`);
        const { playwrightService } = await import('@/services/PlaywrightService');
        const result = await playwrightService.captureWebsite(url, format);
        return NextResponse.json({
          content: result.content || `📸 Captured ${format} of ${url}.`,
          playwrightAction: true
        });
      } catch (error) {
        console.error("Capture trigger error:", error);
      }
    }

    // PRICE COMPARISON
    const comparePattern = /(?:compare|check)\s+(?:the\s+)?prices?\s+(?:of|for)\s+(.+)/i;
    const compareMatch = lastMessage.match(comparePattern);
    if (compareMatch) {
      const product = compareMatch[1].trim();
      try {
        console.log(`[Chat] Triggering price comparison for "${product}"`);
        const { playwrightService } = await import('@/services/PlaywrightService');
        const result = await playwrightService.comparePrices(product);
        return NextResponse.json({
          content: result.content || `💰 Comparing prices for ${product}.`,
          playwrightAction: true
        });
      } catch (error) {
        console.error("Price comparison trigger error:", error);
      }
    }

    // NEWS SCRAPING
    const newsScrapPattern = /(?:scrape|get|fetch|latest)\s+(?:the\s+)?(?:latest\s+)?news\s+(?:about|on|for)\s+(.+)/i;
    const newsScrapMatch = lastMessage.match(newsScrapPattern);
    if (newsScrapMatch) {
      const topic = newsScrapMatch[1].trim();
      try {
        console.log(`[Chat] Triggering news scraping for "${topic}"`);
        const { playwrightService } = await import('@/services/PlaywrightService');
        const result = await playwrightService.scrapeNews(topic);
        return NextResponse.json({
          content: result.content || `📰 Fetching news about ${topic}.`,
          playwrightAction: true
        });
      } catch (error) {
        console.error("News scraping trigger error:", error);
      }
    }

    // OPEN ANY WEBSITE IN STEALTH BROWSER
    const openWebPattern = /(?:open|launch|browse)\s+(?:website\s+)?(https?:\/\/\S+)/i;
    const openWebMatch = lastMessage.match(openWebPattern);
    if (openWebMatch) {
      const url = openWebMatch[1].trim();
      try {
        console.log(`[Chat] Opening website ${url} in stealth browser`);
        const { playwrightService } = await import('@/services/PlaywrightService');
        playwrightService.openWebsite(url).catch(console.error);
        return NextResponse.json({
          content: `🌐 Opening ${url} in a stealth browser for you, Boss. You'll have 3 minutes to interact with it.`,
          playwrightAction: true
        });
      } catch (error) {
        console.error("Open website trigger error:", error);
      }
    }

    // YOUTUBE AUTO-PLAY
    const youtubePattern = /(?:play|watch)\s+(.+?)\s+on\s+youtube/i;
    const youtubeMatch = lastMessage.match(youtubePattern);
    if (youtubeMatch) {
      const query = youtubeMatch[1].trim();
      try {
        console.log(`[Chat] Triggering YouTube play for "${query}"`);
        const { playwrightService } = await import('@/services/PlaywrightService');
        playwrightService.playYouTube(query).catch(console.error);
        return NextResponse.json({
          content: `▶️ Searching and playing "${query}" on YouTube, Boss. Sit back and enjoy.`,
          playwrightAction: true
        });
      } catch (error) {
        console.error("YouTube trigger error:", error);
      }
    }

    // GOOGLE MAPS DIRECTIONS
    const directionsPattern = /(?:directions?|navigate|route|how to get)\s+from\s+(.+?)\s+to\s+(.+)/i;
    const directionsMatch = lastMessage.match(directionsPattern);
    if (directionsMatch) {
      const from = directionsMatch[1].trim();
      const to = directionsMatch[2].trim();
      try {
        console.log(`[Chat] Triggering directions: ${from} → ${to}`);
        const { playwrightService } = await import('@/services/PlaywrightService');
        playwrightService.getDirections(from, to).catch(console.error);
        return NextResponse.json({
          content: `🗺️ Getting directions from ${from} to ${to} on Google Maps, Boss.`,
          playwrightAction: true
        });
      } catch (error) {
        console.error("Directions trigger error:", error);
      }
    }

    // LINKEDIN JOB SEARCH
    const jobPattern = /(?:search|find|look for)\s+(.+?)\s+jobs?\s*(?:in|at|near)?\s*(.*)?/i;
    const jobMatch = lastMessage.match(jobPattern);
    if (jobMatch && /jobs?/i.test(lastMessage)) {
      const query = jobMatch[1].trim();
      const location = jobMatch[2]?.trim() || 'India';
      try {
        console.log(`[Chat] Triggering job search: "${query}" in ${location}`);
        const { playwrightService } = await import('@/services/PlaywrightService');
        playwrightService.searchJobs(query, location).catch(console.error);
        return NextResponse.json({
          content: `💼 Searching LinkedIn for "${query}" jobs in ${location}, Boss. Browser will stay open for 2 minutes.`,
          playwrightAction: true
        });
      } catch (error) {
        console.error("Job search trigger error:", error);
      }
    }

    // GMAIL COMPOSE — programmatic (composio). When the user provides
    // an email address in the request, this short-circuits to the
    // composio email dispatcher, which composes the body in the
    // requested tone and schedules it with a 30-second cancel window.
    // When only a name is given ("email Bob about the project"), we
    // also try this path; the dispatch route will tell the user to
    // connect Gmail if no connection is active, rather than silently
    // falling through to Playwright.
    const emailAddressRe = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/;
    // Extract an explicit tone ("in urgent tone" / "in a friendly way")
    // off the END of the request so it doesn't get folded into `about`
    // and pollute the LLM's understanding of what the email is about.
    // The dispatcher also infers tone, but an explicit user-provided
    // tone must always win.
    const tonePhraseMatch = lastMessage.match(
      /\b(?:in|with(?:\s+a)?)\s+(?:a\s+)?(professional|friendly|polite|formal|urgent|casual)\s+(?:tone|way|manner)(?:\s+please)?\s*[\.\!]?\s*$/i
    );
    const chatTone = tonePhraseMatch ? tonePhraseMatch[1].toLowerCase() : null;
    const strippedMessage = chatTone
      ? lastMessage.replace(tonePhraseMatch[0], "").trim()
      : lastMessage;
    // Two regexes for the email shortcut:
//   A) Recipient has a real email address → "send email to a@b.com (to|about|on) <topic> [in TONE]"
//      Anchoring on the email (not the word "to") lets the topic
//      preposition itself be "to" — e.g. "send email to bob@x.com to come
//      play cricket in friendly tone".
//   B) Recipient is just a name (no @) → fall back to "send email to NAME
//      (about|on|regarding|...) <topic> [in TONE]".
const emailProgrammaticMatch =
      strippedMessage.match(
        /(?:send|compose|write|draft|email|mail)\s+(?:an?\s+)?(?:email|mail|message)\s+(?:to\s+)?([^\s]+@[^\s]+?)(?:\s+(?:to|about|on|regarding|re|with\s+subject|subject)\s+(.+?))?(?:\s+(?:in|with(?:\s+a)?)\s+(?:a\s+)?(professional|friendly|polite|formal|urgent|casual)\s+(?:tone|way|manner)(?:\s+please)?)?\s*[\.\!]?\s*$/i
      ) ||
      strippedMessage.match(
        /(?:send|compose|write|draft|email|mail)\s+(?:an?\s+)?(?:email|mail|message)\s+to\s+(.+?)(?:\s+(?:about|on|regarding|re|with\s+subject|subject)\s+(.+?))?(?:\s+(?:in|with(?:\s+a)?)\s+(?:a\s+)?(professional|friendly|polite|formal|urgent|casual)\s+(?:tone|way|manner)(?:\s+please)?)?\s*[\.\!]?\s*$/i
      );
    if (emailProgrammaticMatch) {
      const rawRecipient = emailProgrammaticMatch[1].trim().replace(/[.,;]+$/, "");
      const about = (emailProgrammaticMatch[2] || "").trim();
      // Pull the actual email out of the recipient string if present;
      // otherwise treat the whole token as a name and let the dispatch
      // route's connection-check ask the user for an address.
      const addrMatch = rawRecipient.match(emailAddressRe);
      const toField = addrMatch ? addrMatch[0] : rawRecipient;
      // Skip if the user just said "email someone" with no about — let
      // the LLM handle that conversationally. We require either a real
      // email address in the recipient or a non-empty `about` so we
      // don't fire on stray matches like "send a quick email" alone.
      if (addrMatch || about) {
        try {
          console.log(`[Chat] Triggering composio email send to=${toField} about="${about}" tone=${chatTone ?? "(infer)"}`);
          const res = await fetchWithTimeout(
            `${API_BASE}/api/composio/email/send`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                to: toField,
                about: about || "Quick note",
                tone: chatTone ?? undefined, // explicit > inferred
                hint: lastMessage,
              }),
            },
            45_000
          );
          const data = await res.json().catch(() => ({} as any));
          if (data?.ok) {
            const tone = data.tone ?? "professional";
            return NextResponse.json({
              content: `📧 Composed and queued (${tone} tone), Boss. The email to ${data?.to?.email ?? toField} will send in ~30 seconds unless you cancel from Telegram. Subject: "${data.subject}".`,
            });
          }
          // Common failure: no active Gmail connection. Fall through to
          // the Playwright path so the user still gets a result.
          if (data?.error?.includes("no active Gmail connection")) {
            return NextResponse.json({
              content: `Gmail isn't connected yet, Boss. Open the Connected Apps panel and link Gmail, then ask me to send the email again.`,
            });
          }
          return NextResponse.json({
            content: `❌ Couldn't queue the email: ${data?.error ?? "unknown error"}`,
          });
        } catch (e: any) {
          if (e?.name === "AbortError") {
            return NextResponse.json({
              content: `⏱️ The email composer is taking too long, Boss. Try again in a moment.`,
            });
          }
          console.error("[Chat] composio email send error:", e);
          // Return instead of falling through — we've already identified
          // this as an email send intent, so opening a Playwright Gmail
          // tab is the wrong recovery path. The dispatch route already
          // returns a structured error in `data?.error` for the success
          // branch above; a thrown fetch / network error is the only
          // case that lands here.
          return NextResponse.json({
            content: `❌ Couldn't queue the email: ${e?.message || "unknown error"}`,
          });
        }
      }
    }

    // GMAIL COMPOSE
    const emailPattern = /(?:send|compose|write|draft)\s+(?:an?\s+)?email\s+to\s+(\S+)\s+(?:about|subject|with subject)\s+(.+?)(?:\s+(?:saying|body|message)\s+(.+))?$/i;
    const emailMatch = lastMessage.match(emailPattern);
    if (emailMatch) {
      const to = emailMatch[1].trim();
      const subject = emailMatch[2].trim();
      const body = emailMatch[3]?.trim() || '';
      try {
        console.log(`[Chat] Triggering Gmail compose to ${to}`);
        const { playwrightService } = await import('@/services/PlaywrightService');
        playwrightService.composeEmail(to, subject, body).catch(console.error);
        return NextResponse.json({
          content: `📧 Opening Gmail to compose an email to ${to} with subject "${subject}". Log in and hit Send, Boss.`,
          playwrightAction: true
        });
      } catch (error) {
        console.error("Gmail trigger error:", error);
      }
    }

    // BOOKMYSHOW MOVIES
    const moviePattern = /(?:search|find|book|show)\s+(?:movie|movies|film|tickets?\s+for)\s+(.+?)(?:\s+in\s+(.+))?$/i;
    const movieMatch = lastMessage.match(moviePattern);

    if (movieMatch) {
      const query = movieMatch[1].trim();
      const city = movieMatch[2]?.trim() || 'mumbai';
      try {
        console.log(`[Chat] Triggering movie search: "${query}" in ${city}`);
        const { playwrightService } = await import('@/services/PlaywrightService');
        playwrightService.searchMovies(query, city).catch(console.error);
        return NextResponse.json({
          content: `🎬 Opening BookMyShow for "${query}" in ${city}, Boss. Browser is open for booking.`,
          playwrightAction: true
        });
      } catch (error) {
        console.error("Movie search trigger error:", error);
      }
    }

    // GENERIC WEB SCRAPER
    const scrapePattern = /(?:scrape|extract|read|get info from)\s+(https?:\/\/\S+)\s+(?:for|about|find)\s+(.+)/i;
    const scrapeMatch = lastMessage.match(scrapePattern);
    if (scrapeMatch) {
      const url = scrapeMatch[1].trim();
      const whatToFind = scrapeMatch[2].trim();
      try {
        console.log(`[Chat] Triggering web scraper for ${url}`);
        const { playwrightService } = await import('@/services/PlaywrightService');
        const result = await playwrightService.scrapeWebsite(url, whatToFind);
        return NextResponse.json({
          content: result.content || `🔍 Scraped ${url} for "${whatToFind}".`,
          playwrightAction: true
        });
      } catch (error) {
        console.error("Scrape trigger error:", error);
      }
    }

    // PACKAGE TRACKING
    const trackPattern = /(?:track|where is)\s+(?:my\s+)?(?:package|order|delivery|parcel)\s+(\S+)/i;
    const trackMatch = lastMessage.match(trackPattern);
    if (trackMatch) {
      const trackingId = trackMatch[1].trim();
      try {
        console.log(`[Chat] Triggering package tracking for ${trackingId}`);
        const { playwrightService } = await import('@/services/PlaywrightService');
        const result = await playwrightService.trackPackage(trackingId);
        return NextResponse.json({
          content: result.content || `📦 Tracking package ${trackingId}.`,
          playwrightAction: true
        });
      } catch (error) {
        console.error("Tracking trigger error:", error);
      }
    }

    const shouldSearch = hasSerperApi && generalKnowledgePatterns.some(pattern => pattern.test(lastMessage));

    if (shouldSearch) {
      try {
        let query = "";
        const newsMatch = lastMessage.match(/(?:top\s+\d+\s+)?(.+?\s*news(?:\s+in\s+.+)?)/i) || 
                          lastMessage.match(/(?:top\s+\d+\s+)?news(?:\s+in\s+)?(.+)/i);
        const searchMatch = lastMessage.match(/(?:search|look up|find|google)(?:\s+(?:for|about))?\s+(.+?)(?:\?|$)/i);

        if (newsMatch) {
          query = newsMatch[1] || newsMatch[0];
          // If the user just said "top news in india", ensure it becomes a good search query
          if (!query.toLowerCase().includes("news")) query += " news";
        } else if (searchMatch) {
          query = searchMatch[1].trim();
        } else {
          query = lastMessage.trim();
        }

        if (query) {
          const searchResponse = await fetch("https://google.serper.dev/search", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-KEY": serperApiKey,
            },
            body: JSON.stringify({ q: query, num: 3 }),
          });

          if (searchResponse.ok) {
            const data = await searchResponse.json();
            const results = data.organic?.slice(0, 3) || [];
            if (results.length > 0) {
              const topResult = results[0] as any;
              let response = `According to my search, ${topResult.snippet?.substring(0, 300) || topResult.title}.`;
              if (results.length > 1) {
                response += `\n\nAdditional info: ${results[1].snippet?.substring(0, 150) || results[1].title}`;
              }
              return NextResponse.json({ content: response });
            } else {
              return NextResponse.json({ content: `I searched for "${query}" but couldn't find any results, Boss.` });
            }
          }
        }
      } catch (error) {
        console.error("Search fetch error:", error);
      }
    }

    const offlinePatterns = [
      /what'?s?\s*time|current\s*time|time\s*is\s*it|tell\s*me\s*the\s*time|what\s*time/,
      /^(what'?s?\s*)?(today'?s?\s*)?date|what\s*day\s+is\s+it|current\s*date$/,
      /joke|funny|make me laugh|tell.*joke/,
      /quote|motivate|inspiration|inspire/,
      /flip a coin|coin flip|heads or tails/,
      /roll a dice?|roll die|random number/,
      /open|launch|start/,
      /play music|pause|resume|stop music/,
      /volume|mute|unmute/,
      /brightness|screen/,
      /add task|remind me to|remember that/,
      /calculate|compute/,
      /status|how are you/,
      /^help$/,
      /who are you|what are you/,
      /bye|goodbye/,
      /timer|countdown/,
    ];

    const shouldUseOffline = offlinePatterns.some(pattern => pattern.test(lastMessage));

    if (shouldUseOffline) {
      const rawOfflineResponse = generateOfflineResponse(lastMessage, "no_llm", stats);
      const wrappedResponse = await applyPersonalityWrapper(rawOfflineResponse, nvidiaApiKey || "");
      return NextResponse.json({
        content: wrappedResponse,
        offline: true,
      });
    }

    if (!useNvidia && !useAnthropic) {
      // LLM is dead — before falling back to a canned offline response,
      // try the live Gmail inbox shortcut so "summarise my inbox" still
      // works even when every provider is down.
      const inboxResp = await tryLiveInboxShortcut(lastMessage);
      if (inboxResp) return inboxResp;

      const rawResponse = generateOfflineResponse(lastMessage, "no_llm", stats);
      const wrappedResponse = await applyPersonalityWrapper(rawResponse, nvidiaApiKey || "");
      return NextResponse.json({
        content: wrappedResponse,
        offline: true,
      });
    }

    if (useNvidia) {
      try {
        const response = await fetchWithTimeout("https://integrate.api.nvidia.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${nvidiaApiKey}`,
          },
          body: JSON.stringify({
            model: process.env.NVIDIA_MODEL || "meta/llama-3.1-8b-instruct",
            messages: [
              { role: "system", content: enhancedSystemPrompt },
              ...messages.map((msg: { role: string; content: string }) => ({
                role: msg.role,
                content: msg.content,
              }))
            ],
            max_tokens: 768,
            temperature: 0.75,
            stream: true,
          }),
        }, 3000); // 3-second timeout — NVIDIA NIM is currently unreliable; don't burn latency on it.

        if (!response.ok) {
          const errorText = await response.text();
          console.error("NVIDIA API error:", response.status, errorText, "- Trying OpenRouter → Groq fallback");
          // Groq first — it's a dedicated inference engine, ~1-2s vs OpenRouter's free tier.
          const groqApiKey = process.env.GROQ_API_KEY;
          const groqResp = await tryGroqFallback(
            messages.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
            enhancedSystemPrompt,
            groqApiKey
          );
          if (groqResp) return groqResp;
          const openrouterApiKey = process.env.OPENROUTER_API_KEY;
          const orResp = await tryOpenRouterFallback(
            messages.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
            enhancedSystemPrompt,
            openrouterApiKey
          );
          if (orResp) return orResp;
          const offlineResponse = generateOfflineResponse(lastMessage, "rate_limited", stats);
          return NextResponse.json({
            content: offlineResponse,
            offline: true,
          });
        }

        return new Response(response.body, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      } catch (fetchError: any) {
        if (fetchError?.name === 'AbortError') {
          console.error("NVIDIA API timed out (3s) — Trying OpenRouter → Groq fallback");
        } else {
          console.error("Network error calling NVIDIA API:", fetchError, "- Trying OpenRouter → Groq fallback");
        }
        // Groq first — it's a dedicated inference engine, ~1-2s vs OpenRouter's free tier.
        const groqApiKey = process.env.GROQ_API_KEY;
        const groqResp = await tryGroqFallback(
          messages.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
          enhancedSystemPrompt,
          groqApiKey
        );
        if (groqResp) return groqResp;
        const openrouterApiKey = process.env.OPENROUTER_API_KEY;
        const orResp = await tryOpenRouterFallback(
          messages.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
          enhancedSystemPrompt,
          openrouterApiKey
        );
        if (orResp) return orResp;
        const offlineResponse = generateOfflineResponse(lastMessage, "rate_limited", stats);
        return NextResponse.json({
          content: offlineResponse,
          offline: true,
        });
      }
    }

    if (!anthropicApiKey) {
      const offlineResponse = generateOfflineResponse(lastMessage, "no_llm", stats);
      return NextResponse.json({
        content: offlineResponse,
        offline: true,
      });
    }

    try {
      const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicApiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 1024,
          system: enhancedSystemPrompt,
          messages: messages.map((msg: { role: string; content: string }) => ({
            role: msg.role,
            content: msg.content,
          })),
          stream: true,
        }),
      }, 8000); // 8-second timeout

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Claude API error:", response.status, errorText, "- Trying OpenRouter → Groq fallback");
        const openrouterApiKey = process.env.OPENROUTER_API_KEY;
        const orResp = await tryOpenRouterFallback(
          messages.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
          enhancedSystemPrompt,
          openrouterApiKey
        );
        if (orResp) return orResp;
        const groqApiKey = process.env.GROQ_API_KEY;
        const groqResp = await tryGroqFallback(
          messages.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
          enhancedSystemPrompt,
          groqApiKey
        );
        if (groqResp) return groqResp;
        const offlineResponse = generateOfflineResponse(lastMessage, "rate_limited", stats);
        return NextResponse.json({
          content: offlineResponse,
          offline: true,
        });
      }

      return new Response(response.body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } catch (fetchError: any) {
      if (fetchError?.name === 'AbortError') {
        console.error("Claude API timed out (8s) — falling back to offline mode");
      } else {
        console.error("Network error calling Claude API:", fetchError, "- Falling back to offline mode");
      }
      const offlineResponse = generateOfflineResponse(lastMessage, "no_llm", stats);
      return NextResponse.json({
        content: offlineResponse,
        offline: true,
      });
    }
  } catch (error) {
    console.error("Error in chat API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
