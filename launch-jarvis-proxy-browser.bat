@echo off
echo [JARVIS] Launching the INTERCEPTED browser (JARVIS pill on every site)...
echo.
echo   This browser routes ALL traffic through the JARVIS proxy on port 8080.
echo   That is the point: the proxy injects the JARVIS pill into every page.
echo.
echo   Because of that, it only has internet WHILE JARVIS IS RUNNING.
echo   If JARVIS stops, every tab will say "no internet connection".
echo   Start JARVIS first, and use launch-jarvis-browser.bat for normal
echo   browsing and for Shorts / Reels scrolling.
echo.

:: Try common Chrome installation paths
set CHROME1="C:\Program Files\Google\Chrome\Application\chrome.exe"
set CHROME2="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
set CHROME3="%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

set FLAGS=--proxy-server="http://localhost:8080" --ignore-certificate-errors --remote-debugging-port=9222 --user-data-dir="%TEMP%\jarvis-chrome-proxy-profile" --no-first-run --no-default-browser-check

if exist %CHROME1% (
    start "" %CHROME1% %FLAGS%
    echo [JARVIS] Intercepted Chrome launched. Proxy on 8080, debugging on 9222.
    goto :end
)

if exist %CHROME2% (
    start "" %CHROME2% %FLAGS%
    echo [JARVIS] Intercepted Chrome launched. Proxy on 8080, debugging on 9222.
    goto :end
)

if exist %CHROME3% (
    start "" %CHROME3% %FLAGS%
    echo [JARVIS] Intercepted Chrome launched. Proxy on 8080, debugging on 9222.
    goto :end
)

echo [ERROR] Chrome not found! Please install Chrome or edit this file with your Chrome path.
pause

:end
