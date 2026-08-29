"""
fetch_ittf_matches.py
Fetches match results for ITTF major events from results.ittf.com
These events are NOT on the WTT API — they use a separate date-based JSON API.

Runs daily via GitHub Actions alongside fetch_matches.py.
"""

import os
import sys
import time
import requests
from datetime import date, timedelta, datetime, timezone
from supabase import create_client, Client

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tg_common import reported                                   # noqa: E402

FEED = "ittf-matches"

# ─── Config ───────────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

ITTF_BASE      = "https://results.ittf.com/ittf-web-results/html"
WORLDCUP_BASE  = "https://worldcupresults.ittf.com/ittf-web-results/html"
PROFILE_URL    = "https://wtt-ttu-connect-frontdoor-g6gwg6e2bgc6gdfm.a01.azurefd.net/Players/GetPlayers"
PROFILE_HEADERS = {
    "apikey":     "2bf8b222-532c-4c60-8ebe-eb6fdfebe84a",
    "secapimkey": "S_WTT_882jjh7basdj91834783mds8j2jsd81",
    "origin":     "https://www.worldtabletennis.com",
    "referer":    "https://www.worldtabletennis.com/",
    "accept":     "application/json",
}

# ITTF events for 2026 with their date ranges
# Format: event_id: (event_name, start_date, end_date, base_url_override_or_None)
ITTF_2026_EVENTS = {
    # ── ITTF Major Events ─────────────────────────────────────────
    3379: ("ITTF World Cup Macao 2026", "2026-03-30", "2026-04-05", WORLDCUP_BASE),
    # World Team Championships London 2026 was here and fetched nothing for thirteen
    # days: results.ittf.com has no TTE3216, so every request returned BlobNotFound.
    # It lives in fetch_matches.py now, under "ITTF Major Events (on WTT API)", because
    # WTT publishes it with the individual rubbers nested inside each team tie.
    # Being listed in the wrong script is not a harmless duplicate — it is thirteen days
    # of 404s that nothing reports.
    3377: ("ITTF World Youth Championships 2026",       "2026-11-21", "2026-11-28", None),
    3378: ("ITTF Mixed Team World Cup Chengdu 2026",    "2026-11-29", "2026-12-06", None),
    # ── Asian Events ──────────────────────────────────────────────
    3471: ("ITTF-ATTU Asian Cup Haikou 2026",                        "2026-02-04", "2026-02-08", None),
    3472: ("ITTF-ATTU Asian Youth Championships Bangkok 2026",       "2026-06-28", "2026-07-04", None),
    3473: ("Asian Games Nagoya 2026",                                "2026-09-20", "2026-09-28", None),
    3474: ("ITTF-ATTU Asian Championships Tashkent 2026",            "2026-10-12", "2026-10-25", None),
    3475: ("ITTF-ATTU South East Asian Youth Championships 2026",    "2026-04-14", "2026-04-19", None),
    3498: ("ITTF-ATTU Central Asia Youth Championships Almaty 2026", "2026-04-03", "2026-04-05", None),
    3499: ("ITTF-ATTU West Asia Youth Championships Amman 2026",     "2026-06-01", "2026-06-01", None),
    3500: ("ITTF-ATTU South Asia Youth Championships Shimla 2026",   "2026-04-08", "2026-04-11", None),
}

SLEEP_DAY   = 0.5   # seconds between day fetches
SLEEP_EVENT = 2.0   # seconds between events

# ─── Helpers ──────────────────────────────────────────────────────────────────

def event_has_matches(supabase: Client, event_id: int) -> bool:
    """Check if this event already has matches in DB."""
    result = supabase.table("wtt_matches_singles") \
        .select("match_id", count="exact") \
        .eq("event_id", event_id) \
        .limit(1) \
        .execute()
    return (result.count or 0) > 0


def fetch_day(event_id: int, date_str: str, base_url: str = ITTF_BASE) -> list[dict]:
    """Fetch all singles matches for one event day from ITTF API."""
    url = f"{base_url}/TTE{event_id}/match/d{date_str}.json"
    try:
        r = requests.get(url, timeout=15)
        if r.status_code != 200:
            return []
        return r.json()
    except Exception as e:
        print(f"  [!] {date_str}: {e}")
        return []


def resolve_player_id(comp: dict) -> str | None:
    """Extract individual player ID — handles team-level IDs via players array."""
    raw_id = str(comp.get("Reg") or "")
    if not raw_id or "\n" in raw_id:
        return None
    if raw_id.startswith("TM"):
        return None  # team registration — skip
    return raw_id if raw_id.isdigit() else None


def build_game_scores(home_splits: list, away_splits: list) -> list[tuple]:
    """Reconstruct game scores from Splits arrays."""
    games = []
    for h, a in zip(home_splits, away_splits):
        h_res = str(h.get("Res") or "").strip()
        a_res = str(a.get("Res") or "").strip()
        if h_res.lstrip("-").isdigit() and a_res.lstrip("-").isdigit():
            h_pts = abs(int(h_res))
            a_pts = abs(int(a_res))
            if h_pts == 0 and a_pts == 0:
                continue
            games.append((h_pts, a_pts))
    return games


def parse_match(m: dict, event_id: int, event_date_str: str,
                counter: int) -> dict | None:
    """Parse a single match into a DB row."""
    home = m.get("Home") or {}
    away = m.get("Away") or {}

    home_id = resolve_player_id(home)
    away_id = resolve_player_id(away)
    if not home_id or not away_id:
        return None

    try:
        comp1_id = int(home_id)
        comp2_id = int(away_id)
    except ValueError:
        return None

    # Game scores
    home_splits = home.get("Splits") or []
    away_splits = away.get("Splits") or []
    games = build_game_scores(home_splits, away_splits)

    w1 = sum(1 for h, a in games if h > a)
    w2 = sum(1 for h, a in games if a > h)

    # Fallback to Res if splits empty
    if not games:
        try:
            w1 = int(home.get("Res") or 0)
            w2 = int(away.get("Res") or 0)
        except:
            return None

    result      = "W" if w1 > w2 else "L"
    match_score = f"{w1}-{w2}"
    game_scores  = ",".join(f"{h}-{a}" for h, a in games) if games else None
    comp1_scores = ",".join(str(h) for h, a in games) if games else None
    comp2_scores = ",".join(str(a) for h, a in games) if games else None

    # match_id from Info.Code or Key
    info     = m.get("Info") or {}
    match_id = info.get("Code") or m.get("Key") or f"{event_id}_{event_date_str}_{counter}"

    # Round/phase from description
    round_phase = info.get("Desc") or m.get("Desc")

    return {
        "match_id":       str(match_id),
        "event_id":       event_id,
        "event_category": None,
        "round_phase":    round_phase,
        "comp1_id":       comp1_id,
        "comp2_id":       comp2_id,
        "comp1_scores":   comp1_scores,
        "comp2_scores":   comp2_scores,
        "match_score":    match_score,
        "game_scores":    game_scores,
        "result":         result,
        "event_date":     event_date_str,
        "last_updated":   datetime.now(timezone.utc).isoformat(),
    }


def fetch_event(event_id: int, start_str: str, end_str: str, base_url: str = ITTF_BASE) -> list[dict]:
    """Fetch all matches across all days of an event."""
    all_records = []
    counter     = 1

    d   = date.fromisoformat(start_str)
    end = date.fromisoformat(end_str)

    while d <= end:
        ds       = d.isoformat()
        day_data = fetch_day(event_id, ds, base_url)

        if day_data:
            day_records = []
            for m in day_data:
                if not isinstance(m, dict):
                    continue
                is_team     = m.get("IsTeam", False)
                sub_matches = m.get("SubMatches") or []

                if is_team and sub_matches:
                    for sm in sub_matches:
                        rec = parse_match(sm, event_id, ds, counter)
                        if rec:
                            day_records.append(rec)
                            counter += 1
                else:
                    rec = parse_match(m, event_id, ds, counter)
                    if rec:
                        day_records.append(rec)
                        counter += 1

            if day_records:
                print(f"  {ds}: {len(day_records)} matches")
                all_records.extend(day_records)

        d += timedelta(days=1)
        time.sleep(SLEEP_DAY)

    return all_records


def ensure_players_in_db(supabase: Client, matches: list[dict]) -> None:
    """Auto-insert any new players not yet in wtt_players."""
    all_ids = set()
    for m in matches:
        if m.get("comp1_id"): all_ids.add(m["comp1_id"])
        if m.get("comp2_id"): all_ids.add(m["comp2_id"])

    if not all_ids:
        return

    existing = supabase.table("wtt_players") \
        .select("ittf_id") \
        .in_("ittf_id", list(all_ids)) \
        .execute()
    existing_ids = {r["ittf_id"] for r in (existing.data or [])}
    missing_ids  = all_ids - existing_ids

    if not missing_ids:
        return

    print(f"  [Players] {len(missing_ids)} new players — fetching profiles...")
    inserted = 0

    for ittf_id in missing_ids:
        try:
            now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
            r   = requests.get(PROFILE_URL,
                               params={"IttfId": ittf_id, "q": now},
                               headers=PROFILE_HEADERS, timeout=15)
            if r.status_code == 200:
                result = r.json().get("Result") or []
                if result:
                    p   = result[0]
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
            print(f"  [Players] Error {ittf_id}: {e}")

    print(f"  [Players] Inserted {inserted} new players.")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main(run):
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    today    = date.today()
    total    = 0

    for event_id, (name, start_str, end_str, base_url_override) in ITTF_2026_EVENTS.items():
        base_url = base_url_override or ITTF_BASE
        end_date = date.fromisoformat(end_str)

        # Only fetch events that have ended
        if end_date > today:
            print(f"[ITTF] {name} — not yet concluded, skipping.")
            continue

        # Always upsert metadata for concluded events (allows corrected names/dates to propagate)
        print(f"\n[ITTF] Event: {name} ({start_str} to {end_str})")
        supabase.table("wtt_events").upsert({
            "event_id":         event_id,
            "event_name":       name,
            "event_start_date": start_str,
        }, on_conflict="event_id").execute()

        # Skip match fetching if already ingested
        if event_has_matches(supabase, event_id):
            print(f"  Matches already in DB, skipping fetch.")
            continue

        print(f"  Fetching matches...")
        matches = fetch_event(event_id, start_str, end_str, base_url)

        if not matches:
            print(f"  No matches found — may require auth or wrong dates.")
            time.sleep(SLEEP_EVENT)
            continue

        # Deduplicate
        seen   = set()
        unique = [m for m in matches if m["match_id"] not in seen
                  and not seen.add(m["match_id"])]

        print(f"  Total unique matches: {len(unique)}")

        # Upsert
        for i in range(0, len(unique), 500):
            supabase.table("wtt_matches_singles") \
                .upsert(unique[i:i+500], on_conflict="match_id") \
                .execute()

        total += len(unique)
        print(f"  ✅ Upserted {len(unique)} rows.")

        # Auto-insert new players
        ensure_players_in_db(supabase, unique)
        time.sleep(SLEEP_EVENT)

    print(f"\n[ITTF] Done. Total upserted: {total}")
    run["detail"] = f"{total} matches upserted"
    if total == 0:
        run["status"] = "noop"   # no active ITTF event in the window


if __name__ == "__main__":
    with reported(FEED) as run:
        main(run)
