#!/bin/bash
# Wrapper for daily_schedule.py — runs once every morning at 7:00 AM via launchd.

PROJECT=/Users/mohityadav/tops-tt-dashboard
PYTHON=/opt/miniconda3/bin/python3

cd "$PROJECT"

# Load secrets from .env
set -a
source "$PROJECT/.env"
set +a

echo "[$(date '+%Y-%m-%d %H:%M:%S')] daily_schedule running..."

"$PYTHON" scripts/daily_schedule.py --auto --db --india-only
