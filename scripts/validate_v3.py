"""
validate_v3.py
Test the V3 feature model against live/completed WTT matches.

No DB connection needed — uses saved model_weights_*.json + model_*_*.pkl files.

Usage:
  python scripts/validate_v3.py --event 3232 --gender M
  python scripts/validate_v3.py --event 3232 --gender W
  python scripts/validate_v3.py --event 3357 --gender M
  python scripts/validate_v3.py --event 3232 --gender M --explain

Arguments:
  --event     WTT event ID to test against (default: 3232 = WTT Star Contender Doha 2026)
  --gender    M or W (default: M)
  --explain   Show full feature breakdown for every completed match
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


def fetch_draw(event_id: int) -> list[dict]:
    """Fetch all match cards for an event from the WTT API."""
    try:
        resp = requests.get(
            RESULTS_URL,
            params={"EventId": event_id, "include_match_card": "true", "take": 1000},
            headers=HEADERS,
            timeout=25,
        )
    except Exception as e:
        print(f"[!] API request failed: {e}")
        return []

    if resp.status_code != 200:
        print(f"[!] HTTP {resp.status_code}")
        return []

    data = resp.json()
    cards = (data if isinstance(data, list)
             else data.get("Data") or data.get("Result") or data.get("result") or [])

    matches = []
    for entry in cards:
        if not isinstance(entry, dict):
            continue
        root = entry.get("match_card") or entry

        # Handle nested team-event structures
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

            # Result from comp1's perspective
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
                "id1":   id1,  "id2":   id2,
                "name1": c1.get("competitiorName") or str(id1),
                "name2": c2.get("competitiorName") or str(id2),
                "org1":  c1.get("competitiorOrg") or "",
                "org2":  c2.get("competitiorOrg") or "",
                "result": result,    # "W"=id1 won, "L"=id2 won, None=not played
                "scores": card.get("gameScores") or card.get("resultsGameScores") or "",
                "overall_score": overall,  # e.g. "3-1" games won by id1 vs id2
                "round":  card.get("subEventDescription") or card.get("roundName") or "",
            })
    return matches


# ── Calibration helper ────────────────────────────────────────────────────────
def calibration_bucket(p: float) -> str:
    if p >= 0.90: return "90-100%"
    if p >= 0.75: return "75-90%"
    if p >= 0.60: return "60-75%"
    if p >= 0.50: return "50-60%"
    return "<50%"


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--event",   type=int, default=3232,
                        help="WTT event ID (default: 3232 = WTT Star Contender Doha 2026)")
    parser.add_argument("--gender",  choices=["M", "W"], default="M")
    parser.add_argument("--explain", action="store_true",
                        help="Show full feature breakdown for every completed match")
    args = parser.parse_args()

    print(f"\n{'='*65}")
    print(f"  V3 Model Validator — Event {args.event}  |  {'Men' if args.gender=='M' else 'Women'}")
    print(f"{'='*65}")

    # ── Load model (no DB needed) ─────────────────────────────────────────────
    print(f"\n[1/3] Loading V3 model from saved files...")
    try:
        mp = MatchPredictor.load(args.gender)
    except FileNotFoundError as e:
        print(f"[!] Model file not found: {e}")
        print(f"    Run: python scripts/feature_model.py --gender {args.gender}")
        return
    print(f"      {mp.states.__len__()} player states loaded.")

    # ── Fetch live draw ───────────────────────────────────────────────────────
    print(f"[2/3] Fetching draw for event {args.event} from WTT API...")
    matches = fetch_draw(args.event)
    print(f"      {len(matches)} match cards fetched.")
    if not matches:
        print("[!] No matches returned. Check event ID or API availability.")
        return

    # ── Filter to the relevant gender's singles matches only ──────────────────
    # Events like WTT Star Contender include men's + women's singles + doubles.
    # A men's model has no valid Elo for women (defaults to 1450 = noise).
    # Only count matches where the round label matches the target gender + singles.
    gender_label = "Men's Singles" if args.gender == "M" else "Women's Singles"

    def is_target(m):
        r = (m.get("round") or "").strip()
        return r.startswith(gender_label)

    all_matches  = matches
    matches      = [m for m in matches if is_target(m)]
    other_count  = len(all_matches) - len(matches)

    # ── Split completed vs upcoming ───────────────────────────────────────────
    completed = [m for m in matches if m["result"] is not None]
    upcoming  = [m for m in matches if m["result"] is None]

    print(f"[3/3] {len(completed)} completed, {len(upcoming)} upcoming "
          f"({other_count} non-target matches excluded).\n")

    # ── Completed matches ─────────────────────────────────────────────────────
    print(f"{'─'*80}")
    print(f"  COMPLETED MATCHES")
    print(f"{'─'*80}")
    print(f"  {'Round':<30} {'Predicted':<16} {'Actual':<16} {'Exp.Games':>9}  {'Act.':>4}  {'Exp.Pts':>7}  {'P':>5}  V8  Elo")
    print(f"  {'-'*78}")

    v3_correct = elo_correct = total = 0
    calib_v3  = defaultdict(list)
    calib_elo = defaultdict(list)
    game_errors = []
    exact_score_hits = 0
    pt_errors   = []   # per-game point MAE
    exact_pt_hits = 0  # exact per-game score hit (e.g. predicted "11-8", actual "11-8")

    def _parse_overall(s: str):
        """Parse '3-1' → (3, 1) from id1's perspective. Returns None on failure."""
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

    for m in completed:
        id1, id2 = m["id1"], m["id2"]
        name1, name2 = m["name1"][:14], m["name2"][:14]

        # V8 prediction
        sc          = mp.predict_score(id1, id2)
        p_v3        = sc["p_match"]
        v3_pred_won = id1 if p_v3 >= 0.5 else id2
        p_v3_fav    = p_v3 if p_v3 >= 0.5 else 1 - p_v3

        # Expected game score string (from id1's perspective)
        exp_str = f"{sc['exp_a']:.1f}-{sc['exp_b']:.1f}"

        # Expected point score per game (from id1's perspective)
        exp_pts_str = f"{sc['exp_pts_a']:.1f}-{sc['exp_pts_b']:.1f}"

        # Elo-only prediction
        elo1 = mp.get_state(id1)["elo"]
        elo2 = mp.get_state(id2)["elo"]
        p_elo     = 1.0 / (1.0 + 10 ** ((elo2 - elo1) / 400.0))
        elo_pred_won = id1 if p_elo >= 0.5 else id2

        actual_won  = id1 if m["result"] == "W" else id2
        pred_name   = name1 if v3_pred_won == id1 else name2
        actual_name = name1 if actual_won  == id1 else name2

        v3_ok  = v3_pred_won  == actual_won
        elo_ok = elo_pred_won == actual_won
        if v3_ok:  v3_correct  += 1
        if elo_ok: elo_correct += 1
        total += 1

        calib_v3[calibration_bucket(p_v3_fav)].append(v3_ok)
        p_elo_fav = p_elo if p_elo >= 0.5 else 1 - p_elo
        calib_elo[calibration_bucket(p_elo_fav)].append(elo_ok)

        # Game-level score accuracy
        parsed = _parse_overall(m.get("overall_score", ""))
        act_score_str = ""
        if parsed:
            actual_g1, actual_g2 = parsed
            act_score_str = f"{actual_g1}-{actual_g2}"
            game_errors.append(abs(sc["exp_a"] - actual_g1))
            if sc["mode"] == act_score_str:
                exact_score_hits += 1

        # Point-level score accuracy (compare exp_pts vs actual per-game average)
        actual_games = _parse_game_scores(m.get("scores", ""))
        if actual_games:
            avg_pts1 = sum(a for a, b in actual_games) / len(actual_games)
            avg_pts2 = sum(b for a, b in actual_games) / len(actual_games)
            pt_errors.append(abs(sc["exp_pts_a"] - avg_pts1))
            # Check if most likely game score (pt_mode) appears in actual games
            pt_mode_pair = tuple(int(x) for x in sc["pt_mode"].split("-"))
            if pt_mode_pair in actual_games:
                exact_pt_hits += 1

        v3_mark  = "✓" if v3_ok  else "✗"
        elo_mark = "✓" if elo_ok else "✗"
        round_lbl = (m["round"] or "")[:29]
        print(f"  {round_lbl:<30} {pred_name:<16} {actual_name:<16} "
              f"{exp_str:>9}  {act_score_str:>4}  {exp_pts_str:>7}  {p_v3_fav*100:>4.0f}%  {v3_mark}   {elo_mark}")

        if args.explain:
            mp.explain(id1, id2, name_a=m["name1"], name_b=m["name2"])

    # ── Upcoming matches ──────────────────────────────────────────────────────
    if upcoming:
        print(f"\n{'─'*70}")
        print(f"  UPCOMING / IN-PROGRESS MATCHES — V8 Predictions")
        print(f"{'─'*80}")
        print(f"  {'Round':<30} {'Favourite':<20} {'Exp.Games':>10}  {'Exp.Pts':>8}  {'P(win)':>7}  vs  Underdog")
        print(f"  {'-'*78}")
        for m in upcoming:
            sc = mp.predict_score(m["id1"], m["id2"])
            p  = sc["p_match"]
            if p >= 0.5:
                fav, dog  = m["name1"], m["name2"]
                exp_str   = f"{sc['exp_a']:.1f}–{sc['exp_b']:.1f}"
                pts_str   = f"{sc['exp_pts_a']:.1f}–{sc['exp_pts_b']:.1f}"
            else:
                fav, dog  = m["name2"], m["name1"]
                exp_str   = f"{sc['exp_b']:.1f}–{sc['exp_a']:.1f}"
                pts_str   = f"{sc['exp_pts_b']:.1f}–{sc['exp_pts_a']:.1f}"
                p         = 1 - p
            round_lbl = (m["round"] or "")[:29]
            print(f"  {round_lbl:<30} {fav:<20} {exp_str:>10}  {pts_str:>8}  {p*100:>6.1f}%  vs  {dog}")

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n{'─'*70}")
    print(f"  ACCURACY SUMMARY")
    print(f"{'─'*70}")
    if total > 0:
        print(f"  {'Model':<28}  {'Correct':>8}  {'Accuracy':>10}")
        print(f"  {'-'*50}")
        print(f"  {'V7 (feature model)':<28}  {v3_correct:>5}/{total:<3}  {100*v3_correct/total:>9.1f}%")
        print(f"  {'Elo-only baseline':<28}  {elo_correct:>5}/{total:<3}  {100*elo_correct/total:>9.1f}%")
        delta = 100 * (v3_correct - elo_correct) / total
        print(f"  {'V7 improvement':<28}  {'':>8}  {delta:>+9.1f}%")

        # Game score accuracy
        if game_errors:
            mae = sum(game_errors) / len(game_errors)
            exact_pct = 100 * exact_score_hits / len(game_errors)
            print(f"\n  Game Score Accuracy (Markov — {len(game_errors)} matches):")
            print(f"  {'Mean abs. game error':<28}  {mae:>8.2f} games")
            print(f"  {'Exact game score hit rate':<28}  {exact_score_hits:>5}/{len(game_errors):<3}  {exact_pct:>9.1f}%")

        # Point score accuracy
        if pt_errors:
            pt_mae = sum(pt_errors) / len(pt_errors)
            exact_pt_pct = 100 * exact_pt_hits / len(pt_errors)
            print(f"\n  Point Score Accuracy (per-game — {len(pt_errors)} matches with game data):")
            print(f"  {'Mean abs. point error/game':<28}  {pt_mae:>8.2f} pts")
            print(f"  {'Exact per-game score hit':<28}  {exact_pt_hits:>5}/{len(pt_errors):<3}  {exact_pt_pct:>9.1f}%")

        print(f"\n  Calibration — V7 (does confidence match win rate?):")
        print(f"  {'Bucket':<12} {'N':>5}  {'V7 win%':>10}  {'Elo win%':>10}")
        print(f"  {'-'*42}")
        for bucket in ["90-100%", "75-90%", "60-75%", "50-60%", "<50%"]:
            v3_out  = calib_v3.get(bucket, [])
            elo_out = calib_elo.get(bucket, [])
            if v3_out or elo_out:
                v3_pct  = 100 * sum(v3_out)  / len(v3_out)  if v3_out  else 0
                elo_pct = 100 * sum(elo_out) / len(elo_out) if elo_out else 0
                n = len(v3_out) or len(elo_out)
                print(f"  {bucket:<12} {n:>5}  {v3_pct:>9.1f}%  {elo_pct:>9.1f}%")
    else:
        print("  No completed matches to evaluate.")

    coverage = sum(1 for m in matches
                   if mp.get_state(m["id1"])["elo"] != 1450.0
                   or mp.get_state(m["id2"])["elo"] != 1450.0)
    print(f"\n  Model coverage: {coverage}/{len(matches)} {gender_label} matches "
          f"have at least one rated player.\n")


if __name__ == "__main__":
    main()
