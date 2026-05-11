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

npm run dev

pause
