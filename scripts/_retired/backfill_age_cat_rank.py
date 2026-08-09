"""
backfill_age_cat_rank.py
Patches age_cat_rank into existing youth_rankings rows by querying the
WTT API per age_category and storing RankingPosition — which matches
the rank shown on the WTT website.

Usage:
    export SUPABASE_URL=... SUPABASE_SERVICE_KEY=...
    python scripts/backfill_age_cat_rank.py                     # 2024 W1 → now
    python scripts/backfill_age_cat_rank.py --from-year 2025    # 2025 onwards
    python scripts/backfill_age_cat_rank.py --from-year 2026 --from-week 1
"""

import os
import time
import argparse
import requests
from supabase import create_client, Client

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
SLEEP_REQ  = 0.5
SLEEP_WEEK = 1.5

SINGLE_EVENTS  = ["MS", "WS"]
DOUBLES_EVENTS = ["MD", "WD", "XD"]
AGE_CATEGORIES = ["U13", "U15", "U17", "U19"]

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]


def get_publish_weeks(from_year: int, from_week: int,
                      to_year: int = 9999, to_week: int = 99) -> list[dict]:
    r = requests.get(f"{CDN}/PUBLISH_DATE.json",
                     params={"CategoryCode": "SEN", "q": 1},
                     headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    rows = r.json().get("Result", [])
    weeks = []
    for row in rows:
        yr = int(row["RankingYear"])
        wk = int(row["RankingWeek"])
        if (from_year, from_week) <= (yr, wk) <= (to_year, to_week):
            weeks.append({"year": yr, "week": wk})
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
            break
        page = r.json().get("Result", [])
        if not page:
            break
        rows.extend(page)
        start += PAGE_SIZE
        time.sleep(SLEEP_REQ)
    return rows


def safe_int(v):
    try:
        return int(v) if v not in (None, "", "null") else None
    except Exception:
        return None


def rpc_call_with_retry(supabase: Client, fn: str, updates: list, retries: int = 4) -> None:
    for attempt in range(retries):
        try:
            supabase.rpc(fn, {"updates": updates}).execute()
            return
        except Exception as e:
            if attempt < retries - 1:
                wait = 15 * (attempt + 1)
                print(f"      [supabase retry {attempt+1}/{retries-1} after {wait}s] {e}")
                time.sleep(wait)
            else:
                raise


def patch_singles_week(supabase: Client, year: int, week: int) -> int:
    all_updates = []
    for age_cat in AGE_CATEGORIES:
        for sub in SINGLE_EVENTS:
            records = fetch_paginated(IND_URL, {
                "CategoryCode": "YOU", "SubEventCode": sub,
                "AgeCategoryCode": age_cat,
                "RankingYear": year, "RankingWeek": week,
            })
            for r in records:
                if r.get("AgeCategoryCode") != age_cat:
                    continue
                rank = safe_int(r.get("RankingPosition"))
                if rank is None:
                    continue
                all_updates.append({
                    "ittf_id":      str(r["IttfId"]),
                    "sub_event":    r["SubEventCode"],
                    "age_category": age_cat,
                    "ranking_year": year,
                    "ranking_week": week,
                    "age_cat_rank": rank,
                })
            time.sleep(SLEEP_REQ)

    if all_updates:
        for i in range(0, len(all_updates), 500):
            rpc_call_with_retry(supabase, "patch_singles_age_cat_ranks", all_updates[i:i+500])
    return len(all_updates)


def patch_doubles_week(supabase: Client, year: int, week: int) -> int:
    all_updates = []
    for age_cat in AGE_CATEGORIES:
        for sub in DOUBLES_EVENTS:
            records = fetch_paginated(PAIRS_URL, {
                "CategoryCode": "YOU", "SubEventCode": sub,
                "AgeCategoryCode": age_cat,
                "RankingYear": year, "RankingWeek": week,
            })
            for r in records:
                if r.get("AgeCategoryCode") != age_cat:
                    continue
                rank = safe_int(r.get("RankingPosition"))
                if rank is None:
                    continue
                all_updates.append({
                    "pair_id":      str(r["PairId"]),
                    "sub_event":    r["SubEventCode"],
                    "age_category": age_cat,
                    "ranking_year": year,
                    "ranking_week": week,
                    "age_cat_rank": rank,
                })
            time.sleep(SLEEP_REQ)

    if all_updates:
        for i in range(0, len(all_updates), 500):
            rpc_call_with_retry(supabase, "patch_doubles_age_cat_ranks", all_updates[i:i+500])
    return len(all_updates)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--from-year", type=int, default=2024)
    parser.add_argument("--from-week", type=int, default=1)
    parser.add_argument("--to-year", type=int, default=9999)
    parser.add_argument("--to-week", type=int, default=99)
    args = parser.parse_args()

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    weeks = get_publish_weeks(args.from_year, args.from_week, args.to_year, args.to_week)
    print(f"{len(weeks)} weeks to patch (from {args.from_year} W{args.from_week})\n")

    for i, w in enumerate(weeks, 1):
        yr, wk = w["year"], w["week"]
        print(f"[{i}/{len(weeks)}] Y={yr} W={wk} ...", end=" ", flush=True)
        s = patch_singles_week(supabase, yr, wk)
        d = patch_doubles_week(supabase, yr, wk)
        print(f"singles={s} doubles={d}")
        time.sleep(SLEEP_WEEK)

    print("\nDone.")


if __name__ == "__main__":
    main()
