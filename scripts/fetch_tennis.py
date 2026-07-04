"""
fetch_tennis.py
Ingests senior ATP + WTA players and current rankings for Indian players (ioc=IND)
from Tennis Abstract (Jeff Sackmann open datasets) into Supabase.

Resolves the repo's real default branch and root file list via the GitHub API,
then fetches the raw CSVs (so it self-corrects if the branch/paths differ).

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
PLAYERS_COLS = ["player_id", "name_first", "name_last", "hand", "dob", "ioc", "height", "wikidata_id"]
RANK_COLS    = ["ranking_date", "rank", "player", "points"]
BATCH = 500
HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "application/vnd.github+json"}


def safe_int(v):
    try:
        v = str(v).strip()
        return int(v) if v not in ("", "nan", "None") else None
    except Exception:
        return None


def d8(s):
    s = str(s or "").strip()
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) >= 8 and s[:8].isdigit() else None


def repo_info(repo):
    """Return (default_branch, [root csv filenames]) using the GitHub API."""
    r = requests.get(f"https://api.github.com/repos/{repo}", headers=HEADERS, timeout=30)
    if r.status_code != 200:
        print(f"    [!] repo API {r.status_code} for {repo}: {r.text[:120]}")
        return None, []
    br = r.json().get("default_branch")
    c = requests.get(f"https://api.github.com/repos/{repo}/contents?ref={br}", headers=HEADERS, timeout=30)
    names = []
    if c.status_code == 200 and isinstance(c.json(), list):
        names = [x.get("name") for x in c.json() if x.get("name", "").endswith(".csv")]
    print(f"    repo {repo}: default_branch={br}, {len(names)} csv files in root")
    return br, names


def get_rows(repo, branch, path, cols):
    url = f"https://raw.githubusercontent.com/{repo}/{branch}/{path}"
    r = requests.get(url, timeout=60, headers={"User-Agent": "Mozilla/5.0"})
    if r.status_code != 200:
        print(f"    [!] HTTP {r.status_code} {url}")
        return []
    print(f"    OK  {url}")
    rows = [row for row in csv.reader(io.StringIO(r.text)) if row]
    if not rows:
        return []
    if str(rows[0][0]).strip().isdigit():
        return [dict(zip(cols, row)) for row in rows]
    keys = [c.strip() for c in rows[0]]
    return [dict(zip(keys, row)) for row in rows[1:]]


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


def pick(names, want):
    """Case-insensitive match for a filename, else print candidates."""
    for n in names:
        if n.lower() == want.lower():
            return n
    cands = [n for n in names if "player" in n.lower() or "ranking" in n.lower()]
    if cands:
        print(f"    [?] '{want}' not found. Candidates: {cands[:15]}")
    return want   # fall through; get_rows will 404 and log it


def main():
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    for tour, repo in REPOS.items():
        pref = tour.lower()
        print(f"[{tour}] resolving repo ...")
        branch, names = repo_info(repo)
        if not branch:
            continue

        pfile = pick(names, f"{pref}_players.csv") if names else f"{pref}_players.csv"
        rfile = pick(names, f"{pref}_rankings_current.csv") if names else f"{pref}_rankings_current.csv"

        players = get_rows(repo, branch, pfile, PLAYERS_COLS)
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

        ranks = get_rows(repo, branch, rfile, RANK_COLS)
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
