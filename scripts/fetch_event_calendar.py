"""
fetch_event_calendar.py
Keeps wtt_events in step with WTT's published calendar.

Why this exists
---------------
Nothing in this repo ever refreshed an event's details. ensure_event_in_db() in
fetch_matches.py writes event_name and event_start_date, only for ids already in the
hand-maintained WTT_2026_EVENT_IDS dict, and only once a match has been played. country,
event_type, start_date and end_date were loaded once by hand and never touched again.

So when WTT moved event 3254 from London to Astana, we kept calling it
"WTT Star Contender London 2026" in England. It sat on the dashboard under a city on the
wrong continent, and nothing could have caught it.

Measured against the live calendar on 2026-08-24, of 74 current and future events:
13 were missing from wtt_events entirely, 7 had the wrong start date (WTT Feeder Tunis
was out by four months), 3 named the wrong venue, and 2 the wrong country.

WTT publishes all of it at Events/GetEvents, which takes no parameters and returns the
~100 current and future events. We had simply never called it.

What it does NOT do
-------------------
Touch event_tier. The calendar has no equivalent field, and wtt_events_graded — and
every grade lookup built on it — reads that column. Writing nulls over it would silently
ungrade the whole calendar.

Nor does it trust an empty reply. A calendar that comes back with nothing is an outage,
not a world without tournaments; the run aborts rather than deleting our sense of the
season.

Usage
-----
  python scripts/fetch_event_calendar.py            # sync
  python scripts/fetch_event_calendar.py --dry-run  # report the drift, write nothing
"""

import argparse
import os
import sys
from datetime import datetime, timezone

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tg_common import get_db, record_health                       # noqa: E402

# Event names carry accents and curly apostrophes — "São José dos Campos", "President's
# Cup". A Windows terminal defaults to cp1252 and prints them as "?", which makes the
# change log unreadable exactly where it matters most.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

FEED = "wtt-calendar"

URL = "https://wttcmsapigateway-new.azure-api.net/ttu/Events/GetEvents"
HEADERS = {
    "apikey":     "2bf8b222-532c-4c60-8ebe-eb6fdfebe84a",
    "secapimkey": "S_WTT_882jjh7basdj91834783mds8j2jsd81",
    "origin":     "https://www.worldtabletennis.com",
    "referer":    "https://www.worldtabletennis.com/",
    "accept":     "application/json",
    "user-agent": "Mozilla/5.0",
}
TIMEOUT  = 40
RETRIES  = 3

# The endpoint has returned 100 events on every call. Anything far below that is a
# broken reply rather than a shrunken calendar, and must not be written.
MIN_EVENTS = 50

# Columns this script owns. event_tier is deliberately absent — see the module docstring.
FIELDS = ("event_name", "event_type", "country", "start_date", "end_date", "year")


def iso(d: str | None) -> str | None:
    """"2026/09/15" -> "2026-09-15". WTT uses slashes; Postgres wants dashes."""
    if not d:
        return None
    s = str(d).strip().replace("/", "-")
    try:
        datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        return None
    return s


def fetch_calendar() -> list[dict]:
    """The calendar as WTT publishes it. Raises on a reply we should not act on."""
    last = None
    for attempt in range(RETRIES):
        try:
            r = requests.get(URL, headers=HEADERS, timeout=TIMEOUT)
            if r.status_code != 200:
                last = f"HTTP {r.status_code}"
                continue
            rows = (r.json() or {}).get("Result") or []
            if len(rows) < MIN_EVENTS:
                last = f"only {len(rows)} events returned (expected >= {MIN_EVENTS})"
                continue
            return rows
        except Exception as e:
            last = str(e)
    raise RuntimeError(f"calendar unusable after {RETRIES} tries: {last}")


def to_row(r: dict) -> dict | None:
    """One calendar entry as a wtt_events row, or None if it has no usable id/date."""
    try:
        event_id = int(r.get("EventId"))
    except (TypeError, ValueError):
        return None
    start = iso(r.get("EventStartDate"))
    name  = (r.get("EventLongName") or r.get("EventShortName") or "").strip()
    if not start or not name:
        return None
    return {
        "event_id":   event_id,
        "event_name": name,
        # EventCategoryName is the series ("WTT Star Contender", "WTT Youth Contender"),
        # which is what event_type already holds. EventTypeDescription is just
        # "Tournament" for nearly everything and would tell us nothing.
        "event_type": (r.get("EventCategoryName") or "").strip() or None,
        "country":    (r.get("EventCountryName") or "").strip() or None,
        "start_date": start,
        "end_date":   iso(r.get("EventEndDate")),
        "year":       int(start[:4]),
    }


def describe(before: dict | None, after: dict) -> str | None:
    """What changed, in words, or None if nothing did. This is the whole point of the
    run log: a venue move has to be readable, not inferred from a row count."""
    if before is None:
        return f"NEW    {after['event_name']} ({after['country']}, {after['start_date']})"
    diffs = []
    for f in FIELDS:
        old, new = before.get(f), after.get(f)
        if old is not None and hasattr(old, "isoformat"):
            old = old.isoformat()
        if str(old or "") != str(new or ""):
            diffs.append(f"{f}: {old!r} -> {new!r}")
    return None if not diffs else "UPDATE " + "; ".join(diffs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report the drift, write nothing")
    args = ap.parse_args()

    db = get_db()
    if db is None:
        print("  [calendar] no Supabase connection")
        sys.exit(1)

    try:
        raw = fetch_calendar()
    except Exception as e:
        print(f"  [calendar] {e}")
        record_health(db, FEED, "error", str(e))
        sys.exit(1)

    rows = [x for x in (to_row(r) for r in raw) if x]
    print(f"  [calendar] {len(raw)} events returned, {len(rows)} usable")

    existing = {}
    ids = [r["event_id"] for r in rows]
    for i in range(0, len(ids), 200):
        got = (db.table("wtt_events")
                 .select("event_id," + ",".join(FIELDS))
                 .in_("event_id", ids[i:i + 200])
                 .execute().data or [])
        for e in got:
            existing[e["event_id"]] = e

    changed, new = [], 0
    for r in rows:
        note = describe(existing.get(r["event_id"]), r)
        if not note:
            continue
        changed.append(r)
        if note.startswith("NEW"):
            new += 1
        print(f"    {r['event_id']}  {note}")

    print(f"  [calendar] {new} new, {len(changed) - new} updated, "
          f"{len(rows) - len(changed)} unchanged")

    if args.dry_run:
        print("  [calendar] dry run — nothing written")
        return

    if changed:
        now = datetime.now(timezone.utc).isoformat()
        for r in changed:
            r["last_updated"] = now
        for i in range(0, len(changed), 200):
            db.table("wtt_events").upsert(changed[i:i + 200], on_conflict="event_id").execute()

    record_health(db, FEED, "ok",
                  f"{len(rows)} events, {new} new, {len(changed) - new} updated")


if __name__ == "__main__":
    main()
