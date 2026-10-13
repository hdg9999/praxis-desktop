@echo off
chcp 65001 > nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

echo ========================================================
echo   Praxis Desktop - Electron 데스크톱 앱 실행 중...
echo ========================================================
echo.

cd /d "%~dp0"

echo [1/2] Python 백엔드 실행 중 (포트 8000)...
start "Praxis Backend" cmd /k "chcp 65001 > nul && set PYTHONUTF8=1 && cd /d backend && .venv\Scripts\python.exe run.py"

echo 백엔드 준비 대기 중 (http://127.0.0.1:8000/health)...
powershell -NoProfile -Command "$w=0; while($w -lt 15){ try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/health' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -eq 200) { Write-Host ' 백엔드 준비 완료!'; exit 0 } } catch {}; Start-Sleep -Milliseconds 500; $w++ }; Write-Host ' 대기 시간 초과, 계속 진행합니다.'"

echo [2/2] Electron 데스크톱 창 실행 중...
cd /d frontend
call npm.cmd run electron:dev

echo.
