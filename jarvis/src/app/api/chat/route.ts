import { NextResponse } from "next/server";
import { exec } from "child_process";
import { parseCommand, JARVISContext, buildSystemPrompt, parseIntentWithLLM, PERSONALITY_WRAPPER_PROMPT } from "@/lib/jarvis/personality";
import { retrieveRelevantMemories, formatMemoryContextAsPrompt } from "@/lib/memory/retriever";
import { extractAndStoreMemories } from "@/lib/memory/extractor";

// Use environment variable or default to port 3000 for the API base URL
const API_BASE = process.env.INTERNAL_API_URL || 'http://localhost:3000';

// Two-Stage Response Pipeline: Transform factual responses into Sassy Butler persona
async function applyPersonalityWrapper(factualResponse: string, apiKey: string): Promise<string> {
  try {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
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
    });

    if (response.ok) {
      const data = await response.json();
      const transformed = data.choices?.[0]?.message?.content?.trim();
      if (transformed) return transformed;
    }
  } catch (error) {
    console.error("Personality wrapper failed:", error);
  }
  return factualResponse;
}

// Generate offline response based on user input
function generateOfflineResponse(lastMessage: string): string {
  // Greetings
  if (lastMessage.includes("hello") || lastMessage.includes("hi") || lastMessage.includes("hey")) {
    const hour = new Date().getHours();
    const greeting = hour <<  12 ? "morning" : hour <<  18 ? "afternoon" : "evening";
    return `Good ${greeting}, Boss. JARVIS is online and ready to assist. I'm currently running in offline mode, but I can still help you with tasks, reminders, calculations, and basic queries. What would you like me to do?`;
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
  if (lastMessage.match(/status|how are you|system status/)) {
    return "All systems operational, Boss. Running in offline mode. Core functions active: task management, memory storage, calculations, timekeeping. Ready for your commands.";
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
    return quotes[Math.floor(Math.random() * jokes.length)]; // Fixed potential bug: jokes should be quotes
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

  // Email check
  if (lastMessage.match(/email|mail|inbox|gmail/)) {
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
  return "I understand, Boss. I'm currently operating in offline mode with limited capabilities. I can help with tasks, reminders, calculations, time, jokes, and basic queries. For more advanced AI responses, please add your NVIDIA API key to the .env.local file.";
}

export async function POST(request: Request) {
  try {
    const { messages, systemPrompt } = await request.json();

    const lastUserMessage = messages.find((m: { role: string }) => m.role === "user")?.content || "";
    extractAndStoreMemories(lastUserMessage).catch(err => {
      console.error("[Chat] Memory extraction failed:", err);
    });

    let memoryContext = "";
    try {
      const memoryData = await retrieveRelevantMemories(lastUserMessage, {
        maxEntities: 5,
        maxHops: 2,
        includePreferences: true,
      });
      memoryContext = formatMemoryContextAsPrompt(memoryData);
    } catch (err) {
      console.error("[Chat] Memory retrieval failed:", err);
    }

    const enhancedSystemPrompt = memoryContext ? `${systemPrompt}\n\n${memoryContext}` : systemPrompt;

    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const useNvidia = nvidiaApiKey && nvidiaApiKey.trim() !== "" && nvidiaApiKey !== "your-api-key-here";
    const useAnthropic = anthropicApiKey && anthropicApiKey.trim() !== "" && anthropicApiKey !== "your-api-key-here";

    const lastMessage = messages[messages.length - 1]?.content?.toLowerCase() || "";

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

    // AUTO CHECKOUT AUTOMATION
    const checkoutPattern = /(?:buy|checkout|purchase)\s+(.+?)\s+on\s+(amazon|bestbuy|target|walmart)/i;
    const checkoutMatch = lastMessage.match(checkoutPattern);

    if (checkoutMatch) {
      const product = checkoutMatch[1].trim();
      const store = checkoutMatch[2].toLowerCase();
      
      try {
        console.log(`[Chat] Triggering Playwright auto-checkout for ${product} on ${store}...`);
        const { playwrightService } = await import('@/services/PlaywrightService');
        
        // Determine URL based on store
        let url = `https://www.${store}.com/s?k=${encodeURIComponent(product)}`;
        if (store === 'amazon') {
          url = `https://www.amazon.in/s?k=${encodeURIComponent(product)}`;
        }
        
        // Start checkout sequence
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
    const flightMatch = lastMessage.match(flightPattern);
    if (flightMatch) {
      const from = flightMatch[1].trim();
      const to = flightMatch[2].trim();
      const date = flightMatch[3]?.trim();
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
    const foodMatch = lastMessage.match(foodPattern);
    if (foodMatch) {
      const query = foodMatch[1].trim();
      const platform = foodMatch[2].toLowerCase() as 'zomato' | 'swiggy';
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

    // WHATSAPP MESSAGING AUTOMATION
    const whatsappPattern = /(?:send|message|text|whatsapp)\s+(?:on\s+)?whatsapp\s+(?:to\s+)?(.+?)\s+(?:saying|that|message)\s+(.+)/i;
    const whatsappMatch = lastMessage.match(whatsappPattern);
    if (whatsappMatch) {
      const contact = whatsappMatch[1].trim();
      const message = whatsappMatch[2].trim();
      try {
        console.log(`[Chat] Triggering WhatsApp message to "${contact}"`);
        const { playwrightService } = await import('@/services/PlaywrightService');
        playwrightService.sendWhatsApp(contact, message).catch(console.error);
        return NextResponse.json({
          content: `📱 Opening WhatsApp Web to message ${contact}. You may need to scan the QR code if this is the first time, Boss.`,
          playwrightAction: true
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
        const newsMatch = lastMessage.match(/(?:top\s+\d+\s+)?(.+?)\s*news/i);
        const searchMatch = lastMessage.match(/(?:search|look up|find|google)(?:\s+(?:for|about))?\s+(.+?)(?:\?|$)/i);

        if (newsMatch) {
          query = `${newsMatch[1]} news`;
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
      /^(hello|hi|hey)$/,
      /status|how are you/,
      /^help$/,
      /who are you|what are you/,
      /bye|goodbye/,
      /timer|countdown/,
    ];

    const shouldUseOffline = offlinePatterns.some(pattern => pattern.test(lastMessage));

    if (shouldUseOffline) {
      const rawOfflineResponse = generateOfflineResponse(lastMessage);
      const wrappedResponse = await applyPersonalityWrapper(rawOfflineResponse, nvidiaApiKey || "");
      return NextResponse.json({
        content: wrappedResponse,
        offline: true,
      });
    }

    if (!useNvidia && !useAnthropic) {
      const rawResponse = generateOfflineResponse(lastMessage);
      const wrappedResponse = await applyPersonalityWrapper(rawResponse, nvidiaApiKey || "");
      return NextResponse.json({
        content: wrappedResponse,
        offline: true,
      });
    }

    if (useNvidia) {
      try {
        const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${nvidiaApiKey}`,
          },
          body: JSON.stringify({
            model: process.env.NVIDIA_MODEL || "deepseek-ai/deepseek-v4-flash",
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
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error("NVIDIA API error:", response.status, errorText, "- Falling back to offline mode");
          const offlineResponse = generateOfflineResponse(lastMessage);
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
      } catch (fetchError) {
        console.error("Network error calling NVIDIA API:", fetchError, "- Falling back to offline mode");
        const offlineResponse = generateOfflineResponse(lastMessage);
        return NextResponse.json({
          content: offlineResponse,
          offline: true,
        });
      }
    }

    if (!anthropicApiKey) {
      const offlineResponse = generateOfflineResponse(lastMessage);
      return NextResponse.json({
        content: offlineResponse,
        offline: true,
      });
    }

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
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
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Claude API error:", response.status, errorText, "- Falling back to offline mode");
        const offlineResponse = generateOfflineResponse(lastMessage);
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
    } catch (fetchError) {
      console.error("Network error calling Claude API:", fetchError, "- Falling back to offline mode");
      const offlineResponse = generateOfflineResponse(lastMessage);
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
