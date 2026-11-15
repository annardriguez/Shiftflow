#!/bin/sh
set -eu
shiftflow_root=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
cd "$shiftflow_root"
python3 -m venv .venv
.venv/bin/python -m pip install 'uv==0.13.8'
.venv/bin/uv python install 3.12.16
.venv/bin/uv sync --project backend --frozen
