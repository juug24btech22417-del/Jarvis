@echo off
chcp 65001 >nul
title JARVIS n8n Setup
color 0A

echo ==========================================
echo    JARVIS n8n Workflow Setup
echo ==========================================
echo.
echo ✅ n8n already installed - skipping installation
echo.

:: Create n8n workflows directory
if not exist "%USERPROFILE%\.n8n\workflows" mkdir "%USERPROFILE%\.n8n\workflows"

echo ==========================================
echo    Creating Workflow Files
echo ==========================================
echo.

:: Create Notion workflow
echo 📝 Creating Notion workflow (save articles)...
(
echo {
echo   "name": "JARVIS - Save to Notion",
echo   "nodes": [
echo     {
echo       "parameters": {
echo         "httpMethod": "POST",
echo         "path": "save-to-notion",
echo         "responseMode": "responseNode"
echo       },
echo       "id": "webhook-1",
echo       "name": "Webhook",
echo       "type": "n8n-nodes-base.webhook",
echo       "typeVersion": 1,
echo       "position": [250, 300]
echo     },
echo     {
echo       "parameters": {
echo         "content": "={{ $json.body.title || $json.body.value1 || \"New Item\" }}"
echo       },
echo       "id": "notion-1",
echo       "name": "Notion",
echo       "type": "n8n-nodes-base.notion",
echo       "typeVersion": 2,
echo       "position": [500, 300]
echo     }
echo   ],
echo   "connections": {
echo     "Webhook": {
echo       "main": [[{"node": "Notion", "type": "main", "index": 0}]]
echo     }
echo   }
echo }
) > "%USERPROFILE%\Desktop\notion-workflow.json"

echo ✅ Created: notion-workflow.json
echo.

:: Create Todoist workflow
echo 📝 Creating Todoist workflow (add tasks)...
(
echo {
echo   "name": "JARVIS - Add Todoist Task",
echo   "nodes": [
echo     {
echo       "parameters": {
echo         "httpMethod": "POST",
echo         "path": "add-todoist-task",
echo         "responseMode": "responseNode"
echo       },
echo       "id": "webhook-1",
echo       "name": "Webhook",
echo       "type": "n8n-nodes-base.webhook",
echo       "typeVersion": 1,
echo       "position": [250, 300]
echo     },
echo     {
echo       "parameters": {
echo         "content": "={{ $json.body.task || $json.body.value1 }}",
echo         "resource": "task",
echo         "operation": "create"
echo       },
echo       "id": "todoist-1",
echo       "name": "Todoist",
echo       "type": "n8n-nodes-base.todoist",
echo       "typeVersion": 1,
echo       "position": [500, 300]
echo     }
echo   ],
echo   "connections": {
echo     "Webhook": {
echo       "main": [[{"node": "Todoist", "type": "main", "index": 0}]]
echo     }
echo   }
echo }
) > "%USERPROFILE%\Desktop\todoist-workflow.json"

echo ✅ Created: todoist-workflow.json
echo.

echo ==========================================
echo    Starting n8n
echo ==========================================
echo.

:: Start n8n in new window
echo 🚀 Starting n8n server...
start "n8n Server" cmd /k "n8n start"

echo ⏳ Waiting for server...
timeout /t 5 /nobreak >nul

echo ✅ n8n running at: http://localhost:5678
echo.

echo ==========================================
echo    IMPORT WORKFLOWS
echo ==========================================
echo.
echo 1. 🌐 Open http://localhost:5678 (will open now...)
echo.
echo 2. Click "Import from File" button
echo.
echo 3. Select these files from Desktop:
echo    - notion-workflow.json
echo    - todoist-workflow.json
echo.
echo 4. Click "Activate" on each workflow
echo.
echo 5. Copy these URLs to your .env.local:
echo.
echo    N8N_NOTION_WEBHOOK=http://localhost:5678/webhook/save-to-notion
echo    N8N_TODOIST_WEBHOOK=http://localhost:5678/webhook/add-todoist-task
echo.
echo ==========================================
echo.

:: Open browser
start http://localhost:5678

echo Browser opening... Follow the steps above!
echo.
pause
