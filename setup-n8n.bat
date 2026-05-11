@echo off
chcp 65001 >nul
title JARVIS n8n Setup
color 0A

echo ==========================================
echo    JARVIS n8n Automation Setup
echo ==========================================
echo.

:: Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js not found!
    echo.
    echo Please install Node.js first:
    echo https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi
    echo.
    pause
    exit /b 1
)

echo ✅ Node.js found
echo.

:: Check if n8n is installed
echo Checking n8n installation...
npm list -g n8n >nul 2>&1
if errorlevel 1 (
    echo 🔄 Installing n8n (this may take 2-3 minutes)...
    npm install n8n -g
    if errorlevel 1 (
        echo ❌ Installation failed. Try running as Administrator.
        pause
        exit /b 1
    )
    echo ✅ n8n installed successfully!
) else (
    echo ✅ n8n already installed
)

echo.
echo ==========================================
echo    Creating Workflow Files
echo ==========================================
echo.

:: Create n8n workflows directory
if not exist "%USERPROFILE%\.n8n" mkdir "%USERPROFILE%\.n8n"
if not exist "%USERPROFILE%\.n8n\workflows" mkdir "%USERPROFILE%\.n8n\workflows"

:: Create Notion workflow
echo Creating Notion workflow...
(
echo {
echo   "name": "JARVIS - Save to Notion",
echo   "nodes": [
echo     {
echo       "id": "webhook-node",
echo       "type": "n8n-nodes-base.webhook",
echo       "position": [250, 300],
echo       "parameters": {
echo         "httpMethod": "POST",
echo         "path": "save-to-notion",
echo         "responseMode": "responseNode"
echo       }
echo     },
echo     {
echo       "id": "notion-node",
echo       "type": "n8n-nodes-base.notion",
echo       "position": [500, 300],
echo       "parameters": {
echo         "resource": "databasePage",
echo         "databaseId": "YOUR_DATABASE_ID",
echo         "properties": {
echo           "Name": {
echo             "rich_text": [
echo               {
echo                 "text": {
echo                   "content": "={{ $json.body.title || $json.body.value1 }}"
echo                 }
echo               }
echo             ]
echo           },
echo           "URL": {
echo             "url": "={{ $json.body.url || $json.body.value2 }}"
echo           }
echo         }
echo       }
echo     }
echo   ],
echo   "connections": {
echo     "webhook-node": {
echo       "main": [[{"node": "notion-node", "type": "main", "index": 0}]]
echo     }
echo   },
echo   "settings": {
echo     "executionOrder": "v1"
echo   }
echo }
) > "%USERPROFILE%\.n8n\workflows\notion-workflow.json"

:: Create Todoist workflow
echo Creating Todoist workflow...
(
echo {
echo   "name": "JARVIS - Add Todoist Task",
echo   "nodes": [
echo     {
echo       "id": "webhook-node",
echo       "type": "n8n-nodes-base.webhook",
echo       "position": [250, 300],
echo       "parameters": {
echo         "httpMethod": "POST",
echo         "path": "add-todoist-task",
echo         "responseMode": "responseNode"
echo       }
echo     },
echo     {
echo       "id": "todoist-node",
echo       "type": "n8n-nodes-base.todoist",
echo       "position": [500, 300],
echo       "parameters": {
echo         "resource": "task",
echo         "operation": "create",
echo         "content": "={{ $json.body.task || $json.body.value1 }}",
echo         "dueString": "={{ $json.body.due || $json.body.value2 }}"
echo       }
echo     }
echo   ],
echo   "connections": {
echo     "webhook-node": {
echo       "main": [[{"node": "todoist-node", "type": "main", "index": 0}]]
echo     }
echo   },
echo   "settings": {
echo     "executionOrder": "v1"
echo   }
echo }
) > "%USERPROFILE%\.n8n\workflows\todoist-workflow.json"

echo ✅ Workflow files created!
echo.

:: Create desktop shortcut
echo Creating desktop shortcut...
(
echo Set oWS = WScript.CreateObject^("WScript.Shell"^)
echo sLinkFile = oWS.ExpandEnvironmentStrings^("%USERPROFILE%\Desktop\n8n Server.lnk"^)
echo Set oLink = oWS.CreateShortcut^(sLinkFile^)
echo oLink.TargetPath = "cmd.exe"
echo oLink.Arguments = "/k n8n start"
echo oLink.WorkingDirectory = "%USERPROFILE%"
echo oLink.IconLocation = "%SystemRoot%\System32\shell32.dll,14"
echo oLink.Description = "Start n8n Automation Server"
echo oLink.Save
) > "%TEMP%\CreateShortcut.vbs"

cscript //nologo "%TEMP%\CreateShortcut.vbs" 2>nul
del "%TEMP%\CreateShortcut.vbs" 2>nul

echo ✅ Desktop shortcut created!
echo.

echo ==========================================
echo    Starting n8n Server
echo ==========================================
echo.
echo 🚀 Starting n8n on http://localhost:5678
echo.
echo ⏳ Waiting for server to start...
echo.

:: Create a separate start script
echo @echo off > "%USERPROFILE%\start-n8n.bat"
echo echo Starting n8n Server... >> "%USERPROFILE%\start-n8n.bat"
echo echo Open http://localhost:5678 in your browser >> "%USERPROFILE%\start-n8n.bat"
echo echo. >> "%USERPROFILE%\start-n8n.bat"
echo n8n start >> "%USERPROFILE%\start-n8n.bat"

:: Start n8n in new window
start "n8n Server" cmd /k "echo Starting n8n... && n8n start"

timeout /t 5 /nobreak >nul

echo ✅ n8n is starting!
echo.
echo ==========================================
echo    NEXT STEPS:
echo ==========================================
echo.
echo 1. 🌐 Open: http://localhost:5678
echo    (Browser will open automatically...)
echo.
echo 2. 📋 Setup your first workflow:
echo    - Click "Add Workflow"
echo    - Click "Import from File"
echo    - Select: notion-workflow.json
echo.
echo 3. 🔑 Connect your accounts:
echo    - Notion: Get integration token from notion.so/my-integrations
echo    - Todoist: Get API token from todoist.com/app/settings/integrations
echo.
echo 4. ⚡ Activate the workflow
echo.
echo 📝 Webhook URLs for JARVIS:
echo    Notion: http://localhost:5678/webhook/save-to-notion
echo    Todoist: http://localhost:5678/webhook/add-todoist-task
echo.
echo 💡 To start n8n later: Double-click "n8n Server" on desktop
echo.
echo ==========================================
echo.

:: Open browser
start http://localhost:5678

echo Press any key to close this window...
echo (n8n will keep running in the other window)
pause >nul
