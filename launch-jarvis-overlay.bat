@echo off
setlocal
title JARVIS STEALTH OVERLAY

echo [JARVIS] Launching the STEALTH OVERLAY...
echo.
echo   Opens the JARVIS overlay as its own frameless, always-on-top, translucent
echo   window that is INVISIBLE TO SCREEN SHARE: it stays fully visible to you,
echo   but is absent from Zoom, Meet, Teams, OBS and Chrome's own share picker.
echo.
echo   How it works: Windows only applies the capture exemption
echo   (SetWindowDisplayAffinity / WDA_EXCLUDEFROMCAPTURE) from the process that
echo   OWNS the window, so the overlay is its own app (Electron), not a browser
echo   tab. Requires Windows 10 v2004 (build 19041) or newer -- on older builds
echo   the badge in the HUD header turns red and says so.
echo.
echo   In the HUD:  slider = window translucency
echo                Ctrl+Shift+H = hide / show the HUD
echo                LISTEN = follow the call (system audio, else mic)
echo                type + Enter = ask directly
echo.

cd /d "%~dp0jarvis"
if errorlevel 1 (
    echo [ERROR] Could not enter the jarvis folder next to this file.
    goto end
)

REM ── Electron ────────────────────────────────────────────────────────────────
REM The binary lives in node_modules\electron\dist\electron.exe, and checking
REM that file is the whole point: a download that dies mid-EXTRACT leaves the
REM folder in place, so npm reports "up to date" forever while electron.exe is
REM missing. install-electron.mjs treats that as broken, reuses the zip already
REM in Electron's cache, and unpacks it with a native extractor -- electron's
REM own installer hangs on Node 24 partway through.
if not exist "node_modules\electron\package.json" (
    echo [JARVIS] Installing the Electron package - first run...
    call npm install --save-dev electron@^33 --legacy-peer-deps --no-audit --no-fund
)

if not exist "node_modules\electron\dist\electron.exe" (
    echo.
    echo [JARVIS] Electron is missing or half-installed. Repairing it now...
    call node scripts\install-electron.mjs
    if errorlevel 1 goto noelectron
)

REM ── Jarvis server ───────────────────────────────────────────────────────────
REM The HUD needs the server for transcription and answers. Start it in its own
REM window so it is a real process the user can watch, and wait for it to answer
REM before opening the overlay -- a window that appears to do nothing is worse
REM than a launcher that waits.
curl -s -o NUL --max-time 4 http://localhost:3000/stealth
if not errorlevel 1 goto serverup

echo.
echo [JARVIS] The Jarvis server is not running. Starting it in a new window...
start "JARVIS SERVER" cmd /k "npm run dev"

set /a WAITED=0
:waitloop
REM ping, not timeout: timeout refuses to run when input is redirected.
ping -n 3 127.0.0.1 > NUL
curl -s -o NUL --max-time 4 http://localhost:3000/stealth
if not errorlevel 1 goto serverup
set /a WAITED+=2
if %WAITED% LSS 90 goto waitloop

echo.
echo [NOTE] The server is still starting after %WAITED%s. Opening the overlay
echo        anyway -- it shows a "server offline" panel and loads the HUD by
echo        itself the moment the server answers.
goto run

:serverup
echo.
echo [JARVIS] Server is up on port 3000.

REM ── Run ─────────────────────────────────────────────────────────────────────
:run
call npx electron overlay/main.js
if errorlevel 1 goto overlayerror

echo.
echo [JARVIS] Overlay closed.
goto end

:noelectron
echo.
echo [ERROR] Could not install the Electron binary, so the capture-exempt
echo         overlay cannot start.
echo.
echo   Fix it by running this once, with a mirror that works when GitHub is slow:
echo.
echo       cd jarvis
echo       set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
echo       node scripts\install-electron.mjs
echo.
echo   Meanwhile the HUD still works as a normal browser page -- no capture
echo   exemption, so anything shared on screen WILL include it:
echo.
echo       http://localhost:3000/stealth
echo.
start "" http://localhost:3000/stealth
goto end

:overlayerror
echo.
echo [ERROR] The overlay window exited with an error. See the lines above.
echo.
echo   Most common causes:
echo     - Electron is half-installed: re-run this file, it repairs it.
echo     - The Jarvis server is down:  cd jarvis ^&^& npm run dev
echo.
echo   To diagnose the binary without opening a window:
echo       cd jarvis ^&^& node scripts\install-electron.mjs --check
echo.

:end
echo.
pause
