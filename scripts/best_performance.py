import csv
import re
from collections import defaultdict

ROUND_DEPTH = {
    "Final": 7,
    "Semifinal": 6,
    "Quarterfinal": 5,
    "Round of 16": 4,
    "Round of 32": 3,
    "Round of 64": 2,
    "Round of 128": 1,
    "Qualifying Round 2": 0,
    "Qualifying Round 1": -1,
}

def round_key(round_phase):
    for name, depth in ROUND_DEPTH.items():
        if name in round_phase:
            return depth, name
    m = re.search(r"Group\s*\d+", round_phase)
    if m:
        return -2, "Group Stage"
    return -3, round_phase

rows = list(csv.DictReader(open("player_results_last_year.csv", encoding="utf-8")))

def parse_category(r):
    cat = r["event_category"].strip()
    if cat:
        return cat
    return r["round_phase"].split(" - ")[0].strip()

# group by player + event_name + category (a player can play multiple categories in one event)
events = defaultdict(list)
for r in rows:
    key = (r["player_name"], r["event_name"], parse_category(r))
    events[key].append(r)

results = []
for (player, event_name, category), matches in events.items():
    matches_sorted = sorted(matches, key=lambda r: round_key(r["round_phase"])[0])
    best = matches_sorted[-1]
    depth, round_name = round_key(best["round_phase"])
    if round_name == "Final":
        finish = "Champion" if best["player_result"] == "W" else "Runner-up"
    elif round_name in ("Semifinal", "Quarterfinal", "Round of 16", "Round of 32", "Round of 64", "Round of 128"):
        finish = f"Lost {round_name}" if best["player_result"] == "L" else f"Won {round_name} (advanced)"
    elif round_name == "Group Stage":
        finish = "Group Stage (no knockout match)"
    else:
        finish = round_name
    results.append({
        "player_name": player,
        "event_name": event_name,
        "event_category": category,
        "event_date": min(m["event_date"] for m in matches),
        "best_round": round_name,
        "finish": finish,
        "matches_played": len(matches),
    })

results.sort(key=lambda r: (r["player_name"], r["event_date"]))

with open("best_performance_per_tournament.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=["player_name", "event_date", "event_name", "event_category", "best_round", "finish", "matches_played"])
    w.writeheader()
    w.writerows(results)

print(f"Wrote {len(results)} tournament rows to best_performance_per_tournament.csv\n")

# Overall single best performance per player across the year
best_overall = {}
for r in results:
    d = round_key(r["best_round"])[0]
    bonus = 0.5 if r["finish"] == "Champion" else 0
    score = d + bonus
    if r["player_name"] not in best_overall or score > best_overall[r["player_name"]][0]:
        best_overall[r["player_name"]] = (score, r)

print("Best single performance in the last year per player:")
for name, (_, r) in best_overall.items():
    print(f"  {name}: {r['finish']} — {r['event_name']} ({r['event_category']}) on {r['event_date']}")
