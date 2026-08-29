"""
fetch_rankings.py
Fetches WTT senior + youth rankings for the most recent Tuesday.
Runs daily via GitHub Actions — skips if week already in DB.
"""

import os
import sys
import time
import requests
from datetime import date, timedelta
from supabase import create_client, Client

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tg_common import reported                                   # noqa: E402

FEED = "wtt-rankings"

# ─── Config ───────────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

RANKINGS_URL = "https://wttcmsapigateway-new.azure-api.net/ttu/Rankings/GetRankingIndividuals"
HEADERS = {
    "apikey":      "2bf8b222-532c-4c60-8ebe-eb6fdfebe84a",
    "secapimkey":  "S_WTT_882jjh7basdj91834783mds8j2jsd81",
    "origin":      "https://www.worldtabletennis.com",
    "referer":     "https://www.worldtabletennis.com/",
    "accept":      "application/json",
}

# (CategoryCode, SubEventCode, gender)
DISCIPLINES = [
    ("SEN", "MS", "M"),
    ("SEN", "WS", "W"),
    ("JUN", "MS", "M"),
    ("JUN", "WS", "W"),
]

MAX_RANK   = 1000
PAGE_SIZE  = 100
SLEEP_PAGE = 1.2
SLEEP_DISC = 3.0

# ─── Helpers ──────────────────────────────────────────────────────────────────

def most_recent_tuesday() -> date:
    today = date.today()
    days_since_tuesday = (today.weekday() - 1) % 7
    return today - timedelta(days=days_since_tuesday)

def date_to_wtt_week(d: date) -> tuple[int, int]:
    iso = d.isocalendar()
    return iso.year, iso.week

def week_exists(supabase: Client, year: int, week: int, gender: str) -> bool:
    result = (
        supabase.table("rankings_singles_normalized")
        .select("player_id", count="exact")
        .eq("ranking_year", year)
        .eq("ranking_week", week)
        .eq("gender", gender)
        .limit(1)
        .execute()
    )
    return (result.count or 0) > 0

def fetch_discipline(year: int, week: int,
                     category: str, sub_event: str) -> list[dict]:
    rows = []
    for start in range(1, MAX_RANK + 1, PAGE_SIZE):
        params = {
            "CategoryCode": category,
            "SubEventCode": sub_event,
            "RankingYear":  year,
            "RankingWeek":  week,
            "StartRank":    start,
            "EndRank":      start + PAGE_SIZE - 1,
            "q":            1,
        }
        # Retry up to 3 times on timeout
        for attempt in range(3):
            try:
                resp = requests.get(RANKINGS_URL, params=params,
                                    headers=HEADERS, timeout=45)
                break
            except requests.exceptions.ReadTimeout:
                print(f"  [!] Timeout on attempt {attempt+1} for {sub_event} "
                      f"ranks {start}-{start+PAGE_SIZE-1}")
                if attempt == 2:
                    print(f"  [!] Giving up on this page.")
                    resp = None
                time.sleep(5)

        if resp is None:
            continue
        if resp.status_code != 200:
            print(f"  [!] HTTP {resp.status_code} for {sub_event} "
                  f"ranks {start}-{start+PAGE_SIZE-1}")
            break
        players = resp.json().get("Result", [])
        if not players:
            break
        rows.extend(players)
        time.sleep(SLEEP_PAGE)
    return rows

def transform_row(raw: dict, year: int, week: int,
                  ranking_date: str, gender: str) -> dict:
    return {
        "player_id":     int(raw["IttfId"]),
        "gender":        gender,
        "rank":          int(raw.get("RankingPosition") or 0),
        "points":        int(raw.get("RankingPointsYTD") or 0),
        "previous_rank": int(raw["PreviousRank"]) if raw.get("PreviousRank") else None,
        "rank_change":   int(raw.get("RankingDifference") or 0),
        "ranking_date":  ranking_date,
        "ranking_year":  year,
        "ranking_week":  week,
    }

# ─── Main ─────────────────────────────────────────────────────────────────────

def main(run):
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

    tuesday      = most_recent_tuesday()
    year, week   = date_to_wtt_week(tuesday)
    ranking_date = tuesday.isoformat()

    print(f"[Rankings] Target: {ranking_date} (Year {year}, Week {week})")

    total_upserted = 0

    for category, sub_event, gender in DISCIPLINES:
        print(f"\n  [{sub_event}] Checking DB...")

        if week_exists(supabase, year, week, gender):
            print(f"  [{sub_event}] Already exists — skipping.")
            continue

        print(f"  [{sub_event}] Fetching from WTT API...")
        raw_rows = fetch_discipline(year, week, category, sub_event)
        print(f"  [{sub_event}] Got {len(raw_rows)} players.")

        if not raw_rows:
            print(f"  [{sub_event}] No data — skipping.")
            continue

        rows = [transform_row(r, year, week, ranking_date, gender)
                for r in raw_rows]

        for i in range(0, len(rows), 500):
            supabase.table("rankings_singles_normalized") \
                .upsert(rows[i:i+500]) \
                .execute()

        total_upserted += len(rows)
        print(f"  [{sub_event}] Upserted {len(rows)} rows.")
        time.sleep(SLEEP_DISC)

    print(f"\n[Rankings] Done. Total rows upserted: {total_upserted}")
    run["detail"] = f"{total_upserted} rows for {year}/W{week}"
    if total_upserted == 0:
        run["status"] = "noop"   # every discipline already had this week

if __name__ == "__main__":
    with reported(FEED) as run:
        main(run)
