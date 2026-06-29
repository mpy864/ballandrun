#!/usr/bin/env python3
"""
ittf_feed.py — Telegram recap for ITTF / ATTU events (results.ittf.com).

These continental / ITTF events are NOT on the WTT API, so the WTT bots can't
see them. This reads the open ITTF results JSON (Bornan/Azure) directly:

  champ.json                  -> config: sub-events, dates, live status
  match/d<YYYY-MM-DD>.json     -> a day's matches (scheduled / live / finished)
  match/live.json              -> currently-live matches

It posts ONE India-focused recap message per event for the most recent
completed day. TEAM ties are expanded into their individual rubbers
(SubMatches). No model predictions (youth players aren't in the model).

Usage
-----
  python scripts/ittf_feed.py --auto --dry-run
  python scripts/ittf_feed.py --event 3472
  python scripts/ittf_feed.py --event 3472 --date 2026-06-29 --dry-run
"""

import os, sys, argparse, requests
from datetime import date, datetime, timedelta

# ── ITTF / ATTU events (self-contained so this script needs no DB) ─────────────
# id: (name, start, end).  Mirror of the Asian/ITTF block in fetch_ittf_matches.py.
ITTF_EVENTS = {
    3379: ("ITTF World Cup Macao 2026",                              "2026-03-30", "2026-04-05"),
    3216: ("ITTF World Team Championships London 2026",              "2026-04-28", "2026-05-10"),
    3377: ("ITTF World Youth Championships 2026",                    "2026-11-21", "2026-11-28"),
    3378: ("ITTF Mixed Team World Cup Chengdu 2026",                 "2026-11-29", "2026-12-06"),
    3471: ("ITTF-ATTU Asian Cup Haikou 2026",                        "2026-02-04", "2026-02-08"),
    3472: ("ITTF-ATTU Asian Youth Championships Bangkok 2026",       "2026-06-28", "2026-07-04"),
    3473: ("Asian Games Nagoya 2026",                                "2026-09-20", "2026-09-28"),
    3474: ("ITTF-ATTU Asian Championships Tashkent 2026",            "2026-10-12", "2026-10-25"),
    3475: ("ITTF-ATTU South East Asian Youth Championships 2026",    "2026-04-14", "2026-04-19"),
    3498: ("ITTF-ATTU Central Asia Youth Championships Almaty 2026", "2026-04-03", "2026-04-05"),
    3499: ("ITTF-ATTU West Asia Youth Championships Amman 2026",     "2026-06-01", "2026-06-01"),
    3500: ("ITTF-ATTU South Asia Youth Championships Shimla 2026",   "2026-04-08", "2026-04-11"),
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
        # ITTF blobs are UTF-8 with BOM
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
    """De-shout 'CHATTOPADHAYAY Rishaan' -> 'Chattopadhayay Rishaan'."""
    return " ".join(p.title() if p.isupper() else p for p in (name or "").split())


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


def _played(side_a: dict, side_b: dict) -> bool:
    if side_a.get("Win") or side_b.get("Win"):
        return True
    return str(side_a.get("Res") or "0") not in ("", "0") or \
           str(side_b.get("Res") or "0") not in ("", "0")


def _games(side: dict) -> int:
    try:
        return int(side.get("Res") or 0)
    except (ValueError, TypeError):
        return 0


def _verb(winner_side: dict, loser_side: dict) -> str:
    """Verb from the first side's perspective, decided by games won (the
    rubber-level Win flag is unreliable)."""
    a, b = _games(winner_side), _games(loser_side)
    return "def." if a > b else ("lost to" if b > a else "drew")


# ── Build one match's recap text ───────────────────────────────────────────────

def _rubber_line(sm: dict) -> str | None:
    h, a = sm.get("Home") or {}, sm.get("Away") or {}
    if not _played(h, a):
        return None
    # India player first
    if _is_india(a) and not _is_india(h):
        ind, opp = a, h
    else:
        ind, opp = h, a
    verb  = _verb(ind, opp)
    score = f"{ind.get('Res')}–{opp.get('Res')}"
    ind_s = f"<i>{pretty_name(ind.get('Desc'))}</i>" if _is_india(ind) else pretty_name(ind.get("Desc"))
    opp_s = f"<i>{pretty_name(opp.get('Desc'))}</i>" if _is_india(opp) else pretty_name(opp.get("Desc"))
    return f"   • {ind_s} {verb} {opp_s} {score}"


def _match_block(m: dict) -> str:
    home, away = m.get("Home") or {}, m.get("Away") or {}
    _, rnd = _parse_desc(m.get("Desc", ""))

    if m.get("IsTeam"):
        # India-first team headline
        if _is_india(home):
            ind_t, opp_t = home, away
        else:
            ind_t, opp_t = away, home
        head = (f"{rnd}  <i>{ind_t.get('Desc')}</i> "
                f"{ind_t.get('Res')}–{opp_t.get('Res')} {opp_t.get('Desc')}")
        lines = [head]
        for sm in (m.get("SubMatches") or []):
            ln = _rubber_line(sm)
            if ln:
                lines.append(ln)
        return "\n".join(lines)

    # Singles / doubles
    if _is_india(away) and not _is_india(home):
        ind, opp = away, home
    else:
        ind, opp = home, away
    verb  = _verb(ind, opp)
    score = f"{ind.get('Res')}–{opp.get('Res')}"
    ind_s = f"<i>{pretty_name(ind.get('Desc'))} (IND)</i>" if _is_india(ind) else \
            f"{pretty_name(ind.get('Desc'))} ({ind.get('Org')})"
    opp_s = f"<i>{pretty_name(opp.get('Desc'))} (IND)</i>" if _is_india(opp) else \
            f"{pretty_name(opp.get('Desc'))} ({opp.get('Org')})"
    return f"{rnd}  {ind_s} {verb} {opp_s} {score}"


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


# ── Recap for one event ─────────────────────────────────────────────────────────

def build_event_recap(event_id, target_date=None):
    """Return (message_blocks, date_label) for the most recent completed day
    with Indian results, or (None, None) if nothing."""
    champ = get_champ(event_id)
    if not champ:
        return None, None
    name = champ.get("champDesc") or ITTF_EVENTS.get(event_id, (f"Event {event_id}",))[0]

    # Recap exactly one day: explicit --date, else today (UTC). Locking to a
    # single day avoids re-posting an older day on rest days / after the event.
    candidates = [target_date or date.today().isoformat()]

    for day_raw in candidates:
        matches = get_day(event_id, day_raw)
        india = [m for m in matches
                 if m.get("Status") == ST_FINISHED
                 and (_is_india(m.get("Home") or {}) or _is_india(m.get("Away") or {}))]
        if not india:
            continue

        # Group by sub-event
        grouped = {}
        for m in india:
            sub, _ = _parse_desc(m.get("Desc", ""))
            grouped.setdefault(sub, []).append(m)

        date_label = datetime.fromisoformat(day_raw).strftime("%a %d %b")
        head = f"<b>{name} — India — {date_label} — Recap</b>"
        body = []
        for sub, ms in grouped.items():
            seg = [f"<u>{sub}</u>"] + [_match_block(m) for m in ms]
            body.append("\n".join(seg))
        return [head + "\n\n" + body[0]] + body[1:], date_label

    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--event",   type=int, default=None)
    ap.add_argument("--auto",    action="store_true")
    ap.add_argument("--date",    default=None, help="YYYY-MM-DD (override recap day)")
    ap.add_argument("--window",  type=int, default=2, help="±days around today for --auto")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.auto and args.event is None:
        ap.error("provide --event <id>  or  --auto")

    if args.auto:
        today = date.today()
        event_ids = [eid for eid, (_, s, e) in ITTF_EVENTS.items()
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

    for eid in event_ids:
        name = ITTF_EVENTS.get(eid, (f"Event {eid}",))[0]
        print(f"{'='*56}\n  {name}  ({eid})\n{'='*56}")
        blocks, day = build_event_recap(eid, args.date)
        if not blocks:
            print("  No Indian results found for a recent day.")
            continue
        print(f"  Recap for {day}: {len(blocks)} message block(s).")
        _send_chunked(tg_token, tg_channel, blocks, args.dry_run)

    print("\nDone.")


if __name__ == "__main__":
    main()
