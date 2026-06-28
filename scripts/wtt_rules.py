"""
wtt_rules.py — Handbook rule tables (WTT Series & Feeder 2026, Youth 2026).

Single source of truth for:
  - event TIER detection from the event name
  - match format (best-of-N) per tier / discipline / round
  - main-draw structure (size -> seeds) for projection

Everything here is a plain lookup so the simulator never guesses formats.
Disciplines used across the codebase: 'singles', 'doubles', 'mixed', 'team'
(youth variants reuse the same discipline keys with a youth tier).
"""

from __future__ import annotations

# ── Tier detection ──────────────────────────────────────────────────────────

def detect_tier(event_name: str) -> str:
    """Return a tier key from a WTT event name."""
    n = (event_name or "").lower()
    youth = "youth" in n
    if "smash" in n:
        return "youth_grand_smash" if youth else "grand_smash"
    if "finals" in n:
        return "finals"
    if "champions" in n:
        return "champions"
    if "star contender" in n:
        return "youth_star_contender" if youth else "star_contender"
    if "contender" in n:
        return "youth_contender" if youth else "contender"
    if "feeder" in n:
        return "feeder"
    if "world championship" in n or "wttc" in n:
        return "team"
    return "contender"  # safe default


# ── Match format (best-of-N) ────────────────────────────────────────────────
# Round labels (entry -> final): R128, R64, R48, R32, R24, R16, QF, SF, F

_BO7_ROUNDS = {"QF", "SF", "F"}


def best_of(tier: str, discipline: str, round_label: str) -> int:
    """Number of games (best-of-N) for a given tier/discipline/round."""
    d = discipline.lower()
    r = round_label.upper()

    # Doubles / mixed are best-of-5 at every senior tier.
    if d in ("doubles", "mixed"):
        return 5

    if d == "singles":
        if tier in ("grand_smash", "champions"):
            return 7 if r in _BO7_ROUNDS else 5
        if tier == "finals":
            return 7
        if tier in ("star_contender", "contender"):
            return 7 if r == "F" else 5
        if tier == "feeder":
            return 5
        # Youth: Star Contender / Contender are all Bo5; Grand Smash default Bo5.
        if tier.startswith("youth"):
            return 5
        return 5

    # Team rubbers default to best-of-5 individual matches.
    if d == "team":
        return 5

    return 5


# ── Main-draw structure (for seed-based projection) ─────────────────────────
# size -> {seeds, byes, draw_sheet}; rounds derived from size.

MAIN_DRAW = {
    8:  {"seeds": 2,  "byes": 0,  "sheet": 8},
    16: {"seeds": 4,  "byes": 0,  "sheet": 16},
    24: {"seeds": 8,  "byes": 8,  "sheet": 32},
    32: {"seeds": 8,  "byes": 0,  "sheet": 32},
    48: {"seeds": 16, "byes": 16, "sheet": 64},
    64: {"seeds": 16, "byes": 0,  "sheet": 64},
}

# round labels for a clean (power-of-two) draw sheet, entry-first.
_SHEET_ROUNDS = {
    8:  ["QF", "SF", "F"],
    16: ["R16", "QF", "SF", "F"],
    32: ["R32", "R16", "QF", "SF", "F"],
    64: ["R64", "R32", "R16", "QF", "SF", "F"],
    128:["R128", "R64", "R32", "R16", "QF", "SF", "F"],
}


def round_labels(first_round_size: int) -> list[str]:
    """Round labels from the first round through the final, given draw size."""
    # use the power-of-two sheet that holds this size
    sheet = 1
    while sheet < first_round_size:
        sheet *= 2
    return _SHEET_ROUNDS.get(sheet, _SHEET_ROUNDS[64])
