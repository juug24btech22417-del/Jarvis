/**
 * End-to-end check for Window Devourer — on real windows, with real pixels.
 *
 * What is genuinely exercised here:
 *   • Win32 hit-testing   a real Notepad window is located under a real point
 *   • window capture      a real frame is pulled and checked for actual pixels
 *                         (a black/protected capture has ~0 luminance spread)
 *   • the dossier API     the real title goes through the real route
 *   • the gesture         the physical mouse is moved across the desktop:
 *                         press on the orb → drag onto Notepad → release
 *   • the theatre         the target card appears, the orb gulps, the question
 *                         goes out and an answer comes back
 *
 *   npm run dev            (one terminal)
 *   npm run orb:debug      (another terminal)
 *   npm run e2e:devour
 *
 * Set JARVIS_E2E_NO_CURSOR=1 to skip the physical mouse (the UI path is then
 * driven through the dev-only drop hook, and the gesture line is reported as a
 * skip rather than a pass).
 */

import { chromium } from "playwright";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = process.env.JARVIS_ORB_DEBUG_PORT || "9228";
const OUT = path.resolve("scratch", "orb-devour");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const skip = (name, why) => {
  results.push({ name, ok: true, skipped: true, detail: why });
  console.log(`SKIP  ${name}  — ${why}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A screenshot is evidence, never a reason to abort the run: capturing a
// transparent always-on-top window mid-flight can stall on some drivers.
async function shot(name) {
  try {
    await page.screenshot({ path: path.join(OUT, name), omitBackground: true, timeout: 8000 });
  } catch (e) {
    console.log(`      (screenshot ${name} unavailable: ${String(e.message).split("\n")[0]})`);
  }
}

// ── PowerShell plumbing ────────────────────────────────────────────────────
function runPs(script) {
  const file = path.join(
    os.tmpdir(),
    `jarvis-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`
  );
  fs.writeFileSync(file, script, "utf8");
  try {
    return execFileSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file],
      { encoding: "utf8", timeout: 25_000 }
    );
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {}
  }
}

const CS_WIN = `using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class WinFind {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  public static string Find(string needle) {
    var list = new List<string>();
    EnumWindows(delegate(IntPtr h, IntPtr p) {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512);
      GetWindowText(h, sb, 512);
      var t = sb.ToString();
      if (t.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) {
        RECT r; GetWindowRect(h, out r);
        list.Add(r.L + "|" + r.T + "|" + r.R + "|" + r.B + "|" + t);
      }
      return true;
    }, IntPtr.Zero);
    return string.Join("\\n", list);
  }
}`;

const CS_CURSOR = `using System;
using System.Runtime.InteropServices;
public class Cur {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out P p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint data, int extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, int extra);
  [StructLayout(LayoutKind.Sequential)] public struct P { public int X; public int Y; }
}`;

const psWin = (body) => `Add-Type -TypeDefinition @'\n${CS_WIN}\n'@\n${body}\n`;
const psCur = (body) => `Add-Type -TypeDefinition @'\n${CS_CURSOR}\n'@\n${body}\n`;

function findWindow(needle) {
  const raw = runPs(
    psWin(`$r = [WinFind]::Find('${needle}')\nif ($r) { Write-Output $r }`)
  ).trim();
  if (!raw) return null;
  const line = raw.split(/\r?\n/)[0].trim();
  const [l, t, r, b, ...rest] = line.split("|");
  const box = { left: +l, top: +t, right: +r, bottom: +b, title: rest.join("|") };
  if (!Number.isFinite(box.left) || box.right <= box.left) return null;
  return box;
}

function cursorPos() {
  const raw = runPs(psCur("$p = New-Object Cur+P\n[Cur]::GetCursorPos([ref]$p) | Out-Null\nWrite-Output \"$($p.X),$($p.Y)\"")).trim();
  const [x, y] = raw.split(",").map(Number);
  return Number.isFinite(x) ? { x, y } : { x: 0, y: 0 };
}

const moveCursor = (x, y) => runPs(psCur(`[Cur]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null`));
const mouseDown = () => runPs(psCur("[Cur]::mouse_event(0x0002, 0, 0, 0, 0)"));
const mouseUp = () => runPs(psCur("[Cur]::mouse_event(0x0004, 0, 0, 0, 0)"));
// Shift at release is the commit gesture — without it a drop only repositions.
const shiftDown = () => runPs(psCur("[Cur]::keybd_event(0x10, 0, 0, 0)"));
const shiftUp = () => runPs(psCur("[Cur]::keybd_event(0x10, 0, 2, 0)"));

// ── Connect to the running orb ─────────────────────────────────────────────
async function connect() {
  const deadline = Date.now() + 40_000;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    } catch (e) {
      lastErr = e.message;
      await sleep(700);
    }
  }
  throw new Error(`could not reach the orb's debug port ${PORT}: ${lastErr}`);
}

const browser = await connect();
// The debug port opens before the window finishes navigating; wait for the orb
// page itself instead of taking whatever is in the list at t=0.
let page = null;
for (let i = 0; i < 80 && !page; i++) {
  const context = browser.contexts()[0];
  page = context?.pages().find((p) => p.url().includes("/orb")) ?? null;
  if (!page) await sleep(500);
}
if (!page) throw new Error("the orb window never loaded its page");

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const text = m.text();
  // The dev server answers favicon requests with 404; that is not the orb.
  if (/fonts\.googleapis\.com/.test(text)) return;
  if (/favicon/i.test(text)) return;
  let where = "";
  try {
    const loc = m.location();
    if (loc?.url) where = ` @ ${loc.url}`;
  } catch {}
  if (/status of 404/.test(text) && /favicon|__nextjs/.test(where)) return;
  // This machine has no microphone; the voice engine complains on every boot.
  if (/VoiceEngine|Audio analysis failed|Requested device not found|not-allowed/i.test(text)) return;
  consoleErrors.push(`${text}${where}`);
});
page.on("pageerror", (e) => consoleErrors.push(String(e?.stack ?? e)));

// Take the freshly-built page, not whatever the window loaded before the edit.
await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
await page.waitForSelector("main.orb-surface", { timeout: 45_000 });
await sleep(1500);

// ── A real window to eat ───────────────────────────────────────────────────
// JARVIS_E2E_TARGET aims the whole run at a window that is already open (a
// maximised terminal, say) instead of spawning Notepad. The point of the flag
// is that a full-screen window is the case people actually drag onto.
const NEEDLE = process.env.JARVIS_E2E_TARGET || "devour-target";
let notepad = null;
if (!process.env.JARVIS_E2E_TARGET) {
  const targetFile = path.join(os.tmpdir(), "devour-target.txt");
  fs.writeFileSync(targetFile, "window devourer e2e\nline two\nline three\n", "utf8");
  notepad = spawn("notepad.exe", [targetFile], { stdio: "ignore" });
}

let target = null;
for (let i = 0; i < 30 && !target; i++) {
  target = findWindow(NEEDLE);
  if (target) break;
  await sleep(500);
}
check(`a real target window exists (${NEEDLE})`, !!target, target ? target.title : "not found");
const restoreCursor = cursorPos();

try {
  if (target) {
    // ── 1. The shell can hit-test real windows ────────────────────────────
    const supported = await page.evaluate(() => window.jarvisOrb?.devourSupported?.() ?? false);
    check("shell reports the devourer available (koffi + user32)", supported === true);

    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const centreDip = {
      x: Math.round((target.left + target.right) / 2 / dpr),
      y: Math.round((target.top + target.bottom) / 2 / dpr),
    };

    const hit = await page.evaluate(
      (p) => window.jarvisOrb?.windowAt?.(p) ?? null,
      centreDip
    );
    check(
      "hit-test finds the window under a real point",
      !!hit && hit.title.toLowerCase().includes(NEEDLE.toLowerCase()),
      JSON.stringify(hit && { title: hit.title, pid: hit.pid })
    );
    check(
      "hit-test reports a plausible rect",
      !!hit && hit.rect.width > 100 && hit.rect.height > 60,
      hit ? `${hit.rect.width}×${hit.rect.height}` : "none"
    );

    // ── 2. Real pixels come back ─────────────────────────────────────────
    const capture = await page.evaluate(
      (t) => window.jarvisOrb?.captureWindow?.(t) ?? null,
      hit?.title ?? target.title
    );
    check("window capture succeeded", !!capture?.ok, capture?.error ?? "");
    check(
      "capture is a PNG data URL",
      typeof capture?.dataUrl === "string" && capture.dataUrl.startsWith("data:image/png;base64,"),
      capture?.dataUrl ? `${capture.dataUrl.length} bytes` : "none"
    );
    // A protected/black capture compresses to a flat rectangle: stddev ≈ 0.
    check(
      "capture holds real pixels (not a black rectangle)",
      (capture?.stddev ?? 0) > 3 && capture?.blank === false,
      `stddev=${capture?.stddev} mean=${capture?.mean}`
    );
    fs.writeFileSync(
      path.join(OUT, "00-captured-window.png"),
      Buffer.from(String(capture?.dataUrl ?? "").split(",")[1] || "", "base64")
    );

    // ── 3. The dossier route, with the real title ─────────────────────────
    const dossier = await page.evaluate(async (title) => {
      const res = await fetch("/api/orb/window-devour", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, hasFrame: true, blank: false }),
      });
      return { status: res.status, body: await res.json() };
    }, target.title);
    check("dossier route answered 200", dossier.status === 200, String(dossier.status));
    check("dossier read the window", dossier.body?.ok === true && !!dossier.body?.app, dossier.body?.app);
    check(
      "dossier produced a ready prompt",
      String(dossier.body?.context ?? "").startsWith("[WINDOW DEVOURED]")
    );
    check(
      "dossier offered three follow-ups",
      Array.isArray(dossier.body?.suggestions) && dossier.body.suggestions.length === 3
    );

    // ── 3b. A plain drop must not swallow ────────────────────────────────
    await page.evaluate((t) => {
      window.__jarvisDevourDrop?.({ moved: true, target: t, commit: false, capture: null });
    }, hit ?? target);
    await sleep(700);
    const idleAfterPlain = await page.evaluate(() => !document.querySelector(".devour-card"));
    check("a plain drop only moves the orb (no swallow)", idleAfterPlain);

    // ── 4. The real gesture: pick the orb up and drop it on Notepad ───────
    const geom = await page.evaluate(() => {
      const orb = document.querySelector("[data-orb-hit]");
      if (!orb) return null;
      const r = orb.getBoundingClientRect();
      return {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        wx: window.screenX,
        wy: window.screenY,
        dpr: window.devicePixelRatio,
      };
    });
    if (!geom) throw new Error("the orb has no hit box");

    // The orb's own window rect from Win32 is authoritative: renderer
    // screenX/screenY is DIP, and mixing that with absolute physical injection
    // breaks on any display that is not at 100%.
    const orbWin = findWindow("JARVIS ORB");
    const orbPoint = orbWin
      ? {
          x: (orbWin.left + orbWin.right) / 2,
          y: orbWin.top + (orbWin.bottom - orbWin.top) * 0.17,
        }
      : { x: (geom.wx + geom.x) * geom.dpr, y: (geom.wy + geom.y) * geom.dpr };
    const targetPoint = {
      x: (target.left + target.right) / 2,
      y: (target.top + target.bottom) / 2,
    };
    console.log(
      `\n      orb window: ${orbWin ? `${orbWin.left},${orbWin.top} ${orbWin.right - orbWin.left}×${orbWin.bottom - orbWin.top}` : "not found"}` +
        `  press at ${Math.round(orbPoint.x)},${Math.round(orbPoint.y)}  dpr ${geom.dpr}`
    );

    let cardSeen = false;
    let dragEngaged = false;

    if (process.env.JARVIS_E2E_NO_CURSOR === "1") {
      skip("physical drag (press → drag → release)", "JARVIS_E2E_NO_CURSOR=1");
    } else {
      moveCursor(orbPoint.x, orbPoint.y);
      await sleep(600); // let the page re-enable hit-testing over the orb

      // Injection check: if the OS refused to move the cursor there is no
      // gesture to test, and saying so beats reporting a phantom failure.
      const landed = cursorPos();
      const cursorMoved =
        Math.abs(landed.x - orbPoint.x) < 4 && Math.abs(landed.y - orbPoint.y) < 4;
      const under = await page.evaluate(() => window.jarvisOrb?.windowAt?.() ?? null);
      console.log(
        `      cursor at ${landed.x},${landed.y}; accepting clicks: ${under === null ? "yes (orb)" : `no — ${under.title}`}`
      );

      const posBefore = await page.evaluate(() => ({ x: window.screenX, y: window.screenY }));
      mouseDown();
      await sleep(260);

      const steps = 5;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        moveCursor(
          orbPoint.x + (targetPoint.x - orbPoint.x) * t,
          orbPoint.y + (targetPoint.y - orbPoint.y) * t
        );
        await sleep(55);
      }
      await sleep(320);

      const posAfter = await page.evaluate(() => ({ x: window.screenX, y: window.screenY }));
      dragEngaged = posBefore.x !== posAfter.x || posBefore.y !== posAfter.y;
      if (!cursorMoved) {
        console.log("      the OS did not move the cursor — gesture result is not meaningful");
      }

      cardSeen = await page
        .waitForSelector(".devour-card", { timeout: 2500 })
        .then(() => true)
        .catch(() => false);
      shiftDown();
      await sleep(90);
      mouseUp();
      await sleep(90);
      shiftUp();
      await sleep(260);
      await shot("01-locked.png");

      const appeared = await page
        .waitForSelector(".devour-card", { timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      check(
        "the drag picked the orb up (window followed the cursor)",
        dragEngaged,
        `${posBefore.x},${posBefore.y} → ${posAfter.x},${posAfter.y}`
      );
      check(
        `the physical drag locked onto ${NEEDLE}`,
        cardSeen || appeared,
        cardSeen ? "preview while dragging" : appeared ? "on release" : "no card"
      );
      cardSeen = cardSeen || appeared;
    }

    if (!cardSeen) {
      // Fallback: drive the same drop handler the shell calls, so the rest of
      // the pipeline is still exercised. Reported, never passed off as a drag.
      console.log("      fallback: injecting the drop the shell would send");
      const hitTarget = hit ?? {
        title: target.title,
        pid: 0,
        hwnd: "e2e",
        rect: { x: 0, y: 0, width: 0, height: 0 },
      };
      await page.evaluate((t) => window.__jarvisDevourDrop?.(t), hitTarget);
      // The shell follows a drop with the real frame; exercise that half too.
      await page.evaluate((t) => window.__jarvisDevourCapture?.(t), hitTarget);
    }

    const events = await page.evaluate(() => window.__jarvisDevourEvents ?? []);
    console.log(
      `      devour-target events: ${events.length ? events.slice(0, 6).join(" → ") : "(none delivered)"}`
    );

    // ── 5. The theatre ────────────────────────────────────────────────────
    const cardNow = await page
      .waitForSelector(".devour-card", { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    check("the target card is on screen", cardNow);

    const phase = await page.evaluate(
      () => document.querySelector(".devour-card")?.getAttribute("data-devour-phase") ?? null
    );
    check("the card is in a devour phase", ["locked", "swallow", "digest"].includes(String(phase)), String(phase));

    // The sphere has to visibly take it in: the intake ring lights up.
    const gulp = await page
      .waitForFunction(
        () => Number(document.querySelector("[data-orb-intake]")?.getAttribute("opacity") ?? 0) > 0.3,
        null,
        { timeout: 6000 }
      )
      .then(() => true)
      .catch(() => false);
    check("the orb's intake ring lights up as it swallows", gulp);
    await shot("02-swallow.png");

    // …and the assistant actually got asked.
    const reacted = await page
      .waitForFunction(
        () => /THINKING|SPEAKING/.test(document.querySelector("[data-orb-state]")?.textContent ?? ""),
        null,
        { timeout: 20_000 }
      )
      .then(() => true)
      .catch(() => false);
    check("swallowing queued a real question (orb leaves standby)", reacted);

    const answered = await page
      .waitForFunction(
        () => {
          const panel = document.querySelector("main.orb-surface .orb-panel");
          const text = (panel?.textContent ?? "").trim();
          return text.length > 40 && !/^JARVIS\s*Clear\s*$/.test(text) && !/THINKING/i.test(text);
        },
        null,
        { timeout: 60_000 }
      )
      .then(() => true)
      .catch(() => false);
    const answerText = await page.evaluate(
      () => (document.querySelector("main.orb-surface .orb-panel")?.textContent ?? "").trim()
    );
    check("an answer streams back about the swallowed window", answered, answerText.slice(0, 140));
    await shot("03-answer.png");

    // The orb should be droppable again afterwards — no stuck overlay.
    const settled = await page
      .waitForFunction(
        () => !document.querySelector(".devour-card"),
        null,
        { timeout: 8000 }
      )
      .then(() => true)
      .catch(() => false);
    check("the devour overlay clears itself", settled);

    check("no console errors in the orb window", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
  }
} finally {
  try {
    moveCursor(restoreCursor.x, restoreCursor.y);
  } catch {}
  try {
    if (notepad) {
      execFileSync("taskkill", ["/PID", String(notepad.pid), "/T", "/F"], { stdio: "ignore" });
    }
  } catch {}
  await browser.close().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
const skipped = results.filter((r) => r.skipped).length;
console.log(
  `\n${results.length - failed.length - skipped}/${results.length - skipped} checks passed` +
    (skipped ? ` (${skipped} skipped)` : "") +
    ` — screenshots in ${OUT}`
);
process.exit(failed.length === 0 ? 0 : 1);
