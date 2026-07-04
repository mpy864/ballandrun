"""
fetch_tennis_doubles.py
Longitudinal Indian tennis DOUBLES match history from tennisexplorer.

1. Reads the doubles ranking pages (?t=doubles&country=india) for ATP + WTA to get
   the Indian doubles players (incl. doubles-only specialists like Bhambri, Balaji),
   and adds them to tennis_players.
2. For every Indian player (singles + doubles), scrapes /player/<slug>/?type=doubles&annual=YYYY
   across several years and writes doubles matches to tennis_matches_doubles
   (deduped by match_id; a match appears on all four players' pages).

Usage:
    pip install requests supabase
    export SUPABASE_URL=...  SUPABASE_SERVICE_KEY=...
    python scripts/fetch_tennis_doubles.py               # last 6 years
    python scripts/fetch_tennis_doubles.py --years 2026 2025
"""

import os
import re
import time
import argparse
from datetime import date
import requests
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

RANK_BASE = "https://www.tennisexplorer.com/ranking"
PLAYER    = "https://www.tennisexplorer.com/player"
HEADERS   = {"User-Agent": "Mozilla/5.0"}
BATCH = 500
TOURS = {"ATP": "atp-men", "WTA": "wta-women"}

ROW   = re.compile(r'<tr class="(?:one|two)">(.*?)</tr>', re.S)
MID   = re.compile(r'/match-detail/\?id=(\d+)')
TEAM  = re.compile(r'<a href="/doubles-team/([^/"]+)/([^/"]+)/"[^>]*>(.*?)</a>', re.S)
DATE  = re.compile(r'class="first time">(\d{2})\.(\d{2})\.')
SURF  = re.compile(r's-color"><span title="([^"]+)"')
ROUND = re.compile(r'class="round" title="([^"]+)"')
SCORE = re.compile(r'/match-detail/\?id=\d+"[^>]*>(.*?)</a>', re.S)
NAME_ROW = re.compile(r'<td class="t-name"><a href="/player/([^"?/]+)[^"]*">([^<]*)</a>')


def get(url):
    try:
        r = requests.get(url, headers=HEADERS, timeout=40)
        return r.text if r.status_code == 200 else None
    except Exception as e:
        print(f"    [!] {url}: {e}")
        return None


def doubles_players(tour_path):
    html = get(f"{RANK_BASE}/{tour_path}/?t=doubles&country=india")
    if not html:
        return []
    return [(m.group(1), m.group(2).strip()) for m in NAME_ROW.finditer(html)]


def parse_doubles(html, tour, year):
    out = []
    for block in ROW.findall(html):
        if not MID.search(block):
            continue
        teams = TEAM.findall(block)
        if len(teams) != 2:
            continue
        wi = next((i for i, t in enumerate(teams) if "<strong>" in t[2]), -1)
        if wi < 0:
            continue
        li = 1 - wi
        dm = DATE.search(block)
        if not dm:
            continue
        sc = SCORE.search(block)
        out.append({
            "match_id":   MID.search(block).group(1),
            "tour":       tour,
            "match_date": f"{year}-{dm.group(2)}-{dm.group(1)}",
            "surface":    (SURF.search(block).group(1) if SURF.search(block) else None),
            "round":      (ROUND.search(block).group(1) if ROUND.search(block) else None),
            "w1_id":      teams[wi][0], "w2_id": teams[wi][1],
            "l1_id":      teams[li][0], "l2_id": teams[li][1],
            "score":      (re.sub(r"<[^>]+>", "", sc.group(1)).strip() if sc else None),
        })
    return out


def upsert(sb, table, rows, on_conflict):
    ok = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        try:
            sb.table(table).upsert(chunk, on_conflict=on_conflict).execute()
            ok += len(chunk)
        except Exception as e:
            print(f"    [!] upsert error into {table}: {e}")
    return ok


def main():
    ap = argparse.ArgumentParser()
    yr = date.today().year
    ap.add_argument("--years", nargs="*", type=int, default=list(range(yr, yr - 6, -1)))
    args = ap.parse_args()

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # 1. doubles player universe → tennis_players
    universe = {}
    for tour, path in TOURS.items():
        for slug, name in doubles_players(path):
            universe[(tour, slug)] = name
    if universe:
        upsert(sb, "tennis_players",
               [{"tour": t, "player_id": s, "name": n, "ioc": "IND"} for (t, s), n in universe.items()],
               "tour,player_id")
    print(f"{len(universe)} Indian doubles players added")

    # 2. all Indian players (singles + doubles) → scrape their doubles matches
    players = sb.table("tennis_players").select("tour, player_id").execute().data or []
    print(f"{len(players)} players total, years {args.years}")

    matches = {}
    for idx, p in enumerate(players, 1):
        for y in args.years:
            html = get(f"{PLAYER}/{p['player_id']}/?type=doubles&annual={y}")
            if not html:
                continue
            for m in parse_doubles(html, p["tour"], y):
                matches[m["match_id"]] = m
            time.sleep(0.35)
        if idx % 15 == 0:
            print(f"  {idx}/{len(players)} players, {len(matches)} doubles matches so far")

    rows = list(matches.values())
    ok = upsert(sb, "tennis_matches_doubles", rows, "match_id")
    print(f"Done. {ok}/{len(rows)} doubles matches upserted.")


if __name__ == "__main__":
    main()
