"""
fetch_players.py
Walks WTT's whole athlete directory and keeps wtt_players complete.

Why this exists
---------------
wtt_players used to fill only as a SIDE EFFECT of fetching matches: collect the ids in
the matches we pulled, look up any we had not seen. That leaves out every athlete who is
ranked but has not played in one of the 139 tournaments on our list — 3,805 of 12,491
known athletes, including 103 Indian juniors.

It was never a limitation of WTT. GetPlayers answers for any id, and it also pages: 571
pages of 100, roughly 57,100 athletes, the entire directory. Nobody had asked it to.

Missing profiles are not cosmetic. No profile means no date of birth, and without a date
of birth we cannot work out which age band a junior was in during a past week — we have
to fall back on WTT's tag, which reports today's band rather than the one they held then.
That is the bug that cost 445 junior matches their rank.

What it does NOT do
-------------------
Overwrite good data with nulls. The directory returns handedness for about 4% of players;
we already hold it for 17%, gathered when those profiles were fetched individually. A
straight upsert would wipe 1,448 of them. Every field is merged: a new value replaces an
old one only when the new value is actually present.
"""

import argparse
import os
import sys
import time
from datetime import datetime, timezone

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tg_common import get_db, record_health                       # noqa: E402

FEED = "wtt-players"

URL = ("https://wtt-ttu-connect-frontdoor-g6gwg6e2bgc6gdfm.a01.azurefd.net"
       "/Players/GetPlayers")
HEADERS = {
    "apikey":     "2bf8b222-532c-4c60-8ebe-eb6fdfebe84a",
    "secapimkey": "S_WTT_882jjh7basdj91834783mds8j2jsd81",
    "origin":     "https://www.worldtabletennis.com",
    "referer":    "https://www.worldtabletennis.com/",
    "accept":     "application/json",
    "user-agent": "Mozilla/5.0",
}
TIMEOUT   = 25
SLEEP     = 0.25          # between pages, to stay polite
BATCH     = 500           # rows per upsert

# Only the fields WTT actually populates. Measured across a 300-player sample:
# name/country/gender/Age 100%, DOB 98%, handedness and grip 4%, headshot 1%, and
# Style / ActiveSince / Bio / earnings 0%. Columns for fields that are always empty
# would be columns nobody can ever trust.
GENDER = {"Men": "M", "M": "M", "Male": "M",
          "Women": "W", "Woman": "W", "W": "W", "F": "W", "Female": "W"}


def parse_dob(raw):
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%m/%d/%Y %H:%M:%S").strftime("%Y-%m-%d")
    except ValueError:
        return str(raw)[:10] or None


def fetch_page(page: int) -> list:
    for attempt in range(4):
        try:
            r = requests.get(URL, params={"Page": page}, headers=HEADERS, timeout=TIMEOUT)
            if r.status_code != 200:
                print(f"    [!] HTTP {r.status_code} on page {page}")
                return []
            return r.json().get("Result") or []
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            wait = 5 * (attempt + 1)
            print(f"    [retry {attempt+1}/3 in {wait}s] {e}")
            time.sleep(wait)
    print(f"    [!] gave up on page {page}")
    return []


def to_row(p: dict) -> dict | None:
    try:
        iid = int(p.get("IttfId"))
    except (TypeError, ValueError):
        return None
    # Ids at or above 1,000,000 are team/registration entries, not people.
    if iid >= 1_000_000:
        return None
    return {
        "ittf_id":      iid,
        "player_name":  p.get("PlayerName"),
        "country_code": p.get("CountryCode"),
        "country_name": p.get("CountryName"),
        "gender":       GENDER.get(p.get("Gender") or "", None),
        "dob":          parse_dob(p.get("DOB")),
        "handedness":   p.get("Handedness"),
        "grip":         p.get("Grip"),
        "blade_type":   p.get("BladeType"),
    }


def merge(new: dict, old: dict) -> dict:
    """Keep the old value wherever the new one is empty.

    The directory listing is thinner than the per-id lookup that filled this table
    originally, so writing it straight over the top would erase real data. ittf_id is
    never merged — it is the key.
    """
    out = dict(new)
    for k, v in new.items():
        if k == "ittf_id":
            continue
        if v in (None, "") and old.get(k) not in (None, ""):
            out[k] = old[k]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-pages", type=int, default=800,
                    help="safety stop; the directory was 571 pages when written")
    ap.add_argument("--dry-run", action="store_true",
                    help="fetch and report, write nothing")
    args = ap.parse_args()

    db = get_db()
    if db is None:
        sys.exit("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY")

    print("Walking the WTT player directory ...")
    rows, page, empty_pages = {}, 1, 0
    while page <= args.max_pages:
        batch = fetch_page(page)
        if not batch:
            empty_pages += 1
            # Two empty pages in a row means the end, not a blip.
            if empty_pages >= 2:
                break
            page += 1
            continue
        empty_pages = 0
        for p in batch:
            r = to_row(p)
            if r:
                rows[r["ittf_id"]] = r
        if page % 50 == 0:
            print(f"  page {page}: {len(rows)} athletes so far")
        page += 1
        time.sleep(SLEEP)

    print(f"  {len(rows)} athletes across {page - 1} pages")
    if not rows:
        if not args.dry_run:
            record_health(db, FEED, "error", "directory returned nothing")
        sys.exit("Directory returned nothing — refusing to touch the table.")

    # What we already hold, so nothing gets overwritten with a blank.
    existing = {}
    ids = list(rows)
    for i in range(0, len(ids), 400):
        chunk = ids[i:i + 400]
        try:
            r = db.table("wtt_players").select(
                "ittf_id, player_name, country_code, country_name, gender, dob,"
                " handedness, grip, blade_type").in_("ittf_id", chunk).execute()
            for e in (r.data or []):
                existing[e["ittf_id"]] = e
        except Exception as e:
            sys.exit(f"Could not read existing players, stopping rather than guessing: {e}")

    new_ids   = [i for i in rows if i not in existing]
    payload   = [merge(rows[i], existing.get(i, {})) for i in rows]
    would_null = sum(
        1 for i in existing
        if any(existing[i].get(k) not in (None, "") and rows[i].get(k) in (None, "")
               for k in ("handedness", "grip", "dob", "gender"))
    )

    print(f"  new athletes:            {len(new_ids)}")
    print(f"  already known:           {len(existing)}")
    print(f"  protected from blanking: {would_null}")

    if args.dry_run:
        print("(dry run — nothing written)")
        return 0

    sent = 0
    for i in range(0, len(payload), BATCH):
        chunk = payload[i:i + BATCH]
        try:
            db.table("wtt_players").upsert(chunk, on_conflict="ittf_id").execute()
            sent += len(chunk)
        except Exception as e:
            print(f"  [!] upsert failed on batch {i // BATCH + 1}: {e}")
    print(f"  upserted {sent}/{len(payload)}")

    record_health(db, FEED, "ok",
                  f"{len(rows)} athletes, {len(new_ids)} new", sent)
    return 0


if __name__ == "__main__":
    sys.exit(main())
