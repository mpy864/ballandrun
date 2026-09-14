#!/usr/bin/env python3
"""TTFI domestic results — the one feed that was never automated.

Nationals, Inter-State, Khelo India and the National Ranking circuit are where an Indian
junior actually plays most of their matches, and where tops_grade_rules already assigns a
grade 6. None of it reached the dashboard: the loader ran by hand over five days in April
2026 and then stopped, so the table sat 155 days stale while WTT's seven feeds refreshed
nightly.

It stayed manual for a reason that has since expired. The original step 1 drove a real
Chrome through Playwright to get past Cloudflare, which is awkward to schedule and heavy
to install. Re-tested in September 2026, www.ttfi.org answers a plain request with HTTP
200 and no challenge at all, so the browser is gone and this is an ordinary feed.

Four stages, one process:

  1. tournaments  /results/<year>            -> slugs
  2. events       /events/view/<slug>        -> (tournament_id, event_id) pairs, base64'd
  3. matches      /result/view-result.php    -> the bracket
  4. link + write  name -> ITTF id, then upsert

Stage 3 is the original ttfi_step3_matches parser, imported rather than copied so there is
one place to fix when TTFI next changes its markup.
"""

from __future__ import annotations

import argparse
import base64
import importlib.util
import re
import sys
import time
from datetime import date
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tg_common import get_db, reported            # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

BASE    = "https://www.ttfi.org"
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"),
    "Referer": BASE + "/",
}
# The tournament and event ids travel base64-encoded inside two hashed query parameters.
PARAM_T = "0932388ad460202b7fe491686b8a664d"
PARAM_E = "58a9b4be5cb590600c5c533c396ae282"
BATCH   = 500

# Para, masters and veterans are separate competitions with their own ranking systems, and
# "test" is TTFI's own junk entry — it is a real slug on the 2025 results page.
EXCLUDE = ("para", "physically", "wheelchair", "deaf", "blind", "special-needs",
           "masters", "veteran", "senior-citizen", "exhibition", "friendly", "test")


def _load_step3():
    """Import ttfi_step3_matches.py from the repo root without triggering its CLI."""
    spec = importlib.util.spec_from_file_location(
        "ttfi_step3", ROOT / "ttfi_step3_matches.py")
    mod  = importlib.util.module_from_spec(spec)
    argv, sys.argv = sys.argv, ["ttfi_step3"]      # its module body reads argv
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.argv = argv
    return mod


def get(url, tries=3):
    for i in range(tries):
        try:
            r = requests.get(url, headers=HEADERS, timeout=45)
            r.raise_for_status()
            return r.text
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))
    return ""


# ── 1. tournaments ───────────────────────────────────────────────────────────

def find_tournaments(year):
    html  = get(BASE + "/results/" + str(year))
    slugs = sorted(set(re.findall(r'/events/view/([^/?#"\x27]+)', html)))
    out   = []
    for s in slugs:
        low = s.lower()
        if len(s) < 10 or any(k in low for k in EXCLUDE):
            continue
        out.append({"slug": s,
                    "season": "%d-%s" % (year, str(year + 1)[2:]),
                    "events_url": BASE + "/events/view/" + s})
    return out


# ── 2. events ────────────────────────────────────────────────────────────────

def find_events(t):
    """Every (tournament_id, event_id) the page links a main draw for.

    A tournament with no published results has no such links. That is the normal state of
    an event that finished yesterday — four of the five 2026 tournaments read this way in
    September — so it returns empty quietly rather than looking like a parse failure.
    """
    html  = get(t["events_url"])
    pairs = set()
    for href in re.findall(r'view-result\.php[^"\x27<> ]*', html):
        mt = re.search(PARAM_T + r'=([^&"]+)', href)
        me = re.search(PARAM_E + r'=([^&"]+)', href)
        if not (mt and me):
            continue
        try:
            pairs.add((int(base64.b64decode(mt.group(1)).decode()),
                       int(base64.b64decode(me.group(1)).decode())))
        except Exception:
            continue
    return [{"season": t["season"], "slug": t["slug"], "tournament_id": tid,
             "event_id": eid, "event_name": "event%d" % eid}
            for tid, eid in sorted(pairs)]


# ── 4a. name -> ITTF id ──────────────────────────────────────────────────────

def _tokens(name):
    """Words of three or more letters, lowercased, as a SET.

    The two sources disagree about name order and always will: a TTFI bracket prints
    "REWASKAR Naisha" the way a venue scoreboard does, while wtt_players holds
    "Naisha REWASKAR". Comparing sets makes the order irrelevant without having to guess
    which half is the surname — a guess that breaks on the many Indian names that carry no
    surname at all.
    """
    return frozenset(w for w in re.split(r'[^a-z]+', name.lower()) if len(w) > 2)


def build_name_index(db):
    rows = (db.table("wtt_players").select("ittf_id,player_name")
              .eq("country_code", "IND").limit(5000).execute().data or [])
    index = {}
    for r in rows:
        key = _tokens(r.get("player_name") or "")
        if len(key) >= 2:                  # a single token is far too weak to match on
            index.setdefault(key, []).append(str(r["ittf_id"]))
    # An ambiguous key is dropped, never guessed. The April run resolved both
    # "ARULRAJ Priyadharshini" and "VIJAY KUMAR Dharshini" onto one id belonging to
    # neither; 3 of its 192 links were wrong that way. A missing link costs a row on a
    # profile. A wrong link puts someone else's defeat on it.
    return {k: v[0] for k, v in index.items() if len(v) == 1}


def link(name, index):
    return index.get(_tokens(name)) if name else None


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", default="", help="comma-separated, e.g. 2025,2026")
    ap.add_argument("--delay", type=float, default=0.4)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    years = [int(y) for y in args.years.split(",") if y.strip()] or [date.today().year]

    step3 = _load_step3()
    db    = get_db()

    with reported("ttfi-domestic", db) as run:
        index = build_name_index(db)
        print("[ttfi] name index: %d unambiguous Indian players" % len(index))

        tournaments = []
        for y in years:
            ts = find_tournaments(y)
            print("[ttfi] %d: %d tournaments" % (y, len(ts)))
            tournaments += ts

        events = []
        for t in tournaments:
            evs = find_events(t)
            print("[ttfi]   %2d events  %s" % (len(evs), t["slug"][:58]))
            events += evs
            time.sleep(args.delay)

        matches = []
        for e in events:
            try:
                matches += step3.scrape_event(e, args.delay)
            except Exception as ex:
                print("[ttfi]   ! event %s/%s: %s: %s"
                      % (e["tournament_id"], e["event_id"], type(ex).__name__, ex))

        # The bracket gives a name; everything else in this database is keyed on the ITTF
        # id, so an unlinked row is invisible to a player profile.
        rows, by_t, linked = [], {}, 0
        for m in matches:
            w1 = link(m.get("player1_name"), index)
            w2 = link(m.get("player2_name"), index)
            if w1 or w2:
                linked += 1
            by_t.setdefault(m["tournament_id"], {
                "id": m["tournament_id"], "slug": m["slug"],
                "name": m["slug"].replace("-", " ").title(), "season": m["season"]})
            rows.append({
                "season": m["season"], "slug": m["slug"],
                "tournament_id": m["tournament_id"], "event_id": m["event_id"],
                "event_name": m["event_name"], "source": m["source"], "round": m["round"],
                "match_datetime": m.get("match_datetime") or None,
                "player1_id": m.get("player1_id") or None,
                "player1_name": m.get("player1_name"),
                "player1_affil": m.get("player1_affil"),
                "player2_id": m.get("player2_id") or None,
                "player2_name": m.get("player2_name"),
                "player2_affil": m.get("player2_affil"),
                "winner_id": m.get("winner_id") or None,
                "winner_name": m.get("winner_name"),
                "score_raw": m.get("score_raw"),
                "p1_sets": m.get("p1_sets"), "p2_sets": m.get("p2_sets"),
                "game_scores": m.get("game_scores"),
                "wtt_player1_id": w1, "wtt_player2_id": w2,
            })

        print("[ttfi] %d matches, %d touching a known Indian player" % (len(rows), linked))

        if args.dry_run:
            run["status"] = "noop"
            run["detail"] = "dry run: %d matches, %d linked" % (len(rows), linked)
            for r in rows[:3]:
                print("   ", r["round"], r["player1_name"], "vs",
                      r["player2_name"], r["score_raw"])
            return

        if not rows:
            run["status"] = "noop"
            run["detail"] = ("no published results across %d tournaments"
                             % len(tournaments))
            return

        db.table("ttfi_tournaments").upsert(list(by_t.values()),
                                            on_conflict="id").execute()

        # The unique key is (tournament_id, event_id, source, round, player1_id,
        # player2_id), so re-running a tournament already held updates rather than
        # duplicates — which is what lets this run nightly over an in-progress event.
        done = 0
        for i in range(0, len(rows), BATCH):
            chunk = rows[i:i + BATCH]
            db.table("ttfi_domestic_matches").upsert(
                chunk,
                on_conflict="tournament_id,event_id,source,round,player1_id,player2_id",
            ).execute()
            done += len(chunk)

        run["detail"] = ("%d matches across %d tournaments, %d linked"
                         % (done, len(by_t), linked))


if __name__ == "__main__":
    main()
