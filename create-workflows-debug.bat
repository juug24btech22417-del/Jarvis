@echo off
echo JARVIS Workflow Setup
echo =====================
echo.
echo Checking system...
echo.

:: Test if we can write to Desktop
echo Testing Desktop access...
echo test > "%USERPROFILE%\Desktop\test-write.txt"
if exist "%USERPROFILE%\Desktop\test-write.txt" (
    echo [OK] Can write to Desktop
    del "%USERPROFILE%\Desktop\test-write.txt"
) else (
    echo [ERROR] Cannot write to Desktop
    pause
    exit /b 1
)

echo.
echo Creating notion-workflow.json...
echo.

:: Create Notion workflow with simpler method
echo { > "%USERPROFILE%\Desktop\notion-workflow.json"
echo   "name": "JARVIS - Save to Notion", >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo   "nodes": [ >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo     { >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo       "parameters": { >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo         "httpMethod": "POST", >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo         "path": "save-to-notion" >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo       }, >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo       "name": "Webhook", >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo       "type": "n8n-nodes-base.webhook", >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo       "typeVersion": 1, >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo       "position": [250, 300] >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo     }, >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo     { >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo       "parameters": {}, >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo       "name": "Notion", >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo       "type": "n8n-nodes-base.notion", >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo       "typeVersion": 2, >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo       "position": [500, 300] >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo     } >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo   ], >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo   "connections": { >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo     "Webhook": { >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo       "main": [[{"node": "Notion", "type": "main", "index": 0}]] >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo     } >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo   } >> "%USERPROFILE%\Desktop\notion-workflow.json"
echo } >> "%USERPROFILE%\Desktop\notion-workflow.json"

if exist "%USERPROFILE%\Desktop\notion-workflow.json" (
    echo [OK] notion-workflow.json created successfully
) else (
    echo [ERROR] Failed to create notion-workflow.json
)

echo.
echo Creating todoist-workflow.json...
echo.

:: Create Todoist workflow
echo { > "%USERPROFILE%\Desktop\todoist-workflow.json"
echo   "name": "JARVIS - Add Todoist Task", >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo   "nodes": [ >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo     { >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo       "parameters": { >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo         "httpMethod": "POST", >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo         "path": "add-todoist-task" >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo       }, >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo       "name": "Webhook", >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo       "type": "n8n-nodes-base.webhook", >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo       "typeVersion": 1, >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo       "position": [250, 300] >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo     }, >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo     { >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo       "parameters": {}, >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo       "name": "Todoist", >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo       "type": "n8n-nodes-base.todoist", >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo       "typeVersion": 1, >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo       "position": [500, 300] >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo     } >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo   ], >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo   "connections": { >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo     "Webhook": { >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo       "main": [[{"node": "Todoist", "type": "main", "index": 0}]] >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo     } >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo   } >> "%USERPROFILE%\Desktop\todoist-workflow.json"
echo } >> "%USERPROFILE%\Desktop\todoist-workflow.json"

if exist "%USERPROFILE%\Desktop\todoist-workflow.json" (
    echo [OK] todoist-workflow.json created successfully
) else (
    echo [ERROR] Failed to create todoist-workflow.json
)

echo.
echo =====================
echo NEXT STEPS:
echo =====================
echo.
echo 1. Open Command Prompt
echo 2. Type: n8n start
echo 3. Open browser: http://localhost:5678
echo 4. Click "Import from File"
echo 5. Select the JSON files from Desktop
echo.
echo Webhook URLs:
echo - Notion: http://localhost:5678/webhook/save-to-notion
echo - Todoist: http://localhost:5678/webhook/add-todoist-task
echo.
pause
