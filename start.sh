#!/usr/bin/env bash
# Soldat Map Studio launcher for Linux and macOS (the counterpart of "Start Soldat Map Studio.bat").
# Usage: ./start.sh            (installs libraries and builds the interface when needed)
#        ./start.sh --rebuild  (forces an interface rebuild)
set -e
cd "$(dirname "$0")"

echo "============================================================"
echo "  SOLDAT MAP STUDIO (MPA Pro + 100% Map Viewer + _f/_o)"
echo "============================================================"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js not found. Install Node.js 22.13 or newer — see README.md."
  exit 1
fi

# The map index uses the built-in node:sqlite module (available without flags since Node 22.13)
if ! node -e "require('node:sqlite')" >/dev/null 2>&1; then
  echo "[ERROR] Node.js $(node --version) has no built-in node:sqlite module."
  echo "        Install Node.js 22.13 or newer — see README.md."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[1/3] Installing libraries..."
  npm install
fi

if [ "${1:-}" = "--rebuild" ] || ! node scripts/needs-build.mjs; then
  echo "[2/3] Building the app interface..."
  npm run build
fi

echo "[3/3] Starting Soldat Map Studio (stop: Ctrl+C)..."
exec node scripts/serve.mjs --open
