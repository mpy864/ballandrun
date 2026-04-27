"""
fetch_youth_rankings.py
Pulls the latest WTT/ITTF youth rankings from the CDN static JSON blobs
and upserts them into Supabase.

Singles:  YOU_SINGLES.json  — AgeCategoryCode: U13/U15/U17/U19
                             — SubEventCode:    MS (Boys), WS (Girls),
                                               MDI (Boys doubles-individual),
                                               WDI (Girls doubles-individual),
                                               XDI (Mixed doubles-individual)

Doubles:  YOU_DOUBLES.json  — AgeCategoryCode: U13/U15/U17/U19
                             — SubEventCode:    MD (Boys), WD (Girls), XD (Mixed)

Usage:
    pip install requests supabase
    export SUPABASE_URL=...  SUPABASE_SERVICE_KEY=...
    python scripts/fetch_youth_rankings.py
"""

import os
import sys
import json
import requests
from datetime import datetime, timezone
from supabase import create_client

# ── Config ─────────────────────────────────────────────────────────────────
BASE_URL = "https://wtt-web-frontdoor-withoutcache-cqakg0andqf5hchn.a01.azurefd.net/ranking"
HEADERS = {
    "origin":  "https://www.worldtabletennis.com",
    "referer": "https://www.worldtabletennis.com/",
    "accept":  "application/json",
    "user-agent": "Mozilla/5.0",
}
TIMEOUT = 30
BATCH_SIZE = 200

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

# ── Helpers ─────────────────────────────────────────────────────────────────

def fetch_json(filename: str) -> list:
    url = f"{BASE_URL}/{filename}?q=1"
    resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    return data if isinstance(data, list) else data.get("Result", [])


def parse_date(s: str | None) -> str | None:
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
        batch = rows[i : i + BATCH_SIZE]
        supabase.table(table).upsert(batch).execute()
    print(f"  -> upserted {len(rows)} rows into {table}")


# ── Singles ─────────────────────────────────────────────────────────────────

def process_singles(supabase) -> None:
    print("Fetching YOU_SINGLES.json ...")
    records = fetch_json("YOU_SINGLES.json")
    print(f"  {len(records)} records received")

    now = datetime.now(timezone.utc).isoformat()
    rows = []
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

    upsert_batched(supabase, "youth_rankings_singles", rows)


# ── Doubles ─────────────────────────────────────────────────────────────────

def process_doubles(supabase) -> None:
    print("Fetching YOU_DOUBLES.json ...")
    records = fetch_json("YOU_DOUBLES.json")
    print(f"  {len(records)} records received")

    now = datetime.now(timezone.utc).isoformat()
    rows = []
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

    upsert_batched(supabase, "youth_rankings_doubles", rows)


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    process_singles(supabase)
    process_doubles(supabase)
    print("Done.")


if __name__ == "__main__":
    main()
