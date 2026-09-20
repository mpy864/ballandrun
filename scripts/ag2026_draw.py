#!/usr/bin/env python3
"""
ag2026_draw.py — RSC codes, bracket construction, and Monte-Carlo forecasts
for Asian Games 2026 table tennis.

RSC CODES
---------
Every unit at the Games is named by an ODF Result-Set-Code:

    M.SINGLES-----------.R64-.00010000
    |  event key      | |ph| |idx||rb|

  event key   M.SINGLES-----------   gender prefix + event, dash-padded to a fixed width
  phase       R64-                   round within the event
  idx         0001                   the bracket slot, 1-based, ordered
  rb          0000                   0 for a match or a team tie; 1..5 for the rubbers
                                     inside a team tie

Singles keys are padded with trailing dashes (…000100--); team keys are not
(…00010000). Both parse the same way once the tail is normalised.

Verified 2026-09-20: the bracket and the daily schedule agree on 100 of 102 singles
unit keys exactly, with no normalisation needed. The two that differ are the Victory
Ceremonies (…VICT.MEDAL---), which are not matches.

WHERE THE DRAW ACTUALLY LIVES
-----------------------------
Not in the daily schedule. Singles matches sit there as PROVISIONAL with no Home or
Away long after the draw is made. The draw is in brackets/{event_key}, which returns
the full 64-slot tree with names, accreditation ids and IsBye flags.

MEDALS
------
The Asian Games awards two bronzes and plays no third-place match. Reaching the
semi-final IS the medal, so p_medal = reach['SF'], never reach['F'].
"""

import argparse
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ag2026_api as ag
from tg_common import get_db, reported
from wtt_rules import round_labels, best_of as rules_best_of
from wtt_schedule import Competitor, SubEventDraw

FEED = "ag2026-forecast"

SINGLES_EVENTS = ("M.SINGLES-----------", "W.SINGLES-----------")

# The Asian Games is not a WTT tier. detect_tier() would fall through, so state the
# closest analogue explicitly and let unit_best_of() prefer the feed's own Periods
# array over this guess wherever the feed provides one.
AG_TIER = "grand_smash"

# AG phase code -> the round label wtt_rules speaks.
# '8FNL' is eighth-finals, i.e. the round of 16 (the feed calls it "Round 3").
_AG_ROUND = {
    "R128": "R128", "R64": "R64", "R32": "R32", "R16": "R16",
    "16FN": "R32", "8FNL": "R16", "4FNL": "QF",
    "QFNL": "QF", "SFNL": "SF", "FNL": "F", "FNL-": "F",
    "BRNZ": "BM", "BRZ": "BM", "3N4": "BM",
}

_UNMAPPED_SEEN = set()


# ── RSC parsing ──────────────────────────────────────────────────────────────

def parse_rsc(key: str) -> dict:
    """'M.SINGLES-----------.R64-.00010000' -> structured parts.

    Returns {} for anything that is not a three-or-more-segment RSC.
    """
    if not key:
        return {}
    parts = key.split(".")
    if len(parts) < 3:
        return {}

    gender     = parts[0]                          # M | W | X
    event_body = parts[1].rstrip("-")              # SINGLES | TEAM | DOUBLES
    event_key  = ".".join(parts[:2])
    phase_code = parts[2]
    unit       = parts[3] if len(parts) > 3 else ""

    digits = re.sub(r"\D", "", unit)
    match_idx  = int(digits[:4]) if len(digits) >= 4 else None
    rubber_num = int(digits[4:8]) if len(digits) >= 8 else 0

    return {
        "gender":     gender,
        "event_key":  event_key,
        "event_body": event_body,
        "phase_key":  ".".join(parts[:3]),
        "round_code": phase_code.rstrip("-") or phase_code,
        "unit":       unit,
        "match_idx":  match_idx,
        "rubber_num": rubber_num,
        "discipline": discipline_of(event_body),
    }


def discipline_of(event_body: str) -> str:
    b = (event_body or "").upper()
    if "TEAM" in b:
        return "team"
    if "DOUBLES" in b:
        return "doubles"
    if "SINGLES" in b:
        return "singles"
    return b.lower() or "other"


def round_label(round_code: str, phase_desc: str = "") -> str | None:
    """AG phase code -> wtt_rules round label. Unknown codes log once and return
    None; the unit is still stored and shown, it is just left out of brackets."""
    if not round_code:
        return None
    rc = round_code.upper().rstrip("-")
    if rc in _AG_ROUND:
        return _AG_ROUND[rc]
    if rc.startswith("GP"):                        # GPA-, GPB-, GP--  -> group stage
        return "GRP"
    if rc.startswith("VICT"):                      # victory ceremony, not a match
        return None

    # Secondary signal: the human-readable phase description.
    low = (phase_desc or "").lower()
    for needle, lab in (("round of 64", "R64"), ("round of 32", "R32"),
                        ("round of 16", "R16"), ("quarter", "QF"),
                        ("semi", "SF"), ("bronze", "BM"), ("group", "GRP")):
        if needle in low:
            return lab
    if "final" in low:
        return "F"

    if rc not in _UNMAPPED_SEEN:
        _UNMAPPED_SEEN.add(rc)
        print(f"  [ag2026_draw] unknown round code {rc!r} phase={phase_desc!r}")
    return None


def unit_best_of(unit: dict, discipline: str = "singles", label: str = "R64") -> int:
    """Prefer the feed's own Periods array — it is the feed telling you the format.
    Fall back to the WTT rule table only when Periods is missing or implausible."""
    periods = (unit or {}).get("Periods") or []
    if len(periods) in (3, 5, 7):
        return len(periods)
    return rules_best_of(AG_TIER, discipline, label or "R64")


# ── Bracket construction ─────────────────────────────────────────────────────

def _slot_competitor(side: dict, uid: int, ittf_by_reg: dict) -> Competitor:
    """One side of a bracket match -> a Competitor simulate_draw understands.

    A bye or an unfilled slot becomes a placeholder with player_ids [None], which
    simulate_event.simulate_draw auto-advances the opponent past (lines 82-86).
    """
    org  = (side or {}).get("Org") or ""
    name = (side or {}).get("Name") or ""
    reg  = (side or {}).get("Reg") or ""

    if not name or org == "BYE":
        return Competitor(uid=uid, player_ids=[None], names=["BYE"], org="",
                          is_placeholder=True, is_qualifier=False)

    pid = ittf_by_reg.get(reg)
    return Competitor(uid=uid, player_ids=[pid], names=[name], org=org,
                      is_placeholder=pid is None, is_qualifier=False) \
        if pid is not None else \
        Competitor(uid=uid, player_ids=[None], names=[name], org=org,
                   is_placeholder=True, is_qualifier=False)


def build_draw(event_key: str, ittf_by_reg: dict,
               brackets: list | None = None) -> SubEventDraw | None:
    """Build a SubEventDraw from brackets/{event_key}.

    Returns None while the draw is unpublished (no phase carries a named player).
    """
    data = brackets if brackets is not None else ag.brackets(event_key)
    if not data:
        return None

    main = next((b for b in data if (b.get("Code") or "").upper() == "MAINDRAW"), data[0])
    phases = main.get("Phases") or []
    if not phases:
        return None

    # The entry round is the phase with the most matches.
    first = max(phases, key=lambda p: len(p.get("Matches") or []))
    matches = sorted(first.get("Matches") or [],
                     key=lambda m: parse_rsc(m["Info"]["Key"]).get("match_idx") or 0)
    if not matches:
        return None

    named = sum(1 for m in matches
                if (m.get("Home") or {}).get("Name") or (m.get("Away") or {}).get("Name"))
    if named == 0:
        return None                                   # draw not published yet

    parsed = parse_rsc(first["Code"] + ".00010000")
    label  = round_label(parsed.get("round_code", ""), first.get("Desc", ""))
    disc   = discipline_of(parse_rsc(event_key + ".X.00010000").get("event_body", ""))

    pairs, uid = [], 0
    for m in matches:
        a = _slot_competitor(m.get("Home") or {}, uid, ittf_by_reg); uid += 1
        b = _slot_competitor(m.get("Away") or {}, uid, ittf_by_reg); uid += 1
        pairs.append((a, b))

    return SubEventDraw(name=event_key, discipline=disc,
                        first_round=label or "R64", matches=pairs)


def draw_stats(draw: SubEventDraw, states: dict | None = None) -> dict:
    """Counts used by the Stage D verification checks."""
    slots = [c for pair in draw.matches for c in pair]
    real  = [c for c in slots if c.player_ids[0] is not None]
    byes  = [c for c in slots if c.names == ["BYE"]]
    unresolved = [c for c in slots
                  if c.player_ids[0] is None and c.names != ["BYE"]]
    rated = [c for c in real if states and str(c.player_ids[0]) in states]
    return {
        "matches": len(draw.matches),
        "slots": len(slots),
        "real": len(real),
        "byes": len(byes),
        "unresolved": [c.names[0] for c in unresolved],
        "rated": len(rated),
        "unrated": [f"{c.names[0]} ({c.org})" for c in real
                    if states and str(c.player_ids[0]) not in states],
    }


# ── Forecast ─────────────────────────────────────────────────────────────────

def apply_unrated_prior(mp, draw) -> dict:
    """Give entrants with no WTT record a prior that fits the Asian Games.

    Two defaults in the WTT stack are wrong for this event, and together they made
    an unranked Yemeni player the sixth favourite for gold.

    1. wtt_models.SinglesModel._elo rates any player absent from player_states at
       QUALIFIER_PRIOR_ELO = 1700, and _base_bo5 then skips the 15-feature model
       entirely and runs a bare Elo logistic. 1700 is sound for a WTT qualifier,
       who had to win matches to get there. It is badly wrong here: the men's
       field has a median Elo of 1513 and a maximum of 1871, so 1700 is top-ten
       strength handed to someone with no record at all.

    2. feature_model.get_state returns 0.0 for every form residual when a player
       is unknown, while a genuinely weak player carries real negative ones
       (CHOONG Javen, ranked 581: form -0.29, form_6m -0.38, form_big -0.26).
       Zero beats negative, so "no data" outscores "bad". Measured before this
       fix: P(unrated beats CHOONG) = 59.5%.

    The five unrated singles entrants have 0 WTT matches and 0 ranking rows
    between them — they are outside the world circuit, not unknown quantities
    within it. So model each as a copy of the weakest player who IS in this draw:
    that player's full state, so elo, elo_recent and every residual stay mutually
    consistent instead of being a mixture, plus the worst world ranking in the
    field. Injecting a state also makes SinglesModel treat them as known, so the
    real feature model is used rather than the bare Elo fallback.

    Both mp.states and mp.rank_snap are replaced with copies. The WTT pipeline,
    which runs on cron throughout the Games, is untouched.
    """
    field = [c.player_ids[0] for pair in draw.matches for c in pair
             if c.player_ids[0] is not None]
    rated = [p for p in field if p in mp.states]
    if not rated:
        return {"applied": 0, "template": None}

    weakest   = min(rated, key=lambda p: mp.states[p]["elo"])
    template  = dict(mp.states[weakest])
    ranks     = [mp.rank_snap[p]["rank"] for p in field
                 if mp.rank_snap.get(p, {}).get("rank")]
    floor     = max(ranks) if ranks else 400.0

    mp.states    = dict(mp.states)
    mp.rank_snap = dict(mp.rank_snap)

    injected = []
    for p in field:
        if p not in mp.states:
            st = dict(template)
            st["country_code"] = None
            mp.states[p] = st
            injected.append(p)
        if not mp.rank_snap.get(p, {}).get("rank"):
            mp.rank_snap[p] = {"rank": float(floor), "rank_change": 0.0}

    return {"applied": len(injected), "ids": injected,
            "template_elo": round(template["elo"], 1), "rank_floor": floor}


def locked_results(db, event_key: str) -> dict:
    """{(round_label, match_idx): winner_ittf_id} for matches already decided.

    simulate_draw forces these instead of simulating them, so the forecast becomes
    a live one: as the event runs, the odds condition on what has actually happened.
    """
    r = (db.table("ag2026_units")
           .select("round_label,match_idx,winner_side,home_ittf,away_ittf")
           .eq("event_key", event_key).eq("rubber_num", 0)
           .not_.is_("winner_side", "null").execute())
    out = {}
    for row in r.data or []:
        lab, idx = row.get("round_label"), row.get("match_idx")
        wid = row["home_ittf"] if row["winner_side"] == "home" else row["away_ittf"]
        if lab and idx and wid:
            out[(lab, idx)] = wid
    return out


def run_forecast(db, event_key: str, runs: int = 20000, seed: int | None = None) -> dict:
    """Monte-Carlo the bracket and write ag2026_forecasts. Returns a summary."""
    from feature_model import MatchPredictor
    from simulate_event import simulate_draw
    from wtt_models import make_model

    ittf = {}
    page, size = 0, 1000
    while True:
        r = db.table("ag2026_athletes").select("reg,ittf_id") \
              .order("reg").range(page * size, page * size + size - 1).execute()
        if not r.data:
            break
        ittf.update({x["reg"]: x["ittf_id"] for x in r.data if x.get("ittf_id")})
        if len(r.data) < size:
            break
        page += 1

    draw = build_draw(event_key, ittf)
    if draw is None:
        return {"event": event_key, "status": "draw not published", "rows": 0}

    gender = event_key[0]
    mp     = MatchPredictor.load(gender)
    # Capture who genuinely has a record BEFORE injecting priors, so the dashboard
    # can still badge them honestly as unrated.
    truly_rated = set(mp.states)
    prior  = apply_unrated_prior(mp, draw)
    model  = make_model(draw.discipline, AG_TIER, predictor_m=mp, predictor_w=mp)

    locked = locked_results(db, event_key)
    stats, comp_by_uid, labels = simulate_draw(draw, model, AG_TIER,
                                               runs=runs, seed=seed, results=locked)

    # The Asian Games awards two bronzes and plays no third-place match, so the
    # medal is the semi-final, not the final.
    medal_label = "SF" if "SF" in labels else labels[-1]

    rows, seen = [], set()
    for uid, c in comp_by_uid.items():
        pid = c.player_ids[0]
        if pid is None:
            continue                                  # byes are not competitors
        qkey = str(pid)
        if qkey in seen:
            continue
        seen.add(qkey)
        st = stats[uid]
        rows.append({
            "event_key":   event_key,
            "qkey":        qkey,
            "discipline":  draw.discipline,
            "label":       c.names[0],
            "org":         c.org,
            "seed":        c.seed or 0,
            "ittf_id":     pid,
            "is_rated":    pid in truly_rated,
            "p_title":     round(st["title"], 6),
            "p_medal":     round(st["reach"].get(medal_label, 0.0), 6),
            "reach":       {k: round(v, 6) for k, v in st["reach"].items()},
            "runs":        runs,
            "is_provisional": len(locked) == 0,
        })

    for i in range(0, len(rows), 500):
        db.table("ag2026_forecasts").upsert(rows[i:i + 500],
                                            on_conflict="event_key,qkey").execute()

    # Drop rows this run did not produce. An upsert alone leaves orphans behind
    # whenever a competitor's qkey changes — which happens for real: correcting a
    # duplicated ITTF id moved KHAN Muhammad from 203063 to 144217 and left the old
    # row sitting in the table, still showing his pre-fix 1.0% title chance.
    stale = [r["qkey"] for r in (db.table("ag2026_forecasts").select("qkey")
                                   .eq("event_key", event_key).execute().data or [])
             if r["qkey"] not in seen]
    if stale:
        db.table("ag2026_forecasts").delete() \
          .eq("event_key", event_key).in_("qkey", stale).execute()

    total = sum(r["p_title"] for r in rows)
    return {"event": event_key, "rows": len(rows), "locked": len(locked),
            "labels": labels, "title_sum": round(total, 4),
            "prior_elo": prior["template_elo"], "prior_applied": prior["applied"],
            "rank_floor": prior["rank_floor"], "stale_removed": len(stale),
            "unrated": [r["label"] for r in rows if not r["is_rated"]]}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--event", default=None, help="blank = both singles events")
    ap.add_argument("--runs", type=int, default=20000)
    ap.add_argument("--forecast", action="store_true")
    args = ap.parse_args()

    from ag2026_sync import ittf_by_reg_map
    db = get_db()
    events = [args.event] if args.event else list(SINGLES_EVENTS)

    if args.forecast:
        with reported(FEED, db) as run:
            bits = []
            for ev in events:
                s = run_forecast(db, ev, runs=args.runs)
                print(f"[forecast] {ev}: {s}")
                bits.append(f"{ev[0]}{ev.split('.')[1].rstrip('-').title()}={s['rows']}")
            run["detail"] = ", ".join(bits)
    else:
        m = ittf_by_reg_map(db)
        for ev in events:
            d = build_draw(ev, m)
            if not d:
                print(f"{ev}: draw not published yet"); continue
            print(f"{ev}  first_round={d.first_round}  matches={len(d.matches)}")
            for k, v in draw_stats(d).items():
                print(f"  {k}: {v}")
