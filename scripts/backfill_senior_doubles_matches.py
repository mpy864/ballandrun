"""
backfill_senior_doubles_matches.py
Backfills doubles match results (MD, WD, XD) for senior events that already
have singles data but are missing doubles matches in wtt_matches_singles.

Handles both comp ID formats returned by the WTT API:
  - Numeric pair IDs (e.g. 36004, 100230112) — used as-is
  - Underscore format (e.g. "121558_131163") — mapped to pair_id via rankings_doubles_teams

Usage:
    export SUPABASE_URL=...  SUPABASE_SERVICE_KEY=...
    python scripts/backfill_senior_doubles_matches.py
    python scripts/backfill_senior_doubles_matches.py --event-ids 3112 3087 3082
    python scripts/backfill_senior_doubles_matches.py --skip-feeders
"""

import os
import sys
import time
import argparse
import requests
from datetime import datetime, timezone
from supabase import create_client, Client

# ── Config ────────────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

RESULTS_URL = (
    "https://wtt-website-live-events-api-prod-cmfzgabgbzhphabb.eastasia-01"
    ".azurewebsites.net/api/cms/GetOfficialResult"
)
HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept":     "application/json",
    "Referer":    "https://worldtabletennis.com/",
}

BATCH_SIZE  = 200
SLEEP_EVENT = 2.5

# Senior events in Apr 2025–May 2026 missing doubles, ordered by priority then date
EVENTS = [
    # Grand Smash
    (3082,  "United States Smash 2025",                      "WTT Grand Smash"),
    (3128,  "Europe Smash Sweden 2025",                      "WTT Grand Smash"),
    (3098,  "China Smash 2025",                              "WTT Grand Smash"),
    (3234,  "Singapore Smash 2026",                          "WTT Grand Smash"),
    # Finals
    (3112,  "WTT Finals Hong Kong 2025",                     "WTT Finals"),
    # WTTC
    (3108,  "ITTF WTTC Finals Doha 2025",                    "WTTC"),
    # Champions
    (3087,  "WTT Champions Incheon 2025",                    "WTT Champions"),
    (3094,  "WTT Champions Yokohama 2025",                   "WTT Champions"),
    (3097,  "WTT Champions Macao 2025",                      "WTT Champions"),
    (3099,  "WTT Champions Montpellier 2025",                "WTT Champions"),
    (3100,  "WTT Champions Frankfurt 2025",                  "WTT Champions"),
    (3231,  "WTT Champions Doha 2026",                       "WTT Champions"),
    (3235,  "WTT Champions Chongqing 2026",                  "WTT Champions"),
    # Star Contender
    (3091,  "WTT Star Contender Ljubljana 2025",             "WTT Star Contender"),
    (3093,  "WTT Star Contender Foz do Iguacu 2025",         "WTT Star Contender"),
    (3110,  "WTT Star Contender London 2025",                "WTT Star Contender"),
    (3176,  "WTT Star Contender Muscat 2025",                "WTT Star Contender"),
    (3232,  "WTT Star Contender Doha 2026",                  "WTT Star Contender"),
    (3233,  "WTT Star Contender Chennai 2026",               "WTT Star Contender"),
    # Contender
    (3088,  "WTT Contender Taiyuan 2025",                    "WTT Contender"),
    (3089,  "WTT Contender Tunis 2025",                      "WTT Contender"),
    (3090,  "WTT Contender Skopje 2025",                     "WTT Contender"),
    (3092,  "WTT Contender Zagreb 2025",                     "WTT Contender"),
    (3096,  "WTT Contender Almaty 2025",                     "WTT Contender"),
    (3121,  "WTT Contender Lagos 2025",                      "WTT Contender"),
    (3175,  "WTT Contender Buenos Aires 2025",               "WTT Contender"),
    (3251,  "WTT Contender Muscat 2026",                     "WTT Contender"),
    # Feeder
    (3069,  "WTT Feeder Havirov 2025",                       "WTT Feeder"),
    (3023,  "WTT Feeder Manchester 2025",                    "WTT Feeder"),
    (3058,  "WTT Feeder Prishtina 2025",                     "WTT Feeder"),
    (3177,  "WTT Feeder Spokane 2025",                       "WTT Feeder"),
    (3178,  "WTT Feeder Spokane II 2025",                    "WTT Feeder"),
    (3131,  "WTT Feeder Vientiane 2025",                     "WTT Feeder"),
    (3027,  "WTT Feeder Panagyurishte 2025",                 "WTT Feeder"),
    (3028,  "WTT Feeder Olomouc 2025",                       "WTT Feeder"),
    (3199,  "WTT Feeder Istanbul 2025",                      "WTT Feeder"),
    (3031,  "WTT Feeder Cappadocia II 2025",                 "WTT Feeder"),
    (3066,  "WTT Feeder Vila Nova de Gaia 2025",             "WTT Feeder"),
    (3191,  "WTT Feeder Gdansk 2025",                        "WTT Feeder"),
    (3065,  "WTT Feeder Dusseldorf II 2025",                 "WTT Feeder"),
    (3059,  "WTT Feeder Parma 2025",                         "WTT Feeder"),
    (3353,  "WTT Feeder Vadodara 2026",                      "WTT Feeder"),
    (3354,  "WTT Feeder Doha 2026",                          "WTT Feeder"),
    (3355,  "WTT Feeder Lille 2026",                         "WTT Feeder"),
    (3266,  "WTT Feeder Cappadocia 2026",                    "WTT Feeder"),
    (3267,  "WTT Feeder Dusseldorf 2026",                    "WTT Feeder"),
    (3268,  "WTT Feeder Otocec 2026",                        "WTT Feeder"),
    (3356,  "WTT Feeder Varazdin 2026",                      "WTT Feeder"),
    # World Cup / Continental (singles-only — included but will yield 0 doubles)
    (3109,  "ITTF World Cup Macao 2025",                     "Singles World Cup"),
    (3379,  "ITTF World Cup Macao 2026",                     "Singles World Cup"),
]


# ── Pair lookup ───────────────────────────────────────────────────────────────

pair_lookup: dict[tuple, int] = {}   # (p1_ittf_id, p2_ittf_id) → pair_id


def build_pair_lookup(supabase: Client) -> None:
    """Load all pairs from rankings_doubles_teams for underscore-format ID resolution."""
    print("Building pair lookup from rankings_doubles_teams ...")
    page, size = 0, 1000
    while True:
        res = (supabase.table("rankings_doubles_teams")
               .select("pair_id,p1_ittf_id,p2_ittf_id")
               .range(page * size, (page + 1) * size - 1)
               .execute())
        rows = res.data or []
        for row in rows:
            try:
                pid = int(row["pair_id"])
                p1  = int(row["p1_ittf_id"]) if row["p1_ittf_id"] else None
                p2  = int(row["p2_ittf_id"]) if row["p2_ittf_id"] else None
                if p1 and p2:
                    pair_lookup[(p1, p2)] = pid
                    pair_lookup[(p2, p1)] = pid
            except (ValueError, TypeError):
                pass
        if len(rows) < size:
            break
        page += 1
    print(f"  Loaded {len(pair_lookup) // 2} unique pairs.\n")


def resolve_comp_id(raw_id: str) -> int | None:
    """
    Convert a competitor ID to a numeric pair_id.
    - Numeric: "36004" → 36004
    - Underscore: "121558_131163" → lookup in pair_lookup
    """
    s = str(raw_id).strip()
    if "_" in s:
        parts = s.split("_")
        if len(parts) == 2:
            try:
                p1, p2 = int(parts[0]), int(parts[1])
                return pair_lookup.get((p1, p2)) or pair_lookup.get((p2, p1))
            except ValueError:
                return None
        return None
    try:
        return int(s)
    except ValueError:
        return None


# ── API fetch & parse ─────────────────────────────────────────────────────────

def fetch_event_doubles(event_id: int) -> list[dict]:
    try:
        resp = requests.get(
            RESULTS_URL,
            params={"EventId": event_id, "include_match_card": "true", "take": 1000},
            headers=HEADERS,
            timeout=30,
        )
    except Exception as e:
        print(f"    [!] Request error: {e}")
        return []

    if resp.status_code != 200:
        print(f"    [!] HTTP {resp.status_code}")
        return []

    try:
        data = resp.json()
    except Exception as e:
        print(f"    [!] JSON parse error: {e}")
        return []

    if isinstance(data, list):
        cards = data
    elif isinstance(data, dict):
        cards = data.get("Data") or data.get("Result") or data.get("result") or []
    else:
        cards = []

    records = []
    for team_tie in cards:
        if not isinstance(team_tie, dict):
            continue
        root_card = team_tie.get("match_card") or team_tie
        team_parent = root_card.get("teamParentData") or {}
        extended    = team_parent.get("extended_info") or {}
        indiv       = extended.get("matches") or []

        to_process = [tm.get("match_result") for tm in indiv if tm.get("match_result")]
        if not to_process and root_card:
            to_process = [root_card]

        for m_card in to_process:
            if not m_card or not m_card.get("competitiors"):
                continue
            comps = m_card.get("competitiors")
            if len(comps) < 2:
                continue

            # Only keep doubles: subEventName must contain "doubles"
            sub_event_name = m_card.get("subEventName") or ""
            if "double" not in sub_event_name.lower():
                continue

            # Skip youth age groups
            age_group = m_card.get("ageGroup") or m_card.get("ageCategoryCode") or ""
            if age_group and age_group.upper() not in ("", "SEN", "SENIOR"):
                continue

            c1, c2 = comps[0], comps[1]
            c1_raw = c1.get("competitiorId") or c1.get("competitorId") or ""
            c2_raw = c2.get("competitiorId") or c2.get("competitorId") or ""

            comp1_id = resolve_comp_id(c1_raw)
            comp2_id = resolve_comp_id(c2_raw)
            if comp1_id is None or comp2_id is None:
                continue

            # Game scores — clean placeholders
            game_scores = m_card.get("gameScores") or m_card.get("resultsGameScores")
            if game_scores:
                clean = []
                for g in game_scores.split(","):
                    parts = g.strip().split("-")
                    if len(parts) == 2:
                        a, b = parts[0].strip(), parts[1].strip()
                        if (a.isdigit() and b.isdigit()
                                and not (a == "7" and b == "0")
                                and not (a == "0" and b == "7")
                                and not (a == "0" and b == "0")):
                            clean.append(f"{a}-{b}")
                game_scores = ",".join(clean) if clean else None

            match_score = m_card.get("overallScores") or m_card.get("resultOverallScores")
            result = None
            if match_score:
                p = match_score.split("-")
                if len(p) == 2 and p[0].isdigit() and p[1].isdigit():
                    result = "W" if int(p[0]) > int(p[1]) else "L"

            event_date = None
            match_dt = m_card.get("matchDateTime") or {}
            date_str  = match_dt.get("startDateLocal") or match_dt.get("startDateUTC")
            if date_str:
                try:
                    event_date = datetime.strptime(date_str, "%m/%d/%Y %H:%M:%S").strftime("%Y-%m-%d")
                except ValueError:
                    event_date = date_str[:10] if date_str else None

            doc_code = m_card.get("documentCode") or m_card.get("matchId") or m_card.get("id")
            if not doc_code:
                continue
            match_id = f"{event_id}_{doc_code}"

            # Normalise category name
            cat = sub_event_name.strip()
            if "men" in cat.lower() and "women" not in cat.lower() and "mixed" not in cat.lower():
                cat = "Men's Doubles"
            elif "women" in cat.lower():
                cat = "Women's Doubles"
            elif "mixed" in cat.lower():
                cat = "Mixed Doubles"

            records.append({
                "match_id":       match_id,
                "event_id":       event_id,
                "event_category": cat,
                "round_phase":    m_card.get("subEventDescription"),
                "comp1_id":       comp1_id,
                "comp2_id":       comp2_id,
                "match_score":    match_score,
                "game_scores":    game_scores,
                "result":         result,
                "event_date":     event_date,
                "age_group":      None,
                "last_updated":   datetime.now(timezone.utc).isoformat(),
            })

    return records


# ── Upsert ────────────────────────────────────────────────────────────────────

def upsert_matches(supabase: Client, rows: list[dict]) -> None:
    for i in range(0, len(rows), BATCH_SIZE):
        supabase.table("wtt_matches_singles").upsert(
            rows[i: i + BATCH_SIZE], on_conflict="match_id"
        ).execute()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--event-ids", nargs="+", type=int,
                        help="Only process these event IDs (space-separated)")
    parser.add_argument("--skip-feeders", action="store_true",
                        help="Skip WTT Feeder events")
    args = parser.parse_args()

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    build_pair_lookup(supabase)

    events_to_run = EVENTS
    if args.event_ids:
        id_set = set(args.event_ids)
        # Use known metadata where available, otherwise create a generic entry
        known = {e[0]: e for e in EVENTS}
        events_to_run = [
            known[eid] if eid in known else (eid, f"Event {eid}", "Unknown")
            for eid in args.event_ids
        ]
    if args.skip_feeders:
        events_to_run = [e for e in events_to_run if e[2] != "WTT Feeder"]

    print(f"Processing {len(events_to_run)} events...\n")
    total_rows = 0

    for event_id, name, tier in events_to_run:
        print(f"  [{tier}] {name} (id:{event_id})")
        rows = fetch_event_doubles(event_id)

        md  = sum(1 for r in rows if r["event_category"] == "Men's Doubles")
        wd  = sum(1 for r in rows if r["event_category"] == "Women's Doubles")
        xd  = sum(1 for r in rows if r["event_category"] == "Mixed Doubles")
        print(f"    Found: MD={md}  WD={wd}  XD={xd}")

        if rows:
            upsert_matches(supabase, rows)
            total_rows += len(rows)
            print(f"    Upserted {len(rows)} doubles matches.")
        else:
            print(f"    No doubles found (event may be singles-only or data unavailable).")

        time.sleep(SLEEP_EVENT)

    print(f"\nDone. Total doubles matches upserted: {total_rows}")


if __name__ == "__main__":
    main()
