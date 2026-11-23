@echo off
cd /d "%~dp0"
node scripts\restart.mjs %*
if errorlevel 1 pause
