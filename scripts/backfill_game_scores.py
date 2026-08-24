#!/usr/bin/env python3
"""
backfill_game_scores.py — repair matches that stored only their first game.

Why these rows are broken
-------------------------
A WTT match card carries two game-score fields:

    gameScores        "10-12,0-0,0-0,0-0,0-0"     the live feed, frozen
    resultsGameScores "10-12,9-11,9-11,0-0,0-0"   the signed-off result

fetch_matches.py read `gameScores` and fell back to `resultsGameScores` only when
it was absent — which it never is. When a run landed while a match was still on,
the row kept the live snapshot, and every later run overwrote it with the same
stale value. 3,264 matches across 15 events (all 2026 youth) hold one game where
the match went three or five.

fetch_matches.py now takes whichever field carries more real games, so no new rows
break this way. This script repairs the ones already in the table.

What it does
------------
1. Finds every row whose game count disagrees with its match_score.
2. Asks WTT for that one match by name:
       GetMatchCardDetails/{event_id}/{document_code}
   The bulk endpoint (GetOfficialResult) has dropped most of these events, but
   the per-match one still serves several. document_code is the half of match_id
   after the underscore, so nothing extra needs looking up.
3. Writes back game_scores when the card carries more real games than we hold,
   and rebuilds comp1_scores / comp2_scores from it so the row stays consistent.

A row is never made shorter. If the card has no more than we already have, it is
left alone.

Not every event is still served — roughly 1,422 of the 3,264 are gone from the API
and stay short. The run reports both numbers.

Usage
-----
  python scripts/backfill_game_scores.py --dry-run     # report only, write nothing
  python scripts/backfill_game_scores.py               # repair
  python scripts/backfill_game_scores.py --event 3366  # one event
  python scripts/backfill_game_scores.py --limit 50    # first N rows (a smoke test)
"""

import argparse
import os
import sys
import time
from collections import defaultdict

import requests
from supabase import create_client, Client

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_matches import pick_game_scores, _clean_games   # the same rule the ingest uses

# This one gets run by hand from a Windows terminal, where stdout defaults to cp1252
# and the first box-drawing character in a heading kills the run.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

CARD_URL = ("https://wtt-website-api-vm-frontdoor-hhaec5epbhdyfugz.a01.azurefd.net"
            "/liveeventsapi/api/cms/GetMatchCardDetails")
HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept":     "application/json",
    "Origin":     "https://www.worldtabletennis.com",
    "Referer":    "https://www.worldtabletennis.com/",
}

SLEEP      = 0.25   # seconds between calls — the endpoint is a CDN, be polite
TIMEOUT    = 25
RETRIES    = 3
PAGE       = 1000   # rows per Supabase read
BATCH      = 200    # rows per Supabase write
GIVE_UP_AT = 8      # consecutive empty replies before writing an event off

TABLES = {
    # table: does it carry per-competitor score columns?
    "wtt_matches_singles": True,
    "wtt_matches_doubles": False,
}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def expected_games(match_score: str | None) -> int | None:
    """How many games the match_score says were played. None if it is not a plain N-M."""
    if not match_score:
        return None
    parts = match_score.split("-")
    if len(parts) != 2 or not (parts[0].strip().isdigit() and parts[1].strip().isdigit()):
        return None
    return int(parts[0]) + int(parts[1])


def split_match_id(match_id: str) -> tuple[str, str] | None:
    """"3366_TTEMSINGLES--------U17QFNL000400----------" -> ("3366", "TTEM...")."""
    if "_" not in match_id:
        return None
    event_id, doc = match_id.split("_", 1)
    if not event_id.isdigit() or not doc:
        return None
    return event_id, doc


def fetch_card(event_id: str, doc: str) -> dict | None:
    """One match card, or None if WTT no longer serves it.

    An event that has aged out returns HTTP 200 with a two-byte body, not an error,
    so an empty reply is a normal outcome here rather than a failure.
    """
    url = f"{CARD_URL}/{event_id}/{doc}"
    for attempt in range(RETRIES):
        try:
            r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        except Exception as e:
            if attempt == RETRIES - 1:
                print(f"    [!] {event_id}/{doc[:24]}: {e}")
                return None
            time.sleep(1.5 * (attempt + 1))
            continue
        if r.status_code != 200:
            if attempt == RETRIES - 1:
                print(f"    [!] HTTP {r.status_code} for {event_id}/{doc[:24]}")
                return None
            time.sleep(1.5 * (attempt + 1))
            continue
        if len(r.content) <= 10:
            return None            # aged out — not an error
        try:
            return r.json()
        except Exception:
            return None
    return None


def per_competitor(game_scores: str) -> tuple[str, str]:
    """"10-12,9-11" -> ("10,9", "12,11"). Rebuilt from the games we are about to
    store, because the card's own `scores` field is the live one and just as stale."""
    a, b = [], []
    for g in game_scores.split(","):
        x, y = g.split("-")
        a.append(x)
        b.append(y)
    return ",".join(a), ",".join(b)


# ─── Find the broken rows ─────────────────────────────────────────────────────

def load_broken(db: Client, table: str, only_event: int | None) -> list[dict]:
    """Every row whose stored game count is short of what match_score implies.

    Filtering happens here rather than in SQL because match_score is not always a
    plain "3-1" — "3 INJ" and friends appear — and a cast in the query would abort
    the whole read on the first one.
    """
    rows, start = [], 0
    cols = "match_id,event_id,match_score,game_scores"
    while True:
        q = db.table(table).select(cols).range(start, start + PAGE - 1)
        if only_event:
            q = q.eq("event_id", only_event)
        chunk = q.execute().data or []
        rows.extend(chunk)
        if len(chunk) < PAGE:
            break
        start += PAGE

    broken = []
    for r in rows:
        want = expected_games(r.get("match_score"))
        if want is None or want == 0:
            continue
        have = len(_clean_games(r.get("game_scores")))
        if have < want:
            r["_have"] = have
            r["_want"] = want
            broken.append(r)
    broken.sort(key=lambda r: (r["event_id"], r["match_id"]))
    return broken


# ─── Main ─────────────────────────────────────────────────────────────────────

def repair_table(db: Client, table: str, has_comp_scores: bool,
                 args) -> dict:
    print(f"\n── {table} " + "─" * (60 - len(table)))
    broken = load_broken(db, table, args.event)
    if args.limit:
        broken = broken[:args.limit]
    if not broken:
        print("  nothing to repair")
        return {"broken": 0, "fixed": 0, "gone": 0, "nomore": 0, "fullfix": 0}

    by_event = defaultdict(int)
    for r in broken:
        by_event[r["event_id"]] += 1
    print(f"  {len(broken)} rows short, across {len(by_event)} events")

    dead_events: set[int] = set()
    empties = defaultdict(int)
    updates: list[dict] = []
    stats = {"broken": len(broken), "fixed": 0, "gone": 0, "nomore": 0, "fullfix": 0}

    for i, r in enumerate(broken, 1):
        eid = r["event_id"]
        if eid in dead_events:
            stats["gone"] += 1
            continue

        parts = split_match_id(r["match_id"])
        if not parts:
            stats["gone"] += 1
            continue

        card = fetch_card(*parts)
        time.sleep(SLEEP)

        if card is None:
            stats["gone"] += 1
            empties[eid] += 1
            if empties[eid] >= GIVE_UP_AT:
                dead_events.add(eid)
                left = by_event[eid] - empties[eid]
                print(f"  event {eid}: {GIVE_UP_AT} empty replies — no longer served, "
                      f"skipping its remaining {max(left, 0)} rows")
            continue
        empties[eid] = 0

        best = pick_game_scores(card)
        have_n = r["_have"]
        best_n = len(_clean_games(best))
        if not best or best_n <= have_n:
            stats["nomore"] += 1
            continue

        row = {"match_id": r["match_id"], "game_scores": best}
        if has_comp_scores:
            c1, c2 = per_competitor(best)
            row["comp1_scores"] = c1
            row["comp2_scores"] = c2
        updates.append(row)
        stats["fixed"] += 1
        if best_n == r["_want"]:
            stats["fullfix"] += 1

        if i <= 5 or i % 250 == 0:
            print(f"  [{i}/{len(broken)}] {r['match_id'][:46]}  "
                  f"{r.get('game_scores')} -> {best}  (want {r['_want']})")

        if len(updates) >= BATCH and not args.dry_run:
            db.table(table).upsert(updates, on_conflict="match_id").execute()
            updates = []

    if updates and not args.dry_run:
        db.table(table).upsert(updates, on_conflict="match_id").execute()

    print(f"  repaired {stats['fixed']}  "
          f"(complete {stats['fullfix']})   "
          f"no longer served {stats['gone']}   "
          f"card had no more {stats['nomore']}")
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    ap.add_argument("--event", type=int, help="restrict to one event id")
    ap.add_argument("--limit", type=int, help="stop after N rows per table")
    ap.add_argument("--table", choices=list(TABLES), help="restrict to one table")
    args = ap.parse_args()

    db: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    if args.dry_run:
        print("DRY RUN - nothing will be written")

    tables = {args.table: TABLES[args.table]} if args.table else TABLES
    total = defaultdict(int)
    for table, has_comp in tables.items():
        for k, v in repair_table(db, table, has_comp, args).items():
            total[k] += v

    print("\n" + "=" * 70)
    print(f"  short rows found        {total['broken']}")
    print(f"  repaired                {total['fixed']}")
    print(f"    of those, complete    {total['fullfix']}")
    print(f"  no longer served by WTT {total['gone']}")
    print(f"  card had nothing more   {total['nomore']}")
    if args.dry_run:
        print("  (dry run — nothing written)")


if __name__ == "__main__":
    main()
