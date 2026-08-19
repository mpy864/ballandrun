#!/usr/bin/env python3
"""
check_data_quality.py — asserts properties of the DATA, not of the job.

Job-level monitoring was never going to catch what happened in July 2026: the youth
ingest ran every morning, printed "DB already current — nothing to fetch", exited 0 and
went green, while the newest youth ranking quietly aged to 26 days. `heartbeat.py` said
"all healthy" the whole time, because it only watches the six Telegram feeds.

The sentence that was needed is "the newest youth ranking is 26 days old". So every
check here is a statement about rows in the database, and a failure exits non-zero so
the workflow goes red.

Each check exists because it would have caught a real defect:

  freshness           the 26-day youth outage, on day 8
  band density        age bands read as exclusive, losing everyone competing up
  doubles independence  the API returns RankingPosition == CurrentRank for pairs
  coverage            U11 missing from the collected bands, since January 2024
  enumeration drift   unknown bands / sub-events appearing without anyone noticing

Usage:
    python scripts/check_data_quality.py
    python scripts/check_data_quality.py --dry-run    # print only, always exit 0
"""

import argparse
import os
import sys
from datetime import date, datetime, timezone

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tg_common import get_db, record_health                      # noqa: E402
# Imported, never re-declared: a second copy of these lists is exactly how U11 came to
# be missing from one of them for nineteen months.
from fetch_youth_rankings import (BANDS, SINGLE_EVENTS, DOUBLES_EVENTS,   # noqa: E402
                                  latest_available_week, HEADERS as WTT_HEADERS)

# Senior publish list. Served with Content-Encoding: br regardless of Accept-Encoding,
# so `brotli` must be installed wherever this runs.
SEN_CDN = "https://wtt-web-frontdoor-withoutcache-cqakg0andqf5hchn.a01.azurefd.net/ranking"

FEED = "data-quality"
PAGE = 1000

# (label, table, column, alert after N days). Generous, for the reason heartbeat.py
# already documents: GitHub's scheduled crons run late, and we only want real outages.
FRESHNESS = [
    ("senior singles",   "rankings_singles_normalized", "ranking_date",  10),
    ("senior doubles",   "rankings_doubles_teams",      "publish_date",  10),
    ("youth singles",    "youth_rankings_singles",      "publish_date",  10),
    ("youth doubles",    "youth_rankings_doubles",      "publish_date",  10),
    ("upcoming entries", "wtt_entries",                 "last_updated",   3),
]

COVERAGE_MIN_ROWS = 20     # ignore groups too small to mean anything
COVERAGE_MAX_NULL = 5.0    # percent

problems = []


def fail(check, msg):
    problems.append((check, msg))
    print(f"  FAIL [{check}] {msg}")


def ok(msg):
    print(f"  ok   {msg}")


# ── Reading ───────────────────────────────────────────────────────────────────

def newest(db, table, col):
    r = db.table(table).select(col).order(col, desc=True).limit(1).execute()
    return (r.data or [{}])[0].get(col)


def age_days(value):
    """Days since a date or timestamp string, or None if unparseable."""
    if not value:
        return None
    s = str(value)
    try:
        if len(s) <= 10:
            return (date.today() - date.fromisoformat(s)).days
        ts = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - ts).total_seconds() / 86400
    except ValueError:
        return None


def group_stats(db, table, publish_date, band, sub):
    """count / nulls / min / max of age_cat_rank for one band+sub-event.

    Deliberately aggregates server-side rather than pulling the week's rows. Two earlier
    attempts failed here and both are worth remembering: paging with .range() and no
    ORDER BY silently overlaps and skips pages (it reported 245 rows for a group of
    285), and adding a total order over ~15k rows on unindexed columns exceeded the
    statement timeout. These are small indexed lookups instead.
    """
    def q():
        return (db.table(table).select("age_cat_rank", count="exact")
                .eq("publish_date", publish_date)
                .eq("age_category", band).eq("sub_event", sub))

    total = q().limit(1).execute().count or 0
    if total == 0:
        return None

    nulls = q().is_("age_cat_rank", "null").limit(1).execute().count or 0

    def edge(desc):
        r = (q().not_.is_("age_cat_rank", "null")
             .order("age_cat_rank", desc=desc).limit(1).execute())
        return (r.data or [{}])[0].get("age_cat_rank")

    return {"total": total, "nulls": nulls, "min": edge(False), "max": edge(True)}


def doubles_sample(db, table, publish_date, band, sub, n=500):
    """A slice of (age_cat_rank, current_rank) to test whether they are ever different."""
    r = (db.table(table).select("age_cat_rank,current_rank")
         .eq("publish_date", publish_date)
         .eq("age_category", band).eq("sub_event", sub)
         .not_.is_("age_cat_rank", "null").limit(n).execute())
    return r.data or []


# ── Checks ────────────────────────────────────────────────────────────────────

def check_upstream_gap(db):
    """Is WTT publishing weeks we have not collected?

    Freshness alone cannot answer this. It measures the age of the newest row we
    hold, so a dead feed stays green for the whole threshold window. That is exactly
    what happened on 2026-08-18: the youth sync had been failing for a week, the
    newest week we held was internally perfect, 8 days sat inside the 10-day limit,
    and the check said PASS while WTT had already published W34.

    Asking the source directly is the only way to see an absence.
    """
    print("\nupstream gap")

    # ── youth (both tables share one source) ──
    try:
        y, w = latest_available_week()
        if y is None:
            fail("upstream gap", "youth: WTT returned no published week at all")
        else:
            for table in ("youth_rankings_singles", "youth_rankings_doubles"):
                r = (db.table(table).select("ranking_year,ranking_week")
                     .order("ranking_year", desc=True).order("ranking_week", desc=True)
                     .limit(1).execute())
                if not r.data:
                    fail("upstream gap", f"{table}: empty")
                    continue
                have = (r.data[0]["ranking_year"], r.data[0]["ranking_week"])
                if have < (y, w):
                    fail("upstream gap", f"{table}: WTT has {y} W{w}, we have "
                                         f"{have[0]} W{have[1]} — the ingest is not landing")
                else:
                    ok(f"{table}: current with WTT ({y} W{w})")
    except Exception as e:
        fail("upstream gap", f"youth: could not reach WTT — {type(e).__name__}: {e}")

    # ── senior doubles (CDN publish list; served brotli-encoded) ──
    try:
        r = requests.get(f"{SEN_CDN}/PUBLISH_DATE.json",
                         params={"CategoryCode": "SEN", "q": 1},
                         headers=WTT_HEADERS, timeout=30)
        rows = r.json().get("Result", [])
        y, w = max((int(x["RankingYear"]), int(x["RankingWeek"])) for x in rows)
        d = (db.table("rankings_doubles_teams").select("ranking_year,ranking_week")
             .order("ranking_year", desc=True).order("ranking_week", desc=True)
             .limit(1).execute())
        have = (d.data[0]["ranking_year"], d.data[0]["ranking_week"]) if d.data else (0, 0)
        if have < (y, w):
            fail("upstream gap", f"rankings_doubles_teams: WTT has {y} W{w}, we have "
                                 f"{have[0]} W{have[1]}")
        else:
            ok(f"rankings_doubles_teams: current with WTT ({y} W{w})")
    except Exception as e:
        fail("upstream gap", f"senior doubles: could not reach WTT — {type(e).__name__}: {e}")


def check_freshness(db):
    print("\nfreshness")
    for label, table, col, limit in FRESHNESS:
        v = newest(db, table, col)
        if v is None:
            fail("freshness", f"{label}: table is empty")
            continue
        days = age_days(v)
        if days is None:
            fail("freshness", f"{label}: cannot read {col}={v!r}")
        elif days > limit:
            fail("freshness", f"{label}: newest is {days:.0f} days old ({v}), limit {limit}")
        else:
            ok(f"{label}: {days:.0f}d old ({v})")


def check_groups(db, table, publish_date, subs):
    """Coverage, band density and doubles independence, band by band."""
    seen = 0
    for band in BANDS:
        for sub in subs:
            s = group_stats(db, table, publish_date, band, sub)
            if s is None:            # combination simply has no competitors
                continue
            seen += 1
            total, nulls, lo, hi = s["total"], s["nulls"], s["min"], s["max"]
            ranked = total - nulls

            # coverage
            pct = 100.0 * nulls / total
            if total >= COVERAGE_MIN_ROWS and pct > COVERAGE_MAX_NULL:
                fail("coverage", f"{table} {band}/{sub}: age_cat_rank null on "
                                 f"{nulls}/{total} rows ({pct:.0f}%)")

            # band density — positions must be a clean 1..N over the ranked rows.
            # A gap makes max > n; a duplicate makes max < n. Either fails.
            if ranked and (lo != 1 or hi != ranked):
                fail("band density", f"{table} {band}/{sub}: {ranked} ranked rows but "
                                     f"positions run {lo}..{hi} (expected 1..{ranked})")

            # doubles independence — U19 is the widest band, so position == world rank
            # is correct there. Anywhere narrower, identity on every row means the band
            # position was never actually computed.
            if table.endswith("_doubles") and band != BANDS[-1] and ranked >= COVERAGE_MIN_ROWS:
                rows = doubles_sample(db, table, publish_date, band, sub)
                if rows and all(r["age_cat_rank"] == r["current_rank"] for r in rows):
                    fail("doubles independence",
                         f"{table} {band}/{sub}: age_cat_rank equals current_rank on all "
                         f"{len(rows)} sampled rows — band position is not being computed")

    print(f"  checked {seen} band/sub-event groups")


def check_drift(db, table, publish_date, subs):
    """Anything outside the lists the ingest actually collects."""
    for col, allowed in (("age_category", BANDS), ("sub_event", subs)):
        r = (db.table(table).select(col)
             .eq("publish_date", publish_date)
             .not_.in_(col, allowed).limit(5).execute())
        found = sorted({row[col] for row in (r.data or [])})
        if found:
            fail("enumeration drift",
                 f"{table}: unknown {col} {found} — not in {allowed}. The ingest does "
                 f"not collect these, so their rows carry no band position.")
        else:
            ok(f"{table}: {col} within {allowed}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="print findings, write nothing, always exit 0")
    # Daily monitoring only cares about the newest week. Verifying a backfill chunk
    # means asking about an older one, so allow the week to be named.
    ap.add_argument("--publish-date", metavar="YYYY-MM-DD",
                    help="check this published week instead of the newest")
    args = ap.parse_args()

    db = get_db()
    if db is None:
        sys.exit("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY")

    if not args.publish_date:        # both are meaningless for a named past week
        check_freshness(db)
        check_upstream_gap(db)

    for table, subs in (("youth_rankings_singles", SINGLE_EVENTS),
                        ("youth_rankings_doubles", DOUBLES_EVENTS)):
        pub = args.publish_date or newest(db, table, "publish_date")
        if not pub:
            continue
        print(f"\n{table} @ {pub}")
        check_drift(db, table, pub, subs)
        check_groups(db, table, pub, subs)

    print()
    if not problems:
        print("PASS — all checks clean.")
        if not args.dry_run:
            record_health(db, FEED, "ok", "all checks clean")
        return 0

    by_check = {}
    for check, msg in problems:
        by_check.setdefault(check, []).append(msg)
    summary = "; ".join(f"{k} x{len(v)}" for k, v in sorted(by_check.items()))
    print(f"FAIL — {len(problems)} problem(s): {summary}")

    if args.dry_run:
        print("(dry run — nothing written, exiting 0)")
        return 0

    # last_detail is what heartbeat.py puts in the Telegram alert, so lead with the
    # summary and let the first few specifics follow.
    detail = summary + " | " + " | ".join(m for _, m in problems[:4])
    record_health(db, FEED, "error", detail)
    return 1


if __name__ == "__main__":
    sys.exit(main())
