@echo off
setlocal
cd /d "%~dp0"
if exist "C:\Distr_Local\node-v22.23.4-win-x64\node.exe" set "PATH=C:\Distr_Local\node-v22.23.4-win-x64;%PATH%"
where node.exe >nul 2>nul
if errorlevel 1 goto failed
node scripts\setup-next.cjs %*
if errorlevel 1 goto failed
echo.
echo Setup finished. Run start-next.cmd and open http://127.0.0.1:3003
pause
exit /b 0
:failed
echo Setup stopped. Keep this window open and copy the error above.
pause
exit /b 1
