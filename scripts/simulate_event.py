"""
simulate_event.py — Forecast a WTT event by Monte-Carlo over its bracket.

Generic across disciplines (singles / doubles / mixed / team): the bracket
engine is identical; only the per-match probability model differs (wtt_models).

Usage:
  python scripts/simulate_event.py --event 3242 --name "United States Smash 2026" \
      --subs "Men's Singles,Women's Singles" --runs 20000 \
      --out "USSmash2026_3242_Singles_FORECAST.txt"
"""

from __future__ import annotations

import os
import sys
import random
import argparse
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(__file__))

from feature_model import MatchPredictor
from wtt_schedule import fetch_schedule, parse_event
from wtt_rules import detect_tier, best_of, round_labels
from wtt_models import make_model
from wtt_qualifiers import resolve_qualifiers, fill_placeholder_qualifiers
from wtt_results import get_results, progress as actual_progress


# ── Bracket Monte-Carlo ─────────────────────────────────────────────────────

def simulate_draw(draw, model, tier, runs=20000, seed=None, results=None):
    """
    Returns:
      stats[uid] = {"reach": {round_label: prob}, "title": prob}
      comp_by_uid[uid] = Competitor

    `results`: {(round_label, match_idx): winner_id} for matches already played;
    those are locked (forced) instead of simulated -> live forecast.
    """
    rng = random.Random(seed)
    results = results or {}
    round0 = []
    for a, b in draw.matches:
        round0.append(a); round0.append(b)
    n = len(round0)
    labels = round_labels(n)                      # first round ... final
    bos = [best_of(tier, draw.discipline, lbl) for lbl in labels]
    comp_by_uid = {c.uid: c for c in round0}

    reach = {c.uid: [0] * len(labels) for c in round0}
    title = {c.uid: 0 for c in round0}

    def locked_winner(label, idx, a, b):
        wid = results.get((label, idx))
        if wid is None:
            return None
        if a.player_ids and a.player_ids[0] == wid:
            return a
        if b.player_ids and b.player_ids[0] == wid:
            return b
        return None

    for _ in range(runs):
        comps = round0
        lvl = 0
        # everyone is a participant of the first round
        for c in comps:
            reach[c.uid][0] += 1
        while len(comps) > 1:
            bo = bos[lvl]
            label = labels[lvl]
            winners = []
            for i in range(0, len(comps), 2):
                a, b = comps[i], comps[i + 1]
                idx = i // 2 + 1
                # 1) result already happened -> lock it
                w = locked_winner(label, idx, a, b)
                if w is not None:
                    winners.append(w); continue
                # 2) bye: an empty TBD slot lets the real player through
                if b.is_placeholder and b.player_ids == [None] and not b.is_qualifier:
                    winners.append(a); continue
                if a.is_placeholder and a.player_ids == [None] and not a.is_qualifier:
                    winners.append(b); continue
                # 3) otherwise simulate
                p = model.match_prob(a, b, bo)
                winners.append(a if rng.random() < p else b)
            comps = winners
            lvl += 1
            if lvl < len(labels):
                for c in comps:
                    reach[c.uid][lvl] += 1
        if comps:
            title[comps[0].uid] += 1

    stats = {}
    for uid in reach:
        stats[uid] = {
            "reach": {labels[i]: reach[uid][i] / runs for i in range(len(labels))},
            "title": title[uid] / runs,
        }
    return stats, comp_by_uid, labels


# ── Output ──────────────────────────────────────────────────────────────────

def format_forecast(draw, stats, comp_by_uid, labels, tier):
    rows = sorted(comp_by_uid.values(),
                  key=lambda c: stats[c.uid]["title"], reverse=True)
    show_rounds = [r for r in labels if r != labels[0]]  # skip first round col
    title = f"{draw.name} — FORECAST ({tier}, {draw.discipline})"
    out = [title, "=" * len(title), "",
           f"Method: Monte-Carlo over the bracket using the trained predictor.",
           f"Bo-N per round: " + ", ".join(f"{l}={best_of(tier, draw.discipline, l)}" for l in labels),
           ""]
    header = f"{'Player':<32} {'Title':>7}  " + "  ".join(f"{r:>6}" for r in show_rounds)
    out.append(header)
    out.append("-" * len(header))
    for c in rows:
        s = stats[c.uid]
        nm = (" / ".join(c.names) if c.names else "TBD")[:30]
        sd = f"[{c.seed}]" if c.seed else "   "
        line = f"{sd:>4} {nm:<27} {s['title']*100:6.1f}%  " + \
               "  ".join(f"{s['reach'][r]*100:5.1f}%" for r in show_rounds)
        out.append(line)
    out.append("")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--event", type=int, required=True)
    ap.add_argument("--name", default="")
    ap.add_argument("--subs", default="", help="comma-separated sub-events; blank = all")
    ap.add_argument("--runs", type=int, default=20000)
    ap.add_argument("--country", default=None)
    ap.add_argument("--date", default=None, help="YYYY-MM-DD event date")
    ap.add_argument("--out", default=None)
    ap.add_argument("--push", action="store_true", help="persist forecasts to Supabase")
    args = ap.parse_args()

    tier = detect_tier(args.name)
    mdate = date.fromisoformat(args.date) if args.date else None
    mpM = MatchPredictor.load("M")
    mpW = MatchPredictor.load("W")

    data = fetch_schedule(args.event)
    subs = parse_event(data)
    wanted = [s.strip() for s in args.subs.split(",") if s.strip()] or list(subs)

    # Fill any decided qualifiers into the main-draw placeholder slots.
    qmap = resolve_qualifiers(args.event)
    qrng = random.Random(42)
    qfill = {}
    for name in wanted:
        d = subs.get(name)
        if d:
            qfill[name] = fill_placeholder_qualifiers(d, qmap.get(name, []), qrng)

    # Decided main-draw results (for live forecasting): lock these matches.
    all_results = get_results(args.event)

    lines = [f"WTT {args.name or args.event}  (EventID {args.event})",
             f"Generated: {datetime.now():%Y-%m-%d %H:%M}  |  tier={tier}  |  runs={args.runs}",
             "Draw is provisional until locked; qualifier slots modelled as generic players.",
             "=" * 72, ""]

    for name in wanted:
        draw = subs.get(name)
        if not draw:
            lines += [f"[skip] {name}: not found in feed", ""]
            continue
        gender_pred = mpW if "women" in name.lower() else mpM
        model = make_model(draw.discipline, tier,
                           predictor_m=gender_pred, predictor_w=mpW,
                           event_country=args.country, match_date=mdate)
        res_sub = {(lbl, idx): wid for (s, lbl, idx), wid in all_results.items() if s == name}
        stats, comp_by_uid, labels = simulate_draw(draw, model, tier,
                                                   runs=args.runs, results=res_sub)
        block = format_forecast(draw, stats, comp_by_uid, labels, tier)
        nf = qfill.get(name, 0)
        if nf:
            block.insert(4, f"Qualifiers resolved: {nf} placeholder slot(s) filled with real players.")
        if res_sub:
            block.insert(4, f"Live: {len(res_sub)} completed match(es) locked in.")
        lines += block
        lines += [""]

        if args.push:
            from wtt_db import push_forecasts, push_entries
            status, _champ = actual_progress(draw.matches, res_sub, labels)
            # pre-event prediction = same draw, ignoring results (for actual-vs-predicted)
            init_stats, _ic, _il = simulate_draw(draw, model, tier,
                                                 runs=args.runs, results=None)
            initial = {uid: init_stats[uid]["title"] for uid in init_stats}
            n_f = push_forecasts(args.event, name, draw, stats, comp_by_uid,
                                 labels, tier, args.runs, status=status, initial=initial)
            n_e = push_entries(args.event, name, draw)
            print(f"[push] {name}: {n_f} forecasts, {n_e} entries -> Supabase")

    text = "\n".join(lines)
    if args.out:
        out_path = args.out if os.path.isabs(args.out) else \
            os.path.join(r"c:/Users/HP/Desktop/ITTF Scraper", args.out)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(text)
        print("WROTE", out_path)
    else:
        print(text)


if __name__ == "__main__":
    main()
