# jarvis/ — the application

This is the Next.js workspace. For the full picture — what JARVIS does, the architecture, how to install and configure it — read the [root README](../README.md). This file is the developer's shortcut.

## Run it

```bash
npm install
cp ../.env.example .env.local     # then fill it in
npx prisma db push
npm run dev                       # http://localhost:3000
```

## Layout

```text
src/app          pages + api/*/route.ts (160 handlers)
src/components   hud · panels · reactor · cinematic · overlay · widgets · mcp
src/hooks        voice · gaze · hand · gesture · sentinel · presence
src/lib          agent · overlay · memory · composio · os · security · mcp · persona
src/services     research · browser · macro · meeting · scheduler · llm chain
src/store        Zustand client state
scripts          PowerShell shells, C# overlay types, live end-to-end checks
overlay          Electron stealth shell (main.js, preload.js)
prisma           schema + migrations + dev.db
docs             test playbooks and design notes
tests            the suites npm test runs
```

## Check your work

```bash
npm test                  # 21 unit suites
npm run smoke:cards       # card UI — 67 checks
npm run smoke:circle      # the real gesture — 10 checks (close any watcher first)
npm run e2e:circle        # live vision + Serper — 18 checks
npm run e2e:circle:act    # live agent + a real email — 14 checks
```

## Working on the desktop features

The PowerShell watcher and the C# overlay are not a separate service — they are the part of the app that happens to run outside the browser.

- `scripts/clipboard-watcher.ps1` — clipboard + circle runtime. Loads `scripts/circle-overlay.cs` for its window types. **Keep screen capture out of this file:** capture plus encoding plus clipboard watching in one PowerShell script is what Windows Defender's AMSI scanner blocks, which takes the whole feature down. Capture belongs in `/api/circle/frame`.
- `scripts/circle-overlay.cs` — the overlay's window types (`JarvisCircleOverlay`, `JarvisAskBox`, `JarvisTranslatedPanel`, `JarvisHotkeyWindow`, `JarvisDpi`). One `Add-Type` compilation unit.
- `overlay/` — the Electron shell, which exists because `SetWindowDisplayAffinity` only works on a window your own process owns.

Only one process can own a global hotkey. If `Ctrl+Alt+S` does nothing, another watcher already has it.

## Adding a capability the agent can use

1. Add the tool to `src/lib/agent/toolRunner.ts` — a spec line plus a `case` that performs the real work.
2. That is the whole list. Circle to Act and the task agent both read the same toolset, so a new tool is immediately reachable from a circle and from a task, with no intent list to update.

Return the tool's real output. If it cannot be done, say so in the output string — the agent passes that through to the user verbatim, and a truthful failure is worth more than a confident guess.
