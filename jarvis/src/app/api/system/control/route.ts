import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, x, y, text, keys, button = "left", clicks = 1, amount = 0 } = body;

    let pythonCode = "import pyautogui; pyautogui.FAILSAFE = True; ";

    switch (action) {
      case "click": {
        if (x !== undefined && y !== undefined) {
          pythonCode += `pyautogui.click(x=${x}, y=${y}, button='${button}', clicks=${clicks});`;
        } else {
          pythonCode += `pyautogui.click(button='${button}', clicks=${clicks});`;
        }
        break;
      }
      case "move": {
        if (x !== undefined && y !== undefined) {
          pythonCode += `pyautogui.moveTo(${x}, ${y}, duration=0.25);`;
        } else {
          return NextResponse.json({ error: "x and y coordinates are required for move action" }, { status: 400 });
        }
        break;
      }
      case "type": {
        if (text !== undefined) {
          // Escape quotes in text
          const escapedText = text.replace(/'/g, "\\'");
          pythonCode += `pyautogui.write('${escapedText}', interval=0.05);`;
        } else {
          return NextResponse.json({ error: "text is required for type action" }, { status: 400 });
        }
        break;
      }
      case "press": {
        if (keys && Array.isArray(keys)) {
          const keysStr = keys.map(k => `'${k}'`).join(", ");
          pythonCode += `for k in [${keysStr}]: pyautogui.press(k);`;
        } else if (text) {
          pythonCode += `pyautogui.press('${text}');`;
        } else {
          return NextResponse.json({ error: "keys (array) or text (string) is required for press action" }, { status: 400 });
        }
        break;
      }
      case "hotkey": {
        if (keys && Array.isArray(keys)) {
          const keysStr = keys.map(k => `'${k}'`).join(", ");
          pythonCode += `pyautogui.hotkey(${keysStr});`;
        } else {
          return NextResponse.json({ error: "keys array is required for hotkey action" }, { status: 400 });
        }
        break;
      }
      case "scroll": {
        if (amount !== undefined) {
          pythonCode += `pyautogui.scroll(${amount});`;
        } else {
          return NextResponse.json({ error: "amount is required for scroll action" }, { status: 400 });
        }
        break;
      }
      case "position": {
        pythonCode += "print(list(pyautogui.position()));";
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    // Execute Python script to run PyAutoGUI
    const { stdout, stderr } = await execAsync(`python -c "${pythonCode}"`);

    if (stderr) {
      console.warn("PyAutoGUI warning/error on stderr:", stderr);
    }

    let result: any = { success: true, action };
    if (action === "position" && stdout) {
      try {
        const coords = JSON.parse(stdout.trim());
        result.x = coords[0];
        result.y = coords[1];
      } catch (err) {
        result.rawOutput = stdout;
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("PyAutoGUI control error:", error);
    return NextResponse.json(
      { error: "Failed to execute PyAutoGUI control command", details: String(error) },
      { status: 500 }
    );
  }
}
