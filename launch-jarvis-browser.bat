@echo off
echo [JARVIS] Launching the JARVIS-controlled Chrome Browser...
echo.
echo   This browser has NORMAL internet access and is NOT routed through the
echo   JARVIS proxy. That matters: every tab in a proxied browser shows
echo   "no internet connection" whenever JARVIS (and so the proxy on port 8080)
echo   is not running, and all traffic takes a slow MITM detour.
echo.
echo   Remote debugging stays on port 9222, so JARVIS can still drive it
echo   (Shorts / Reels scrolling, missions) and your logins are remembered.
echo.
echo   Want the in-page JARVIS pill on every site instead?
echo   Run launch-jarvis-proxy-browser.bat (that one DOES use the proxy).
echo.

:: Try common Chrome installation paths
set CHROME1="C:\Program Files\Google\Chrome\Application\chrome.exe"
set CHROME2="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
set CHROME3="%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

set FLAGS=--no-proxy-server --remote-debugging-port=9222 --user-data-dir="%TEMP%\jarvis-chrome-profile" --no-first-run --no-default-browser-check --disable-blink-features=AutomationControlled

if exist %CHROME1% (
    start "" %CHROME1% %FLAGS%
    echo [JARVIS] Chrome launched. Remote debugging on 9222, normal internet.
    goto :end
)

if exist %CHROME2% (
    start "" %CHROME2% %FLAGS%
    echo [JARVIS] Chrome launched. Remote debugging on 9222, normal internet.
    goto :end
)

if exist %CHROME3% (
    start "" %CHROME3% %FLAGS%
    echo [JARVIS] Chrome launched. Remote debugging on 9222, normal internet.
    goto :end
)

echo [ERROR] Chrome not found! Please install Chrome or edit this file with your Chrome path.
pause

:end
