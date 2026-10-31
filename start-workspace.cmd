@echo off
setlocal
cd /d "%~dp0"
if exist "..\node-v22.23.4-win-x64\node.exe" set "PATH=%~dp0..\node-v22.23.4-win-x64;%PATH%"
where node.exe >nul 2>nul
if errorlevel 1 goto no_node
node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>=22 && a<=24 && (a!==22 || b>=12)?0:1)"
if errorlevel 1 goto no_node
if not exist ".env" goto not_installed
if not exist "prisma\dev.db" goto not_installed
if not exist ".next\BUILD_ID" goto not_installed
echo Open http://127.0.0.1:3002 and keep this window open.
echo Press Ctrl+C in THIS window to stop only this copy.
call npm.cmd start -- --hostname 127.0.0.1 --port 3002
pause
exit /b
:no_node
echo Node.js 22.12+ or 24 is required.
pause
exit /b 1
:not_installed
echo Run install-workspace.cmd first.
pause
exit /b 1
