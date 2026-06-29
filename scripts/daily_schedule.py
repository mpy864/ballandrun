#!/usr/bin/env python3
"""
daily_schedule.py — Post today's WTT match schedule with predictions to Telegram.

Run at the start of each competition day.  Results posted by live_updater.py
will carry a ✅/❌ against the same prediction shown here.

Usage
-----
  python scripts/daily_schedule.py --event 3240
  python scripts/daily_schedule.py --auto              # all currently active events
  python scripts/daily_schedule.py --auto --db         # include player WR rankings
  python scripts/daily_schedule.py --auto --dry-run    # print only, don't send
"""

import os, sys, re, time, argparse, requests
from datetime import datetime, date, timedelta

sys.path.insert(0, os.path.dirname(__file__))
from feature_model import MatchPredictor

try:
    from supabase import create_client as _sb_create
except ImportError:
    _sb_create = None

# ── Endpoints ─────────────────────────────────────────────────────────────────

SCHEDULE_BASE = (
    "https://wtt-web-frontdoor-withoutcache-cqakg0andqf5hchn.a01.azurefd.net"
    "/websitecacheddata/{event_id}/schedule/schedule.json"
)
HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept":     "application/json",
    "Origin":     "https://www.worldtabletennis.com",
    "Referer":    "https://www.worldtabletennis.com/",
}

OFFICIAL_RESULT_URL = (
    "https://wtt-website-live-events-api-prod-cmfzgabgbzhphabb.eastasia-01"
    ".azurewebsites.net/api/cms/GetOfficialResult"
)


# ── Timezone: venue-local schedule -> IST ──────────────────────────────────────

def derive_utc_offset(event_id: int, schedule_data: list) -> int | None:
    """
    The schedule feed gives venue-LOCAL times with no timezone. Derive the venue's
    UTC offset (hours, utc - local) by matching completed matches to the results
    API, which carries matchStartTimeUTC. Returns a whole-hour offset, or None if
    it can't be derived (too few completed matches).
    """
    import statistics

    def _naive(s: str):
        s = s.replace("Z", "").split(".")[0].split("+")[0]
        try:
            return datetime.fromisoformat(s)
        except ValueError:
            return None

    # UTC start keyed by the set of athlete IDs in the match
    try:
        r = requests.get(OFFICIAL_RESULT_URL,
                         params={"EventId": event_id, "include_match_card": "true", "take": 500},
                         headers=HEADERS, timeout=20)
        rows = r.json() if r.status_code == 200 else []
        if not isinstance(rows, list):
            rows = rows.get("Data") or rows.get("Result") or []
    except Exception:
        return None

    utc_by_ids: dict[frozenset, str] = {}
    for e in rows:
        mc = e.get("match_card") or e
        u  = mc.get("matchStartTimeUTC") or ""
        if not u:
            continue
        ids = {int(p["playerId"]) for c in (mc.get("competitiors") or [])
               for p in (c.get("players") or []) if str(p.get("playerId", "")).isdigit()}
        if ids:
            utc_by_ids[frozenset(ids)] = u

    raw = []
    for day in schedule_data:
        for u in (day.get("Competition") or {}).get("Unit", []):
            sd = u.get("ActualStartDate") or ""
            if not sd:
                continue
            ids = {int(a["Code"]) for s in (u.get("StartList", {}).get("Start") or [])
                   for a in ((s.get("Competitor") or {}).get("Composition") or {}).get("Athlete", [])
                   if str(a.get("Code", "")).isdigit()}
            key = frozenset(ids)
            if key in utc_by_ids:
                loc, utc = _naive(sd), _naive(utc_by_ids[key])
                if loc and utc:
                    raw.append((utc - loc).total_seconds() / 3600)

    if len(raw) < 3:
        return None
    med   = statistics.median(raw)
    clean = [x for x in raw if abs(x - med) <= 2]      # drop mismatched-id outliers
    return round(sum(clean) / len(clean)) if clean else None


def _to_ist(local_str: str, utc_offset: int | None):
    """Convert a venue-local 'YYYY-MM-DDTHH:MM:SS' string to an IST datetime."""
    if utc_offset is None or len(local_str) < 16:
        return None
    try:
        dt = datetime.fromisoformat(local_str[:19])
    except ValueError:
        return None
    return dt + timedelta(hours=utc_offset) + timedelta(hours=5, minutes=30)


# ── Discipline / round / name shorthands ───────────────────────────────────────

_DISC_SHORT = {
    "Men's Singles": "MS", "Women's Singles": "WS", "Men's Doubles": "MD",
    "Women's Doubles": "WD", "Mixed Doubles": "XD",
}


def _disc_short(disc: str) -> str:
    return _DISC_SHORT.get(disc, disc)


def _round_short(rnd: str) -> str:
    txt = re.sub(r'\s*-\s*Match\s*\d+$', '', rnd, flags=re.IGNORECASE).strip()
    low = txt.lower()
    if "qualif" in low:
        m = re.search(r'(\d+)', low)
        return f"Qual R{m.group(1)}" if m else "Qual"
    if "final" in low and "semi" not in low and "quarter" not in low:
        return "Final"
    if "semi" in low:    return "SF"
    if "quarter" in low: return "QF"
    if "round of 16" in low: return "R16"
    if "round of 32" in low: return "R32"
    if "round of 64" in low: return "R64"
    if "round of 128" in low: return "R128"
    return txt or "—"


def _pretty_name(team_name: str, is_doubles: bool) -> str:
    """De-shout WTT names ('GHORPADE Yashaswini' -> 'Ghorpade Yashaswini'),
    keeping the feed's surname-first order. Doubles -> surnames only."""
    if is_doubles:
        sides = [s.strip() for s in team_name.split("/") if s.strip()]
        return " / ".join((s.split()[0].title() if s.split() else s) for s in sides)
    return " ".join(p.title() for p in team_name.split())

# ── Schedule fetching ─────────────────────────────────────────────────────────

def fetch_schedule(event_id: int) -> list:
    now = datetime.now().strftime("%Y-%m-%d%H:%M")
    url = SCHEDULE_BASE.format(event_id=event_id) + f"?q={now}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        if r.status_code == 200:
            return r.json()
        print(f"  [!] Schedule HTTP {r.status_code} for event {event_id}")
    except Exception as e:
        print(f"  [!] Schedule error for event {event_id}: {e}")
    return []


def parse_today_matches(data: list, event_id: int) -> list[dict]:
    """Extract and deduplicate today's matches from schedule JSON."""
    today = date.today().isoformat()
    PRIORITY = {"Official": 0, "Running": 1, "Scheduled": 2, "Start List": 3}
    best: dict[str, dict] = {}

    for day_block in data:
        for unit in (day_block.get("Competition") or {}).get("Unit", []):
            if not unit.get("StartDate", "").startswith(today):
                continue
            code = unit.get("Code", "")
            if not code:
                continue
            cur_p = PRIORITY.get(unit.get("ScheduleStatus", ""), 99)
            old_p = PRIORITY.get(best.get(code, {}).get("ScheduleStatus", ""), 99)
            if cur_p < old_p:
                best[code] = unit

    matches = []
    for code, unit in sorted(best.items(), key=lambda x: x[1].get("StartDate", "")):
        starts = unit.get("StartList", {}).get("Start") or []
        comps  = [s for s in starts if s and s.get("Competitor")]
        if len(comps) < 2:
            continue

        def athlete_ids(comp):
            return [
                int(a["Code"]) for a in
                (comp.get("Composition") or {}).get("Athlete", [])
                if str(a.get("Code", "")).isdigit()
            ]

        c1, c2   = comps[0]["Competitor"], comps[1]["Competitor"]
        id1s     = athlete_ids(c1)
        id2s     = athlete_ids(c2)
        is_dbl   = len(id1s) > 1 or len(id2s) > 1

        desc = next(
            (i["Value"] for i in unit.get("ItemDescription", []) if i.get("Language") == "ENG"),
            unit.get("SubEvent", "")
        )
        # Strip "- Match N" suffix
        desc = re.sub(r'\s*-\s*Match\s*\d+$', '', desc, flags=re.IGNORECASE).strip()

        matches.append({
            "code":       code,
            "event_id":   event_id,
            "start_time": unit.get("StartDate", ""),
            "sub_event":  unit.get("SubEvent", ""),
            "description": desc,
            "venue":      (unit.get("VenueDescription") or {}).get("VenueName", ""),
            "status":     unit.get("ScheduleStatus", ""),
            "name1": (c1.get("Description") or {}).get("TeamName", "?"),
            "name2": (c2.get("Description") or {}).get("TeamName", "?"),
            "org1":  c1.get("Organization") or "",
            "org2":  c2.get("Organization") or "",
            "id1s":  id1s,
            "id2s":  id2s,
            "is_doubles": is_dbl,
        })
    return matches


# ── Player rankings ───────────────────────────────────────────────────────────

def _doubles_category(desc: str) -> str:
    low = desc.lower()
    if "mixed" in low:  return "XD"
    if "women" in low:  return "WD"
    return "MD"


def fetch_doubles_pair_rank(db, ids_pair: list[int], category: str) -> int | None:
    if len(ids_pair) < 2 or not db:
        return None
    p1, p2 = ids_pair[0], ids_pair[1]
    try:
        r = db.table("rankings_doubles_teams") \
               .select("p1_ittf_id,p2_ittf_id,current_rank,publish_date") \
               .eq("category", category) \
               .or_(f"p1_ittf_id.eq.{p1},p2_ittf_id.eq.{p1},p1_ittf_id.eq.{p2},p2_ittf_id.eq.{p2}") \
               .order("publish_date", desc=True) \
               .execute()
        pair_set = {p1, p2}
        cutoff = (date.today() - timedelta(days=45)).isoformat()
        for row in (r.data or []):
            if {row["p1_ittf_id"], row["p2_ittf_id"]} == pair_set:
                if row["publish_date"] >= cutoff:
                    return row["current_rank"]
                return None
    except Exception as e:
        print(f"  [DB] doubles rank error: {e}")
    return None


def fetch_ranks(db, ids: list[int]) -> dict[int, int]:
    if not db or not ids:
        return {}
    try:
        rr = db.table("rankings_singles_normalized") \
               .select("player_id,rank,ranking_date") \
               .in_("player_id", ids) \
               .order("ranking_date", desc=True).execute()
        rank_map: dict[int, int] = {}
        for r in (rr.data or []):
            if r["player_id"] not in rank_map:
                rank_map[r["player_id"]] = r["rank"]
        return rank_map
    except Exception as e:
        print(f"  [DB] rank fetch error: {e}")
        return {}


# ── Formatting helpers ────────────────────────────────────────────────────────

def _parse_disc_round(desc: str) -> tuple[str, str]:
    for d in ["Women's Singles", "Men's Singles", "Mixed Doubles",
              "Women's Doubles", "Men's Doubles"]:
        if d.lower() in desc.lower():
            rest = desc[desc.lower().find(d.lower()) + len(d):].strip(" -·|")
            return d, rest or desc
    return "Match", desc


def _india(org: str) -> bool:
    return "IND" in (org or "").upper()


# ── Message assembly ──────────────────────────────────────────────────────────

def _fmt2(pretty: str, org: str, rank: int | None, is_india: bool) -> str:
    o    = "IND" if is_india else (org or "")
    bits = ([o] if o else []) + ([str(rank)] if rank else [])
    paren = f" ({', '.join(bits)})" if bits else ""
    return f"<i>{pretty}{paren}</i>" if is_india else f"{pretty}{paren}"


def build_messages(event_name: str, matches: list[dict], mp: dict,
                   rank_map: dict[int, int], utc_offset: int | None, db=None) -> list[str]:
    venue = next((m["venue"] for m in matches if m["venue"]), "")

    # Header date in IST (from earliest convertible match), else today.
    ist_times = [(_to_ist(m["start_time"], utc_offset)) for m in matches]
    first_ist = next((x for x in ist_times if x), None)
    if utc_offset is not None and first_ist:
        date_label, tz_label = first_ist.strftime("%a %d %b"), "times in IST"
    else:
        date_label, tz_label = datetime.now().strftime("%a %d %b"), "times in venue local time"

    header = (
        f"\U0001F1EE\U0001F1F3 <b>{event_name}</b> — India Today\n"
        f"{date_label} · {tz_label} · {len(matches)} "
        f"match{'es' if len(matches) != 1 else ''}"
    )

    blocks: list[str] = []
    for m, ist in zip(matches, ist_times):
        sub, rnd = _parse_disc_round(m["description"])
        t = ist.strftime("%H:%M") if ist else (
            m["start_time"][11:16] if len(m["start_time"]) > 10 else "—")

        ind1, ind2 = _india(m["org1"]), _india(m["org2"])
        if ind2 and not ind1:   # India player first
            n1, o1, ids1, n2, o2, ids2 = (m["name2"], m["org2"], m["id2s"],
                                           m["name1"], m["org1"], m["id1s"])
            ind1, ind2 = True, False
        else:
            n1, o1, ids1, n2, o2, ids2 = (m["name1"], m["org1"], m["id1s"],
                                           m["name2"], m["org2"], m["id2s"])

        if m["is_doubles"]:
            cat = _doubles_category(m["description"])
            r1  = fetch_doubles_pair_rank(db, ids1, cat)
            r2  = fetch_doubles_pair_rank(db, ids2, cat)
        else:
            r1 = rank_map.get(ids1[0]) if len(ids1) == 1 else None
            r2 = rank_map.get(ids2[0]) if len(ids2) == 1 else None

        p1 = _fmt2(_pretty_name(n1, m["is_doubles"]), o1, r1, ind1)
        p2 = _fmt2(_pretty_name(n2, m["is_doubles"]), o2, r2, ind2)

        # Prediction (singles only)
        pred_line = ""
        if not m["is_doubles"] and ids1 and ids2:
            try:
                key       = "W" if "Women" in m["sub_event"] else "M"
                predictor = mp.get(key) or next(iter(mp.values()))
                p         = predictor.predict_score(ids1[0], ids2[0])["p_match"]
                conf      = max(p, 1 - p)
                win_pretty = _pretty_name(n1 if p >= 0.5 else n2, False)
                win_india  = ind1 if p >= 0.5 else ind2
                win_fmt    = f"<i>{win_pretty}</i>" if win_india else win_pretty
                pred_line  = f"\nPick: {win_fmt} {conf*100:.0f}%"
            except Exception:
                pass

        blocks.append(
            f"<b>{t}</b>  {_disc_short(sub)} · {_round_short(rnd)}\n"
            f"{p1}  v  {p2}{pred_line}"
        )

    # Pack header + blocks into ≤ ~3800 char messages
    messages, chunk = [], header
    for block in blocks:
        addition = "\n\n" + block
        if len(chunk) + len(addition) > 3800:
            messages.append(chunk)
            chunk = header + " (cont.)\n\n" + block
        else:
            chunk += addition
    messages.append(chunk)
    return messages


# ── Telegram sender ───────────────────────────────────────────────────────────

def send(token: str, channel: str, text: str):
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": channel, "text": text, "parse_mode": "HTML"},
            timeout=10,
        )
        if r.status_code != 200:
            print(f"  [TG] HTTP {r.status_code}: {r.text[:200]}")
    except Exception as e:
        print(f"  [TG] error: {e}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--event",    type=int, default=None)
    ap.add_argument("--auto",     action="store_true", help="All currently active events")
    ap.add_argument("--lookback", type=int, default=7)
    ap.add_argument("--db",       action="store_true", help="Fetch player WR rankings")
    ap.add_argument("--india-only", action="store_true", help="Only show matches with Indian players")
    ap.add_argument("--dry-run",    action="store_true", help="Print, don't send to Telegram")
    args = ap.parse_args()

    if not args.auto and args.event is None:
        ap.error("provide --event <id>  or  --auto")

    # Resolve event IDs and names
    if args.auto:
        from fetch_matches import WTT_2026_EVENT_IDS
        today = date.today()
        event_ids  = [
            eid for eid, (_, end) in WTT_2026_EVENT_IDS.items()
            if today - timedelta(days=args.lookback) <= date.fromisoformat(end) <= today + timedelta(days=args.lookback)
        ]
        event_names = {eid: WTT_2026_EVENT_IDS[eid][0] for eid in event_ids}
    else:
        event_ids = [args.event]
        try:
            from fetch_matches import WTT_2026_EVENT_IDS
            event_names = {args.event: WTT_2026_EVENT_IDS.get(args.event, (f"Event {args.event}",))[0]}
        except Exception:
            event_names = {args.event: f"Event {args.event}"}

    # Supabase (optional, for rankings)
    db = None
    if args.db and _sb_create:
        try:
            db = _sb_create(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
            print("  [DB] Connected")
        except Exception as e:
            print(f"  [DB] {e}")

    # Telegram creds
    tg_token   = os.environ.get("TELEGRAM_BOT_TOKEN")
    tg_channel = os.environ.get("TELEGRAM_CHANNEL_ID")
    if not args.dry_run and (not tg_token or not tg_channel):
        print("  [!] Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID in .env")
        return

    # Load models
    print("Loading models...")
    mp = {}
    for g in ("M", "W"):
        try:
            mp[g] = MatchPredictor.load(g)
            print(f"  {g}: {len(mp[g].states)} players")
        except FileNotFoundError:
            print(f"  [!] No {g} model — run: python scripts/feature_model.py --gender {g}")
    if not mp:
        print("[!] No models found.")
        return
    print()

    for eid in event_ids:
        ename = event_names.get(eid, f"Event {eid}")
        print(f"{'='*56}")
        print(f"  {ename}  ({eid})")
        print(f"{'='*56}")

        data = fetch_schedule(eid)
        if not data:
            continue

        matches = parse_today_matches(data, eid)
        if args.india_only:
            matches = [m for m in matches if _india(m["org1"]) or _india(m["org2"])]
        if not matches:
            print(f"  No {'Indian ' if args.india_only else ''}matches scheduled today.")
            continue
        print(f"  {len(matches)} match(es) today{' (India)' if args.india_only else ''}.")

        all_ids  = list({i for m in matches for i in m["id1s"] + m["id2s"]})
        rank_map = fetch_ranks(db, all_ids)

        utc_offset = derive_utc_offset(eid, data)
        if utc_offset is None:
            print("  [tz] Could not derive venue offset — showing venue-local time.")
        else:
            print(f"  [tz] Venue UTC offset {utc_offset:+d}h → converting to IST.")

        messages = build_messages(ename, matches, mp, rank_map, utc_offset, db=db)

        for idx, msg in enumerate(messages, 1):
            if args.dry_run:
                print(f"\n── Message {idx}/{len(messages)} {'─'*40}")
                print(msg)
            else:
                send(tg_token, tg_channel, msg)
                print(f"  [TG] Sent part {idx}/{len(messages)}")
                time.sleep(0.5)

    print("\nDone.")


if __name__ == "__main__":
    main()
