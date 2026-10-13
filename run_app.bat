@echo off
chcp 65001 > nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

title Praxis Desktop Launcher

echo ========================================================
echo   Praxis Desktop - Agentic RPA Studio 실행 중...
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

echo [1/3] Python 백엔드 서버 시작 중 (포트 8000)...
start "Praxis Backend" /D "%ROOT_DIR%backend" cmd /k "chcp 65001 > nul && set PYTHONUTF8=1 && .venv\Scripts\python.exe run.py"

echo [2/3] 백엔드 준비 상태 대기 중 (http://127.0.0.1:8000/health)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$w=0; while($w -lt 30){ try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/health' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -eq 200) { Write-Host ' >> 백엔드 준비 완료!'; exit 0 } } catch {}; Start-Sleep -Milliseconds 500; $w++ }; Write-Host ' >> 대기 시간 초과, 계속 진행합니다.'"

echo [3/3] 프론트엔드 Vite 개발 서버 시작 중 (포트 5173)...
start "Praxis Frontend" /D "%ROOT_DIR%frontend" cmd /k "chcp 65001 > nul && npm.cmd run dev"

timeout /t 3 /nobreak > nul

echo 웹 대시보드를 브라우저에서 엽니다...
start http://localhost:5173

echo.
echo ========================================================
echo   Praxis Desktop 구동 완료!
echo   - 웹 대시보드: http://localhost:5173
echo   - 백엔드 API: http://localhost:8000/docs
echo   - 비상 정지 핫키: F12
echo ========================================================
echo.
echo 이 창을 닫아도 백엔드 및 프론트엔드는 백그라운드 콘솔에서 계속 실행됩니다.
pause
