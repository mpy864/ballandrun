"""
elo_ratings.py
Computes Elo ratings for all players from match history in wtt_matches_singles.
Weighted by event type (importance) and time decay (recent matches matter more).
Importable as a module — call compute_elo(supabase) to get ratings dict.
"""

import os
import math
from datetime import date
from supabase import create_client, Client

# ─── Event type K-factor weights ─────────────────────────────────────────────

EVENT_K = {
    "Olympic Games":                     40,
    "WTTC":                              38,
    "WTT Grand Smash":                   36,
    "Singles World Cup":                 34,
    "World Mixed Team Championships":    34,
    "WTT Champions":                     32,
    "WTT Finals":                        32,
    "Continental Championships":         30,
    "WTT Star Contender":                28,
    "Multi-Sport Games":                 28,  # Asian Games etc.
    "WTT Contender":                     22,
    "Continental Cups":                  22,
    "WTTC Finals Regional Qualifications": 20,
    "WTTC Finals Continental Qualifications": 20,
    "WTT Feeder":                        16,
    "ITTF International Open":           16,
    "WTT Youth Star Contender":          10,
    "WTT Youth Contender":               8,
    "WTT Youth Smash":                   10,
    "Youth Continental Championships":   10,
    "World Youth Championships":         12,
    "ITTF International Youth Open":     8,
    "Veteran Championships":             4,
    "WTT Champions Qualifier":           18,
    "WTT Star Contender Qualifier":      14,
}
DEFAULT_K    = 12
YOUTH_K      = 8       # fallback for any unrecognised youth event
INITIAL_ELO  = 1500.0
TIME_DECAY   = 0.0004  # per day; e-^(decay*days) → ~77% weight at 2 years
TODAY        = date.today()


def _k_factor(event_type: str | None, event_date: date | None) -> float:
    """Return time-decayed K-factor for a match."""
    raw_type = event_type or ""
    k = EVENT_K.get(raw_type)
    if k is None:
        k = YOUTH_K if "youth" in raw_type.lower() or "junior" in raw_type.lower() else DEFAULT_K

    if event_date:
        days_ago = max(0, (TODAY - event_date).days)
        k *= math.exp(-TIME_DECAY * days_ago)
    return k


def _expected(r_a: float, r_b: float) -> float:
    """Expected score for player A vs player B."""
    return 1.0 / (1.0 + 10 ** ((r_b - r_a) / 400.0))


def _fractional_score(match_score: str | None, result: str) -> float:
    """
    Convert match score to fractional outcome for Elo update.
    match_score format: 'W-L' from comp1's perspective (e.g. '3-1', '2-3').
    Falls back to binary 1.0/0.0 if score is missing or malformed.
    """
    if match_score and "-" in str(match_score):
        try:
            parts = str(match_score).split("-")
            w, l = int(parts[0].strip()), int(parts[1].strip())
            total = w + l
            if total > 0:
                return w / total  # comp1's game win fraction
        except (ValueError, TypeError, IndexError):
            pass
    return 1.0 if result == "W" else 0.0


def compute_elo(supabase: Client,
                gender_filter: str | None = None) -> dict[int, float]:
    """
    Fetch all matches, replay chronologically, return {ittf_id: elo}.
    gender_filter: 'M', 'W', or None (all).
    """
    # Load event metadata for K-factor lookup
    ev_resp = supabase.table("wtt_events").select("event_id,event_type").execute()
    event_type_map: dict[int, str] = {
        e["event_id"]: e["event_type"] for e in (ev_resp.data or [])
    }

    # Load all valid matches (paginated)
    all_matches = []
    page, size = 0, 1000
    print("[Elo] Fetching matches from DB...")
    while True:
        q = supabase.table("wtt_matches_singles") \
            .select("comp1_id,comp2_id,result,match_score,event_id,event_date") \
            .not_.is_("result", "null") \
            .not_.is_("comp1_id", "null") \
            .not_.is_("comp2_id", "null") \
            .order("event_date") \
            .range(page * size, page * size + size - 1) \
            .execute()
        if not q.data:
            break
        all_matches.extend(q.data)
        if len(q.data) < size:
            break
        page += 1

    print(f"[Elo] {len(all_matches)} matches loaded.")

    # Optional: filter by gender if player gender data available
    if gender_filter:
        p_resp = supabase.table("wtt_players").select("ittf_id,gender").execute()
        gender_map = {p["ittf_id"]: p["gender"] for p in (p_resp.data or [])}

    elo: dict[int, float] = {}

    def get_elo(pid: int) -> float:
        return elo.setdefault(pid, INITIAL_ELO)

    for m in all_matches:
        pid1 = m["comp1_id"]
        pid2 = m["comp2_id"]
        result = m["result"]   # "W" = comp1 won, "L" = comp1 lost

        if not pid1 or not pid2 or result not in ("W", "L"):
            continue
        if pid1 >= 1_000_000 or pid2 >= 1_000_000:
            continue  # skip pair/team IDs

        if gender_filter:
            if gender_map.get(pid1) != gender_filter or \
               gender_map.get(pid2) != gender_filter:
                continue

        event_type = event_type_map.get(m["event_id"])
        try:
            event_date = date.fromisoformat(m["event_date"]) if m["event_date"] else None
        except (ValueError, TypeError):
            event_date = None

        k = _k_factor(event_type, event_date)
        r1, r2 = get_elo(pid1), get_elo(pid2)
        e1 = _expected(r1, r2)

        # Fractional score: 3-0→1.0, 3-1→0.75, 3-2→0.60, 2-3→0.40, 1-3→0.25, 0-3→0.0
        ms = m.get("match_score")
        s1 = _fractional_score(ms, result)

        elo[pid1] = r1 + k * (s1 - e1)
        elo[pid2] = r2 + k * ((1 - s1) - (1 - e1))

    print(f"[Elo] Ratings computed for {len(elo)} players.")
    return elo


def win_probability(elo_a: float, elo_b: float) -> float:
    """Return P(A beats B) from Elo ratings."""
    return _expected(elo_a, elo_b)


if __name__ == "__main__":
    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    ratings = compute_elo(supabase)

    # Print top 30
    from supabase import create_client
    p_resp = supabase.table("wtt_players").select("ittf_id,player_name,country_code,gender").execute()
    pmap = {p["ittf_id"]: p for p in (p_resp.data or [])}

    top = sorted(ratings.items(), key=lambda x: -x[1])[:30]
    print(f"\n{'Rank':<5} {'Player':<30} {'Country':<7} {'Elo':>6}")
    print("-" * 52)
    for rank, (pid, elo_val) in enumerate(top, 1):
        p = pmap.get(pid, {})
        print(f"{rank:<5} {p.get('player_name','?'):<30} {p.get('country_code','?'):<7} {elo_val:>6.0f}")
