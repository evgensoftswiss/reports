#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if command -v lsof >/dev/null 2>&1; then PIDS=$(lsof -ti tcp:5000 2>/dev/null || true); [ -z "$PIDS" ] || kill $PIDS 2>/dev/null || true; fi
python3 app.py & PID=$!
sleep 2
open http://127.0.0.1:5000/ >/dev/null 2>&1 || true
wait $PID
