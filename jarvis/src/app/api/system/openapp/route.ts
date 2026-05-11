import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// App protocols and executable names for Windows
const appMappings: Record<string, { protocol: string; exe: string[]; webUrl: string }> = {
  whatsapp: {
    protocol: "whatsapp://",
    exe: ["WhatsApp.exe", "WhatsApp"],
    webUrl: "https://web.whatsapp.com",
  },
  telegram: {
    protocol: "tg://",
    exe: ["Telegram.exe", "Telegram Desktop.exe", "Telegram"],
    webUrl: "https://web.telegram.org",
  },
  instagram: {
    protocol: "instagram://",
    exe: [], // Instagram doesn't have a desktop app
    webUrl: "https://instagram.com",
  },
  spotify: {
    protocol: "spotify://",
    exe: ["Spotify.exe", "Spotify"],
    webUrl: "https://open.spotify.com",
  },
  discord: {
    protocol: "discord://",
    exe: ["Discord.exe", "Discord", "Discord PTB.exe", "Discord Canary.exe"],
    webUrl: "https://discord.com/app",
  },
  vscode: {
    protocol: "vscode://",
    exe: ["Code.exe", "Visual Studio Code.exe", "Code - Insiders.exe"],
    webUrl: "https://vscode.dev",
  },
  notepad: {
    protocol: "notepad://",
    exe: ["notepad.exe"],
    webUrl: "notepad://",
  },
  calculator: {
    protocol: "calculator://",
    exe: ["calc.exe"],
    webUrl: "calculator://",
  },
  chrome: {
    protocol: "chrome://",
    exe: ["chrome.exe", "Google Chrome.exe"],
    webUrl: "https://google.com",
  },
  edge: {
    protocol: "microsoft-edge://",
    exe: ["msedge.exe", "Microsoft Edge.exe"],
    webUrl: "https://google.com",
  },
  firefox: {
    protocol: "firefox://",
    exe: ["firefox.exe", "Firefox.exe"],
    webUrl: "https://google.com",
  },
};

async function isAppInstalled(exeNames: string[]): Promise<boolean> {
  for (const exe of exeNames) {
    try {
      // Check if process is running
      await execAsync(`tasklist /FI "IMAGENAME eq ${exe}" /FO CSV | findstr /I "${exe}"`);
      return true;
    } catch {
      // Try to find in Program Files
      try {
        const { stdout } = await execAsync(`where ${exe} 2>nul || echo NOT_FOUND`);
        if (!stdout.includes("NOT_FOUND") && !stdout.includes("Could not find")) {
          return true;
        }
      } catch {
        // Not found
      }
    }
  }
  return false;
}

async function openApp(appName: string): Promise<{ success: boolean; method: string; message: string }> {
  const app = appMappings[appName.toLowerCase()];

  if (!app) {
    return { success: false, method: "unknown", message: `Unknown app: ${appName}` };
  }

  // Check if desktop app is installed
  const isInstalled = await isAppInstalled(app.exe);

  if (isInstalled && app.exe.length > 0) {
    try {
      // Try to open using protocol first
      await execAsync(`start "" "${app.protocol}"`);
      return { success: true, method: "desktop", message: `Opened ${appName} desktop app` };
    } catch (protocolError) {
      // Try to launch executable directly
      for (const exe of app.exe) {
        try {
          await execAsync(`start "" ${exe}`);
          return { success: true, method: "desktop", message: `Opened ${appName} desktop app` };
        } catch {
          continue;
        }
      }
    }
  }

  // Fall back to web
  try {
    await execAsync(`start "" "${app.webUrl}"`);
    return { success: true, method: "web", message: `Opened ${appName} in browser` };
  } catch (webError) {
    return { success: false, method: "none", message: `Failed to open ${appName}` };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { app } = body;

    if (!app) {
      return NextResponse.json(
        { error: "App name required" },
        { status: 400 }
      );
    }

    const result = await openApp(app);

    return NextResponse.json({
      success: result.success,
      app,
      method: result.method,
      message: result.message,
    });
  } catch (error) {
    console.error("Open app error:", error);
    return NextResponse.json(
      { error: "Failed to open app", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const app = searchParams.get("app");

    if (!app || !appMappings[app]) {
      return NextResponse.json({
        success: false,
        availableApps: Object.keys(appMappings),
      });
    }

    const mapping = appMappings[app];
    const isInstalled = await isAppInstalled(mapping.exe);

    return NextResponse.json({
      success: true,
      app,
      isInstalled,
      hasDesktopApp: mapping.exe.length > 0,
      protocol: mapping.protocol,
      webUrl: mapping.webUrl,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to check app", details: String(error) },
      { status: 500 }
    );
  }
}
