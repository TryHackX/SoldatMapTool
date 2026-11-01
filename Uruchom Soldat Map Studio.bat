@echo off
chcp 65001 >nul
title Soldat Map Studio - MPA Pro ^& 100%% Map Viewer ^& Warsztat _f/_o
cd /d "%~dp0"

echo ============================================================
echo   SOLDAT MAP STUDIO (MPA Pro + 100%% Map Viewer + _f/_o)
echo   Obsluga 50 000+ map ^| RSCS ^| Trenchwars ^| Wlasne Prefixy
echo ============================================================

where node >nul 2>nul
if errorlevel 1 (
    echo [BLAD] Nie znaleziono Node.js. Zainstaluj Node.js 22.13 lub nowszy: https://nodejs.org
    pause
    exit /b 1
)

rem The map index database uses the built-in node:sqlite module (available without flags since Node 22.13)
node -e "require('node:sqlite')" >nul 2>nul
if errorlevel 1 (
    echo [BLAD] Ta wersja Node.js nie ma wbudowanego modulu node:sqlite.
    echo        Zainstaluj Node.js 22.13 lub nowszy: https://nodejs.org
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [1/3] Instalowanie bibliotek...
    call npm.cmd install
    if errorlevel 1 (
        echo [BLAD] Instalacja bibliotek nie powiodla sie.
        pause
        exit /b 1
    )
)

set NEED_BUILD=0
if "%~1"=="--rebuild" set NEED_BUILD=1
node scripts\needs-build.mjs || set NEED_BUILD=1

if "%NEED_BUILD%"=="1" (
    echo [2/3] Budowanie interfejsu aplikacji ^(wykryto nowe zrodla^)...
    call npm.cmd run build
    if errorlevel 1 (
        echo [BLAD] Budowanie interfejsu nie powiodlo sie.
        pause
        exit /b 1
    )
)

echo [3/3] Uruchamianie serwera lokalnego na http://127.0.0.1:4321 ...
start "" /B cmd /c "timeout /t 2 /nobreak >nul & if exist ""C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"" (start """" ""C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"" --app=http://127.0.0.1:4321) else (start http://127.0.0.1:4321)"

call npx.cmd tsx src/server/index.ts
pause
