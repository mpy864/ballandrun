"""
fetch_tennis.py
Ingests senior ATP + WTA players and current rankings for Indian players (ioc=IND)
from Tennis Abstract (Jeff Sackmann open datasets) into Supabase.

Repos: github.com/JeffSackmann/tennis_atp , tennis_wta
Files (repo root): atp_players.csv, atp_rankings_current.csv (+ wta_ equivalents)

Usage:
    pip install requests supabase
    export SUPABASE_URL=...  SUPABASE_SERVICE_KEY=...
    python scripts/fetch_tennis.py
"""

import os
import csv
import io
import requests
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

REPOS = {"ATP": "JeffSackmann/tennis_atp", "WTA": "JeffSackmann/tennis_wta"}
BRANCHES = ["master", "main"]                 # try both — default branch varies
PLAYERS_COLS = ["player_id", "name_first", "name_last", "hand", "dob", "ioc", "height", "wikidata_id"]
RANK_COLS    = ["ranking_date", "rank", "player", "points"]
BATCH = 500
HEADERS = {"User-Agent": "Mozilla/5.0"}


def safe_int(v):
    try:
        v = str(v).strip()
        return int(v) if v not in ("", "nan", "None") else None
    except Exception:
        return None


def d8(s):
    s = str(s or "").strip()
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) >= 8 and s[:8].isdigit() else None


def get_rows(repo, path, cols):
    """Fetch a CSV, trying each candidate branch. Returns list of dicts."""
    for br in BRANCHES:
        url = f"https://raw.githubusercontent.com/{repo}/{br}/{path}"
        try:
            r = requests.get(url, timeout=60, headers=HEADERS)
        except Exception as e:
            print(f"    [!] request error {url}: {e}")
            continue
        if r.status_code != 200:
            print(f"    [!] HTTP {r.status_code} {url}")
            continue
        print(f"    OK  {url}")
        rows = [row for row in csv.reader(io.StringIO(r.text)) if row]
        if not rows:
            return []
        if str(rows[0][0]).strip().isdigit():        # no header → positional
            return [dict(zip(cols, row)) for row in rows]
        keys = [c.strip() for c in rows[0]]          # header present
        return [dict(zip(keys, row)) for row in rows[1:]]
    return []


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

    for tour, repo in REPOS.items():
        pref = tour.lower()
        print(f"[{tour}] players ...")
        players = get_rows(repo, f"{pref}_players.csv", PLAYERS_COLS)
        ind = [p for p in players if (p.get("ioc") or "").strip().upper() == "IND"]
        ind_ids = {str(p.get("player_id")).strip() for p in ind if p.get("player_id")}

        prows = []
        for p in ind:
            pid = str(p.get("player_id") or "").strip()
            if not pid:
                continue
            name = f"{str(p.get('name_first') or '').strip()} {str(p.get('name_last') or '').strip()}".strip()
            prows.append({
                "tour": tour, "player_id": pid, "name": name, "ioc": "IND",
                "hand": (p.get("hand") or None), "dob": d8(p.get("dob")),
                "height": safe_int(p.get("height")),
            })
        upsert(sb, "tennis_players", prows, "tour,player_id")

        print(f"[{tour}] current rankings ...")
        ranks = get_rows(repo, f"{pref}_rankings_current.csv", RANK_COLS)
        rrows = []
        for r in ranks:
            pid = str(r.get("player") or "").strip()
            if pid not in ind_ids:
                continue
            rd = d8(r.get("ranking_date"))
            if not rd:
                continue
            rrows.append({
                "tour": tour, "player_id": pid, "ranking_date": rd,
                "rank": safe_int(r.get("rank")), "points": safe_int(r.get("points")),
            })
        upsert(sb, "tennis_rankings", rrows, "tour,player_id,ranking_date")
        print(f"[{tour}] {len(prows)} Indian players, {len(rrows)} ranking rows")

    print("Done.")


if __name__ == "__main__":
    main()
