#!/bin/bash
# setup_automation.sh — One-time setup for WTT automation on this Mac.
# Run once: bash scripts/setup_automation.sh
# To stop everything: bash scripts/setup_automation.sh --stop

PROJECT=/Users/mohityadav/ballandrun
AGENTS=~/Library/LaunchAgents
LIVE_PLIST=com.ballandrun.wtt-live.plist
DAILY_PLIST=com.ballandrun.wtt-daily.plist
CATCHUP_PLIST=com.ballandrun.wtt-catchup.plist

# ── Stop mode ─────────────────────────────────────────────────────────────────
if [[ "$1" == "--stop" ]]; then
    echo "Stopping WTT automation..."
    launchctl unload "$AGENTS/$LIVE_PLIST"    2>/dev/null && echo "  live_updater stopped"
    launchctl unload "$AGENTS/$DAILY_PLIST"  2>/dev/null && echo "  daily_schedule stopped"
    launchctl unload "$AGENTS/$CATCHUP_PLIST" 2>/dev/null && echo "  catchup stopped"
    echo "Done. Run this script without --stop to restart."
    exit 0
fi

# ── Preflight checks ──────────────────────────────────────────────────────────
echo "=== WTT Automation Setup ==="
echo ""

# Check .env has Telegram credentials
if ! grep -q "TELEGRAM_BOT_TOKEN" "$PROJECT/.env" 2>/dev/null; then
    echo "ERROR: TELEGRAM_BOT_TOKEN not found in .env"
    echo "  Run: echo \"TELEGRAM_BOT_TOKEN=<your_token>\" >> $PROJECT/.env"
    exit 1
fi
if ! grep -q "TELEGRAM_CHANNEL_ID" "$PROJECT/.env" 2>/dev/null; then
    echo "ERROR: TELEGRAM_CHANNEL_ID not found in .env"
    echo "  Run: echo \"TELEGRAM_CHANNEL_ID=@WTT_MatchUpdates\" >> $PROJECT/.env"
    exit 1
fi
echo "  .env credentials: OK"

# ── Setup ─────────────────────────────────────────────────────────────────────

# Create logs directory
mkdir -p "$PROJECT/logs"
echo "  logs dir: $PROJECT/logs"

# Make wrapper scripts executable
chmod +x "$PROJECT/scripts/run_live_updater.sh"
chmod +x "$PROJECT/scripts/run_daily_schedule.sh"
chmod +x "$PROJECT/scripts/run_catchup.sh"

# Unload existing agents if running (safe to ignore errors)
launchctl unload "$AGENTS/$LIVE_PLIST"    2>/dev/null
launchctl unload "$AGENTS/$DAILY_PLIST"  2>/dev/null
launchctl unload "$AGENTS/$CATCHUP_PLIST" 2>/dev/null

# Copy plists to LaunchAgents
cp "$PROJECT/scripts/$LIVE_PLIST"    "$AGENTS/"
cp "$PROJECT/scripts/$DAILY_PLIST"   "$AGENTS/"
cp "$PROJECT/scripts/$CATCHUP_PLIST" "$AGENTS/"
echo "  LaunchAgents installed"

# Load agents
launchctl load "$AGENTS/$LIVE_PLIST"
launchctl load "$AGENTS/$DAILY_PLIST"
launchctl load "$AGENTS/$CATCHUP_PLIST"

# ── Status ────────────────────────────────────────────────────────────────────
echo ""
echo "=== Setup Complete ==="
echo ""
echo "  live_updater   — running now, restarts automatically on crash"
echo "  daily_schedule — runs every day at 07:00 AM"
echo "  catchup        — runs every hour as safety net for missed results"
echo ""
echo "  Logs:"
echo "    tail -f $PROJECT/logs/live_updater.log"
echo "    tail -f $PROJECT/logs/daily_schedule.log"
echo "    tail -f $PROJECT/logs/catchup.log"
echo ""
echo "  To stop: bash scripts/setup_automation.sh --stop"
