#!/usr/bin/env python3
"""
heartbeat.py — the watchdog. Reads feed_health and ALERTS you when a feed goes
silent (its scheduled job stopped running) or errored on its last run.

This is the thing that was missing: previously a feed could die quietly and the
only monitor was you noticing no messages. Now you get a Telegram alert instead.

Alerts go to TELEGRAM_ALERT_CHAT_ID (a private chat/channel you control); if that
isn't set they fall back to the main channel. Alerts are de-duplicated to at most
one per feed-problem per 6 hours so you don't get spammed.

Usage
-----
  python scripts/heartbeat.py            # check + alert
  python scripts/heartbeat.py --dry-run  # print what it would alert
"""

import os, sys, argparse
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(__file__))
from tg_common import get_db, already_sent, mark_sent, tg_send, record_health

# feed -> (label, max_gap_minutes)  — how stale "last run" may get before it's overdue
FEEDS = {
    "wtt-live":      ("WTT Live Updater",   360 + 30),   # cron every 5h
    "wtt-schedule":  ("WTT Daily Schedule", 1440 + 120),  # daily
    "wtt-recap":     ("WTT Daily Recap",    1440 + 120),  # daily
    "ittf-live":     ("ITTF Live Results",  30 + 30),     # cron every 30m
    "ittf-recap":    ("ITTF Daily Recap",   360 + 60),    # cron every 6h
    "ittf-schedule": ("ITTF Daily Schedule", 1440 + 120), # daily
}


def _age_minutes(ts_str):
    if not ts_str:
        return None
    try:
        ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - ts).total_seconds() / 60
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    token   = os.environ.get("TELEGRAM_BOT_TOKEN")
    alert_to = os.environ.get("TELEGRAM_ALERT_CHAT_ID") or os.environ.get("TELEGRAM_CHANNEL_ID")
    db = get_db()
    if db is None:
        print("  [heartbeat] no Supabase — cannot check health")
        return
    if not args.dry_run and (not token or not alert_to):
        print("  [heartbeat] missing TELEGRAM_BOT_TOKEN / alert chat")
        return

    rows = {}
    try:
        for r in (db.table("feed_health").select("*").execute().data or []):
            rows[r["feed"]] = r
    except Exception as e:
        print(f"  [heartbeat] read error: {e}")
        return

    problems = []   # (feed, kind, message)
    for feed, (label, max_gap) in FEEDS.items():
        row = rows.get(feed)
        if not row:
            problems.append((feed, "silent", f"⚠️ <b>{label}</b> has never reported in. Its scheduled job may not be running."))
            continue
        if row.get("last_status") == "error":
            problems.append((feed, "error", f"❌ <b>{label}</b> errored on its last run:\n<code>{(row.get('last_detail') or '')[:300]}</code>"))
        age = _age_minutes(row.get("last_run_at"))
        if age is not None and age > max_gap:
            hrs = age / 60
            problems.append((feed, "silent", f"⚠️ <b>{label}</b> hasn't run in {hrs:.1f}h (expected within {max_gap/60:.1f}h). The schedule may be stalled or disabled."))

    if not problems:
        print("  [heartbeat] all feeds healthy.")
        record_health(db, "heartbeat", "ok", "all healthy")
        return

    # De-dupe alerts: at most one per feed-problem per 6h bucket
    bucket = datetime.now(timezone.utc).strftime("%Y-%m-%dT") + str(datetime.now(timezone.utc).hour // 6)
    for feed, kind, msg in problems:
        key = f"alert:{feed}:{kind}:{bucket}"
        if already_sent(db, "heartbeat-alert", [key]):
            print(f"  [heartbeat] already alerted: {feed}/{kind}")
            continue
        print(f"  [heartbeat] ALERT {feed}/{kind}")
        full = "🔔 <b>Feed health alert</b>\n\n" + msg
        if tg_send(token, alert_to, full, args.dry_run) and not args.dry_run:
            mark_sent(db, "heartbeat-alert", key)

    record_health(db, "heartbeat", "ok", f"{len(problems)} problem(s)")


if __name__ == "__main__":
    main()
