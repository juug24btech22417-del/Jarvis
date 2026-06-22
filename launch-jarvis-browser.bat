@echo off
echo [JARVIS] Launching JARVIS-Intercepted Chrome Browser...

:: Try common Chrome installation paths
set CHROME1="C:\Program Files\Google\Chrome\Application\chrome.exe"
set CHROME2="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
set CHROME3="%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

if exist %CHROME1% (
    start "" %CHROME1% --proxy-server="http://localhost:8080" --ignore-certificate-errors --remote-debugging-port=9222 --user-data-dir="%TEMP%\jarvis-chrome-profile"
    echo [JARVIS] Chrome launched with JARVIS proxy on port 8080 and remote debugging on port 9222.
    goto :end
)

if exist %CHROME2% (
    start "" %CHROME2% --proxy-server="http://localhost:8080" --ignore-certificate-errors --remote-debugging-port=9222 --user-data-dir="%TEMP%\jarvis-chrome-profile"
    echo [JARVIS] Chrome launched with JARVIS proxy on port 8080 and remote debugging on port 9222.
    goto :end
)

if exist %CHROME3% (
    start "" %CHROME3% --proxy-server="http://localhost:8080" --ignore-certificate-errors --remote-debugging-port=9222 --user-data-dir="%TEMP%\jarvis-chrome-profile"
    echo [JARVIS] Chrome launched with JARVIS proxy on port 8080 and remote debugging on port 9222.
    goto :end
)

echo [ERROR] Chrome not found! Please install Chrome or edit this file with your Chrome path.
pause

:end
