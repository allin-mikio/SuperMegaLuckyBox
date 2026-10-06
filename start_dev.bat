@echo off
rem ============================================================
rem  Dev server launcher (double-click to start).
rem  Serves the "docs" folder at http://localhost:8080 and opens the browser.
rem  Stop: press Ctrl+C in this window, or just close the window.
rem  Another port:  start_dev.bat 8090
rem  (ASCII only on purpose: avoids code page problems in cmd.exe)
rem ============================================================
setlocal
cd /d "%~dp0"

set PORT=8080
if not "%~1"=="" set PORT=%~1

set PY=.venv\Scripts\python.exe
if not exist "%PY%" set PY=python

echo.
echo  Super Mega Lucky Box - dev server
echo  URL : http://localhost:%PORT%/
echo  Stop: Ctrl+C (or close this window)
echo.

rem Open the browser after the server has had a moment to start.
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start "" http://localhost:%PORT%/"

"%PY%" -m http.server %PORT% --directory docs --bind 127.0.0.1

echo.
echo  The server has stopped (or failed to start).
echo  If the port is already in use, close the other server window or run: start_dev.bat 8090
pause
