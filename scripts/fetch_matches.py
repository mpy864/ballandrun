"""
fetch_matches.py
Auto-discovers WTT events from the last 14 days via the event calendar API.
Fetches match results for any event not yet fully loaded in Supabase.
Runs daily via GitHub Actions.
"""

import argparse
import os
import sys
import time
import requests
from datetime import date, timedelta, datetime, timezone
from supabase import create_client, Client

# ─── Config ───────────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

# All 2026 WTT + ITTF + Youth events
# Source: WTT event calendar API response, extracted 2026-03-31
WTT_2026_EVENT_IDS = {
    # ── Senior WTT Series ──────────────────────────────────────────
    3231: ("WTT Champions Doha 2026",              "2026-01-11"),
    3232: ("WTT Star Contender Doha 2026",         "2026-01-18"),
    3251: ("WTT Contender Muscat 2026",            "2026-01-24"),
    3353: ("WTT Feeder Vadodara 2026",             "2026-01-11"),
    3354: ("WTT Feeder Doha 2026",                 "2026-01-31"),
    3355: ("WTT Feeder Lille 2026",                "2026-01-31"),
    3266: ("WTT Feeder Cappadocia 2026",           "2026-02-06"),
    3233: ("WTT Star Contender Chennai 2026",      "2026-02-15"),
    3234: ("Singapore Smash 2026",                 "2026-03-01"),
    3267: ("WTT Feeder Düsseldorf 2026",           "2026-03-06"),
    3268: ("WTT Feeder Otocec 2026",               "2026-03-11"),
    3235: ("WTT Champions Chongqing 2026",         "2026-03-15"),
    3356: ("WTT Feeder Varazdin 2026",             "2026-03-16"),
    3236: ("WTT Contender Tunis 2026",             "2026-03-29"),
    3373: ("WTT Feeder Cappadocia II 2026",        "2026-04-11"),
    3237: ("WTT Contender Taiyuan 2026",           "2026-04-12"),
    3270: ("WTT Feeder Havirov 2026",              "2026-04-17"),
    3357: ("WTT Feeder Senec 2026",                "2026-04-22"),
    3358: ("WTT Feeder Istanbul 2026",             "2026-05-14"),
    3360: ("WTT Feeder Lagos 2026",                "2026-05-19"),
    3238: ("WTT Contender Lagos 2026",             "2026-05-24"),
    3361: ("WTT Feeder Hennebont 2026",            "2026-05-24"),
    3271: ("WTT Feeder Prishtina 2026",            "2026-05-31"),
    3239: ("WTT Contender Skopje 2026",            "2026-06-07"),
    3240: ("WTT Contender Zagreb 2026",            "2026-06-14"),
    3241: ("WTT Star Contender Ljubljana 2026",    "2026-06-21"),
    3242: ("United States Smash 2026",             "2026-07-05"),
    3359: ("WTT Feeder Istanbul II 2026",          "2026-07-05"),
    3363: ("WTT Feeder Asunción 2026",             "2026-07-12"),
    3243: ("WTT Contender Buenos Aires 2026",      "2026-07-19"),
    3364: ("WTT Feeder Ulaanbaatar 2026",          "2026-07-23"),
    3244: ("WTT Star Contender Brazil 2026",       "2026-07-26"),
    3365: ("WTT Feeder Tashkent 2026",             "2026-07-28"),
    3372: ("WTT Feeder Tunis 2026",                "2026-08-02"),
    3272: ("WTT Feeder Vientiane 2026",            "2026-08-08"),
    3245: ("WTT Champions Yokohama 2026",          "2026-08-09"),
    3246: ("Europe Smash Sweden 2026",             "2026-08-16"),
    3374: ("WTT Feeder Berlin 2026",               "2026-08-23"),
    3282: ("WTT Feeder Olomouc 2026",              "2026-08-28"),
    3247: ("WTT Contender Almaty 2026",            "2026-09-06"),
    3415: ("WTT Feeder Puerto Princesa 2026",      "2026-09-12"),
    3253: ("WTT Contender Panagyurishte 2026",     "2026-09-13"),
    3248: ("WTT Champions Macao 2026",             "2026-09-13"),
    3371: ("WTT Feeder Bangkok 2026",              "2026-09-18"),
    3254: ("WTT Star Contender London 2026",       "2026-09-20"),
    3375: ("WTT Feeder Linz 2026",                 "2026-09-27"),
    3283: ("WTT Feeder Doha II 2026",              "2026-10-11"),
    3249: ("China Smash 2026",                     "2026-10-11"),
    3250: ("WTT Champions Montpellier 2026",       "2026-11-01"),
    3376: ("WTT Feeder Chennai 2026",              "2026-11-01"),
    3252: ("WTT Champions Frankfurt 2026",         "2026-11-08"),
    3370: ("WTT Feeder Vila Nova de Gaia 2026",    "2026-11-08"),
    3257: ("WTT Contender Istanbul 2026",          "2026-11-15"),
    3256: ("WTT Star Contender Muscat 2026",       "2026-11-21"),
    3352: ("WTT Feeder Düsseldorf II 2026",        "2026-11-27"),
    3269: ("WTT Feeder Gdansk 2026",               "2026-12-02"),
    3255: ("WTT Finals Hong Kong 2026",            "2026-12-13"),
    # ── ITTF Major Events (on WTT API) ────────────────────────────
    3379: ("ITTF World Cup Macao 2026",            "2026-04-05"),
    # London sat only in fetch_ittf_matches.py, which reads results.ittf.com — and that
    # host has no TTE3216, so all thirteen days returned BlobNotFound and India's biggest
    # team event of the year was missing from the dashboard entirely. The WTT API does
    # have it: 262 team ties, each carrying its five rubbers under
    # match_card.teamParentData.extended_info.matches, which fetch_event_matches below
    # already knows how to unwrap. 863 individual matches, 26 of them India's.
    3216: ("ITTF World Team Championships London 2026", "2026-05-10"),
    # ── WTT Youth Series ──────────────────────────────────────────
    3273: ("WTT Youth Contender Vadodara 2026",    "2026-01-05"),
    3274: ("WTT Youth Contender San Francisco 2026","2026-01-05"),
    3275: ("WTT Youth Contender Linz 2026",        "2026-01-11"),
    3276: ("WTT Youth Contender Manama 2026",      "2026-01-17"),
    3278: ("WTT Youth Contender Doha 2026",        "2026-01-22"),
    3277: ("WTT Youth Star Contender Doha 2026",   "2026-01-25"),
    3279: ("WTT Youth Contender Cappadocia 2026",  "2026-01-31"),
    3280: ("WTT Youth Contender Tunis 2026",       "2026-02-05"),
    3281: ("WTT Youth Star Contender Tunis 2026",  "2026-02-08"),
    3284: ("WTT Youth Contender Vila Real 2026",   "2026-02-13"),
    3285: ("Singapore Youth Smash 2026",           "2026-03-01"),
    3286: ("WTT Youth Contender Buenos Aires 2026","2026-03-07"),
    3291: ("WTT Youth Contender Wladyslawowo 2026","2026-03-07"),
    3292: ("WTT Youth Contender Asunción 2026",    "2026-03-12"),
    3293: ("WTT Youth Contender Berlin 2026",      "2026-03-15"),
    3294: ("WTT Youth Contender Havirov 2026",     "2026-03-15"),
    3316: ("WTT Youth Contender Houston 2026",     "2026-03-23"),
    3296: ("WTT Youth Contender Panagyurishte 2026","2026-03-29"),
    3299: ("WTT Youth Contender Humacao 2026",     "2026-03-29"),
    3297: ("WTT Youth Contender Novi Sad 2026",    "2026-04-03"),
    3298: ("WTT Youth Contender Luxembourg 2026",  "2026-04-11"),
    3301: ("WTT Youth Contender Metz 2026",        "2026-04-16"),
    3302: ("WTT Youth Star Contender Metz 2026",   "2026-04-19"),
    3304: ("WTT Youth Contender Sarajevo 2026",    "2026-04-30"),
    3305: ("WTT Youth Contender Platja D'Aro 2026","2026-05-08"),
    3307: ("WTT Youth Contender Mississauga 2026", "2026-05-18"),
    3308: ("WTT Youth Contender Bangkok 2026",     "2026-05-21"),
    3320: ("WTT Youth Contender Tashkent 2026",    "2026-05-16"),
    3306: ("WTT Youth Star Contender Bangkok 2026","2026-05-24"),
    3309: ("WTT Youth Contender Prishtina 2026",   "2026-05-25"),
    3478: ("WTT Youth Contender San Francisco II 2026","2026-05-25"),
    3310: ("WTT Youth Contender Sandefjord 2026",  "2026-06-02"),
    3311: ("WTT Youth Contender Helsingborg 2026", "2026-06-07"),
    3312: ("WTT Youth Contender São José 2026",    "2026-06-11"),
    3313: ("WTT Youth Star Contender São José 2026","2026-06-14"),
    3315: ("WTT Youth Contender Caracas 2026",     "2026-06-27"),
    3318: ("WTT Youth Contender Hong Kong 2026",   "2026-07-12"),
    3319: ("WTT Youth Contender Ulaanbaatar 2026", "2026-07-17"),
    3366: ("WTT Youth Contender Tashkent II 2026", "2026-07-22"),
    3321: ("WTT Youth Contender Almaty 2026",      "2026-07-27"),
    3322: ("WTT Youth Contender Vientiane 2026",   "2026-08-02"),
    3323: ("WTT Youth Contender Amman 2026",       "2026-08-08"),
    3480: ("WTT Youth Contender Spokane 2026",     "2026-08-09"),
    3479: ("WTT Youth Contender San Francisco III 2026","2026-07-26"),
    3326: ("WTT Youth Contender Varazdin 2026",    "2026-08-31"),
    3328: ("WTT Youth Contender Otocec 2026",      "2026-08-31"),
    3314: ("WTT Youth Contender Tunis II 2026",    "2026-09-06"),
    3332: ("WTT Youth Contender Cuenca 2026",      "2026-09-06"),
    3350: ("WTT Youth Contender Puerto Princesa 2026","2026-09-06"),
    3337: ("WTT Youth Contender Medellín 2026",    "2026-09-12"),
    3331: ("WTT Youth Contender Bangkok II 2026",  "2026-09-12"),
    3330: ("WTT Youth Contender Gangneung 2026",   "2026-09-17"),
    3329: ("WTT Youth Star Contender Gangneung 2026","2026-09-20"),
    3334: ("WTT Youth Contender Spa 2026",         "2026-09-24"),
    3333: ("WTT Youth Contender Batumi 2026",      "2026-09-30"),
    3367: ("WTT Youth Contender Asunción II 2026", "2026-09-30"),
    3347: ("WTT Youth Contender Cairo 2026",       "2026-10-05"),
    3368: ("WTT Youth Contender Buenos Aires II 2026","2026-10-05"),
    3336: ("WTT Youth Contender Doha II 2026",     "2026-10-16"),
    3340: ("WTT Youth Contender Dubai 2026",       "2026-10-21"),
    3481: ("WTT Youth Contender Fort Lauderdale 2026","2026-10-21"),
    3338: ("WTT Youth Contender Lignano 2026",     "2026-10-27"),
    3339: ("WTT Youth Contender Senec 2026",       "2026-10-27"),
    3369: ("WTT Youth Contender Chennai 2026",     "2026-10-26"),
    3344: ("WTT Youth Contender Szombathely 2026", "2026-11-01"),
    3345: ("WTT Youth Contender Podgorica 2026",   "2026-11-06"),
    3346: ("WTT Youth Star Contender Podgorica 2026","2026-11-09"),
    3482: ("WTT Youth Contender Gaborone 2026",    "2026-11-14"),
    3469: ("WTT Youth Contender Perth 2026",       "2026-11-18"),
}
RESULTS_URL = (
    "https://wtt-website-live-events-api-prod-cmfzgabgbzhphabb.eastasia-01"
    ".azurewebsites.net/api/cms/GetOfficialResult"
)
PROFILE_URL = (
    "https://wtt-ttu-connect-frontdoor-g6gwg6e2bgc6gdfm.a01.azurefd.net"
    "/Players/GetPlayers"
)
PROFILE_HEADERS = {
    "apikey":     "2bf8b222-532c-4c60-8ebe-eb6fdfebe84a",
    "secapimkey": "S_WTT_882jjh7basdj91834783mds8j2jsd81",
    "origin":     "https://www.worldtabletennis.com",
    "referer":    "https://www.worldtabletennis.com/",
    "accept":     "application/json",
}

COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept":     "application/json",
    "Referer":    "https://worldtabletennis.com/",
}

LOOKBACK_DAYS = 21     # fetch events that ended in the last N days
SLEEP_EVENT   = 2.0    # seconds between event fetches

# ─── Event Discovery ──────────────────────────────────────────────────────────

def get_recent_event_ids(lookback_days: int = LOOKBACK_DAYS) -> list[dict]:
    """
    Return events whose end date falls within the lookback window.
    Reads from the hardcoded WTT_2026_EVENT_IDS dict — no API call needed.
    """
    today  = date.today()
    cutoff = today - timedelta(days=lookback_days)

    recent = []
    for event_id, (event_name, end_date_str) in WTT_2026_EVENT_IDS.items():
        try:
            end_date = date.fromisoformat(end_date_str)
        except ValueError:
            continue
        if cutoff <= end_date <= today:
            recent.append({
                "event_id":   event_id,
                "event_name": event_name,
                "start_date": None,
                "end_date":   end_date_str,
            })

    return recent


def events_needing_fetch(supabase: Client,
                          recent: list[dict]) -> list[dict]:
    """
    Return all recent events for re-fetch.

    We always re-fetch every event within the lookback window rather than
    skipping events that already have some matches.  This prevents partial
    scrapes from getting permanently locked in: the WTT API sometimes
    returns only a subset of draws on the first run (e.g. Men's only),
    and a count > 0 check would skip the event on every subsequent run.

    Upsert with on_conflict="match_id" makes re-fetching fully idempotent —
    existing rows are updated in place and new rows are inserted cleanly.
    """
    needs_fetch = []
    for ev in recent:
        eid = ev["event_id"]
        if not eid:
            continue

        result = (
            supabase.table("wtt_matches_singles")
            .select("match_id", count="exact")
            .eq("event_id", eid)
            .execute()
        )
        count = result.count or 0
        status = f"{count} matches in DB — re-fetching to catch any new results"
        if count == 0:
            status = "no matches yet"
        print(f"  [Fetch] {ev['event_name']} (id:{eid}) — {status}")
        needs_fetch.append(ev)

    return needs_fetch


# ─── Match Fetching ───────────────────────────────────────────────────────────

def fetch_event_matches(event_id: int) -> tuple[list[dict], list[dict]]:
    """
    Fetch and parse all match results for one event.
    Returns (singles, doubles) — two lists of match dicts ready for Supabase upsert.

    Every failure path must return a 2-tuple as well. The caller unpacks the result
    directly, so returning a bare [] here raises ValueError and kills the whole run
    over one bad event — which froze five feeds for three weeks in July 2026.
    """
    try:
        resp = requests.get(
            RESULTS_URL,
            params={"EventId": event_id, "include_match_card": "true", "take": 1000},
            headers=COMMON_HEADERS,
            timeout=25,
        )
    except Exception as e:
        print(f"  [!] Request error for event {event_id}: {e}")
        return [], []

    if resp.status_code != 200:
        print(f"  [!] HTTP {resp.status_code} for event {event_id}")
        return [], []

    try:
        data = resp.json()
    except Exception as e:
        print(f"  [!] JSON parse error for event {event_id}: {e}")
        return [], []

    # API returns either a direct list or {"Data": [...]}
    if isinstance(data, list):
        cards = data
    elif isinstance(data, dict):
        cards = data.get("Data") or data.get("Result") or data.get("result") or []
    else:
        cards = []

    if not cards:
        print(f"  [!] Empty response for event {event_id}")
        return [], []

    records = []
    doubles_records = []
    for team_tie in cards:
        if not isinstance(team_tie, dict):
            continue

        root_card = team_tie.get("match_card") or team_tie

        # Handle team events (nested individual matches)
        team_parent        = root_card.get("teamParentData") or {}
        extended           = team_parent.get("extended_info") or {}
        individual_matches = extended.get("matches") or []

        to_process = [
            tm.get("match_result")
            for tm in individual_matches
            if tm.get("match_result")
        ]
        if not to_process and root_card:
            to_process = [root_card]

        for m_card in to_process:
            if not m_card or not m_card.get("competitiors"):
                continue

            comps = m_card.get("competitiors")
            if len(comps) < 2:
                continue

            c1, c2 = comps[0], comps[1]
            record = parse_match(m_card, c1, c2, event_id)
            if record:
                records.append(record)
            else:
                drec = parse_doubles_match(m_card, c1, c2, event_id)
                if drec:
                    doubles_records.append(drec)

    return records, doubles_records


def parse_match(m_card: dict, c1: dict, c2: dict,
                event_id: int) -> dict | None:
    """Parse a single match card into a Supabase row."""
    comp1_id_raw = c1.get("competitiorId") or c1.get("competitorId") or ""
    comp2_id_raw = c2.get("competitiorId") or c2.get("competitorId") or ""

    # Skip doubles/mixed — a doubles competitor carries a `players` list of 2.
    # Handled by parse_doubles_match. (Its competitiorId is a pair id, not a player.)
    if len(c1.get("players") or []) >= 2 or len(c2.get("players") or []) >= 2 \
       or "Doubles" in (m_card.get("subEventName") or ""):
        return None

    # Skip team-level entries (IDs like "100207276") and any joined ids
    if "_" in str(comp1_id_raw) or "_" in str(comp2_id_raw):
        return None
    try:
        comp1_id = int(comp1_id_raw)
        comp2_id = int(comp2_id_raw)
    except (ValueError, TypeError):
        return None

    # Use gameScores directly — already formatted as "11-4,11-4,11-6"
    game_scores = m_card.get("gameScores") or m_card.get("resultsGameScores")

    # Filter out placeholder scores (walkovers, unplayed sets)
    if game_scores:
        clean_games = []
        for g in game_scores.split(","):
            parts = g.strip().split("-")
            if len(parts) == 2:
                a, b = parts[0].strip(), parts[1].strip()
                if a.isdigit() and b.isdigit():
                    if not (a == "7" and b == "0") and \
                       not (a == "0" and b == "7") and \
                       not (a == "0" and b == "0"):
                        clean_games.append(f"{a}-{b}")
        game_scores = ",".join(clean_games) if clean_games else None

    # comp1/comp2 individual scores (e.g. "11,11,6")
    comp1_scores = c1.get("scores") if c1.get("scores") else None
    comp2_scores = c2.get("scores") if c2.get("scores") else None
    if isinstance(comp1_scores, list):
        comp1_scores = ",".join(str(x) for x in comp1_scores)
    if isinstance(comp2_scores, list):
        comp2_scores = ",".join(str(x) for x in comp2_scores)

    # Overall match score e.g. "3-0"
    match_score = m_card.get("overallScores") or m_card.get("resultOverallScores")

    # Result from comp1 perspective
    result = None
    if match_score:
        parts = match_score.split("-")
        if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
            result = "W" if int(parts[0]) > int(parts[1]) else "L"

    # Parse event date from matchDateTime.startDateLocal = "12/07/2025 19:00:00"
    event_date = None
    match_dt = m_card.get("matchDateTime") or {}
    date_str = match_dt.get("startDateLocal") or match_dt.get("startDateUTC")
    if date_str:
        try:
            dt = datetime.strptime(date_str, "%m/%d/%Y %H:%M:%S")
            event_date = dt.strftime("%Y-%m-%d")
        except ValueError:
            event_date = date_str[:10] if date_str else None

    # Use event_id + documentCode as match_id — documentCode is reused across events
    doc_code = m_card.get("documentCode") or m_card.get("matchId") or m_card.get("id")
    match_id = f"{event_id}_{doc_code}" if doc_code else None

    # The band of the DRAW, taken from the draw's own name.
    #
    # This parser never wrote age_group at all, and an upsert only touches the columns it
    # is given — so whatever an older version left in that column survived every nightly
    # refresh untouched. What it had left there was the PLAYER's band rather than the
    # draw's, which is why 26,111 junior matches read one step too young: a 16-year-old
    # entering the U19 draw was filed under U17. The doubles parser below has always
    # written it correctly; only singles was missing.
    cat = m_card.get("subEventName")
    age = next((a for a in ("U19", "U17", "U15", "U13", "U11") if cat and a in cat), None)

    return {
        "match_id":       match_id,
        "event_id":       event_id,
        "event_category": cat,
        "round_phase":    m_card.get("subEventDescription"),
        "age_group":      age,
        "comp1_id":       comp1_id,
        "comp2_id":       comp2_id,
        "comp1_scores":   comp1_scores,
        "comp2_scores":   comp2_scores,
        "match_score":    match_score,
        "game_scores":    game_scores,
        "result":         result,
        "event_date":     event_date,
        "last_updated":   datetime.now(timezone.utc).isoformat(),
    }


def parse_doubles_match(m_card: dict, c1: dict, c2: dict, event_id: int) -> dict | None:
    """Parse a doubles/mixed match. Each competitor is a pair: `players` holds the two
    player objects (playerId, playerName); competitiorId is the pair id. Skips singles/teams."""
    p1 = c1.get("players") or []
    p2 = c2.get("players") or []
    if len(p1) < 2 or len(p2) < 2:
        return None
    r1 = str(c1.get("competitiorId") or c1.get("competitorId") or "")
    r2 = str(c2.get("competitiorId") or c2.get("competitorId") or "")

    def pid(pl, i):
        try:
            return int(pl[i].get("playerId"))
        except (ValueError, TypeError, AttributeError):
            return None

    c1p1, c1p2 = pid(p1, 0), pid(p1, 1)
    c2p1, c2p2 = pid(p2, 0), pid(p2, 1)
    if not all([c1p1, c1p2, c2p1, c2p2]):
        return None

    game_scores = m_card.get("gameScores") or m_card.get("resultsGameScores")
    if game_scores:
        clean = []
        for g in game_scores.split(","):
            p = g.strip().split("-")
            if len(p) == 2 and p[0].strip().isdigit() and p[1].strip().isdigit():
                a, b = p[0].strip(), p[1].strip()
                if (a, b) not in [("7", "0"), ("0", "7"), ("0", "0")]:
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
    date_str = match_dt.get("startDateLocal") or match_dt.get("startDateUTC")
    if date_str:
        try:
            event_date = datetime.strptime(date_str, "%m/%d/%Y %H:%M:%S").strftime("%Y-%m-%d")
        except ValueError:
            event_date = date_str[:10]

    doc_code = m_card.get("documentCode") or m_card.get("matchId") or m_card.get("id")
    match_id = f"{event_id}_{doc_code}" if doc_code else None
    cat = m_card.get("subEventName")
    age = next((a for a in ("U19", "U17", "U15", "U13", "U11") if cat and a in cat), None)

    return {
        "match_id":       match_id,
        "event_id":       event_id,
        "event_category": cat,
        "round_phase":    m_card.get("subEventDescription"),
        "comp1_id":       r1,
        "comp1_p1_id":    c1p1,
        "comp1_p2_id":    c1p2,
        "comp2_id":       r2,
        "comp2_p1_id":    c2p1,
        "comp2_p2_id":    c2p2,
        "match_score":    match_score,
        "game_scores":    game_scores,
        "result":         result,
        "event_date":     event_date,
        "age_group":      age,
        "last_updated":   datetime.now(timezone.utc).isoformat(),
    }


def ensure_event_in_db(supabase: Client, ev: dict) -> None:
    """Insert event into wtt_events if not already present."""
    supabase.table("wtt_events").upsert({
        "event_id":         ev["event_id"],
        "event_name":       ev["event_name"],
        "event_start_date": ev["start_date"] or None,
    }, on_conflict="event_id").execute()


# ─── Auto-insert new players ──────────────────────────────────────────────────

def ensure_players_in_db(supabase: Client, matches: list[dict]) -> None:
    """
    Check all comp IDs in matches against wtt_players.
    Insert any missing players by fetching their profile from WTT API.
    """
    from datetime import datetime, timezone

    # Collect all unique comp IDs from matches
    all_comp_ids = set()
    for m in matches:
        if m.get("comp1_id"): all_comp_ids.add(m["comp1_id"])
        if m.get("comp2_id"): all_comp_ids.add(m["comp2_id"])

    if not all_comp_ids:
        return

    # Check which ones already exist in wtt_players
    existing = supabase.table("wtt_players") \
        .select("ittf_id") \
        .in_("ittf_id", list(all_comp_ids)) \
        .execute()
    existing_ids = {r["ittf_id"] for r in (existing.data or [])}

    missing_ids = all_comp_ids - existing_ids
    if not missing_ids:
        return

    # Skip IDs outside the valid ITTF range (1M+ are team/event registration IDs)
    fetchable = {i for i in missing_ids if i < 1_000_000}
    skipped   = len(missing_ids) - len(fetchable)
    print(f"  [Players] {len(missing_ids)} new players — fetching {len(fetchable)} profiles ({skipped} non-player IDs skipped)...")

    inserted = 0
    not_found = 0
    for ittf_id in fetchable:
        try:
            now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
            r = requests.get(PROFILE_URL,
                             params={"IttfId": ittf_id, "q": now},
                             headers=PROFILE_HEADERS, timeout=15)
            if r.status_code != 200:
                print(f"  [Players] HTTP {r.status_code} for id {ittf_id}")
                time.sleep(0.5)
                continue
            result = r.json().get("Result") or []
            if not result:
                not_found += 1
                time.sleep(0.5)
                continue
            p = result[0]
            dob = None
            dob_raw = p.get("DOB")
            if dob_raw:
                try:
                    dob = datetime.strptime(dob_raw, "%m/%d/%Y %H:%M:%S").strftime("%Y-%m-%d")
                except:
                    try: dob = dob_raw[:10]
                    except: pass

            supabase.table("wtt_players").upsert({
                "ittf_id":      ittf_id,
                "player_name":  p.get("PlayerName"),
                "country_code": p.get("CountryCode"),
                "country_name": p.get("CountryName"),
                "gender":       {"Men":"M","M":"M","Male":"M","Women":"W","Woman":"W","W":"W","F":"W","Female":"W"}.get(p.get("Gender") or "", None),
                "dob":          dob,
                "handedness":   p.get("Handedness"),
                "grip":         p.get("Grip"),
                "blade_type":   p.get("BladeType"),
            }, on_conflict="ittf_id").execute()
            inserted += 1
            time.sleep(0.5)
        except Exception as e:
            print(f"  [Players] Error fetching {ittf_id}: {e}")

    print(f"  [Players] Inserted {inserted} | Not found in API: {not_found} | Non-player IDs skipped: {skipped}")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    # An event only gets fetched while it sits inside the lookback window, so anything
    # that was broken at the time and fixed later is unreachable by the daily run —
    # London finished 104 days before its cause was found. These two flags are how a
    # past event is recovered, without editing the window every other feed depends on.
    ap = argparse.ArgumentParser()
    ap.add_argument("--event-id", type=int, action="append", metavar="ID",
                    help="fetch only this event, ignoring the lookback window "
                         "(repeatable)")
    ap.add_argument("--lookback-days", type=int, default=LOOKBACK_DAYS,
                    help=f"days back to look for finished events (default {LOOKBACK_DAYS})")
    args = ap.parse_args()

    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

    if args.event_id:
        recent = []
        for eid in args.event_id:
            if eid not in WTT_2026_EVENT_IDS:
                sys.exit(f"Event {eid} is not in WTT_2026_EVENT_IDS — add it there first, "
                         f"so the daily run keeps it too.")
            name, end = WTT_2026_EVENT_IDS[eid]
            recent.append({"event_id": eid, "event_name": name,
                           "start_date": None, "end_date": end})
        print(f"[Matches] Explicit event(s): {len(recent)}")
    else:
        print(f"[Matches] Discovering events from last {args.lookback_days} days...")
        recent = get_recent_event_ids(args.lookback_days)
        print(f"[Matches] Found {len(recent)} recent events.")

    to_fetch = events_needing_fetch(supabase, recent)
    print(f"[Matches] {len(to_fetch)} events need fetching.")

    total_upserted = 0

    for ev in to_fetch:
        eid  = ev["event_id"]
        name = ev["event_name"]
        print(f"\n  Fetching: {name} (id:{eid})...")

        # Ensure event row exists
        ensure_event_in_db(supabase, ev)

        matches, dmatches = fetch_event_matches(eid)
        print(f"  Parsed {len(matches)} singles, {len(dmatches)} doubles.")

        if not matches and not dmatches:
            print(f"  [!] No matches returned — skipping.")
            time.sleep(SLEEP_EVENT)
            continue

        # Upsert in batches of 500 (skip null match_id records)
        to_upsert = [m for m in matches if m.get("match_id")]
        for i in range(0, len(to_upsert), 500):
            chunk = to_upsert[i:i+500]
            try:
                supabase.table("wtt_matches_singles").upsert(
                    chunk, on_conflict="match_id"
                ).execute()
            except Exception as e:
                print(f"  [!] Upsert error (batch {i//500 + 1}): {e}")

        # Doubles → wtt_matches_doubles
        d_upsert = [m for m in dmatches if m.get("match_id")]
        for i in range(0, len(d_upsert), 500):
            try:
                supabase.table("wtt_matches_doubles").upsert(
                    d_upsert[i:i+500], on_conflict="match_id"
                ).execute()
            except Exception as e:
                print(f"  [!] Doubles upsert error (batch {i//500 + 1}): {e}")
        if d_upsert:
            dpseudo = []
            for r in dmatches:
                dpseudo.append({"comp1_id": r["comp1_p1_id"], "comp2_id": r["comp1_p2_id"]})
                dpseudo.append({"comp1_id": r["comp2_p1_id"], "comp2_id": r["comp2_p2_id"]})
            ensure_players_in_db(supabase, dpseudo)
            print(f"  Doubles: sent {len(d_upsert)} to wtt_matches_doubles.")

        # Verify actual DB count
        db_count = supabase.table("wtt_matches_singles") \
            .select("match_id", count="exact").eq("event_id", eid).execute()
        actual = db_count.count or 0
        total_upserted += actual
        print(f"  DB now has {actual} matches for {name} (parsed {len(matches)}, sent {len(to_upsert)}).")

        # Auto-insert any new players not yet in wtt_players
        ensure_players_in_db(supabase, matches)

        time.sleep(SLEEP_EVENT)

    print(f"\n[Matches] Done. Total matches upserted: {total_upserted}")


if __name__ == "__main__":
    main()
