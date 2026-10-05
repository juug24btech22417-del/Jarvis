(function () {
  // Prevent duplicate insertion
  if (document.getElementById("jarvis-proxy-wrapper")) return;

  console.log("[JARVIS] System loaded on page:", window.location.href);

  // 1. Create outer wrapper container
  const wrapper = document.createElement("div");
  wrapper.id = "jarvis-proxy-wrapper";
  wrapper.style.position = "fixed";
  wrapper.style.bottom = "20px";
  wrapper.style.right = "20px";
  wrapper.style.zIndex = "2147483647"; // Max index
  document.body.appendChild(wrapper);

  // 2. Create Shadow Root to isolate styles
  const shadow = wrapper.attachShadow({ mode: "open" });

  // 3. Inject CSS rules inside Shadow DOM
  const style = document.createElement("style");
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

    :host { all: initial; }

    * { box-sizing: border-box; }

    /* ── Glass command pill ──────────────────────────────────────── */
    .jarvis-bubble {
      position: relative;
      display: flex;
      align-items: center;
      gap: 11px;
      height: 52px;
      padding: 0 17px 0 12px;
      border-radius: 999px;
      overflow: hidden;
      cursor: pointer;
      background: linear-gradient(180deg, rgba(20, 34, 56, .82), rgba(7, 14, 28, .88));
      border: 1px solid rgba(56, 189, 248, .32);
      box-shadow:
        0 12px 34px rgba(0, 0, 0, .5),
        0 0 24px rgba(6, 182, 212, .26),
        inset 0 1px 0 rgba(186, 230, 253, .16);
      backdrop-filter: blur(16px) saturate(150%);
      transition: transform .26s cubic-bezier(.34,1.56,.64,1), box-shadow .26s ease, border-color .26s ease;
    }

    /* Slow sheen sweep — reads as "powered on" without being busy. */
    .jarvis-bubble::before {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      width: 42%;
      left: -60%;
      background: linear-gradient(100deg, transparent, rgba(125, 211, 252, .16), transparent);
      animation: sheen 5.5s ease-in-out infinite;
      pointer-events: none;
    }

    .jarvis-bubble:hover {
      transform: translateY(-2px);
      border-color: rgba(125, 211, 252, .8);
      box-shadow:
        0 16px 40px rgba(0, 0, 0, .55),
        0 0 34px rgba(6, 182, 212, .5),
        inset 0 1px 0 rgba(186, 230, 253, .22);
    }

    /* Core glyph: rotating ring around a glowing centre */
    .pill-core {
      position: relative;
      width: 28px;
      height: 28px;
      flex: none;
      display: grid;
      place-items: center;
    }

    .reactor-ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: conic-gradient(from 0deg,
        rgba(6,182,212,0) 0deg,
        rgba(56,189,248,.95) 80deg,
        rgba(147,197,253,.2) 150deg,
        rgba(6,182,212,0) 230deg,
        rgba(56,189,248,.8) 320deg,
        rgba(6,182,212,0) 360deg);
      -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px));
      mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px));
      animation: spin 5s linear infinite;
    }

    .reactor-core {
      width: 13px;
      height: 13px;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 30%, #e0f7ff 0%, #38bdf8 38%, #0891b2 70%, #083344 100%);
      box-shadow: 0 0 10px rgba(56,189,248,.95), 0 0 22px rgba(6,182,212,.55);
      transition: background .35s ease, box-shadow .35s ease;
    }

    .pill-label {
      font-family: 'Orbitron', sans-serif;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 2.6px;
      text-transform: uppercase;
      white-space: nowrap;
      color: #cbe9ff;
      text-shadow: 0 0 12px rgba(56,189,248,.4);
    }

    .jarvis-bubble .status-dot {
      width: 8px;
      height: 8px;
      flex: none;
      margin-left: 3px;
      border-radius: 50%;
      background: #22d3ee;
      box-shadow: 0 0 10px rgba(34, 211, 238, .95);
      transition: background .3s ease, box-shadow .3s ease;
    }

    /* ── Pill states ─────────────────────────────────────────────── */
    .jarvis-bubble.listening { border-color: rgba(248, 113, 113, .6); }
    .jarvis-bubble.listening .reactor-core {
      background: radial-gradient(circle at 35% 30%, #ffe4e6 0%, #f87171 40%, #dc2626 70%, #450a0a 100%);
      box-shadow: 0 0 12px #ef4444, 0 0 26px rgba(239,68,68,.6);
      animation: pulse 1.1s ease-in-out infinite;
    }
    .jarvis-bubble.listening .status-dot { background: #f87171; box-shadow: 0 0 10px #ef4444; }

    .jarvis-bubble.thinking .reactor-ring { animation-duration: 1.2s; }
    .jarvis-bubble.thinking .reactor-core {
      background: radial-gradient(circle at 35% 30%, #fef3c7 0%, #fbbf24 40%, #d97706 70%, #451a03 100%);
      box-shadow: 0 0 12px #fbbf24, 0 0 26px rgba(251,191,36,.55);
    }
    .jarvis-bubble.thinking .status-dot { background: #fbbf24; box-shadow: 0 0 10px #f59e0b; }

    .jarvis-bubble.speaking .reactor-core { animation: pulse .85s ease-in-out infinite; }
    .jarvis-bubble.speaking .status-dot { background: #34d399; box-shadow: 0 0 10px #10b981; }

    /* ── Command panel ──────────────────────────────────────────── */
    .jarvis-panel {
      position: absolute;
      bottom: 68px;
      right: 0;
      width: 404px;
      max-height: 560px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-radius: 18px;
      color: #e2e8f0;
      font-family: 'Inter', system-ui, sans-serif;
      background: linear-gradient(180deg, rgba(9,16,32,.97), rgba(5,10,22,.97));
      border: 1px solid rgba(56,189,248,.22);
      box-shadow: 0 24px 60px rgba(0,0,0,.6), inset 0 0 0 1px rgba(255,255,255,.03), 0 0 42px rgba(6,182,212,.14);
      backdrop-filter: blur(18px) saturate(150%);
      opacity: 0;
      transform: translateY(16px) scale(.97);
      transform-origin: bottom right;
      pointer-events: none;
      transition: opacity .3s ease, transform .32s cubic-bezier(.34,1.4,.64,1);
    }

    .jarvis-panel::before {
      content: "";
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(125,211,252,.75), transparent);
    }

    .jarvis-panel.open {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    .panel-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 13px 15px;
      background: rgba(10, 18, 34, .75);
      border-bottom: 1px solid rgba(56,189,248,.14);
    }

    .panel-avatar {
      width: 26px; height: 26px; flex: none;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 30%, #e0f7ff, #38bdf8 40%, #0e7490 100%);
      box-shadow: 0 0 12px rgba(56,189,248,.8);
      animation: pulse 3s ease-in-out infinite;
    }

    .panel-heading { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }

    .panel-title {
      margin: 0;
      font-family: 'Orbitron', sans-serif;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 2.4px;
      color: #7dd3fc;
      text-shadow: 0 0 12px rgba(56,189,248,.35);
    }

    .panel-status {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9.5px;
      letter-spacing: 1.6px;
      text-transform: uppercase;
      color: #38bdf8;
      opacity: .85;
    }

    .panel-close {
      width: 26px; height: 26px;
      display: grid; place-items: center;
      border-radius: 8px;
      cursor: pointer;
      color: #94a3b8;
      font-size: 13px;
      transition: background .2s, color .2s;
    }
    .panel-close:hover { background: rgba(239,68,68,.16); color: #fca5a5; }

    /* Voice-reply toggle — off by default, because the overlay rides on every
       page and speaking every answer unprompted gets old fast. */
    .panel-tts {
      width: 26px; height: 26px;
      display: grid; place-items: center;
      border: 1px solid rgba(56,189,248,.2);
      background: rgba(6,12,24,.6);
      border-radius: 8px;
      cursor: pointer;
      font-size: 12px;
      line-height: 1;
      color: #7dd3fc;
      transition: background .2s, border-color .2s, color .2s;
    }
    .panel-tts:hover { background: rgba(56,189,248,.14); border-color: rgba(56,189,248,.55); }
    .panel-tts.on { background: rgba(52,211,153,.16); border-color: rgba(52,211,153,.6); color: #6ee7b7; }

    .panel-display {
      flex: 1;
      min-height: 120px;
      max-height: 340px;
      padding: 16px 15px 6px;
      overflow-y: auto;
      font-size: 13px;
      line-height: 1.62;
      scroll-behavior: smooth;
    }
    .panel-display::-webkit-scrollbar { width: 6px; }
    .panel-display::-webkit-scrollbar-thumb { background: rgba(56,189,248,.28); border-radius: 999px; }

    .chat-bubble { margin-bottom: 15px; animation: rise .32s ease both; }

    .message-role {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 5px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 9.5px;
      letter-spacing: 1.4px;
      text-transform: uppercase;
    }
    .role-jarvis { color: #38bdf8; }
    .role-user { color: #94a3b8; }
    .message-role::before {
      content: "";
      width: 6px; height: 6px;
      border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 8px currentColor;
    }

    .chat-text {
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(17, 27, 46, .72);
      border: 1px solid rgba(56,189,248,.12);
      border-left: 2px solid rgba(56,189,248,.6);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .chat-bubble.from-user .chat-text {
      background: rgba(13, 20, 36, .6);
      border-left-color: rgba(148,163,184,.5);
    }

    /* Animated typing dots */
    .typing { display: inline-flex; align-items: center; gap: 4px; padding: 2px 0; }
    .typing i {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #38bdf8;
      animation: blink 1.2s infinite ease-in-out;
    }
    .typing i:nth-child(2) { animation-delay: .18s; }
    .typing i:nth-child(3) { animation-delay: .36s; }

    .panel-input-container {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 11px 12px;
      background: rgba(10, 18, 34, .8);
      border-top: 1px solid rgba(56,189,248,.14);
    }

    .panel-input {
      flex: 1;
      min-width: 0;
      padding: 10px 12px;
      border-radius: 10px;
      background: rgba(6, 12, 24, .8);
      border: 1px solid rgba(56,189,248,.2);
      color: #f8fafc;
      font-family: inherit;
      font-size: 13px;
      outline: none;
      transition: border-color .2s, box-shadow .2s;
    }
    .panel-input::placeholder { color: #64748b; }
    .panel-input:focus {
      border-color: rgba(56,189,248,.75);
      box-shadow: 0 0 0 3px rgba(56,189,248,.12);
    }

    .mic-btn, .send-btn {
      width: 36px; height: 36px;
      flex: none;
      display: grid; place-items: center;
      border-radius: 10px;
      background: rgba(6, 12, 24, .8);
      border: 1px solid rgba(56,189,248,.2);
      color: #7dd3fc;
      font-size: 14px;
      cursor: pointer;
      transition: background .2s, border-color .2s, transform .15s;
    }
    .mic-btn:hover, .send-btn:hover { background: rgba(56,189,248,.14); border-color: rgba(56,189,248,.55); }
    .mic-btn:active, .send-btn:active { transform: scale(.94); }
    .mic-btn.active { background: rgba(239,68,68,.18); border-color: #ef4444; color: #fca5a5; }
    .send-btn { background: linear-gradient(180deg, rgba(56,189,248,.22), rgba(6,182,212,.16)); color: #e0f7ff; }

    .panel-hint {
      padding: 0 12px 9px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      letter-spacing: 1px;
      color: #64748b;
      text-align: right;
    }

    /* ── Animations ─────────────────────────────────────────────── */
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .72; transform: scale(.9); } }
    @keyframes sheen {
      0% { left: -60%; }
      55%, 100% { left: 130%; }
    }
    @keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    @keyframes blink {
      0%, 80%, 100% { opacity: .25; transform: translateY(0); }
      40% { opacity: 1; transform: translateY(-2px); }
    }

    @media (prefers-reduced-motion: reduce) {
      .jarvis-bubble, .jarvis-bubble::before, .reactor-ring, .panel-avatar { animation: none !important; }
    }
  `;
  shadow.appendChild(style);

  // 4. Create HTML Structure inside Shadow DOM
  const bubble = document.createElement("div");
  bubble.className = "jarvis-bubble";
  bubble.innerHTML = `
    <span class="pill-core">
      <span class="reactor-ring"></span>
      <span class="reactor-core"></span>
    </span>
    <span class="pill-label">Ask JARVIS</span>
    <span class="status-dot"></span>
  `;

  const panel = document.createElement("div");
  panel.className = "jarvis-panel";
  panel.innerHTML = `
    <div class="panel-header">
      <div class="panel-avatar"></div>
      <div class="panel-heading">
        <h3 class="panel-title">J.A.R.V.I.S.</h3>
        <span class="panel-status" id="jarvis-status">Online · ready</span>
      </div>
      <button class="panel-tts" id="jarvis-tts" title="Voice replies: off">🔇</button>
      <div class="panel-close" title="Close">✕</div>
    </div>
    <div class="panel-display" id="jarvis-display">
      <div class="chat-bubble">
        <div class="message-role role-jarvis">J.A.R.V.I.S.</div>
        <div class="chat-text">At your service, Boss. I can read this page, answer questions, act on it, and control this machine — all from here.</div>
      </div>
    </div>
    <div class="panel-input-container">
      <input type="text" class="panel-input" placeholder="Ask about this page, or give a command…" id="jarvis-input" />
      <button class="mic-btn" title="Voice input" id="jarvis-mic">🎙</button>
      <button class="send-btn" title="Send (Enter)" id="jarvis-send">➤</button>
    </div>
    <div class="panel-hint">⏎ send · Ctrl+Shift+J toggle · Ctrl+Space polish</div>
  `;

  shadow.appendChild(bubble);
  shadow.appendChild(panel);

  // 5. DOM References
  const display = shadow.getElementById("jarvis-display");
  const input = shadow.getElementById("jarvis-input");
  const micBtn = shadow.getElementById("jarvis-mic");
  const sendBtn = shadow.getElementById("jarvis-send");
  const statusEl = shadow.getElementById("jarvis-status");
  const ttsBtn = shadow.getElementById("jarvis-tts");
  const closeBtn = panel.querySelector(".panel-close");

  // Voice REPLIES are off by default. The mic button controls voice INPUT;
  // this controls whether JARVIS speaks its answers back. Injected into every
  // page, an always-speaking assistant is a nuisance — the user turns it on.
  let ttsEnabled = false;
  function setTts(on) {
    ttsEnabled = on;
    if (!ttsBtn) return;
    ttsBtn.classList.toggle("on", on);
    ttsBtn.textContent = on ? "🔊" : "🔇";
    ttsBtn.title = on ? "Voice replies: on" : "Voice replies: off";
  }
  setTts(false);
  if (ttsBtn) ttsBtn.addEventListener("click", () => setTts(!ttsEnabled));

  // Orb state machine — drives the colour/animation so the assistant visibly
  // reflects what it is doing (idle · listening · thinking · speaking).
  const ORB_STATES = ["listening", "thinking", "speaking"];
  const IDLE_LABEL = "Online · ready";
  function setOrbState(state, label) {
    ORB_STATES.forEach((s) => bubble.classList.toggle(s, s === state));
    if (statusEl) statusEl.textContent = label || IDLE_LABEL;
  }

  let isSpeechActive = false;
  let recognition = null;

  // Initialize Speech Recognition
  if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRec();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      isSpeechActive = true;
      micBtn.classList.add("active");
      setOrbState("listening", "Listening…");
    };

    recognition.onend = () => {
      isSpeechActive = false;
      micBtn.classList.remove("active");
      setOrbState(null);
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      input.value = transcript;
      handleSendCommand(transcript);
    };

    recognition.onerror = (err) => {
      console.error("[Speech Recognition Error]:", err);
      isSpeechActive = false;
      micBtn.classList.remove("active");
      setOrbState(null);
    };
  } else {
    micBtn.style.display = "none"; // Hide if speech recognition is unsupported
  }

  // 6. UI Interaction Handlers
  bubble.addEventListener("click", () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) {
      input.focus();
    }
  });

  closeBtn.addEventListener("click", () => {
    panel.classList.remove("open");
  });

  // Global toggle shortcut (Ctrl + Shift + J)
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === "J") {
      e.preventDefault();
      panel.classList.toggle("open");
      if (panel.classList.contains("open")) {
        input.focus();
      }
    }
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const val = input.value.trim();
      if (val) {
        handleSendCommand(val);
      }
    }
  });

  sendBtn.addEventListener("click", () => {
    const val = input.value.trim();
    if (val) {
      handleSendCommand(val);
    }
  });

  micBtn.addEventListener("click", () => {
    if (!recognition) return;
    if (isSpeechActive) {
      recognition.stop();
    } else {
      recognition.start();
    }
  });

  // 7. Core Command Sender Logic
  async function handleSendCommand(queryText) {
    input.value = "";
    addChatBubble("You", queryText, "role-user");

    const typingBubble = addChatBubble("J.A.R.V.I.S.", '<span class="typing"><i></i><i></i><i></i></span>', "role-jarvis");
    setOrbState("thinking", "Working…");
    const lowerQuery = queryText.toLowerCase().trim();

    // ── Phase 4: Speech-to-OS Intent Detection ──────────────────────────────
    // Match OS commands BEFORE hitting the LLM, so they're instant and offline.
    const osPayload = detectOSIntent(lowerQuery);
    if (osPayload) {
      typingBubble.querySelector(".chat-text").innerText = `⚙️ Executing: ${osPayload.description}…`;
      try {
        // Route through /__jarvis_os (intercepted by the MITM proxy server-side).
        // This avoids the browser mixed-content block that fires when the overlay
        // is injected into an HTTPS page (e.g. YouTube) and tries to fetch HTTP.
        const osRes = await fetch("/__jarvis_os", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(osPayload),
        });
        const osData = await osRes.json();
        if (osData.success) {
          const msg = `✅ Done, Boss. ${osData.description}.`;
          typingBubble.querySelector(".chat-text").innerText = msg;
          if (ttsEnabled) speakText(msg);
        } else {
          typingBubble.querySelector(".chat-text").innerText = `⚠️ OS command failed: ${osData.error}`;
        }
      } catch (e) {
        typingBubble.querySelector(".chat-text").innerText = `⚠️ Could not reach OS bridge: ${e.message}`;
      }
      display.scrollTop = display.scrollHeight;
      setOrbState(null);
      return; // Skip LLM entirely
    }
    // ── End Speech-to-OS ─────────────────────────────────────────────────────

    // Extract DOM content (visible text nodes)
    const domText = getPageTextContent();

    // Detect vision keywords — triggers a live screenshot capture
    const visionKeywords = [
      "what's on screen", "whats on screen", "what do you see", "look at this",
      "analyze this page", "describe this page", "read this chart", "read this graph",
      "what is on my screen", "screenshot", "see this", "analyze the screen",
      "what does this page look like", "what's visible", "check this page visually"
    ];
    const captureScreenshot = visionKeywords.some((kw) => lowerQuery.includes(kw));

    if (captureScreenshot) {
      typingBubble.querySelector(".chat-text").innerText = "Scanning your screen, Boss. One moment...";
    }

    try {
      const res = await fetch("/__jarvis_chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: queryText,
          url: window.location.href,
          domContent: domText,
          captureScreenshot,
        }),
      });

      // Parse the body even on a non-2xx status: the proxy puts the real
      // reason (which provider failed, rate limits, timeouts) in `error`, and
      // showing that beats a bare status code.
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || `Server error ${res.status}`);
      }

      if (!data || data.success === false) {
        typingBubble.querySelector(".chat-text").innerText =
          `Apologies, Boss. ${data?.error || "I couldn't parse that response."}`;
      } else {
        typingBubble.querySelector(".chat-text").innerText = data.response;
        if (ttsEnabled) speakText(data.response);

        // Execute browser action if LLM returned one
        if (data.action) {
          const actionResult = executeAction(data.action);
          if (actionResult) {
            addChatBubble("J.A.R.V.I.S.", `⚙️ Action executed: ${actionResult}`, "role-jarvis");
          }
        }
      }
    } catch (e) {
      typingBubble.querySelector(".chat-text").innerText = `Apologies, Boss. ${e.message}`;
    }
    
    // Auto-scroll display to bottom
    display.scrollTop = display.scrollHeight;
    setOrbState(null);
  }

  // ── OS Intent Detector ─────────────────────────────────────────────────────
  // Returns a payload for /api/os/command, or null if no OS intent matched.
  function detectOSIntent(q) {
    // Open app patterns
    const openApp = q.match(/^(?:open|launch|start|run|load)\s+(.+)/);
    if (openApp) {
      const target = openApp[1].trim();
      // If it looks like a URL, open it in browser
      if (/^https?:\/\//.test(target) || target.includes(".com") || target.includes(".io")) {
        const url = target.startsWith("http") ? target : `https://${target}`;
        return { command: "open_url", url, description: `Opening ${url}` };
      }
      return { command: "open_app", app: target, description: `Launching ${target}` };
    }

    // Web search
    const search = q.match(/^(?:search|google|look up|find)\s+(?:for\s+)?(.+)/);
    if (search) {
      return { command: "web_search", query: search[1].trim(), description: `Searching for "${search[1].trim()}"` };
    }

    // Volume controls
    if (/\b(?:volume up|louder|increase volume)\b/.test(q)) return { command: "volume_up", description: "Increasing volume" };
    if (/\b(?:volume down|quieter|decrease volume|lower volume)\b/.test(q)) return { command: "volume_down", description: "Decreasing volume" };
    if (/\b(?:mute|unmute|silence)\b/.test(q)) return { command: "mute", description: "Toggling mute" };

    // System actions
    if (/\b(?:lock|lock (?:the )?(?:screen|computer|pc|workstation))\b/.test(q)) return { command: "lock", description: "Locking workstation" };
    if (/\b(?:sleep|hibernate|put (?:the )?computer to sleep)\b/.test(q)) return { command: "sleep", description: "Sleeping system" };
    if (/\b(?:take a screenshot|screenshot|capture screen)\b/.test(q)) return { command: "screenshot", description: "Taking screenshot" };

    // Shutdown / cancel
    if (/\b(?:shutdown|shut down|power off|turn off)\b/.test(q)) return { command: "shutdown", description: "Shutdown in 30 seconds" };
    if (/\b(?:cancel shutdown|abort shutdown)\b/.test(q)) return { command: "cancel_shutdown", description: "Cancelling shutdown" };

    // Kill a process: "kill chrome", "close spotify"
    const kill = q.match(/^(?:kill|close|quit|exit|force quit)\s+(.+)/);
    if (kill) {
      const app = kill[1].trim().replace(/\s+/g, "");
      return { command: "kill_app", app, description: `Closing ${kill[1].trim()}` };
    }

    return null; // No OS intent — fall through to LLM
  }



  function addChatBubble(role, text, roleClass) {
    const chatBubble = document.createElement("div");
    chatBubble.className = "chat-bubble" + (roleClass === "role-user" ? " from-user" : "");
    chatBubble.innerHTML = `
      <div class="message-role ${roleClass}">${role}</div>
      <div class="chat-text">${text}</div>
    `;
    display.appendChild(chatBubble);
    display.scrollTop = display.scrollHeight;
    return chatBubble;
  }

  // 8b. Action Executor — runs DOM actions returned by the LLM
  function executeAction(action) {
    try {
      switch (action.action) {
        case "click": {
          const el = document.querySelector(action.selector);
          if (!el) return `Could not find element: ${action.selector}`;
          el.click();
          return `Clicked "${action.selector}"`;
        }
        case "scroll": {
          const amount = action.amount || 300;
          const dir = action.direction === "up" ? -amount : amount;
          window.scrollBy({ top: dir, behavior: "smooth" });
          return `Scrolled ${action.direction || "down"} by ${amount}px`;
        }
        case "fill": {
          const input = document.querySelector(action.selector);
          if (!input) return `Could not find input: ${action.selector}`;
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          nativeInputValueSetter.call(input, action.value || "");
          input.dispatchEvent(new Event("input", { bubbles: true }));
          return `Filled "${action.selector}" with "${action.value}"`;
        }
        case "navigate": {
          if (!action.url) return "Navigate action missing URL";
          window.location.href = action.url;
          return `Navigating to ${action.url}`;
        }
        default:
          return `Unknown action type: ${action.action}`;
      }
    } catch (e) {
      console.error("[JARVIS] Action execution error:", e);
      return `Action failed: ${e.message}`;
    }
  }

  // 8. Helper to Scrape Webpage Text Content
  function getPageTextContent() {
    // Basic selector logic to extract meaningful visible elements on current page
    const elements = document.querySelectorAll("h1, h2, h3, h4, h5, p, span, td, li");
    let textLines = [];
    let characterCount = 0;

    for (let i = 0; i < elements.length; i++) {
      const text = elements[i].textContent.trim();
      if (text.length > 20 && elements[i].offsetParent !== null) { // Check length and if visible
        textLines.push(text);
        characterCount += text.length;
        if (characterCount > 8000) break; // Keep payload under 8000 chars
      }
    }
    return textLines.join("\n\n");
  }

  // 9. British Voice Speech Synthesis Fallback
  function speakText(text) {
    if (!("speechSynthesis" in window)) return;
    
    // Stop any ongoing voice output first
    window.speechSynthesis.cancel();

    // Clean markdown/asterisks for voice synthesis
    const cleanText = text.replace(/[*#_\-\`]/g, "");

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.onstart = () => setOrbState("speaking", "Speaking…");
    utterance.onend = () => setOrbState(null);
    utterance.onerror = () => setOrbState(null);
    
    // Try to find a nice British English voice
    const voices = window.speechSynthesis.getVoices();
    const britishVoice = voices.find(
      (voice) => voice.lang.includes("en-GB") || voice.name.toLowerCase().includes("british")
    );
    if (britishVoice) {
      utterance.voice = britishVoice;
    }
    
    utterance.rate = 1.05; // Slightly faster for responsiveness
    utterance.pitch = 0.95; // Slightly lower pitch for mature voice
    window.speechSynthesis.speak(utterance);
  }

  // 10. Inline Co-Pilot Event Listener (Ctrl + Space)
  document.addEventListener("keydown", async (e) => {
    const target = e.target;
    const isInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
    
    // Check for Ctrl + Space on an input/textarea element
    if (isInput && e.ctrlKey && e.code === "Space") {
      e.preventDefault();
      e.stopPropagation();

      const originalVal = target.value;
      if (!originalVal.trim()) return;

      const originalPlaceholder = target.placeholder;
      target.disabled = true;
      target.placeholder = "J.A.R.V.I.S. is polishing text...";
      target.value = "Scanning & rewriting...";

      try {
        const res = await fetch("/__jarvis_chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: originalVal,
            url: window.location.href,
            domContent: "",
            copilot: true,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.success && data.response) {
            // Safely set the input value using descriptor to trigger framework updates
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
              target.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
              "value"
            ).set;
            nativeInputValueSetter.call(target, data.response.trim());
            target.dispatchEvent(new Event("input", { bubbles: true }));
          } else {
            target.value = originalVal;
          }
        } else {
          target.value = originalVal;
        }
      } catch (err) {
        console.error("[JARVIS Co-Pilot Error]:", err);
        target.value = originalVal;
      } finally {
        target.disabled = false;
        target.placeholder = originalPlaceholder;
        target.focus();
      }
    }
  }, true); // Use capture phase to intercept before page listeners
})();

