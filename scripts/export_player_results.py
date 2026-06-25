import csv
import os
import sys
import urllib.parse
import urllib.request
import json

PLAYER_IDS = [201372, 145804, 200839, 202918, 213004]

def load_env():
    env = {}
    with open(os.path.join(os.path.dirname(__file__), "..", ".env"), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k] = v
    return env

env = load_env()
SUPABASE_URL = env["SUPABASE_URL"].rstrip("/")
SERVICE_KEY = env["SUPABASE_SERVICE_KEY"]

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
}

def rest_get(path, params):
    qs = urllib.parse.urlencode(params, safe=",.()")
    url = f"{SUPABASE_URL}/rest/v1/{path}?{qs}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))

# 1. Player name lookup (target players + all opponents will be looked up lazily)
players = {}
for row in rest_get("wtt_players", {"select": "ittf_id,player_name"}):
    players[row["ittf_id"]] = row["player_name"]

# 2. Event lookup
events = {}
for row in rest_get("wtt_events", {"select": "event_id,event_name,event_tier"}):
    events[row["event_id"]] = row

id_filter = ",".join(str(i) for i in PLAYER_IDS)

matches = rest_get(
    "wtt_matches_singles",
    {
        "select": "event_date,event_id,event_category,round_phase,comp1_id,comp2_id,match_score,result",
        "or": f"(comp1_id.in.({id_filter}),comp2_id.in.({id_filter}))",
        "event_date": "gte.2025-06-23",
        "order": "event_date.desc",
        "limit": "5000",
    },
)

rows = []
for m in matches:
    score = m.get("match_score") or ""
    parts = score.split("-")
    if len(parts) != 2 or not all(p.isdigit() for p in parts):
        continue
    s1, s2 = int(parts[0]), int(parts[1])
    for target in PLAYER_IDS:
        if m["comp1_id"] == target:
            opp_id = m["comp2_id"]
            player_result = "W" if s1 > s2 else "L"
        elif m["comp2_id"] == target:
            opp_id = m["comp1_id"]
            player_result = "W" if s2 > s1 else "L"
        else:
            continue
        ev = events.get(m["event_id"], {})
        rows.append({
            "player_id": target,
            "player_name": players.get(target, ""),
            "event_date": m["event_date"],
            "event_name": ev.get("event_name", ""),
            "event_tier": ev.get("event_tier", ""),
            "event_category": m.get("event_category") or "",
            "round_phase": m.get("round_phase") or "",
            "opponent_id": opp_id,
            "opponent_name": players.get(opp_id, ""),
            "match_score": score,
            "player_result": player_result,
        })

rows.sort(key=lambda r: (r["player_name"], r["event_date"]), reverse=False)

out_path = os.path.join(os.path.dirname(__file__), "..", "player_results_last_year.csv")
with open(out_path, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=[
        "player_id", "player_name", "event_date", "event_name", "event_tier",
        "event_category", "round_phase", "opponent_id", "opponent_name",
        "match_score", "player_result",
    ])
    writer.writeheader()
    writer.writerows(rows)

print(f"Wrote {len(rows)} rows to {out_path}")

# Summary
from collections import defaultdict
summary = defaultdict(lambda: {"W": 0, "L": 0})
for r in rows:
    summary[r["player_name"]][r["player_result"]] += 1

print("\nSummary (last 1 year):")
for name, rec in summary.items():
    total = rec["W"] + rec["L"]
    pct = (rec["W"] / total * 100) if total else 0
    print(f"  {name}: {rec['W']}W - {rec['L']}L  ({total} matches, {pct:.0f}% win rate)")
