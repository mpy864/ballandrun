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
from datetime import date, datetime, timezone

try:
    from supabase import create_client as _sb_create
except ImportError:
    _sb_create = None

sys.path.insert(0, os.path.dirname(__file__))
from feature_model import MatchPredictor, p_win_from_state, p_win_current_game, p_win_live
from tg_common import (already_sent as _tc_already_sent, mark_sent as _tc_mark_sent,
                       record_health as _tc_record_health)

# ── Sent-results deduplication tracker ───────────────────────────────────────

_PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_LOGS_DIR    = os.path.join(_PROJECT_DIR, "logs")


def _sent_key(event_id: int, id1: int, id2: int) -> str:
    return f"{event_id}_{min(id1, id2)}_{max(id1, id2)}"


def _tracker_path() -> str:
    return os.path.join(_LOGS_DIR, f"sent_results_{date.today().isoformat()}.txt")


def _mark_sent(key: str):
    os.makedirs(_LOGS_DIR, exist_ok=True)
    with open(_tracker_path(), "a") as f:
        f.write(key + "\n")


# ── Telegram notifier ─────────────────────────────────────────────────────────

class TelegramNotifier:
    def __init__(self, token: str, channel: str):
        self.url     = f"https://api.telegram.org/bot{token}/sendMessage"
        self.channel = channel

    def send(self, text: str):
        try:
            requests.post(self.url, json={
                "chat_id":    self.channel,
                "text":       text,
                "parse_mode": "HTML",
            }, timeout=5)
        except Exception as e:
            print(f"  [TG] send error: {e}")

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
                          done_games, last_games, tg=None):
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


def _extract_venue(event_name: str) -> str:
    """Extract city from WTT event name, e.g. 'WTT Contender Skopje 2026' → 'Skopje'."""
    import re
    skip = {"wtt","grand","star","contender","smash","series","youth","championships",
            "team","world","table","tennis","junior","cadet","open","cup"}
    name = re.sub(r'\b\d{4}\b', '', event_name).strip()
    words = [w for w in name.split() if w.lower() not in skip]
    return words[-1] if words else ""


def _parse_discipline_round(round_name: str) -> tuple[str, str]:
    """Split 'Men\'s Singles Round of 16' → ('Men\'s Singles', 'Round of 16')."""
    for d in ["Women's Singles", "Men's Singles", "Mixed Doubles", "Women's Doubles", "Men's Doubles"]:
        if d.lower() in round_name.lower():
            rest = round_name[round_name.lower().find(d.lower()) + len(d):].strip(" -·|")
            return d, rest or round_name
    return "Singles", round_name


def _round_short(rnd: str) -> str:
    import re as _re
    txt = _re.sub(r'\s*-\s*Match\s*\d+$', '', rnd, flags=_re.IGNORECASE).strip()
    low = txt.lower()
    if "qualif" in low:
        m = _re.search(r'(\d+)', low)
        return f"Qual R{m.group(1)}" if m else "Qual"
    if "final" in low and "semi" not in low and "quarter" not in low:
        return "Final"
    if "semi" in low:    return "SF"
    if "quarter" in low: return "QF"
    if "round of 16" in low: return "R16"
    if "round of 32" in low: return "R32"
    if "round of 64" in low: return "R64"
    if "round of 128" in low: return "R128"
    return txt or "—"


def _build_result_message(db, match_id: str, state: dict, p_pre: float,
                           result: str, correct) -> str | None:
    """Build the formatted Telegram result message."""
    try:
        # Game scores from wtt_game_log
        game_rows = []
        if db:
            gr = db.table("wtt_game_log").select("game_number,score_a,score_b") \
                   .eq("match_id", match_id).order("game_number").execute()
            game_rows = gr.data or []

        # Player country + ranking
        c1_country = c2_country = ""
        c1_rank = c2_rank = None
        if db:
            ids = [state["comp1_id"], state["comp2_id"]]
            pr  = db.table("wtt_players").select("ittf_id,country_code") \
                    .in_("ittf_id", ids).execute()
            rr  = db.table("rankings_singles_normalized") \
                    .select("player_id,rank,ranking_date") \
                    .in_("player_id", ids) \
                    .order("ranking_date", desc=True).execute()
            cmap = {r["ittf_id"]: r["country_code"] for r in (pr.data or [])}
            rmap: dict[int, int] = {}
            for r in (rr.data or []):
                if r["player_id"] not in rmap:
                    rmap[r["player_id"]] = r["rank"]
            c1_country = cmap.get(state["comp1_id"], "")
            c2_country = cmap.get(state["comp2_id"], "")
            c1_rank    = rmap.get(state["comp1_id"])
            c2_rank    = rmap.get(state["comp2_id"])

        # Competition name + venue
        comp_name = venue = ""
        if db and state.get("event_id"):
            er = db.table("wtt_events").select("event_name") \
                   .eq("event_id", state["event_id"]).execute()
            if er.data:
                comp_name = er.data[0]["event_name"]
                venue     = _extract_venue(comp_name)

        # Orient: Indian player is always shown first
        if c2_country == "IND" and c1_country != "IND":
            p1_name, p1_c, p1_r = state["comp2_name"], c2_country, c2_rank
            p2_name, p2_c, p2_r = state["comp1_name"], c1_country, c1_rank
            result_p1  = "W" if result == "L" else "L"
            ga1, gb1   = state["games_b"], state["games_a"]
            game_scores = [(r["score_b"], r["score_a"]) for r in game_rows]
        else:
            p1_name, p1_c, p1_r = state["comp1_name"], c1_country, c1_rank
            p2_name, p2_c, p2_r = state["comp2_name"], c2_country, c2_rank
            result_p1  = result
            ga1, gb1   = state["games_a"], state["games_b"]
            game_scores = [(r["score_a"], r["score_b"]) for r in game_rows]

        # For non-India matches: winner shown first
        p1_ind = (p1_c == "IND")
        p2_ind = (p2_c == "IND")
        if not p1_ind and not p2_ind and result_p1 == "L":
            p1_name, p2_name = p2_name, p1_name
            p1_c, p2_c       = p2_c, p1_c
            p1_r, p2_r       = p2_r, p1_r
            result_p1        = "W"
            ga1, gb1         = gb1, ga1
            game_scores      = [(b, a) for a, b in game_scores]

        def _pretty(team_name):
            if "/" in team_name:
                sides = [s.strip() for s in team_name.split("/") if s.strip()]
                return " / ".join((s.split()[0].title() if s.split() else s) for s in sides)
            return " ".join(p.title() for p in team_name.split())

        def fmt(name, country, rank, is_india):
            o     = "IND" if is_india else (country or "")
            bits  = ([o] if o else []) + ([str(rank)] if rank else [])
            paren = f" ({', '.join(bits)})" if bits else ""
            pretty = _pretty(name)
            return f"<i>{pretty}{paren}</i>" if is_india else f"{pretty}{paren}"

        p1_str = fmt(p1_name, p1_c, p1_r, p1_ind)
        p2_str = fmt(p2_name, p2_c, p2_r, p2_ind)
        verb   = "defeated" if result_p1 == "W" else "lost to"
        scores = ", ".join(f"{a}-{b}" for a, b in game_scores) if game_scores else "–"
        discipline, round_display = _parse_discipline_round(state.get("round_name", ""))
        round_short = _round_short(round_display)
        predicted = _pretty(state["comp1_name"] if p_pre >= 0.5 else state["comp2_name"])
        pred_mark = "✅" if correct else ("❌" if correct is False else "–")
        date_label = date.today().strftime("%a %d %b")

        return (
            f"<b>{comp_name} — {date_label} — Live</b>\n"
            f"{discipline} · {round_short}\n\n"
            f"{p1_str} {verb}\n"
            f"{p2_str}\n"
            f"<b>{ga1}–{gb1}</b>  ({scores})\n"
            f"Predicted: {predicted}  {pred_mark}"
        )
    except Exception as e:
        print(f"  [TG] message build error: {e}")
        return None


def _fetch_official_result(event_id, id1: int, id2: int):
    """Fallback: look up the official final result from GetOfficialResult API."""
    try:
        r = requests.get(
            OFFICIAL_URL,
            params={"EventId": event_id, "include_match_card": "true", "take": 500},
            headers=HEADERS, timeout=15,
        )
        data = r.json() if r.status_code == 200 else []
        if not isinstance(data, list):
            data = data.get("Data") or []
        for entry in data:
            mc = entry.get("match_card") or entry
            if mc.get("resultStatus") != "OFFICIAL":
                continue
            comps = mc.get("competitiors") or []
            if len(comps) < 2:
                continue
            try:
                e1 = int(comps[0].get("competitiorId") or 0)
                e2 = int(comps[1].get("competitiorId") or 0)
            except (ValueError, TypeError):
                continue
            if {e1, e2} != {id1, id2}:
                continue
            overall = str(mc.get("resultOverallScores") or mc.get("overallScores") or "")
            if "-" in overall:
                w1, w2 = [int(x.strip()) for x in overall.split("-")[:2]]
                # result is from comp1's perspective; check if id1 matches comp1
                if e1 == id1:
                    return ("W" if w1 > w2 else "L"), w1, w2
                else:
                    return ("W" if w2 > w1 else "L"), w2, w1
    except Exception as e:
        print(f"  [TG] official fallback error: {e}")
    return None, None, None


def _write_match_result(db, match_id: str, match_p0_by_id: dict, last_state: dict, tg=None):
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
        # Incomplete state — query Official API for the actual result
        res, ga_off, gb_off = _fetch_official_result(
            state.get("event_id"), state["comp1_id"], state["comp2_id"])
        if res:
            result, ga, gb = res, ga_off, gb_off
            state = {**state, "games_a": ga, "games_b": gb}
        else:
            result = None  # truly insufficient data
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
        if tg and result:
            round_low = state.get("round_name", "").lower()
            is_key_round = any(k in round_low for k in ["quarter", "semi", "final"])
            is_india = False
            if db:
                try:
                    ids = [state["comp1_id"], state["comp2_id"]]
                    cr  = db.table("wtt_players").select("ittf_id,country_code") \
                            .in_("ittf_id", ids).execute()
                    is_india = any(r.get("country_code") == "IND" for r in (cr.data or []))
                except Exception:
                    pass
            if is_india or is_key_round:
                key = _sent_key(state["event_id"], state["comp1_id"], state["comp2_id"])
                # Persistent dedup (survives the 5h restarts, unlike the old
                # logs-file tracker which was write-only in the cloud).
                if not (db and _tc_already_sent(db, "wtt-live", [key])):
                    msg = _build_result_message(db, match_id, state, p_pre, result, correct)
                    if msg:
                        tg.send(msg)
                        _mark_sent(key)
                        if db:
                            _tc_mark_sent(db, "wtt-live", key)
    except Exception as e:
        print(f"  [DB] match_results error: {e}")


def get_active_event_ids(lookback_days: int = 7) -> list[int]:
    """
    Return event IDs from WTT_2026_EVENT_IDS whose scheduled end date falls within
    [today - lookback_days, today + 2 days], covering events in progress or just starting.
    """
    from fetch_matches import WTT_2026_EVENT_IDS
    from datetime import date, timedelta
    today  = date.today()
    past   = today - timedelta(days=lookback_days)
    future = today + timedelta(days=lookback_days)
    return [
        eid for eid, (_, end_str) in WTT_2026_EVENT_IDS.items()
        if past <= date.fromisoformat(end_str) <= future
    ]


def poll_points(mp, event_ids: list[int], gender_label: str,
                interval: float = 2.0, db=None, auto: bool = False, tg=None,
                max_runtime_min: float = 0):
    """
    Continuously poll GetLiveResult every `interval` seconds.
    Polls all event IDs in the list simultaneously.
    When auto=True, re-discovers active events from WTT_2026_EVENT_IDS every ~60s.
    Exits cleanly after max_runtime_min (0 = unlimited) so the CI job ends in
    success instead of being killed by the workflow timeout. Ctrl+C to stop.
    """
    print(f"  Polling every {interval}s — press Ctrl+C to stop.\n")
    _deadline = (time.time() + max_runtime_min * 60) if max_runtime_min else None
    _last_hb  = 0.0
    if db:
        _tc_record_health(db, "wtt-live", "ok", "poll started")
    last_seq:        dict[str, int]   = {}  # doc_code → last seen seq_num
    match_p0:        dict[str, float] = {}  # doc_code → pre-match probability
    match_p0_by_id:  dict[str, float] = {}  # match_id → pre-match probability
    last_games:      dict[str, int]   = {}  # match_id → last total games completed
    last_state:      dict[str, dict]  = {}  # match_id → last known live state
    seen_matches:    set              = set()
    missing_counts:  dict[str, int]   = {}  # match_id → consecutive absent polls
    poll_count:      int              = 0

    # Seed seen_matches + last_state + match_p0_by_id from DB on startup.
    # Without seeding last_state, _write_match_result returns early for any
    # match that was already in DB when the script (re)started.
    if db:
        try:
            existing = db.table("wtt_live_state").select("*").eq("status", "live").execute()
            for row in (existing.data or []):
                mid = row["match_id"]
                seen_matches.add(mid)
                last_state[mid] = {
                    "event_id":   row.get("event_id"),
                    "comp1_id":   row.get("comp1_id"),
                    "comp2_id":   row.get("comp2_id"),
                    "comp1_name": row.get("comp1_name", ""),
                    "comp2_name": row.get("comp2_name", ""),
                    "round_name": row.get("round_name", ""),
                    "games_a":    row.get("games_a") or 0,
                    "games_b":    row.get("games_b") or 0,
                    "p_final":    round(row.get("p_win") or 0.5, 4),
                }
                if row.get("p_prematch"):
                    match_p0_by_id[mid] = row["p_prematch"]
            if seen_matches:
                print(f"  [DB] Seeded {len(seen_matches)} in-progress match(es) from DB")
        except Exception as e:
            print(f"  [DB] Could not seed seen_matches: {e}")

    try:
        while True:
            if _deadline and time.time() > _deadline:
                print("\n  Max runtime reached — exiting cleanly.")
                break
            if db and time.time() - _last_hb > 600:   # refresh health every ~10 min
                _tc_record_health(db, "wtt-live", "ok", f"polling ({poll_count} cycles)")
                _last_hb = time.time()
            # Auto-refresh event list every 20 cycles (~60s at 3s interval)
            if auto and poll_count > 0 and poll_count % 20 == 0:
                from fetch_matches import WTT_2026_EVENT_IDS
                refreshed = get_active_event_ids()
                added = set(refreshed) - set(event_ids)
                if added:
                    for eid in added:
                        print(f"\n  [Auto] New event: {WTT_2026_EVENT_IDS.get(eid, (str(eid),))[0]} ({eid})")
                event_ids = refreshed
            poll_count += 1

            all_matches = []
            for eid in event_ids:
                all_matches.extend(fetch_live(eid))
            target  = all_matches if gender_label == "all" else [m for m in all_matches if m["round"].startswith(gender_label)]
            now_ids = set()

            if not target:
                print(f"\r  Waiting for live matches...  ", end="", flush=True)
            else:
                for m in target:
                    eid      = m["event_id"]
                    doc      = str(eid) + m["round"]
                    match_id = f"{eid}_{m['id1']}_{m['id2']}"
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
                            _upsert_live_state(db, match_id, eid, m,
                                               ga, gb, pts_a, pts_b, p, p0, seq)
                            _maybe_write_game_log(db, match_id, eid, m,
                                                  ga, gb, p, done_games, last_games, tg=tg)
                        last_state[match_id] = {
                            "event_id":   eid,
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
                    _write_match_result(db, mid, match_p0_by_id, last_state, tg=tg)
            for mid in now_ids:
                missing_counts.pop(mid, None)  # reset counter when match reappears
            seen_matches = now_ids

            time.sleep(interval)

    except KeyboardInterrupt:
        print("\n\n  Stopped.")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--event",     type=int, default=None,
                        help="Specific event ID to track (required unless --auto)")
    parser.add_argument("--auto",      action="store_true",
                        help="Auto-discover active events from schedule — no --event needed")
    parser.add_argument("--lookback",  type=int, default=7,
                        help="Days to look back when auto-discovering events (default 7)")
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
    parser.add_argument("--max-runtime", type=float, default=0,
                        help="Exit cleanly after N minutes (0 = unlimited). Set below the CI timeout.")
    args = parser.parse_args()

    if not args.auto and args.event is None:
        parser.error("provide --event <id>  or  --auto")

    if not args.live and not args.points and not args.completed:
        args.live = True   # default

    gender_label = ("Men's Singles" if args.gender == "M"
                    else "Women's Singles" if args.gender == "W"
                    else "all")
    gender_word  = ("Men" if args.gender == "M"
                    else "Women" if args.gender == "W"
                    else "All disciplines")

    if args.auto:
        from fetch_matches import WTT_2026_EVENT_IDS
        event_ids = get_active_event_ids(args.lookback)
        print(f"\n{'='*64}")
        print(f"  Live Probability Updater — AUTO mode  ({gender_word})")
        print(f"  Active events ({len(event_ids)}):")
        for eid in event_ids:
            print(f"    · {WTT_2026_EVENT_IDS.get(eid, (str(eid),))[0]}  ({eid})")
        print(f"{'='*64}")
    else:
        event_ids = [args.event]
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
        for eid in event_ids:
            matches = fetch_official(eid)
            show_completed(mp, matches, gender_label)

    if args.live:
        print("  IN-PROGRESS MATCHES — Current Point-Level Probability")
        all_matches = []
        for eid in event_ids:
            all_matches.extend(fetch_live(eid))
        print(f"  {len(all_matches)} live match(es) found.\n")
        show_live_snapshot(mp, all_matches, gender_label)

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
        tg = None
        tg_token   = os.environ.get("TELEGRAM_BOT_TOKEN")
        tg_channel = os.environ.get("TELEGRAM_CHANNEL_ID")
        if tg_token and tg_channel:
            tg = TelegramNotifier(tg_token, tg_channel)
            print(f"  [TG] Telegram enabled → {tg_channel}")
        else:
            print("  [TG] Telegram not configured (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHANNEL_ID in .env)")
        poll_points(mp, event_ids, gender_label, interval=args.interval, db=db,
                    auto=args.auto, tg=tg, max_runtime_min=args.max_runtime)


if __name__ == "__main__":
    main()
