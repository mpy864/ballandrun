#!/usr/bin/env python3
"""
ittf_feed.py — Telegram feed for ITTF / ATTU events (results.ittf.com).

Continental / ITTF events are NOT on the WTT API, so the WTT bots can't see
them. This reads the open ITTF results JSON (Bornan/Azure) directly:

  champ.json                   -> config: sub-events, dates, live status
  match/d<YYYY-MM-DD>.json      -> a day's matches (scheduled / live / finished)

Three India-focused modes (no model predictions). TEAM ties are expanded into
their individual rubbers (SubMatches). All posting is de-duplicated via the
Supabase `tg_sent` table, so nothing is ever sent twice and re-runs are safe.
Days are chosen by the VENUE's local date (per-event UTC offset), not UTC, so
the right day is always picked regardless of when the job runs.

  recap     post each completed venue-day's grouped summary, ONCE.
  schedule  post a venue-day's upcoming matches (times in IST), ONCE per day.
  live      post each Indian result the first time it is seen finished.

Usage
-----
  python scripts/ittf_feed.py --auto --mode recap    --dry-run
  python scripts/ittf_feed.py --auto --mode schedule --dry-run
  python scripts/ittf_feed.py --auto --mode live
"""

import os, sys, argparse, requests
from datetime import date, datetime, timedelta, timezone

# ── ITTF / ATTU events: id -> (name, start, end, venue_utc_offset|None) ────────
ITTF_EVENTS = {
    3379: ("ITTF World Cup Macao 2026",                              "2026-03-30", "2026-04-05",  8),
    3216: ("ITTF World Team Championships London 2026",              "2026-04-28", "2026-05-10",  1),
    3377: ("ITTF World Youth Championships 2026",                    "2026-11-21", "2026-11-28",  None),
    3378: ("ITTF Mixed Team World Cup Chengdu 2026",                 "2026-11-29", "2026-12-06",  8),
    3471: ("ITTF-ATTU Asian Cup Haikou 2026",                        "2026-02-04", "2026-02-08",  8),
    3472: ("ITTF-ATTU Asian Youth Championships Bangkok 2026",       "2026-06-28", "2026-07-04",  7),
    3473: ("Asian Games Nagoya 2026",                                "2026-09-20", "2026-09-28",  9),
    3474: ("ITTF-ATTU Asian Championships Tashkent 2026",            "2026-10-12", "2026-10-25",  5),
    3475: ("ITTF-ATTU South East Asian Youth Championships 2026",    "2026-04-14", "2026-04-19",  None),
    3498: ("ITTF-ATTU Central Asia Youth Championships Almaty 2026", "2026-04-03", "2026-04-05",  5),
    3499: ("ITTF-ATTU West Asia Youth Championships Amman 2026",     "2026-06-01", "2026-06-01",  3),
    3500: ("ITTF-ATTU South Asia Youth Championships Shimla 2026",   "2026-04-08", "2026-04-11",  5.5),
}

RESULTS_BASE = "https://results.ittf.com/ittf-web-results/html"
HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
ST_FINISHED, ST_LIVE, ST_UPCOMING = 1, 2, 4   # champ.json status codes
IST = timezone(timedelta(hours=5, minutes=30))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


# ── Fetch ──────────────────────────────────────────────────────────────────────

def _get_json(url):
    try:
        r = requests.get(url, headers=HEADERS, timeout=20)
        if r.status_code != 200:
            return None
        return r.json() if r.content[:1] != b"\xef" else \
            __import__("json").loads(r.content.decode("utf-8-sig"))
    except Exception as e:
        print(f"  [!] fetch error {url}: {e}")
        return None


def get_champ(event_id):
    return _get_json(f"{RESULTS_BASE}/TTE{event_id}/champ.json")


def get_day(event_id, date_raw):
    return _get_json(f"{RESULTS_BASE}/TTE{event_id}/match/d{date_raw}.json") or []


def event_name(event_id, champ=None):
    return (champ or {}).get("champDesc") or ITTF_EVENTS.get(event_id, (f"Event {event_id}",))[0]


def venue_offset(event_id):
    return ITTF_EVENTS.get(event_id, (None, None, None, None))[3]


def venue_today(event_id):
    off = venue_offset(event_id)
    return (datetime.now(timezone.utc) + timedelta(hours=off or 0)).date()


# ── Supabase dedup (tg_sent: feed, item_key) ─────────────────────────────────────

def get_db():
    try:
        from supabase import create_client
        url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
        if url and key:
            return create_client(url, key)
    except Exception as e:
        print(f"  [dedup] supabase unavailable: {e}")
    return None


def already_sent(db, feed, keys):
    if not db or not keys:
        return set()
    try:
        out = set()
        keys = list(keys)
        for i in range(0, len(keys), 100):
            r = db.table("tg_sent").select("item_key").eq("feed", feed) \
                  .in_("item_key", keys[i:i + 100]).execute()
            out |= {row["item_key"] for row in (r.data or [])}
        return out
    except Exception as e:
        print(f"  [dedup] read error: {e}")
        return set()


def mark_sent(db, feed, key):
    if not db:
        return
    try:
        db.table("tg_sent").upsert({"feed": feed, "item_key": key}).execute()
    except Exception as e:
        print(f"  [dedup] write error: {e}")


# ── Formatting ─────────────────────────────────────────────────────────────────

def pretty_name(name: str) -> str:
    def fix(part):
        return " ".join(w.title() if w.isupper() else w for w in part.split())
    if "/" in (name or ""):
        return "/".join(fix(p.strip()) for p in name.split("/"))
    return fix(name or "")


def _round_short(round_txt: str) -> str:
    low = (round_txt or "").lower()
    if "qualif" in low:
        import re; m = re.search(r"(\d+)", low)
        return f"Qual R{m.group(1)}" if m else "Qual"
    if "final" in low and "semi" not in low and "quarter" not in low:
        return "Final"
    if "semi" in low:    return "SF"
    if "quarter" in low: return "QF"
    if "round of 16" in low:  return "R16"
    if "round of 32" in low:  return "R32"
    if "round of 64" in low:  return "R64"
    if "round of 128" in low: return "R128"
    if "group" in low:   return "Group"
    return round_txt.strip() or "—"


def _parse_desc(desc: str):
    parts = [p.strip() for p in (desc or "").split(" - ")]
    return (parts[0] if parts else desc), (_round_short(parts[1]) if len(parts) >= 2 else "")


def _is_india(side: dict) -> bool:
    return (side.get("Org") or "") == "IND"


def _involves_india(m: dict) -> bool:
    return _is_india(m.get("Home") or {}) or _is_india(m.get("Away") or {})


def _games(side: dict) -> int:
    try:
        return int(side.get("Res") or 0)
    except (ValueError, TypeError):
        return 0


def _played(a: dict, b: dict) -> bool:
    return bool(a.get("Win") or b.get("Win")) or _games(a) > 0 or _games(b) > 0


def _verb(first: dict, second: dict) -> str:
    a, b = _games(first), _games(second)
    return "def." if a > b else ("lost to" if b > a else "drew")


def _ist_clock(m: dict, off) -> str:
    if off is None:
        return ""
    hhmm = (m.get("RTime") or "").strip()
    if not hhmm and "," in (m.get("Time") or ""):
        hhmm = m["Time"].split(",")[-1].strip()
    try:
        h, mi = (int(x) for x in hhmm.split(":")[:2])
    except (ValueError, AttributeError):
        return ""
    total = (h * 60 + mi - int(off * 60) + 330) % 1440
    return f"{total // 60:02d}:{total % 60:02d}"


def _rubber_line(sm: dict):
    h, a = sm.get("Home") or {}, sm.get("Away") or {}
    if not _played(h, a):
        return None
    ind, opp = (a, h) if (_is_india(a) and not _is_india(h)) else (h, a)
    ind_s = f"<i>{pretty_name(ind.get('Desc'))}</i>" if _is_india(ind) else pretty_name(ind.get("Desc"))
    opp_s = f"<i>{pretty_name(opp.get('Desc'))}</i>" if _is_india(opp) else pretty_name(opp.get("Desc"))
    return f"   • {ind_s} {_verb(ind, opp)} {opp_s} {ind.get('Res')}–{opp.get('Res')}"


def _match_block(m: dict) -> str:
    home, away = m.get("Home") or {}, m.get("Away") or {}
    _, rnd = _parse_desc(m.get("Desc", ""))
    if m.get("IsTeam"):
        ind_t, opp_t = (home, away) if _is_india(home) else (away, home)
        head = (f"{rnd}  <i>{ind_t.get('Desc')}</i> "
                f"{ind_t.get('Res')}–{opp_t.get('Res')} {opp_t.get('Desc')}")
        return "\n".join([head] + [ln for sm in (m.get("SubMatches") or [])
                                   if (ln := _rubber_line(sm))])
    ind, opp = (away, home) if (_is_india(away) and not _is_india(home)) else (home, away)
    ind_s = f"<i>{pretty_name(ind.get('Desc'))} (IND)</i>" if _is_india(ind) else \
            f"{pretty_name(ind.get('Desc'))} ({ind.get('Org')})"
    opp_s = f"<i>{pretty_name(opp.get('Desc'))} (IND)</i>" if _is_india(opp) else \
            f"{pretty_name(opp.get('Desc'))} ({opp.get('Org')})"
    return f"{rnd}  {ind_s} {_verb(ind, opp)} {opp_s} {ind.get('Res')}–{opp.get('Res')}"


def _schedule_line(m: dict, off) -> str:
    home, away = m.get("Home") or {}, m.get("Away") or {}
    _, rnd = _parse_desc(m.get("Desc", ""))
    t = _ist_clock(m, off)
    tcol = f"<b>{t}</b>  " if t else ""
    if m.get("IsTeam"):
        ind_t, opp_t = (home, away) if _is_india(home) else (away, home)
        return f"{tcol}{rnd}  <i>{ind_t.get('Desc')}</i> vs {opp_t.get('Desc')}"
    ind, opp = (away, home) if (_is_india(away) and not _is_india(home)) else (home, away)
    ind_s = f"<i>{pretty_name(ind.get('Desc'))} (IND)</i>" if _is_india(ind) else \
            f"{pretty_name(ind.get('Desc'))} ({ind.get('Org')})"
    opp_s = f"<i>{pretty_name(opp.get('Desc'))} (IND)</i>" if _is_india(opp) else \
            f"{pretty_name(opp.get('Desc'))} ({opp.get('Org')})"
    return f"{tcol}{rnd}  {ind_s} vs {opp_s}"


# ── Telegram ──────────────────────────────────────────────────────────────────

def tg_send(token, channel, text, dry_run):
    if dry_run:
        print("\n" + text + "\n" + "─" * 50)
        return
    try:
        r = requests.post(f"https://api.telegram.org/bot{token}/sendMessage",
                          json={"chat_id": channel, "text": text, "parse_mode": "HTML",
                                "disable_web_page_preview": True}, timeout=10)
        if r.status_code != 200:
            print(f"  [TG] HTTP {r.status_code}: {r.text[:200]}")
    except Exception as e:
        print(f"  [TG] error: {e}")


# ── Modes ──────────────────────────────────────────────────────────────────────

def _india_matches(event_id, day_raw, statuses):
    return [m for m in get_day(event_id, day_raw)
            if m.get("Status") in statuses and _involves_india(m)]


def run_live(event_ids, token, channel, db, dry_run):
    """Post each Indian result the first time it is seen finished (deduped).
    Scans only the venue's yesterday+today so re-runs stay cheap."""
    feed = "ittf-live"
    for eid in event_ids:
        name = event_name(eid, get_champ(eid))
        vt = venue_today(eid)
        items = []  # (day_raw, match)
        for day in [(vt - timedelta(days=1)).isoformat(), vt.isoformat()]:
            items += [(day, m) for m in _india_matches(eid, day, {ST_FINISHED})]
        keys = [f"{eid}:{m.get('Key')}" for _, m in items]
        sent = already_sent(db, feed, keys)
        new = [(d, m) for (d, m) in items if f"{eid}:{m.get('Key')}" not in sent]
        print(f"  [{eid}] {name}: {len(items)} finished India, {len(new)} new")
        for day, m in sorted(new, key=lambda x: (x[0], x[1].get("Key") or "")):
            label = datetime.fromisoformat(day).strftime("%a %d %b")
            tg_send(token, channel, f"<b>{name} — {label} — Live</b>\n\n{_match_block(m)}", dry_run)
            if not dry_run:
                mark_sent(db, feed, f"{eid}:{m.get('Key')}")


def run_recap(event_ids, token, channel, db, dry_run, target_date=None):
    """Post each COMPLETED venue-day's grouped summary once (deduped)."""
    feed = "ittf-recap"
    for eid in event_ids:
        champ = get_champ(eid)
        name  = event_name(eid, champ)
        vt    = venue_today(eid).isoformat()
        days  = [target_date] if target_date else \
                [d["raw"] for d in (champ or {}).get("dates", []) if d["raw"] <= vt]
        for day in days:
            fin     = _india_matches(eid, day, {ST_FINISHED})
            pending = _india_matches(eid, day, {ST_LIVE, ST_UPCOMING})
            if not fin or (pending and not target_date):
                continue                      # nothing, or day not finished yet
            key = f"{eid}:RECAP:{day}"
            if already_sent(db, feed, [key]):
                continue
            blocks = _grouped(name, day, fin, "Recap", _match_block)
            print(f"  [{eid}] recap {day}: {len(fin)} India result(s)")
            for b in blocks:
                tg_send(token, channel, b, dry_run)
            if not dry_run:
                mark_sent(db, feed, key)


def run_schedule(event_ids, token, channel, db, dry_run, target_date=None):
    """Post a venue-day's upcoming Indian matches once (deduped), times in IST."""
    feed = "ittf-schedule"
    for eid in event_ids:
        champ = get_champ(eid)
        name  = event_name(eid, champ)
        off   = venue_offset(eid)
        day   = target_date or venue_today(eid).isoformat()
        upc   = _india_matches(eid, day, {ST_LIVE, ST_UPCOMING})
        if not upc:
            print(f"  [{eid}] no upcoming India matches for {day}")
            continue
        key = f"{eid}:SCHED:{day}"
        if already_sent(db, feed, [key]):
            print(f"  [{eid}] schedule for {day} already sent")
            continue
        note = "times in IST" if off is not None else "times in venue local time"
        blocks = _grouped(name, day, upc, "Schedule",
                          lambda m: _schedule_line(m, off), subtitle=note)
        for b in blocks:
            tg_send(token, channel, b, dry_run)
        if not dry_run:
            mark_sent(db, feed, key)


def _grouped(name, day_raw, matches, label, line_fn, subtitle=None):
    grouped = {}
    for m in matches:
        sub, _ = _parse_desc(m.get("Desc", ""))
        grouped.setdefault(sub, []).append(m)
    date_label = datetime.fromisoformat(day_raw).strftime("%a %d %b")
    head = f"<b>{name} — India — {date_label} — {label}</b>"
    if subtitle:
        head += f"\n{subtitle} · {len(matches)} match{'es' if len(matches) != 1 else ''}"
    body, LIMIT = [], 3500
    segs = ["\n".join([f"<u>{sub}</u>"] + [line_fn(m) for m in ms]) for sub, ms in grouped.items()]
    # pack into <=LIMIT messages, first carries the header
    cur = head
    for seg in segs:
        if len(cur) + len(seg) + 2 > LIMIT:
            body.append(cur); cur = seg
        else:
            cur += "\n\n" + seg
    body.append(cur)
    return body


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--event",   type=int, default=None)
    ap.add_argument("--auto",    action="store_true")
    ap.add_argument("--mode",    choices=["recap", "schedule", "live"], default="recap")
    ap.add_argument("--date",    default=None, help="YYYY-MM-DD (recap/schedule day override)")
    ap.add_argument("--window",  type=int, default=2, help="±days around event for --auto")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.auto and args.event is None:
        ap.error("provide --event <id>  or  --auto")

    if args.auto:
        today = date.today()
        event_ids = [eid for eid, (_, s, e, _tz) in ITTF_EVENTS.items()
                     if date.fromisoformat(s) - timedelta(days=args.window) <= today
                     <= date.fromisoformat(e) + timedelta(days=args.window)]
    else:
        event_ids = [args.event]

    token   = os.environ.get("TELEGRAM_BOT_TOKEN")
    channel = os.environ.get("TELEGRAM_CHANNEL_ID")
    if not args.dry_run and (not token or not channel):
        print("  [!] Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID")
        return
    if not event_ids:
        print("  No active ITTF/ATTU events in window.")
        return

    db = None if args.dry_run else get_db()
    if not args.dry_run and db is None:
        print("  [!] No Supabase — dedup disabled; refusing to post to avoid duplicates.")
        return

    print(f"  Mode={args.mode}  events={event_ids}")
    if args.mode == "recap":
        run_recap(event_ids, token, channel, db, args.dry_run, args.date)
    elif args.mode == "schedule":
        run_schedule(event_ids, token, channel, db, args.dry_run, args.date)
    else:
        run_live(event_ids, token, channel, db, args.dry_run)
    print("Done.")


if __name__ == "__main__":
    main()
