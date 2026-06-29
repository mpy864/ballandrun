#!/usr/bin/env python3
"""
ittf_feed.py — Telegram feed for ITTF / ATTU events (results.ittf.com).

These continental / ITTF events are NOT on the WTT API, so the WTT bots can't
see them. This reads the open ITTF results JSON (Bornan/Azure) directly:

  champ.json                   -> config: sub-events, dates, live status
  match/d<YYYY-MM-DD>.json      -> a day's matches (scheduled / live / finished)
  match/live.json               -> currently-live matches

Three modes (India-focused, no model predictions — youth players aren't in the
model). TEAM ties are expanded into their individual rubbers (SubMatches):

  recap     (default) ONE message: today's completed Indian results.
  schedule            ONE message: today's upcoming Indian matches, times in IST.
  live                long-running poll: posts each Indian result as it finishes.

Usage
-----
  python scripts/ittf_feed.py --auto --mode recap    --dry-run
  python scripts/ittf_feed.py --auto --mode schedule --dry-run
  python scripts/ittf_feed.py --auto --mode live --interval 60
  python scripts/ittf_feed.py --event 3472 --date 2026-06-29 --dry-run
"""

import os, sys, time, argparse, requests
from datetime import date, datetime, timedelta

# ── ITTF / ATTU events: id -> (name, start, end, venue_utc_offset|None) ────────
# venue_utc_offset converts the feed's local match times to IST for --mode schedule.
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

# Status codes (from champ.json): 1 = Finished, 2 = Live, 4 = Upcoming
ST_FINISHED, ST_LIVE, ST_UPCOMING = 1, 2, 4

try:
    sys.stdout.reconfigure(encoding="utf-8")   # Windows console safety
except Exception:
    pass


# ── Fetch helpers ──────────────────────────────────────────────────────────────

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


# ── Formatting helpers ───────────────────────────────────────────────────────

def pretty_name(name: str) -> str:
    """De-shout 'CHATTOPADHAYAY Rishaan' -> 'Chattopadhayay Rishaan'.
    Handles doubles pairs 'A SURNAME/B SURNAME' across the slash."""
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
    """'U15 Boys' Teams - Round of 16 - Match 7' -> ('U15 Boys' Teams', 'R16')."""
    parts = [p.strip() for p in (desc or "").split(" - ")]
    sub  = parts[0] if parts else desc
    rnd  = _round_short(parts[1]) if len(parts) >= 2 else ""
    return sub, rnd


def _is_india(side: dict) -> bool:
    return (side.get("Org") or "") == "IND"


def _involves_india(m: dict) -> bool:
    return _is_india(m.get("Home") or {}) or _is_india(m.get("Away") or {})


def _games(side: dict) -> int:
    try:
        return int(side.get("Res") or 0)
    except (ValueError, TypeError):
        return 0


def _played(side_a: dict, side_b: dict) -> bool:
    if side_a.get("Win") or side_b.get("Win"):
        return True
    return _games(side_a) > 0 or _games(side_b) > 0


def _verb(first: dict, second: dict) -> str:
    """Result verb from the first side's perspective, by games won (the
    rubber-level Win flag is unreliable)."""
    a, b = _games(first), _games(second)
    return "def." if a > b else ("lost to" if b > a else "drew")


def _ist_clock(m: dict, tz_offset) -> str:
    """Convert the feed's local match time to an IST HH:MM, or '' if unknown."""
    if tz_offset is None:
        return ""
    hhmm = (m.get("RTime") or "").strip()
    if not hhmm and "," in (m.get("Time") or ""):
        hhmm = m["Time"].split(",")[-1].strip()
    try:
        h, mi = (int(x) for x in hhmm.split(":")[:2])
    except (ValueError, AttributeError):
        return ""
    total = (h * 60 + mi - int(tz_offset * 60) + 330) % 1440   # local -> IST
    return f"{total // 60:02d}:{total % 60:02d}"


# ── Result block (recap / live) ─────────────────────────────────────────────────

def _rubber_line(sm: dict) -> str | None:
    h, a = sm.get("Home") or {}, sm.get("Away") or {}
    if not _played(h, a):
        return None
    if _is_india(a) and not _is_india(h):
        ind, opp = a, h
    else:
        ind, opp = h, a
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
        lines = [head] + [ln for sm in (m.get("SubMatches") or [])
                          if (ln := _rubber_line(sm))]
        return "\n".join(lines)

    ind, opp = (away, home) if (_is_india(away) and not _is_india(home)) else (home, away)
    ind_s = f"<i>{pretty_name(ind.get('Desc'))} (IND)</i>" if _is_india(ind) else \
            f"{pretty_name(ind.get('Desc'))} ({ind.get('Org')})"
    opp_s = f"<i>{pretty_name(opp.get('Desc'))} (IND)</i>" if _is_india(opp) else \
            f"{pretty_name(opp.get('Desc'))} ({opp.get('Org')})"
    return f"{rnd}  {ind_s} {_verb(ind, opp)} {opp_s} {ind.get('Res')}–{opp.get('Res')}"


def _schedule_line(m: dict, tz_offset) -> str:
    home, away = m.get("Home") or {}, m.get("Away") or {}
    _, rnd = _parse_desc(m.get("Desc", ""))
    t = _ist_clock(m, tz_offset)
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

def tg_send(token, channel, text):
    try:
        r = requests.post(f"https://api.telegram.org/bot{token}/sendMessage",
                          json={"chat_id": channel, "text": text, "parse_mode": "HTML",
                                "disable_web_page_preview": True}, timeout=10)
        if r.status_code != 200:
            print(f"  [TG] HTTP {r.status_code}: {r.text[:200]}")
    except Exception as e:
        print(f"  [TG] error: {e}")


def _send_chunked(token, channel, blocks, dry_run):
    LIMIT, chunks, cur = 3500, [], ""
    for b in blocks:
        if cur and len(cur) + len(b) + 2 > LIMIT:
            chunks.append(cur); cur = b
        else:
            cur = (cur + "\n\n" + b) if cur else b
    if cur:
        chunks.append(cur)
    for c in chunks:
        if dry_run:
            print("\n" + c + "\n" + "─" * 50)
        else:
            tg_send(token, channel, c)


# ── Per-event builders ──────────────────────────────────────────────────────────

def _event_name(event_id, champ=None):
    return (champ or {}).get("champDesc") or ITTF_EVENTS.get(event_id, (f"Event {event_id}",))[0]


def build_recap(event_id, target_date=None):
    """ONE message: completed Indian results for a single day (today by default)."""
    champ = get_champ(event_id)
    name  = _event_name(event_id, champ)
    day_raw = target_date or date.today().isoformat()
    matches = get_day(event_id, day_raw)
    india = [m for m in matches if m.get("Status") == ST_FINISHED and _involves_india(m)]
    if not india:
        return None
    return _grouped_message(name, day_raw, india, "Recap", _match_block)


def build_schedule(event_id, target_date=None):
    """ONE message: today's upcoming/live Indian matches, times in IST."""
    champ = get_champ(event_id)
    name  = _event_name(event_id, champ)
    tz    = ITTF_EVENTS.get(event_id, (None, None, None, None))[3]
    day_raw = target_date or date.today().isoformat()
    matches = get_day(event_id, day_raw)
    india = [m for m in matches if m.get("Status") in (ST_LIVE, ST_UPCOMING) and _involves_india(m)]
    if not india:
        return None
    tz_note = "times in IST" if tz is not None else "times in venue local time"
    return _grouped_message(name, day_raw, india, "Schedule",
                            lambda m: _schedule_line(m, tz), subtitle=tz_note)


def _grouped_message(name, day_raw, india_matches, label, line_fn, subtitle=None):
    grouped = {}
    for m in india_matches:
        sub, _ = _parse_desc(m.get("Desc", ""))
        grouped.setdefault(sub, []).append(m)
    date_label = datetime.fromisoformat(day_raw).strftime("%a %d %b")
    head = f"<b>{name} — India — {date_label} — {label}</b>"
    if subtitle:
        head += f"\n{subtitle} · {len(india_matches)} match{'es' if len(india_matches) != 1 else ''}"
    body = []
    for sub, ms in grouped.items():
        body.append("\n".join([f"<u>{sub}</u>"] + [line_fn(m) for m in ms]))
    return [head + "\n\n" + body[0]] + body[1:]


# ── Live poll ────────────────────────────────────────────────────────────────

def run_live(event_ids, token, channel, interval, duration_min, dry_run):
    """Poll each event's day feed; post each Indian result the first time it is
    seen finished after start. Baselining already-finished ties on start prevents
    re-posting after a workflow restart."""
    deadline = time.time() + duration_min * 60
    today = date.today().isoformat()
    posted = {eid: {m.get("Key") for m in get_day(eid, today)
                    if m.get("Status") == ST_FINISHED and _involves_india(m)}
              for eid in event_ids}
    print(f"  [live] baseline finished India ties: "
          + ", ".join(f"{eid}:{len(v)}" for eid, v in posted.items()))

    while time.time() < deadline:
        for eid in event_ids:
            name = _event_name(eid)
            for m in get_day(eid, today):
                if m.get("Status") != ST_FINISHED or not _involves_india(m):
                    continue
                key = m.get("Key")
                if key in posted[eid]:
                    continue
                _, rnd = _parse_desc(m.get("Desc", ""))
                date_label = datetime.now().strftime("%a %d %b")
                msg = f"<b>{name} — {date_label} — Live</b>\n\n{_match_block(m)}"
                if dry_run:
                    print("\n" + msg + "\n" + "─" * 50)
                else:
                    tg_send(token, channel, msg)
                posted[eid].add(key)
                time.sleep(0.4)
        time.sleep(interval)
    print("  [live] window ended.")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--event",    type=int, default=None)
    ap.add_argument("--auto",     action="store_true")
    ap.add_argument("--mode",     choices=["recap", "schedule", "live"], default="recap")
    ap.add_argument("--date",     default=None, help="YYYY-MM-DD (recap/schedule day)")
    ap.add_argument("--window",   type=int, default=2, help="±days around event for --auto")
    ap.add_argument("--interval", type=float, default=60, help="live poll seconds")
    ap.add_argument("--duration", type=int, default=300, help="live run minutes")
    ap.add_argument("--dry-run",  action="store_true")
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

    tg_token   = os.environ.get("TELEGRAM_BOT_TOKEN")
    tg_channel = os.environ.get("TELEGRAM_CHANNEL_ID")
    if not args.dry_run and (not tg_token or not tg_channel):
        print("  [!] Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID")
        return

    if not event_ids:
        print("  No active ITTF/ATTU events in window.")
        return

    if args.mode == "live":
        print(f"  Live mode for events: {event_ids}")
        run_live(event_ids, tg_token, tg_channel, args.interval, args.duration, args.dry_run)
        return

    builder = build_recap if args.mode == "recap" else build_schedule
    for eid in event_ids:
        print(f"{'='*56}\n  {_event_name(eid)}  ({eid})\n{'='*56}")
        blocks = builder(eid, args.date)
        if not blocks:
            print(f"  No Indian {args.mode} items for the day.")
            continue
        print(f"  {len(blocks)} message block(s).")
        _send_chunked(tg_token, tg_channel, blocks, args.dry_run)
    print("\nDone.")


if __name__ == "__main__":
    main()
