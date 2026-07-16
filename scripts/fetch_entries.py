"""
fetch_entries.py — Populate wtt_entries from WTT's player-entries endpoint.

Unlike schedule.json (the DRAW, published only close to the event), the
GetPlayerEntriesforEvent endpoint returns the entry list (player list) as soon
as entries are confirmed, so upcoming events populate early. Feeds the Squad
"next tournament" and the Talent tab.

Usage:
  python scripts/fetch_entries.py                     # upcoming window (default)
  python scripts/fetch_entries.py --events 3244,3245  # specific events
  python scripts/fetch_entries.py --days-fwd 90
"""

import os
import time
import argparse
from datetime import date, timedelta, datetime, timezone

import requests
from supabase import create_client

ENTRIES_URL = ("https://wtt-website-live-events-api-prod-cmfzgabgbzhphabb"
               ".eastasia-01.azurewebsites.net/api/cms/GetPlayerEntriesforEvent/{eid}/all")
HEADERS = {
    "Origin":  "https://www.worldtabletennis.com",
    "Referer": "https://www.worldtabletennis.com/",
    "User-Agent": "Mozilla/5.0",
    "Accept":  "application/json",
}

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]


def disc_of(code):
    return "singles" if code in ("MS", "WS") else "doubles"


def partner_of(team_name, pid):
    """Doubles TeamName is 'id1/id2' — return the id that isn't this player."""
    if not team_name or "/" not in str(team_name):
        return None
    for part in str(team_name).split("/"):
        try:
            other = int(part)
        except ValueError:
            continue
        if other != pid:
            return other
    return None


def fetch_event_entries(eid):
    try:
        r = requests.get(ENTRIES_URL.format(eid=eid), headers=HEADERS, timeout=30)
        if r.status_code != 200:
            return None
        return r.json()
    except Exception as e:
        print(f"  [!] {eid}: {e}")
        return None


def map_rows(data):
    now = datetime.now(timezone.utc).isoformat()
    rows, seen = [], set()
    for r in data or []:
        pid = r.get("ittfid")
        sub = r.get("SubEventName")
        # Real ITTF ids are < 1,000,000; larger are registration placeholders.
        if not pid or pid >= 1_000_000 or not sub:
            continue
        key = (r.get("EventId"), sub, pid)
        if key in seen:
            continue
        seen.add(key)
        fam = (r.get("PlayerFamilyName") or "").strip()
        giv = (r.get("PlayerGivenName") or "").strip()
        name = f"{fam} {giv}".strip() or r.get("IndividualName")
        code = r.get("SubEventCode")
        disc = disc_of(code)
        rows.append({
            "event_id":     r.get("EventId"),
            "sub_event":    sub,
            "discipline":   disc,
            "player_id":    pid,
            "player_name":  name,
            "org":          r.get("OrgCode"),
            "seed":         int(r.get("Seed") or 0),
            "is_qualifier": r.get("EntryDrawName") == "Qualification Draw",
            "partner_id":   partner_of(r.get("TeamName"), pid) if disc == "doubles" else None,
            "last_updated": now,
        })
    return rows


def upcoming_event_ids(sb, back, fwd):
    lo = (date.today() - timedelta(days=back)).isoformat()
    hi = (date.today() + timedelta(days=fwd)).isoformat()
    r = (sb.table("wtt_events").select("event_id, event_name, start_date")
         .gte("start_date", lo).lte("start_date", hi).order("start_date").execute())
    return [(row["event_id"], row.get("event_name") or "") for row in (r.data or [])]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--events", default="", help="comma-separated event ids (else upcoming window)")
    ap.add_argument("--days-back", type=int, default=5)
    ap.add_argument("--days-fwd", type=int, default=75)
    args = ap.parse_args()

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    if args.events:
        events = [(int(e), "") for e in args.events.split(",") if e.strip()]
    else:
        events = upcoming_event_ids(sb, args.days_back, args.days_fwd)

    print(f"[entries] {len(events)} events to check")
    total = 0
    for eid, name in events:
        data = fetch_event_entries(eid)
        if not data:
            print(f"  {eid} {name}: no entries yet")
            continue
        rows = map_rows(data)
        for i in range(0, len(rows), 500):
            sb.table("wtt_entries").upsert(rows[i:i + 500], on_conflict="event_id,sub_event,player_id").execute()
        total += len(rows)
        print(f"  {eid} {name}: {len(rows)} entries")
        time.sleep(0.4)
    print(f"[entries] done — {total} rows upserted")


if __name__ == "__main__":
    main()
