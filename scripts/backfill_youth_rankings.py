"""
backfill_youth_rankings.py
Backfills historical WTT youth rankings using the internalttu API.

Fetches all published weeks from PUBLISH_DATE.json, then for each week
that is not yet in the DB, fetches YOU singles (MS/WS) and doubles
(MD/WD/XD) and upserts into Supabase.

Usage:
    pip install requests supabase
    export SUPABASE_URL=... SUPABASE_SERVICE_KEY=...
    python scripts/backfill_youth_rankings.py                   # 2024 W1 → now
    python scripts/backfill_youth_rankings.py --from-year 2025  # 2025 onwards
    python scripts/backfill_youth_rankings.py --from-year 2025 --from-week 26
"""

import os
import sys
import time
import argparse
import requests
from datetime import datetime, timezone
from supabase import create_client, Client

# ── Config ─────────────────────────────────────────────────────────────────
CDN        = "https://wtt-web-frontdoor-withoutcache-cqakg0andqf5hchn.a01.azurefd.net/ranking"
IND_URL    = "https://wttcmsapigateway-new.azure-api.net/internalttu/Rankings/GetRankingIndividuals"
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
SLEEP_REQ  = 0.6   # between paginated requests
SLEEP_WEEK = 2.0   # between weeks

SINGLE_EVENTS  = ["MS", "WS"]
DOUBLES_EVENTS = ["MD", "WD", "XD"]
AGE_CATEGORIES = ["U13", "U15", "U17", "U19"]

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

# ── Helpers ─────────────────────────────────────────────────────────────────

def get_publish_weeks(from_year: int, from_week: int) -> list[dict]:
    """Fetch all published weeks from CDN, filter to requested range."""
    r = requests.get(f"{CDN}/PUBLISH_DATE.json",
                     params={"CategoryCode": "SEN", "q": 1},
                     headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    rows = r.json().get("Result", [])
    weeks = []
    for row in rows:
        yr = int(row["RankingYear"])
        wk = int(row["RankingWeek"])
        if (yr, wk) >= (from_year, from_week):
            weeks.append({"year": yr, "week": wk, "date": row["RankingStatusDate"]})
    weeks.sort(key=lambda x: (x["year"], x["week"]))
    return weeks


def fetch_paginated(url: str, params: dict) -> list:
    rows, start = [], 1
    while True:
        for attempt in range(4):
            try:
                r = requests.get(url, params={**params, "StartRank": start,
                                               "EndRank": start + PAGE_SIZE - 1, "q": 1},
                                 headers=HEADERS, timeout=TIMEOUT)
                r.raise_for_status()
                break
            except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
                wait = 10 * (attempt + 1)
                print(f"      [retry {attempt+1}/3 after {wait}s] {e}")
                time.sleep(wait)
        else:
            print(f"      [gave up after 3 retries — skipping page]")
            break
        page = r.json().get("Result", [])
        if not page:
            break
        rows.extend(page)
        start += PAGE_SIZE
        time.sleep(SLEEP_REQ)
    return rows


def week_exists(supabase: Client, year: int, week: int) -> bool:
    res = (supabase.table("youth_rankings_singles")
           .select("ittf_id", count="exact")
           .eq("ranking_year", year).eq("ranking_week", week)
           .eq("sub_event", "MS").limit(1).execute())
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
        supabase.table(table).upsert(rows[i : i + BATCH_SIZE]).execute()


# ── Per-week fetch ───────────────────────────────────────────────────────────

def fetch_week(supabase: Client, year: int, week: int, publish_date: str) -> None:
    now = datetime.now(timezone.utc).isoformat()

    # ── Step 1: collect age_cat_rank per player from per-age-category queries ─
    # When querying with AgeCategoryCode=X, the API returns RankingPosition
    # which matches the rank shown on WTT website for that age category.
    # We record it keyed by (ittf_id, sub_event) for the player's own age category.
    singles_age_cat_rank: dict[tuple, int] = {}
    doubles_age_cat_rank: dict[tuple, int] = {}

    for age_cat in AGE_CATEGORIES:
        for sub in SINGLE_EVENTS:
            records = fetch_paginated(IND_URL, {
                "CategoryCode": "YOU", "SubEventCode": sub,
                "AgeCategoryCode": age_cat,
                "RankingYear": year, "RankingWeek": week,
            })
            for r in records:
                if r.get("AgeCategoryCode") == age_cat:
                    key = (str(r["IttfId"]), r["SubEventCode"])
                    rank = safe_int(r.get("RankingPosition"))
                    if rank is not None:
                        singles_age_cat_rank[key] = rank
            time.sleep(SLEEP_REQ)

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
                        doubles_age_cat_rank[key] = rank
            time.sleep(SLEEP_REQ)

    # ── Step 2: fetch overall data (no age filter) for all other fields ────────
    singles_rows, doubles_rows = [], []

    for sub in SINGLE_EVENTS:
        records = fetch_paginated(IND_URL, {
            "CategoryCode": "YOU", "SubEventCode": sub,
            "RankingYear": year, "RankingWeek": week,
        })
        if not records:
            print(f"    YOU/{sub}: empty")
            continue
        print(f"    YOU/{sub}: {len(records)} records")
        for r in records:
            ittf_id = str(r["IttfId"])
            sub_event = r["SubEventCode"]
            singles_rows.append({
                "ittf_id":       ittf_id,
                "player_name":   r["PlayerName"],
                "country_code":  r["CountryCode"],
                "country_name":  r["CountryName"],
                "age_category":  r["AgeCategoryCode"],
                "sub_event":     sub_event,
                "ranking_year":  safe_int(r.get("RankingYear")),
                "ranking_month": safe_int(r.get("RankingMonth")),
                "ranking_week":  safe_int(r.get("RankingWeek")),
                "points_ytd":    safe_float(r.get("RankingPointsYTD")),
                "current_rank":  safe_int(r.get("CurrentRank")),
                "previous_rank": safe_int(r.get("PreviousRank")),
                "rank_diff":     safe_int(r.get("RankingDifference")),
                "publish_date":  parse_date(r.get("PublishDate")),
                "age_cat_rank":  singles_age_cat_rank.get((ittf_id, sub_event)),
                "fetched_at":    now,
            })

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
            pair_id = str(r["PairId"])
            sub_event = r["SubEventCode"]
            doubles_rows.append({
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
                "age_cat_rank":  doubles_age_cat_rank.get((pair_id, sub_event)),
                "fetched_at":    now,
            })

    if singles_rows:
        upsert_batched(supabase, "youth_rankings_singles", singles_rows)
        print(f"    -> upserted {len(singles_rows)} singles rows")
    if doubles_rows:
        upsert_batched(supabase, "youth_rankings_doubles", doubles_rows)
        print(f"    -> upserted {len(doubles_rows)} doubles rows")
    if not singles_rows and not doubles_rows:
        print(f"    -> no data returned for this week")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--from-year", type=int, default=2024)
    parser.add_argument("--from-week", type=int, default=1)
    args = parser.parse_args()

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    print(f"Fetching published weeks from CDN (from {args.from_year} W{args.from_week}) ...")
    weeks = get_publish_weeks(args.from_year, args.from_week)
    print(f"  {len(weeks)} weeks to process\n")

    for i, w in enumerate(weeks, 1):
        yr, wk, dt = w["year"], w["week"], w["date"]
        print(f"[{i}/{len(weeks)}] Y={yr} W={wk}  ({dt})")

        if week_exists(supabase, yr, wk):
            print(f"  already in DB — skipping")
            continue

        fetch_week(supabase, yr, wk, dt)
        time.sleep(SLEEP_WEEK)

    print("\nBackfill complete.")


if __name__ == "__main__":
    main()
