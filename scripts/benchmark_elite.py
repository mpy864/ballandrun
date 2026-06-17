"""
benchmark_elite.py
Benchmarks Indian players' match performance against elite-tier players:
  Tier 1 — Olympic / World Championship medalists    (rank 1–12)
  Tier 2 — Asian Games / Asian Championship level    (rank 13–30)
  Tier 3 — Top-50 medal contenders                   (rank 31–50)

Also shows individual H2H records for each Indian player.

Usage:
  python scripts/benchmark_elite.py --gender M|W
"""

import os
import sys
import argparse
from collections import defaultdict
from supabase import create_client, Client
from elo_ratings import compute_elo

# Known Olympic/WTTC/major medal winners by ITTF ID
# (supplemented by rank-based tiers for completeness)
KNOWN_MEDAL_WINNERS = {
    # Men — Olympics + WTTC singles gold/silver/bronze
    121558,  # Fan Zhendong  — Olympic gold 2024, WTTC champion
    122044,  # Truls Moregard — Olympic bronze 2020  (SWE)
    115641,  # Liang Jingkun — WTTC finalist
    109647,  # Ma Long       — 2x Olympic gold, 5x WTTC
    119844,  # Lin Gaoyuan   — WTTC team gold
    108428,  # Hugo Calderano — Olympic bronze 2024
    128397,  # Harimoto      — Olympic bronze 2020 team
    105498,  # Ovtcharov     — Olympic bronze
    110853,  # Alexis Lebrun — top 10
    119801,  # Felix Lebrun  — top 10
    122509,  # Darko Jorgic  — top 15
    125684,  # Benedikt Duda — top 15
    # Women — Olympics + WTTC
    122538,  # Sun Yingsha   — Olympic gold 2024
    122333,  # Wang Manyu    — Olympic silver 2024
    134356,  # Chen Meng     — Olympic gold 2020
    136137,  # Wang Yidi     — WTTC team gold
    117496,  # Mima Ito      — Olympic bronze 2020
    132320,  # Hayata Hina   — WTTC team silver
    135190,  # Miwa Harimoto — top 10
    110853,  # Han Ying      — veteran top player
    119496,  # Shin Yubin    — Olympic bronze team
    132892,  # Karen Lyne    — Asian Champs
}

def load_ranked_players(supabase: Client, gender: str,
                        min_rank: int, max_rank: int) -> set[int]:
    resp = supabase.table("wtt_players") \
        .select("ittf_id") \
        .eq("gender", gender) \
        .execute()
    all_ids = {p["ittf_id"] for p in (resp.data or [])}

    r_resp = supabase.table("rankings_singles_normalized") \
        .select("player_id,rank") \
        .eq("ranking_date", "2026-04-14") \
        .gte("rank", min_rank) \
        .lte("rank", max_rank) \
        .execute()
    return {r["player_id"] for r in (r_resp.data or []) if r["player_id"] in all_ids}


def load_indian_players(supabase: Client, gender: str) -> list[dict]:
    resp = supabase.table("wtt_players") \
        .select("ittf_id,player_name") \
        .eq("country_code", "IND") \
        .eq("gender", gender) \
        .execute()
    ids = [p["ittf_id"] for p in (resp.data or [])]

    r_resp = supabase.table("rankings_singles_normalized") \
        .select("player_id,rank") \
        .eq("ranking_date", "2026-04-14") \
        .in_("player_id", ids) \
        .execute()
    rank_map = {r["player_id"]: r["rank"] for r in (r_resp.data or [])}

    players = []
    for p in (resp.data or []):
        if p["ittf_id"] in rank_map:
            players.append({
                "ittf_id":     p["ittf_id"],
                "player_name": p["player_name"],
                "rank":        rank_map[p["ittf_id"]],
            })
    return sorted(players, key=lambda x: x["rank"])


def load_matches_for_players(supabase: Client,
                              india_ids: set[int]) -> list[dict]:
    """Load all matches involving any Indian player."""
    all_matches = []
    ids = list(india_ids)
    # Fetch as comp1
    page, size = 0, 1000
    while True:
        q = supabase.table("wtt_matches_singles") \
            .select("comp1_id,comp2_id,result,event_id,event_date") \
            .in_("comp1_id", ids) \
            .not_.is_("result", "null") \
            .range(page * size, page * size + size - 1) \
            .execute()
        if not q.data:
            break
        all_matches.extend(q.data)
        if len(q.data) < size:
            break
        page += 1
    # Fetch as comp2
    page = 0
    while True:
        q = supabase.table("wtt_matches_singles") \
            .select("comp1_id,comp2_id,result,event_id,event_date") \
            .in_("comp2_id", ids) \
            .not_.is_("result", "null") \
            .range(page * size, page * size + size - 1) \
            .execute()
        if not q.data:
            break
        all_matches.extend(q.data)
        if len(q.data) < size:
            break
        page += 1
    return all_matches


def analyze(india_player: dict,
            matches: list[dict],
            tier_sets: dict[str, set[int]],
            elo: dict,
            pmap: dict) -> None:
    pid    = india_player["ittf_id"]
    name   = india_player["player_name"]
    rank   = india_player["rank"]
    my_elo = elo.get(pid, 1500)

    # Filter matches involving this player
    my_matches = [
        m for m in matches
        if m["comp1_id"] == pid or m["comp2_id"] == pid
    ]

    print(f"\n{'─'*60}")
    print(f"  {name}  (Rank #{rank}  |  Elo: {my_elo:.0f})")
    print(f"{'─'*60}")
    print(f"  Total matches in DB: {len(my_matches)}")

    for tier_name, elite_ids in tier_sets.items():
        wl = defaultdict(lambda: [0, 0])  # opp_id → [W, L]
        for m in my_matches:
            if m["comp1_id"] == pid:
                opp, result = m["comp2_id"], m["result"]
                won = (result == "W")
            else:
                opp, result = m["comp1_id"], m["result"]
                won = (result == "L")  # comp1 lost means comp2 (us) won

            if opp not in elite_ids:
                continue
            if won:
                wl[opp][0] += 1
            else:
                wl[opp][1] += 1

        total_w = sum(v[0] for v in wl.values())
        total_l = sum(v[1] for v in wl.values())
        total   = total_w + total_l
        pct     = 100 * total_w / total if total > 0 else 0

        print(f"\n  vs {tier_name}:")
        if total == 0:
            print(f"    No matches recorded against this tier.")
            continue
        print(f"    Overall: {total_w}W – {total_l}L  ({pct:.0f}% win rate)  [{total} matches]")

        # Individual H2H for notable opponents
        notable = sorted(wl.items(), key=lambda x: -(x[1][0]+x[1][1]))[:6]
        for opp_id, (w, l) in notable:
            opp_info = pmap.get(opp_id, {})
            opp_name = opp_info.get("player_name", str(opp_id))
            opp_elo  = elo.get(opp_id, 1500)
            exp_win  = 1 / (1 + 10 ** ((opp_elo - my_elo) / 400))
            total_h2h = w + l
            actual_pct = 100 * w / total_h2h
            print(f"    {opp_name:<28} {w}W–{l}L  "
                  f"(actual {actual_pct:.0f}%  |  Elo expected {exp_win*100:.0f}%)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--gender", choices=["M", "W"], default="W")
    args = parser.parse_args()

    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

    gender_label = "Men" if args.gender == "M" else "Women"
    print(f"\n{'='*60}")
    print(f" Elite Benchmark — Indian {gender_label} vs World Elite")
    print(f"{'='*60}")

    print("\n[1/4] Computing Elo ratings...")
    elo = compute_elo(supabase)

    print("[2/4] Loading player and ranking data...")
    tier1_ids  = load_ranked_players(supabase, args.gender, 1, 12)  | KNOWN_MEDAL_WINNERS
    tier2_ids  = load_ranked_players(supabase, args.gender, 13, 30) - tier1_ids
    tier3_ids  = load_ranked_players(supabase, args.gender, 31, 50) - tier1_ids - tier2_ids

    tier_sets = {
        "Tier 1 — Olympic/World Champ level  (rank 1–12)": tier1_ids,
        "Tier 2 — Asian Games/Champs level   (rank 13–30)": tier2_ids,
        "Tier 3 — Top-50 medal contenders    (rank 31–50)": tier3_ids,
    }

    print(f"  Tier 1: {len(tier1_ids)} players | Tier 2: {len(tier2_ids)} | Tier 3: {len(tier3_ids)}")

    india_players = load_indian_players(supabase, args.gender)
    india_ids     = {p["ittf_id"] for p in india_players}
    print(f"  Indian {gender_label}: {len(india_players)} ranked players")

    p_resp = supabase.table("wtt_players").select("ittf_id,player_name,country_code").execute()
    pmap   = {p["ittf_id"]: p for p in (p_resp.data or [])}

    print("[3/4] Loading match history for Indian players...")
    matches = load_matches_for_players(supabase, india_ids)
    print(f"  {len(matches)} matches found.")

    print("\n[4/4] Benchmark results:\n")
    # Focus on top-ranked Indian players (rank ≤ 120)
    top_india = [p for p in india_players if p["rank"] <= 120]
    for player in top_india:
        analyze(player, matches, tier_sets, elo, pmap)

    # Summary table
    print(f"\n\n{'='*60}")
    print(f" Summary — Win % vs Elite Tiers")
    print(f"{'='*60}")
    print(f"  {'Player':<26} {'Rank':>5}  {'Elo':>5}  {'T1 W%':>7}  {'T2 W%':>7}  {'T3 W%':>7}")
    print(f"  {'-'*64}")

    for player in top_india:
        pid    = player["ittf_id"]
        my_elo = elo.get(pid, 1500)
        row    = [player["player_name"], player["rank"], f"{my_elo:.0f}"]
        for tier_ids in [tier1_ids, tier2_ids, tier3_ids]:
            wl = [0, 0]
            for m in matches:
                if m["comp1_id"] == pid:
                    opp, won = m["comp2_id"], m["result"] == "W"
                elif m["comp2_id"] == pid:
                    opp, won = m["comp1_id"], m["result"] == "L"
                else:
                    continue
                if opp in tier_ids:
                    wl[0 if won else 1] += 1
            total = sum(wl)
            pct   = f"{100*wl[0]/total:.0f}%" if total else "—"
            row.append(f"{pct:>5} ({total})")
        print(f"  {row[0]:<26} {row[1]:>5}  {row[2]:>5}  {row[3]:>9}  {row[4]:>9}  {row[5]:>9}")


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(__file__))
    main()
