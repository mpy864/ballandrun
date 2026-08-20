#!/usr/bin/env python3
"""
fetch_ranking_points.py — ranking points earned per player, per event.

WTT publishes a points breakdown that we were not using:

    /internalttu/Rankings/GetRankingPointsBreakdown

This is the only source for "how many points did an athlete earn at this
tournament". It cannot be derived from what we already store: rankings_*.points are
rolling totals, and a week-over-week delta mixes points gained with points expiring
out of WTT's rolling window.

Two useful properties:

  * IttfId is IGNORED. Every call returns the whole category, so ten requests cover
    every player and every event — no per-athlete loop.
  * ResultPosition records how far each competitor went (W, F, SF, QF, R16, R32, R64,
    GL, QR1...), straight from WTT rather than inferred from match rows.

Team events express position as a share — 'W-48%', 'F-47%' — the team result plus that
player's contribution. base_position keeps the leading token for grouping;
result_position preserves the original.

Rows are never deleted. Unlike entries, where a withdrawal means someone is no longer
going, points earned is a historical fact: winning Montpellier 2025 for 1000 points
stays true after that result rolls out of the current ranking window.

Usage:
    python scripts/fetch_ranking_points.py
    python scripts/fetch_ranking_points.py --dry-run    # fetch and report, write nothing
"""

import argparse
import os
import sys
import time
from datetime import date, datetime, timezone

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tg_common import get_db, record_health          # noqa: E402

FEED = "wtt-ranking-points"
URL = "https://wttcmsapigateway-new.azure-api.net/internalttu/Rankings/GetRankingPointsBreakdown"
HEADERS = {
    "apikey":     "2bf8b222-532c-4c60-8ebe-eb6fdfebe84a",
    "secapimkey": "S_WTT_882jjh7basdj91834783mds8j2jsd81",
    "origin":     "https://www.worldtabletennis.com",
    "referer":    "https://www.worldtabletennis.com/",
    "accept":     "application/json",
    "user-agent": "Mozilla/5.0",
}

# Every combination that returns data. Verified 2026-08-20: senior carries SEN and U21
# bands, youth carries U11 through U19.
CATEGORIES = [(c, r) for c in ("SEN", "YOU") for r in ("MS", "WS", "MD", "WD", "XD")]

TIMEOUT = 90
RETRIES = 3
BATCH   = 500


def safe_int(v):
    try:
        return int(v) if v not in (None, "", "null") else None
    except (TypeError, ValueError):
        return None


def base_position(pos):
    """'W-48%' -> 'W'.  'SF' -> 'SF'.  Team events append a contribution share."""
    if not pos:
        return None
    return str(pos).split("-", 1)[0].strip() or None


def fetch(category, ranking_category, year, week):
    params = {"CategoryCode": category, "OrganizationCode": "ITTF",
              "RankingCategoryCode": ranking_category,
              "RankingYear": year, "RankingWeek": week}
    for attempt in range(1, RETRIES + 1):
        try:
            r = requests.get(URL, params=params, headers=HEADERS, timeout=TIMEOUT)
            if r.status_code == 200:
                return r.json().get("Result", [])
            print(f"    [!] HTTP {r.status_code}")
        except Exception as e:
            print(f"    [retry {attempt}/{RETRIES}] {type(e).__name__}: {e}")
        if attempt < RETRIES:
            time.sleep(4 * attempt)
    return None                     # None means failed, distinct from [] meaning empty


# Placeholder positions WTT emits alongside a real result, always worth 0 points.
PLACEHOLDER_POSITIONS = {"ZPP", "DNP"}


def map_rows(raw, category, ranking_category):
    """Rows keyed on (competitor, event, ranking_category, age_category).

    The payload repeats that key occasionally: a genuine result plus a ZPP/DNP
    zero-point placeholder for the same event. Measured on SEN/MS, 12 of 5,920 rows
    were duplicated and TWO of them disagreed on points — 'QER 8' against 'ZPP 0', and
    'GL 1' against 'ZPP 0'. Taking whichever arrived first would silently have thrown
    the real score away, so the higher-scoring row wins, preferring a real position
    when points are equal.
    """
    best = {}
    for r in raw:
        cid = safe_int(r.get("CompetitorId"))
        eid = safe_int(r.get("EventId"))
        band = r.get("AgeCategoryCode")
        if cid is None or eid is None or not band:
            continue
        key = (cid, eid, ranking_category, band)
        pos = r.get("ResultPosition")
        pts = safe_int(r.get("RankingPoints")) or 0
        rank_of = (pts, 0 if base_position(pos) in PLACEHOLDER_POSITIONS else 1)
        if key in best and best[key][0] >= rank_of:
            continue
        best[key] = (rank_of, r)

    rows = []
    for (cid, eid, rcat, band), (_, r) in best.items():
        pos = r.get("ResultPosition")
        rows.append({
            "competitor_id":    cid,
            "event_id":         eid,
            "ranking_category": ranking_category,
            "age_category":     band,
            "category_code":    category,
            "event_name":       (r.get("EventName") or "").strip() or None,
            "result_position":  pos,
            "base_position":    base_position(pos),
            "ranking_points":   safe_int(r.get("RankingPoints")),
            "ranking_year":     safe_int(r.get("RankingYear")),
            "ranking_month":    safe_int(r.get("RankingMonth")),
            "ranking_week":     safe_int(r.get("RankingWeek")),
            "last_updated":     datetime.now(timezone.utc).isoformat(),
        })
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="fetch and report, write nothing")
    args = ap.parse_args()

    db = get_db()
    if db is None and not args.dry_run:
        sys.exit("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY")

    year, week, _ = date.today().isocalendar()
    print(f"[points] breakdown as published for {year} W{week}\n")

    total, failed = 0, []
    for category, ranking_category in CATEGORIES:
        label = f"{category}/{ranking_category}"
        raw = fetch(category, ranking_category, year, week)
        if raw is None:
            print(f"  {label:<8} FAILED")
            failed.append(label)
            time.sleep(1)
            continue

        rows = map_rows(raw, category, ranking_category)
        print(f"  {label:<8} {len(raw):>6} returned  {len(rows):>6} usable", end="")

        if args.dry_run:
            print("   (dry run)")
        else:
            written = 0
            for i in range(0, len(rows), BATCH):
                chunk = rows[i:i + BATCH]
                try:
                    db.table("wtt_ranking_points").upsert(
                        chunk,
                        on_conflict="competitor_id,event_id,ranking_category,age_category"
                    ).execute()
                    written += len(chunk)
                except Exception as e:
                    print(f"\n    [!] upsert failed at row {i}: {e}", end="")
            print(f"   {written} written")
            total += written
        time.sleep(1)

    print(f"\n[points] done — {total} rows upserted"
          + (f", {len(failed)} category(ies) failed: {', '.join(failed)}" if failed else ""))

    if args.dry_run:
        return 0

    # Report in so the heartbeat can notice silence or failure. Partial success is an
    # error: a missing category means a whole discipline's points are stale.
    if failed:
        record_health(db, FEED, "error",
                      f"{len(failed)} categor(ies) failed: {', '.join(failed)}", total)
        return 1
    record_health(db, FEED, "ok", f"{total} rows across {len(CATEGORIES)} categories", total)
    return 0


if __name__ == "__main__":
    sys.exit(main())
