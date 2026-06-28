"""
report_card.py — Accuracy report for the singles MatchPredictor.

Evaluates the SAME offline model the simulator uses (model_weights_{M,W}.json)
against COMPLETED singles matches at one or more events.

Fairness note: the model snapshot is dated; matches played AFTER that date are
true hold-out (no look-ahead).  Pass such events for an honest report.

Metrics:
  - N            matches scored (both players known to the model)
  - Accuracy     how often the model's favourite actually won
  - Brier        mean squared error of the probability (lower = better; 0.25 = coin flip)
  - LogLoss      log loss (lower = better)
  - Calibration  "when we said ~X%, did it happen ~X% of the time?"

Usage:
  python scripts/report_card.py --events 3241,3242 --names "Ljubljana,US Smash Qual"
"""

from __future__ import annotations

import os
import sys
import math
import argparse
import requests
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from feature_model import MatchPredictor

_URL = ("https://wtt-website-live-events-api-prod-cmfzgabgbzhphabb.eastasia-01"
        ".azurewebsites.net/api/cms/GetOfficialResult")
_H = {"User-Agent": "Mozilla/5.0", "Accept": "application/json",
      "Referer": "https://worldtabletennis.com/"}


def completed_singles(event_id: int):
    """Yield (gender, id_win, id_lose) for completed singles matches."""
    try:
        data = requests.get(_URL, params={"EventId": event_id,
                            "include_match_card": "true", "take": 2000},
                            headers=_H, timeout=25).json()
    except Exception:
        return
    if isinstance(data, dict):
        data = data.get("Data") or data.get("Result") or []
    for c in data:
        mc = c.get("match_card") or {}
        sub = mc.get("subEventName") or ""
        if "singles" not in sub.lower():
            continue
        gender = "W" if "women" in sub.lower() else "M"
        comps = mc.get("competitiors") or []
        if len(comps) < 2:
            continue
        c1, c2 = comps[0], comps[1]
        ov = mc.get("overallScores") or mc.get("resultOverallScores") or ""
        m = ov.split("-") if ov else []
        if len(m) != 2 or not (m[0].strip().isdigit() and m[1].strip().isdigit()):
            continue
        a, b = int(m[0]), int(m[1])
        if a == b:
            continue
        try:
            id1 = int(c1.get("competitiorId") or c1.get("competitorId"))
            id2 = int(c2.get("competitiorId") or c2.get("competitorId"))
        except (TypeError, ValueError):
            continue
        if id1 >= 1_000_000 or id2 >= 1_000_000:
            continue
        win, lose = (id1, id2) if a > b else (id2, id1)
        yield gender, win, lose


def score_event(event_id, mpM, mpW):
    rows = []
    for gender, win, lose in completed_singles(event_id):
        mp = mpW if gender == "W" else mpM
        if win not in mp.states or lose not in mp.states:
            continue  # skip unknown players (cold-start) for a fair model test
        p_win = mp.predict(win, lose)   # model's prob the ACTUAL winner wins
        rows.append(p_win)
    return rows


def summarize(rows):
    n = len(rows)
    if n == 0:
        return None
    acc = sum(1 for p in rows if p >= 0.5) / n
    brier = sum((1 - p) ** 2 for p in rows) / n
    logloss = sum(-math.log(max(1e-6, p)) for p in rows) / n
    return {"n": n, "acc": acc, "brier": brier, "logloss": logloss}


def calibration(rows, bins=5):
    """Bucket by favourite confidence; compare predicted vs actual hit-rate."""
    buckets = defaultdict(list)
    for p in rows:
        fav = max(p, 1 - p)          # confidence in the favourite
        hit = 1 if p >= 0.5 else 0   # did the favourite (=actual winner if p>=.5) win
        # express as: predicted favourite prob vs whether favourite won
        edges = [0.5, 0.6, 0.7, 0.8, 0.9, 1.01]
        for i in range(len(edges) - 1):
            if edges[i] <= fav < edges[i + 1]:
                buckets[(edges[i], edges[i + 1])].append(hit)
                break
    out = []
    for rng in sorted(buckets):
        v = buckets[rng]
        out.append((rng, len(v), sum(v) / len(v)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--events", required=True, help="comma-separated event ids")
    ap.add_argument("--names", default="", help="comma-separated labels")
    args = ap.parse_args()
    ids = [int(x) for x in args.events.split(",")]
    names = [s.strip() for s in args.names.split(",")] if args.names else []

    mpM = MatchPredictor.load("M")
    mpW = MatchPredictor.load("W")

    print("SINGLES MODEL - REPORT CARD")
    print("model snapshot: model_weights_{M,W}.json (events after its date = fair hold-out)")
    print("=" * 60)
    all_rows = []
    for i, eid in enumerate(ids):
        rows = score_event(eid, mpM, mpW)
        all_rows += rows
        s = summarize(rows)
        label = names[i] if i < len(names) else str(eid)
        if not s:
            print(f"\n{label} (id {eid}): no scorable matches")
            continue
        print(f"\n{label} (id {eid})")
        print(f"  matches scored : {s['n']}")
        print(f"  accuracy       : {s['acc']*100:.1f}%  (favourite won)")
        print(f"  Brier          : {s['brier']:.3f}  (0.25 = coin flip; lower better)")
        print(f"  LogLoss        : {s['logloss']:.3f}")

    s = summarize(all_rows)
    if s:
        print("\n" + "=" * 60)
        print(f"OVERALL: {s['n']} matches | acc {s['acc']*100:.1f}% | "
              f"Brier {s['brier']:.3f} | LogLoss {s['logloss']:.3f}")
        print("\nCalibration (favourite confidence -> actual win rate):")
        print(f"  {'predicted':<14}{'matches':>9}{'actual':>9}")
        for (lo, hi), cnt, rate in calibration(all_rows):
            print(f"  {lo*100:.0f}-{hi*100:.0f}% {'':<6}{cnt:>7}{rate*100:>8.0f}%")


if __name__ == "__main__":
    main()
