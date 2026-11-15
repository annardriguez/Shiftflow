#!/bin/sh
# Start a self-contained hosted demo: database, engine, app, then prepare a
# valid roster. Data lives in the container and resets on every restart.
set -eu
cd "$(dirname "$0")/.."
export SHIFTFLOW_DATA_DIR="${SHIFTFLOW_DATA_DIR:-$PWD/.data}"
export PORT="${PORT:-7860}"
# Hugging Face Spaces provides the public host name.
if [ -z "${SHIFTFLOW_PUBLIC_ORIGIN:-}" ] && [ -n "${SPACE_HOST:-}" ]; then
  export SHIFTFLOW_PUBLIC_ORIGIN="https://$SPACE_HOST"
fi
if [ -z "${SHIFTFLOW_DEMO_PASSWORD:-}" ]; then
  echo "SHIFTFLOW_DEMO_PASSWORD is not set: demo accounts get random passwords nobody knows." >&2
fi
mkdir -p "$SHIFTFLOW_DATA_DIR"

npx tsx scripts/db-local.mts &
db_pid=$!
for i in $(seq 1 60); do
  if node -e "require('net').connect(54329,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"; then break; fi
  sleep 1
done
npx tsx scripts/db-setup.mts
npx tsx scripts/db-seed.mts

node scripts/run-engine.mjs &
engine_pid=$!
for i in $(seq 1 60); do
  if node -e "fetch('http://127.0.0.1:8000/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; then break; fi
  sleep 1
done

npx next start --hostname 0.0.0.0 --port "$PORT" &
app_pid=$!
for i in $(seq 1 60); do
  if node -e "fetch('http://127.0.0.1:$PORT/sign-in').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; then break; fi
  sleep 1
done
npx tsx scripts/demo-prepare.mts || echo "Demo roster preparation failed; the app still runs." >&2

trap 'kill $app_pid $engine_pid $db_pid 2>/dev/null' TERM INT
wait $app_pid
