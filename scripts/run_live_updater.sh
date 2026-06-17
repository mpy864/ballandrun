#!/bin/bash
# Wrapper for live_updater.py — sourced by launchd agent.
# Keeps the Mac awake and restarts automatically on crash (via KeepAlive in plist).

PROJECT=/Users/mohityadav/tops-tt-dashboard
PYTHON=/opt/miniconda3/bin/python3

cd "$PROJECT"

# Load secrets from .env
set -a
source "$PROJECT/.env"
set +a

echo "[$(date '+%Y-%m-%d %H:%M:%S')] live_updater starting..."

# -u disables Python output buffering so logs appear immediately
# caffeinate -i prevents Mac sleep while this process runs
export PYTHONUNBUFFERED=1
exec caffeinate -i "$PYTHON" -u scripts/live_updater.py \
    --auto --points --db --interval 3
