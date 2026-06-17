"""
backfill_senior_doubles.py
Backfills historical senior doubles rankings (MD / WD / XD) from the WTT API
into the rankings_doubles_teams table.

Usage:
    export SUPABASE_URL=...  SUPABASE_SERVICE_KEY=...
    python scripts/backfill_senior_doubles.py
    python scripts/backfill_senior_doubles.py --from-year 2023
    python scripts/backfill_senior_doubles.py --from-year 2024 --from-week 10
"""

import os
import sys
import time
import argparse
import requests
from datetime import datetime, timezone
from supabase import create_client, Client

# ── Config ──────────────────────────────────────────────────────────────────
CDN       = "https://wtt-web-frontdoor-withoutcache-cqakg0andqf5hchn.a01.azurefd.net/ranking"
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
PAGE_SIZE  = 500
BATCH_SIZE = 200
SLEEP_REQ  = 0.8
SLEEP_WEEK = 2.5

DOUBLES_EVENTS = ["MD", "WD", "XD"]
GENDER_MAP = {"MD": "M", "WD": "W", "XD": "X"}

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]


# ── Helpers ──────────────────────────────────────────────────────────────────

def fetch_paginated(params: dict) -> list:
    rows, start = [], 1
    while True:
        for attempt in range(4):
            try:
                r = requests.get(
                    PAIRS_URL,
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


def get_published_weeks(from_year: int, from_week: int) -> list[dict]:
    r = requests.get(
        f"{CDN}/PUBLISH_DATE.json",
        params={"CategoryCode": "SEN", "q": 1},
        headers=HEADERS, timeout=TIMEOUT,
    )
    r.raise_for_status()
    rows = r.json().get("Result", [])
    weeks = []
    for row in rows:
        yr = int(row["RankingYear"])
        wk = int(row["RankingWeek"])
        if (yr, wk) >= (from_year, from_week):
            weeks.append({"year": yr, "week": wk, "publish_date": row.get("RankingStatusDate", "")})
    weeks.sort(key=lambda x: (x["year"], x["week"]))
    return weeks


def week_exists(supabase: Client, year: int, week: int) -> bool:
    res = (supabase.table("rankings_doubles_teams")
           .select("id", count="exact")
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


def upsert_batched(supabase: Client, rows: list[dict]) -> None:
    for i in range(0, len(rows), BATCH_SIZE):
        supabase.table("rankings_doubles_teams").upsert(
            rows[i: i + BATCH_SIZE],
            on_conflict="pair_id,ranking_year,ranking_week",
        ).execute()


# ── Per-week fetch ────────────────────────────────────────────────────────────

def fetch_senior_doubles_week(supabase: Client, year: int, week: int) -> None:
    rows = []
    for sub in DOUBLES_EVENTS:
        records = fetch_paginated({
            "CategoryCode": "SEN",
            "SubEventCode": sub,
            "RankingYear": year,
            "RankingWeek": week,
        })
        if not records:
            print(f"    SEN/{sub}: empty")
            continue
        print(f"    SEN/{sub}: {len(records)} pairs")

        for r in records:
            p1_name = r.get("PlayerName1", "")
            p2_name = r.get("PlayerName1d", "")
            rows.append({
                "pair_id":       str(r["PairId"]),
                "p1_ittf_id":    safe_int(r.get("IttfId1")),
                "p2_ittf_id":    safe_int(r.get("IttfId1d")),
                "team_name":     f"{p1_name} / {p2_name}",
                "category":      sub,
                "gender":        GENDER_MAP[sub],
                "current_rank":  safe_int(r.get("CurrentRank")),
                "previous_rank": safe_int(r.get("PreviousRank")),
                "points":        safe_int(r.get("Points")),
                "ranking_year":  safe_int(r.get("RankingYear")),
                "ranking_week":  safe_int(r.get("RankingWeek")),
                "publish_date":  parse_date(r.get("PublishDate")),
            })
        time.sleep(SLEEP_REQ)

    if rows:
        upsert_batched(supabase, rows)
        print(f"    -> upserted {len(rows)} rows")
    else:
        print("    -> no data returned for this week")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--from-year", type=int, default=2022)
    parser.add_argument("--from-week", type=int, default=1)
    args = parser.parse_args()

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    print(f"Fetching published weeks (from {args.from_year} W{args.from_week}) ...")
    weeks = get_published_weeks(args.from_year, args.from_week)
    print(f"  {len(weeks)} published weeks found\n")

    to_fetch = [w for w in weeks if not week_exists(supabase, w["year"], w["week"])]
    print(f"  {len(to_fetch)} weeks missing — will fetch\n")

    for i, w in enumerate(to_fetch, 1):
        yr, wk = w["year"], w["week"]
        print(f"[{i}/{len(to_fetch)}] Y={yr} W={wk}")
        fetch_senior_doubles_week(supabase, yr, wk)
        time.sleep(SLEEP_WEEK)

    print("\nDone.")


if __name__ == "__main__":
    main()
