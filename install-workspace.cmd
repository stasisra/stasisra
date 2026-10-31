@echo off
setlocal
cd /d "%~dp0"
if exist "..\node-v22.23.4-win-x64\node.exe" set "PATH=%~dp0..\node-v22.23.4-win-x64;%PATH%"
where node.exe >nul 2>nul
if errorlevel 1 goto no_node
node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>=22 && a<=24 && (a!==22 || b>=12)?0:1)"
if errorlevel 1 goto no_node
echo Installing Task and Gantt Workspace in a separate folder...
call npm.cmd ci --ignore-scripts
if errorlevel 1 goto failed
call npm.cmd rebuild better-sqlite3
if errorlevel 1 goto failed
call npm.cmd run prisma:generate
if errorlevel 1 goto failed
node scripts\setup-workspace.cjs
if errorlevel 1 goto failed
call npm.cmd run db:init
if errorlevel 1 goto failed
call npm.cmd run db:upgrade
if errorlevel 1 goto failed
call npm.cmd run build
if errorlevel 1 goto failed
echo.
echo Installation complete. Run start-workspace.cmd and open http://127.0.0.1:3002
echo Sign in with your existing administrator email and password.
echo The old app and database in task-gantt-app-fixed have not been replaced.
pause
exit /b 0
:no_node
echo Node.js 22.12+ or 24 is required. Keep node-v22.23.4-win-x64 beside this folder.
pause
exit /b 1
:failed
echo.
echo Installation stopped. Keep this window open and copy the error above.
echo Do not run npm audit fix --force.
pause
exit /b 1
