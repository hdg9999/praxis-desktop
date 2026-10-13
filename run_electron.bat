@echo off
set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"

if exist "frontend\node_modules\electron\dist\electron.exe" (
    start "" "%ROOT_DIR%frontend\node_modules\electron\dist\electron.exe" "%ROOT_DIR%frontend\electron\main.cjs"
) else (
    cd /d "%ROOT_DIR%frontend"
    start "" npx.cmd electron electron/main.cjs
)
exit
