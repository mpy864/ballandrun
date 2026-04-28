"""
live_updater.py  —  Direction 2: Live match probability tracker.

Uses GetLiveResult (correct live endpoint) to show win probability
shifting every game OR every single point during a live match.

Three modes
-----------
  --completed  Game-by-game probability journey for completed matches (uses GetOfficialResult)
  --live       Current snapshot of all in-progress matches with point-level probability
  --points     Continuously poll live matches and update probability each point (~2s refresh)

Usage
-----
  python scripts/live_updater.py --event 3357 --gender M --live
  python scripts/live_updater.py --event 3357 --gender M --points
  python scripts/live_updater.py --event 3357 --gender M --completed
  python scripts/live_updater.py --event 3357 --gender M --points --interval 3
"""

import os
import sys
import time
import argparse
import requests
from datetime import datetime, timezone

try:
    from supabase import create_client as _sb_create
except ImportError:
    _sb_create = None

sys.path.insert(0, os.path.dirname(__file__))
from feature_model import MatchPredictor, p_win_from_state, p_win_current_game, p_win_live

# ── WTT API ───────────────────────────────────────────────────────────────────
LIVE_URL = (
    "https://wtt-website-live-events-api-prod-cmfzgabgbzhphabb.eastasia-01"
    ".azurewebsites.net/api/cms/GetLiveResult"
)
OFFICIAL_URL = (
    "https://wtt-website-live-events-api-prod-cmfzgabgbzhphabb.eastasia-01"
    ".azurewebsites.net/api/cms/GetOfficialResult"
)
HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept":     "application/json",
    "Referer":    "https://worldtabletennis.com/",
}


# ── API helpers ───────────────────────────────────────────────────────────────

def _extract_cards(entry: dict, event_id: int) -> list[tuple[dict, str]]:
    """
    Extract individual match cards from an API entry.
    Handles both:
      - Regular singles/doubles events (flat match_card)
      - Team events (match_card.teamParentData.extended_info.matches[].match_result)
    Returns list of (card_dict, team_context_label) tuples.
    """
    root = entry.get("match_card") or entry
    if not root:
        return []

    # Team event: individual matches are nested inside teamParentData
    individual = (
        (root.get("teamParentData") or {})
        .get("extended_info", {})
        .get("matches") or []
    )
    if individual:
        cards = []
        team_label = root.get("subEventDescription") or root.get("roundName") or ""
        for m in individual:
            mr = m.get("match_result")
            if mr:
                cards.append((mr, team_label))
        return cards

    # Regular event: the root card itself
    return [(root, "")]


def fetch_live(event_id: int) -> list[dict]:
    """
    Fetch currently in-progress matches for an event via GetLiveResult.
    Handles both regular and team events. Only LIVE matches are returned.
    """
    try:
        r = requests.get(
            LIVE_URL,
            params={"EventId": event_id, "include_match_card": "true"},
            headers=HEADERS,
            timeout=10,
        )
    except Exception as e:
        print(f"  [!] API error: {e}")
        return []

    data = r.json() if r.status_code == 200 else []
    if not isinstance(data, list):
        data = data.get("Data") or data.get("Result") or []

    matches = []
    for entry in data:
        outer_mc = entry.get("match_card")
        if not outer_mc:
            continue
        outer_status = outer_mc.get("resultStatus", "")

        for card, team_ctx in _extract_cards(entry, event_id):
            # Accept if outer card is LIVE, or inner card itself is LIVE
            status = card.get("resultStatus") or outer_status
            if status != "LIVE":
                continue
            parsed = _parse_card(entry.get("eventId", event_id), card, team_ctx)
            if parsed:
                matches.append(parsed)
    return matches


def fetch_official(event_id: int) -> list[dict]:
    """Fetch all completed matches for an event via GetOfficialResult.
    Handles both regular and team events."""
    try:
        r = requests.get(
            OFFICIAL_URL,
            params={"EventId": event_id, "include_match_card": "true", "take": 1000},
            headers=HEADERS,
            timeout=20,
        )
    except Exception as e:
        print(f"  [!] API error: {e}")
        return []

    data = r.json() if r.status_code == 200 else []
    if not isinstance(data, list):
        data = data.get("Data") or data.get("Result") or []

    matches = []
    for entry in data:
        for card, team_ctx in _extract_cards(entry, event_id):
            status = card.get("resultStatus") or ""
            if status != "OFFICIAL":
                continue
            parsed = _parse_card(event_id, card, team_ctx)
            if parsed:
                matches.append(parsed)
    return matches


def _parse_card(event_id, mc: dict, team_ctx: str = "") -> dict | None:
    """Parse a match_card dict into a normalised match dict."""
    comps = mc.get("competitiors") or []
    if len(comps) < 2:
        return None
    c1, c2 = comps[0], comps[1]

    id1_raw = c1.get("competitiorId") or c1.get("competitorId") or ""
    id2_raw = c2.get("competitiorId") or c2.get("competitorId") or ""
    if "_" in str(id1_raw) or "_" in str(id2_raw):
        return None  # skip doubles pair IDs
    try:
        id1, id2 = int(id1_raw), int(id2_raw)
    except (ValueError, TypeError):
        return None
    if id1 >= 1_000_000 or id2 >= 1_000_000:
        return None

    overall = str(mc.get("overallScores") or mc.get("resultOverallScores") or "")
    # gameScores for LIVE includes current game; resultsGameScores has only completed
    game_scores_live = str(mc.get("gameScores") or "")
    game_scores_done = str(mc.get("resultsGameScores") or mc.get("gameScores") or "")
    status = mc.get("resultStatus", "")

    result = None
    if status == "OFFICIAL" and "-" in overall:
        try:
            w1, w2 = [int(x.strip()) for x in overall.split("-")[:2]]
            result = "W" if w1 > w2 else ("L" if w2 > w1 else None)
        except (ValueError, TypeError):
            pass
        if result is None:
            irm1 = c1.get("irm") or ""
            irm2 = c2.get("irm") or ""
            if irm1 or irm2:
                result = "L" if irm1 else "W"

    return {
        "event_id":        event_id,
        "id1": id1, "id2": id2,
        "name1": c1.get("competitiorName") or str(id1),
        "name2": c2.get("competitiorName") or str(id2),
        "result":          result,
        "overall":         overall,
        "game_scores_live": game_scores_live,   # includes current game if live
        "game_scores_done": game_scores_done,   # completed games only
        "status":          status,
        "cur_game":        mc.get("currentGameNumber") or 0,
        "seq_num":         int(mc.get("playByPlaySequenceNumber") or 0),
        "round":           mc.get("subEventDescription") or mc.get("roundName") or team_ctx or "",
        # Per-competitor raw per-game point strings e.g. "11,7,14"
        "pts1_str":        c1.get("scores") or "",
        "pts2_str":        c2.get("scores") or "",
    }


# ── Parsing helpers ───────────────────────────────────────────────────────────

def parse_completed_games(game_scores_str: str) -> list[tuple[int, int]]:
    """Parse '11-7,9-11,12-10,0-0' → [(11,7),(9,11),(12,10)] (skip 0-0)."""
    result = []
    for g in str(game_scores_str).split(","):
        g = g.strip()
        if "-" not in g:
            continue
        try:
            a, b = int(g.split("-")[0]), int(g.split("-")[1])
            if a > 0 or b > 0:
                result.append((a, b))
        except (ValueError, IndexError):
            continue
    return result


def parse_live_game_score(m: dict) -> tuple[int, int] | None:
    """
    Extract the current (in-progress) game score from a LIVE match.

    For a live match, gameScores looks like "11-5,11-7,8-9" where the last
    element is the ongoing game. resultsGameScores has only completed games.
    We extract the last game from gameScores if it differs from resultsGameScores.
    """
    live_games = parse_completed_games(m["game_scores_live"])
    done_games = parse_completed_games(m["game_scores_done"])
    if len(live_games) > len(done_games):
        return live_games[-1]  # the in-progress game score
    # Fallback: parse per-competitor scores field
    try:
        pts1 = [int(x) for x in m["pts1_str"].split(",") if x.strip().isdigit()]
        pts2 = [int(x) for x in m["pts2_str"].split(",") if x.strip().isdigit()]
        game_idx = m["cur_game"] - 1
        if 0 <= game_idx < len(pts1) and 0 <= game_idx < len(pts2):
            return pts1[game_idx], pts2[game_idx]
    except (ValueError, IndexError):
        pass
    return None


def game_state(games: list[tuple[int, int]]) -> tuple[int, int]:
    """Count games won by A and B from a list of (a, b) per-game scores."""
    ga = sum(1 for a, b in games if a > b)
    gb = sum(1 for a, b in games if b > a)
    return ga, gb


def _bar(p: float, width: int = 20) -> str:
    filled = round(p * width)
    return "█" * filled + "░" * (width - filled)


def _delta_str(delta: float) -> str:
    if abs(delta) < 0.0005:
        return "      "
    sign = "+" if delta > 0 else "−"
    return f" {sign}{abs(delta)*100:4.1f}%"


# ── Display modes ─────────────────────────────────────────────────────────────

def show_live_snapshot(mp: MatchPredictor, matches: list[dict], gender_label: str):
    """One-shot snapshot of all live matches with current point-level probability."""
    target = matches if gender_label == "all" else [m for m in matches if m["round"].startswith(gender_label)]

    if not target:
        print("  No in-progress matches found for this gender.")
        print("  (Try without --gender to see all disciplines)")
        return

    print(f"  {'Match':<38} {'Games':<7} {'G score':<9} {'P(A wins)':>10}  Bar")
    print(f"  {'─'*78}")

    for m in target:
        id1, id2 = m["id1"], m["id2"]
        sc   = _get_mp(mp, m["round"]).predict_score(id1, id2)
        g    = sc["g"]
        p_pt = sc["p_point"]
        p0   = sc["p_match"]

        done_games  = parse_completed_games(m["game_scores_done"])
        ga, gb      = game_state(done_games)
        cur_pts     = parse_live_game_score(m)

        if cur_pts:
            pts_a, pts_b = cur_pts
            p = p_win_live(g, p_pt, ga, gb, pts_a, pts_b)
            pts_str = f"{pts_a}-{pts_b}"
        else:
            p = p_win_from_state(g, ga, gb)
            pts_str = "—"

        n1 = m["name1"].split()[-1]
        n2 = m["name2"].split()[-1]
        match_str  = f"{n1} vs {n2}"
        games_str  = f"{ga}-{gb}"
        delta      = _delta_str(p - p0)
        bar        = _bar(p)

        print(f"  {match_str:<38} {games_str:<7} {pts_str:<9} {p*100:>8.1f}%  {bar}{delta}")


def show_completed(mp: MatchPredictor, matches: list[dict], gender_label: str):
    """Game-by-game probability journey for completed matches."""
    target = matches if gender_label == "all" else [m for m in matches if m["round"].startswith(gender_label)]
    completed = [m for m in target if m["result"] is not None]

    if not completed:
        print("  No completed matches found.")
        return

    correct = total = 0
    swings  = []

    for m in completed:
        id1, id2 = m["id1"], m["id2"]
        sc   = _get_mp(mp, m["round"]).predict_score(id1, id2)
        g    = sc["g"]
        p0   = sc["p_match"]

        games         = parse_completed_games(m["game_scores_done"])
        actual_winner = id1 if m["result"] == "W" else id2
        pred_winner   = id1 if p0 >= 0.5 else id2
        correct_flag  = pred_winner == actual_winner
        if correct_flag:
            correct += 1
        total += 1

        sh1 = m["name1"].split()[-1]
        sh2 = m["name2"].split()[-1]

        print(f"\n  {'─'*64}")
        print(f"  {m['round']}")
        print(f"  {m['name1']}  vs  {m['name2']}")
        print(f"  {'─'*64}")
        print(f"  {'State':<14} {'P('+sh1+' wins)':<16} {'Bar':<22} {'Δ'}")
        print(f"  {'─'*64}")

        p_prev    = p0
        p_history = [p0]
        print(f"  {'Pre-match':<14} {p0*100:>6.1f}%         {_bar(p0)}")

        for i, (pts_a, pts_b) in enumerate(games):
            a_won = pts_a > pts_b
            ga, gb = game_state(games[:i+1])
            p_cur  = p_win_from_state(g, ga, gb)
            delta  = _delta_str(p_cur - p_prev)
            decider = " ★" if (ga == 3 or gb == 3) else ""
            print(f"  {ga}-{gb} G{i+1:<10} {p_cur*100:>6.1f}%  ({pts_a}-{pts_b:<5}) {_bar(p_cur)}{delta}{decider}")
            p_prev = p_cur
            p_history.append(p_cur)

        ga_f, gb_f = game_state(games)
        actual_name = m["name1"] if m["result"] == "W" else m["name2"]
        marker = "✓" if correct_flag else "✗"
        print(f"  {'Result':<14} {actual_name} won {ga_f}-{gb_f}  [{marker}]")

        swing = max(p_history) - min(p_history)
        swings.append((swing, f"{sh1} vs {sh2}"))

    print(f"\n  {'═'*64}")
    print(f"  {correct}/{total} predictions correct ({100*correct/total:.1f}%)")
    if swings:
        swings.sort(reverse=True)
        print(f"\n  Most dramatic (largest probability swing):")
        for sw, name in swings[:5]:
            print(f"    {name:<40}  swing {sw*100:.0f}%")


def _get_mp(mp, round_name: str):
    """Return the right MatchPredictor for a match.
    mp can be a single MatchPredictor or a dict {'M': ..., 'W': ...}."""
    if isinstance(mp, dict):
        key = "M" if "Men" in round_name else "W"
        return mp.get(key) or next(iter(mp.values()))
    return mp


def _upsert_live_state(db, match_id, event_id, m, ga, gb, pts_a, pts_b,
                       p_win, p_pre, seq):
    try:
        db.table("wtt_live_state").upsert({
            "match_id":   match_id,
            "event_id":   event_id,
            "comp1_id":   m["id1"],
            "comp2_id":   m["id2"],
            "comp1_name": m["name1"],
            "comp2_name": m["name2"],
            "games_a":    ga,
            "games_b":    gb,
            "pts_a":      pts_a,
            "pts_b":      pts_b,
            "p_win":      round(p_win, 4),
            "p_prematch": round(p_pre, 4),
            "seq_number": seq,
            "round_name": m["round"],
            "status":     "live",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception as e:
        print(f"  [DB] upsert error: {e}")


def _maybe_write_game_log(db, match_id, event_id, m, ga, gb, p_win,
                          done_games, last_games):
    total = ga + gb
    prev  = last_games.get(match_id, 0)
    if total <= prev or not done_games:
        return
    last = done_games[-1]
    try:
        db.table("wtt_game_log").insert({
            "match_id":      match_id,
            "event_id":      event_id,
            "comp1_id":      m["id1"],
            "comp2_id":      m["id2"],
            "game_number":   total,
            "score_a":       last[0],
            "score_b":       last[1],
            "games_a_after": ga,
            "games_b_after": gb,
            "p_win_after":   round(p_win, 4),
        }).execute()
        print(f"  [DB] game {total} logged ({last[0]}-{last[1]})")
    except Exception as e:
        print(f"  [DB] game_log error: {e}")


def _write_match_result(db, match_id: str, match_p0_by_id: dict, last_state: dict):
    """Write final prediction outcome to wtt_match_results when a match completes."""
    state = last_state.get(match_id)
    p_pre = match_p0_by_id.get(match_id)
    if not state or p_pre is None:
        return
    ga, gb = state["games_a"], state["games_b"]
    if ga >= 3:
        result = "W"
    elif gb >= 3:
        result = "L"
    else:
        result = None  # insufficient data — skip
    correct = ((p_pre > 0.5) == (result == "W")) if result else None
    try:
        db.table("wtt_match_results").upsert({
            "match_id":   match_id,
            "event_id":   state["event_id"],
            "comp1_id":   state["comp1_id"],
            "comp2_id":   state["comp2_id"],
            "comp1_name": state["comp1_name"],
            "comp2_name": state["comp2_name"],
            "round_name": state["round_name"],
            "p_prematch": round(p_pre, 4),
            "p_final":    state["p_final"],
            "games_a":    ga,
            "games_b":    gb,
            "result":     result,
            "correct":    correct,
        }).execute()
        print(f"  [DB] result saved: {match_id} → {result}, correct={correct}")
    except Exception as e:
        print(f"  [DB] match_results error: {e}")


def poll_points(mp: MatchPredictor, event_id: int, gender_label: str,
                interval: float = 2.0, db=None):
    """
    Continuously poll GetLiveResult every `interval` seconds.
    Prints a new line each time a point is scored (seq_num changes).
    Press Ctrl+C to stop.
    """
    print(f"  Polling every {interval}s — press Ctrl+C to stop.\n")
    last_seq:        dict[str, int]   = {}  # doc_code → last seen seq_num
    match_p0:        dict[str, float] = {}  # doc_code → pre-match probability
    match_p0_by_id:  dict[str, float] = {}  # match_id → pre-match probability
    last_games:      dict[str, int]   = {}  # match_id → last total games completed
    last_state:      dict[str, dict]  = {}  # match_id → last known live state
    seen_matches:    set              = set()
    missing_counts:  dict[str, int]  = {}  # match_id → consecutive absent polls

    # Seed seen_matches from DB so script restarts don't leave stale 'live' rows
    if db:
        try:
            existing = db.table("wtt_live_state").select("match_id").eq("status", "live").execute()
            for row in (existing.data or []):
                seen_matches.add(row["match_id"])
            if seen_matches:
                print(f"  [DB] Seeded {len(seen_matches)} in-progress match(es) from DB")
        except Exception as e:
            print(f"  [DB] Could not seed seen_matches: {e}")

    try:
        while True:
            matches  = fetch_live(event_id)
            target   = matches if gender_label == "all" else [m for m in matches if m["round"].startswith(gender_label)]
            now_ids  = set()

            if not target:
                print(f"\r  Waiting for live matches...  ", end="", flush=True)
            else:
                for m in target:
                    doc      = str(m["event_id"]) + m["round"]
                    match_id = f"{event_id}_{m['id1']}_{m['id2']}"
                    seq      = m["seq_num"]
                    id1, id2 = m["id1"], m["id2"]
                    sh1      = m["name1"].split()[-1]
                    sh2      = m["name2"].split()[-1]
                    now_ids.add(match_id)

                    if doc not in match_p0:
                        sc = _get_mp(mp, m["round"]).predict_score(id1, id2)
                        match_p0[doc] = sc["p_match"]
                        match_p0_by_id[match_id] = sc["p_match"]
                        last_seq[doc] = -1
                        print(f"\n  ── {m['name1']} vs {m['name2']} ──")
                        print(f"  Pre-match: {sh1} {sc['p_match']*100:.1f}% / {sh2} {(1-sc['p_match'])*100:.1f}%")
                        print(f"  {'Time':<8} {'Games':<7} {'G score':<9} {'P('+sh1+')':<10}  Bar")
                        print(f"  {'─'*55}")

                    if seq != last_seq.get(doc, -1):
                        last_seq[doc] = seq
                        sc   = _get_mp(mp, m["round"]).predict_score(id1, id2)
                        g    = sc["g"]
                        p_pt = sc["p_point"]
                        p0   = match_p0[doc]

                        done_games = parse_completed_games(m["game_scores_done"])
                        ga, gb     = game_state(done_games)
                        cur_pts    = parse_live_game_score(m)

                        if cur_pts:
                            pts_a, pts_b = cur_pts
                            p = p_win_live(g, p_pt, ga, gb, pts_a, pts_b)
                            pts_str = f"{pts_a}-{pts_b}"
                        else:
                            pts_a = pts_b = 0
                            p = p_win_from_state(g, ga, gb)
                            pts_str = "—"

                        delta = _delta_str(p - p0)
                        bar   = _bar(p)
                        ts    = time.strftime("%H:%M:%S")
                        print(f"  {ts:<8} {ga}-{gb:<6} {pts_str:<9} {p*100:>7.1f}%  {bar}{delta}")

                        if db:
                            _upsert_live_state(db, match_id, event_id, m,
                                               ga, gb, pts_a, pts_b, p, p0, seq)
                            _maybe_write_game_log(db, match_id, event_id, m,
                                                  ga, gb, p, done_games, last_games)
                        last_state[match_id] = {
                            "event_id":   event_id,
                            "comp1_id":   m["id1"],
                            "comp2_id":   m["id2"],
                            "comp1_name": m["name1"],
                            "comp2_name": m["name2"],
                            "round_name": m["round"],
                            "games_a":    ga,
                            "games_b":    gb,
                            "p_final":    round(p, 4),
                        }
                        last_games[match_id] = ga + gb

            # Mark matches that disappeared from live feed as complete.
            # Only after 3+ consecutive absent polls to tolerate API flakiness
            # (WTT API frequently drops a match for 1-2 cycles).
            for mid in list(seen_matches - now_ids):
                missing_counts[mid] = missing_counts.get(mid, 0) + 1
                if missing_counts[mid] >= 3 and db:
                    try:
                        db.table("wtt_live_state").update({"status": "complete"}) \
                          .eq("match_id", mid).execute()
                    except Exception:
                        pass
                    _write_match_result(db, mid, match_p0_by_id, last_state)
            for mid in now_ids:
                missing_counts.pop(mid, None)  # reset counter when match reappears
            seen_matches = now_ids

            time.sleep(interval)

    except KeyboardInterrupt:
        print("\n\n  Stopped.")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--event",     type=int, required=True)
    parser.add_argument("--gender",    choices=["M", "W", "all"], default="all")
    parser.add_argument("--completed", action="store_true",
                        help="Game-by-game journey for completed matches")
    parser.add_argument("--live",      action="store_true",
                        help="Point-level snapshot of current live matches")
    parser.add_argument("--points",    action="store_true",
                        help="Continuously poll and update every point")
    parser.add_argument("--interval",  type=float, default=2.0,
                        help="Poll interval in seconds (default 2)")
    parser.add_argument("--db",        action="store_true",
                        help="Write live state to Supabase (requires SUPABASE_URL + SUPABASE_SERVICE_KEY)")
    args = parser.parse_args()

    if not args.live and not args.points and not args.completed:
        args.live = True   # default

    gender_label = ("Men's Singles" if args.gender == "M"
                    else "Women's Singles" if args.gender == "W"
                    else "all")
    gender_word  = ("Men" if args.gender == "M"
                    else "Women" if args.gender == "W"
                    else "All disciplines")

    print(f"\n{'='*64}")
    print(f"  Live Probability Updater — Event {args.event}  ({gender_word})")
    print(f"{'='*64}")

    print("\nLoading model...")
    if args.gender == "all":
        mp = {}
        for g in ("M", "W"):
            try:
                mp[g] = MatchPredictor.load(g)
                print(f"  {g}: {len(mp[g].states)} players")
            except FileNotFoundError:
                print(f"  [!] No {g} model — skipping  (run: python scripts/feature_model.py --gender {g})")
        if not mp:
            print("[!] No models found. Run feature_model.py for M and/or W first.")
            return
    else:
        try:
            mp = MatchPredictor.load(args.gender)
        except FileNotFoundError as e:
            print(f"[!] {e}\n    Run: python scripts/feature_model.py --gender {args.gender}")
            return
        print(f"  {len(mp.states)} player states loaded.")
    print()

    if args.completed:
        print("  COMPLETED MATCHES — Game-by-Game Journey")
        matches = fetch_official(args.event)
        show_completed(mp, matches, gender_label)

    if args.live:
        print("  IN-PROGRESS MATCHES — Current Point-Level Probability")
        matches = fetch_live(args.event)
        print(f"  {len(matches)} live match(es) found.\n")
        show_live_snapshot(mp, matches, gender_label)

    if args.points:
        print("  POINT-BY-POINT LIVE POLLING")
        db = None
        if args.db:
            if _sb_create is None:
                print("  [!] supabase-py not installed — DB writes disabled")
            else:
                try:
                    db = _sb_create(
                        os.environ["SUPABASE_URL"],
                        os.environ["SUPABASE_SERVICE_KEY"]
                    )
                    print("  [DB] Connected — writing to wtt_live_state + wtt_game_log")
                except KeyError as e:
                    print(f"  [!] Missing env var {e} — DB writes disabled")
        poll_points(mp, args.event, gender_label, interval=args.interval, db=db)


if __name__ == "__main__":
    main()
