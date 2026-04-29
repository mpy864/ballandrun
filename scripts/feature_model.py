"""
feature_model.py  –  V8: +Handedness +Deuce Resilience
Multi-feature match prediction model for table tennis.

Features (15, from 6 independent systems):
  1.  elo_diff                [Elo]           All-time rating gap (A − B).
  2.  elo_recent_diff         [Elo]           Rating gap from last 18 months only.
  3.  log_rank_diff           [Rankings]      log(rank_B) − log(rank_A).
  4.  rank_change_diff        [Rankings]      Recent rank trajectory.
  5.  age_diff                [Physiology]    Age gap in years (A − B).
  6.  form_big_residual_diff  [Form/count]    Elite-event win rate residual (K ≥ 28, last 10).
  7.  form_residual_diff      [Form/count]    All-adult win rate residual (last 10 matches).
  8.  form_3m_residual_diff   [Form/time]     Win rate residual over last 90 days.
  9.  form_6m_residual_diff   [Form/time]     Win rate residual over last 180 days.
  10. point_residual_diff     [Form/count]    Game-point fraction vs Elo expected.
  11. h2h_residual            [Matchup]       H2H win rate − Elo-expected (all K ≥ 20).
  12. h2h_elite_residual      [Matchup]       H2H win rate − Elo-expected (K ≥ 28 only).
  13. clutch_residual         [Mental]        Deciding-game win rate − Elo expected.
  14. handedness_diff         [Style]         +1 if A is left-handed vs right-handed B, −1 vice versa.
  15. deuce_residual_diff     [Mental]        Deuce-game win rate residual vs Elo expected (A − B).

Dropped from V5: home_advantage — had a consistently negative coefficient because
the "home player" at international events is almost always a local qualifier who is
weaker than the international field. The feature was labelling player weakness, not
conferring advantage. Removed to eliminate the confounding signal.

Training filter: Adult events with K-factor ≥ 20 only.
  Excludes: Youth events (K=8-12), WTT Feeder (K=16), ITTF International Open (K=16),
  Qualifiers (K=14), Veterans (K=4).
  This fixes the distribution mismatch where ~90% of training was Youth/Feeder events,
  but the test event is a professional adult WTT Star Contender.

Model: Logistic Regression with L1 regularization.
  L1 auto-zeros any feature that doesn't add independent signal beyond elo_diff.

Usage:
  python scripts/feature_model.py --gender M
  python scripts/feature_model.py --gender W
  python scripts/feature_model.py --gender M --test-event 3232
"""

import os
import sys
import json
import math
import argparse
from bisect import bisect_right
from datetime import date, timedelta
from collections import defaultdict, deque

import warnings
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, log_loss
from joblib import dump as joblib_dump, load as joblib_load
from supabase import create_client

sys.path.insert(0, os.path.dirname(__file__))
from elo_ratings import _k_factor, _expected, _fractional_score, INITIAL_ELO, EVENT_K, DEFAULT_K, YOUTH_K


FEATURE_NAMES = [
    "elo_diff",                # 1.  Elo — all-time rating gap
    "elo_recent_diff",         # 2.  Elo — last 18 months only (current form of ability)
    "log_rank_diff",           # 3.  Rankings — log-scale rank gap
    "rank_change_diff",        # 4.  Rankings — recent trajectory
    "age_diff",                # 5.  Physiology — age at match time
    "form_big_residual_diff",  # 6.  Form/count — elite-event form (K ≥ 28, last 10)
    "form_residual_diff",      # 7.  Form/count — all-adult form (last 10 matches)
    "form_3m_residual_diff",   # 8.  Form/time — win rate residual last 90 days
    "form_6m_residual_diff",   # 9.  Form/time — win rate residual last 180 days
    "point_residual_diff",     # 10. Form/count — point fraction vs Elo expectation
    "h2h_residual",            # 11. Matchup — H2H all adult events
    "h2h_elite_residual",      # 12. Matchup — H2H elite events only (K ≥ 28)
    "clutch_residual",         # 13. Mental — deciding-game win rate − Elo expected
    "handedness_diff",         # 14. Style — +1 if A=LH vs B=RH, −1 vice versa, 0 if same
    "deuce_residual_diff",     # 15. Mental — deuce-game win rate residual (A − B)
]

# Recent Elo window: only matches within this many days contribute to elo_recent
RECENT_CUTOFF_DAYS = 18 * 30   # ~18 months

# Training includes only adult professional events (K-factor >= this threshold)
MIN_K_TRAINING = 20
# "Elite" threshold for big-event form feature (Star Contender and above)
BIG_EVENT_K    = 28

# Country name → 3-letter code mapping for home_advantage feature
COUNTRY_NAME_TO_CODE = {
    "China": "CHN", "Japan": "JPN", "Germany": "GER", "South Korea": "KOR",
    "Korea": "KOR", "Sweden": "SWE", "France": "FRA", "Brazil": "BRA",
    "India": "IND", "Qatar": "QAT", "Singapore": "SGP", "United States": "USA",
    "USA": "USA", "Poland": "POL", "Romania": "ROU", "Denmark": "DEN",
    "Nigeria": "NGR", "Australia": "AUS", "Saudi Arabia": "KSA", "Egypt": "EGY",
    "Thailand": "THA", "Croatia": "CRO", "Hungary": "HUN", "Portugal": "POR",
    "Spain": "ESP", "Italy": "ITA", "Austria": "AUT", "Czech Republic": "CZE",
    "Slovakia": "SVK", "Ukraine": "UKR", "Russia": "RUS", "Belarus": "BLR",
    "Chinese Taipei": "TPE", "Hong Kong": "HKG", "Macao": "MAC",
    "United Kingdom": "ENG", "England": "ENG", "Great Britain": "ENG",
    "United Arab Emirates": "UAE", "Bahrain": "BRN", "Oman": "OMA",
    "Morocco": "MAR", "Tunisia": "TUN", "Algeria": "ALG",
    "Ghana": "GHA", "Cameroon": "CMR", "Congo": "CGO",
    "Iran": "IRI", "Iraq": "IRQ", "Jordan": "JOR",
    "Indonesia": "INA", "Philippines": "PHI", "Malaysia": "MAS",
    "Vietnam": "VIE", "Uzbekistan": "UZB", "Kazakhstan": "KAZ",
    "Chile": "CHI", "Argentina": "ARG", "Colombia": "COL", "Peru": "PER",
    "Mexico": "MEX", "Canada": "CAN", "Belgium": "BEL", "Netherlands": "NED",
    "Switzerland": "SUI", "Greece": "GRE", "Serbia": "SRB", "Slovenia": "SLO",
    "Bulgaria": "BUL", "Lithuania": "LTU", "Latvia": "LAT", "Estonia": "EST",
    "Finland": "FIN", "Norway": "NOR",
}


# ── Data loading helpers ───────────────────────────────────────────────────────

def _normalize_country(s: str | None) -> str | None:
    """Normalize country string to 3-letter code."""
    if not s:
        return None
    s = s.strip()
    if len(s) == 3 and s.isupper():
        return s
    if len(s) == 2 and s.isupper():  # ISO-2 → try lookup
        return COUNTRY_NAME_TO_CODE.get(s)
    return COUNTRY_NAME_TO_CODE.get(s)


def load_player_profiles(supabase) -> dict[int, dict]:
    """Return {ittf_id: {gender, country_code, dob, handedness}} for all players."""
    print("[Model] Loading player profiles...")
    resp = supabase.table("wtt_players").select(
        "ittf_id,gender,country_code,dob,handedness"
    ).execute()
    profiles = {}
    for p in (resp.data or []):
        profiles[p["ittf_id"]] = {
            "gender":       p.get("gender"),
            "country_code": p.get("country_code"),
            "dob":          p.get("dob"),
            "handedness":   p.get("handedness"),  # "LH" or "RH" or None
        }
    print(f"[Model] {len(profiles)} player profiles loaded.")
    return profiles


def load_event_meta(supabase) -> dict[int, dict]:
    """Return {event_id: {event_type, country}} for all events."""
    resp = supabase.table("wtt_events").select("event_id,event_type,country").execute()
    return {
        e["event_id"]: {
            "event_type": e.get("event_type"),
            "country":    _normalize_country(e.get("country")),
        }
        for e in (resp.data or [])
    }


def load_rankings(supabase, gender_filter: str | None) -> dict[int, list]:
    """
    Return rank_timeline[pid] = sorted list of (date_ordinal, rank, rank_change).
    rank_change in this table: negative = moved up (improved), positive = moved down.
    """
    print("[Model] Loading world rankings timeline (may take a moment)...")
    q_base = supabase.table("rankings_singles_normalized").select(
        "player_id,ranking_date,rank,rank_change"
    )
    if gender_filter:
        q_base = q_base.eq("gender", gender_filter)

    rank_timeline: dict[int, list] = defaultdict(list)
    page, size = 0, 1000
    total = 0
    while True:
        q = q_base.order("ranking_date").range(page * size, page * size + size - 1).execute()
        if not q.data:
            break
        for row in q.data:
            pid = row["player_id"]
            if not pid or not row.get("ranking_date"):
                continue
            try:
                d_ord = date.fromisoformat(str(row["ranking_date"])[:10]).toordinal()
            except (ValueError, TypeError):
                continue
            rank = row.get("rank")
            rchg = row.get("rank_change")
            if rank is not None:
                rank_timeline[pid].append((d_ord, rank, rchg or 0))
        total += len(q.data)
        if len(q.data) < size:
            break
        page += 1

    # Sort each player's timeline (should already be sorted, but be safe)
    for pid in rank_timeline:
        rank_timeline[pid].sort()

    print(f"[Model] Rankings loaded: {total} rows for {len(rank_timeline)} players.")
    return dict(rank_timeline)


def get_rank_at(pid: int, match_date_ord: int,
                rank_timeline: dict[int, list]) -> tuple[float | None, float | None]:
    """
    Binary search: most recent ranking snapshot on or before match_date_ord.
    Returns (rank, rank_change) or (None, None) if no prior data.
    """
    tl = rank_timeline.get(pid)
    if not tl:
        return None, None
    # bisect_right on (match_date_ord+1,) gives first index with date > match_date
    idx = bisect_right(tl, (match_date_ord + 1,)) - 1
    if idx < 0:
        return None, None
    _, rank, rank_change = tl[idx]
    return float(rank), float(rank_change)


def age_at(dob_str: str | None, match_date: date) -> float | None:
    """Age in decimal years at match_date."""
    if not dob_str:
        return None
    try:
        dob = date.fromisoformat(str(dob_str)[:10])
        return (match_date - dob).days / 365.25
    except (ValueError, TypeError):
        return None


# ── Helpers ───────────────────────────────────────────────────────────────────

def parse_point_frac(game_scores_str) -> float | None:
    """
    comp1's point win fraction from game_scores like "11-4,9-11,11-6,0-0,0-0".
    Returns None if unparseable.
    """
    if not game_scores_str:
        return None
    ta = tb = 0
    for game in str(game_scores_str).split(","):
        game = game.strip()
        if "-" not in game:
            continue
        try:
            a, b = int(game.split("-")[0]), int(game.split("-")[1])
            if a > 0 or b > 0:
                ta += a
                tb += b
        except (ValueError, IndexError):
            continue
    total = ta + tb
    return ta / total if total > 0 else None


def parse_deuce_games(game_scores_str) -> list[bool]:
    """
    From game_scores like "11-4,9-11,12-10,0-0" return list of booleans
    (comp1 won this game) for every game that went to deuce.
    Deuce condition: both players reached 10 AND score differs by exactly 2 (12-10, 13-11, …).
    """
    results = []
    if not game_scores_str:
        return results
    for game in str(game_scores_str).split(","):
        game = game.strip()
        if "-" not in game:
            continue
        try:
            a, b = int(game.split("-")[0]), int(game.split("-")[1])
            if a == 0 and b == 0:
                continue  # unplayed slot
            if a >= 10 and b >= 10 and abs(a - b) == 2:
                results.append(a > b)  # True = comp1 won this deuce game
        except (ValueError, IndexError):
            continue
    return results


def is_deciding_match(ms: str | None) -> bool:
    """
    True if match went to a deciding game (4-3 in BO7 or 3-2 in BO5).
    A deciding match: both players won at least 1 game AND min games == max games - 1.
    Examples: "4-3" → True, "3-4" → True, "4-2" → False, "4-0" → False.
    """
    if not ms or "-" not in str(ms):
        return False
    try:
        parts = str(ms).split("-")
        gw, gl = int(parts[0].strip()), int(parts[1].strip())
        return gw > 0 and gl > 0 and min(gw, gl) == max(gw, gl) - 1
    except (ValueError, IndexError):
        return False


def _event_k(event_type: str | None) -> float:
    """Effective K-factor (ignoring time decay) for tier-based filtering."""
    raw = event_type or ""
    k = EVENT_K.get(raw)
    if k is None:
        k = YOUTH_K if ("youth" in raw.lower() or "junior" in raw.lower()) else DEFAULT_K
    return k


# ── Game score helpers ────────────────────────────────────────────────────────

def _parse_game_score(match_score, result: str):
    """
    Return (games_won, games_lost) from comp1's perspective.
    match_score format: 'W-L' e.g. '3-1' (comp1's wins - comp1's losses).
    Falls back to (1, 0) / (0, 1) binary if score missing or malformed.
    """
    if match_score and "-" in str(match_score):
        try:
            parts = str(match_score).split("-")
            w, l = int(parts[0].strip()), int(parts[1].strip())
            if result == "W":
                return w, l
            else:
                return l, w   # comp1 lost — flip so won < lost
        except (ValueError, TypeError, IndexError):
            pass
    return (1, 0) if result == "W" else (0, 1)


def _markov_p_match(g: float) -> float:
    """P(A wins best-of-5 match) given P(A wins one game) = g."""
    return g**3 + 3 * g**3 * (1 - g) + 6 * g**3 * (1 - g)**2


def p_win_from_state(g: float, games_a: int, games_b: int, best_of: int = 5) -> float:
    """
    P(A wins the match) given the current in-match game score.

    Args:
        g        : per-game win probability for A (from predict_score)
        games_a  : games A has won so far
        games_b  : games B has won so far
        best_of  : 5 for best-of-5 (first to 3), 7 for best-of-7, etc.

    Returns probability in [0, 1].

    Example:
        g = 0.55 (pre-match 65% favourite)
        After losing game 1: p_win_from_state(0.55, 0, 1) → 0.42
        After winning game 2 (1-1): p_win_from_state(0.55, 1, 1) → 0.58
    """
    needed = (best_of + 1) // 2   # 3 for best-of-5
    memo: dict[tuple, float] = {}

    def dp(a: int, b: int) -> float:
        if a >= needed:
            return 1.0
        if b >= needed:
            return 0.0
        if (a, b) in memo:
            return memo[(a, b)]
        v = g * dp(a + 1, b) + (1 - g) * dp(a, b + 1)
        memo[(a, b)] = v
        return v

    return dp(games_a, games_b)


def p_win_current_game(p: float, pts_a: int, pts_b: int) -> float:
    """
    P(A wins the current game) given the live point score (pts_a, pts_b).

    Uses the same per-point win probability p as the Markov chain.
    Handles normal play (first to 11, win by 2) and deuce (both >= 10).

    Args:
        p     : per-point win probability for A (from predict_score['p_point'])
        pts_a : points A has scored so far in this game
        pts_b : points B has scored so far in this game
    """
    memo: dict[tuple, float] = {}

    def dp(a: int, b: int) -> float:
        if a >= 11 and a - b >= 2:
            return 1.0
        if b >= 11 and b - a >= 2:
            return 0.0
        # Exact deuce — closed form to avoid infinite recursion
        if a >= 10 and b >= 10 and a == b:
            return p ** 2 / (p ** 2 + (1 - p) ** 2)
        if (a, b) in memo:
            return memo[(a, b)]
        v = p * dp(a + 1, b) + (1 - p) * dp(a, b + 1)
        memo[(a, b)] = v
        return v

    return dp(pts_a, pts_b)


def p_win_live(g: float, p_point: float,
               games_a: int, games_b: int,
               pts_a: int, pts_b: int,
               best_of: int = 5) -> float:
    """
    P(A wins the match) given a fully live in-match state.

    Chains two levels:
      1. P(A wins current game from pts_a - pts_b)  [point Markov]
      2. P(A wins match if they win/lose this game)  [game Markov]

    Args:
        g       : per-game win probability for A (from predict_score['g'])
        p_point : per-point win probability for A (from predict_score['p_point'])
        games_a : completed games won by A so far
        games_b : completed games won by B so far
        pts_a   : points A has in the current (unfinished) game
        pts_b   : points B has in the current (unfinished) game
        best_of : 5 (default) for best-of-5

    Example:
        Korea leads 2-2 in games, current game score 2-5 to Japan
        g=0.50, p_point=0.495
        p_win_live(0.50, 0.495, 2, 2, 2, 5) → ~0.30
    """
    p_cur  = p_win_current_game(p_point, pts_a, pts_b)
    p_win  = p_win_from_state(g, games_a + 1, games_b, best_of)
    p_lose = p_win_from_state(g, games_a, games_b + 1, best_of)
    return p_cur * p_win + (1 - p_cur) * p_lose


def _markov_p_game(p: float) -> float:
    """
    P(A wins one TT game to 11, win-by-2) given per-point win probability p.

    Non-deuce: A wins 11-k (k=0..9)  → C(10+k,k) × p^11 × (1-p)^k
    Deuce:     both reach 10-10      → P(deuce) × p²/(p²+(1-p)²)
    """
    non_deuce = sum(
        math.comb(10 + k, k) * p**11 * (1 - p)**k
        for k in range(10)
    )
    p_deuce = math.comb(20, 10) * p**10 * (1 - p)**10
    p_win_from_deuce = p**2 / (p**2 + (1 - p)**2)
    return non_deuce + p_deuce * p_win_from_deuce


def _point_score_dist(p: float, max_deuce_extra: int = 20) -> dict:
    """
    Full distribution of per-game point scores {(pts_a, pts_b): probability}.

    Covers all non-deuce outcomes (11-0 … 11-9, 0-11 … 9-11) plus deuce
    games (12-10, 13-11, … up to max_deuce_extra rallies past 10-10).
    """
    dist = {}
    # Non-deuce: A wins 11-k
    for k in range(10):
        dist[(11, k)] = math.comb(10 + k, k) * p**11 * (1 - p)**k
    # Non-deuce: B wins k-11
    for k in range(10):
        dist[(k, 11)] = math.comb(10 + k, k) * (1 - p)**11 * p**k
    # Deuce outcomes
    p_reach_deuce = math.comb(20, 10) * p**10 * (1 - p)**10
    for n in range(max_deuce_extra):
        p_rally = (2 * p * (1 - p)) ** n
        dist[(12 + n, 10 + n)] = p_reach_deuce * p_rally * p**2         # A wins
        dist[(10 + n, 12 + n)] = p_reach_deuce * p_rally * (1 - p)**2   # B wins
    return dist


# ── Build training data ───────────────────────────────────────────────────────

def build_training_data(supabase, gender_filter=None):
    """
    Replay all matches chronologically.
    - Updates Elo for EVERY match (accurate ratings).
    - Adds to training set only for adult professional events (K >= MIN_K_TRAINING).
    """
    # ── Load supporting data ──────────────────────────────────────────────────
    profiles     = load_player_profiles(supabase)
    event_meta   = load_event_meta(supabase)
    rank_timeline = load_rankings(supabase, gender_filter)

    # ── Fetch all matches ─────────────────────────────────────────────────────
    all_matches = []
    page, size = 0, 1000
    print("[Model] Fetching matches from DB...")
    while True:
        q = (
            supabase.table("wtt_matches_singles")
            .select("comp1_id,comp2_id,result,match_score,game_scores,event_id,event_date")
            .not_.is_("result", "null")
            .not_.is_("comp1_id", "null")
            .not_.is_("comp2_id", "null")
            .order("event_date")
            .range(page * size, page * size + size - 1)
            .execute()
        )
        if not q.data:
            break
        all_matches.extend(q.data)
        if len(q.data) < size:
            break
        page += 1

    print(f"[Model] {len(all_matches)} matches loaded.")

    # ── Per-player state (rebuilt chronologically) ─────────────────────────────
    elo      = {}
    elo_hist = defaultdict(lambda: deque(maxlen=30))

    # recent[pid]: deque of (won, game_frac, point_frac, expected_prob) — all adult events
    recent     = defaultdict(lambda: deque(maxlen=10))
    # recent_big[pid]: same, but only elite events (K >= BIG_EVENT_K)
    recent_big = defaultdict(lambda: deque(maxlen=10))

    # clutch_rec[pid]: deque of (won_deciding_match, elo_expected) — only deciding games
    # maxlen=15: ~30-50% of adult matches go to a deciding game, so 15 slots ≈ last 30-50 matches
    clutch_rec = defaultdict(lambda: deque(maxlen=15))

    # deuce_rec[pid]: deque of (won_deuce_game, elo_expected_at_match) — individual deuce games
    # maxlen=30: deuce games are ~15-25% of all games; 30 slots ≈ last 30-50 matches
    deuce_rec = defaultdict(lambda: deque(maxlen=30))

    # elo_recent[pid]: Elo computed from matches in the last RECENT_CUTOFF_DAYS only
    # Captures current ability, not historical reputation
    elo_recent: dict[int, float] = {}
    recent_cutoff_ord = (date.today() - timedelta(days=RECENT_CUTOFF_DAYS)).toordinal()

    # form_hist[pid]: chronological list of (date_ord, won, game_frac, point_frac, elo_expected)
    # Used to compute time-windowed form (3-month, 6-month) — adult events only (K ≥ 20)
    form_hist: dict[int, list] = defaultdict(list)

    # h2h_elite_rec[a][b]: H2H record at elite events only (K ≥ 28)
    h2h_elite_rec = defaultdict(lambda: defaultdict(lambda: {"w": 0, "l": 0, "exp": 0.0}))

    # h2h_rec[a][b]: {w, l, exp_sum}
    h2h_rec = defaultdict(lambda: defaultdict(lambda: {"w": 0, "l": 0, "exp": 0.0}))

    def get_elo(pid):
        return elo.setdefault(pid, INITIAL_ELO)

    def form_residual(pid):
        r = recent[pid]
        return sum((1.0 if won else 0.0) - exp for won, _, _, exp in r) / len(r) if r else 0.0

    def form_big_residual(pid):
        r = recent_big[pid]
        return sum((1.0 if won else 0.0) - exp for won, _, _, exp in r) / len(r) if r else 0.0

    def clutch_res(pid):
        """Win rate in deciding games minus Elo-expected win rate in those matches."""
        r = clutch_rec[pid]
        return sum((1.0 if won else 0.0) - exp for won, exp in r) / len(r) if r else 0.0

    def deuce_res(pid):
        """Win rate in deuce games minus match Elo-expected (proxy for per-game expected)."""
        r = deuce_rec[pid]
        return sum((1.0 if won else 0.0) - exp for won, exp in r) / len(r) if r else 0.0

    def form_ndays_residual(pid, match_date_ord: int, days: int) -> float:
        """Win rate residual over the last `days` days before match_date_ord."""
        cutoff = match_date_ord - days
        recent = [
            (won, exp) for d, won, _gf, _pf, exp in form_hist[pid]
            if cutoff <= d < match_date_ord
        ]
        if not recent:
            return 0.0
        return sum((1.0 if won else 0.0) - exp for won, exp in recent) / len(recent)

    def h2h_elite_res(pid_a, pid_b) -> float:
        """H2H residual at elite events only (K ≥ 28)."""
        rec = h2h_elite_rec[pid_a][pid_b]
        total = rec["w"] + rec["l"]
        if total == 0:
            return 0.0
        actual_rate  = (rec["w"] + 0.5) / (total + 1.0)
        expected_rate = rec["exp"] / total
        return actual_rate - expected_rate

    def point_residual(pid):
        r = recent[pid]
        return sum(pf - exp for _, _, pf, exp in r) / len(r) if r else 0.0

    def h2h_res(pid_a, pid_b):
        rec = h2h_rec[pid_a][pid_b]
        total = rec["w"] + rec["l"]
        if total == 0:
            return 0.0
        actual_rate  = (rec["w"] + 0.5) / (total + 1.0)   # Bayesian smoothed
        expected_rate = rec["exp"] / total
        return actual_rate - expected_rate

    def elo_trend(pid):
        hist = elo_hist[pid]
        return get_elo(pid) - hist[0] if len(hist) >= 5 else 0.0

    # ── Replay ────────────────────────────────────────────────────────────────
    X, y, meta = [], [], []
    skipped_gender = 0
    skipped_tier   = 0

    for m in all_matches:
        p1, p2   = m["comp1_id"], m["comp2_id"]
        result   = m["result"]
        ms       = m.get("match_score") or ""
        gs       = m.get("game_scores") or ""
        event_id = m["event_id"]

        if not p1 or not p2 or result not in ("W", "L"):
            continue
        if p1 >= 1_000_000 or p2 >= 1_000_000:
            continue

        # Gender filter
        if gender_filter:
            g1 = profiles.get(p1, {}).get("gender")
            g2 = profiles.get(p2, {}).get("gender")
            if g1 != gender_filter or g2 != gender_filter:
                skipped_gender += 1
                # Still update Elo for accuracy
                e1, e2 = get_elo(p1), get_elo(p2)
                exp1 = _expected(e1, e2)
                evmeta = event_meta.get(event_id, {})
                event_type = evmeta.get("event_type")
                try:
                    edate = date.fromisoformat(m["event_date"]) if m["event_date"] else None
                except (ValueError, TypeError):
                    edate = None
                k  = _k_factor(event_type, edate)
                s1 = _fractional_score(ms or None, result)
                elo[p1] = e1 + k * (s1 - exp1)
                elo[p2] = e2 + k * ((1 - s1) - (1 - exp1))
                continue

        # Event metadata
        evmeta     = event_meta.get(event_id, {})
        event_type = evmeta.get("event_type")
        event_country = evmeta.get("country")   # normalized 3-letter code or None

        try:
            event_date = date.fromisoformat(m["event_date"]) if m["event_date"] else None
        except (ValueError, TypeError):
            event_date = None

        e1, e2 = get_elo(p1), get_elo(p2)
        exp1   = _expected(e1, e2)

        # Tier check: decide whether to add to training set
        tier_k    = _event_k(event_type)
        is_adult  = tier_k >= MIN_K_TRAINING
        if not is_adult:
            skipped_tier += 1

        if is_adult:
            # ── Rankings features ─────────────────────────────────────────────
            date_ord = event_date.toordinal() if event_date else 0
            r1, rc1  = get_rank_at(p1, date_ord, rank_timeline)
            r2, rc2  = get_rank_at(p2, date_ord, rank_timeline)

            # ── Recent Elo (last 18 months) ───────────────────────────────────
            er1 = elo_recent.get(p1, INITIAL_ELO)
            er2 = elo_recent.get(p2, INITIAL_ELO)

            # log_rank_diff = log(rank_B) - log(rank_A)  (positive → A better ranked)
            # Log scale: gap between rank 1 and 2 >> gap between rank 100 and 101
            _r1 = r1 if r1 is not None else 400.0
            _r2 = r2 if r2 is not None else 400.0
            log_rank_diff = math.log(_r2) - math.log(_r1)

            # rank_change_diff = rc_B - rc_A (rank_change: negative = improved)
            # positive rc_A means A's rank got worse → rc_B - rc_A negative = bad for A
            rc1_safe = rc1 if rc1 is not None else 0.0
            rc2_safe = rc2 if rc2 is not None else 0.0
            rank_change_diff = rc2_safe - rc1_safe

            # ── Physiology: age ───────────────────────────────────────────────
            dob1 = profiles.get(p1, {}).get("dob")
            dob2 = profiles.get(p2, {}).get("dob")
            age1 = age_at(dob1, event_date) if event_date else None
            age2 = age_at(dob2, event_date) if event_date else None
            if age1 is not None and age2 is not None:
                age_diff = age1 - age2
            else:
                age_diff = 0.0   # unknown → neutral

            # ── Style: handedness (+1 if A=LH, B=RH; −1 vice versa; 0 same) ─
            h1 = 1 if profiles.get(p1, {}).get("handedness") == "LH" else 0
            h2 = 1 if profiles.get(p2, {}).get("handedness") == "LH" else 0
            handedness_diff = h1 - h2

            features = [
                e1 - e2,                                                  # elo_diff
                er1 - er2,                                                # elo_recent_diff
                log_rank_diff,
                rank_change_diff,
                age_diff,
                form_big_residual(p1) - form_big_residual(p2),           # elite form count
                form_residual(p1)     - form_residual(p2),               # all-adult form count
                form_ndays_residual(p1, date_ord, 90)  - form_ndays_residual(p2, date_ord, 90),   # 3m
                form_ndays_residual(p1, date_ord, 180) - form_ndays_residual(p2, date_ord, 180),  # 6m
                point_residual(p1)    - point_residual(p2),
                h2h_res(p1, p2),
                h2h_elite_res(p1, p2),
                clutch_res(p1)        - clutch_res(p2),
                handedness_diff,
                deuce_res(p1)         - deuce_res(p2),                   # deuce game resilience
            ]
            X.append(features)
            y.append(1 if result == "W" else 0)
            meta.append({"p1": p1, "p2": p2, "event_id": event_id, "event_date": m["event_date"]})

        # ── Update state for ALL matches (keeps Elo accurate) ─────────────────
        k  = _k_factor(event_type, event_date)
        s1 = _fractional_score(ms or None, result)

        new_e1 = e1 + k * (s1 - exp1)
        new_e2 = e2 + k * ((1 - s1) - (1 - exp1))
        elo[p1], elo[p2] = new_e1, new_e2

        won = (result == "W")

        # Game fraction (comp1 perspective)
        clean_ms = str(ms).strip()
        if clean_ms and "-" in clean_ms and " " not in clean_ms:
            try:
                gw, gl = int(clean_ms.split("-")[0]), int(clean_ms.split("-")[1])
                tot = gw + gl
                gf1 = gw / tot if tot > 0 else (1.0 if won else 0.0)
            except (ValueError, IndexError):
                gf1 = 1.0 if won else 0.0
        else:
            gf1 = 1.0 if won else 0.0

        # Point fraction
        pf1_raw = parse_point_frac(gs)
        pf1 = pf1_raw if pf1_raw is not None else gf1  # fallback to game fraction

        # Update deques
        recent[p1].append((won,       gf1,       pf1,       exp1))
        recent[p2].append((not won,   1.0 - gf1, 1.0 - pf1, 1.0 - exp1))
        if tier_k >= BIG_EVENT_K:
            recent_big[p1].append((won,     gf1,       pf1,       exp1))
            recent_big[p2].append((not won, 1.0 - gf1, 1.0 - pf1, 1.0 - exp1))

        # Recent Elo: update only for matches within the recency window
        if event_date and event_date.toordinal() >= recent_cutoff_ord:
            er1_cur = elo_recent.get(p1, INITIAL_ELO)
            er2_cur = elo_recent.get(p2, INITIAL_ELO)
            exp_r1  = _expected(er1_cur, er2_cur)
            elo_recent[p1] = er1_cur + k * (s1 - exp_r1)
            elo_recent[p2] = er2_cur + k * ((1 - s1) - (1 - exp_r1))

        # Time-windowed form: store timestamped entry for adult matches
        if is_adult and event_date:
            form_hist[p1].append((event_date.toordinal(), won,       gf1,       pf1,       exp1))
            form_hist[p2].append((event_date.toordinal(), not won,   1.0 - gf1, 1.0 - pf1, 1.0 - exp1))

        # Elite H2H: update only for K ≥ 28 events
        if tier_k >= BIG_EVENT_K:
            h2h_elite_rec[p1][p2]["w" if won else "l"] += 1
            h2h_elite_rec[p1][p2]["exp"] += exp1
            h2h_elite_rec[p2][p1]["l" if won else "w"] += 1
            h2h_elite_rec[p2][p1]["exp"] += 1.0 - exp1

        # Clutch: update only when match went to a deciding game
        if is_deciding_match(ms):
            clutch_rec[p1].append((won,       exp1))
            clutch_rec[p2].append((not won,   1.0 - exp1))

        # Deuce games: update per deuce game found in game_scores
        for p1_won_deuce in parse_deuce_games(gs):
            deuce_rec[p1].append((p1_won_deuce,       exp1))
            deuce_rec[p2].append((not p1_won_deuce,   1.0 - exp1))

        elo_hist[p1].append(new_e1)
        elo_hist[p2].append(new_e2)
        h2h_rec[p1][p2]["w" if won else "l"] += 1
        h2h_rec[p1][p2]["exp"] += exp1
        h2h_rec[p2][p1]["l" if won else "w"] += 1
        h2h_rec[p2][p1]["exp"] += 1.0 - exp1

    adult_total = len(X)
    print(f"[Model] {adult_total} adult-event training examples built.")
    print(f"[Model] Filtered: {skipped_tier} low-tier matches, {skipped_gender} wrong-gender.")

    # ── Final player states (for inference) ───────────────────────────────────
    player_states = {}
    for pid in elo:
        pr = profiles.get(pid, {})
        today_ord = date.today().toordinal()
        player_states[pid] = {
            "elo":                 elo[pid],
            "elo_recent":          elo_recent.get(pid, INITIAL_ELO),
            "elo_trend":           elo_trend(pid),
            "form_residual":       form_residual(pid),
            "form_big_residual":   form_big_residual(pid),
            "form_3m_residual":    form_ndays_residual(pid, today_ord, 90),
            "form_6m_residual":    form_ndays_residual(pid, today_ord, 180),
            "point_residual":      point_residual(pid),
            "clutch_residual":     clutch_res(pid),
            "deuce_residual":      deuce_res(pid),
            "country_code":        pr.get("country_code"),
            "dob":                 pr.get("dob"),
            "handedness":          pr.get("handedness"),
        }

    # ── H2H residuals for inference (save only pairs with ≥2 meetings) ────────
    # Fixes the critical gap where H2H was always 0.0 at inference time.
    h2h_saved = {
        f"{pa}_{pb}": round(h2h_res(pa, pb), 6)
        for pa, opponents in h2h_rec.items()
        for pb, rec in opponents.items()
        if rec["w"] + rec["l"] >= 2
    }
    h2h_elite_saved = {
        f"{pa}_{pb}": round(h2h_elite_res(pa, pb), 6)
        for pa, opponents in h2h_elite_rec.items()
        for pb, rec in opponents.items()
        if rec["w"] + rec["l"] >= 1  # elite H2H is rare — save from 1 meeting
    }
    print(f"[Model] H2H pairs saved: {len(h2h_saved)} all-events, "
          f"{len(h2h_elite_saved)} elite-only.")

    # Snapshot of most-recent rank per player (for inference)
    today_ord = date.today().toordinal()
    rank_snapshot = {}
    for pid, tl in rank_timeline.items():
        r, rc = get_rank_at(pid, today_ord, {pid: tl})
        if r is not None:
            rank_snapshot[pid] = {"rank": r, "rank_change": rc or 0.0}

    return (np.array(X), np.array(y), meta,
            player_states, h2h_saved, h2h_elite_saved, rank_snapshot)


# ── Train & evaluate ──────────────────────────────────────────────────────────

def train_and_evaluate(X, y, meta, test_event_ids=None, lr_C=1.0):
    if test_event_ids:
        test_set   = set(test_event_ids)
        test_mask  = np.array([m["event_id"] in test_set for m in meta])
        train_mask = ~test_mask
    else:
        split = int(0.8 * len(X))
        train_mask = np.zeros(len(X), dtype=bool)
        train_mask[:split] = True
        test_mask  = ~train_mask

    X_train, y_train = X[train_mask], y[train_mask]
    X_test,  y_test  = X[test_mask],  y[test_mask]
    meta_train = [meta[i] for i, m in enumerate(train_mask) if m]

    if len(X_test) == 0:
        print("[!] No test examples found for that event. Check event ID.")
        return None, None, None, False

    # ── Bidirectional augmentation ────────────────────────────────────────────
    # All features are A-B differences → flipping signs gives B-A perspective.
    # Doubles training set and guarantees model symmetry: P(A>B) + P(B>A) = 1.
    X_train_aug = np.vstack([X_train, -X_train])
    y_train_aug = np.hstack([y_train, 1 - y_train])

    # ── Recency weighting (3-year half-life) ─────────────────────────────────
    HALF_LIFE_DAYS = 3 * 365
    TODAY_ORD = date.today().toordinal()

    def recency_weight(event_date_str: str) -> float:
        try:
            d = date.fromisoformat(event_date_str)
            days_ago = max(0, TODAY_ORD - d.toordinal())
            return math.exp(-math.log(2) * days_ago / HALF_LIFE_DAYS)
        except Exception:
            return 1.0

    w_train = np.array([recency_weight(m.get("event_date", "")) for m in meta_train])
    w_train_aug = np.hstack([w_train, w_train])  # same weight for both directions

    print(f"\n  Train: {len(X_train)} × 2 (bidirectional) = {len(X_train_aug)} | Test: {len(X_test)}")

    elo_acc = accuracy_score(y_test, (X_test[:, 0] >= 0).astype(int))

    # ── Logistic Regression (primary — best on small datasets) ───────────────
    scaler = StandardScaler()
    Xtr_s  = scaler.fit_transform(X_train_aug)
    Xte_s  = scaler.transform(X_test)
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=FutureWarning, module="sklearn")
        warnings.filterwarnings("ignore", category=UserWarning, module="sklearn")
        lr = LogisticRegression(penalty="l1", solver="liblinear", max_iter=2000, C=lr_C)
        lr.fit(Xtr_s, y_train_aug, sample_weight=w_train_aug)
    lr_acc  = accuracy_score(y_test, lr.predict(Xte_s))
    lr_ll   = log_loss(y_test, lr.predict_proba(Xte_s))

    # ── HistGradientBoosting (non-linear — needs more data to beat LR) ───────
    hgbt = HistGradientBoostingClassifier(
        max_iter=200, learning_rate=0.05, max_depth=3,
        min_samples_leaf=40, l2_regularization=5.0, random_state=42
    )
    hgbt.fit(X_train_aug, y_train_aug, sample_weight=w_train_aug)
    hgbt_acc = accuracy_score(y_test, hgbt.predict(X_test))

    # HistGBT needs a clear margin to be chosen — at this dataset size it tends
    # to overfit and produces miscalibrated probabilities on unseen data even
    # when it narrows wins on training accuracy.  Require ≥3% margin.
    primary_is_hgbt = hgbt_acc >= lr_acc + 0.03
    primary_acc     = hgbt_acc if primary_is_hgbt else lr_acc
    primary_name    = "HistGBT" if primary_is_hgbt else "Logistic Regression"

    print(f"\n  {'Metric':<44} Value")
    print(f"  {'─'*54}")
    print(f"  {'Elo-only baseline':<44} {100*elo_acc:.1f}%")
    print(f"  {'Logistic Regression':<44} {100*lr_acc:.1f}%  ({100*(lr_acc-elo_acc):+.1f}%)")
    print(f"  {'HistGradientBoosting':<44} {100*hgbt_acc:.1f}%  ({100*(hgbt_acc-elo_acc):+.1f}%)")
    print(f"  {'Primary model → ' + primary_name:<44} {100*primary_acc:.1f}%")
    print(f"  {'Log-loss (primary)':<44} {lr_ll:.4f}")

    # ── Feature coefficients (LR — always interpretable) ─────────────────────
    coefs = lr.coef_[0]
    systems = [
        "Elo (all-time)", "Elo (18-month)", "Rankings", "Rankings",
        "Physiology", "Form/count (elite)",
        "Form/count (all)", "Form/time (3m)", "Form/time (6m)",
        "Form/count (pts)", "H2H (all)", "H2H (elite)", "Mental/Clutch",
        "Style/Handedness", "Mental/Deuce",
    ]
    print(f"\n  LR coefficients (L1 — zeroed = no signal beyond Elo):")
    print(f"  {'Feature':<28} {'Coeff':>9}   System")
    print(f"  {'─'*62}")
    for (name, coef), sys_name in sorted(
        zip(zip(FEATURE_NAMES, coefs), systems), key=lambda x: -abs(x[0][1])
    ):
        if abs(coef) < 0.001:
            print(f"  {name:<28} {'— zeroed':>9}   {sys_name}")
        else:
            bar  = "█" * max(1, int(abs(coef) * 10))
            sign = "▲" if coef > 0 else "▼"
            print(f"  {name:<28} {coef:>+9.4f}   {sys_name:<22} {sign} {bar}")

    # ── Calibration (primary model) ───────────────────────────────────────────
    primary_model = hgbt if primary_is_hgbt else lr
    probs = (primary_model.predict_proba(X_test)[:, 1]
             if primary_is_hgbt else
             primary_model.predict_proba(Xte_s)[:, 1])
    print(f"\n  Calibration ({primary_name} — confidence → actual win rate):")
    print(f"  {'Confidence':<14} {'N matches':>10}  {'Actual win%':>12}")
    print(f"  {'─'*40}")
    for lo, hi in [(0.9, 1.0), (0.75, 0.9), (0.6, 0.75), (0.5, 0.6)]:
        p_fav = np.maximum(probs, 1 - probs)
        mask  = (p_fav >= lo) & (p_fav < hi)
        n     = mask.sum()
        if n > 0:
            actual_fav_won = np.where(probs >= 0.5, y_test, 1 - y_test)
            win_rate = actual_fav_won[mask].mean()
            label = f"{int(lo*100)}-{int(hi*100)}%"
            print(f"  {label:<14} {n:>10}  {win_rate*100:>11.1f}%")

    return hgbt, lr, scaler, primary_is_hgbt


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    # Default held-out set: 10 recent events covering 2025-2026 across all tiers.
    # All are held out simultaneously so every validation match is truly out-of-sample.
    DEFAULT_TEST_EVENTS = [
        3098,   # China Smash 2025 (Grand Smash)
        3110,   # Star Contender London 2025
        3176,   # Star Contender Muscat 2025
        3232,   # Star Contender Doha 2026
        3233,   # Star Contender Chennai 2026
        3234,   # Singapore Smash 2026 (Grand Smash)
        3235,   # WTT Champions Chongqing 2026
        3236,   # WTT Contender Tunis 2026
        3237,   # WTT Contender Taiyuan 2026
        3379,   # ITTF World Cup Macao 2026 (Singles World Cup)
    ]

    parser = argparse.ArgumentParser()
    parser.add_argument("--gender",      choices=["M", "W"], default="M")
    parser.add_argument("--test-events", type=int, nargs="+", default=DEFAULT_TEST_EVENTS,
                        help="Event IDs to hold out as test set (space-separated, all held out simultaneously)")
    args = parser.parse_args()

    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

    print(f"\n{'='*65}")
    print(f"  Feature Model V8 — {'Men' if args.gender == 'M' else 'Women'}")
    print(f"  Features: {len(FEATURE_NAMES)}  |  Test events: {args.test_events}")
    print(f"  Training filter: adult events with K ≥ {MIN_K_TRAINING}")
    print(f"{'='*65}")

    X, y, meta, player_states, h2h_saved, h2h_elite_saved, rank_snapshot = build_training_data(
        supabase, args.gender
    )
    # Per-gender regularization: C=1.0 for Men (more noisy features cancel at C=3.0),
    # C=3.0 for Women (less correlated features, higher-signal data benefits from less shrinkage).
    lr_C = 1.0 if args.gender == "M" else 3.0
    hgbt, lr, scaler, primary_is_hgbt = train_and_evaluate(X, y, meta, args.test_events, lr_C=lr_C)

    if lr is None:
        return

    script_dir = os.path.dirname(__file__)

    # Save LR always (via JSON).  Only keep the hgbt pkl if HistGBT actually won —
    # otherwise delete any stale pkl so MatchPredictor falls back to LR from JSON.
    hgbt_path = os.path.join(script_dir, f"model_hgbt_{args.gender}.pkl")
    if primary_is_hgbt:
        joblib_dump(hgbt, hgbt_path)
        print(f"  Saved HistGBT pkl → {hgbt_path}")
    else:
        if os.path.exists(hgbt_path):
            os.remove(hgbt_path)
            print(f"  Removed stale {os.path.basename(hgbt_path)} — LR is primary (embedded in JSON)")

    # Save player states + LR coefs (used for explain())
    out = {
        "version":          8,
        "gender":           args.gender,
        "trained_on":       str(date.today()),
        "test_event_ids":   args.test_events,
        "feature_names":    FEATURE_NAMES,
        "min_k_training":   MIN_K_TRAINING,
        "big_event_k":      BIG_EVENT_K,
        "recent_cutoff_days": RECENT_CUTOFF_DAYS,
        "n_players":        len(player_states),
        "intercept":        float(lr.intercept_[0]),
        "coefficients":     dict(zip(FEATURE_NAMES, lr.coef_[0].tolist())),
        "scaler_mean":      dict(zip(FEATURE_NAMES, scaler.mean_.tolist())),
        "scaler_scale":     dict(zip(FEATURE_NAMES, scaler.scale_.tolist())),
        "player_states":    {str(pid): s for pid, s in player_states.items()},
        "rank_snapshot":    {str(pid): s for pid, s in rank_snapshot.items()},
        "h2h":              h2h_saved,        # {"{pa}_{pb}": residual} for inference
        "h2h_elite":        h2h_elite_saved,  # same, elite events only
    }

    json_path = os.path.join(script_dir, f"model_weights_{args.gender}.json")
    with open(json_path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\n  Saved → {json_path}\n")


# ── MatchPredictor ────────────────────────────────────────────────────────────

class MatchPredictor:
    """
    Load saved model weights and predict match outcomes with full explanation.

    Usage:
        mp = MatchPredictor.load("M")
        result = mp.explain(thakkar_id, wang_yang_id, "Thakkar", "Wang Yang",
                             event_country="CHN")
        print(f"P(Thakkar wins) = {result['probability']:.1%}")
    """

    def __init__(self, d: dict, hgbt=None):
        self.version      = d.get("version", 1)
        self.intercept    = d["intercept"]
        self.coefs        = d["coefficients"]
        self.means        = d["scaler_mean"]
        self.scales       = d["scaler_scale"]
        self.feat_names   = d["feature_names"]
        self.states       = {int(k): v for k, v in d["player_states"].items()}
        self.rank_snap    = {int(k): v for k, v in d.get("rank_snapshot", {}).items()}
        self._hgbt        = hgbt
        # H2H residuals for inference — loaded from JSON (keyed as "pa_pb")
        self._h2h_all: dict[str, float]   = d.get("h2h", {})
        self._h2h_elite: dict[str, float] = d.get("h2h_elite", {})

    @classmethod
    def load(cls, gender="M", directory=None):
        directory = directory or os.path.dirname(__file__)
        json_path  = os.path.join(directory, f"model_weights_{gender}.json")
        hgbt_path  = os.path.join(directory, f"model_hgbt_{gender}.pkl")
        with open(json_path) as f:
            d = json.load(f)
        hgbt = joblib_load(hgbt_path) if os.path.exists(hgbt_path) else None
        return cls(d, hgbt=hgbt)

    def get_state(self, pid: int) -> dict:
        return self.states.get(pid, {
            "elo": 1450.0, "elo_recent": 1450.0, "elo_trend": 0.0,
            "form_residual": 0.0, "form_big_residual": 0.0,
            "form_3m_residual": 0.0, "form_6m_residual": 0.0,
            "point_residual": 0.0, "clutch_residual": 0.0,
            "deuce_residual": 0.0,
            "country_code": None, "dob": None, "handedness": None,
        })

    def _lookup_h2h(self, pid_a: int, pid_b: int, table: dict) -> float:
        """Look up pre-computed H2H residual (A vs B) from saved JSON table."""
        v = table.get(f"{pid_a}_{pid_b}")
        if v is not None:
            return v
        v = table.get(f"{pid_b}_{pid_a}")
        return -v if v is not None else 0.0

    def _raw_features(self, pid_a: int, pid_b: int,
                      event_country: str | None = None,
                      match_date: date | None = None) -> dict:
        sa = self.get_state(pid_a)
        sb = self.get_state(pid_b)

        # Rankings (log scale)
        ra = self.rank_snap.get(pid_a, {})
        rb = self.rank_snap.get(pid_b, {})
        _ra = ra.get("rank", 400.0) or 400.0
        _rb = rb.get("rank", 400.0) or 400.0
        log_rank_diff    = math.log(_rb) - math.log(_ra)
        rc_a = ra.get("rank_change", 0.0) or 0.0
        rc_b = rb.get("rank_change", 0.0) or 0.0
        rank_change_diff = rc_b - rc_a

        # Age
        ref_date = match_date or date.today()
        age_a = age_at(sa.get("dob"), ref_date)
        age_b = age_at(sb.get("dob"), ref_date)
        age_diff = (age_a - age_b) if (age_a and age_b) else 0.0

        h_a = 1 if sa.get("handedness") == "LH" else 0
        h_b = 1 if sb.get("handedness") == "LH" else 0

        return {
            "elo_diff":               sa["elo"]                          - sb["elo"],
            "elo_recent_diff":        sa.get("elo_recent", sa["elo"])    - sb.get("elo_recent", sb["elo"]),
            "log_rank_diff":          log_rank_diff,
            "rank_change_diff":       rank_change_diff,
            "age_diff":               age_diff,
            "form_big_residual_diff": sa.get("form_big_residual", 0.0)  - sb.get("form_big_residual", 0.0),
            "form_residual_diff":     sa["form_residual"]                - sb["form_residual"],
            "form_3m_residual_diff":  sa.get("form_3m_residual", 0.0)   - sb.get("form_3m_residual", 0.0),
            "form_6m_residual_diff":  sa.get("form_6m_residual", 0.0)   - sb.get("form_6m_residual", 0.0),
            "point_residual_diff":    sa["point_residual"]               - sb["point_residual"],
            "h2h_residual":           self._lookup_h2h(pid_a, pid_b, self._h2h_all),
            "h2h_elite_residual":     self._lookup_h2h(pid_a, pid_b, self._h2h_elite),
            "clutch_residual":        sa.get("clutch_residual", 0.0)    - sb.get("clutch_residual", 0.0),
            "handedness_diff":        h_a - h_b,
            "deuce_residual_diff":    sa.get("deuce_residual", 0.0)     - sb.get("deuce_residual", 0.0),
        }

    def predict(self, pid_a: int, pid_b: int,
                event_country: str | None = None,
                match_date: date | None = None) -> float:
        raw = self._raw_features(pid_a, pid_b, event_country, match_date)
        if self._hgbt is not None:
            X = np.array([[raw.get(f, 0.0) for f in self.feat_names]])
            return float(self._hgbt.predict_proba(X)[0, 1])
        logit = self.intercept
        for feat in self.feat_names:
            val = raw.get(feat, 0.0)
            logit += self.coefs[feat] * (val - self.means[feat]) / self.scales[feat]
        return 1.0 / (1.0 + math.exp(-logit))

    def predict_score(self, pid_a: int, pid_b: int,
                      event_country: str | None = None,
                      match_date: date | None = None) -> dict:
        """
        Returns expected game score + full score distribution for best-of-5.

        Uses Markov inversion: given P(A wins match) from the model, numerically
        finds per-game win probability g, then computes the distribution over all
        six possible scores (3-0, 3-1, 3-2, 2-3, 1-3, 0-3).

        Returns dict with keys:
          p_match  – overall match win probability for A
          g        – per-game win probability for A (inverted from p_match)
          exp_a    – expected games won by A (e.g. 2.8)
          exp_b    – expected games won by B (e.g. 1.2)
          dist     – {score_str: probability} for all six outcomes
          mode     – most likely score string (e.g. "3-1")
        """
        from scipy.optimize import brentq

        p_match = self.predict(pid_a, pid_b, event_country, match_date)
        p_clipped = max(0.001, min(0.999, p_match))

        # ── Level 1: match → game probability (brentq #1) ────────────────
        g = brentq(lambda g: _markov_p_match(g) - p_clipped, 0.001, 0.999)

        p30 = g**3
        p31 = 3 * g**3 * (1 - g)
        p32 = 6 * g**3 * (1 - g)**2
        p23 = 6 * (1 - g)**3 * g**2
        p13 = 3 * (1 - g)**3 * g
        p03 = (1 - g)**3

        exp_a = 3*p30 + 3*p31 + 3*p32 + 2*p23 + 1*p13 + 0*p03
        exp_b = 0*p30 + 1*p31 + 2*p32 + 3*p23 + 3*p13 + 3*p03

        dist = {"3-0": p30, "3-1": p31, "3-2": p32,
                "2-3": p23, "1-3": p13, "0-3": p03}
        mode = max(dist, key=dist.__getitem__)

        # ── Level 2: game → point probability (brentq #2) ─────────────────
        # Find p such that _markov_p_game(p) = g
        g_safe = max(0.001, min(0.999, g))
        p_point = brentq(lambda p: _markov_p_game(p) - g_safe, 0.001, 0.999)

        # Full per-game point score distribution
        pt_dist = _point_score_dist(p_point)

        # Expected points per game (averaged over all game outcomes)
        exp_pts_a = sum(pa * pr for (pa, _pb), pr in pt_dist.items())
        exp_pts_b = sum(pb * pr for (_pa, pb), pr in pt_dist.items())

        # Most likely individual game score (from A's perspective)
        pt_mode_pair = max(pt_dist, key=pt_dist.__getitem__)
        pt_mode = f"{pt_mode_pair[0]}-{pt_mode_pair[1]}"

        return {
            "p_match":   p_match,
            "g":         g,
            "exp_a":     exp_a,
            "exp_b":     exp_b,
            "dist":      dist,
            "mode":      mode,
            # Point-level additions
            "p_point":   p_point,       # P(A wins a single point)
            "exp_pts_a": exp_pts_a,     # expected points won by A per game
            "exp_pts_b": exp_pts_b,     # expected points won by B per game
            "pt_dist":   pt_dist,       # {(pts_a, pts_b): prob} full distribution
            "pt_mode":   pt_mode,       # most likely per-game score e.g. "11-8"
        }

    def explain(self, pid_a: int, pid_b: int,
                name_a: str = "A", name_b: str = "B",
                event_country: str | None = None,
                match_date: date | None = None) -> dict:
        sa  = self.get_state(pid_a)
        sb  = self.get_state(pid_b)
        raw = self._raw_features(pid_a, pid_b, event_country, match_date)

        contributions = {}
        logit = self.intercept
        for feat in self.feat_names:
            val = raw.get(feat, 0.0)
            c   = self.coefs[feat] * (val - self.means[feat]) / self.scales[feat]
            contributions[feat] = c
            logit += c
        p = 1.0 / (1.0 + math.exp(-logit))

        ra = self.rank_snap.get(pid_a, {})
        rb = self.rank_snap.get(pid_b, {})

        # HistGBT probability (primary)
        hgbt_p = self.predict(pid_a, pid_b, event_country, match_date)

        print(f"\n  {name_a}  vs  {name_b}")
        print(f"  {'─'*60}")
        print(f"  {'Attribute':<26} {name_a:>16}   {name_b:>16}")
        print(f"  {'─'*60}")
        print(f"  {'Elo (all-time)':<26} {sa['elo']:>16.0f}   {sb['elo']:>16.0f}")
        print(f"  {'Elo (18-month)':<26} {sa.get('elo_recent', sa['elo']):>16.0f}   {sb.get('elo_recent', sb['elo']):>16.0f}")
        print(f"  {'World ranking':<26} {ra.get('rank', '?'):>16}   {rb.get('rank', '?'):>16}")
        print(f"  {'Rank change (week)':<26} {ra.get('rank_change', '?'):>+16}   {rb.get('rank_change', '?'):>+16}")
        print(f"  {'Form (all, last 10)':<26} {sa['form_residual']:>+16.3f}   {sb['form_residual']:>+16.3f}")
        print(f"  {'Form (elite, last 10)':<26} {sa.get('form_big_residual', 0):>+16.3f}   {sb.get('form_big_residual', 0):>+16.3f}")
        print(f"  {'Form (last 3 months)':<26} {sa.get('form_3m_residual', 0):>+16.3f}   {sb.get('form_3m_residual', 0):>+16.3f}")
        print(f"  {'Form (last 6 months)':<26} {sa.get('form_6m_residual', 0):>+16.3f}   {sb.get('form_6m_residual', 0):>+16.3f}")
        print(f"  {'Point residual':<26} {sa['point_residual']:>+16.3f}   {sb['point_residual']:>+16.3f}")
        print(f"  {'Clutch residual':<26} {sa.get('clutch_residual', 0):>+16.3f}   {sb.get('clutch_residual', 0):>+16.3f}")
        h2h_e = raw.get("h2h_elite_residual", 0.0)
        if abs(h2h_e) > 0.001:
            print(f"  {'H2H elite residual':<26} {h2h_e:>+16.3f}   {'(A vs B)':>16}")
        print(f"\n  Feature contributions (Logistic Regression — approximate drivers):")
        print(f"  {'─'*52}")
        for feat, c in sorted(contributions.items(), key=lambda x: -abs(x[1])):
            if abs(c) < 0.001:
                continue
            bar  = "█" * max(1, int(abs(c) * 20))
            sign = "▲" if c >= 0 else "▼"
            print(f"    {feat:<28} {c:>+.3f}  {sign} {bar}")

        primary_label = "HistGBT" if self._hgbt is not None else "Logistic Regression"
        print(f"\n  P({name_a} wins) = {hgbt_p*100:.1f}%  [{primary_label} — primary]")
        if self._hgbt is not None:
            print(f"  P({name_a} wins) = {p*100:.1f}%  [Logistic Regression — for drivers above]\n")
        else:
            print()
        return {"probability": hgbt_p, "lr_probability": p, "contributions": contributions, "features": raw}


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(__file__))
    main()
