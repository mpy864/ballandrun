"""
fetch_youth_rankings.py
Fetches WTT youth rankings (singles MS/WS, doubles MD/WD/XD) and upserts into Supabase.

IMPORTANT (2026-07-04): the WTT youth API no longer returns the latest week when
called without a week — it returns a stale 2021 default (rank 0). So every request
now passes RankingYear + RankingWeek explicitly, and rows are accepted only when the
returned week matches the requested week. The script fetches each week from the last
week already in the DB up to the latest available week (auto-detected), which also
backfills any gap.

Usage:
    pip install requests supabase
    export SUPABASE_URL=...  SUPABASE_SERVICE_KEY=...
    python scripts/fetch_youth_rankings.py            # auto: DB-latest -> current
    python scripts/fetch_youth_rankings.py --weeks 16 # force last N weeks
"""

import os
import time
import argparse
import requests
from datetime import date, timedelta, datetime, timezone
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
AGE_CATEGORIES = ["U13", "U15", "U17", "U19"]
MAX_LOOKBACK_WEEKS = 8   # how far back to search for the latest published week

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]


# ── Small helpers ─────────────────────────────────────────────────────────────

def safe_int(v):
    try:
        return int(v) if v not in (None, "", "null") else None
    except Exception:
        return None


def safe_float(v):
    try:
        return float(v) if v not in (None, "", "null") else None
    except Exception:
        return None


def parse_date(s):
    if not s:
        return None
    try:
        return datetime.strptime(s, "%m/%d/%Y %H:%M:%S").date().isoformat()
    except Exception:
        return None


def fetch_paginated(url: str, year: int, week: int, extra: dict) -> list:
    """Fetch all pages for a specific week. Only rows whose RankingYear/RankingWeek
    match the requested week are returned (guards against the stale 2021 default)."""
    rows, start = [], 1
    while True:
        params = {"CategoryCode": "YOU", "RankingYear": year, "RankingWeek": week,
                  "StartRank": start, "EndRank": start + PAGE_SIZE - 1, "q": 1, **extra}
        for attempt in range(4):
            try:
                r = requests.get(url, params=params, headers=HEADERS, timeout=TIMEOUT)
                r.raise_for_status()
                break
            except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
                wait = 8 * (attempt + 1)
                print(f"      [retry {attempt+1}/3 after {wait}s] {e}")
                time.sleep(wait)
        else:
            print("      [gave up after retries — skipping page]")
            break
        page = r.json().get("Result", [])
        # keep only rows for the requested week
        page = [x for x in page
                if str(x.get("RankingYear")) == str(year) and str(x.get("RankingWeek")) == str(week)]
        if not page:
            break
        rows.extend(page)
        start += PAGE_SIZE
        time.sleep(0.4)
    return rows


_PK = {
    "youth_rankings_singles": ["ittf_id", "age_category", "sub_event", "ranking_year", "ranking_week"],
    "youth_rankings_doubles": ["pair_id", "age_category", "sub_event", "ranking_year", "ranking_week"],
}

def upsert_batched(supabase, table: str, rows: list) -> None:
    keys = _PK.get(table)
    if keys:  # dedupe within payload → avoids "cannot affect row a second time"
        seen = {}
        for r in rows:
            seen[tuple(r.get(k) for k in keys)] = r
        rows = list(seen.values())
    ok = 0
    for i in range(0, len(rows), BATCH_SIZE):
        chunk = rows[i: i + BATCH_SIZE]
        try:
            q = supabase.table(table).upsert(chunk, on_conflict=",".join(keys)) if keys \
                else supabase.table(table).upsert(chunk)
            q.execute()
            ok += len(chunk)
        except Exception as e:
            print(f"    [!] upsert error into {table} (batch {i//BATCH_SIZE+1}): {e}")
    print(f"    -> upserted {ok}/{len(rows)} rows into {table}")


# ── Week planning ─────────────────────────────────────────────────────────────

def db_latest_week(supabase, table: str):
    res = (supabase.table(table)
           .select("ranking_year, ranking_week")
           .order("ranking_year", desc=True).order("ranking_week", desc=True)
           .limit(1).execute())
    if res.data:
        return safe_int(res.data[0]["ranking_year"]), safe_int(res.data[0]["ranking_week"])
    return None, None


def latest_available_week():
    """Walk back from the current ISO week until a week returns real data."""
    y, w, _ = date.today().isocalendar()
    for _ in range(MAX_LOOKBACK_WEEKS):
        probe = fetch_paginated(IND_URL, y, w, {"SubEventCode": "MS"})
        if probe:
            return y, w
        d = date.fromisocalendar(y, w, 1) - timedelta(days=7)
        y, w, _ = d.isocalendar()
    return None, None


def weeks_between(start_yw, end_yw):
    """Inclusive list of (year, week) from start to end, stepping one ISO week."""
    weeks = []
    d = date.fromisocalendar(start_yw[0], start_yw[1], 1)
    end = date.fromisocalendar(end_yw[0], end_yw[1], 1)
    while d <= end:
        y, w, _ = d.isocalendar()
        weeks.append((y, w))
        d += timedelta(days=7)
    return weeks


# ── Per-week fetch ────────────────────────────────────────────────────────────

def age_cat_ranks(url: str, subs: list, year: int, week: int, id_field: str) -> dict:
    """Within-age-category rank (RankingPosition) for a given week."""
    out = {}
    for age_cat in AGE_CATEGORIES:
        for sub in subs:
            recs = fetch_paginated(url, year, week, {"SubEventCode": sub, "AgeCategoryCode": age_cat})
            for r in recs:
                if r.get("AgeCategoryCode") == age_cat:
                    rk = safe_int(r.get("RankingPosition"))
                    idv = r.get(id_field)
                    if rk is not None and idv is not None:
                        out[(str(idv), r.get("SubEventCode"))] = rk
    return out


def process_week(supabase, year: int, week: int) -> None:
    now = datetime.now(timezone.utc).isoformat()
    print(f"  Week {year}/W{week}")

    # ── Singles ──
    acr = age_cat_ranks(IND_URL, SINGLE_EVENTS, year, week, "IttfId")
    srows = []
    for sub in SINGLE_EVENTS:
        recs = fetch_paginated(IND_URL, year, week, {"SubEventCode": sub})
        for r in recs:
            iid = r.get("IttfId")
            if iid is None:
                continue
            iid = str(iid)
            srows.append({
                "ittf_id": iid, "player_name": r.get("PlayerName"),
                "country_code": r.get("CountryCode"), "country_name": r.get("CountryName"),
                "age_category": r.get("AgeCategoryCode"), "sub_event": r.get("SubEventCode"),
                "ranking_year": safe_int(r.get("RankingYear")),
                "ranking_month": safe_int(r.get("RankingMonth")),
                "ranking_week": safe_int(r.get("RankingWeek")),
                "points_ytd": safe_float(r.get("RankingPointsYTD")),
                "current_rank": safe_int(r.get("CurrentRank")),
                "previous_rank": safe_int(r.get("PreviousRank")),
                "rank_diff": safe_int(r.get("RankingDifference")),
                "publish_date": parse_date(r.get("PublishDate")),
                "age_cat_rank": acr.get((iid, r.get("SubEventCode"))),
                "fetched_at": now,
            })
    if srows:
        upsert_batched(supabase, "youth_rankings_singles", srows)

    # ── Doubles ──
    acrd = age_cat_ranks(PAIRS_URL, DOUBLES_EVENTS, year, week, "PairId")
    drows = []
    for sub in DOUBLES_EVENTS:
        recs = fetch_paginated(PAIRS_URL, year, week, {"SubEventCode": sub})
        for r in recs:
            pid = r.get("PairId")
            if pid is None:
                continue
            pid = str(pid)
            drows.append({
                "pair_id": pid,
                "ittf_id1": str(r.get("IttfId1") or ""), "player_name1": r.get("PlayerName1"),
                "country_code1": r.get("CountryCode1"), "country_name1": r.get("CountryName1"),
                "ittf_id2": str(r.get("IttfId1d") or ""), "player_name2": r.get("PlayerName1d"),
                "country_code2": r.get("CountryCode1d"), "country_name2": r.get("CountryName1d"),
                "age_category": r.get("AgeCategoryCode"), "sub_event": r.get("SubEventCode"),
                "ranking_year": safe_int(r.get("RankingYear")),
                "ranking_month": safe_int(r.get("RankingMonth")),
                "ranking_week": safe_int(r.get("RankingWeek")),
                "points": safe_float(r.get("Points")),
                "current_rank": safe_int(r.get("CurrentRank")),
                "previous_rank": safe_int(r.get("PreviousRank")),
                "rank_diff": safe_int(r.get("RankingDifference")),
                "publish_date": parse_date(r.get("PublishDate")),
                "age_cat_rank": acrd.get((pid, r.get("SubEventCode"))),
                "fetched_at": now,
            })
    if drows:
        upsert_batched(supabase, "youth_rankings_doubles", drows)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weeks", type=int, default=0,
                    help="force fetch of the last N weeks (default: DB-latest -> current)")
    args = ap.parse_args()

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    print("Finding latest available week ...")
    latest = latest_available_week()
    if latest == (None, None):
        print("No youth ranking data returned by the API — aborting.")
        return
    print(f"  latest available: {latest[0]}/W{latest[1]}")

    if args.weeks > 0:
        start_d = date.fromisocalendar(latest[0], latest[1], 1) - timedelta(days=7 * (args.weeks - 1))
        start = start_d.isocalendar()[:2]
    else:
        db_y, db_w = db_latest_week(supabase, "youth_rankings_singles")
        if db_y is None:
            start = latest
        else:
            start_d = date.fromisocalendar(db_y, db_w, 1) + timedelta(days=7)  # week after DB latest
            start = start_d.isocalendar()[:2]

    if date.fromisocalendar(*start, 1) > date.fromisocalendar(*latest, 1):
        print("DB already current — nothing to fetch.")
        return

    plan = weeks_between(start, latest)
    print(f"  fetching {len(plan)} week(s): {plan[0]} .. {plan[-1]}\n")
    for (y, w) in plan:
        try:
            process_week(supabase, y, w)
        except Exception as e:
            print(f"  [!] week {y}/W{w} failed: {e}")
        time.sleep(1)

    print("Done.")


if __name__ == "__main__":
    main()
