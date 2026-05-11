@echo off
cd /d "C:\Users\dhruv\Desktop\Jarvis"

echo ==========================================
echo    J.A.R.V.I.S. + WhatsApp Server
echo ==========================================
echo.

:: Check if node_modules exists in root
echo Checking WhatsApp server dependencies...
if not exist "node_modules\express" (
    echo Installing root dependencies...
    call npm install express cors whatsapp-web.js qrcode --legacy-peer-deps
)

:: Check if node_modules exists in jarvis
echo Checking JARVIS dependencies...
if not exist "jarvis\node_modules" (
    echo Installing JARVIS dependencies...
    cd jarvis
    call npm install
    cd ..
)

echo.
echo Starting WhatsApp Server on port 3001...
start "WhatsApp Server" cmd /k "cd /d C:\Users\dhruv\Desktop\Jarvis && node whatsapp-server.js"

echo Waiting for WhatsApp server to start...
timeout /t 5 /nobreak >nul

echo Starting JARVIS on port 3000...
cd jarvis
start "" cmd /c "timeout /t 5 >nul && start chrome http://localhost:3000"

npm run dev
