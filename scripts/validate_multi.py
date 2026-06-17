"""
validate_multi.py
Multi-event validator for the V8 feature model.

Tests across a set of held-out events (all truly out-of-sample when the model
was trained with --test-events covering all of them).

Usage:
  python scripts/validate_multi.py --gender M
  python scripts/validate_multi.py --gender W
  python scripts/validate_multi.py --gender M --events 3232 3234 3379

Default events (10-event held-out set):
  3098  China Smash 2025 (Grand Smash)
  3110  Star Contender London 2025
  3176  Star Contender Muscat 2025
  3232  Star Contender Doha 2026
  3233  Star Contender Chennai 2026
  3234  Singapore Smash 2026 (Grand Smash)
  3235  WTT Champions Chongqing 2026
  3236  WTT Contender Tunis 2026
  3237  WTT Contender Taiyuan 2026
  3379  ITTF World Cup Macao 2026 (Singles World Cup)
"""

import os
import sys
import argparse
import requests
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from feature_model import MatchPredictor

# ── WTT live results API ───────────────────────────────────────────────────────
RESULTS_URL = (
    "https://wtt-website-live-events-api-prod-cmfzgabgbzhphabb.eastasia-01"
    ".azurewebsites.net/api/cms/GetOfficialResult"
)
HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept":     "application/json",
    "Referer":    "https://worldtabletennis.com/",
}

EVENT_NAMES = {
    3098: "China Smash 2025",
    3110: "Star Contender London 2025",
    3176: "Star Contender Muscat 2025",
    3232: "Star Contender Doha 2026",
    3233: "Star Contender Chennai 2026",
    3234: "Singapore Smash 2026",
    3235: "WTT Champions Chongqing 2026",
    3236: "WTT Contender Tunis 2026",
    3237: "WTT Contender Taiyuan 2026",
    3379: "World Cup Macao 2026",
}

DEFAULT_EVENTS = [3098, 3110, 3176, 3232, 3233, 3234, 3235, 3236, 3237, 3379]


def fetch_draw(event_id: int) -> list[dict]:
    try:
        resp = requests.get(
            RESULTS_URL,
            params={"EventId": event_id, "include_match_card": "true", "take": 1000},
            headers=HEADERS,
            timeout=25,
        )
    except Exception as e:
        print(f"  [!] API error for event {event_id}: {e}")
        return []

    if resp.status_code != 200:
        print(f"  [!] HTTP {resp.status_code} for event {event_id}")
        return []

    data = resp.json()
    cards = (data if isinstance(data, list)
             else data.get("Data") or data.get("Result") or data.get("result") or [])

    matches = []
    for entry in cards:
        if not isinstance(entry, dict):
            continue
        root = entry.get("match_card") or entry
        individual = ((root.get("teamParentData") or {})
                      .get("extended_info", {})
                      .get("matches") or [])
        to_process = [m.get("match_result") for m in individual if m.get("match_result")] or [root]

        for card in to_process:
            if not card or not card.get("competitiors"):
                continue
            comps = card["competitiors"]
            if len(comps) < 2:
                continue
            c1, c2 = comps[0], comps[1]
            id1_raw = c1.get("competitiorId") or c1.get("competitorId") or ""
            id2_raw = c2.get("competitiorId") or c2.get("competitorId") or ""
            if "_" in str(id1_raw) or "_" in str(id2_raw):
                continue
            try:
                id1, id2 = int(id1_raw), int(id2_raw)
            except (ValueError, TypeError):
                continue
            if id1 >= 1_000_000 or id2 >= 1_000_000:
                continue

            result = None
            overall = card.get("overallScores") or card.get("resultOverallScores") or ""
            if overall and "-" in str(overall):
                try:
                    w1, w2 = [int(x.strip()) for x in str(overall).split("-")[:2]]
                    result = "W" if w1 > w2 else ("L" if w2 > w1 else None)
                except (ValueError, TypeError):
                    pass
            if result is None:
                irm1 = c1.get("irm") or ""
                irm2 = c2.get("irm") or ""
                if irm1 or irm2:
                    result = "L" if irm1 else "W"

            matches.append({
                "id1": id1, "id2": id2,
                "name1": c1.get("competitiorName") or str(id1),
                "name2": c2.get("competitiorName") or str(id2),
                "result": result,
                "overall_score": overall,
                "scores": card.get("gameScores") or card.get("resultsGameScores") or "",
                "round": card.get("subEventDescription") or card.get("roundName") or "",
            })
    return matches


def calibration_bucket(p: float) -> str:
    if p >= 0.90: return "90-100%"
    if p >= 0.75: return "75-90%"
    if p >= 0.60: return "60-75%"
    if p >= 0.50: return "50-60%"
    return "<50%"


def _parse_overall(s):
    try:
        parts = str(s).split("-")
        return int(parts[0].strip()), int(parts[1].strip())
    except Exception:
        return None


def _parse_game_scores(s: str) -> list[tuple[int, int]]:
    """Parse '11-7,9-11,12-10,0-0' → [(11,7),(9,11),(12,10)] (skip 0-0)."""
    result = []
    for g in str(s).split(","):
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--gender",  choices=["M", "W"], default="M")
    parser.add_argument("--events",  type=int, nargs="+", default=DEFAULT_EVENTS,
                        help="WTT event IDs to validate against")
    args = parser.parse_args()

    gender_label = "Men's Singles" if args.gender == "M" else "Women's Singles"
    gender_word  = "Men" if args.gender == "M" else "Women"

    print(f"\n{'='*70}")
    print(f"  V8 Multi-Event Validator — {gender_word}  ({len(args.events)} events)")
    print(f"{'='*70}")

    # Load model
    print("\nLoading model...")
    try:
        mp = MatchPredictor.load(args.gender)
    except FileNotFoundError as e:
        print(f"[!] {e}\n    Run: python scripts/feature_model.py --gender {args.gender}")
        return
    print(f"  {len(mp.states)} player states loaded.\n")

    # Per-event results
    totals = {
        "v8_correct": 0, "elo_correct": 0, "total": 0,
        "game_errors": [], "exact_hits": 0,
        "pt_errors": [], "exact_pt_hits": 0,
    }
    calib_v8  = defaultdict(list)
    calib_elo = defaultdict(list)

    print(f"  {'Event':<32} {'Tier':<16} {'N':>4}  {'V8':>6}  {'Elo':>6}  {'Δ':>6}  {'MAE':>5}  {'Exact':>5}  {'Pt.MAE':>6}")
    print(f"  {'─'*80}")

    for event_id in args.events:
        name = EVENT_NAMES.get(event_id, f"Event {event_id}")
        matches = fetch_draw(event_id)

        # Filter to target gender singles only
        target = [m for m in matches
                  if (m.get("round") or "").strip().startswith(gender_label)]
        completed = [m for m in target if m["result"] is not None]

        if not completed:
            print(f"  {name:<32} {'—':<16} {'0':>4}  (no completed matches)")
            continue

        ev_v8 = ev_elo = ev_total = 0
        ev_game_errors = []
        ev_exact = 0
        ev_pt_errors = []
        ev_exact_pt = 0

        for m in completed:
            id1, id2 = m["id1"], m["id2"]

            sc   = mp.predict_score(id1, id2)
            p_v8 = sc["p_match"]
            v8_pred_won = id1 if p_v8 >= 0.5 else id2
            p_v8_fav    = p_v8 if p_v8 >= 0.5 else 1 - p_v8

            elo1 = mp.get_state(id1)["elo"]
            elo2 = mp.get_state(id2)["elo"]
            p_elo = 1.0 / (1.0 + 10 ** ((elo2 - elo1) / 400.0))
            elo_pred_won = id1 if p_elo >= 0.5 else id2
            p_elo_fav    = p_elo if p_elo >= 0.5 else 1 - p_elo

            actual_won = id1 if m["result"] == "W" else id2
            v8_ok  = v8_pred_won  == actual_won
            elo_ok = elo_pred_won == actual_won

            if v8_ok:  ev_v8  += 1
            if elo_ok: ev_elo += 1
            ev_total += 1

            calib_v8[calibration_bucket(p_v8_fav)].append(v8_ok)
            calib_elo[calibration_bucket(p_elo_fav)].append(elo_ok)

            parsed = _parse_overall(m.get("overall_score", ""))
            if parsed:
                actual_g1, actual_g2 = parsed
                act_str = f"{actual_g1}-{actual_g2}"
                ev_game_errors.append(abs(sc["exp_a"] - actual_g1))
                if sc["mode"] == act_str:
                    ev_exact += 1

            # Point-level accuracy
            actual_games = _parse_game_scores(m.get("scores", ""))
            if actual_games:
                avg_pts1 = sum(a for a, b in actual_games) / len(actual_games)
                ev_pt_errors.append(abs(sc["exp_pts_a"] - avg_pts1))
                pt_mode_pair = tuple(int(x) for x in sc["pt_mode"].split("-"))
                if pt_mode_pair in actual_games:
                    ev_exact_pt += 1

        totals["v8_correct"]   += ev_v8
        totals["elo_correct"]  += ev_elo
        totals["total"]        += ev_total
        totals["game_errors"].extend(ev_game_errors)
        totals["exact_hits"]   += ev_exact
        totals["pt_errors"].extend(ev_pt_errors)
        totals["exact_pt_hits"] += ev_exact_pt

        v8_pct  = 100 * ev_v8  / ev_total if ev_total else 0
        elo_pct = 100 * ev_elo / ev_total if ev_total else 0
        delta   = v8_pct - elo_pct
        mae_str   = f"{sum(ev_game_errors)/len(ev_game_errors):.2f}" if ev_game_errors else "—"
        exact_pct = f"{100*ev_exact/len(ev_game_errors):.0f}%"       if ev_game_errors else "—"
        pt_mae_s  = f"{sum(ev_pt_errors)/len(ev_pt_errors):.2f}"     if ev_pt_errors   else "—"

        print(f"  {name:<32} {'':<16} {ev_total:>4}  {v8_pct:>5.1f}%  {elo_pct:>5.1f}%  {delta:>+5.1f}%  {mae_str:>5}  {exact_pct:>5}  {pt_mae_s:>6}")

    # Aggregate summary
    n = totals["total"]
    if n == 0:
        print("\n  No completed matches found across any event.")
        return

    v8_total  = 100 * totals["v8_correct"]  / n
    elo_total = 100 * totals["elo_correct"] / n
    delta_tot = v8_total - elo_total
    game_errors = totals["game_errors"]
    pt_errors   = totals["pt_errors"]
    mae_tot     = sum(game_errors) / len(game_errors) if game_errors else None
    exact_tot   = 100 * totals["exact_hits"]    / len(game_errors) if game_errors else None
    pt_mae_tot  = sum(pt_errors)   / len(pt_errors)   if pt_errors   else None
    exact_pt_tot= 100 * totals["exact_pt_hits"] / len(pt_errors)   if pt_errors   else None

    print(f"  {'─'*90}")
    mae_s    = f"{mae_tot:.2f}"    if mae_tot    is not None else "—"
    exact_s  = f"{exact_tot:.0f}%" if exact_tot  is not None else "—"
    pt_mae_s = f"{pt_mae_tot:.2f}" if pt_mae_tot is not None else "—"
    print(f"  {'AGGREGATE':<32} {'':<16} {n:>4}  {v8_total:>5.1f}%  {elo_total:>5.1f}%  {delta_tot:>+5.1f}%  {mae_s:>5}  {exact_s:>5}  {pt_mae_s:>6}")

    if pt_mae_tot is not None:
        print(f"\n  Point score (per-game): MAE {pt_mae_tot:.2f} pts  |  "
              f"Exact game hit {totals['exact_pt_hits']}/{len(pt_errors)} "
              f"({exact_pt_tot:.1f}%)")

    print(f"\n{'─'*70}")
    print(f"  CALIBRATION — V8 vs Elo (does confidence match actual win rate?)")
    print(f"{'─'*70}")
    print(f"  {'Bucket':<12} {'N':>5}  {'V8 win%':>10}  {'Elo win%':>10}")
    print(f"  {'─'*42}")
    for bucket in ["90-100%", "75-90%", "60-75%", "50-60%", "<50%"]:
        v8_out  = calib_v8.get(bucket, [])
        elo_out = calib_elo.get(bucket, [])
        if v8_out or elo_out:
            v8_pct  = 100 * sum(v8_out)  / len(v8_out)  if v8_out  else 0
            elo_pct = 100 * sum(elo_out) / len(elo_out) if elo_out else 0
            nb = len(v8_out) or len(elo_out)
            print(f"  {bucket:<12} {nb:>5}  {v8_pct:>9.1f}%  {elo_pct:>9.1f}%")

    print(f"\n  Matches evaluated: {n}  |  Scored: {len(game_errors)}\n")


if __name__ == "__main__":
    main()
