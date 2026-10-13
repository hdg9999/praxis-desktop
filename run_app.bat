@echo off
chcp 65001 > nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

echo ========================================================
echo   Praxis Desktop - Agentic RPA Studio 실행 중...
echo ========================================================
echo.

cd /d "%~dp0"

echo [1/3] Python 백엔드 실행 중 (포트 8000)...
start "Praxis Backend" cmd /k "chcp 65001 > nul && set PYTHONUTF8=1 && cd /d backend && .venv\Scripts\python.exe run.py"

echo [2/3] 백엔드 준비 대기 중 (http://127.0.0.1:8000/health)...
powershell -NoProfile -Command "$w=0; while($w -lt 15){ try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/health' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -eq 200) { Write-Host ' 백엔드 준비 완료!'; exit 0 } } catch {}; Start-Sleep -Milliseconds 500; $w++ }; Write-Host ' 대기 시간 초과, 계속 진행합니다.'"

echo [3/3] 프론트엔드 서버 실행 중 (포트 5173)...
start "Praxis Frontend" cmd /k "chcp 65001 > nul && cd /d frontend && npm.cmd run dev"

timeout /t 3 /nobreak > nul

echo 브라우저에서 대시보드를 엽니다...
start http://localhost:5173

echo.
echo ========================================================
echo   Praxis Desktop 구동 완료!
echo   - 웹 대시보드: http://localhost:5173
echo   - 백엔드 API: http://localhost:8000/docs
echo   - 비상 정지 핫키: F12
echo ========================================================
echo.
