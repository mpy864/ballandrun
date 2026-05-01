"""
backfill_youth_doubles_only.py
Backfills historical youth doubles rankings for all weeks that already
have singles data but are missing from youth_rankings_doubles.

The existing backfill_youth_rankings.py skips any week where singles exist
(week_exists checks singles), so doubles got only 1 snapshot.
This script fixes that by checking doubles presence only.

Usage:
    export SUPABASE_URL=...  SUPABASE_SERVICE_KEY=...
    python scripts/backfill_youth_doubles_only.py
    python scripts/backfill_youth_doubles_only.py --from-year 2025
    python scripts/backfill_youth_doubles_only.py --from-year 2025 --from-week 10
"""

import os
import sys
import time
import argparse
import requests
from datetime import datetime, timezone
from supabase import create_client, Client

# ── Config ─────────────────────────────────────────────────────────────────
PAIRS_URL  = "https://wttcmsapigateway-new.azure-api.net/internalttu/Rankings/GetRankingPairs"
HEADERS = {
    "apikey":     "2bf8b222-532c-4c60-8ebe-eb6fdfebe84a",
    "secapimkey": "S_WTT_882jjh7basdj91834783mds8j2jsd81",
    "origin":     "https://www.worldtabletennis.com",
    "referer":    "https://www.worldtabletennis.com/",
    "accept":     "application/json",
    "user-agent": "Mozilla/5.0",
}
TIMEOUT    = 30
PAGE_SIZE  = 500
BATCH_SIZE = 200
SLEEP_REQ  = 0.6
SLEEP_WEEK = 2.0

DOUBLES_EVENTS = ["MD", "WD", "XD"]
AGE_CATEGORIES = ["U13", "U15", "U17", "U19"]

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]


# ── Helpers ─────────────────────────────────────────────────────────────────

def fetch_paginated(url: str, params: dict) -> list:
    rows, start = [], 1
    while True:
        for attempt in range(4):
            try:
                r = requests.get(
                    url,
                    params={**params, "StartRank": start, "EndRank": start + PAGE_SIZE - 1, "q": 1},
                    headers=HEADERS, timeout=TIMEOUT,
                )
                r.raise_for_status()
                break
            except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
                wait = 10 * (attempt + 1)
                print(f"      [retry {attempt+1}/3 after {wait}s] {e}")
                time.sleep(wait)
        else:
            print("      [gave up after 3 retries — skipping page]")
            break
        page = r.json().get("Result", [])
        if not page:
            break
        rows.extend(page)
        start += PAGE_SIZE
        time.sleep(SLEEP_REQ)
    return rows


def get_singles_weeks(supabase: Client, from_year: int, from_week: int) -> list[dict]:
    """Return all (year, week) pairs present in youth_rankings_singles."""
    res = (supabase.table("youth_rankings_singles")
           .select("ranking_year, ranking_week, publish_date")
           .eq("sub_event", "MS")
           .gte("ranking_year", from_year)
           .order("ranking_year").order("ranking_week")
           .execute())
    seen = {}
    for r in (res.data or []):
        key = (r["ranking_year"], r["ranking_week"])
        if key not in seen:
            seen[key] = r["publish_date"]
    # Filter from_week for the from_year
    return [
        {"year": yr, "week": wk, "publish_date": dt}
        for (yr, wk), dt in sorted(seen.items())
        if (yr, wk) >= (from_year, from_week)
    ]


def doubles_week_exists(supabase: Client, year: int, week: int) -> bool:
    res = (supabase.table("youth_rankings_doubles")
           .select("pair_id", count="exact")
           .eq("ranking_year", year)
           .eq("ranking_week", week)
           .limit(1).execute())
    return (res.count or 0) > 0


def parse_date(s) -> str | None:
    if not s:
        return None
    for fmt in ("%m/%d/%Y %H:%M:%S", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except Exception:
            pass
    return None


def safe_int(v) -> int | None:
    try:
        return int(v) if v not in (None, "", "null") else None
    except Exception:
        return None


def safe_float(v) -> float | None:
    try:
        return float(v) if v not in (None, "", "null") else None
    except Exception:
        return None


def upsert_batched(supabase: Client, table: str, rows: list[dict]) -> None:
    for i in range(0, len(rows), BATCH_SIZE):
        supabase.table(table).upsert(rows[i: i + BATCH_SIZE]).execute()


# ── Per-week doubles fetch ───────────────────────────────────────────────────

def fetch_doubles_week(supabase: Client, year: int, week: int) -> None:
    now = datetime.now(timezone.utc).isoformat()

    # Step 1: collect age_cat_rank by querying per age group
    age_cat_ranks: dict[tuple, int] = {}
    for age_cat in AGE_CATEGORIES:
        for sub in DOUBLES_EVENTS:
            records = fetch_paginated(PAIRS_URL, {
                "CategoryCode": "YOU", "SubEventCode": sub,
                "AgeCategoryCode": age_cat,
                "RankingYear": year, "RankingWeek": week,
            })
            for r in records:
                if r.get("AgeCategoryCode") == age_cat:
                    key = (str(r["PairId"]), r["SubEventCode"])
                    rank = safe_int(r.get("RankingPosition"))
                    if rank is not None:
                        age_cat_ranks[key] = rank
            time.sleep(SLEEP_REQ)

    # Step 2: fetch overall doubles (all age groups) for remaining fields
    rows = []
    for sub in DOUBLES_EVENTS:
        records = fetch_paginated(PAIRS_URL, {
            "CategoryCode": "YOU", "SubEventCode": sub,
            "RankingYear": year, "RankingWeek": week,
        })
        if not records:
            print(f"    YOU/{sub}: empty")
            continue
        print(f"    YOU/{sub}: {len(records)} records")
        for r in records:
            pair_id   = str(r["PairId"])
            sub_event = r["SubEventCode"]
            rows.append({
                "pair_id":       pair_id,
                "ittf_id1":      str(r["IttfId1"]),
                "player_name1":  r["PlayerName1"],
                "country_code1": r["CountryCode1"],
                "country_name1": r["CountryName1"],
                "ittf_id2":      str(r["IttfId1d"]),
                "player_name2":  r["PlayerName1d"],
                "country_code2": r["CountryCode1d"],
                "country_name2": r["CountryName1d"],
                "age_category":  r["AgeCategoryCode"],
                "sub_event":     sub_event,
                "ranking_year":  safe_int(r.get("RankingYear")),
                "ranking_month": safe_int(r.get("RankingMonth")),
                "ranking_week":  safe_int(r.get("RankingWeek")),
                "points":        safe_float(r.get("Points")),
                "current_rank":  safe_int(r.get("CurrentRank")),
                "previous_rank": safe_int(r.get("PreviousRank")),
                "rank_diff":     safe_int(r.get("RankingDifference")),
                "publish_date":  parse_date(r.get("PublishDate")),
                "age_cat_rank":  age_cat_ranks.get((pair_id, sub_event)),
                "fetched_at":    now,
            })
        time.sleep(SLEEP_REQ)

    if rows:
        upsert_batched(supabase, "youth_rankings_doubles", rows)
        print(f"    -> upserted {len(rows)} doubles rows")
    else:
        print("    -> no doubles data returned for this week")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--from-year", type=int, default=2024)
    parser.add_argument("--from-week", type=int, default=1)
    args = parser.parse_args()

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    print(f"Finding weeks with singles data (from {args.from_year} W{args.from_week}) ...")
    weeks = get_singles_weeks(supabase, args.from_year, args.from_week)
    print(f"  {len(weeks)} singles weeks found\n")

    to_fetch = []
    for w in weeks:
        if not doubles_week_exists(supabase, w["year"], w["week"]):
            to_fetch.append(w)

    print(f"  {len(to_fetch)} weeks missing doubles data — will fetch these\n")

    for i, w in enumerate(to_fetch, 1):
        yr, wk = w["year"], w["week"]
        print(f"[{i}/{len(to_fetch)}] Y={yr} W={wk}")
        fetch_doubles_week(supabase, yr, wk)
        time.sleep(SLEEP_WEEK)

    print("\nDone.")


if __name__ == "__main__":
    main()
