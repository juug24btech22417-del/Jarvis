# Desktop Automation Redesign — PROPOSAL (not implemented)

**Date:** 2026-09-13
**Status:** 🟡 AWAITING USER REVIEW — do not implement until approved.

---

## The Problem (why the current design is broken)

Current flow: take a screenshot → user clicks on the image to grab
**absolute screen coordinates** → replay moves the mouse to those pixels.

Three fatal flaws:

1. **Coordinates are absolute pixels.** Move the Spotify window, change
   resolution, or use a second monitor → macro breaks. If the app isn't
   visible in the screenshot at record time, you literally cannot pick
   coordinates at all (the Spotify problem you hit).
2. **It records nothing real.** It's a coordinate list, not a recording.
   Buttons move when windows resize, playlists load, ads appear.
3. **It's manual.** "Click on the screenshot, then type x,y" is the
   dumbest possible UX — you're right about that.

---

## The Fix: capture **semantic targets**, not pixels

Instead of "click at (743, 512)", store *"click the button whose name is
'Play'"*. At replay time, ask the OS where that button is **right now**,
then click it. Windows move → we re-resolve coordinates every replay.

### How we read the UI (two layers, pick per situation)

**Layer 1 — UI Automation (UIA) / accessibility tree.** Every modern
Windows app (Spotify, Chrome, Office, even WPF/WinUI apps) exposes a
tree of elements — button names, roles, values. We can query it from
PowerShell via .NET `System.Windows.Automation` — **zero new
dependencies**. This is how screen readers work; it's robust.

**Layer 2 — Live-window screenshot + anchor matching.** Fallback for
apps with poor accessibility (games, Electron canvases): screenshot
*just that window* at record time, store the small crop around the
click point as an "anchor image". At replay, re-screenshot the window
and search for the anchor (OpenCV template match or a perceptual
hash). Coordinates become **relative to the matched anchor**, not the
screen — so they survive window moves and resizes.

---

## New Recording UX (what you'd actually do)

```
┌──────────────────────────────────────────────────────────────┐
│  1. Pick the app                                              │
│     [ Detect focused window ]  →  "Spotify"                  │
│     or choose from a live list of open windows               │
│                                                               │
│  2. Interact normally — JARVIS listens in the background     │
│     Every click/keypress is captured with the TARGET NAME    │
│     from the accessibility tree:                             │
│                                                               │
│       ✓ Click  [Spotify] button "Play"                       │
│       ✓ Type   into [Spotify] edit "Search" → "barsaat"      │
│       ✓ Key    Enter                                         │
│                                                               │
│     (No screenshots. No coordinates. You just use the app.)  │
│                                                               │
│  3. Stop & Save                                              │
└──────────────────────────────────────────────────────────────┘
```

Key changes:
- **Global input hook** (node-native `node-global-key-listener` /
  `iohook`, or a tiny C# helper) records what you do in real time —
  no more building steps one by one in the panel.
- Each event resolves to a **UIA element**: name, role, and a
  discovery chain (e.g. `Window "Spotify" → Pane "Now Playing" →
  Button "Play"`).
- Steps store the **chain**, not coordinates.

## New Replay Logic

```
for each step:
  1. focusWindow(step.process)            // by process/window name
  2. findElement(step.uiaChain)           // walk the CURRENT tree
     ├─ found → get its ScreenRect → click/type on it
     └─ not found → try fuzzy match (name contains, role match)
                 → try anchor-image fallback
                 → else log the step as failed, continue
  3. verify (did typing land? did the view change?) — same
     verification philosophy as the browser fix you just got.
```

Same macro, window anywhere on any monitor: still works.

---

## What the panel UI becomes

- **App list** (live) instead of a static screenshot.
- **Step chips** show human-readable targets:
  `Click "Play" (Spotify)` — not `(250, 300)`.
- **Edit a step** = re-pick an element from the tree, not re-type coords.
- Optional **"Show me where"** button highlights the element on screen.

## Migration & risk

- Old pixel macros still replay (as-is, still brittle) — nothing breaks.
- UIA quirks: some apps expose weird names; that's what the fuzzy
  matcher + anchor fallback covers.
- New deps: **none required** for Layer 1 (PowerShell/.NET built in).
  Layer 2 needs `sharp`/`opencv4nodejs` OR we do template matching via
  a small PowerShell + System.Drawing routine (slower but zero deps).

## Alternatives considered

| Option | Verdict |
|---|---|
| Window-relative coords (partial, already in code) | Band-aid — breaks when the app's layout changes, not just its position |
| Full computer-vision agent (screenshots + LLM) | Overkill, slow, non-deterministic for fixed macros |
| pywinauto / WinAppDriver | External runtimes to install; UIA-from-PowerShell gets 90% with none |
| Keep screenshot clicking | You already judged it: the dumbest method ever. Agreed. |

---

**Recommendation:** Layer 1 (UIA) as the core, Layer 2 (anchor
images) as fallback, real-time global hook recording, semantic step
chips in the panel. Say the word and I'll implement it.
