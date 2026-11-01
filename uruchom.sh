#!/usr/bin/env bash
# Soldat Map Studio — start na Linuksie i macOS (odpowiednik "Uruchom Soldat Map Studio.bat").
# Użycie: ./uruchom.sh            (instaluje biblioteki i buduje interfejs, gdy trzeba)
#         ./uruchom.sh --rebuild  (wymusza przebudowę interfejsu)
set -e
cd "$(dirname "$0")"

echo "============================================================"
echo "  SOLDAT MAP STUDIO (MPA Pro + 100% Map Viewer + _f/_o)"
echo "============================================================"

if ! command -v node >/dev/null 2>&1; then
  echo "[BŁĄD] Nie znaleziono Node.js. Zainstaluj Node.js 22.13 lub nowszy — instrukcja w README.md."
  exit 1
fi

# The map index uses the built-in node:sqlite module (available without flags since Node 22.13)
if ! node -e "require('node:sqlite')" >/dev/null 2>&1; then
  echo "[BŁĄD] Node.js $(node --version) nie ma wbudowanego modułu node:sqlite."
  echo "       Zainstaluj Node.js 22.13 lub nowszy — instrukcja w README.md."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[1/3] Instalowanie bibliotek..."
  npm install
fi

if [ "${1:-}" = "--rebuild" ] || ! node scripts/needs-build.mjs; then
  echo "[2/3] Budowanie interfejsu aplikacji..."
  npm run build
fi

URL="http://127.0.0.1:${PORT:-4321}"
echo "[3/3] Uruchamianie serwera lokalnego na ${URL} (zamknięcie: Ctrl+C)..."
(
  sleep 2
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "$URL" || true
  else
    echo "Otwórz w przeglądarce: $URL"
  fi
) &

exec npx tsx src/server/index.ts
