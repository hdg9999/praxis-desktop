@echo off
chcp 65001 > nul
set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"

set "NEED_SETUP=0"

if not exist "backend\.venv\Scripts\python.exe" set "NEED_SETUP=1"
if not exist "frontend\node_modules" set "NEED_SETUP=1"
if not exist "frontend\dist\index.html" set "NEED_SETUP=1"

if "%NEED_SETUP%"=="1" (
    title Praxis Desktop - 최초 실행 환경 구성 중...
    echo ========================================================
    echo   Praxis Desktop - 최초 실행 환경 자동 구성 중...
    echo   (필요한 라이브러리 및 패키지를 자동으로 준비합니다)
    echo ========================================================
    echo.

    if not exist "backend\.venv\Scripts\python.exe" (
        echo [1/3] Python 가상환경 생성 및 백엔드 패키지 설치 중...
        python -m venv "backend\.venv"
        "backend\.venv\Scripts\python.exe" -m pip install -q --upgrade pip
        "backend\.venv\Scripts\python.exe" -m pip install -q -r "backend\requirements.txt"
        echo  ^>^> 백엔드 가상환경 준비 완료.
    )

    if not exist "frontend\node_modules" (
        echo [2/3] 프론트엔드 모듈 설치 중 (npm install)...
        cd /d "%ROOT_DIR%frontend"
        call npm.cmd install
        cd /d "%ROOT_DIR%"
        echo  ^>^> 프론트엔드 모듈 설치 완료.
    )

    if not exist "frontend\dist\index.html" (
        echo [3/3] 프론트엔드 번들 빌드 중 (npm run build)...
        cd /d "%ROOT_DIR%frontend"
        call npm.cmd run build
        cd /d "%ROOT_DIR%"
        echo  ^>^> 프론트엔드 빌드 완료.
    )

    echo.
    echo ========================================================
    echo   초기 환경 구성이 완료되었습니다! Praxis Desktop을 시작합니다.
    echo ========================================================
    timeout /t 2 > nul
)

start "" "%ROOT_DIR%frontend\node_modules\electron\dist\electron.exe" "%ROOT_DIR%frontend\electron\main.cjs"
exit
