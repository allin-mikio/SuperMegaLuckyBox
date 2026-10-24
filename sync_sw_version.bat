@echo off
rem Sync SW_BUILD in docs\sw.js with APP_VERSION in docs\js\version.js. Run after editing version.js, before publishing.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\sync_sw_version.ps1"
pause
