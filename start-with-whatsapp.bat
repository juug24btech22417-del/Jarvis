@echo off
cls
echo ==========================================
echo    J.A.R.V.I.S. with WhatsApp Server
echo ==========================================
echo.

cd /d "%~dp0"

if not exist "jarvis\node_modules" (
    echo Installing JARVIS dependencies...
    cd jarvis
    call npm install
    cd ..
)

if not exist "node_modules" (
    echo Installing server dependencies...
    call npm install express cors whatsapp-web.js qrcode
)

echo Starting WhatsApp Server...
echo This will maintain the WhatsApp connection
echo.

start "WhatsApp Server" cmd /k "node whatsapp-server.js"

timeout /t 5 >nul

echo Starting JARVIS...
echo.

cd jarvis
start /b cmd /c "timeout /t 5 >nul && start chrome http://localhost:3000"

npm run dev

pause
