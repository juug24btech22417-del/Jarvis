import { BrowserContext, Page, chromium } from 'playwright';
import { execSync } from 'child_process';
import * as fs from 'fs';
import os from 'os';
import path from 'path';

// Use the user's real installed Chrome to avoid Google's "insecure browser" block.
// Points to the real Chrome profile already signed in to dhruvbijapur@gmail.com.
const CHROME_PATH =
  process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/google-chrome';

// Use the dedicated JARVIS meeting profile (separate from the user's main Chrome)
// so JARVIS joining a meeting doesn't interfere with normal Chrome usage.
// On first run Playwright will create this directory automatically.
const JARVIS_PROFILE_DIR = path.join(os.homedir(), '.jarvis-meet-profile');

const SYSTEM_BLACKLIST = [
  'no one can join a meeting',
  'schedule a meeting',
  'enjoy the free time',
  'allowing notifications',
  'ready to join',
  'asking to join',
  'waiting for the host',
  'someone will let you in',
  'will let you in soon',
  'you\'re the only one here',
  'meeting details',
  'turn off microphone',
  'turn on microphone',
  'turn off camera',
  'turn on camera',
  'raise hand',
  'leave call',
  'your meeting is safe',
  'more options',
  'send a message to everyone',
  'chat messages can only be seen',
  'people in this call',
  'host controls',
  'turn on captions',
  'turn off captions',
  'captions have been turned on',
  'captions have been turned off',
  'caption settings',
  'open caption settings',
  'jump to the bottom',
  'jump to bottom',
  'arrow_downward',
  'format_size',
  'font size',
  'afrikaans',
  'albanian',
  'amharic',
  'cantonese',
  'mandarin',
  'south africa',
  'cyan magenta',
  'english (detected)',
  'return to home screen',
  'check your meeting code',
  'to avoid echo',
  'use companion mode',
  'present now',
  'stop presenting',
  'device settings',
];

interface CaptionEntry {
  speaker: string;
  text: string;
  timestamp: string;
  source?: 'caption' | 'chat';
}

interface BotState {
  context: BrowserContext;
  page: Page;
  isRecording: boolean;
  monitorInterval: NodeJS.Timeout | null;
  captionInterval: NodeJS.Timeout | null;
  captionLog: CaptionEntry[];
  lastCaptionText: string;
  meetingPlatform: 'google-meet' | 'zoom' | 'unknown';
  meetingUrl: string;
  statusMessage: string;
}

export interface MeetingSummary {
  summary: string;
  keyTopics: string[];
  decisions: string[];
  actionItems: Array<{ task: string; assignee?: string; due?: string; priority?: number }>;
  nextSteps?: string;
}

export interface MeetingResult {
  title: string;
  platform: string;
  captionCount: number;
  summary: MeetingSummary;
  notionUrl: string | null;
  timestamp: string;
}

class MeetingBotService {
  private state: BotState | null = null;
  private lastResult: MeetingResult | null = null;
  private previousSnapshot: string = '';
  private _captionBusy = false;
  private _captionActive = false;  // Guards the recursive tick — flipped false by cleanup()
  private currentSpeaker: string = 'Speaker';
  private _captionsToggledOnce = false;
  private _isSyncingNotion = false;

  /**
   * Kills any Chrome process that currently owns the JARVIS profile directory
   * and clears the ProcessSingleton lock files it left behind.
   * Without this, a second launch hits "Failed to create a ProcessSingleton" and aborts.
   */
  private async prepareProfile() {
    // 1. Kill any Chrome process currently holding our profile directory lock.
    //    We write a temp .ps1 to avoid shell-escaping issues when calling from Node.
    try {
      if (process.platform === 'win32') {
        const tmpPs1 = path.join(os.tmpdir(), 'jarvis-kill-chrome.ps1');
        const psScript = `
$profilePath = '${JARVIS_PROFILE_DIR.replace(/'/g, "''")}';
Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
  Where-Object { $_.CommandLine -like "*jarvis-meet-profile*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
`;
        fs.writeFileSync(tmpPs1, psScript, 'utf8');
        execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpPs1}"`, {
          timeout: 6000,
          stdio: 'ignore',
        });
        try { fs.unlinkSync(tmpPs1); } catch {}
      } else {
        execSync(`pkill -f "jarvis-meet-profile"`, { timeout: 3000, stdio: 'ignore' });
      }
      await new Promise(r => setTimeout(r, 1000));
    } catch { /* No matching Chrome processes — that's fine */ }

    // 2. Remove ProcessSingleton lock files left by the previous Chrome instance
    const lockFiles = [
      path.join(JARVIS_PROFILE_DIR, 'SingletonLock'),
      path.join(JARVIS_PROFILE_DIR, 'SingletonSocket'),
      path.join(JARVIS_PROFILE_DIR, 'SingletonCookie'),
      path.join(JARVIS_PROFILE_DIR, 'Default', 'LOCK'),
      path.join(JARVIS_PROFILE_DIR, 'lockfile'),
    ];
    for (const f of lockFiles) {
      try { fs.unlinkSync(f); } catch { /* File doesn't exist — fine */ }
    }

    console.log('JARVIS: Profile cleared — launching Chrome...');
  }

  /**
   * Normalizes URLs and IDs for direct browser joining.
   * Transforms Zoom meetings into direct Zoom Web Client URLs (/wc/...) to bypass native app redirects.
   * Zoom webinar registration URLs (/webinar/register/...) are passed through unchanged — the
   * handleZoomJoin flow handles the registration form and post-confirmation join.
   */
  private normalizeMeetingTarget(rawUrl?: string, credentials?: { id?: string; password?: string }) {
    let url = (rawUrl || '').trim();
    let cleanId = credentials?.id ? credentials.id.replace(/[\s-]+/g, '') : '';
    let password = credentials?.password ? credentials.password.trim() : '';

    // Zoom Webinar registration links — keep them intact; the join handler fills the form.
    if (url.match(/zoom\.us\/webinar\/(register|join)/i)) {
      return { url, platform: 'zoom' as const, cleanId, password };
    }

    // If no URL provided but ID is present, format as Zoom Web Client
    if (!url && cleanId) {
      url = `https://zoom.us/wc/${cleanId}/join${password ? `?pwd=${encodeURIComponent(password)}` : ''}`;
    }

    // If Zoom URL is in /j/ or /w/ format, extract ID & password and convert to /wc/ URL
    if (url.includes('zoom.us/j/') || url.includes('zoom.us/w/')) {
      const idMatch = url.match(/zoom\.us\/[jw]\/(\d+)/i);
      const pwdMatch = url.match(/[?&]pwd=([^&#]+)/i);
      if (idMatch) {
        cleanId = cleanId || idMatch[1];
        if (pwdMatch) {
          password = password || decodeURIComponent(pwdMatch[1]);
        }
        url = `https://zoom.us/wc/${cleanId}/join${password ? `?pwd=${encodeURIComponent(password)}` : ''}`;
      }
    }

    // Determine platform
    const platform: 'google-meet' | 'zoom' | 'unknown' =
      url.includes('meet.google.com') ? 'google-meet'
      : url.includes('zoom.us') || cleanId ? 'zoom'
      : 'unknown';

    return { url, platform, cleanId, password };
  }

  /**
   * Spawns a native Chrome window (without Playwright or automation flags)
   * pointing directly to Google Account Sign-In.
   * This completely bypasses Google's "This browser or app may not be secure" error,
   * because it is pure native Chrome. All cookies and credentials are saved to JARVIS_PROFILE_DIR.
   */
  async openGoogleSignInWindow(): Promise<{ success: boolean; message: string }> {
    console.log("JARVIS: Opening native Chrome for secure Google sign-in...");
    try {
      if (this.state) {
        await this.cleanup();
      }
      await this.prepareProfile();

      const { spawn } = await import('child_process');
      const signInUrl = 'https://accounts.google.com/ServiceLogin?continue=https://meet.google.com&hl=en';

      const child = spawn(
        CHROME_PATH,
        [
          `--user-data-dir=${JARVIS_PROFILE_DIR}`,
          '--no-first-run',
          '--no-default-browser-check',
          signInUrl,
        ],
        {
          detached: true,
          stdio: 'ignore',
        }
      );
      child.unref();

      return {
        success: true,
        message: 'A clean Chrome window has been opened for Google Sign-In. Sign in with dhruvbijapur67@gmail.com, then click "Join Meeting" again in JARVIS.',
      };
    } catch (err: any) {
      console.error("JARVIS: Failed to open native Chrome:", err);
      return {
        success: false,
        message: `Failed to open Chrome: ${err.message}`,
      };
    }
  }

  /**
   * Focuses and brings the Chrome window to the absolute front of all desktop windows.
   * Uses Win32 EnumWindows + SwitchToThisWindow via PowerShell for 100% reliable foregrounding.
   * Multi-process Chrome windows are top-level Chrome_WidgetWin_1 HWNDs that .NET's
   * MainWindowHandle misses; EnumWindows finds and activates them properly.
   */
  async bringWindowToFront(): Promise<{ success: boolean; message: string }> {
    try {
      if (this.state?.page) {
        await this.state.page.bringToFront().catch(() => {});
      }
      if (process.platform === 'win32') {
        const psScript = `
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class ChromeFocusHelper {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);

    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_SHOWWINDOW = 0x0040;

    public static int FocusChromeWindows() {
        var chromePids = new HashSet<uint>();
        foreach (var p in System.Diagnostics.Process.GetProcessesByName("chrome")) {
            chromePids.Add((uint)p.Id);
        }
        int count = 0;
        EnumWindows((hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) return true;
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            if (chromePids.Contains(pid)) {
                var sbClass = new StringBuilder(256);
                GetClassName(hWnd, sbClass, 256);
                if (sbClass.ToString() == "Chrome_WidgetWin_1") {
                    ShowWindow(hWnd, 9); // SW_RESTORE
                    // Pop to top-most (bypasses Windows foreground lock)
                    SetWindowPos(hWnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
                    // Drop back to normal top-level so it doesn't stay permanently pinned
                    SetWindowPos(hWnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
                    SwitchToThisWindow(hWnd, true);
                    SetForegroundWindow(hWnd);
                    count++;
                }
            }
            return true;
        }, IntPtr.Zero);
        return count;
    }
}
"@
[ChromeFocusHelper]::FocusChromeWindows()
`;
        const tmpPs1 = path.join(os.tmpdir(), 'jarvis-focus-chrome.ps1');
        fs.writeFileSync(tmpPs1, psScript, 'utf8');
        execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpPs1}"`, {
          timeout: 5000,
          stdio: 'ignore',
        });
        try { fs.unlinkSync(tmpPs1); } catch {}
      }
      return { success: true, message: 'Chrome window brought to foreground.' };
    } catch (e: any) {
      console.warn('JARVIS: bringWindowToFront note:', e.message);
      return { success: false, message: e.message };
    }
  }

  /**
   * Takes a screenshot of the current browser page for debugging.
   * Returns the base64-encoded PNG.
   */
  async takeScreenshot(): Promise<{ success: boolean; screenshot?: string; url?: string; error?: string }> {
    if (!this.state?.page) {
      return { success: false, error: 'Bot not active — no browser page.' };
    }
    try {
      const buffer = await this.state.page.screenshot({ type: 'png' });
      const base64 = buffer.toString('base64');
      const url = this.state.page.url();
      return { success: true, screenshot: base64, url };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async joinMeeting(rawUrl: string, credentials?: { id?: string; password?: string; name?: string; email?: string; phone?: string }) {
    const { url, platform, cleanId, password } = this.normalizeMeetingTarget(rawUrl, credentials);
    console.log(`JARVIS: Attempting to join meeting (${platform}) at ${url}...`);

    // Close any previous meeting session
    if (this.state) {
      console.log("JARVIS: Closing previous meeting session...");
      await this.cleanup();
    }

    try {
      // Kill any Chrome process owning the JARVIS profile and clear lock files
      // so launchPersistentContext never hits the ProcessSingleton error.
      await this.prepareProfile();

      // Launch a dedicated JARVIS meeting browser profile with visible window.
      const context = await chromium.launchPersistentContext(JARVIS_PROFILE_DIR, {
        executablePath: CHROME_PATH,
        headless: false,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--use-fake-ui-for-media-stream',           // Auto-grant mic/cam — no popup
          '--use-fake-device-for-media-stream',
          '--autoplay-policy=no-user-gesture-required',
          '--no-sandbox',
          '--disable-background-timer-throttling',
          '--window-position=50,50',
          '--window-size=1280,800',
          '--start-maximized',
        ],
        ignoreDefaultArgs: ['--enable-automation'],  // No "controlled by automation" banner
        viewport: null,                              // Full native window without artificial scaling/clipping
        permissions: ['microphone', 'camera'],
      });

      const pages = context.pages();
      const page = pages.length > 0 ? pages[0] : await context.newPage();
      page.setDefaultTimeout(35000);

      // Listen for any new popups or tabs (e.g. webinar join link opened in a new tab)
      context.on('page', async (newPage) => {
        console.log(`JARVIS: New browser tab/popup opened: ${newPage.url()}`);
        if (this.state) {
          this.state.page = newPage;
          newPage.setDefaultTimeout(35000);
          await newPage.bringToFront().catch(() => {});
          await this.bringWindowToFront();
        }
      });

      await page.bringToFront().catch(() => {});
      await this.bringWindowToFront();

      this.state = {
        context,
        page,
        isRecording: false,
        monitorInterval: null,
        captionInterval: null,
        captionLog: [],
        lastCaptionText: '',
        meetingPlatform: platform,
        meetingUrl: url,
        statusMessage: 'Navigating to meeting URL...',
      };

      // Navigate to the meeting URL
      console.log(`JARVIS: Navigating to ${url}...`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(2500);

      // Handle platform-specific joining
      let joinNotice = '';
      let needsSignIn = false;
      if (platform === 'google-meet') {
        this.state.statusMessage = 'Handling Google Meet join flow...';
        const res = await this.handleGoogleMeetJoin(page);
        if (res?.notice) joinNotice = res.notice;
        if (res?.needsSignIn) needsSignIn = true;
      } else if (platform === 'zoom') {
        this.state.statusMessage = 'Joining Zoom via Web Client...';
        await this.handleZoomJoin(page, cleanId, password, {
          name: credentials?.name || 'Dhruv',
          email: credentials?.email || 'dhruvbijapur@gmail.com',
          phone: credentials?.phone || '9606571200',
        });
      }

      this.state.statusMessage = joinNotice || 'In meeting — Transcribing dialogue and chat...';

      // Start waiting room monitor
      this.startWaitingRoomMonitor();

      // Enable live captions and start background recording
      setTimeout(() => {
        this.enableCaptionsAndStartRecording();
      }, 2500);

      console.log("JARVIS: Successfully connected to the meeting.");
      return {
        success: true,
        message: joinNotice || "JARVIS has joined the meeting, Boss. I'll enable captions and start taking notes automatically.",
        platform,
        needsSignIn,
      };

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

  // ─── PLATFORM JOIN HANDLERS ────────────────────────────────────────────

  private async handleGoogleMeetJoin(page: Page): Promise<{ notice?: string; needsSignIn?: boolean } | void> {
    try {
      console.log("JARVIS: Handling Google Meet join flow...");
      await page.waitForTimeout(2500);

      // 1. Check if blocked — could be auth issue or domain restriction
      const currentUrl = page.url();
      const bodyText = await page.evaluate(() => document.body.innerText.toLowerCase()).catch(() => '');
      const cantJoin =
        currentUrl.includes('accounts.google.com') ||
        bodyText.includes("you can't join this video call") ||
        bodyText.includes("returning to home screen") ||
        bodyText.includes("sign in to join this meeting") ||
        bodyText.includes("sign in with a google account");

      if (cantJoin) {
        // Check if actually signed into Google in this profile
        const isSignedIn = await page.evaluate(() => {
          // Google sets SSID, SID, HSID cookies when signed in
          const cookies = document.cookie;
          return cookies.includes('SSID') || cookies.includes('SID=') || cookies.includes('__Secure-1PSID');
        }).catch(() => false);

        if (!isSignedIn) {
          // Not signed in — DO NOT navigate inside Playwright!
          // Google blocks logins from Playwright with "This browser or app may not be secure".
          // Instead, close Playwright and launch a clean native Chrome instance for the user.
          console.log("JARVIS: Not signed into Google. Opening clean native Chrome for sign-in...");
          await this.openGoogleSignInWindow();

          const notice = "⚠️ Google Sign-In Required: A native Chrome window has been opened for dhruvbijapur67@gmail.com without automation flags so Google won't block you. Please sign in there, then click 'I\'ve Signed In — Join Meeting Again'.";
          console.warn("JARVIS:", notice);
          return { notice, needsSignIn: true };
        } else {
          // Signed in but meeting is domain-restricted (org workspace policy)
          const notice = "Google Meet: This meeting is restricted to a specific Google Workspace organization. The host may need to admit JARVIS, or join with the organization's account.";
          console.warn("JARVIS:", notice);
          return { notice };
        }
      }

      // 2. Dismiss initial popups ("Got it", "Dismiss", "Continue without microphone")
      try {
        const dismissBtns = page.locator('button:has-text("Got it"), button:has-text("Dismiss"), button:has-text("Continue without microphone and camera"), button:has-text("Continue without microphone")');
        if (await dismissBtns.first().isVisible({ timeout: 2000 })) {
          await dismissBtns.first().click();
          console.log("JARVIS: Dismissed Google Meet prompt.");
        }
      } catch { /* No popup */ }

      // 3. Fill guest name field if unauthenticated (Google Meet requires this to enable Join button)
      try {
        const nameSelectors = [
          'input[placeholder*="name" i]',
          'input[aria-label*="name" i]',
          'input[type="text"]',
        ];
        for (const sel of nameSelectors) {
          const nameInput = page.locator(sel).first();
          if (await nameInput.isVisible({ timeout: 2000 })) {
            await nameInput.fill('JARVIS (AI Assistant)');
            console.log("JARVIS: Entered participant name for Google Meet.");
            await page.waitForTimeout(500);
            break;
          }
        }
      } catch { /* Name not requested */ }

      // 4. Turn off camera and mic before joining
      try {
        const micBtn = page.locator('[aria-label*="turn off microphone" i], [aria-label*="microphone" i], [data-tooltip*="microphone" i]').first();
        if (await micBtn.isVisible({ timeout: 1500 })) {
          const label = (await micBtn.getAttribute('aria-label')) || '';
          if (!label.toLowerCase().includes('turn on')) {
            await micBtn.click();
            console.log("JARVIS: Muted microphone.");
          }
        }

        const camBtn = page.locator('[aria-label*="turn off camera" i], [aria-label*="camera" i], [data-tooltip*="camera" i]').first();
        if (await camBtn.isVisible({ timeout: 1500 })) {
          const label = (await camBtn.getAttribute('aria-label')) || '';
          if (!label.toLowerCase().includes('turn on')) {
            await camBtn.click();
            console.log("JARVIS: Turned off camera.");
          }
        }
      } catch { /* Buttons not found */ }

      // 5. Click "Ask to join" or "Join now" (with retries in case buttons take a moment to activate)
      const joinButtonSelectors = [
        'button:has-text("Join now")',
        'button:has-text("Ask to join")',
        'button:has-text("Join")',
        'button[jsname="Qx7uuf"]',
      ];

      let joined = false;
      const startTime = Date.now();
      while (!joined && Date.now() - startTime < 12000) {
        for (const sel of joinButtonSelectors) {
          try {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 1000 })) {
              await btn.click({ force: true });
              console.log(`JARVIS: Clicked Google Meet join button ("${sel}").`);
              joined = true;
              break;
            }
          } catch { /* Selector did not match */ }
        }
        if (!joined) {
          await page.waitForTimeout(800);
        }
      }

      await page.waitForTimeout(1500);

      // Check if bot is waiting for host admittance
      const isWaiting = await page.evaluate(() => {
        const bodyText = document.body.innerText.toLowerCase();
        return (
          bodyText.includes("asking to join") ||
          bodyText.includes("someone will let you in") ||
          bodyText.includes("will let you in soon") ||
          bodyText.includes("waiting for the host")
        );
      }).catch(() => false);

      if (isWaiting) {
        const notice = "🔔 JARVIS is asking to join. Boss, please click 'Admit' in your Google Meet window!";
        console.log("JARVIS:", notice);
        return { notice };
      }

    } catch (e: any) {
      console.warn("JARVIS: Google Meet join flow note:", e.message);
    }
  }

  private async handleZoomJoin(page: Page, meetingId?: string, password?: string, userInfo?: { name: string; email: string; phone: string }) {
    const userName = userInfo?.name || 'Dhruv';
    const userEmail = userInfo?.email || 'dhruvbijapur@gmail.com';
    const userPhone = userInfo?.phone || '9606571200';
    // Split name into first/last
    const nameParts = userName.trim().split(/\s+/);
    const firstName = nameParts[0] || 'Dhruv';
    const lastName = nameParts.slice(1).join(' ') || 'Bijapur';
    try {
      console.log("JARVIS: Handling Zoom join flow...");
      await page.waitForTimeout(2000);

      // 1. Accept Cookie / Terms Banners if present
      try {
        const cookieBtn = page.locator('#onetrust-accept-btn-handler, button:has-text("Accept All"), button:has-text("Agree")').first();
        if (await cookieBtn.isVisible({ timeout: 2000 })) {
          await cookieBtn.click();
          console.log("JARVIS: Accepted Zoom cookies.");
        }
      } catch {}

      // 2. Handle Webinar Registration Form (fills real user info for Dhruv)
      try {
        // Detect registration forms — both standard /webinar/register/ and any in-meeting forms
        const emailInput = page.locator('input[type="email"], input[name*="email" i], #question_email').first();
        if (await emailInput.isVisible({ timeout: 3000 })) {
          console.log("JARVIS: Webinar registration page detected. Auto-filling with Dhruv's details...");

          // First name
          const firstNameSels = [
            'input[name*="first" i]',
            '#question_first_name',
            'input[id*="first" i]',
            'input[placeholder*="first" i]',
          ];
          for (const sel of firstNameSels) {
            try {
              const el = page.locator(sel).first();
              if (await el.isVisible({ timeout: 1500 })) {
                await el.fill(firstName);
                console.log(`JARVIS: Filled first name: ${firstName}`);
                break;
              }
            } catch {}
          }

          // Last name (optional — some webinars skip it)
          const lastNameSels = [
            'input[name*="last" i]',
            '#question_last_name',
            'input[id*="last" i]',
            'input[placeholder*="last" i]',
          ];
          for (const sel of lastNameSels) {
            try {
              const el = page.locator(sel).first();
              if (await el.isVisible({ timeout: 1500 })) {
                await el.fill(lastName);
                console.log(`JARVIS: Filled last name: ${lastName}`);
                break;
              }
            } catch {}
          }

          // Email
          await emailInput.fill(userEmail);
          console.log(`JARVIS: Filled email: ${userEmail}`);

          // Phone / Mobile (some webinars ask for this)
          const phoneSels = [
            'input[type="tel"]',
            'input[name*="phone" i]',
            'input[name*="mobile" i]',
            '#question_phone',
            'input[id*="phone" i]',
            'input[placeholder*="phone" i]',
            'input[placeholder*="mobile" i]',
          ];
          for (const sel of phoneSels) {
            try {
              const el = page.locator(sel).first();
              if (await el.isVisible({ timeout: 1500 })) {
                await el.fill(userPhone);
                console.log(`JARVIS: Filled phone: ${userPhone}`);
                break;
              }
            } catch {}
          }

          // Scroll down so reCAPTCHA and Register button are in view
          await page.evaluate(() => window.scrollBy(0, 500)).catch(() => {});

          // Try clicking reCAPTCHA anchor
          try {
            const recaptchaAnchor = page.frameLocator('iframe[title="reCAPTCHA"], iframe[src*="anchor"]').locator('#recaptcha-anchor, .recaptcha-checkbox-border').first();
            if (await recaptchaAnchor.isVisible({ timeout: 2500 })) {
              console.log("JARVIS: Clicking reCAPTCHA checkbox...");
              await recaptchaAnchor.click({ force: true });
              await page.waitForTimeout(2000);
            }
          } catch {}

          // Ensure window is in foreground so user sees CAPTCHA if interactive challenge appears
          await this.bringWindowToFront();

          // Check if Register button is disabled (blocked by CAPTCHA)
          const regBtnLocator = page.locator('button:has-text("Register and Join"), button:has-text("Register"), button[type="submit"], #btnSubmit').first();
          let isBtnDisabled = await regBtnLocator.isDisabled({ timeout: 2000 }).catch(() => false);
          if (isBtnDisabled) {
            console.log("JARVIS: Registration button is disabled (CAPTCHA challenge). Prompting user & bringing Chrome to front...");
            if (this.state) {
              this.state.statusMessage = "🔔 CAPTCHA challenge in Zoom window — please complete it to join the webinar!";
            }
            await this.bringWindowToFront();

            // Wait up to 60s for CAPTCHA resolution
            for (let i = 0; i < 60; i++) {
              await page.waitForTimeout(1000);
              isBtnDisabled = await regBtnLocator.isDisabled().catch(() => false);
              if (!isBtnDisabled) {
                console.log("JARVIS: CAPTCHA completed! Register button is now active.");
                break;
              }
              const curUrl = page.url();
              if (!curUrl.includes('register') && !curUrl.includes('registration')) {
                console.log("JARVIS: Page redirected automatically.");
                break;
              }
            }
          }

          // Click Register / Submit
          try {
            if (await regBtnLocator.isVisible({ timeout: 2000 })) {
              await regBtnLocator.click({ force: true });
              console.log("JARVIS: Clicked Register and Join button.");
              if (this.state) {
                this.state.statusMessage = "Registration submitted! Connecting to webinar...";
              }
            }
          } catch {}

          // Wait for confirmation page
          console.log("JARVIS: Waiting for registration confirmation...");
          await page.waitForTimeout(5000);
          await this.bringWindowToFront();

          // After registration, Zoom shows a confirmation page with "Join Webinar" / "Add to Calendar" buttons.
          // The confirmation page also contains the actual /wc/join or /s/ webinar link.
          const afterUrl = page.url();
          console.log(`JARVIS: Post-registration URL: ${afterUrl}`);

          // Try to click "Join Webinar" if visible on confirmation page
          const joinWebinarSels = [
            'a:has-text("Join Webinar")',
            'button:has-text("Join Webinar")',
            'a:has-text("Start Webinar")',
            'a:has-text("Click here to join")',
            'a:has-text("join the webinar")',
            'a[href*="/wc/"]',
            'a[href*="/s/"]',
            'a[href*="zoom.us/j/"]',
            'a[href*="zoom.us/w/"]',
          ];
          let joinedFromConfirmation = false;
          for (const sel of joinWebinarSels) {
            try {
              const el = page.locator(sel).first();
              if (await el.isVisible({ timeout: 3000 })) {
                const href = await el.getAttribute('href').catch(() => null);
                console.log(`JARVIS: Found join link on confirmation page: ${href || sel}`);
                await el.click();
                joinedFromConfirmation = true;
                console.log("JARVIS: Clicked Join Webinar from confirmation page.");
                await page.waitForTimeout(4000);
                break;
              }
            } catch {}
          }

          // If the page has a direct /wc/ or /s/ URL embedded, navigate there
          if (!joinedFromConfirmation) {
            const pageContent = await page.content().catch(() => '');
            const wcMatch = pageContent.match(/https:\/\/[\w.]*zoom\.us\/(?:wc|s)\/(\d+\/join[^"'\s]*|[^"'\s]+)/i);
            if (wcMatch) {
              const webinarJoinUrl = wcMatch[0].replace(/&amp;/g, '&');
              console.log(`JARVIS: Extracted webinar join URL: ${webinarJoinUrl}`);
              await page.goto(webinarJoinUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
              await page.waitForTimeout(3000);
            }
          }
        }
      } catch (regErr: any) {
        console.warn("JARVIS: Webinar registration flow note:", regErr.message);
      }

      // Ensure we are operating on the active page/tab (in case registration opened a new tab)
      if (this.state?.page) {
        page = this.state.page;
      }

      // 3. If on Zoom Web Client (/wc/): Enter name & password, then click Join
      const isWebClient = page.url().includes('/wc/');
      if (isWebClient) {
        console.log("JARVIS: Zoom Web Client loaded. Filling credentials...");

        // Fill Name
        const nameSelectors = [
          '#input-for-name',
          'input[name="name"]',
          '#inputname',
          'input[placeholder*="name" i]',
          'input[id*="name" i]',
        ];
        for (const sel of nameSelectors) {
          try {
            const nameEl = page.locator(sel).first();
            if (await nameEl.isVisible({ timeout: 2500 })) {
              await nameEl.fill(userName);
              console.log(`JARVIS: Entered participant name (${userName}) in Zoom Web Client.`);
              break;
            }
          } catch {}
        }

        // Fill Passcode if requested
        if (password) {
          try {
            const pwdSelectors = [
              '#input-for-pwd',
              'input[name="password"]',
              '#joinPassword',
              'input[type="password"]',
            ];
            for (const sel of pwdSelectors) {
              const pwdEl = page.locator(sel).first();
              if (await pwdEl.isVisible({ timeout: 2000 })) {
                await pwdEl.fill(password);
                console.log("JARVIS: Entered Zoom passcode.");
                break;
              }
            }
          } catch {}
        }

        // Click Join button
        const joinBtnSelectors = [
          'button.preview-join-button',
          'button:has-text("Join")',
          '#joinBtn',
          'button[type="submit"]',
        ];
        for (const sel of joinBtnSelectors) {
          try {
            const joinBtn = page.locator(sel).first();
            if (await joinBtn.isVisible({ timeout: 3000 })) {
              await joinBtn.click();
              console.log(`JARVIS: Clicked Zoom Web Client join button ("${sel}").`);
              break;
            }
          } catch {}
        }
      } else {
        // 4. Fallback if landing on a standard Zoom desktop download page (/j/):
        console.log("JARVIS: Looking for 'Join from browser' on landing page...");

        const joinFromBrowserSelectors = [
          'button:has-text("Join from browser")',
          'button:has-text("Join from your browser")',
          'a:has-text("Join from browser")',
          'a:has-text("Join from your browser")',
          '#fallback_btn',
          'a[href*="/wc/"]',
        ];

        let clickedFallback = false;
        for (const sel of joinFromBrowserSelectors) {
          try {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 2000 })) {
              await el.click();
              clickedFallback = true;
              console.log(`JARVIS: Clicked web fallback link: "${sel}"`);
              break;
            }
          } catch {}
        }

        if (!clickedFallback) {
          try {
            const launchBtn = page.locator('button:has-text("Launch Meeting"), a:has-text("Launch Meeting")').first();
            if (await launchBtn.isVisible({ timeout: 2000 })) {
              console.log("JARVIS: Clicking 'Launch Meeting' to reveal browser fallback...");
              await launchBtn.click();
              await page.waitForTimeout(3000);

              for (const sel of joinFromBrowserSelectors) {
                const el = page.locator(sel).first();
                if (await el.isVisible({ timeout: 2000 })) {
                  await el.click();
                  clickedFallback = true;
                  console.log(`JARVIS: Found web fallback after launching: "${sel}"`);
                  break;
                }
              }
            }
          } catch {}
        }

        // Fill Name if on name entry page
        try {
          const nameInput = page.locator('#inputname, input[placeholder*="name" i], #input-for-name').first();
          if (await nameInput.isVisible({ timeout: 4000 })) {
            await nameInput.fill(userName);
            const joinBtn = page.locator('button:has-text("Join"), #joinBtn').first();
            if (await joinBtn.isVisible({ timeout: 2000 })) {
              await joinBtn.click();
            }
          }
        } catch {}
      }

      // 5. Connect Computer Audio inside meeting UI
      await page.waitForTimeout(5000);
      try {
        const audioBtn = page.locator(
          'button:has-text("Join Audio by Computer"), button:has-text("Computer Audio"), button.join-audio-by-voip'
        ).first();
        if (await audioBtn.isVisible({ timeout: 4000 })) {
          await audioBtn.click();
          console.log("JARVIS: Connected computer audio in Zoom.");
        }
      } catch {}

      await this.bringWindowToFront();

    } catch (e: any) {
      console.warn("JARVIS: Zoom join flow note:", e.message);
    }
  }

  // ─── CAPTION & DIALOGUE SCRAPER ───────────────────────────────────────

  private async enableCaptionsAndStartRecording() {
    if (!this.state?.page) return;
    const page = this.state.page;
    console.log("JARVIS: Enabling captions and starting transcription engine...");

    try {
      if (this.state.meetingPlatform === 'google-meet') {
        await this.enableGoogleMeetCaptions(page);
      } else if (this.state.meetingPlatform === 'zoom') {
        await this.enableZoomCaptions(page);
      }
    } catch (e: any) {
      console.warn("JARVIS: Caption toggle note:", e.message);
    }

    this.state.isRecording = true;
    this.startSmartCaptionEngine(page);
  }

  private async enableGoogleMeetCaptions(page: Page) {
    try {
      await page.mouse.move(500, 500);
      await page.waitForTimeout(500);

      // In Google Meet, 'c' is the standard shortcut to toggle captions
      await page.keyboard.press('c');
      console.log("JARVIS: Toggled Google Meet captions via shortcut 'c'.");

      const ccButton = page.locator(
        'button[aria-label*="Turn on captions" i], button[aria-label*="captions" i]'
      ).first();
      if (await ccButton.isVisible({ timeout: 2000 })) {
        const label = (await ccButton.getAttribute('aria-label')) || '';
        if (label.toLowerCase().includes('turn on')) {
          await ccButton.click();
        }
      }
    } catch {}
  }

  private async ensureCaptionsEnabled(page: Page) {
    try {
      if (this.state?.meetingPlatform === 'google-meet') {
        // Dismiss any accidental popups or settings dialogs that may have opened
        await page.evaluate(() => {
          const dialogClose = document.querySelector(
            '[role="dialog"] button[aria-label*="Close" i], [role="dialog"] button[aria-label*="Cancel" i]'
          ) as HTMLElement | null;
          if (dialogClose) dialogClose.click();
        }).catch(() => {});

        const ccResult = await page.evaluate(() => {
          // 1. Check if captions are already active (button says "Turn off captions" or is pressed)
          const turnOff = document.querySelector(
            'button[aria-label*="Turn off captions" i], button[data-tooltip*="Turn off captions" i], button[aria-label*="Turn off live captions" i], button[aria-pressed="true"][aria-label*="caption" i]'
          );
          if (turnOff) {
            return 'already_on';
          }

          // 2. Look for turn on button
          const turnOn = document.querySelector(
            'button[aria-label*="Turn on captions" i], button[data-tooltip*="Turn on captions" i], button[aria-label*="Turn on live captions" i], button[aria-pressed="false"][aria-label*="caption" i]'
          ) as HTMLElement | null;
          if (turnOn) {
            turnOn.click();
            return 'clicked_turn_on';
          }

          return 'not_found';
        }).catch(() => 'not_found');

        if (ccResult === 'clicked_turn_on') {
          this._captionsToggledOnce = true;
          console.log("JARVIS: Activated Google Meet live captions via CC button.");
        } else if (ccResult === 'already_on') {
          this._captionsToggledOnce = true;
        } else if (ccResult === 'not_found' && !this._captionsToggledOnce) {
          this._captionsToggledOnce = true;
          await page.keyboard.press('c');
          console.log("JARVIS: Pressed 'c' once to activate live captions.");
        }
      } else if (this.state?.meetingPlatform === 'zoom') {
        await this.enableZoomCaptions(page);
      }
    } catch {}
  }

  private async enableZoomCaptions(page: Page) {
    try {
      const frames = page.frames();
      const captionBtnSelectors = [
        'button[aria-label="Show Captions"]',
        'button[aria-label*="Show Caption" i]',
        'button.new-lt-button',
        'button[aria-label*="caption" i]',
        'button[aria-label*="live transcript" i]',
        'button[aria-label*="subtitle" i]',
        'button[aria-label*="CC" i]',
        'button:has-text("Show Captions")',
        'button:has-text("Captions")',
        'button:has-text("CC")',
        'button:has-text("Live Transcript")',
        'button:has-text("Show Subtitle")',
        'button:has-text("Subtitle")',
        '#captions button',
        '[class*="caption-btn"]',
        '[class*="subtitle-btn"]',
        '[data-testid*="caption"]',
      ];

      for (const frame of frames) {
        // Move mouse in frame to reveal bottom toolbar (Zoom auto-hides it)
        try {
          const vp = page.viewportSize() || { width: 960, height: 540 };
          await page.mouse.move(vp.width / 2, vp.height - 50);
          await page.waitForTimeout(400);
        } catch {}

        // Check if captions are already active
        try {
          const alreadyOn = await frame.evaluate(() => {
            const btn = document.querySelector(
              'button[aria-label*="Hide Caption" i], button[aria-label*="Turn off caption" i], button[aria-pressed="true"][aria-label*="caption" i]'
            );
            return !!btn;
          }).catch(() => false);
          if (alreadyOn) {
            return;
          }
        } catch {}

        for (const sel of captionBtnSelectors) {
          try {
            const btn = frame.locator(sel).first();
            if (await btn.isVisible({ timeout: 1000 })) {
              await btn.click({ force: true });
              console.log(`JARVIS: Clicked Zoom Captions button in frame: ${sel}`);

              // If a dropdown menu appears after clicking, pick the subtitle option
              await page.waitForTimeout(500);
              const subtitleOption = frame.locator(
                '[role="menuitem"]:has-text("Show Subtitle"), [role="menuitem"]:has-text("Show Captions"), ' +
                'li:has-text("Show Subtitle"), li:has-text("Show Captions"), a:has-text("Show Subtitle")'
              ).first();
              if (await subtitleOption.isVisible({ timeout: 1200 })) {
                await subtitleOption.click();
                console.log('JARVIS: Selected "Show Subtitle" from dropdown menu.');
              }
              return;
            }
          } catch {}
        }

        // Fallback: Open "More" menu and look for caption options in frame
        try {
          const moreBtn = frame.locator(
            'button[aria-label*="More meeting control" i], button[aria-label*="More" i], ' +
            'button:has-text("More"), [class*="more-button"]'
          ).first();
          if (await moreBtn.isVisible({ timeout: 1000 })) {
            await moreBtn.click();
            await page.waitForTimeout(600);
            const menuItems = [
              'Captions', 'Show Captions', 'Live Transcript', 'Show Subtitle', 'Subtitle',
            ];
            for (const label of menuItems) {
              const menuItem = frame.locator(
                `li:has-text("${label}"), button:has-text("${label}"), [role="menuitem"]:has-text("${label}"), [role="option"]:has-text("${label}")`
              ).first();
              if (await menuItem.isVisible({ timeout: 1000 })) {
                await menuItem.click();
                console.log(`JARVIS: Enabled Zoom captions via More menu → "${label}".`);

                await page.waitForTimeout(500);
                const subOption = frame.locator(
                  '[role="menuitem"]:has-text("Show Subtitle"), [role="menuitem"]:has-text("Show Captions")'
                ).first();
                if (await subOption.isVisible({ timeout: 800 })) {
                  await subOption.click();
                  console.log('JARVIS: Selected subtitle sub-option.');
                }
                return;
              }
            }
            await page.keyboard.press('Escape');
          }
        } catch {}
      }

      console.log('JARVIS: Could not find Zoom caption buttons — host may need to enable them for this webinar.');
    } catch (e: any) {
      console.warn('JARVIS: enableZoomCaptions note:', e.message);
    }
  }

  private findNewText(oldStr: string, newStr: string): string {
    if (!oldStr) return newStr;
    if (oldStr === newStr) return '';

    if (newStr.startsWith(oldStr)) return newStr.substring(oldStr.length).trim();
    if (newStr.includes(oldStr)) return newStr.substring(newStr.indexOf(oldStr) + oldStr.length).trim();

    const minLen = Math.min(oldStr.length, newStr.length);
    for (let i = minLen; i >= 3; i--) {
      const suffix = oldStr.substring(oldStr.length - i);
      const prefix = newStr.substring(0, i);
      if (suffix === prefix) {
        return newStr.substring(i).trim();
      }
    }
    return newStr.trim();
  }

  private startSmartCaptionEngine(page: Page) {
    if (!this.state) return;
    this._captionActive = true;
    console.log("JARVIS: 🧠 Live transcription & chat engine active.");

    let checkCcCounter = 0;

    const tick = async () => {
      // Self-terminate if cleanup() was called or bot is no longer recording
      if (!this._captionActive || !this.state?.page || !this.state.isRecording) return;
      if (this._captionBusy) {
        this.state.captionInterval = setTimeout(tick, 1800) as any;
        return;
      }

      this._captionBusy = true;

      try {
        // If there are multiple tabs (e.g. registration page + webinar tab), ensure we are tracking the meeting tab
        if (this.state?.context) {
          const allPages = this.state.context.pages();
          if (allPages.length > 1) {
            const meetingPage = allPages.find(p => {
              const u = p.url().toLowerCase();
              return u.includes('/wc/') || u.includes('/s/') || (u.includes('/j/') && !u.includes('/register')) || (u.includes('meet.google.com/') && u !== 'https://meet.google.com/');
            }) || allPages[allPages.length - 1];
            if (meetingPage && meetingPage !== page) {
              console.log(`JARVIS: Switching active meeting page to ${meetingPage.url()}`);
              page = meetingPage;
              this.state.page = meetingPage;
            }
          }
        }

        // Step 1: Detect actual room state
        const roomState = await page.evaluate(() => {
          const bodyText = document.body.innerText.toLowerCase();
          const url = window.location.href;

          if (url === 'https://meet.google.com/' || bodyText.includes('schedule a meeting or enjoy')) {
            return { status: 'home' };
          }

          // Only consider register state if the registration form is actually present
          if (url.includes('/register') || url.includes('/registration')) {
            const hasForm = document.querySelector('input[type="email"], input[name*="email" i], #question_email, #btnSubmit');
            if (hasForm) {
              return { status: 'register' };
            }
          }

          const isWaiting =
            bodyText.includes('asking to join') ||
            bodyText.includes('someone will let you in') ||
            bodyText.includes('waiting for the host') ||
            bodyText.includes('will let you in soon') ||
            bodyText.includes('webinar will begin shortly') ||
            bodyText.includes('please wait for the host') ||
            bodyText.includes('waiting for host to start') ||
            bodyText.includes('the host has another meeting in progress') ||
            bodyText.includes('no one can join a meeting unless invited');

          if (isWaiting) {
            return { status: 'waiting' };
          }

          // Safe CSS selector check without Playwright pseudo-classes
          const hasLeave =
            document.querySelector(
              'button[aria-label*="Leave call" i], button[data-tooltip*="Leave call" i], button[jsname="CQylAd"], button.footer__leave-btn, button[aria-label*="Leave" i], [class*="leave-btn"], [class*="leave_btn"]'
            ) !== null ||
            Array.from(document.querySelectorAll('button')).some(b => {
              const txt = b.textContent?.trim().toLowerCase();
              return txt === 'leave' || txt === 'leave meeting' || txt === 'leave webinar';
            });

          const hasInCallControls =
            document.querySelector(
              'div[data-meeting-title], button[aria-label*="Meeting details" i], div[data-allocation-index], #foot-bar, .meeting-client-inner, .footer__control-bar, [class*="footer"], [class*="control-bar"], button[aria-label*="Audio" i], button[aria-label*="Mute" i], button[aria-label*="Captions" i], button[aria-label*="Subtitle" i], button[aria-label*="Chat" i], button[aria-label*="Raise Hand" i], button[aria-label*="Q&A" i]'
            ) !== null ||
            url.includes('/wc/') || url.includes('/s/') || (url.includes('/j/') && !url.includes('/register'));

          if (hasLeave || hasInCallControls) {
            return { status: 'in_call' };
          }

          return { status: 'unknown' };
        }).catch((e: any) => {
          return { status: 'unknown' };
        });

        if (roomState.status === 'register') {
          this.state.statusMessage = "🔔 Completing webinar registration in Zoom Chrome window...";
          return;
        }

        if (roomState.status === 'waiting') {
          this.state.statusMessage = "🔔 Waiting for host to start / admit to the meeting...";
          return;
        }

        if (roomState.status === 'home') {
          this.state.statusMessage = "Meeting ended or returned to home screen.";
          return;
        }

        if (roomState.status === 'in_call' || roomState.status === 'unknown') {
          if (!this.state.statusMessage.startsWith('In meeting')) {
            this.state.statusMessage = 'In meeting — Transcribing dialogue and chat...';
          }

          // Ensure captions are actively turned ON in the meeting (check every ~5 seconds)
          checkCcCounter++;
          if (checkCcCounter % 3 === 0) {
            await this.ensureCaptionsEnabled(page);
          }
        }

        // Step 2: Scrape live subtitles/captions across all frames (Zoom embeds UI in an iframe)
        const scrapedCaptions: Array<{ speaker: string; text: string }> = [];
        const frames = page.frames();

        for (const frame of frames) {
          try {
            const frameEntries = await frame.evaluate(() => {
              const entries: Array<{ speaker: string; text: string }> = [];

              // Never scrape inside modals, menus, settings, or dialogs!
              const isDialogOrMenu = (el: Element) => {
                return !!el.closest('[role="dialog"], [role="menu"], [role="listbox"], [aria-modal="true"], .VfPpkd-xl07Ob, aside');
              };

              // Google Meet dedicated subtitle containers
              const meetContainers = document.querySelectorAll('div[jsname="tgaKEf"], div.nMxPwe');
              meetContainers.forEach(container => {
                if (isDialogOrMenu(container)) return;

                const speakerEl = container.querySelector('.zs7s8d, [jsname="r4nke"], .NWp81d, [data-sender-name]');
                const speaker = speakerEl?.textContent?.trim() || '';

                const textEls = container.querySelectorAll('.VbkSUe, [jsname="YSxPC"], .bh44bd');
                let parts: string[] = [];
                textEls.forEach(el => {
                  if (speakerEl && (el === speakerEl || speakerEl.contains(el))) return;
                  const t = el.textContent?.trim() || '';
                  if (t && t.length > 0 && !parts.includes(t)) {
                    parts.push(t);
                  }
                });

                const text = parts.join(' ').replace(/\s+/g, ' ').trim();
                if (text.length > 1 && text.length < 500) {
                  entries.push({ speaker: speaker || 'Speaker', text });
                }
              });

              // Fallback: direct query for subtitle spans if outer container classes differ
              if (entries.length === 0) {
                const subtitleNodes = document.querySelectorAll('.VbkSUe, [jsname="YSxPC"]');
                subtitleNodes.forEach(node => {
                  if (isDialogOrMenu(node)) return;
                  const parent = node.closest('div');
                  const speakerEl = parent?.querySelector('.zs7s8d, [jsname="r4nke"], .NWp81d');
                  const speaker = speakerEl?.textContent?.trim() || '';
                  const text = node.textContent?.trim() || '';
                  if (text && text.length > 1 && text.length < 500) {
                    entries.push({ speaker: speaker || 'Speaker', text });
                  }
                });
              }

              // Zoom Web Client active live subtitles (exact match from Zoom DOM)
              const zoomLiveSubtitles = document.querySelectorAll('.live-transcription-subtitle__item, #live-transcription-subtitle, [class*="live-transcription-subtitle__item"]');
              zoomLiveSubtitles.forEach(node => {
                const text = node.textContent?.trim() || '';
                if (text && text.length > 1 && text.length < 1000 && !text.includes('Show Captions') && !text.includes('Hide Captions')) {
                  entries.push({ speaker: 'Speaker', text });
                }
              });

              // Zoom Web Client captions, subtitles & live transcript fallback
              if (entries.length === 0) {
                const zoomSelectors = [
                  '.live-transcription-subtitle__item',
                  '#live-transcription-subtitle',
                  '[class*="live-transcription-subtitle"]',
                  '.caption-window', '.closed-caption-window', '.cc-text',
                  '[class*="captionText"]', '[class*="caption-window"]',
                  '[class*="closed-caption"]',
                  '.meeting-transcription-item', '.live-transcript-item',
                  '.live-transcript-content', '[class*="transcript-item"]',
                  '[class*="transcript-message"]',
                  '[class*="subtitle"]', '[class*="sub-title"]',
                  '[aria-label*="caption" i]', '[aria-label*="transcript" i]',
                  '[aria-label*="subtitle" i]',
                  '[data-testid*="caption"]', '[data-testid*="transcript"]',
                ];
                const zoomItems = document.querySelectorAll(zoomSelectors.join(', '));
                zoomItems.forEach(item => {
                  if (isDialogOrMenu(item)) return;
                  if (item.tagName === 'BUTTON' || item.closest('button') || item.getAttribute('role') === 'button') return;
                  const speakerEl = item.querySelector(
                    '.speaker-name, .meeting-transcription-speaker, strong, b, ' +
                    '[class*="speaker"], [class*="sender"], [class*="name"]'
                  );
                  const speaker = speakerEl?.textContent?.trim() || '';
                  const textEl = item.querySelector(
                    '.meeting-transcription-item-text, .caption-content, ' +
                    '[class*="content"], [class*="text"], [class*="message"], span'
                  ) || item;
                  const rawText = textEl.textContent || '';
                  const text = (speaker ? rawText.replace(speaker, '') : rawText).trim();
                  if (text.length > 1 && text.length < 500 && !text.includes('Show Captions')) {
                    entries.push({ speaker: speaker || 'Speaker', text });
                  }
                });

                // Zoom in-meeting chat fallback
                const chatItems = document.querySelectorAll(
                  '.chat-item__chat-info-msg, .chat-message-item, .chat-message__text, ' +
                  '[class*="chat-message"], [class*="chatMessage"]'
                );
                chatItems.forEach(item => {
                  const sender = item.querySelector('.chat-item__sender, .sender-name, strong, [class*="sender"]')?.textContent?.trim() || 'Chat';
                  const msg = item.querySelector('.chat-item__chat-info, .message-content, [class*="message"], [class*="content"]')?.textContent?.trim() || '';
                  if (msg.length > 1 && msg.length < 500) {
                    entries.push({ speaker: `${sender} (Chat)`, text: msg });
                  }
                });
              }

              // ULTIMATE FALLBACK: Scan for visible bottom overlay divs (Zoom caption overlay)
              if (entries.length === 0) {
                const allDivs = document.querySelectorAll('div, span');
                allDivs.forEach(div => {
                  if (isDialogOrMenu(div)) return;
                  if (div.tagName === 'BUTTON' || div.closest('button') || div.getAttribute('role') === 'button' || div.closest('#foot-bar, footer, .footer, [class*="footer"]')) return;
                  const style = window.getComputedStyle(div);
                  const isBottomOverlay =
                    (style.position === 'absolute' || style.position === 'fixed') &&
                    parseInt(style.bottom || '999') < 200 &&
                    parseInt(style.fontSize || '0') >= 14;
                  if (!isBottomOverlay) return;
                  const text = div.textContent?.trim() || '';
                  if (text.length > 2 && text.length < 500 && !text.includes('Leave') && !text.includes('Show Captions') && !text.includes('Mute')) {
                    entries.push({ speaker: 'Speaker', text });
                  }
                });
              }

              return entries;
            }).catch(() => []);

            for (const entry of frameEntries) {
              if (!scrapedCaptions.some(c => c.text === entry.text)) {
                scrapedCaptions.push(entry);
              }
            }
          } catch {}
        }

        // Step 3: Filter against blacklist and deduplicate
        for (const entry of scrapedCaptions) {
          const lower = entry.text.toLowerCase();
          const isBlacklisted = SYSTEM_BLACKLIST.some(b => lower.includes(b));
          if (isBlacklisted) continue;

          const cleanText = entry.text.replace(/\s+/g, ' ').trim();
          if (cleanText.length < 2) continue;

          const recent = this.state!.captionLog.slice(-4);
          const isExactDuplicate = recent.some(r => r.text === cleanText);
          if (isExactDuplicate) continue;

          // If this is an extension of the last utterance by the same speaker within 7 seconds
          const lastEntry = this.state!.captionLog[this.state!.captionLog.length - 1];
          if (
            lastEntry &&
            lastEntry.speaker === entry.speaker &&
            cleanText.startsWith(lastEntry.text) &&
            Date.now() - new Date(lastEntry.timestamp).getTime() < 7000
          ) {
            lastEntry.text = cleanText;
            continue;
          }

          const logEntry: CaptionEntry = {
            speaker: entry.speaker || this.currentSpeaker,
            text: cleanText,
            timestamp: new Date().toISOString(),
            source: 'caption',
          };
          this.state!.captionLog.push(logEntry);
          console.log(`JARVIS 📝 [${logEntry.speaker}]: ${logEntry.text}`);
        }

        // Step 4: Also scrape in-meeting chat messages across all frames
        const chatEntries: Array<{ speaker: string; text: string }> = [];
        for (const frame of frames) {
          try {
            const frameMsgs = await frame.evaluate(() => {
              const msgs: Array<{ speaker: string; text: string }> = [];
              document.querySelectorAll('div[data-message-text]').forEach(el => {
                const text = el.textContent?.trim();
                const parent = el.closest('[data-sender-name]');
                const speaker = parent?.getAttribute('data-sender-name') || 'Chat User';
                if (text) msgs.push({ speaker, text });
              });
              document.querySelectorAll('.chat-item__chat-info, .chat-message__text').forEach(el => {
                const text = el.textContent?.trim();
                if (text) msgs.push({ speaker: 'Chat User', text });
              });
              return msgs.slice(-5);
            }).catch(() => []);
            for (const m of frameMsgs) {
              if (!chatEntries.some(c => c.text === m.text)) {
                chatEntries.push(m);
              }
            }
          } catch {}
        }

        if (chatEntries.length > 0) {
          for (const msg of chatEntries) {
            const alreadyExists = this.state!.captionLog.some(e => e.text === msg.text);
            if (!alreadyExists && msg.text.length > 1) {
              const chatEntry: CaptionEntry = {
                speaker: msg.speaker,
                text: msg.text,
                timestamp: new Date().toISOString(),
                source: 'chat',
              };
              this.state!.captionLog.push(chatEntry);
              console.log(`JARVIS 💬 [${chatEntry.speaker}]: ${chatEntry.text}`);
            }
          }
        }

      } catch (e: any) {
        console.warn("JARVIS: Caption scrape loop note:", e?.message?.substring(0, 80));
      } finally {
        this._captionBusy = false;
        if (this._captionActive && this.state?.isRecording) {
          this.state.captionInterval = setTimeout(tick, 1800) as any;
        }
      }
    };

    this.state.captionInterval = setTimeout(tick, 2000) as any;
  }

  // ─── WAITING ROOM MONITOR ─────────────────────────────────────────────

  private startWaitingRoomMonitor() {
    if (!this.state) return;

    this.state.monitorInterval = setInterval(async () => {
      if (!this.state?.page) return;

      try {
        const info = await this.state.page.evaluate(() => {
          const bodyText = document.body.innerText.toLowerCase();
          const isWaiting =
            bodyText.includes("asking to join") ||
            bodyText.includes("waiting room") ||
            bodyText.includes("someone will let you in") ||
            bodyText.includes("will let you in soon") ||
            bodyText.includes("waiting for the host") ||
            bodyText.includes("no one can join a meeting unless invited");

          const hasLeave =
            document.querySelector('button[aria-label*="Leave call" i], button[data-tooltip*="Leave call" i], button[jsname="CQylAd"]') !== null;

          return { isWaiting, hasLeave };
        });

        if (info.isWaiting) {
          this.state.statusMessage = "🔔 JARVIS is asking to join. Boss, please click 'Admit' in your Google Meet window!";
          console.log("JARVIS: In waiting room — waiting for host admittance.");
        } else if (info.hasLeave) {
          if (!this.state.statusMessage.startsWith('In meeting')) {
            this.state.statusMessage = "In meeting — Transcribing dialogue and chat...";
          }
        }
      } catch {}
    }, 4000);
  }

  // ─── LEAVE & SUMMARIZE ─────────────────────────────────────────────────

  async leaveMeeting() {
    if (!this.state) {
      return { success: false, message: "No active meeting found." };
    }

    console.log("JARVIS: Leaving the meeting...");
    const captionLog = [...(this.state.captionLog || [])];
    const platform = this.state.meetingPlatform;
    const meetingUrl = this.state.meetingUrl;
    const captionCount = captionLog.length;

    await this.cleanup();
    this.lastResult = null;
    this._isSyncingNotion = true;

    // Trigger AI summarization and Notion sync
    console.log(`JARVIS: Processing meeting session (${captionCount} dialogue entries)...`);
    this.runSummarizationPipeline(captionLog, platform, meetingUrl).catch(e => {
      console.error("JARVIS: Summarization pipeline error:", e);
      this._isSyncingNotion = false;
    });

    return {
      success: true,
      message:
        captionCount > 0
          ? `JARVIS has left the meeting. Captured ${captionCount} dialogue entries — generating summary & syncing to Notion now, Boss.`
          : "JARVIS has left the meeting. Meeting attendance note is being synced to Notion.",
      captionCount,
    };
  }

  private extractValidJson(raw: string): MeetingSummary | null {
    try {
      return JSON.parse(raw);
    } catch {
      const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      try {
        return JSON.parse(cleaned);
      } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            return JSON.parse(match[0]);
          } catch {}
        }
      }
    }
    return null;
  }

  private async runSummarizationPipeline(captionLog: CaptionEntry[], platform: string, meetingUrl: string) {
    try {
      const transcript =
        captionLog.length > 0
          ? captionLog
              .map(entry => `[${new Date(entry.timestamp).toLocaleTimeString()}] ${entry.speaker}: ${entry.text}`)
              .join('\n')
          : "(No speech dialogue was captured during this session. Captions may have been disabled.)";

      console.log("JARVIS: Generating meeting summary...");
      let summary: MeetingSummary | null = null;

      // 1. Direct AI Summarization with Gemini 2.5 Flash
      const geminiKey = process.env.GEMINI_API_KEY;
      if (geminiKey && captionLog.length > 0) {
        try {
          const prompt = `You are JARVIS, an elite executive AI assistant. Analyze the following meeting transcript and return a structured summary as JSON.

Format strictly as JSON:
{
  "summary": "2-3 sentence overview of the meeting",
  "keyTopics": ["topic 1", "topic 2"],
  "decisions": ["decision 1", "decision 2"],
  "actionItems": [
    { "task": "specific action", "assignee": "person or Unassigned", "due": "suggested due date", "priority": 1 }
  ],
  "nextSteps": "follow-ups or next meeting notes"
}

Transcript:
${transcript.slice(0, 30000)}`;

          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  responseMimeType: 'application/json',
                  temperature: 0.2,
                },
              }),
            }
          );

          if (geminiRes.ok) {
            const data = await geminiRes.json();
            const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textContent) {
              summary = this.extractValidJson(textContent);
            }
          }
        } catch (aiErr: any) {
          console.warn("JARVIS: Gemini summarization note:", aiErr.message);
        }
      }

      // Fallback summary if AI was unavailable or 0 captions
      if (!summary) {
        summary = {
          summary:
            captionLog.length > 0
              ? `Meeting concluded on ${new Date().toLocaleDateString()} via ${platform}. JARVIS collected ${captionLog.length} dialogue entries.`
              : `Meeting session logged on ${new Date().toLocaleDateString()} (${platform}). No live captions were detected.`,
          keyTopics: [platform === 'zoom' ? 'Zoom Meeting' : platform === 'google-meet' ? 'Google Meet' : 'Online Conference'],
          decisions: ['Meeting attended and recorded in JARVIS log.'],
          actionItems: [],
          nextSteps: 'Review meeting dialogue log.',
        };
      }

      console.log("JARVIS: ✅ Summary generated:", summary.summary);

      // 2. Direct Sync to Notion Database (no fragile loopback HTTP requests)
      const notionToken = process.env.NOTION_TOKEN;
      const notionDatabaseId = process.env.NOTION_DATABASE_ID;
      let notionUrl: string | null = null;

      if (notionToken && notionDatabaseId) {
        try {
          notionUrl = await this.saveToNotionDirect({
            title: `Meeting Notes — ${new Date().toLocaleDateString()} (${platform.toUpperCase()})`,
            summary,
            transcript,
            meetingUrl,
          });
          console.log("JARVIS: 📝 Notes saved to Notion:", notionUrl);
        } catch (notionErr: any) {
          console.error("JARVIS: Notion sync error:", notionErr.message);
        }
      } else {
        console.warn("JARVIS: Notion credentials not configured in .env.local");
      }

      // 3. Sync Action Items to Todoist
      const todoistToken = process.env.TODOIST_API_TOKEN;
      if (todoistToken && summary.actionItems && Array.isArray(summary.actionItems)) {
        for (const item of summary.actionItems) {
          try {
            await fetch('https://api.todoist.com/rest/v2/tasks', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${todoistToken}`,
              },
              body: JSON.stringify({
                content: `[Meeting] ${item.task}`,
                due_string: item.due || 'next week',
                priority: item.priority || 1,
              }),
            });
          } catch {}
        }
      }

      // Store result
      this.lastResult = {
        title: `Meeting Notes — ${new Date().toLocaleDateString()}`,
        platform,
        captionCount: captionLog.length,
        summary,
        notionUrl,
        timestamp: new Date().toISOString(),
      };
      this._isSyncingNotion = false;

    } catch (e) {
      this._isSyncingNotion = false;
      console.error("JARVIS: Error in summarization pipeline:", e);
    }
  }

  private async saveToNotionDirect(params: {
    title: string;
    summary: MeetingSummary;
    transcript: string;
    meetingUrl: string;
  }): Promise<string | null> {
    const notionToken = process.env.NOTION_TOKEN;
    const notionDatabaseId = process.env.NOTION_DATABASE_ID;
    if (!notionToken || !notionDatabaseId) return null;

    // Split transcript into <= 2000-char chunks for Notion block limits
    const transcriptBlocks: any[] = [];
    const MAX_CHUNK = 1800;
    for (let i = 0; i < params.transcript.length; i += MAX_CHUNK) {
      transcriptBlocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: params.transcript.substring(i, i + MAX_CHUNK) } }],
        },
      });
    }

    const children: any[] = [
      {
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: 'Executive Summary' } }],
        },
      },
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: params.summary.summary } }],
        },
      },
      {
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: 'Key Topics' } }],
        },
      },
      ...(params.summary.keyTopics || []).map((t: string) => ({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: t } }],
        },
      })),
      {
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: 'Decisions' } }],
        },
      },
      ...(params.summary.decisions || []).map((d: string) => ({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: d } }],
        },
      })),
      {
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: 'Action Items' } }],
        },
      },
      ...(params.summary.actionItems || []).map((item: any) => ({
        object: 'block',
        type: 'to_do',
        to_do: {
          rich_text: [
            {
              type: 'text',
              text: { content: `${item.task} (${item.assignee || 'Unassigned'}) — Due: ${item.due || 'TBD'}` },
            },
          ],
          checked: false,
        },
      })),
      {
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: 'Meeting Transcript' } }],
        },
      },
      ...transcriptBlocks.slice(0, 50),
    ];

    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { database_id: notionDatabaseId },
        properties: {
          Name: {
            title: [{ text: { content: params.title } }],
          },
          Tags: {
            multi_select: [{ name: 'Meeting' }, { name: 'JARVIS-Bot' }],
          },
          ...(params.meetingUrl ? { URL: { url: params.meetingUrl } } : {}),
        },
        children,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Notion API error ${res.status}: ${JSON.stringify(err)}`);
    }

    const data = await res.json();
    return data.url || null;
  }

  // ─── CHAT ──────────────────────────────────────────────────────────────

  async sendChatMessage(message: string) {
    if (!this.state?.page) {
      return { success: false, error: 'No active meeting session.' };
    }

    try {
      const page = this.state.page;

      if (this.state.meetingPlatform === 'google-meet') {
        const chatBtn = page.locator('[aria-label*="chat" i], button:has-text("Chat")').first();
        if (await chatBtn.isVisible({ timeout: 2500 })) {
          await chatBtn.click();
          await page.waitForTimeout(500);
        }

        const chatInput = page
          .locator('textarea[aria-label*="Send a message" i], textarea[placeholder*="Send a message" i]')
          .first();
        await chatInput.waitFor({ state: 'visible', timeout: 5000 });
        await chatInput.fill(message);
        await chatInput.press('Enter');

        return { success: true, message: `Message sent: "${message}"` };
      }

      if (this.state.meetingPlatform === 'zoom') {
        const chatBtn = page.locator('[aria-label*="Chat" i]').first();
        if (await chatBtn.isVisible({ timeout: 2500 })) {
          await chatBtn.click();
          await page.waitForTimeout(500);
        }

        const chatInput = page
          .locator('textarea.chat-box__chat-textarea, textarea[placeholder*="Type message" i]')
          .first();
        await chatInput.waitFor({ state: 'visible', timeout: 5000 });
        await chatInput.fill(message);
        await chatInput.press('Enter');

        return { success: true, message: `Message sent: "${message}"` };
      }

      return { success: false, error: 'Unsupported platform for chat.' };
    } catch (e: any) {
      return { success: false, error: `Could not send message: ${e.message}` };
    }
  }

  // ─── CLEANUP ───────────────────────────────────────────────────────────

  private async cleanup() {
    if (!this.state) return;

    // Flip the caption guard FIRST so any in-flight tick self-terminates
    this._captionActive = false;
    this._captionBusy = false;
    this._captionsToggledOnce = false;

    if (this.state.monitorInterval) clearInterval(this.state.monitorInterval);
    if (this.state.captionInterval) clearTimeout(this.state.captionInterval);

    // Mark as not recording so any already-running async tick won't reschedule
    this.state.isRecording = false;

    try {
      await this.state.context.close();
    } catch { /* Context may already be closed if browser was closed externally */ }

    this.previousSnapshot = '';
    this.state = null;
  }

  getStatus() {
    return {
      isActive: !!this.state,
      isRecording: this.state?.isRecording || false,
      isSyncingNotion: this._isSyncingNotion,
      captionsCollected: this.state?.captionLog?.length || 0,
      platform: this.state?.meetingPlatform || null,
      statusMessage:
        this.state?.statusMessage ||
        (this._isSyncingNotion
          ? 'Generating AI summary with Gemini & syncing to Notion...'
          : this.state
          ? 'In Meeting'
          : 'Idle'),
      lastResult: this.lastResult,
    };
  }

  async getPageDebugInfo(): Promise<any> {
    if (!this.state?.page) return { error: 'Bot not active' };
    const page = this.state.page;
    try {
      const frames = page.frames();
      const frameInfo: any[] = [];
      for (const frame of frames) {
        try {
          const info = await frame.evaluate(() => {
            const buttons: any[] = [];
            document.querySelectorAll('button, [role="button"], div, span, a').forEach(el => {
              const text = el.textContent?.trim() || '';
              const aria = el.getAttribute('aria-label') || '';
              if (
                text === 'Show Captions' || text === 'Captions' || text === 'CC' ||
                aria.toLowerCase().includes('caption') ||
                text === 'Chat' || text === 'Leave'
              ) {
                buttons.push({
                  tagName: el.tagName,
                  className: typeof el.className === 'string' ? el.className : '',
                  ariaLabel: aria,
                  text: text,
                  outerHTML: el.outerHTML.substring(0, 150),
                });
              }
            });
            return {
              url: window.location.href,
              buttons,
            };
          }).catch((err: any) => ({ url: frame.url(), error: err.message }));
          frameInfo.push(info);
        } catch {}
      }

      return {
        url: page.url(),
        title: await page.title(),
        frameCount: frames.length,
        frameInfo,
        captionsCollected: this.state.captionLog.length,
        isRecording: this.state.isRecording,
      };
    } catch (e: any) {
      return { error: e.message };
    }
  }

  restartCaptionEngine(): { success: boolean; message: string } {
    if (!this.state?.page) {
      return { success: false, message: 'No active meeting session.' };
    }
    if (this.state.captionInterval) {
      clearTimeout(this.state.captionInterval);
      this.state.captionInterval = null;
    }
    this._captionActive = false;
    this._captionBusy = false;
    this.state.isRecording = true;
    this.startSmartCaptionEngine(this.state.page);
    return { success: true, message: 'Caption engine re-armed with latest selectors.' };
  }
}

// Singleton pinned to globalThis so Next.js HMR and separate requests share the exact same instance
const globalForMeetingBot = globalThis as unknown as {
  __jarvisMeetingBot?: MeetingBotService;
};

if (!globalForMeetingBot.__jarvisMeetingBot) {
  globalForMeetingBot.__jarvisMeetingBot = new MeetingBotService();
} else {
  // Ensure prototype methods are up-to-date across Next.js HMR reloads
  Object.setPrototypeOf(globalForMeetingBot.__jarvisMeetingBot, MeetingBotService.prototype);
}

export const meetingBot = globalForMeetingBot.__jarvisMeetingBot;
