"""
validate_predictions.py
Tests the Elo prediction model against live/completed matches at a real event.

Usage:
  python scripts/validate_predictions.py --event 3357
  python scripts/validate_predictions.py --event 3357 --gender M

What it does:
  1. Fetches all match data for the event from the WTT live API
  2. Loads Elo ratings from DB (computed from 89,902 historical matches)
  3. For each COMPLETED match: predicts winner from Elo, checks if correct
  4. For each UPCOMING match:  shows predicted winner + win probability
  5. Prints calibration summary (how accurate are our confidence levels?)
"""

import os
import sys
import argparse
import requests
from collections import defaultdict
from supabase import create_client, Client
from elo_ratings import compute_elo, win_probability

# ── WTT API ───────────────────────────────────────────────────────────────────
RESULTS_URL = (
    "https://wtt-website-live-events-api-prod-cmfzgabgbzhphabb.eastasia-01"
    ".azurewebsites.net/api/cms/GetOfficialResult"
)
COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept":     "application/json",
    "Referer":    "https://worldtabletennis.com/",
}


# ── Fetch draw from WTT API ───────────────────────────────────────────────────
def fetch_draw(event_id: int) -> list[dict]:
    """
    Fetch all matches for an event from the WTT live API.
    Returns list of raw match dicts with player IDs, names, result.
    """
    try:
        resp = requests.get(
            RESULTS_URL,
            params={"EventId": event_id, "include_match_card": "true", "take": 1000},
            headers=COMMON_HEADERS,
            timeout=25,
        )
    except Exception as e:
        print(f"[!] API request failed: {e}")
        return []

    if resp.status_code != 200:
        print(f"[!] HTTP {resp.status_code}")
        return []

    data = resp.json()
    if isinstance(data, list):
        cards = data
    elif isinstance(data, dict):
        cards = data.get("Data") or data.get("Result") or data.get("result") or []
    else:
        return []

    matches = []
    for entry in cards:
        if not isinstance(entry, dict):
            continue
        root = entry.get("match_card") or entry

        # Handle nested team-event structures
        team_parent = root.get("teamParentData") or {}
        extended    = team_parent.get("extended_info") or {}
        individual  = extended.get("matches") or []
        to_process  = [m.get("match_result") for m in individual if m.get("match_result")]
        if not to_process:
            to_process = [root]

        for card in to_process:
            if not card or not card.get("competitiors"):
                continue
            comps = card.get("competitiors")
            if len(comps) < 2:
                continue

            c1, c2 = comps[0], comps[1]
            id1_raw = c1.get("competitiorId") or c1.get("competitorId") or ""
            id2_raw = c2.get("competitiorId") or c2.get("competitorId") or ""

            # Skip doubles pairs (contain "_") and team-level IDs (> 1M)
            if "_" in str(id1_raw) or "_" in str(id2_raw):
                continue
            try:
                id1 = int(id1_raw)
                id2 = int(id2_raw)
            except (ValueError, TypeError):
                continue
            if id1 >= 1_000_000 or id2 >= 1_000_000:
                continue

            # Determine result from comp1's perspective
            result = None
            irm1 = c1.get("irm") or ""
            irm2 = c2.get("irm") or ""
            overall = card.get("overallScores") or card.get("resultOverallScores") or ""
            if overall and "-" in str(overall):
                try:
                    w1, w2 = str(overall).split("-")[:2]
                    w1, w2 = int(w1.strip()), int(w2.strip())
                    if w1 > w2:
                        result = "W"
                    elif w2 > w1:
                        result = "L"
                except (ValueError, TypeError):
                    pass
            if result is None and (irm1 or irm2):
                result = "L" if irm1 else "W"

            matches.append({
                "id1":   id1,
                "id2":   id2,
                "name1": c1.get("competitiorName") or str(id1),
                "name2": c2.get("competitiorName") or str(id2),
                "org1":  c1.get("competitiorOrg") or "",
                "org2":  c2.get("competitiorOrg") or "",
                "result": result,   # "W"=id1 won, "L"=id2 won, None=not played
                "scores": card.get("gameScores") or card.get("resultsGameScores") or "",
                "round":  card.get("subEventDescription") or card.get("roundName") or "",
                "sub_event": card.get("subEventName") or "",
            })

    return matches


# ── Calibration buckets ───────────────────────────────────────────────────────
def calibration_bucket(p: float) -> str:
    """Bin a probability into a calibration bucket."""
    if p >= 0.90: return "90-100%"
    if p >= 0.75: return "75-90%"
    if p >= 0.60: return "60-75%"
    if p >= 0.50: return "50-60%"
    return "<50%"


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--event",  type=int, default=3357,
                        help="WTT event ID to test against")
    parser.add_argument("--gender", choices=["M", "W", "all"], default="all",
                        help="Filter by gender (M/W/all)")
    args = parser.parse_args()

    supabase = create_client(os.environ["SUPABASE_URL"],
                             os.environ["SUPABASE_SERVICE_KEY"])

    print(f"\n{'='*65}")
    print(f"  Elo Prediction Validator — Event ID {args.event}")
    print(f"{'='*65}")

    # Step 1: Compute Elo
    print("\n[1/3] Computing Elo ratings from DB...")
    gender_filter = None if args.gender == "all" else args.gender
    elo = compute_elo(supabase, gender_filter=gender_filter)

    # Step 2: Load player name/gender map from DB
    print("[2/3] Loading player profiles...")
    p_resp = supabase.table("wtt_players") \
        .select("ittf_id,player_name,gender,country_code").execute()
    pmap = {p["ittf_id"]: p for p in (p_resp.data or [])}

    # Step 3: Fetch live draw
    print(f"[3/3] Fetching live draw for event {args.event}...")
    matches = fetch_draw(args.event)
    print(f"  {len(matches)} match cards fetched from API.\n")

    if not matches:
        print("[!] No matches returned. Check event ID or API availability.")
        return

    # Filter by gender if requested
    if args.gender != "all":
        def is_gender(m):
            g1 = pmap.get(m["id1"], {}).get("gender")
            g2 = pmap.get(m["id2"], {}).get("gender")
            return g1 == args.gender or g2 == args.gender
        matches = [m for m in matches if is_gender(m)]

    # Split into completed vs upcoming
    completed = [m for m in matches if m["result"] is not None]
    upcoming  = [m for m in matches if m["result"] is None]

    # ── Completed matches: accuracy check ────────────────────────────────────
    print(f"{'─'*65}")
    print(f"  COMPLETED MATCHES — Prediction vs Actual")
    print(f"{'─'*65}")
    print(f"  {'Round':<35} {'Predicted':<22} {'Actual':<8} {'P(win)':<7} OK?")
    print(f"  {'-'*63}")

    correct = 0
    total   = 0
    calib: dict[str, list[bool]] = defaultdict(list)

    for m in completed:
        e1 = elo.get(m["id1"], 1500.0)
        e2 = elo.get(m["id2"], 1500.0)
        p1 = win_probability(e1, e2)

        predicted_winner = m["id1"] if p1 >= 0.5 else m["id2"]
        actual_winner    = m["id1"] if m["result"] == "W" else m["id2"]
        p_predicted      = p1 if p1 >= 0.5 else (1 - p1)

        correct_flag = predicted_winner == actual_winner
        if correct_flag:
            correct += 1
        total += 1

        bucket = calibration_bucket(p_predicted)
        calib[bucket].append(correct_flag)

        name1 = m["name1"]
        name2 = m["name2"]
        pred_name   = name1 if predicted_winner == m["id1"] else name2
        actual_name = name1 if actual_winner    == m["id1"] else name2
        marker = "✓" if correct_flag else "✗"

        # Shorten round name for display
        round_label = m["round"][:34] if m["round"] else m["sub_event"][:34]
        print(f"  {round_label:<35} {pred_name:<22} {actual_name:<8} "
              f"{p_predicted*100:>4.0f}%  {marker}")

    # ── Upcoming matches: predictions ─────────────────────────────────────────
    if upcoming:
        print(f"\n{'─'*65}")
        print(f"  UPCOMING / IN-PROGRESS MATCHES — Elo Predictions")
        print(f"{'─'*65}")
        print(f"  {'Round':<35} {'Favourite':<22} {'P(win)':<7} vs {'Underdog'}")
        print(f"  {'-'*63}")

        for m in upcoming:
            e1 = elo.get(m["id1"], 1500.0)
            e2 = elo.get(m["id2"], 1500.0)
            p1 = win_probability(e1, e2)

            if p1 >= 0.5:
                fav, dog, p_fav = m["name1"], m["name2"], p1
            else:
                fav, dog, p_fav = m["name2"], m["name1"], 1 - p1

            round_label = m["round"][:34] if m["round"] else m["sub_event"][:34]
            print(f"  {round_label:<35} {fav:<22} {p_fav*100:>4.0f}%  {dog}")

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n{'─'*65}")
    print(f"  ACCURACY SUMMARY")
    print(f"{'─'*65}")
    if total > 0:
        print(f"  Overall: {correct}/{total} correct  ({100*correct/total:.1f}%)")
        print(f"\n  Calibration (does confidence match win rate?):")
        print(f"  {'Confidence':<12} {'Predicted':<12} {'Actual win%'}")
        print(f"  {'-'*40}")
        for bucket in ["90-100%", "75-90%", "60-75%", "50-60%", "<50%"]:
            outcomes = calib.get(bucket, [])
            if outcomes:
                actual_pct = 100 * sum(outcomes) / len(outcomes)
                print(f"  {bucket:<12} {len(outcomes):>3} matches     "
                      f"{actual_pct:>5.1f}% won")
    else:
        print("  No completed matches to evaluate yet.")

    print(f"\n  Elo coverage: {sum(1 for m in matches if m['id1'] in elo or m['id2'] in elo)}"
          f"/{len(matches)} matches have at least one rated player.\n")


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(__file__))
    main()
