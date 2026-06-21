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
    @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=Inter:wght@300;400;600&display=swap');

    :host {
      all: initial;
    }

    * {
      box-sizing: border-box;
    }

    /* Floating Bubble */
    .jarvis-bubble {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: rgba(10, 15, 30, 0.85);
      border: 2px solid rgba(6, 182, 212, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 0 20px rgba(6, 182, 212, 0.3), inset 0 0 10px rgba(6, 182, 212, 0.2);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      backdrop-filter: blur(12px);
      position: relative;
    }

    .jarvis-bubble:hover {
      transform: scale(1.08) rotate(45deg);
      border-color: rgba(6, 182, 212, 0.8);
      box-shadow: 0 0 25px rgba(6, 182, 212, 0.6), inset 0 0 15px rgba(6, 182, 212, 0.3);
    }

    /* Outer Core (Pulsing ring) */
    .reactor-ring {
      position: absolute;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: 3px double rgba(6, 182, 212, 0.6);
      animation: spin 8s linear infinite;
    }

    /* Inner Core (Glowing center) */
    .reactor-core {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #06b6d4;
      box-shadow: 0 0 15px #06b6d4, 0 0 30px #06b6d4;
      transition: background 0.3s;
    }

    .jarvis-bubble.listening .reactor-core {
      background: #ef4444;
      box-shadow: 0 0 15px #ef4444, 0 0 30px #ef4444;
      animation: pulse 1.2s ease-in-out infinite;
    }

    /* Command Window */
    .jarvis-panel {
      position: absolute;
      bottom: 80px;
      right: 0;
      width: 420px;
      max-height: 520px;
      background: rgba(10, 20, 38, 0.95);
      border: 1px solid rgba(6, 182, 212, 0.3);
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 0 20px rgba(6, 182, 212, 0.15);
      font-family: 'Inter', sans-serif;
      color: #e2e8f0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      opacity: 0;
      transform: translateY(20px) scale(0.95);
      pointer-events: none;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      backdrop-filter: blur(16px);
    }

    .jarvis-panel.open {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    /* Panel Header */
    .panel-header {
      padding: 14px 18px;
      background: rgba(15, 23, 42, 0.8);
      border-b: 1px solid rgba(6, 182, 212, 0.2);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .panel-title {
      font-family: 'Orbitron', sans-serif;
      font-size: 13px;
      letter-spacing: 2px;
      color: #06b6d4;
      text-shadow: 0 0 10px rgba(6, 182, 212, 0.3);
      margin: 0;
    }

    .panel-close {
      cursor: pointer;
      color: #94a3b8;
      font-size: 14px;
      transition: color 0.2s;
    }

    .panel-close:hover {
      color: #ef4444;
    }

    /* Output Display Area */
    .panel-display {
      flex: 1;
      padding: 16px;
      font-size: 13px;
      line-height: 1.6;
      overflow-y: auto;
      max-height: 320px;
      border-bottom: 1px solid rgba(6, 182, 212, 0.15);
      background: rgba(5, 10, 20, 0.4);
    }

    .message-role {
      font-family: 'Orbitron', sans-serif;
      font-size: 10px;
      letter-spacing: 1px;
      margin-bottom: 4px;
    }

    .role-jarvis { color: #06b6d4; }
    .role-user { color: #38bdf8; }

    .chat-bubble {
      margin-bottom: 16px;
    }

    .chat-text {
      background: rgba(15, 23, 42, 0.6);
      padding: 10px 12px;
      border-radius: 8px;
      border-left: 2px solid rgba(6, 182, 212, 0.5);
    }

    /* Input Bar */
    .panel-input-container {
      padding: 12px;
      display: flex;
      gap: 8px;
      background: rgba(15, 23, 42, 0.9);
    }

    .panel-input {
      flex: 1;
      background: rgba(10, 15, 30, 0.8);
      border: 1px solid rgba(6, 182, 212, 0.25);
      border-radius: 6px;
      padding: 8px 12px;
      color: #f8fafc;
      font-size: 13px;
      outline: none;
      transition: border 0.2s;
    }

    .panel-input:focus {
      border-color: rgba(6, 182, 212, 0.7);
      box-shadow: 0 0 10px rgba(6, 182, 212, 0.2);
    }

    .mic-btn, .send-btn {
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(10, 15, 30, 0.8);
      border: 1px solid rgba(6, 182, 212, 0.25);
      border-radius: 6px;
      cursor: pointer;
      color: #06b6d4;
      transition: all 0.2s;
    }

    .mic-btn:hover, .send-btn:hover {
      background: rgba(6, 182, 212, 0.15);
      border-color: rgba(6, 182, 212, 0.6);
    }

    .mic-btn.active {
      background: rgba(239, 68, 68, 0.15);
      border-color: #ef4444;
      color: #ef4444;
    }

    /* Animations */
    @keyframes spin {
      100% { transform: rotate(360deg); }
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.75; transform: scale(0.9); }
    }
  `;
  shadow.appendChild(style);

  // 4. Create HTML Structure inside Shadow DOM
  const bubble = document.createElement("div");
  bubble.className = "jarvis-bubble";
  bubble.innerHTML = `
    <div class="reactor-ring"></div>
    <div class="reactor-core"></div>
  `;

  const panel = document.createElement("div");
  panel.className = "jarvis-panel";
  panel.innerHTML = `
    <div class="panel-header">
      <h3 class="panel-title">J.A.R.V.I.S. INTERFACE</h3>
      <span class="panel-close">✕</span>
    </div>
    <div class="panel-display" id="jarvis-display">
      <div class="chat-bubble">
        <div class="message-role role-jarvis">J.A.R.V.I.S.</div>
        <div class="chat-text">Awaiting your command, Boss. Ready to assist on this page.</div>
      </div>
    </div>
    <div class="panel-input-container">
      <input type="text" class="panel-input" placeholder="Type command for JARVIS..." id="jarvis-input" />
      <button class="mic-btn" title="Toggle Voice Command" id="jarvis-mic">🎙️</button>
      <button class="send-btn" title="Send Command" id="jarvis-send">➡️</button>
    </div>
  `;

  shadow.appendChild(bubble);
  shadow.appendChild(panel);

  // 5. DOM References
  const display = shadow.getElementById("jarvis-display");
  const input = shadow.getElementById("jarvis-input");
  const micBtn = shadow.getElementById("jarvis-mic");
  const sendBtn = shadow.getElementById("jarvis-send");
  const closeBtn = panel.querySelector(".panel-close");

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
      bubble.classList.add("listening");
    };

    recognition.onend = () => {
      isSpeechActive = false;
      micBtn.classList.remove("active");
      bubble.classList.remove("listening");
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
      bubble.classList.remove("listening");
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

    const typingBubble = addChatBubble("J.A.R.V.I.S.", "Synthesizing answer...", "role-jarvis");

    // Extract DOM content (visible text nodes)
    const domText = getPageTextContent();

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
        }),
      });

      if (!res.ok) {
        throw new Error(`Server returned error status ${res.status}`);
      }

      const data = await res.json();
      if (data.success) {
        typingBubble.querySelector(".chat-text").innerText = data.response;
        speakText(data.response);
      } else {
        typingBubble.querySelector(".chat-text").innerText = `Apologies, Boss. Error: ${data.error}`;
      }
    } catch (e) {
      typingBubble.querySelector(".chat-text").innerText = `Apologies, Boss. Connection failed: ${e.message}`;
    }
    
    // Auto-scroll display to bottom
    display.scrollTop = display.scrollHeight;
  }

  function addChatBubble(role, text, roleClass) {
    const chatBubble = document.createElement("div");
    chatBubble.className = "chat-bubble";
    chatBubble.innerHTML = `
      <div class="message-role ${roleClass}">${role}</div>
      <div class="chat-text">${text}</div>
    `;
    display.appendChild(chatBubble);
    display.scrollTop = display.scrollHeight;
    return chatBubble;
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
})();
