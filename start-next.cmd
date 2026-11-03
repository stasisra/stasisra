@echo off
setlocal
cd /d "%~dp0"
if exist "C:\Distr_Local\node-v22.23.4-win-x64\node.exe" set "PATH=C:\Distr_Local\node-v22.23.4-win-x64;%PATH%"
if exist ".next-update.lock" goto updating
if not exist ".next-setup-ready" goto setup
node node_modules\next\dist\bin\next start --hostname 127.0.0.1 --port 3003
pause
exit /b
:setup
echo Run setup-next.cmd once before starting this version.
pause
exit /b 1

:updating
echo An update is in progress. Wait for it to finish.
pause
exit /b 1
