"""
fetch_tennis_matches.py
Scrapes singles match results for Indian ATP/WTA players (already in tennis_players)
from their tennisexplorer player pages, into tennis_matches.

For each player it fetches /player/<slug>/?annual=YYYY for recent years (the year is
known from the param, so dates are exact). Same match on both players' pages → deduped
by match_id.

Usage:
    pip install requests supabase
    export SUPABASE_URL=...  SUPABASE_SERVICE_KEY=...
    python scripts/fetch_tennis_matches.py            # years 2026,2025
    python scripts/fetch_tennis_matches.py --years 2026 2025 2024
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

BASE = "https://www.tennisexplorer.com/player"
HEADERS = {"User-Agent": "Mozilla/5.0"}
BATCH = 500

ROW    = re.compile(r'<tr class="(?:one|two)">(.*?)</tr>', re.S)
MID    = re.compile(r'/match-detail/\?id=(\d+)')
PLAYER = re.compile(r'/player/([^/"]+)/')
DATE   = re.compile(r'class="first time">(\d{2})\.(\d{2})\.')
SURF   = re.compile(r's-color"><span title="([^"]+)"')
ROUND  = re.compile(r'class="round" title="([^"]+)"')
SCORE  = re.compile(r'/match-detail/\?id=\d+"[^>]*>([^<]*)</a>')


def parse_matches(html, subject, tour, year):
    out = []
    for block in ROW.findall(html):
        mid = MID.search(block)
        if not mid:
            continue
        players = PLAYER.findall(block)
        if len(players) != 2:            # singles only (skip doubles rows)
            continue
        dm = DATE.search(block)
        if not dm:
            continue
        opponent = players[1] if players[0] == subject else players[0]
        if opponent == subject:
            continue
        subj_won = 'class="notU"><strong>' in block
        winner = subject if subj_won else opponent
        loser  = opponent if subj_won else subject
        surf = SURF.search(block)
        rnd  = ROUND.search(block)
        sc   = SCORE.search(block)
        out.append({
            "match_id":   mid.group(1),
            "tour":       tour,
            "match_date": f"{year}-{dm.group(2)}-{dm.group(1)}",
            "surface":    surf.group(1) if surf else None,
            "round":      rnd.group(1) if rnd else None,
            "winner_id":  winner,
            "loser_id":   loser,
            "score":      (sc.group(1).strip() if sc else None),
        })
    return out


def upsert(sb, rows):
    ok = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        try:
            sb.table("tennis_matches").upsert(chunk, on_conflict="match_id").execute()
            ok += len(chunk)
        except Exception as e:
            print(f"    [!] upsert error: {e}")
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", nargs="*", type=int, default=[date.today().year, date.today().year - 1])
    args = ap.parse_args()

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    players = sb.table("tennis_players").select("tour, player_id").execute().data or []
    print(f"{len(players)} players, years {args.years}")

    all_matches = {}
    for idx, p in enumerate(players, 1):
        slug, tour = p["player_id"], p["tour"]
        for yr in args.years:
            url = f"{BASE}/{slug}/?annual={yr}"
            try:
                r = requests.get(url, headers=HEADERS, timeout=40)
            except Exception as e:
                print(f"    [!] {slug} {yr}: {e}")
                continue
            if r.status_code != 200:
                continue
            for m in parse_matches(r.text, slug, tour, yr):
                all_matches[m["match_id"]] = m
            time.sleep(0.4)
        if idx % 10 == 0:
            print(f"  {idx}/{len(players)} players, {len(all_matches)} matches so far")

    rows = list(all_matches.values())
    ok = upsert(sb, rows)
    print(f"Done. {ok}/{len(rows)} matches upserted.")


if __name__ == "__main__":
    main()
