@echo off
setlocal
set "ROOT=%~dp0"
set "URL=http://127.0.0.1:8001"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

where py >nul 2>nul
if errorlevel 1 (
  start "KrishiMitra Gemini server" cmd /c "cd /d ""%ROOT%"" && python server.py"
) else (
  start "KrishiMitra Gemini server" cmd /c "cd /d ""%ROOT%"" && py -3 server.py"
)

powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(15); $ready=$false; do { Start-Sleep -Milliseconds 300; try { $status=Invoke-RestMethod -Uri 'http://127.0.0.1:8001/api/status' -TimeoutSec 2; $ready=($status.model -ne $null) } catch { $ready=$false } } until ($ready -or (Get-Date) -gt $deadline); if (-not $ready) { exit 1 }"
if errorlevel 1 (
  echo Could not start the Gemini server. Make sure Python 3 is installed and port 8001 is free.
  pause
  exit /b 1
)

if exist "%CHROME%" (
  start "" "%CHROME%" "%URL%"
) else (
  start "" "%URL%"
  echo Chrome was not found. The website was opened in your default browser.
)
