"""
asian_doubles_two_per_country.py

Where would India's doubles pairs stand in an ASIAN-ONLY field limited to
TWO PAIRS PER COUNTRY, ranked on individual doubles points?

Source: the individual doubles rankings (MDI / WDI / XDI) for the ranking week
published 15 June 2026, as scraped by scripts/scrape_doubles_individual.py into
analysis_output/ittf_doubles_individual_2026-06-15.json.

Individual doubles points are used deliberately (not pair points): in the
individual lists every player carries exactly one association, so a country's
entries are unambiguous.

Method
  1. Keep ATTU (Asian) associations only.
  2. Per country, build its two strongest pairs:
       MD/WD — top 4 players by points -> pair 1 = (#1+#2), pair 2 = (#3+#4)
       XD    — top 2 men + top 2 women -> pair 1 = (best man + best woman),
                                          pair 2 = (2nd man + 2nd woman)
  3. Pair score = sum of the two partners' points.
  4. Rank all surviving pairs per event, descending.

Usage:
    python scripts/asian_doubles_two_per_country.py
"""

import csv
import json
import os
import sys
import time
from collections import defaultdict

import requests

# ── Config ───────────────────────────────────────────────────────────────────

RANKING_DATE = "2026-06-15"
YEAR, WEEK   = 2026, 25

ROOT    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR  = os.path.join(ROOT, "analysis_output")
INFILE  = os.path.join(OUTDIR, f"ittf_doubles_individual_{RANKING_DATE}.json")
OUTFILE = os.path.join(OUTDIR, f"asian_doubles_2per_country_{RANKING_DATE}.csv")

# ATTU member associations. Excludes AZE / ISR / TUR / GEO (ITTF: Europe) and
# AUS / NZL (Oceania).
ASIA = {
    "CHN", "JPN", "KOR", "TPE", "HKG", "IND", "SGP", "THA", "VIE", "MAS",
    "PHI", "IRI", "IRQ", "KAZ", "UZB", "KGZ", "TJK", "QAT", "KSA", "UAE",
    "KUW", "OMA", "BRN", "JOR", "LBN", "PAK", "BAN", "NEP", "MDV", "LAO",
}

EVENTS = [("MDI", "MD", "Men's Doubles"),
          ("WDI", "WD", "Women's Doubles"),
          ("XDI", "XD", "Mixed Doubles")]

PAIRS_PER_COUNTRY = 2

# The pairs the user asked about, reported alongside the strict top-2 standings.
# Surnames are matched case-insensitively against the ranking lists.
NAMED_PAIRS = [
    ("MD", "Manav THAKKAR",         "Manush SHAH"),
    ("MD", "Harmeet DESAI",         "Sathiyan GNANASEKARAN"),
    ("WD", "Diya CHITALE",          "Yashaswini GHORPADE"),
    ("WD", "Sreeja AKULA",          "Syndrela DAS"),
    ("XD", "Diya CHITALE",          "Manush SHAH"),
    ("XD", "Yashaswini GHORPADE",   "Harmeet DESAI"),
]

# Gender resolution fallback — the SEN singles lists for the same week.
IND_URL = "https://wttcmsapigateway-new.azure-api.net/internalttu/Rankings/GetRankingIndividuals"
HEADERS = {
    "apikey":     "2bf8b222-532c-4c60-8ebe-eb6fdfebe84a",
    "secapimkey": "S_WTT_882jjh7basdj91834783mds8j2jsd81",
    "origin":     "https://www.worldtabletennis.com",
    "referer":    "https://www.worldtabletennis.com/",
    "accept":     "application/json",
    "user-agent": "Mozilla/5.0",
}
GENDER_CACHE = os.path.join(OUTDIR, f"_singles_gender_{RANKING_DATE}.json")


# ── Gender resolution (needed for XD only) ───────────────────────────────────

def fetch_singles_genders() -> dict[int, str]:
    """
    ittf_id -> 'M'/'W' from the MS and WS singles rankings for the same week.
    The XDI list mixes men and women and carries no gender field, and 130 Asian
    XDI players appear in neither MDI nor WDI, so a second source is required.
    Cached on disk — this is a fixed historical week.
    """
    if os.path.exists(GENDER_CACHE):
        with open(GENDER_CACHE, encoding="utf-8") as f:
            return {int(k): v for k, v in json.load(f).items()}

    out: dict[int, str] = {}
    for sub, gender in (("MS", "M"), ("WS", "W")):
        start = 1
        while True:
            params = {"CategoryCode": "SEN", "SubEventCode": sub,
                      "RankingYear": YEAR, "RankingWeek": WEEK,
                      "StartRank": start, "EndRank": start + 499, "q": 1}
            r = requests.get(IND_URL, params=params, headers=HEADERS, timeout=45)
            r.raise_for_status()
            page = r.json().get("Result") or []
            if not page:
                break
            for row in page:
                out[int(row["IttfId"])] = gender
            print(f"  [{sub}] ranks {start}-{start + 499}: {len(page)} players")
            if len(page) < 500:
                break
            start += 500
            time.sleep(1.0)

    with open(GENDER_CACHE, "w", encoding="utf-8") as f:
        json.dump(out, f)
    return out


def build_gender_map(rows: list[dict]) -> tuple[dict[int, str], set[int]]:
    """MDI membership => male, WDI membership => female, else singles lists."""
    gmap: dict[int, str] = {}
    for r in rows:
        if r["sub_event"] == "MDI":
            gmap[r["ittf_id"]] = "M"
        elif r["sub_event"] == "WDI":
            gmap[r["ittf_id"]] = "W"

    xd_ids = {r["ittf_id"] for r in rows
              if r["sub_event"] == "XDI" and r["country_code"] in ASIA}
    unresolved = xd_ids - set(gmap)
    print(f"Gender: {len(gmap)} from MDI/WDI, {len(unresolved)} Asian XDI players "
          f"still unresolved — checking singles lists ...")

    if unresolved:
        singles = fetch_singles_genders()
        for pid in list(unresolved):
            if pid in singles:
                gmap[pid] = singles[pid]
                unresolved.discard(pid)

    print(f"Gender: {len(unresolved)} still unknown after singles lookup.")
    return gmap, unresolved


# ── Pair construction ────────────────────────────────────────────────────────

def sort_key(p: dict) -> tuple:
    """Best first: most points, then better world rank."""
    return (-(p["points_ytd"] or 0), p["rank"])


def build_pairs(players: list[dict], event: str,
                gmap: dict[int, str]) -> list[tuple[dict, dict]]:
    """A country's up-to-two strongest pairs for one event."""
    if event != "XD":
        ordered = sorted(players, key=sort_key)
        return [(ordered[i], ordered[i + 1])
                for i in range(0, min(len(ordered), PAIRS_PER_COUNTRY * 2) - 1, 2)]

    men   = sorted([p for p in players if gmap.get(p["ittf_id"]) == "M"], key=sort_key)
    women = sorted([p for p in players if gmap.get(p["ittf_id"]) == "W"], key=sort_key)
    # Strongest man with strongest woman, second with second.
    return [(men[i], women[i]) for i in range(min(len(men), len(women), PAIRS_PER_COUNTRY))]


def pair_row(event: str, slot: int, a: dict, b: dict, note: str = "") -> dict:
    return {
        "sub_event":   event,
        "asian_rank":  None,
        "country_code": a["country_code"],
        "pair_slot":   slot,
        "player1":     a["player_name"],
        "p1_points":   int(a["points_ytd"] or 0),
        "p1_world_rank": a["rank"],
        "player2":     b["player_name"],
        "p2_points":   int(b["points_ytd"] or 0),
        "p2_world_rank": b["rank"],
        "pair_points": int((a["points_ytd"] or 0) + (b["points_ytd"] or 0)),
        "is_india":    "Y" if a["country_code"] == "IND" else "",
        "note":        note,
    }


# ── Reporting ────────────────────────────────────────────────────────────────

def fmt(row: dict, width: int = 30) -> str:
    mark = " <<< INDIA" if row["is_india"] else ""
    names = f'{row["player1"]} / {row["player2"]}'
    return (f'  #{row["asian_rank"]:<3} {row["country_code"]}  '
            f'{names[:52]:<52} {row["pair_points"]:>6}{mark}')


def report(event_name: str, ranked: list[dict]) -> None:
    print(f"\n{'=' * 78}\n{event_name} — Asian field, max {PAIRS_PER_COUNTRY} pairs "
          f"per country ({len(ranked)} pairs)\n{'=' * 78}")
    print("  TOP 10")
    for row in ranked[:10]:
        print(fmt(row))

    india = [r for r in ranked if r["is_india"]]
    print(f"\n  INDIA ({len(india)} pair(s)) in context")
    # Show each India pair with its immediate neighbours, without repeating a row.
    keep: set[int] = set()
    for row in india:
        for n in (row["asian_rank"] - 1, row["asian_rank"], row["asian_rank"] + 1):
            if 1 <= n <= len(ranked):
                keep.add(n)
    prev = 0
    for n in sorted(keep):
        if n > prev + 1:
            print("     ...")
        print(fmt(ranked[n - 1]))
        prev = n


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    if not os.path.exists(INFILE):
        sys.exit(f"Missing {INFILE} — run scripts/scrape_doubles_individual.py first.")
    with open(INFILE, encoding="utf-8") as f:
        rows = json.load(f)
    print(f"Loaded {len(rows)} player-rankings for {RANKING_DATE}\n")

    gmap, unresolved = build_gender_map(rows)

    all_out: list[dict] = []

    for sub_event, event, label in EVENTS:
        pool = [r for r in rows
                if r["sub_event"] == sub_event and r["country_code"] in ASIA]
        by_country: dict[str, list[dict]] = defaultdict(list)
        for r in pool:
            by_country[r["country_code"]].append(r)

        # Flag any unresolved-gender player strong enough to have taken an XD slot.
        if event == "XD":
            for cc, players in by_country.items():
                unk = [p for p in players if p["ittf_id"] in unresolved]
                known = sorted([p for p in players if p["ittf_id"] not in unresolved],
                               key=sort_key)
                cutoff = known[3]["points_ytd"] if len(known) >= 4 else 0
                for p in unk:
                    if (p["points_ytd"] or 0) > (cutoff or 0):
                        print(f"  [!] {event} {cc}: unresolved gender for "
                              f"{p['player_name']} ({p['points_ytd']:.0f} pts) — "
                              f"strong enough to affect a top-2 slot")

        event_rows: list[dict] = []
        for cc, players in sorted(by_country.items()):
            for slot, (a, b) in enumerate(build_pairs(players, event, gmap), 1):
                event_rows.append(pair_row(event, slot, a, b))

        event_rows.sort(key=lambda r: (-r["pair_points"],
                                       min(r["p1_world_rank"], r["p2_world_rank"])))
        for i, r in enumerate(event_rows, 1):
            r["asian_rank"] = i

        # ── Assertions ───────────────────────────────────────────────────────
        counts = defaultdict(int)
        for r in event_rows:
            counts[r["country_code"]] += 1
        over = {c: n for c, n in counts.items() if n > PAIRS_PER_COUNTRY}
        assert not over, f"{event}: country over quota: {over}"
        for cc in counts:
            slots = sorted([r for r in event_rows if r["country_code"] == cc],
                           key=lambda r: r["pair_slot"])
            for x, y in zip(slots, slots[1:]):
                assert x["pair_points"] >= y["pair_points"], \
                    f"{event} {cc}: slot {x['pair_slot']} weaker than {y['pair_slot']}"

        report(label, event_rows)
        print(f"\n  {len(counts)} Asian countries represented; "
              f"{sum(1 for n in counts.values() if n == 2)} fielded two pairs.")
        all_out.extend(event_rows)

    # ── The user's named pairs, reported explicitly ───────────────────────────
    # Strict top-2 by points does not always select these, so state where each
    # named pair actually sits in the Asian field.
    print(f"\n{'=' * 78}\nYOUR NAMED PAIRS\n{'=' * 78}")
    sub_of = {"MD": "MDI", "WD": "WDI", "XD": "XDI"}

    def lookup(name: str, sub_event: str) -> dict | None:
        return next((r for r in rows
                     if r["sub_event"] == sub_event and r["country_code"] == "IND"
                     and name.split()[-1].upper() in r["player_name"].upper()
                     and name.split()[0].upper() in r["player_name"].upper()), None)

    for event, n1, n2 in NAMED_PAIRS:
        a, b = lookup(n1, sub_of[event]), lookup(n2, sub_of[event])
        p1 = int((a["points_ytd"] or 0) if a else 0)
        p2 = int((b["points_ytd"] or 0) if b else 0)
        pts = p1 + p2
        field = [r for r in all_out if r["sub_event"] == event and r["pair_slot"] > 0]
        selected = next((r for r in field if r["country_code"] == "IND"
                         and {r["player1"], r["player2"]}
                         == {a["player_name"] if a else n1,
                             b["player_name"] if b else n2}), None)

        missing = [n for n, x in ((n1, a), (n2, b)) if x is None]
        if selected:
            status = f"SELECTED as India's pair {selected['pair_slot']} — Asian #{selected['asian_rank']}"
            rank_note = ""
        else:
            slot = sum(1 for r in field if r["pair_points"] > pts) + 1
            status = f"NOT in India's top 2 — would slot in at Asian #{slot}"
            rank_note = f"named pair, not selected; slots in at #{slot}"
            all_out.append({
                "sub_event": event, "asian_rank": slot, "country_code": "IND",
                "pair_slot": 0,
                "player1": a["player_name"] if a else n1, "p1_points": p1,
                "p1_world_rank": a["rank"] if a else 0,
                "player2": b["player_name"] if b else n2, "p2_points": p2,
                "p2_world_rank": b["rank"] if b else 0,
                "pair_points": pts, "is_india": "Y",
                "note": rank_note + (f"; UNRANKED in {event}: {', '.join(missing)} "
                                     f"(counted 0)" if missing else ""),
            })
        print(f"\n  {event}  {n1} ({p1}) + {n2} ({p2}) = {pts} pts")
        if missing:
            print(f"       !! no {event} individual ranking for: "
                  f"{', '.join(missing)} — counted as 0")
        print(f"       {status}")

    os.makedirs(OUTDIR, exist_ok=True)
    with open(OUTFILE, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(all_out[0].keys()))
        w.writeheader()
        w.writerows(all_out)
    print(f"\nWrote {len(all_out)} rows -> {OUTFILE}")


if __name__ == "__main__":
    main()
