"""
fetch_youth_rankings.py
Fetches WTT youth rankings (singles MS/WS, doubles MD/WD/XD) and upserts into Supabase.

IMPORTANT (2026-07-04): the WTT youth API no longer returns the latest week when
called without a week — it returns a stale 2021 default (rank 0). So every request
now passes RankingYear + RankingWeek explicitly, and rows are accepted only when the
returned week matches the requested week. The script fetches each week from the last
week already in the DB up to the latest available week (auto-detected), which also
backfills any gap.

IMPORTANT (2026-08-10): age bands are INCLUSIVE — "Under 19" means 19 and under, so a
U17 player is ranked in the U19 list too. The API does not model it that way: it tags
each competitor with its NARROWEST band and its AgeCategoryCode filter returns only
those. We therefore write ONE ROW PER BAND a competitor is eligible for, and compute
the within-band position ourselves (see band_positions). `age_category` means "the band
this ranking is for", NOT "the competitor's own band".

Before this, Syndrela Das / Divyanshi Bhowmick — World #1 in U19 girls' doubles — had
no U19 row at all, because the pair is tagged U17.

Usage:
    pip install requests supabase
    export SUPABASE_URL=...  SUPABASE_SERVICE_KEY=...
    python scripts/fetch_youth_rankings.py            # auto: DB-latest -> current
    python scripts/fetch_youth_rankings.py --weeks 16 # force last N weeks

    # explicit range, for backfilling in chunks that fit a workflow timeout
    python scripts/fetch_youth_rankings.py --from-year 2025 --from-week 32 \
                                           --to-year 2025 --to-week 51

This script is the single owner of youth_rankings_singles / youth_rankings_doubles.
The three former backfill scripts are in scripts/_retired/ — they carried an older,
exclusive reading of the age bands and would undo the rows written here.
"""

import os
import sys
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

# Ascending, narrowest first. Age bands are INCLUSIVE — "Under 19" means 19 and under —
# so a U15 player is ranked in U15, U17 and U19 alike. The API does not model it that
# way: it tags each player/pair with its NARROWEST band only, and its AgeCategoryCode
# filter returns just those. Treating the bands as exclusive buckets is what lost
# Syndrela Das / Divyanshi Bhowmick's World #1 in U19 girls' doubles — the pair is
# tagged U17, so no U19 row was ever written.
BANDS = ["U11", "U13", "U15", "U17", "U19"]
_BAND_IX = {b: i for i, b in enumerate(BANDS)}

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

def eligible_bands(native: str) -> list:
    """Every band a competitor tagged `native` is ranked in — its own and all wider
    ones. A U13 player appears in the U13, U15, U17 and U19 lists."""
    i = _BAND_IX.get(native)
    return BANDS[i:] if i is not None else []


def band_positions(recs: list, id_field: str) -> dict:
    """{(id, sub_event, band): position within that band}

    Derived locally rather than requested, for two reasons:

    1. The API's AgeCategoryCode filter returns only competitors whose NARROWEST band
       matches, so asking it for "U17" omits the U15 and U13 players who are ranked
       there. That produced the gaps we saw in stored data — U17 WS beginning at
       position 2, U19 MS missing 3, 6, 7 and 8.
    2. For PAIRS the API's RankingPosition is merely a copy of CurrentRank
       (JIANG/YAO: CurrentRank=4, RankingPosition=4, while WTT publishes position 2),
       so there is no band position to read even when the rows are present.

    WTT's own site derives it the same way: take everyone eligible for the band, order
    by world rank, number 1..N. Confirmed against the published U17 girls' doubles
    list — eligible pairs at world ranks 1, 4, 6, 10 are shown as positions 1, 2, 3, 4.

    Input is the UNFILTERED per-sub-event rows the caller already fetched, so this
    costs no extra requests — it removes roughly 25 paginated calls per week.
    """
    by_sub = {}
    for r in recs:
        idv    = r.get(id_field)
        rank   = safe_int(r.get("CurrentRank"))
        native = r.get("AgeCategoryCode")
        if idv is None or rank is None or native not in _BAND_IX:
            continue
        by_sub.setdefault(r.get("SubEventCode"), []).append((rank, str(idv), native))

    out = {}
    for sub, rows in by_sub.items():
        rows.sort(key=lambda t: t[0])          # by world rank, best first
        for band in BANDS:
            limit, pos = _BAND_IX[band], 0
            for _rank, idv, native in rows:
                if _BAND_IX[native] <= limit:  # narrow enough to be eligible here
                    pos += 1
                    out[(idv, sub, band)] = pos
    return out


def process_week(supabase, year: int, week: int) -> None:
    now = datetime.now(timezone.utc).isoformat()
    print(f"  Week {year}/W{week}")

    # ── Singles ──
    # Fetch every sub-event first, then derive band positions from the whole set:
    # a band's ordering depends on competitors the API tags with a narrower band.
    singles = {sub: fetch_paginated(IND_URL, year, week, {"SubEventCode": sub})
               for sub in SINGLE_EVENTS}
    spos = band_positions([r for rs in singles.values() for r in rs], "IttfId")

    srows = []
    for sub, recs in singles.items():
        for r in recs:
            iid = r.get("IttfId")
            if iid is None:
                continue
            iid = str(iid)
            # One row per band this player is ranked in, not just their own.
            for band in eligible_bands(r.get("AgeCategoryCode")):
                srows.append({
                    "ittf_id": iid, "player_name": r.get("PlayerName"),
                    "country_code": r.get("CountryCode"), "country_name": r.get("CountryName"),
                    "age_category": band, "sub_event": r.get("SubEventCode"),
                    "ranking_year": safe_int(r.get("RankingYear")),
                    "ranking_month": safe_int(r.get("RankingMonth")),
                    "ranking_week": safe_int(r.get("RankingWeek")),
                    "points_ytd": safe_float(r.get("RankingPointsYTD")),
                    "current_rank": safe_int(r.get("CurrentRank")),
                    "previous_rank": safe_int(r.get("PreviousRank")),
                    "rank_diff": safe_int(r.get("RankingDifference")),
                    "publish_date": parse_date(r.get("PublishDate")),
                    "age_cat_rank": spos.get((iid, r.get("SubEventCode"), band)),
                    "fetched_at": now,
                })
    if srows:
        upsert_batched(supabase, "youth_rankings_singles", srows)

    # ── Doubles ──
    # Identical treatment. This is also the only way pairs get a real band position at
    # all: the API returns RankingPosition == CurrentRank for every pair.
    doubles = {sub: fetch_paginated(PAIRS_URL, year, week, {"SubEventCode": sub})
               for sub in DOUBLES_EVENTS}
    dpos = band_positions([r for rs in doubles.values() for r in rs], "PairId")

    drows = []
    for sub, recs in doubles.items():
        for r in recs:
            pid = r.get("PairId")
            if pid is None:
                continue
            pid = str(pid)
            for band in eligible_bands(r.get("AgeCategoryCode")):
                drows.append({
                    "pair_id": pid,
                    "ittf_id1": str(r.get("IttfId1") or ""), "player_name1": r.get("PlayerName1"),
                    "country_code1": r.get("CountryCode1"), "country_name1": r.get("CountryName1"),
                    "ittf_id2": str(r.get("IttfId1d") or ""), "player_name2": r.get("PlayerName1d"),
                    "country_code2": r.get("CountryCode1d"), "country_name2": r.get("CountryName1d"),
                    "age_category": band, "sub_event": r.get("SubEventCode"),
                    "ranking_year": safe_int(r.get("RankingYear")),
                    "ranking_month": safe_int(r.get("RankingMonth")),
                    "ranking_week": safe_int(r.get("RankingWeek")),
                    "points": safe_float(r.get("Points")),
                    "current_rank": safe_int(r.get("CurrentRank")),
                    "previous_rank": safe_int(r.get("PreviousRank")),
                    "rank_diff": safe_int(r.get("RankingDifference")),
                    "publish_date": parse_date(r.get("PublishDate")),
                    "age_cat_rank": dpos.get((pid, r.get("SubEventCode"), band)),
                    "fetched_at": now,
                })
    if drows:
        upsert_batched(supabase, "youth_rankings_doubles", drows)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weeks", type=int, default=0,
                    help="force fetch of the last N weeks (default: DB-latest -> current)")
    # Explicit bounds exist so a long backfill can be split into chunks that each fit
    # inside a workflow timeout. --weeks can only count back from the latest week, so
    # it cannot express "weeks 30-50" and re-does everything newer each time.
    ap.add_argument("--from-year", type=int, help="start year (with --from-week)")
    ap.add_argument("--from-week", type=int, help="start ISO week")
    ap.add_argument("--to-year", type=int, help="end year (with --to-week)")
    ap.add_argument("--to-week", type=int, help="end ISO week")
    args = ap.parse_args()

    if bool(args.from_year) != bool(args.from_week):
        sys.exit("--from-year and --from-week must be given together")
    if bool(args.to_year) != bool(args.to_week):
        sys.exit("--to-year and --to-week must be given together")
    if args.weeks and args.from_year:
        sys.exit("--weeks and --from-year are mutually exclusive")

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    print("Finding latest available week ...")
    latest = latest_available_week()
    if latest == (None, None):
        print("No youth ranking data returned by the API — aborting.")
        return
    print(f"  latest available: {latest[0]}/W{latest[1]}")

    # An explicit end never runs past what is actually published.
    if args.to_year:
        if date.fromisocalendar(args.to_year, args.to_week, 1) < date.fromisocalendar(*latest, 1):
            latest = (args.to_year, args.to_week)
            print(f"  capped to {latest[0]}/W{latest[1]} by --to-week")

    if args.from_year:
        start = (args.from_year, args.from_week)
    elif args.weeks > 0:
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
