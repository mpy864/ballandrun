"""
fetch_tennis.py
Ingests senior ATP + WTA rankings for Indian players from tennisexplorer.com
into Supabase. Source we control (the Tennis Abstract / Sackmann CSV datasets
were taken private in 2025, so we scrape the country-filtered ranking pages).

Pages:
  https://www.tennisexplorer.com/ranking/atp-men/?country=india
  https://www.tennisexplorer.com/ranking/wta-women/?country=india

Usage:
    pip install requests supabase
    export SUPABASE_URL=...  SUPABASE_SERVICE_KEY=...
    python scripts/fetch_tennis.py
"""

import os
import re
import time
from datetime import date
import requests
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

TOURS = {"ATP": "atp-men", "WTA": "wta-women"}
BASE = "https://www.tennisexplorer.com/ranking"
HEADERS = {"User-Agent": "Mozilla/5.0"}
BATCH = 500

ROW  = re.compile(r'<tr class="(?:one|two)"[^>]*>(.*?)</tr>', re.S)
RANK = re.compile(r'class="rank first">(\d+)')
NAME = re.compile(r'/player/([^/"]+)/">([^<]+)</a>')
PTS  = re.compile(r'class="long-point">(\d+)')


def parse(html):
    out = []
    for block in ROW.findall(html):
        rk = RANK.search(block)
        nm = NAME.search(block)
        if not (rk and nm):
            continue
        pt = PTS.search(block)
        out.append({
            "player_id": nm.group(1).strip(),
            "name":      nm.group(2).strip(),
            "rank":      int(rk.group(1)),
            "points":    int(pt.group(1)) if pt else None,
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
    print(f"    -> upserted {ok}/{len(rows)} rows into {table}")


def main():
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    today = date.today().isoformat()

    for tour, path in TOURS.items():
        print(f"[{tour}] scraping India rankings ...")
        players, page = [], 1
        while page <= 6:
            url = f"{BASE}/{path}/?country=india&page={page}"
            r = requests.get(url, headers=HEADERS, timeout=40)
            if r.status_code != 200:
                print(f"    [!] HTTP {r.status_code} {url}")
                break
            rows = parse(r.text)
            if not rows:
                break
            players.extend(rows)
            print(f"    page {page}: {len(rows)} players")
            page += 1
            time.sleep(0.6)

        # dedupe by player_id (a player can appear once)
        seen = {}
        for p in players:
            seen[p["player_id"]] = p
        players = list(seen.values())

        prows = [{"tour": tour, "player_id": p["player_id"], "name": p["name"], "ioc": "IND"} for p in players]
        rrows = [{"tour": tour, "player_id": p["player_id"], "ranking_date": today,
                  "rank": p["rank"], "points": p["points"]} for p in players]

        upsert(sb, "tennis_players", prows, "tour,player_id")
        upsert(sb, "tennis_rankings", rrows, "tour,player_id,ranking_date")
        print(f"[{tour}] {len(prows)} Indian players")

    print("Done.")


if __name__ == "__main__":
    main()
