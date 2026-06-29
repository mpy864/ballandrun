#!/usr/bin/env python3
"""
daily_recap.py — Post ONE end-of-day summary of the day's matches to Telegram.

Unlike send_todays_results.py (which posts each result separately), this builds a
single roundup message: the day's Indian-player results plus all key rounds
(Quarterfinals / Semifinals / Finals), grouped by event and discipline, with a
"model went X/Y correct today" line at the end.

Meant to run once early each morning (IST) as the day recap.

Usage
-----
  python scripts/daily_recap.py --auto --db
  python scripts/daily_recap.py --event 3242 --db
  python scripts/daily_recap.py --auto --db --dry-run
"""

import os, sys, argparse, requests
from datetime import datetime, date, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))

# Windows consoles default to cp1252 and choke on emoji/en-dash when printing
# dry-run output. Harmless no-op on Linux (GitHub Actions) where stdout is UTF-8.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from feature_model import MatchPredictor
from send_todays_results import (
    fetch_todays_results, _is_key_round, fetch_player_info,
    fetch_event_name, _parse_disc_round, pretty_name,
)

try:
    from supabase import create_client as _sb_create
except ImportError:
    _sb_create = None


# ── Round shorthand ───────────────────────────────────────────────────────────

def _round_abbr(round_text: str) -> str:
    import re
    txt = re.sub(r'\s*-\s*Match\s*\d+$', '', round_text, flags=re.IGNORECASE).strip()
    low = txt.lower()
    if "qualif" in low:                       # "Qualifying Round 2" -> "Qual R2"
        m = re.search(r'(\d+)', low)
        return f"Qual R{m.group(1)}" if m else "Qual"
    if "final" in low and "semi" not in low and "quarter" not in low:
        return "Final"
    if "semi" in low:
        return "SF"
    if "quarter" in low:
        return "QF"
    if "round of 16" in low or "r16" in low:
        return "R16"
    if "round of 32" in low or "r32" in low:
        return "R32"
    if "round of 64" in low or "r64" in low:
        return "R64"
    return txt or "—"


# ── One-line result formatter (winner first; India italic) ────────────────────

def _recap_line(m: dict, info_map: dict) -> str:
    result = m["result"]                       # "W" => name1 won
    if result == "W":
        w_name, w_id, w_org = m["name1"], m["id1"], m["org1"]
        l_name, l_id, l_org = m["name2"], m["id2"], m["org2"]
        parts = m["overall"].split("-")
    else:
        w_name, w_id, w_org = m["name2"], m["id2"], m["org2"]
        l_name, l_id, l_org = m["name1"], m["id1"], m["org1"]
        parts = m["overall"].split("-")[::-1]   # flip so winner's games first

    try:
        g1, g2 = int(parts[0]), int(parts[1])
        score = f"{g1}–{g2}"               # en dash
    except (ValueError, IndexError):
        score = m["overall"]

    def tag(name, org, ittf_id):
        is_ind = (org == "IND")
        rank   = (info_map.get(ittf_id) or {}).get("rank")
        o      = "IND" if is_ind else (org or "")
        bits   = ([o] if o else []) + ([str(rank)] if rank else [])
        paren  = f" ({', '.join(bits)})" if bits else ""
        pretty = pretty_name(name)
        return f"<i>{pretty}{paren}</i>" if is_ind else f"{pretty}{paren}"

    rnd = _round_abbr(_parse_disc_round(m["round"])[1])
    return f"• {rnd}  {tag(w_name, w_org, w_id)} def. {tag(l_name, l_org, l_id)}  {score}"


# ── Telegram ──────────────────────────────────────────────────────────────────

def tg_send(token: str, channel: str, text: str):
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": channel, "text": text, "parse_mode": "HTML",
                  "disable_web_page_preview": True},
            timeout=10,
        )
        if r.status_code != 200:
            print(f"  [TG] HTTP {r.status_code}: {r.text[:200]}")
    except Exception as e:
        print(f"  [TG] error: {e}")


def _send_chunked(token, channel, header, blocks, footer, dry_run):
    """Join blocks under one header; split into multiple messages if too long."""
    LIMIT = 3500
    chunks, cur = [], header
    for b in blocks:
        if len(cur) + len(b) + 2 > LIMIT:
            chunks.append(cur)
            cur = header + "\n(continued)\n\n" + b
        else:
            cur += "\n\n" + b
    chunks.append(cur)
    if footer:
        chunks[-1] += "\n\n" + footer

    for c in chunks:
        if dry_run:
            print("\n" + c + "\n" + "─" * 50)
        else:
            tg_send(token, channel, c)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--event",    type=int, default=None)
    ap.add_argument("--auto",     action="store_true")
    ap.add_argument("--lookback", type=int, default=7)
    ap.add_argument("--db",       action="store_true")
    ap.add_argument("--dry-run",  action="store_true")
    args = ap.parse_args()

    if not args.auto and args.event is None:
        ap.error("provide --event <id>  or  --auto")

    # Event IDs
    from fetch_matches import WTT_2026_EVENT_IDS
    if args.auto:
        today = date.today()
        event_ids = [
            eid for eid, (_, end) in WTT_2026_EVENT_IDS.items()
            if today - timedelta(days=args.lookback) <= date.fromisoformat(end) <= today + timedelta(days=args.lookback)
        ]
    else:
        event_ids = [args.event]

    # DB
    db = None
    if args.db and _sb_create:
        try:
            db = _sb_create(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
            print("  [DB] Connected")
        except Exception as e:
            print(f"  [DB] {e}")

    # Telegram
    tg_token   = os.environ.get("TELEGRAM_BOT_TOKEN")
    tg_channel = os.environ.get("TELEGRAM_CHANNEL_ID")
    if not args.dry_run and (not tg_token or not tg_channel):
        print("  [!] Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID in .env")
        return

    # Models (for prediction tally)
    mp = {}
    for g in ("M", "W"):
        try:
            mp[g] = MatchPredictor.load(g)
        except FileNotFoundError:
            print(f"  [!] No {g} model")

    # Collect the day's relevant matches, grouped by event -> discipline
    grouped: dict[str, dict[str, list[dict]]] = {}
    correct = total = 0

    for eid in event_ids:
        matches = fetch_todays_results(eid)
        if not matches:
            continue

        all_ids = set()
        for m in matches:
            all_ids.update([m["id1"], m["id2"]])
        info_map = fetch_player_info(db, list(all_ids))
        ename    = fetch_event_name(db, eid) or WTT_2026_EVENT_IDS.get(eid, (f"Event {eid}",))[0]

        for m in matches:
            is_india = (m["org1"] == "IND" or m["org2"] == "IND")
            if not is_india and not _is_key_round(m["round"]):
                continue

            disc, _ = _parse_disc_round(m["round"])
            grouped.setdefault(ename, {}).setdefault(disc, []).append(
                (m, info_map)
            )

            # Prediction tally (singles only)
            if not m["is_doubles"]:
                try:
                    key = "W" if "Women" in m["round"] else "M"
                    pred = mp.get(key) or (next(iter(mp.values())) if mp else None)
                    if pred:
                        p = pred.predict_score(m["id1"], m["id2"])["p_match"]
                        if p != 0.5:
                            total += 1
                            if (p > 0.5) == (m["result"] == "W"):
                                correct += 1
                except Exception:
                    pass

    if not grouped:
        print("  No Indian or key-round results today — nothing to recap.")
        return

    # Build the message
    ist_date = (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).strftime("%d %b %Y")
    header   = f"\U0001F3D3 <b>WTT Day Recap</b> · {ist_date}"

    blocks = []
    for ename, by_disc in grouped.items():
        lines = [f"<b>{ename}</b>"]
        for disc, items in by_disc.items():
            lines.append(f"<u>{disc}</u>")
            for m, info_map in items:
                lines.append(_recap_line(m, info_map))
        blocks.append("\n".join(lines))

    footer = f"Model called <b>{correct}/{total}</b> correct today." if total else ""

    _send_chunked(tg_token, tg_channel, header, blocks, footer, args.dry_run)
    print(f"\nDone. Recap for {len(grouped)} event(s), tally {correct}/{total}.")


if __name__ == "__main__":
    main()
