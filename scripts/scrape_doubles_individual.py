"""
Scrape ITTF/WTT SENIOR *individual* doubles rankings (MDI / WDI / XDI)
for the ranking week published on 15 June 2026 (RankingYear 2026, RankingWeek 25).

Individual doubles ranking = a player's own doubles rank, independent of partner.
This is different from the pair ranking (MD/WD/XD via GetRankingPairs) that the
dashboard already stores in rankings_doubles_teams.

Writes: <outdir>/ittf_doubles_individual_2026-06-15.csv  (+ .json)
"""
import csv, json, os, sys, time
import requests

IND_URL = "https://wttcmsapigateway-new.azure-api.net/internalttu/Rankings/GetRankingIndividuals"
HEADERS = {
    "apikey":     "2bf8b222-532c-4c60-8ebe-eb6fdfebe84a",
    "secapimkey": "S_WTT_882jjh7basdj91834783mds8j2jsd81",
    "origin":     "https://www.worldtabletennis.com",
    "referer":    "https://www.worldtabletennis.com/",
    "accept":     "application/json",
    "user-agent": "Mozilla/5.0",
}

YEAR, WEEK   = 2026, 25          # publishes 06/15/2026
RANKING_DATE = "2026-06-15"
EVENTS = [("MDI", "M"), ("WDI", "W"), ("XDI", "X")]

PAGE_SIZE = 500
TIMEOUT   = 45
SLEEP     = 1.0

OUTDIR = sys.argv[1] if len(sys.argv) > 1 else "."


def fetch_event(sub: str) -> list[dict]:
    """Page through every rank for one sub-event."""
    rows, start, seen = [], 1, set()
    while True:
        params = {
            "CategoryCode": "SEN", "SubEventCode": sub,
            "RankingYear": YEAR, "RankingWeek": WEEK,
            "StartRank": start, "EndRank": start + PAGE_SIZE - 1, "q": 1,
        }
        for attempt in range(4):
            try:
                r = requests.get(IND_URL, params=params, headers=HEADERS, timeout=TIMEOUT)
                r.raise_for_status()
                break
            except Exception as e:
                wait = 8 * (attempt + 1)
                print(f"    [retry {attempt+1}/3 in {wait}s] {e}")
                time.sleep(wait)
        else:
            print("    [gave up on this page]")
            break

        page = r.json().get("Result") or []
        # Guard: bail out if the API echoes a different week than we asked for
        if page and (page[0].get("RankingWeek") != str(WEEK)
                     or page[0].get("RankingYear") != str(YEAR)):
            raise SystemExit(f"    !! API returned Y{page[0].get('RankingYear')} "
                             f"W{page[0].get('RankingWeek')} — wrong week, aborting")
        new = [x for x in page if x["IttfId"] not in seen]
        if not new:
            break
        seen.update(x["IttfId"] for x in new)
        rows.extend(new)
        print(f"    ranks {start}-{start + PAGE_SIZE - 1}: +{len(new)} (total {len(rows)})")
        start += PAGE_SIZE
        time.sleep(SLEEP)
    return rows


def main() -> None:
    all_rows = []
    for sub, gender in EVENTS:
        print(f"\n[{sub}] fetching Y{YEAR} W{WEEK} ...")
        raw = fetch_event(sub)
        print(f"[{sub}] {len(raw)} players")
        for r in raw:
            all_rows.append({
                "ranking_date":  RANKING_DATE,
                "ranking_year":  int(r["RankingYear"]),
                "ranking_week":  int(r["RankingWeek"]),
                "sub_event":     sub,
                "gender":        gender,
                "rank":          int(r["RankingPosition"]) if r.get("RankingPosition") else None,
                "ittf_id":       int(r["IttfId"]),
                "player_name":   r.get("PlayerName"),
                "country_code":  r.get("CountryCode"),
                "country_name":  r.get("CountryName"),
                "age_category":  r.get("AgeCategoryCode"),
                "points_ytd":    float(r["RankingPointsYTD"]) if r.get("RankingPointsYTD") else None,
                "previous_rank": int(r["PreviousRank"]) if r.get("PreviousRank") else None,
                "rank_change":   int(r["RankingDifference"]) if r.get("RankingDifference") else 0,
            })
        time.sleep(2.0)

    os.makedirs(OUTDIR, exist_ok=True)
    stem = os.path.join(OUTDIR, f"ittf_doubles_individual_{RANKING_DATE}")

    with open(stem + ".csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(all_rows[0].keys()))
        w.writeheader()
        w.writerows(all_rows)
    with open(stem + ".json", "w", encoding="utf-8") as f:
        json.dump(all_rows, f, indent=1, ensure_ascii=False)

    print(f"\nTotal rows: {len(all_rows)}")
    for sub, _ in EVENTS:
        n = sum(1 for x in all_rows if x["sub_event"] == sub)
        ind = sum(1 for x in all_rows if x["sub_event"] == sub and x["country_code"] == "IND")
        print(f"  {sub}: {n} players  (IND: {ind})")
    print(f"Wrote {stem}.csv / .json")


if __name__ == "__main__":
    main()
