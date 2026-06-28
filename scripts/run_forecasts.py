"""
run_forecasts.py — Auto-run tournament forecasts and push to Supabase.

Picks upcoming/active events from wtt_events (or an explicit --events list) and
runs the singles forecast for each, persisting results to wtt_forecasts.

Usage:
  python scripts/run_forecasts.py                 # auto: upcoming events
  python scripts/run_forecasts.py --events 3242   # specific event(s)
"""

from __future__ import annotations

import os
import sys
import subprocess
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(__file__))

WINDOW_BACK = 5     # include events that started up to N days ago
WINDOW_FWD = 21     # and up to N days in the future
DEFAULT_SUBS = "Men's Singles,Women's Singles"


def upcoming_events():
    from supabase import create_client
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    lo = (date.today() - timedelta(days=WINDOW_FWD)).isoformat()      # started up to FWD days ago
    hi = (date.today() + timedelta(days=WINDOW_FWD)).isoformat()
    today = date.today().isoformat()
    r = (sb.table("wtt_events")
         .select("event_id, event_name, start_date, end_date")
         .gte("start_date", lo).lte("start_date", hi)
         .execute())
    # keep events that are live or upcoming (not long finished)
    out = []
    for row in (r.data or []):
        end = row.get("end_date")
        if end and end < (date.today() - timedelta(days=WINDOW_BACK)).isoformat():
            continue
        out.append((row["event_id"], row.get("event_name") or ""))
    return out


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--events", default="", help="comma-separated event ids (else auto)")
    ap.add_argument("--subs", default=DEFAULT_SUBS)
    ap.add_argument("--runs", type=int, default=20000)
    args = ap.parse_args()

    if args.events:
        events = [(int(e), "") for e in args.events.split(",")]
        # names help tier detection; fetch if missing
        if any(not n for _, n in events):
            from supabase import create_client
            sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
            ids = [e for e, _ in events]
            r = sb.table("wtt_events").select("event_id, event_name").in_("event_id", ids).execute()
            names = {row["event_id"]: row.get("event_name") or "" for row in (r.data or [])}
            events = [(e, names.get(e, "")) for e, _ in events]
    else:
        events = upcoming_events()

    print(f"[forecasts] {len(events)} event(s) to process")
    here = os.path.dirname(__file__)
    for eid, name in events:
        print(f"\n=== {name or eid} (id {eid}) ===")
        cmd = [sys.executable, os.path.join(here, "simulate_event.py"),
               "--event", str(eid), "--name", name,
               "--subs", args.subs, "--runs", str(args.runs), "--push"]
        try:
            subprocess.run(cmd, check=True)
        except subprocess.CalledProcessError as e:
            print(f"[!] forecast failed for {eid}: {e}")


if __name__ == "__main__":
    main()
