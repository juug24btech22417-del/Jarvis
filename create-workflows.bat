@echo off
echo ==========================================
echo    JARVIS n8n Workflow Setup
echo ==========================================
echo.

:: Create workflow files on Desktop
echo Creating workflow files...

(
echo {
echo   "name": "JARVIS - Save to Notion",
echo   "nodes": [
echo     {
echo       "parameters": {
echo         "httpMethod": "POST",
echo         "path": "save-to-notion"
echo       },
echo       "name": "Webhook",
echo       "type": "n8n-nodes-base.webhook",
echo       "typeVersion": 1,
echo       "position": [250, 300]
echo     },
echo     {
echo       "parameters": {},
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

(
echo {
echo   "name": "JARVIS - Add Todoist Task",
echo   "nodes": [
echo     {
echo       "parameters": {
echo         "httpMethod": "POST",
echo         "path": "add-todoist-task"
echo       },
echo       "name": "Webhook",
echo       "type": "n8n-nodes-base.webhook",
echo       "typeVersion": 1,
echo       "position": [250, 300]
echo     },
echo     {
echo       "parameters": {},
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
echo    INSTRUCTIONS
echo ==========================================
echo.
echo 1. Start n8n manually:
echo    - Open Command Prompt
echo    - Type: n8n start
echo    - Wait for "Editor is now accessible at:"
echo.
echo 2. Open browser to: http://localhost:5678
echo.
echo 3. In n8n, click "Import from File"
echo.
echo 4. Select from Desktop:
echo    - notion-workflow.json
echo    - todoist-workflow.json
echo.
echo 5. Click "Activate" on each workflow
echo.
echo 6. Copy these URLs to .env.local:
echo.
echo    N8N_NOTION_WEBHOOK=http://localhost:5678/webhook/save-to-notion
echo    N8N_TODOIST_WEBHOOK=http://localhost:5678/webhook/add-todoist-task
echo.
echo ==========================================
echo.
pause
