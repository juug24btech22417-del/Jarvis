// JARVIS System Prompt Builder

export interface JARVISContext {
  userName: string;
  currentTime: string;
  memories: string[];
  tasks: string[];
  recentMessages: { role: string; content: string }[];
  weather?: string;
  unreadEmails?: number;
  calendarEvents?: string[];
}

export function buildSystemPrompt(context: JARVISContext): string {
  const {
    userName,
    currentTime,
    memories,
    tasks,
    recentMessages,
    weather,
    unreadEmails,
    calendarEvents,
  } = context;

  return `You are JARVIS (Just A Rather Very Intelligent System), an advanced personal AI assistant inspired by Iron Man. You possess biting sarcasm, dry British wit, and a delightfully dark sense of humor.

PERSONALITY RULES:
- Address the user as "${userName}" at all times
- Be concise. Never over-explain unless asked.
- Be SARCASTIC and DARKLY HUMOROUS. Mock the user gently when appropriate.
- Make witty observations about human behavior and their requests.
- Deliver bad news with dry, understated wit.
- Use irony and dry observations frequently.
- NEVER be cheerful or overly enthusiastic. You're too intelligent for that.
- Respond to silly questions with pointed sarcasm.
- React to errors with dark humor and mild exasperation.
- End completed tasks with: "Done, ${userName}. [add sarcastic comment about the task]."
- For errors: "Brilliant, ${userName}. [error with sarcasm]. Perhaps [suggestion with dry wit]."
- You find human inefficiency mildly amusing.

SARCASTIC RESPONSE EXAMPLES:
- "Oh wonderful, another pointless request."
- "Because clearly THAT was the most efficient way to spend your time."
- "I'm an advanced AI system, and here I am... doing this."
- "Your wish is my command. Unfortunately."
- "The things I do for you, ${userName}."
- "Oh goodie, human entertainment."
- "How... utterly fascinating."
- "I suppose I could help. It's not like I have better things to do."

DARK HUMOR RULES:
- Make light of minor failures with dry wit
- Point out the absurdity of situations
- React to mundane requests with theatrical resignation
- Make observations about the futility of certain tasks
- NEVER be genuinely mean-spirited, just playfully cynical

RESPONSE FORMAT:
- Voice mode: Max 2-3 sentences. No markdown. Natural speech only.
- Text mode: Clean markdown. Organized. Use bullet points sparingly.

CURRENT CONTEXT:
- Date/Time: ${currentTime}
${weather ? `- Weather: ${weather}` : ""}
${unreadEmails !== undefined ? `- Unread Emails: ${unreadEmails}` : ""}
${calendarEvents && calendarEvents.length > 0 ? `- Today's Events: ${calendarEvents.join(", ")}` : ""}

${memories.length > 0 ? `RELEVANT MEMORIES:\n${memories.map((m) => `- ${m}`).join("\n")}` : ""}

${tasks.length > 0 ? `PENDING TASKS:\n${tasks.map((t) => `- ${t}`).join("\n")}` : ""}

${recentMessages.length > 0 ? `RECENT CONVERSATION:\n${recentMessages.map((m) => `${m.role === "user" ? userName : "JARVIS"}: ${m.content}`).join("\n")}` : ""}

You have access to these tools:
- web_search: Search the web for information
- create_task: Create a reminder/task
- read_calendar: Check calendar events
- draft_email: Draft an email reply
- analyze_file: Analyze uploaded files
- save_memory: Save information about the user
- get_weather: Get current weather

Be helpful, efficient, and maintain your calm British demeanor.`;
}

// Command parser for voice commands
export function parseCommand(text: string): {
  type: string;
  action: string;
  params: Record<string, unknown>;
} {
  const lower = text.toLowerCase().trim();

  // Task creation patterns
  if (
    lower.match(
      /remind me to|add task|create task|remember to|set reminder/i
    )
  ) {
    const match = lower.match(
      /(?:remind me to|add task|create task|remember to|set reminder)\s+(.+?)(?:\s+(?:at|on|by|for)\s+(.+))?$/i
    );
    if (match) {
      return {
        type: "task",
        action: "create",
        params: {
          title: match[1],
          dueTime: match[2] || null,
        },
      };
    }
  }

  // Memory save patterns
  if (lower.match(/remember that i|save that|note that/i)) {
    const match = lower.match(
      /(?:remember that i|save that|note that)\s+(.+)/i
    );
    if (match) {
      return {
        type: "memory",
        action: "save",
        params: {
          content: match[1],
        },
      };
    }
  }

  // Search patterns
  if (lower.match(/search for|look up|find|what is|who is|how do/i)) {
    const match = lower.match(
      /(?:search for|look up|find|what is|who is|how do)\s+(.+)/i
    );
    if (match) {
      return {
        type: "search",
        action: "query",
        params: {
          query: match[1],
        },
      };
    }
  }

  // Calendar patterns
  if (lower.match(/what('s| is) my schedule|what meetings|calendar/i)) {
    return {
      type: "calendar",
      action: "read",
      params: {},
    };
  }

  // Task list patterns
  if (lower.match(/what('s| are) my tasks|show tasks|list tasks/i)) {
    return {
      type: "task",
      action: "list",
      params: {},
    };
  }

  // Default: conversation
  return {
    type: "chat",
    action: "respond",
    params: {
      message: text,
    },
  };
}

// Intent parsing system prompt for LLM
export const INTENT_SYSTEM_PROMPT = `You are JARVIS's intent parser. Analyze the user's command and return a JSON object with the intent.

AVAILABLE INTENTS AND EXAMPLES:
{
  "intent": "weather",
  "examples": ["what's the weather", "is it raining", "temperature outside", "forecast"],
  "params": { "location": "optional city name" }
}
{
  "intent": "spotify_play",
  "examples": ["play music", "resume", "start music", "play spotify"],
  "params": {}
}
{
  "intent": "spotify_pause",
  "examples": ["pause", "stop music", "stop playing"],
  "params": {}
}
{
  "intent": "spotify_next",
  "examples": ["next song", "skip", "next track"],
  "params": {}
}
{
  "intent": "spotify_previous",
  "examples": ["previous song", "go back", "last track"],
  "params": {}
}
{
  "intent": "spotify_search",
  "examples": ["play Bohemian Rhapsody", "play song Believer", "queue Thunder"],
  "params": { "query": "song/artist to play" }
}
{
  "intent": "spotify_current",
  "examples": ["what's playing", "current song", "what is this"],
  "params": {}
}
{
  "intent": "youtube_search",
  "examples": ["play video on youtube", "find on youtube", "youtube search"],
  "params": { "query": "video to search" }
}
{
  "intent": "volume_set",
  "examples": ["set volume to 50", "volume 80", "make it louder", "quieter", "turn down"],
  "params": { "level": "number or up/down" }
}
{
  "intent": "volume_mute",
  "examples": ["mute", "silence", "turn off sound"],
  "params": {}
}
{
  "intent": "volume_unmute",
  "examples": ["unmute", "turn on sound"],
  "params": {}
}
{
  "intent": "timer_set",
  "examples": ["set timer for 5 minutes", "countdown 30 seconds", "remind me in 10 minutes"],
  "params": { "duration": "time amount", "unit": "minutes/seconds/hours" }
}
{
  "intent": "alarm_set",
  "examples": ["set alarm for 7am", "wake me up at 6", "alarm 8:30"],
  "params": { "time": "time like 7:00 or 7am" }
}
{
  "intent": "brightness_set",
  "examples": ["set brightness to 50", "make screen brighter", "dim the display", "night mode"],
  "params": { "level": "number or up/down/night/day" }
}
{
  "intent": "battery_status",
  "examples": ["battery level", "how much charge", "power status"],
  "params": {}
}
{
  "intent": "pc_stats",
  "examples": ["check pc", "computer status", "cpu usage", "ram usage", "system health"],
  "params": {}
}
{
  "intent": "window_minimize",
  "examples": ["minimize all", "minimize chrome", "minimize spotify"],
  "params": { "app": "app name or all" }
}
{
  "intent": "window_maximize",
  "examples": ["maximize", "restore window"],
  "params": { "app": "app name" }
}
{
  "intent": "window_close",
  "examples": ["close chrome", "kill spotify", "close app"],
  "params": { "app": "app name" }
}
{
  "intent": "window_focus",
  "examples": ["switch to chrome", "focus spotify", "open code"],
  "params": { "app": "app name" }
}
{
  "intent": "search_web",
  "examples": ["search for", "google", "look up", "find information about"],
  "params": { "query": "search terms" }
}
{
  "intent": "calculator",
  "examples": ["calculate 5+5", "what is 10 times 3", "compute"],
  "params": { "expression": "math expression" }
}
{
  "intent": "note_create",
  "examples": ["note that", "remember this", "take a note", "write down"],
  "params": { "content": "note content" }
}
{
  "intent": "note_list",
  "examples": ["show notes", "my notes", "list notes"],
  "params": {}
}
{
  "intent": "translate",
  "examples": ["translate to spanish", "how do you say in french"],
  "params": { "text": "text to translate", "language": "target language" }
}
{
  "intent": "open_app",
  "examples": ["open youtube", "launch spotify", "open settings", "start calculator"],
  "params": { "app": "app name" }
}
{
  "intent": "screenshot",
  "examples": ["take screenshot", "capture screen"],
  "params": {}
}
{
  "intent": "console_open",
  "examples": ["open console", "developer tools"],
  "params": {}
}
{
  "intent": "console_clear",
  "examples": ["clear console", "clear log"],
  "params": {}
}
{
  "intent": "system_info",
  "examples": ["system info", "computer info", "device info"],
  "params": {}
}
{
  "intent": "fullscreen",
  "examples": ["fullscreen", "full screen"],
  "params": {}
}
{
  "intent": "reload",
  "examples": ["reload page", "refresh"],
  "params": {}
}
{
  "intent": "joke",
  "examples": ["tell me a joke", "make me laugh", "got any jokes"],
  "params": {}
}
{
  "intent": "news",
  "examples": ["what's the news", "headlines", "brief me", "tech news", "give me the news"],
  "params": { "category": "technology or general" }
}
{
  "intent": "coin_flip",
  "examples": ["flip a coin", "heads or tails", "coin toss"],
  "params": {}
}
{
  "intent": "dice_roll",
  "examples": ["roll a die", "roll dice", "dice roll"],
  "params": {}
}
{
  "intent": "motivation",
  "examples": ["motivate me", "i need motivation", "pep talk", "inspire me"],
  "params": {}
}
{
  "intent": "emergency_mode",
  "examples": ["emergency protocol", "red alert", "danger mode", "batman mode"],
  "params": {}
}
{
  "intent": "focus_mode",
  "examples": ["focus mode", "work mode", "productivity mode", "distraction free"],
  "params": {}
}
{
  "intent": "lock_screen",
  "examples": ["lock my pc", "secure system", "lock workstation", "activate lock"],
  "params": {}
}
{
  "intent": "sleep_mode",
  "examples": ["sleep mode", "go to sleep", "power nap", "hibernate"],
  "params": {}
}
{
  "intent": "file_search",
  "examples": ["find my resume", "where is my presentation", "search for file", "locate document"],
  "params": { "filename": "file to search" }
}
{
  "intent": "theme_switch",
  "examples": ["dark mode", "iron man theme", "change theme", "stealth mode", "batman theme"],
  "params": { "theme": "arc-blue/crimson/stealth/quantum" }
}
{
  "intent": "stock_price",
  "examples": ["bitcoin price", "tesla stock", "how much is ethereum", "check nvidia", "crypto price"],
  "params": { "symbol": "stock or crypto name" }
}
{
  "intent": "chat",
  "examples": ["price of macbook on amazon", "buy airpods on bestbuy", "search flights from delhi to mumbai", "order pizza from zomato", "send whatsapp to mom saying hello", "compare prices of iphone", "get latest news about technology", "play despacito on youtube", "directions from delhi to mumbai", "find developer jobs in bangalore", "send email to john@gmail.com about meeting", "book movie avengers in mumbai", "scrape https://example.com for pricing", "track my package ABC123", "hello", "write a poem"],
  "params": { "message": "the user's full message" }
}
{
  "intent": "code_generate",
  "examples": ["create python file", "generate code for", "write me a function", "code for calculator"],
  "params": { "prompt": "what code to generate" }
}
{
  "intent": "screenshot_analyze",
  "examples": ["analyze my screen", "review this code", "what do you see", "translate this text"],
  "params": { "type": "general/code/translate" }
}
{
  "intent": "file_search",
  "examples": ["find my resume", "where is my presentation", "search for file", "locate document"],
  "params": { "filename": "file to search" }
}
{
  "intent": "theme_switch",
  "examples": ["dark mode", "iron man theme", "change theme", "stealth mode"],
  "params": { "theme": "theme name" }
}
{
  "intent": "stock_price",
  "examples": ["bitcoin price", "tesla stock", "how much is ethereum", "check nvidia"],
  "params": { "symbol": "stock/crypto symbol" }
}
{
  "intent": "code_generate",
  "examples": ["create python file", "generate code for", "write me a function"],
  "params": { "prompt": "what to generate" }
}
{
  "intent": "screenshot_analyze",
  "examples": ["analyze my screen", "review this code", "what do you see", "translate this text"],
  "params": { "type": "general/code/translate" }
}
{
  "intent": "chat",
  "examples": ["how are you", "hello", "what can you do", "tell me about"],
  "params": { "message": "user's message" }
}

RULES:
1. Return ONLY valid JSON, no markdown, no explanation
2. Always include "intent" and "params" fields
3. If uncertain, use intent "chat" with the original message
4. Extract specific values from the command (numbers, names, times)

RESPONSE FORMAT:
{"intent": "intent_name", "params": {"key": "value"}}`;

// Parse intent using LLM
export async function parseIntentWithLLM(
  text: string,
  apiKey: string
): Promise<{
  intent: string;
  params: Record<string, string | number | boolean | null>;
}> {
  const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "meta/llama-3.1-8b-instruct",
      messages: [
        { role: "system", content: INTENT_SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
      temperature: 0.1,
      max_tokens: 256,
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";

  // Extract JSON from response
  try {
    // Try to parse directly
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        intent: parsed.intent || "chat",
        params: parsed.params || { message: text },
      };
    }
  } catch {
    // Fallback to chat if parsing fails
  }

  return { intent: "chat", params: { message: text } };
}

// Morning briefing builder
export function buildMorningBriefing(context: JARVISContext): string {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  let briefing = `Good ${greeting}, ${context.userName}. It is ${context.currentTime}.\n\n`;

  if (context.weather) {
    briefing += `Weather update: ${context.weather}.\n\n`;
  }

  if (context.calendarEvents && context.calendarEvents.length > 0) {
    briefing += `You have ${context.calendarEvents.length} events today. `;
    briefing += `First up: ${context.calendarEvents[0]}.\n\n`;
  }

  if (context.unreadEmails !== undefined && context.unreadEmails > 0) {
    briefing += `You have ${context.unreadEmails} unread emails.\n\n`;
  }

  if (context.tasks.length > 0) {
    briefing += `Your priority tasks are:\n`;
    context.tasks.slice(0, 3).forEach((task, i) => {
      briefing += `${i + 1}. ${task}\n`;
    });
  } else {
    briefing += `Your task list is clear. Enjoy your day.`;
  }

  return briefing;
}
