"""
wtt_models.py — Discipline models: turn two competitors into P(A wins a match).

A "competitor" is a Competitor (see wtt_schedule): a player (singles) or a
pair/roster (doubles / mixed / team).  Every model exposes the same method:

    model.match_prob(side_a, side_b, best_of) -> float   # P(side_a wins)

so the simulator is identical across disciplines.

  SinglesModel  - uses the trained MatchPredictor directly (the validated path).
  DoublesModel  - pair-Elo aggregation (APPROX until a pair model is trained).
  YouthModel    - seed/ranking based (PLACEHOLDER until youth ratings exist).
  TeamModel     - exact DP over singles rubbers (reuses the singles predictor).

Best-of-N handling: the predictor returns a best-of-5 match probability; we
invert it to a per-game probability and recompute for the target best-of-N,
so Bo7 rounds correctly favour the stronger side.
"""

from __future__ import annotations

import math
from functools import lru_cache

# ── best-of-N conversion ────────────────────────────────────────────────────

def _p_series(g: float, k: int) -> float:
    """P(win a race to k games | per-game win prob g)."""
    return sum(math.comb(k - 1 + l, l) * g**k * (1 - g)**l for l in range(k))


def _invert_g(p: float, k: int = 3) -> float:
    """Per-game prob g such that race-to-k equals p (bisection)."""
    p = min(0.999, max(0.001, p))
    lo, hi = 1e-4, 1 - 1e-4
    for _ in range(60):
        mid = (lo + hi) / 2
        if _p_series(mid, k) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def convert_best_of(p_bo5: float, best_of: int) -> float:
    """Convert a best-of-5 match prob to a best-of-N match prob."""
    if best_of == 5:
        return p_bo5
    g = _invert_g(p_bo5, 3)
    return _p_series(g, (best_of + 1) // 2)


def _elo_logistic(elo_a: float, elo_b: float) -> float:
    return 1.0 / (1.0 + 10 ** ((elo_b - elo_a) / 400.0))


QUALIFIER_PRIOR_ELO = 1700.0   # generic strength for unknown/placeholder players


# ── Singles (validated) ─────────────────────────────────────────────────────

class SinglesModel:
    def __init__(self, predictor, event_country=None, match_date=None):
        self.mp = predictor
        self.country = event_country
        self.date = match_date
        self._cache: dict = {}

    def _elo(self, pid):
        if pid is not None and pid in self.mp.states:
            return self.mp.get_state(pid).get("elo", 1450.0)
        return QUALIFIER_PRIOR_ELO

    def _base_bo5(self, ida, idb) -> float:
        known_a = ida is not None and ida in self.mp.states
        known_b = idb is not None and idb in self.mp.states
        if known_a and known_b:
            return self.mp.predict(ida, idb, self.country, self.date)
        return _elo_logistic(self._elo(ida), self._elo(idb))

    def match_prob(self, a, b, best_of=5) -> float:
        ida = a.player_ids[0] if a.player_ids else None
        idb = b.player_ids[0] if b.player_ids else None
        key = (ida, idb, best_of)
        if key in self._cache:
            return self._cache[key]
        p = convert_best_of(self._base_bo5(ida, idb), best_of)
        self._cache[key] = p
        return p


# ── Doubles / mixed (approximate) ───────────────────────────────────────────

class DoublesModel:
    """
    Pair-Elo aggregation.  elo_fn(player_id) -> Elo (gender-aware for mixed).
    APPROXIMATE: combines partners' singles Elo; replace with a trained pair
    model when available (fetch_doubles_matches.py collects the data).
    """
    def __init__(self, elo_fn):
        self.elo_fn = elo_fn
        self._cache: dict = {}

    def _pair_elo(self, comp) -> float:
        elos = [self.elo_fn(i) if i is not None else QUALIFIER_PRIOR_ELO
                for i in (comp.player_ids or [None])]
        return sum(elos) / len(elos)

    def match_prob(self, a, b, best_of=5) -> float:
        key = (tuple(a.player_ids), tuple(b.player_ids), best_of)
        if key in self._cache:
            return self._cache[key]
        p5 = _elo_logistic(self._pair_elo(a), self._pair_elo(b))
        p = convert_best_of(p5, best_of)
        self._cache[key] = p
        return p


# ── Youth (placeholder) ─────────────────────────────────────────────────────

class YouthModel:
    """
    Seed/ranking based.  PLACEHOLDER until ITTF Youth Ranking + a youth Elo
    model are ingested.  Works for youth singles and youth doubles.
    """
    @staticmethod
    def _seed_elo(comp) -> float:
        seeds = [comp.seed] if comp.seed else []
        if not seeds:
            return 1500.0
        # better seed (smaller number) -> higher Elo
        return 2000.0 - 12.0 * comp.seed

    def match_prob(self, a, b, best_of=5) -> float:
        return convert_best_of(_elo_logistic(self._seed_elo(a), self._seed_elo(b)), best_of)


# ── Team (exact DP over singles rubbers) ────────────────────────────────────

# Default WTTC rubber order (5 singles, first to 3 rubbers wins):
#   R1 A1-B2  R2 A2-B1  R3 A3-B3  R4 A1-B1  R5 A2-B2
_RUBBER_SLOTS = [(0, 1), (1, 0), (2, 2), (0, 0), (1, 1)]


class TeamModel:
    """
    A team tie is decided by singles rubbers; P(team A wins tie) via exact DP.
    Reuses a SinglesModel for each rubber.  Competitor.player_ids holds the
    roster (ordered by strength: index 0 = #1 player, etc.).
    """
    def __init__(self, singles_model, rubber_best_of=5, slots=_RUBBER_SLOTS):
        self.sm = singles_model
        self.bo = rubber_best_of
        self.slots = slots

    @staticmethod
    def _pid(roster, idx):
        return roster[idx] if idx < len(roster) else None

    def _rubber_probs(self, a, b) -> list:
        from wtt_schedule import Competitor
        out = []
        for ia, ib in self.slots:
            pa = Competitor(0, [self._pid(a.player_ids, ia)], [""])
            pb = Competitor(0, [self._pid(b.player_ids, ib)], [""])
            out.append(self.sm.match_prob(pa, pb, self.bo))
        return out

    def match_prob(self, a, b, best_of=5) -> float:
        probs = self._rubber_probs(a, b)
        dp = {(0, 0): 1.0}
        for pk in probs:
            nxt: dict = {}
            for (wa, wb), pr in dp.items():
                if wa == 3 or wb == 3:
                    nxt[(wa, wb)] = nxt.get((wa, wb), 0.0) + pr
                else:
                    nxt[(wa+1, wb)] = nxt.get((wa+1, wb), 0.0) + pr * pk
                    nxt[(wa, wb+1)] = nxt.get((wa, wb+1), 0.0) + pr * (1 - pk)
            dp = nxt
        return sum(p for (wa, _wb), p in dp.items() if wa == 3)


# ── Factory ─────────────────────────────────────────────────────────────────

def make_model(discipline: str, tier: str, predictor_m=None, predictor_w=None,
               event_country=None, match_date=None):
    """
    Build the right model for a (discipline, tier).  Disciplines:
    'singles','doubles','mixed','team'.  Youth tiers route to YouthModel.
    """
    if tier.startswith("youth"):
        return YouthModel()

    if discipline == "singles":
        # caller passes the gendered predictor as predictor_m
        return SinglesModel(predictor_m, event_country, match_date)

    if discipline in ("doubles",):
        elo = (lambda pid: predictor_m.get_state(pid).get("elo", 1450.0)
               if predictor_m and pid in predictor_m.states else QUALIFIER_PRIOR_ELO)
        return DoublesModel(elo)

    if discipline == "mixed":
        def elo(pid):
            for mp in (predictor_m, predictor_w):
                if mp and pid in mp.states:
                    return mp.get_state(pid).get("elo", 1450.0)
            return QUALIFIER_PRIOR_ELO
        return DoublesModel(elo)

    if discipline == "team":
        return TeamModel(SinglesModel(predictor_m, event_country, match_date))

    return SinglesModel(predictor_m, event_country, match_date)
