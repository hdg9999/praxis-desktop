@echo off
set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"

if exist "%ROOT_DIR%backend\.venv\Scripts\python.exe" goto CHECK_FE
if exist "%ROOT_DIR%backend\venv\Scripts\python.exe" goto CHECK_FE
goto SETUP_BE

:CHECK_FE
if exist "%ROOT_DIR%frontend\node_modules\electron\dist\electron.exe" goto CHECK_BUILD
if exist "%ROOT_DIR%frontend\node_modules" goto INSTALL_ELECTRON
goto SETUP_FE

:SETUP_BE
title Praxis Desktop - Configuring Backend Environment
echo ========================================================
echo   Praxis Desktop - Configuring Backend Environment...
echo ========================================================
python -m venv "%ROOT_DIR%backend\.venv"
"%ROOT_DIR%backend\.venv\Scripts\python.exe" -m pip install -q --upgrade pip
"%ROOT_DIR%backend\.venv\Scripts\python.exe" -m pip install -q -r "%ROOT_DIR%backend\requirements.txt"
echo [OK] Backend environment ready.
goto CHECK_FE

:SETUP_FE
title Praxis Desktop - Installing Frontend Dependencies
echo ========================================================
echo   Praxis Desktop - Installing Packages (npm install)...
echo ========================================================
cd /d "%ROOT_DIR%frontend"
call npm.cmd install
cd /d "%ROOT_DIR%"
echo [OK] Frontend packages installed.

:INSTALL_ELECTRON
if exist "%ROOT_DIR%frontend\node_modules\electron\dist\electron.exe" goto CHECK_BUILD
title Praxis Desktop - Downloading Electron Binary
echo ========================================================
echo   Praxis Desktop - Downloading Electron Binary...
echo ========================================================
cd /d "%ROOT_DIR%frontend"
call node.exe "node_modules\electron\install.js"
cd /d "%ROOT_DIR%"
if exist "%ROOT_DIR%frontend\node_modules\electron\dist\electron.exe" goto CHECK_BUILD
cd /d "%ROOT_DIR%frontend"
call npx.cmd electron --version
cd /d "%ROOT_DIR%"
goto CHECK_BUILD

:CHECK_BUILD
if exist "%ROOT_DIR%frontend\dist\index.html" goto LAUNCH_APP
goto SETUP_BUILD

:SETUP_BUILD
title Praxis Desktop - Building Frontend Bundle
echo ========================================================
echo   Praxis Desktop - Building Distribution Bundle...
echo ========================================================
cd /d "%ROOT_DIR%frontend"
call npm.cmd run build
cd /d "%ROOT_DIR%"
echo [OK] Frontend bundle built successfully.
ping 127.0.0.1 -n 2 > nul
goto LAUNCH_APP

:LAUNCH_APP
if exist "%ROOT_DIR%frontend\node_modules\electron\dist\electron.exe" goto LAUNCH_DIRECT
cd /d "%ROOT_DIR%frontend"
start "Praxis Desktop" npx.cmd electron electron/main.cjs
exit

:LAUNCH_DIRECT
start "Praxis Desktop" /D "%ROOT_DIR%frontend" "%ROOT_DIR%frontend\node_modules\electron\dist\electron.exe" "%ROOT_DIR%frontend\electron\main.cjs"
exit