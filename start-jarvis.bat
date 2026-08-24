@echo off
cls
echo ==========================================
echo    J.A.R.V.I.S. Quick Start
echo ==========================================
echo.

cd /d "%~dp0\jarvis"

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo Failed to install dependencies
        pause
        exit /b 1
    )
)

echo Stopping any existing servers...
taskkill /F /IM node.exe 2>nul
taskkill /F /IM chrome.exe 2>nul
timeout /t 2 >nul

echo Starting JARVIS server...
echo.
echo This will open Chrome automatically.
echo.
echo Commands:
echo   - Say "Hey JARVIS" to wake
echo   - Click reactor to toggle sleep/wake
echo   - Enable camera for gesture control
echo.
echo Press Ctrl+C to stop the server
echo.

start /b cmd /c "timeout /t 8 >nul && start chrome http://localhost:3000"

REM ── Composio trigger listener (sibling process). ────────────────────
REM Runs scripts/composio-listener.ts via tsx (Next.js ships with it as
REM a dev dep). Opens in a new window so logs are visible separately
REM from the next dev server. Set COMPOSIO_API_KEY in jarvis/.env.local
REM before starting. If the key is missing, the listener prints an
REM error and exits; the test-fire route still works without it.
start "JARVIS-Composio" cmd /k "title JARVIS-Composio-Listener && echo. && echo ========================================== && echo   JARVIS \x96 Composio Trigger Listener && echo ========================================== && echo. && npx --yes tsx scripts/composio-listener.ts"

npm run dev

pause
