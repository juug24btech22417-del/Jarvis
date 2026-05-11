import { chromium as originalChromium, Browser, Page, BrowserContext } from 'playwright';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';

// Apply the stealth plugin ONLY if it hasn't been added yet (prevents double-injection crashing Zoom)
if (!(chromium as any)._plugins?.some((p: any) => p.name === 'stealth')) {
  chromium.use(stealthPlugin());
}
import axios from 'axios';

// Use environment variable or detect the port dynamically
const API_BASE = process.env.INTERNAL_API_URL || `http://localhost:${process.env.PORT || 3000}`;

interface CaptionEntry {
  speaker: string;
  text: string;
  timestamp: string;
}

interface BotState {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  isRecording: boolean;
  monitorInterval: NodeJS.Timeout | null;
  captionInterval: NodeJS.Timeout | null;
  captionLog: CaptionEntry[];
  lastCaptionText: string;
  meetingPlatform: 'google-meet' | 'zoom' | 'unknown';
}

class MeetingBotService {
  private state: BotState | null = null;

  async joinMeeting(url: string, credentials?: { id?: string; password?: string }) {
    console.log(`JARVIS: Attempting to join meeting at ${url}...`);

    // Close any existing session first
    if (this.state) {
      console.log("JARVIS: Closing previous meeting session...");
      await this.cleanup();
    }

    try {
      // Launch a real Chromium browser with Playwright
      const browser = await chromium.launch({
        headless: false, // Needs to be visible for meetings
        args: [
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream',
          '--autoplay-policy=no-user-gesture-required',
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--window-size=1280,720', // Ensure CC button isn't hidden in a menu
        ],
      });

      const context = await browser.newContext({
        permissions: ['microphone', 'camera'],
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });

      const page = await context.newPage();
      page.setDefaultTimeout(30000);

      // Detect platform
      const platform = url.includes('meet.google.com') ? 'google-meet'
        : url.includes('zoom.us') ? 'zoom'
        : 'unknown';

      this.state = {
        browser,
        context,
        page,
        isRecording: false,
        monitorInterval: null,
        captionInterval: null,
        captionLog: [],
        lastCaptionText: '',
        meetingPlatform: platform,
      };

      // Navigate to the meeting URL
      console.log(`JARVIS: Navigating to ${url}...`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Handle platform-specific join logic
      if (platform === 'google-meet') {
        await this.handleGoogleMeetJoin(page);
      } else if (platform === 'zoom') {
        await this.handleZoomJoin(page, credentials);
      }

      // Start background services
      this.startWaitingRoomMonitor();

      // Auto-enable captions after a longer delay (give time for Zoom's browser join + name entry flow)
      setTimeout(() => {
        this.enableCaptionsAndStartRecording();
      }, 20000);

      console.log("JARVIS: Successfully connected to the meeting.");
      return { success: true, message: "JARVIS has joined the meeting, Boss. I'll enable captions and start taking notes automatically." };

    } catch (error: any) {
      console.error("JARVIS: Failed to join meeting:", error.message);
      await this.cleanup();

      const errorMsg = error.message.includes('Executable')
        ? "Chromium browser not found. Run 'npx playwright install chromium' to install it."
        : error.message.includes('ERR_NAME_NOT_RESOLVED')
        ? "Could not reach the meeting URL. Please check the link and your internet connection."
        : `Failed to join: ${error.message}`;

      return { success: false, error: errorMsg };
    }
  }

  // ─── CAPTION SCRAPING ENGINE ──────────────────────────────────────────

  private async enableCaptionsAndStartRecording() {
    if (!this.state?.page) return;

    const page = this.state.page;
    console.log("JARVIS: Attempting to enable live captions...");

    try {
      if (this.state.meetingPlatform === 'google-meet') {
        await this.enableGoogleMeetCaptions(page);
      }
      
      this.state.isRecording = true;
      this.startSmartCaptionEngine(page);
      console.log("JARVIS: 🧠 Selector-free caption engine active. Scanning bottom of viewport for any text changes.");

    } catch (e: any) {
      console.warn("JARVIS: Could not auto-enable captions:", e.message);
      console.log("JARVIS: Please enable captions manually — I'll still scrape them.");
      
      this.state.isRecording = true;
      this.startSmartCaptionEngine(page);
    }
  }

  private async enableGoogleMeetCaptions(page: Page) {
    try {
      // 1. Ensure the control bar is visible by moving the mouse
      await page.mouse.move(500, 500);
      await page.waitForTimeout(1000);

      // 2. Look for the Turn on Captions button (often hidden in small windows, hence the 1280x720 fix)
      const ccButton = page.locator(
        'button[aria-label*="Turn on captions" i], button[aria-label*="Turn off captions" i]'
      ).first();

      if (await ccButton.isVisible({ timeout: 5000 })) {
        const ariaLabel = await ccButton.getAttribute('aria-label') || '';
        if (ariaLabel.toLowerCase().includes('turn on')) {
          await ccButton.click();
          console.log("JARVIS: Captions enabled via CC button.");
        } else {
          console.log("JARVIS: Captions are already enabled.");
        }
        return;
      }

      // 3. Fallback: try the 3-dots menu
      const moreBtn = page.locator('button[aria-label="More options" i]').first();
      if (await moreBtn.isVisible()) {
        await moreBtn.click();
        await page.waitForTimeout(1000);
        const menuCcBtn = page.locator('li:has-text("Turn on captions")').first();
        if (await menuCcBtn.isVisible()) {
          await menuCcBtn.click();
          console.log("JARVIS: Captions enabled via More menu.");
          return;
        }
        // Close menu if it was open but CC not found
        await page.mouse.click(10, 10);
      }

      // 4. Last resort: Keyboard Shortcut (c)
      await page.keyboard.press('c');
      console.log("JARVIS: Tried enabling captions via keyboard shortcut 'c'.");

    } catch (e) {
      console.warn("JARVIS: Caption enable attempt failed, will wait for user to click it manually.");
    }
  }

  /**
   * SELECTOR-FREE CAPTION ENGINE v3
   * 
   * How Zoom captions work:
   * - Zoom renders 1-3 caption lines at the bottom of the viewport
   * - As new speech arrives, text is REPLACED in-place in the same DOM elements
   * - Old captions scroll away or vanish; new ones appear in the same position
   * 
   * Strategy:
   * 1. Scan ALL visible leaf-text in the bottom 45% of the viewport
   * 2. Combine into a SINGLE snapshot string
   * 3. Compare the full snapshot to the previous one
   * 4. If changed, log the delta
   * 
   * v4 fixes: uses recursive setTimeout (not setInterval) to prevent
   * overlapping async page.evaluate() calls that were crashing Playwright.
   */

  private previousSnapshot: string = '';
  private _captionBusy = false;
  private currentSpeaker: string = 'Speaker';

  private findNewText(oldStr: string, newStr: string): string {
    if (!oldStr) return newStr;
    if (oldStr === newStr) return '';
    
    // Exact continuation
    if (newStr.startsWith(oldStr)) return newStr.substring(oldStr.length).trim();
    
    // Substring containment
    if (newStr.includes(oldStr)) return newStr.substring(newStr.indexOf(oldStr) + oldStr.length).trim();

    // Check for overlapping suffix of oldStr and prefix of newStr
    const minLen = Math.min(oldStr.length, newStr.length);
    // Only check overlaps that are at least 3 characters to avoid false positive single-letter matches
    for (let i = minLen; i >= 3; i--) {
      const suffix = oldStr.substring(oldStr.length - i);
      const prefix = newStr.substring(0, i);
      if (suffix === prefix) {
        return newStr.substring(i).trim();
      }
    }
    
    // No meaningful overlap found, treat as entirely new text
    return newStr.trim();
  }

  private startSmartCaptionEngine(page: Page) {
    if (!this.state) return;

    console.log("JARVIS: 🧠 Starting smart caption engine v5 (Overlap Diffing)...");

    const tick = async () => {
      if (!this.state?.page || !this.state.isRecording) return;
      if (this._captionBusy) {
        this.state.captionInterval = setTimeout(tick, 2000) as any;
        return;
      }

      this._captionBusy = true;

      try {
        // Grab all text in the bottom 45% of the screen
        const rawText: string = await page.evaluate(() => {
          const vh = window.innerHeight;
          const threshold = vh * 0.55;
          const vw = window.innerWidth;
          let fullText = '';

          document.querySelectorAll('span, p, div').forEach(el => {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

            const tag = el.tagName.toLowerCase();
            const role = el.getAttribute('role') || '';
            if (['button', 'input', 'select', 'nav', 'header', 'footer', 'a'].includes(tag)) return;
            if (['button', 'menuitem', 'tab', 'navigation', 'toolbar', 'menu'].includes(role)) return;
            if (el.closest('button') || el.closest('[role="button"]') || el.closest('nav') || el.closest('[role="toolbar"]')) return;
            if (el.getAttribute('aria-hidden') === 'true') return;

            const rect = el.getBoundingClientRect();
            if (rect.top < threshold) return;
            if (rect.left < -100 || rect.right > vw + 100) return;
            if (rect.width < 10 || rect.height < 10) return;

            // Only grab leaf nodes to avoid duplicate text from parent elements
            let text = '';
            if (el.children.length === 0) {
              text = (el.textContent || '').trim();
            } else {
              el.childNodes.forEach(node => {
                if (node.nodeType === Node.TEXT_NODE) {
                  text += node.textContent || '';
                }
              });
              text = text.trim();
            }

            if (!text || text.length < 2) return;

            const lower = text.toLowerCase();
            if (lower === 'word' || lower.includes('word word') || lower.includes('mmmw') || lower.includes('fiflo') || lower.includes('mmwwll')) return;

            fullText += text + ' ';
          });

          return fullText.replace(/\s+/g, ' ').trim();
        });

        // Always update previousSnapshot even if rawText is empty, so we can handle clears
        if (rawText !== this.previousSnapshot) {
          if (rawText) {
            const newText = this.findNewText(this.previousSnapshot, rawText);
            
            if (newText.length > 1) {
              // Check if the new text has a speaker tag (e.g., "John Doe: Hello")
              let textToLog = newText;
              const colonIdx = newText.indexOf(':');
              if (colonIdx > 0 && colonIdx < 30) {
                const possibleName = newText.substring(0, colonIdx).trim();
                if (possibleName.length > 1 && possibleName.length < 25 && !possibleName.includes('http')) {
                  this.currentSpeaker = possibleName;
                  textToLog = newText.substring(colonIdx + 1).trim();
                }
              }

              if (textToLog.length > 1) {
                const entry: CaptionEntry = {
                  speaker: this.currentSpeaker,
                  text: textToLog,
                  timestamp: new Date().toISOString(),
                };
                
                this.state!.captionLog.push(entry);
                console.log(`JARVIS 📝 [${entry.speaker}]: ${entry.text}`);
              }
            }
          }
          
          this.previousSnapshot = rawText;
        }

      } catch (e: any) {
        console.warn("JARVIS CAPTION ENGINE: tick error (will retry):", e?.message?.substring(0, 80));
      } finally {
        this._captionBusy = false;
      }

      if (this.state?.isRecording) {
        this.state.captionInterval = setTimeout(tick, 2000) as any;
      }
    };

    this.state.captionInterval = setTimeout(tick, 2000) as any;
  }

  /**
   * Get a debug snapshot of what Jarvis can see on the page.
   * Call this via the API to troubleshoot caption detection.
   */
  async getPageDebugInfo(): Promise<any> {
    if (!this.state?.page) return { error: 'Bot not active' };

    try {
      const debugInfo = await this.state.page.evaluate(() => {
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        const elements: any[] = [];

        document.querySelectorAll('span, p, div').forEach(el => {
          const rect = el.getBoundingClientRect();
          if (rect.top < viewportHeight * 0.5) return; // Only bottom half
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return;
          if (rect.width < 30 || rect.height < 8) return;

          const text = el.textContent?.trim();
          if (text && text.length > 2 && text.length < 300) {
            elements.push({
              tag: el.tagName,
              class: el.className?.toString()?.substring(0, 80) || '',
              text: text.substring(0, 100),
              position: `top:${Math.round(rect.top)} left:${Math.round(rect.left)} w:${Math.round(rect.width)} h:${Math.round(rect.height)}`,
            });
          }
        });

        return {
          viewport: `${viewportWidth}x${viewportHeight}`,
          url: window.location.href,
          title: document.title,
          elementsInBottomHalf: elements.length,
          elements: elements.slice(0, 30), // Cap at 30
        };
      });

      return {
        ...debugInfo,
        captionsCollected: this.state.captionLog.length,
        isRecording: this.state.isRecording,
        lastCaptionTexts: this.previousBottomTexts,
      };
    } catch (e: any) {
      return { error: e.message };
    }
  }

  // ─── PLATFORM JOIN HANDLERS ────────────────────────────────────────────

  private async handleGoogleMeetJoin(page: Page) {
    try {
      console.log("JARVIS: Handling Google Meet join flow...");

      // Dismiss any initial popups / "Got it" buttons
      try {
        const gotItBtn = page.locator('button:has-text("Got it")');
        if (await gotItBtn.isVisible({ timeout: 3000 })) {
          await gotItBtn.click();
        }
      } catch { /* No popup */ }

      // Turn off camera and mic before joining
      try {
        const micBtn = page.locator('[aria-label*="microphone" i], [data-tooltip*="microphone" i]').first();
        if (await micBtn.isVisible({ timeout: 3000 })) {
          await micBtn.click();
          console.log("JARVIS: Muted microphone.");
        }

        const camBtn = page.locator('[aria-label*="camera" i], [data-tooltip*="camera" i]').first();
        if (await camBtn.isVisible({ timeout: 3000 })) {
          await camBtn.click();
          console.log("JARVIS: Turned off camera.");
        }
      } catch { /* Buttons not found */ }

      // Click "Join now" or "Ask to join"
      const joinButton = page.locator('button:has-text("Join now"), button:has-text("Ask to join")').first();
      await joinButton.waitFor({ state: 'visible', timeout: 15000 });
      await joinButton.click();
      console.log("JARVIS: Clicked join button for Google Meet.");

    } catch (e: any) {
      console.warn("JARVIS: Could not auto-click Google Meet join button:", e.message);
    }
  }

  private async handleZoomJoin(page: Page, credentials?: { id?: string; password?: string }) {
    try {
      console.log("JARVIS: Handling Zoom join flow...");

      if (credentials?.id) {
        await page.goto('https://zoom.us/join', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);

        const meetingIdInput = page.locator('#join-confno, input[name="confno"]').first();
        await meetingIdInput.waitFor({ state: 'visible', timeout: 10000 });
        await meetingIdInput.fill(credentials.id);

        const joinBtn = page.locator('#joinBtn, button:has-text("Join")').first();
        await joinBtn.click();

        if (credentials.password) {
          await page.waitForTimeout(2000);
          const pwdInput = page.locator('input[type="password"], #joinPassword').first();
          if (await pwdInput.isVisible({ timeout: 5000 })) {
            await pwdInput.fill(credentials.password);
            const submitBtn = page.locator('button:has-text("Join Meeting"), button[type="submit"]').first();
            await submitBtn.click();
          }
        }
      } else {
        // --- 1. Handle Webinar Registration Form (if present) ---
        console.log("JARVIS: Checking if this is a webinar registration page...");
        try {
          const emailInput = page.locator('input[type="email"], input[name*="email" i], #question_email').first();
          if (await emailInput.isVisible({ timeout: 3000 })) {
            console.log("JARVIS: Webinar registration form detected. Auto-filling...");
            
            // Fill first name
            const firstName = page.locator('input[name*="first" i], #question_first_name').first();
            if (await firstName.isVisible()) {
              await firstName.click();
              await firstName.pressSequentially('JARVIS', { delay: 50 });
              await page.keyboard.press('Tab');
            }
            
            // Fill last name
            const lastName = page.locator('input[name*="last" i], #question_last_name').first();
            if (await lastName.isVisible()) {
              await lastName.click();
              await lastName.pressSequentially('B', { delay: 50 });
              await page.keyboard.press('Tab');
            }
            
            // Fill email
            await emailInput.click();
            await emailInput.pressSequentially('dhruvbijapur@gmail.com', { delay: 50 });
            await page.keyboard.press('Tab');
            
            // Fill mobile/phone (if requested by webinar)
            try {
              const phoneInput = page.locator('input[type="tel"], input[name*="phone" i], input[name*="mobile" i], input[id*="phone" i]').first();
              if (await phoneInput.isVisible({ timeout: 1000 })) {
                await phoneInput.click();
                await phoneInput.pressSequentially('9606571200', { delay: 50 });
                await page.keyboard.press('Tab');
                console.log("JARVIS: Filled mobile number.");
              }
            } catch {
              // Phone field not present
            }
            
            // Wait a moment for Zoom's validation to enable the button
            await page.waitForTimeout(1000);

            // Submit registration - using force: true as a fallback just in case
            const registerBtn = page.locator('button:has-text("Register"), button:has-text("Join")').first();
            await registerBtn.click({ force: true });
            console.log("JARVIS: Submitted webinar registration.");
            
            // Wait for the next page to load
            await page.waitForTimeout(5000);
          }
        } catch {
          console.log("JARVIS: No registration form detected. Proceeding...");
        }

        // --- 2. Handle "Join from browser" Landing Page ---
        console.log("JARVIS: Looking for 'Join from browser' link on Zoom landing page...");
        
        // Try multiple selectors in order of likelihood. 
        // We use exact string matching where possible to avoid clicking the wrong "Join" buttons
        const joinFromBrowserSelectors = [
          'button:has-text("Join from browser")',
          'button:has-text("Join from Browser")',
          'a:has-text("Join from browser")',
          'a:has-text("Join from Browser")', 
          'a:has-text("Join from Your Browser")',
          'a:has-text("join from your browser")',
          'button:has-text("Launch Meeting")',
          'a:has-text("Launch Meeting")',
          '#fallback_btn',  // Zoom's fallback join button ID
          'button >> text="Join"',
          'a >> text="Join"'
        ];

        let clicked = false;
        for (let attempt = 0; attempt < 3 && !clicked; attempt++) {
          if (attempt > 0) {
            console.log(`JARVIS: Retry ${attempt}/3 - waiting for Zoom page to render...`);
            await page.waitForTimeout(3000);
          }

          for (const sel of joinFromBrowserSelectors) {
            try {
              const el = page.locator(sel).first();
              if (await el.isVisible({ timeout: 1000 })) {
                console.log(`JARVIS: Found join link with selector: "${sel}"`);
                await el.click();
                clicked = true;
                break;
              }
            } catch {
              // Selector didn't match, try next
            }
          }
        }

        if (clicked) {
          console.log("JARVIS: Clicked 'Join from browser'. Waiting for meeting UI to load...");
          await page.waitForTimeout(5000);
          
          // --- 3. Handle Meeting Name Entry (if present) ---
          try {
            const nameInput = page.locator('#inputname, input[placeholder*="name" i], input[id*="name" i]').first();
            if (await nameInput.isVisible({ timeout: 3000 })) {
              await nameInput.fill('JARVIS Bot');
              console.log("JARVIS: Entered name for Zoom meeting.");
              
              const joinMeetingBtn = page.locator('button:has-text("Join"), #joinBtn').first();
              if (await joinMeetingBtn.isVisible({ timeout: 3000 })) {
                await joinMeetingBtn.click();
                console.log("JARVIS: Clicked Join on name entry page.");
              }
            }
          } catch {
            // No name input, might have gone straight to meeting
          }

          // Wait for meeting to fully load
          await page.waitForTimeout(5000);
        } else {
          console.warn("JARVIS: Could not find 'Join from browser' link. Page might have loaded directly into meeting.");
        }
      }
    } catch (e: any) {
      console.warn("JARVIS: Could not auto-join Zoom:", e.message);
    }
  }

  // ─── WAITING ROOM MONITOR ─────────────────────────────────────────────

  private startWaitingRoomMonitor() {
    if (!this.state) return;

    this.state.monitorInterval = setInterval(async () => {
      if (!this.state?.page) return;

      try {
        const isWaiting = await this.state.page.evaluate(() => {
          const bodyText = document.body.innerText.toLowerCase();
          return bodyText.includes("asking to join") ||
                 bodyText.includes("waiting room") ||
                 bodyText.includes("will let you in soon") ||
                 bodyText.includes("waiting for the host");
        });

        if (isWaiting) {
          console.log("JARVIS: I'm stuck in the waiting room!");
          try {
            await fetch(`${API_BASE}/api/notifications`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: "Boss, I'm in the waiting room. Please admit me!",
                status: "info"
              })
            });
          } catch { /* ignore */ }
        }
      } catch { /* page navigating */ }
    }, 10000);
  }

  // ─── CHAT ──────────────────────────────────────────────────────────────

  async sendChatMessage(message: string) {
    if (!this.state?.page) {
      return { success: false, error: "No active meeting session." };
    }

    try {
      const page = this.state.page;

      if (this.state.meetingPlatform === 'google-meet') {
        // Open chat panel
        const chatBtn = page.locator('[aria-label*="chat" i], button:has-text("Chat")').first();
        if (await chatBtn.isVisible({ timeout: 3000 })) {
          await chatBtn.click();
          await page.waitForTimeout(500);
        }

        const chatInput = page.locator('textarea[aria-label*="Send a message" i], textarea[placeholder*="Send a message" i]').first();
        await chatInput.waitFor({ state: 'visible', timeout: 5000 });
        await chatInput.fill(message);
        await chatInput.press('Enter');

        return { success: true, message: `Message sent: "${message}"` };
      }

      if (this.state.meetingPlatform === 'zoom') {
        const chatBtn = page.locator('[aria-label*="Chat" i]').first();
        if (await chatBtn.isVisible({ timeout: 3000 })) {
          await chatBtn.click();
          await page.waitForTimeout(500);
        }

        const chatInput = page.locator('textarea.chat-box__chat-textarea, textarea[placeholder*="Type message" i]').first();
        await chatInput.waitFor({ state: 'visible', timeout: 5000 });
        await chatInput.fill(message);
        await chatInput.press('Enter');

        return { success: true, message: `Message sent: "${message}"` };
      }

      return { success: false, error: "Unsupported platform for chat." };
    } catch (e: any) {
      return { success: false, error: `Could not send message: ${e.message}` };
    }
  }

  // ─── LEAVE & SUMMARIZE ─────────────────────────────────────────────────

  async leaveMeeting() {
    if (!this.state) {
      return { success: false, message: "No active meeting found." };
    }

    console.log("JARVIS: Leaving the meeting...");

    // Grab all the captions we collected
    const captionLog = [...(this.state.captionLog || [])];
    const captionCount = captionLog.length;

    // Cleanup everything
    await this.cleanup();

    // Summarize in the background if we have data
    if (captionLog.length > 0) {
      console.log(`JARVIS: Collected ${captionCount} caption entries. Generating summary...`);
      this.runSummarizationPipeline(captionLog).catch(e =>
        console.error("JARVIS: Summarization pipeline failed:", e)
      );
    } else {
      console.log("JARVIS: No caption data collected (captions may not have been enabled).");
    }

    return {
      success: true,
      message: captionCount > 0
        ? `JARVIS has left the meeting. Captured ${captionCount} dialogue entries — generating summary & syncing tasks now, Boss.`
        : "JARVIS has left the meeting. No caption data was captured (try enabling captions next time).",
    };
  }

  private async runSummarizationPipeline(captionLog: CaptionEntry[]) {
    try {
      // Build a readable transcript from the caption log
      const transcript = captionLog
        .map(entry => `[${new Date(entry.timestamp).toLocaleTimeString()}] ${entry.speaker}: ${entry.text}`)
        .join('\n');

      console.log("JARVIS: Sending transcript to AI for summarization...");
      console.log(`--- TRANSCRIPT (${captionLog.length} entries) ---`);
      console.log(transcript.substring(0, 500) + (transcript.length > 500 ? '...' : ''));

      // 1. Generate AI Summary
      const aiRes = await axios.post(`${API_BASE}/api/openai`, {
        messages: [
          {
            role: "system",
            content: `You are JARVIS, a high-efficiency executive assistant. Analyze the following meeting transcript and return a structured summary as JSON.
            
Format:
{
  "summary": "2-3 sentence overview of the meeting",
  "keyTopics": ["topic1", "topic2"],
  "decisions": ["decision1", "decision2"],
  "actionItems": [
    { "task": "specific action", "assignee": "person name or Unknown", "due": "suggested due date", "priority": 1-4 }
  ],
  "nextSteps": "any mentioned follow-ups or next meeting details"
}`
          },
          { role: "user", content: `Meeting Transcript:\n${transcript}` }
        ],
        response_format: { type: "json_object" }
      });

      const summary = JSON.parse(aiRes.data.content);
      console.log("JARVIS: ✅ Meeting summary generated!");
      console.log("Summary:", summary.summary);
      console.log("Decisions:", summary.decisions);
      console.log("Action Items:", summary.actionItems?.length || 0);

      // 2. Save to Notion
      try {
        await axios.post(`${API_BASE}/api/notion/create-page`, {
          title: `Meeting Notes — ${new Date().toLocaleDateString()}`,
          content: `## Summary\n${summary.summary}\n\n## Key Topics\n${(summary.keyTopics || []).map((t: string) => `- ${t}`).join('\n')}\n\n## Decisions\n${(summary.decisions || []).map((d: string) => `- ${d}`).join('\n')}\n\n## Action Items\n${(summary.actionItems || []).map((a: any) => `- [ ] ${a.task} (${a.assignee || 'Unassigned'}) — Due: ${a.due || 'TBD'}`).join('\n')}\n\n## Full Transcript\n${transcript}`,
          tags: ["Meeting", "JARVIS-Bot"]
        });
        console.log("JARVIS: 📝 Meeting notes saved to Notion.");
      } catch (e) {
        console.warn("JARVIS: Could not save to Notion (may not be configured).");
      }

      // 3. Sync Action Items to Todoist
      if (summary.actionItems && Array.isArray(summary.actionItems)) {
        console.log(`JARVIS: Syncing ${summary.actionItems.length} tasks to Todoist...`);
        for (const item of summary.actionItems) {
          try {
            await axios.post(`${API_BASE}/api/todoist/add-task`, {
              content: `[Meeting] ${item.task}`,
              dueString: item.due || 'next week',
              priority: item.priority || 1
            });
          } catch {
            console.warn(`JARVIS: Could not sync task: "${item.task}"`);
          }
        }
        console.log("JARVIS: ✅ Tasks synced to Todoist.");
      }

      // 4. Send completion notification
      try {
        await fetch(`${API_BASE}/api/whatsapp/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `✅ *Meeting Summary Ready*\n\n${summary.summary}\n\n📋 *Action Items:* ${(summary.actionItems || []).length}\n📝 Full notes saved to Notion.`
          })
        });
      } catch { /* WhatsApp may not be configured */ }

    } catch (e) {
      console.error("JARVIS: Error in summarization pipeline:", e);
    }
  }

  // ─── CLEANUP ───────────────────────────────────────────────────────────

  private async cleanup() {
    if (!this.state) return;

    if (this.state.monitorInterval) clearInterval(this.state.monitorInterval);
    if (this.state.captionInterval) clearTimeout(this.state.captionInterval);

    try {
      await this.state.browser.close();
    } catch (e) {
      console.error("JARVIS: Error closing browser:", e);
    }

    // Reset caption engine state so re-dispatch starts fresh
    this.previousSnapshot = '';
    this.captionSeenSet.clear();
    this._captionBusy = false;

    this.state = null;
  }

  getStatus() {
    return {
      isActive: !!this.state,
      isRecording: this.state?.isRecording || false,
      captionsCollected: this.state?.captionLog?.length || 0,
      platform: this.state?.meetingPlatform || null,
    };
  }
}

export const meetingBot = new MeetingBotService();
