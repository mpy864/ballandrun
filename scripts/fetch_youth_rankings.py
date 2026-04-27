"""
fetch_youth_rankings.py
Fetches current-week WTT youth rankings and upserts into Supabase.

Singles (internalttu/Rankings/GetRankingIndividuals):
  CategoryCode=YOU, SubEventCode=MS/WS — all age groups in one call

Doubles (internalttu/Rankings/GetRankingPairs):
  CategoryCode=YOU, SubEventCode=MD/WD/XD — all age groups in one call

AgeCategoryCode in each response row tells the player's actual age group.
Rankings publish every Monday; RankingWeek is read from the response.

Usage:
    pip install requests supabase
    export SUPABASE_URL=...  SUPABASE_SERVICE_KEY=...
    python scripts/fetch_youth_rankings.py
"""

import os
import time
import requests
from datetime import datetime, timezone
from supabase import create_client

# ── Config ─────────────────────────────────────────────────────────────────
IND_URL   = "https://wttcmsapigateway-new.azure-api.net/internalttu/Rankings/GetRankingIndividuals"
PAIRS_URL = "https://wttcmsapigateway-new.azure-api.net/internalttu/Rankings/GetRankingPairs"
HEADERS = {
    "apikey":     "2bf8b222-532c-4c60-8ebe-eb6fdfebe84a",
    "secapimkey": "S_WTT_882jjh7basdj91834783mds8j2jsd81",
    "origin":     "https://www.worldtabletennis.com",
    "referer":    "https://www.worldtabletennis.com/",
    "accept":     "application/json",
    "user-agent": "Mozilla/5.0",
}
TIMEOUT    = 30
BATCH_SIZE = 200
PAGE_SIZE  = 500

SINGLE_EVENTS  = ["MS", "WS"]
DOUBLES_EVENTS = ["MD", "WD", "XD"]

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

# ── Helpers ─────────────────────────────────────────────────────────────────

def fetch_paginated(url: str, params: dict) -> list:
    rows, start = [], 1
    while True:
        r = requests.get(url, params={**params, "StartRank": start,
                                       "EndRank": start + PAGE_SIZE - 1, "q": 1},
                         headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        page = r.json().get("Result", [])
        if not page:
            break
        rows.extend(page)
        start += PAGE_SIZE
        time.sleep(0.5)
    return rows


def week_exists(supabase, year: int, week: int, sub_event: str) -> bool:
    res = (supabase.table("youth_rankings_singles")
           .select("ittf_id", count="exact")
           .eq("ranking_year", year).eq("ranking_week", week)
           .eq("sub_event", sub_event).limit(1).execute())
    return (res.count or 0) > 0


def parse_date(s) -> str | None:
    if not s:
        return None
    try:
        return datetime.strptime(s, "%m/%d/%Y %H:%M:%S").date().isoformat()
    except Exception:
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


def upsert_batched(supabase, table: str, rows: list[dict]) -> None:
    for i in range(0, len(rows), BATCH_SIZE):
        supabase.table(table).upsert(rows[i : i + BATCH_SIZE]).execute()
    print(f"  -> upserted {len(rows)} rows into {table}")


# ── Singles ─────────────────────────────────────────────────────────────────

def process_singles(supabase) -> None:
    print("Fetching youth singles (MS + WS, all age groups) ...")
    now = datetime.now(timezone.utc).isoformat()
    rows = []

    for sub in SINGLE_EVENTS:
        records = fetch_paginated(IND_URL, {"CategoryCode": "YOU", "SubEventCode": sub})
        if not records:
            print(f"  YOU/{sub}: no data")
            continue
        yr  = safe_int(records[0].get("RankingYear"))
        wk  = safe_int(records[0].get("RankingWeek"))
        if week_exists(supabase, yr, wk, sub):
            print(f"  YOU/{sub}: week {yr}/W{wk} already in DB — skipping")
            continue
        print(f"  YOU/{sub}: {len(records)} records  (Y={yr} W={wk})")
        for r in records:
            rows.append({
                "ittf_id":       str(r["IttfId"]),
                "player_name":   r["PlayerName"],
                "country_code":  r["CountryCode"],
                "country_name":  r["CountryName"],
                "age_category":  r["AgeCategoryCode"],
                "sub_event":     r["SubEventCode"],
                "ranking_year":  safe_int(r.get("RankingYear")),
                "ranking_month": safe_int(r.get("RankingMonth")),
                "ranking_week":  safe_int(r.get("RankingWeek")),
                "points_ytd":    safe_float(r.get("RankingPointsYTD")),
                "current_rank":  safe_int(r.get("CurrentRank")),
                "previous_rank": safe_int(r.get("PreviousRank")),
                "rank_diff":     safe_int(r.get("RankingDifference")),
                "publish_date":  parse_date(r.get("PublishDate")),
                "fetched_at":    now,
            })
        time.sleep(1)

    if rows:
        upsert_batched(supabase, "youth_rankings_singles", rows)


# ── Doubles ─────────────────────────────────────────────────────────────────

def process_doubles(supabase) -> None:
    print("Fetching youth doubles (MD + WD + XD, all age groups) ...")
    now = datetime.now(timezone.utc).isoformat()
    rows = []

    for sub in DOUBLES_EVENTS:
        records = fetch_paginated(PAIRS_URL, {"CategoryCode": "YOU", "SubEventCode": sub})
        if not records:
            print(f"  YOU/{sub}: no data")
            continue
        print(f"  YOU/{sub}: {len(records)} records")
        for r in records:
            rows.append({
                "pair_id":       str(r["PairId"]),
                "ittf_id1":      str(r["IttfId1"]),
                "player_name1":  r["PlayerName1"],
                "country_code1": r["CountryCode1"],
                "country_name1": r["CountryName1"],
                "ittf_id2":      str(r["IttfId1d"]),
                "player_name2":  r["PlayerName1d"],
                "country_code2": r["CountryCode1d"],
                "country_name2": r["CountryName1d"],
                "age_category":  r["AgeCategoryCode"],
                "sub_event":     r["SubEventCode"],
                "ranking_year":  safe_int(r.get("RankingYear")),
                "ranking_month": safe_int(r.get("RankingMonth")),
                "ranking_week":  safe_int(r.get("RankingWeek")),
                "points":        safe_float(r.get("Points")),
                "current_rank":  safe_int(r.get("CurrentRank")),
                "previous_rank": safe_int(r.get("PreviousRank")),
                "rank_diff":     safe_int(r.get("RankingDifference")),
                "publish_date":  parse_date(r.get("PublishDate")),
                "fetched_at":    now,
            })
        time.sleep(1)

    if rows:
        upsert_batched(supabase, "youth_rankings_doubles", rows)


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    process_singles(supabase)
    process_doubles(supabase)
    print("Done.")



if __name__ == "__main__":
    main()
