@echo off
chcp 65001 > nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

title Praxis Desktop (Electron) Launcher

echo ========================================================
echo   Praxis Desktop - Electron 데스크톱 앱 실행 중...
echo ========================================================
echo.

set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"

if not exist "backend\.venv\Scripts\python.exe" (
    echo [오류] Python 가상환경이 존재하지 않습니다: backend\.venv
    echo backend 디렉터리에서 가상환경 및 패키지 설치를 먼저 확인해 주세요.
    pause
    exit /b 1
)

echo [1/2] Python 백엔드 서버 시작 중 (포트 8000)...
start "Praxis Backend" /D "%ROOT_DIR%backend" cmd /k "chcp 65001 > nul && set PYTHONUTF8=1 && .venv\Scripts\python.exe run.py"

echo 백엔드 준비 상태 대기 중 (http://127.0.0.1:8000/health)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$w=0; while($w -lt 30){ try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/health' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -eq 200) { Write-Host ' >> 백엔드 준비 완료!'; exit 0 } } catch {}; Start-Sleep -Milliseconds 500; $w++ }; Write-Host ' >> 대기 시간 초과, 계속 진행합니다.'"

echo [2/2] Electron 데스크톱 창 실행 중...
cd /d "%ROOT_DIR%frontend"
call npm.cmd run electron:dev

echo.
pause
