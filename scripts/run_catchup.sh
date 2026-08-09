#!/bin/bash
# run_catchup.sh — Hourly safety net: catch any results live_updater may have missed.
# Sourced by launchd agent com.ballandrun.wtt-catchup.

PROJECT=/Users/mohityadav/ballandrun
PYTHON=/opt/miniconda3/bin/python3

cd "$PROJECT"

# Load secrets from .env
set -a
source "$PROJECT/.env"
set +a

echo "[$(date '+%Y-%m-%d %H:%M:%S')] catchup run..."
export PYTHONUNBUFFERED=1
"$PYTHON" -u scripts/send_todays_results.py --auto --db
