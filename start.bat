@echo off
cd /d "%~dp0"
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /R /C:":5000 .*LISTENING"') do taskkill /F /T /PID %%P >nul 2>&1
start "Weekly Planner Manager" /min cmd /c "python "%~dp0app.py""
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:5000/"
