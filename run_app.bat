@echo off
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

title Praxis Desktop Launcher (Web Browser Mode)

set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"

if exist "%ROOT_DIR%backend\.venv\Scripts\python.exe" goto CHECK_FE
if exist "%ROOT_DIR%backend\venv\Scripts\python.exe" goto CHECK_FE
goto SETUP_BE

:CHECK_FE
if exist "%ROOT_DIR%frontend\node_modules" goto LAUNCH_APP
goto SETUP_FE

:SETUP_BE
echo ========================================================
echo   Praxis Desktop - Configuring Backend Environment...
echo ========================================================
python -m venv "%ROOT_DIR%backend\.venv"
"%ROOT_DIR%backend\.venv\Scripts\python.exe" -m pip install -q --upgrade pip
"%ROOT_DIR%backend\.venv\Scripts\python.exe" -m pip install -q -r "%ROOT_DIR%backend\requirements.txt"
echo [OK] Backend environment ready.
goto CHECK_FE

:SETUP_FE
echo ========================================================
echo   Praxis Desktop - Installing Frontend Dependencies...
echo ========================================================
cd /d "%ROOT_DIR%frontend"
call npm.cmd install
cd /d "%ROOT_DIR%"
echo [OK] Frontend packages installed.
goto LAUNCH_APP

:LAUNCH_APP
set "PY_EXE=%ROOT_DIR%backend\.venv\Scripts\python.exe"
if not exist "%PY_EXE%" set "PY_EXE=%ROOT_DIR%backend\venv\Scripts\python.exe"

echo ========================================================
echo   Praxis Desktop - Agentic RPA Studio (Web Mode)
echo ========================================================
echo.

echo [1/3] Starting Python Backend Server (Port 8000)...
start "Praxis Backend" /D "%ROOT_DIR%backend" cmd /k ""%PY_EXE%" run.py"

echo [2/3] Waiting for Backend Server (http://127.0.0.1:8000/health)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$w=0; while($w -lt 30){ try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/health' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -eq 200) { Write-Host ' [OK] Backend is ready!'; exit 0 } } catch {}; Start-Sleep -Milliseconds 500; $w++ }; Write-Host ' [!] Timeout, continuing...'"

echo [3/3] Starting Frontend Vite Server (Port 5173)...
start "Praxis Frontend" /D "%ROOT_DIR%frontend" cmd /k "npm.cmd run dev"

ping 127.0.0.1 -n 3 > nul

echo Opening Web Dashboard in default browser...
start http://localhost:5173

echo.
echo ========================================================
echo   Praxis Desktop is running!
echo   - Web UI: http://localhost:5173
echo   - Backend Docs: http://localhost:8000/docs
echo   - Emergency Stop Hotkey: F12
echo ========================================================
echo.
pause