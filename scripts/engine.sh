#!/bin/sh
set -eu
shiftflow_root=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
cd "$shiftflow_root"
if [ ! -x .venv/bin/uv ]; then
  echo 'Run npm run engine:setup first (or use uv run --project backend from the project root).' >&2
  exit 1
fi
exec .venv/bin/uv run --project backend --frozen "$@"
