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

# feed -> (label, max_gap_minutes) — how stale "last run" may get before overdue.
# Gaps are generous because GitHub's scheduled crons are best-effort and often
# run late (a */30 cron can realistically be 60-90 min apart), so tight windows
# produce false alarms. We only want to hear about a *real* outage.
FEEDS = {
    "wtt-live":      ("WTT Live Updater",   420),   # cron every 5h
    "wtt-schedule":  ("WTT Daily Schedule", 1560),  # daily
    "wtt-recap":     ("WTT Daily Recap",    1560),  # daily
    "ittf-live":     ("ITTF Live Results",  150),   # cron every 30m (very lax)
    "ittf-recap":    ("ITTF Daily Recap",   600),   # cron every 6h
    "ittf-schedule": ("ITTF Daily Schedule", 1560), # daily
}


def _ittf_active(window_days: int = 2):
    """Is any ITTF/ATTU event currently on (±window)? Used to suppress off-season
    'silent feed' nagging for the ITTF feeds."""
    from datetime import date, timedelta
    try:
        from ittf_feed import ITTF_EVENTS
        today = date.today()
        return any(date.fromisoformat(s) - timedelta(days=window_days) <= today
                   <= date.fromisoformat(e) + timedelta(days=window_days)
                   for _, s, e, _tz in ITTF_EVENTS.values())
    except Exception:
        return True   # if unsure, don't suppress


def _event_list_horizon():
    """Latest end-date in each hand-maintained event list, so we can warn before
    they run dry. Returns {'WTT': date|None, 'ITTF': date|None}."""
    from datetime import date
    out = {"WTT": None, "ITTF": None}
    try:
        from fetch_matches import WTT_2026_EVENT_IDS
        ends = [date.fromisoformat(v[1]) for v in WTT_2026_EVENT_IDS.values()]
        out["WTT"] = max(ends) if ends else None
    except Exception as e:
        print(f"  [heartbeat] WTT list check skipped: {e}")
    try:
        from ittf_feed import ITTF_EVENTS
        ends = [date.fromisoformat(v[2]) for v in ITTF_EVENTS.values()]
        out["ITTF"] = max(ends) if ends else None
    except Exception as e:
        print(f"  [heartbeat] ITTF list check skipped: {e}")
    return out


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

    # Staleness guard for the hand-maintained event lists (mitigates the lack of
    # true calendar auto-discovery): warn before they run out so a feed never
    # silently goes dark because the next batch of events wasn't added.
    for kind_label, latest in _event_list_horizon().items():
        if latest is None:
            continue
        days = (latest - datetime.now(timezone.utc).date()).days
        if days < 21:
            problems.append((f"eventlist-{kind_label}", "stale",
                             f"🗓️ <b>{kind_label} event list</b> runs out in {days} day(s) "
                             f"(last event ends {latest}). Add the upcoming events so the "
                             f"feeds don't go silent."))

    ittf_on = _ittf_active()
    for feed, (label, max_gap) in FEEDS.items():
        # During the off-season the ITTF feeds legitimately do little; don't
        # nag about them being "silent" when there's no ITTF event on.
        gate_silence = not (feed.startswith("ittf-") and not ittf_on)
        row = rows.get(feed)
        if not row:
            if gate_silence:
                problems.append((feed, "silent", f"⚠️ <b>{label}</b> has never reported in. Its scheduled job may not be running."))
            continue
        if row.get("last_status") == "error":
            problems.append((feed, "error", f"❌ <b>{label}</b> errored on its last run:\n<code>{(row.get('last_detail') or '')[:300]}</code>"))
        age = _age_minutes(row.get("last_run_at"))
        if gate_silence and age is not None and age > max_gap:
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
