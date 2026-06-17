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


def _fmt(name: str, org: str, rank: int | None, is_india: bool) -> str:
    r_str = f"#{rank}" if rank else ""
    if is_india:
        return f"<i>{name}</i>" + (f" (<i>{r_str}</i>)" if r_str else "")
    extras = ([org] if org else []) + ([r_str] if r_str else [])
    return name + (f" ({','.join(extras)})" if extras else "")


# ── Message assembly ──────────────────────────────────────────────────────────

def build_messages(event_name: str, matches: list[dict],
                   mp: dict, rank_map: dict[int, int], db=None) -> list[str]:
    today_fmt = datetime.now().strftime("%a %d %b %Y")
    venue     = next((m["venue"] for m in matches if m["venue"]), "")

    header = (
        f"<b>{event_name}</b>" + (f"  |  {venue}" if venue else "") + "\n"
        f"Today's Schedule — {today_fmt}\n"
        f"({len(matches)} match{'es' if len(matches) != 1 else ''})"
    )

    blocks: list[str] = []
    prev_time = None

    for m in matches:
        sub, rnd = _parse_disc_round(m["description"])
        t = m["start_time"][11:16] if len(m["start_time"]) > 10 else "–"

        ind1, ind2 = _india(m["org1"]), _india(m["org2"])

        # India player always displayed first
        if ind2 and not ind1:
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

        p1_str = _fmt(n1, o1, r1, ind1)
        p2_str = _fmt(n2, o2, r2, ind2)

        time_sep = f"\n{'─'*28} {t}" if t != prev_time else ""
        prev_time = t

        # Prediction for singles only
        pred_line = ""
        if not m["is_doubles"] and ids1 and ids2:
            try:
                key       = "W" if "Women" in m["sub_event"] else "M"
                predictor = mp.get(key) or next(iter(mp.values()))
                sc        = predictor.predict_score(ids1[0], ids2[0])
                p         = sc["p_match"]
                conf      = max(p, 1 - p)
                win_name  = n1 if p >= 0.5 else n2
                win_india = ind1 if p >= 0.5 else ind2
                win_fmt   = f"<i>{win_name}</i>" if win_india else win_name
                pred_line = f"\n⚡ Prediction: {win_fmt} ({conf*100:.0f}%)"
            except Exception:
                pass

        block = (
            f"{time_sep}\n"
            f"{sub}  |  {rnd}\n"
            f"{p1_str}  vs  {p2_str}"
            f"{pred_line}"
        )
        blocks.append(block.strip())

    # Pack blocks into ≤ 4000 char messages
    messages = [header]
    chunk = ""
    for block in blocks:
        addition = "\n\n" + block
        if len(chunk) + len(addition) > 3800:
            messages.append(chunk.strip())
            chunk = block
        else:
            chunk += addition
    if chunk.strip():
        messages.append(chunk.strip())

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

        messages = build_messages(ename, matches, mp, rank_map, db=db)

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
