#!/usr/bin/env python3
"""
ag2026_live.py — live win probability for Asian Games 2026 table tennis.

WHAT IS LIVE AND WHAT IS NOT
----------------------------
The plan called the in-progress point score UNVERIFIED, because no table tennis
match was in play when the feed was first probed. It still is unverified against
a running match. But the shape of a finished one makes the answer recoverable
without a separate endpoint:

    Results.ResDetail  = "11:1, 11:6, 11:5"
    Results.CurrentPeriod = 3

A table tennis game ends at 11 with a two-point margin. So any trailing entry in
ResDetail that is NOT yet won (max < 11, or a margin under 2) is by definition the
game being played right now, and its two numbers are the live point score. That is
split_games(): it needs nothing the feed does not already publish, and it degrades
on its own. If a running match turns out to publish only completed games, the
in-progress slot is simply absent and the probability drops to game level, which
is still a real live number.

So there are three levels, and every row says which one it used:

    point     both games and the current point score      p_win_live
    game      completed games only                        p_win_from_state
    prematch  nothing has happened yet                    predict_score['p_match']

TEAM TIES
---------
A tie's rubbers arrive inside results()['SubUnits'], keyed ...0001 through ...0005.
They are written to ag2026_units as ordinary rows with rubber_num 1..5 and
parent_unit set to the tie, so the same probability path covers them with no
special case: a rubber is just a unit with two ITTF ids.

CADENCE
-------
CloudFront holds responses ~30 s. Polling faster than that returns identical bytes,
so every request that matters is sent with ?_=<epoch> to force a Miss, and the Age
header of each response is stored as data_age_s. The dashboard shows that number
rather than claiming the data is instantaneous.

RUN
    python scripts/ag2026_live.py --once                 # one sweep, print only
    python scripts/ag2026_live.py --db --interval 15 --max-runtime 290
"""

import argparse
import os
import sys
import time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ag2026_api as ag
from ag2026_draw import parse_rsc, round_label, unit_best_of, discipline_of
from feature_model import MatchPredictor, p_win_from_state, p_win_live
from tg_common import get_db, reported
from wtt_models import convert_best_of

FEED = "ag2026-live"

# Units this far before their start time and this far after are worth checking.
LOOK_BEHIND = timedelta(hours=6)
LOOK_AHEAD  = timedelta(minutes=45)

FINISHED = {"OFFICIAL", "UNOFFICIAL"}


# ── Score parsing ────────────────────────────────────────────────────────────

def split_games(res_detail: str) -> tuple[list, tuple | None]:
    """'11:1, 11:6, 8:5' -> ([(11,1),(11,6)], (8,5)).

    Returns (completed games, the game in progress or None). A game is complete
    when someone has 11+ with a margin of 2+; anything else is still being played.
    Handles both ':' and '-' separators, and ignores 0:0 placeholders.
    """
    completed, playing = [], None
    if not res_detail:
        return completed, playing

    for chunk in str(res_detail).replace(":", "-").split(","):
        chunk = chunk.strip()
        if "-" not in chunk:
            continue
        try:
            a, b = (int(x) for x in chunk.split("-")[:2])
        except (ValueError, IndexError):
            continue
        if a == 0 and b == 0:
            continue
        if max(a, b) >= 11 and abs(a - b) >= 2:
            completed.append((a, b))
        else:
            playing = (a, b)          # a later entry supersedes an earlier one
    return completed, playing


def game_state(games: list) -> tuple[int, int]:
    return sum(1 for a, b in games if a > b), sum(1 for a, b in games if b > a)


# ── Competitors ──────────────────────────────────────────────────────────────

def _comp_name(c: dict) -> str:
    if c.get("Name"):
        return c["Name"]
    mem = c.get("Members") or []
    return " / ".join(m.get("Name", "") for m in mem) if mem else ""


def sides_from_subunit(su: dict, ittf: dict) -> tuple[dict, dict] | None:
    """SubUnit Competitors are ordered [home, away]."""
    comps = su.get("Competitors") or []
    if len(comps) < 2:
        return None
    out = []
    for c in comps[:2]:
        reg = str(c.get("Reg") or "")
        out.append({"reg": reg, "ittf": ittf.get(reg), "org": c.get("Org"),
                    "name": _comp_name(c), "result": c.get("Result"),
                    "wlt": c.get("WLT")})
    return out[0], out[1]


# ── Probability ──────────────────────────────────────────────────────────────

class Predictors:
    """Lazily loaded, one per gender, reused across the whole poll loop."""

    def __init__(self, directory=None):
        self._d, self._cache = directory, {}

    def get(self, gender: str):
        g = "W" if gender == "W" else "M"
        if g not in self._cache:
            self._cache[g] = MatchPredictor.load(g, directory=self._d)
        return self._cache[g]


def probability(mp, a_id, b_id, games, playing, best_of: int) -> dict:
    """-> {p_prematch, p_win, level, games_a, games_b, pts_a, pts_b}."""
    ga, gb = game_state(games)
    out = {"games_a": ga, "games_b": gb, "pts_a": None, "pts_b": None,
           "p_prematch": None, "p_win": None, "level": "prematch", "g": None}

    if a_id is None or b_id is None:
        return out

    ps = mp.predict_score(a_id, b_id)
    g, p_point = ps["g"], ps["p_point"]
    out["g"] = g
    out["p_prematch"] = convert_best_of(ps["p_match"], best_of)

    if playing is not None:
        out["pts_a"], out["pts_b"] = playing
        out["p_win"] = p_win_live(g, p_point, ga, gb, playing[0], playing[1], best_of)
        out["level"] = "point"
    elif ga or gb:
        out["p_win"] = p_win_from_state(g, ga, gb, best_of)
        out["level"] = "game"
    else:
        out["p_win"] = out["p_prematch"]
    return out


# ── Writes ───────────────────────────────────────────────────────────────────

def upsert_live_state(db, row: dict):
    db.table("ag2026_live_state").upsert(row, on_conflict="unit_key").execute()


def write_game_log(db, unit_key, event_key, a_id, b_id, games, g, best_of, seen: dict):
    """One row per completed game, written once.

    p_win_after is recomputed at each game score rather than stamped with the
    match's final probability — the point of this table is the trail, so a match
    that went 0-2 down and back to 3-2 has to show the dip. `seen` carries the
    high-water mark per unit so a re-poll does not rewrite earlier games.
    """
    total = len(games)
    if total <= seen.get(unit_key, 0):
        return 0
    written = 0
    for n in range(seen.get(unit_key, 0) + 1, total + 1):
        a, b = games[n - 1]
        ga, gb = game_state(games[:n])
        p_after = p_win_from_state(g, ga, gb, best_of) if g is not None else None
        try:
            db.table("ag2026_game_log").upsert({
                "unit_key": unit_key, "game_number": n, "event_key": event_key,
                "comp1_id": a_id, "comp2_id": b_id,
                "score_a": a, "score_b": b,
                "games_a_after": ga, "games_b_after": gb,
                "p_win_after": round(p_after, 4) if p_after is not None else None,
            }, on_conflict="unit_key,game_number").execute()
            written += 1
        except Exception as e:
            print(f"  [game_log] {unit_key} g{n}: {e}")
    seen[unit_key] = total
    return written


# ── Candidate selection ──────────────────────────────────────────────────────

def candidates(db, day: str | None = None) -> list:
    """Units worth fetching right now.

    IsLive has never been observed true, so it is treated as a hint, not the
    gate. The reliable signal is the clock: anything scheduled to have started
    and not yet marked OFFICIAL is a candidate.
    """
    now = datetime.now(timezone.utc)
    lo, hi = (now - LOOK_BEHIND).isoformat(), (now + LOOK_AHEAD).isoformat()

    q = (db.table("ag2026_units")
           .select("unit_key,event_key,round_label,discipline,gender,best_of,"
                   "status,is_live,start_at,home_ittf,away_ittf,home_name,away_name,"
                   "home_org,away_org,rubber_num")
           .eq("rubber_num", 0))
    if day:
        q = q.gte("start_at", f"{day}T00:00:00+09:00").lte("start_at", f"{day}T23:59:59+09:00")
    else:
        q = q.gte("start_at", lo).lte("start_at", hi)

    rows = q.execute().data or []
    if day:
        # An explicit day is a replay: keep finished units so a completed session
        # can be re-scored end to end against known results.
        return rows
    return [r for r in rows if r.get("status") not in FINISHED or r.get("is_live")]


# ── One sweep ────────────────────────────────────────────────────────────────

def sweep(db, preds: Predictors, ittf: dict, units: list,
          seen_games: dict, write: bool = True, verbose: bool = True) -> dict:
    live_n = fin_n = logged = 0

    for u in units:
        res = ag.results(u["unit_key"], bust=True)
        cache = ag.last_cache()
        if not res:
            continue

        info   = res.get("Info") or {}
        status = info.get("Status") or u.get("status")
        rr     = res.get("Results") or {}
        subs   = res.get("SubUnits") or []

        # A team tie is scored through its rubbers, not directly. Each rubber is a
        # real singles match with its own probability, so it needs enough context
        # to be readable alone: which tie it belongs to and where the tie stands.
        targets = []
        if subs:
            tie_home = (u.get("home_name") or "").strip()
            tie_away = (u.get("away_name") or "").strip()
            tie_label = f"{tie_home} v {tie_away}" if (tie_home and tie_away) else None
            comps = res.get("Competitors") or []
            tie_score = None
            if len(comps) >= 2:
                ra, rb = comps[0].get("Result"), comps[1].get("Result")
                if ra not in (None, "") and rb not in (None, ""):
                    tie_score = f"{ra}-{rb}"

            for su in subs:
                sd = sides_from_subunit(su, ittf)
                if not sd:
                    continue
                h, a = sd
                sres = su.get("Results") or {}
                si   = su.get("Info") or {}
                key  = si.get("Key")
                targets.append({
                    "unit_key": key, "parent": u["unit_key"],
                    "res_detail": sres.get("ResDetail") or "",
                    "status": si.get("Status"), "home": h, "away": a,
                    "best_of": len(sres.get("Periods") or []) or 5,
                    "rubber_num": (parse_rsc(key) or {}).get("rubber_num") or 0,
                    "tie_label": tie_label, "tie_score": tie_score,
                })
        else:
            targets.append({
                "unit_key": u["unit_key"], "parent": None,
                "res_detail": rr.get("ResDetail") or "",
                "status": status,
                "home": {"ittf": u["home_ittf"], "name": u["home_name"], "org": u["home_org"]},
                "away": {"ittf": u["away_ittf"], "name": u["away_name"], "org": u["away_org"]},
                "best_of": u.get("best_of") or 5,
                "rubber_num": 0, "tie_label": None, "tie_score": None,
            })

        for t in targets:
            games, playing = split_games(t["res_detail"])
            if not games and playing is None:
                # Nothing has been played. For a team tie this is the normal case
                # for rubbers 4 and 5 once the tie is already decided 3-0 — they
                # carry an OFFICIAL status but were never contested, so status
                # alone would wrongly mark them live.
                continue

            mp = preds.get(u.get("gender") or "M")
            pr = probability(mp, t["home"].get("ittf"), t["away"].get("ittf"),
                             games, playing, t["best_of"])

            finished = t["status"] in FINISHED or \
                pr["games_a"] >= (t["best_of"] + 1) // 2 or \
                pr["games_b"] >= (t["best_of"] + 1) // 2
            state = "finished" if finished else "live"
            live_n += state == "live"
            fin_n  += state == "finished"

            if verbose:
                tag = f"{pr['p_win']:.1%}" if pr["p_win"] is not None else "  ?  "
                pts = f" [{pr['pts_a']}-{pr['pts_b']}]" if playing else ""
                print(f"  {state:8} {pr['level']:8} {tag:>6}  "
                      f"{(t['home'].get('name') or '?')[:20]:20} "
                      f"{pr['games_a']}-{pr['games_b']}{pts:9} "
                      f"{(t['away'].get('name') or '?')[:20]:20} age={cache.get('age')}")

            if not write:
                continue

            upsert_live_state(db, {
                "unit_key":   t["unit_key"],
                "event_key":  u["event_key"],
                "round_label": u.get("round_label"),
                "comp1_id":   t["home"].get("ittf"), "comp2_id": t["away"].get("ittf"),
                "comp1_name": t["home"].get("name"), "comp2_name": t["away"].get("name"),
                "comp1_org":  t["home"].get("org"),  "comp2_org": t["away"].get("org"),
                "games_a":    pr["games_a"], "games_b": pr["games_b"],
                "pts_a":      pr["pts_a"],   "pts_b":   pr["pts_b"],
                "best_of":    t["best_of"],
                "p_prematch": round(pr["p_prematch"], 4) if pr["p_prematch"] is not None else None,
                "p_win":      round(pr["p_win"], 4) if pr["p_win"] is not None else None,
                "prob_level": pr["level"],
                "res_detail": t["res_detail"],
                "status":     state,
                "parent_unit": t.get("parent"),
                "rubber_num":  t.get("rubber_num") or 0,
                "tie_label":   t.get("tie_label"),
                "tie_score":   t.get("tie_score"),
                "data_age_s": cache.get("age"),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })

            logged += write_game_log(db, t["unit_key"], u["event_key"],
                                     t["home"].get("ittf"), t["away"].get("ittf"),
                                     games, pr["g"], t["best_of"], seen_games)

            # Keep the unit row in step, and record the rubber the first time.
            upd = {"status": t["status"], "res_detail": t["res_detail"],
                   "is_live": state == "live",
                   "last_updated": datetime.now(timezone.utc).isoformat()}
            if t["parent"]:
                r = parse_rsc(t["unit_key"])
                upd.update({
                    "unit_key": t["unit_key"], "event_key": u["event_key"],
                    "parent_unit": t["parent"], "rubber_num": r.get("rubber_num"),
                    "match_idx": r.get("match_idx"), "discipline": u["discipline"],
                    "gender": u.get("gender"), "round_label": u.get("round_label"),
                    "best_of": t["best_of"],
                    "home_ittf": t["home"].get("ittf"), "away_ittf": t["away"].get("ittf"),
                    "home_name": t["home"].get("name"), "away_name": t["away"].get("name"),
                    "home_org": t["home"].get("org"),   "away_org": t["away"].get("org"),
                })
                db.table("ag2026_units").upsert(upd, on_conflict="unit_key").execute()
            else:
                db.table("ag2026_units").update(upd).eq("unit_key", t["unit_key"]).execute()

    return {"live": live_n, "finished": fin_n, "games_logged": logged,
            "units_checked": len(units)}


# ── Loop ─────────────────────────────────────────────────────────────────────

def poll(db, interval: float = 15.0, max_runtime_min: float = 0,
         day: str | None = None, write: bool = True, once: bool = False) -> dict:
    preds = Predictors()
    ittf  = {}
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

    deadline = time.time() + max_runtime_min * 60 if max_runtime_min else None
    seen_games, sweeps, totals = {}, 0, {"live": 0, "games_logged": 0}

    while True:
        units = candidates(db, day)
        if units:
            print(f"[{datetime.now():%H:%M:%S}] {len(units)} candidate unit(s)")
            s = sweep(db, preds, ittf, units, seen_games, write=write)
            totals["live"] = s["live"]
            totals["games_logged"] += s["games_logged"]
        else:
            print(f"[{datetime.now():%H:%M:%S}] nothing scheduled in the window")
        sweeps += 1

        if once or (deadline and time.time() >= deadline):
            break
        time.sleep(interval)

    return {"sweeps": sweeps, **totals}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--interval", type=float, default=15.0)
    ap.add_argument("--max-runtime", type=float, default=0, help="minutes; 0 = forever")
    ap.add_argument("--day", help="force a day, YYYY-MM-DD (ignores the clock window)")
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--db", action="store_true", help="write; without it, print only")
    args = ap.parse_args()

    db = get_db()
    if db is None:
        raise RuntimeError("no Supabase credentials")

    if args.db:
        with reported(FEED, db) as run:
            s = poll(db, args.interval, args.max_runtime, args.day, True, args.once)
            run["detail"] = (f"{s['sweeps']} sweeps, {s['live']} live, "
                             f"{s['games_logged']} games logged")
            if s["games_logged"] == 0 and s["live"] == 0:
                run["status"] = "noop"
            print(run["detail"])
    else:
        print(poll(db, args.interval, args.max_runtime, args.day, False, args.once))


if __name__ == "__main__":
    main()
