"""
backfill_doubles.py
One-off backfill of historical doubles/mixed matches into wtt_matches_doubles.

The daily fetch_matches.py only re-fetches events it has not loaded, so past events
(already loaded for singles) never get their doubles. This script walks past events
from wtt_events, re-fetches each via GetOfficialResult, and upserts ONLY the doubles
matches. It reuses fetch_matches.py's parsing (parse_doubles_match) and player insert.

Usage:
    export SUPABASE_URL=...  SUPABASE_SERVICE_KEY=...
    python scripts/backfill_doubles.py                 # 2024-01-01 -> today
    python scripts/backfill_doubles.py --since 2025-01-01
    python scripts/backfill_doubles.py --limit 20      # try only 20 events
"""

import time
import argparse
from datetime import date
import fetch_matches as fm


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2024-01-01", help="earliest event start_date to try")
    ap.add_argument("--limit", type=int, default=0, help="cap number of events (0 = all)")
    args = ap.parse_args()

    sb = fm.create_client(fm.SUPABASE_URL, fm.SUPABASE_KEY)

    # events already carrying doubles → skip
    done = set()
    r = sb.table("wtt_matches_doubles").select("event_id").execute()
    for row in (r.data or []):
        if row.get("event_id") is not None:
            done.add(row["event_id"])

    # candidate past events
    evs = (sb.table("wtt_events")
           .select("event_id, event_name, start_date")
           .lte("start_date", date.today().isoformat())
           .gte("start_date", args.since)
           .order("start_date", desc=True)
           .execute())
    targets = [e for e in (evs.data or []) if e["event_id"] not in done]
    if args.limit:
        targets = targets[:args.limit]

    print(f"[Doubles backfill] {len(targets)} events to try ({len(done)} already have doubles).")

    total = 0
    for e in targets:
        eid = e["event_id"]
        try:
            _singles, dmatches = fm.fetch_event_matches(eid)
        except Exception as ex:
            print(f"  {eid}: fetch error — {ex}")
            time.sleep(getattr(fm, "SLEEP_EVENT", 1))
            continue

        d = [m for m in dmatches if m.get("match_id")]
        if not d:
            continue

        for i in range(0, len(d), 500):
            try:
                sb.table("wtt_matches_doubles").upsert(d[i:i+500], on_conflict="match_id").execute()
            except Exception as ex:
                print(f"  {eid}: upsert error — {ex}")

        # ensure the four players per match exist
        ps = []
        for m in dmatches:
            ps.append({"comp1_id": m["comp1_p1_id"], "comp2_id": m["comp1_p2_id"]})
            ps.append({"comp1_id": m["comp2_p1_id"], "comp2_id": m["comp2_p2_id"]})
        try:
            fm.ensure_players_in_db(sb, ps)
        except Exception as ex:
            print(f"  {eid}: player insert error — {ex}")

        total += len(d)
        print(f"  {eid} {e.get('event_name','')}: +{len(d)} doubles")
        time.sleep(getattr(fm, "SLEEP_EVENT", 1))

    print(f"[Doubles backfill] Done. {total} doubles matches upserted.")


if __name__ == "__main__":
    main()
