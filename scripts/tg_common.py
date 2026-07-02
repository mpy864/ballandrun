#!/usr/bin/env python3
"""
tg_common.py — shared plumbing for every Telegram feed (WTT + ITTF).

One place for the cross-cutting concerns that were previously re-implemented
(and re-broken) in each script:

  • Telegram sending (with dry-run)
  • De-duplication via Supabase `tg_sent(feed, item_key)`  — never post twice
  • Health / heartbeat via Supabase `feed_health(feed, ...)` — so a watchdog can
    tell when a feed goes silent or errors (the thing nobody could see before)
  • Name / round / India formatting helpers used by both systems

Import this everywhere instead of copy-pasting. If Supabase creds are missing,
dedup + health degrade gracefully (used for local --dry-run).
"""

import os, requests
from datetime import datetime, timezone, timedelta

IST = timezone(timedelta(hours=5, minutes=30))


# ── Supabase ───────────────────────────────────────────────────────────────────

def get_db():
    try:
        from supabase import create_client
        url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
        if url and key:
            return create_client(url, key)
    except Exception as e:
        print(f"  [tg_common] supabase unavailable: {e}")
    return None


# ── De-duplication (tg_sent) ────────────────────────────────────────────────────

def already_sent(db, feed, keys):
    """Return the subset of `keys` already recorded as sent for `feed`."""
    if not db or not keys:
        return set()
    keys = list(keys)
    out = set()
    try:
        for i in range(0, len(keys), 100):
            r = db.table("tg_sent").select("item_key").eq("feed", feed) \
                  .in_("item_key", keys[i:i + 100]).execute()
            out |= {row["item_key"] for row in (r.data or [])}
    except Exception as e:
        print(f"  [tg_common] dedup read error: {e}")
    return out


def mark_sent(db, feed, key):
    if not db:
        return
    try:
        db.table("tg_sent").upsert({"feed": feed, "item_key": key}).execute()
    except Exception as e:
        print(f"  [tg_common] dedup write error: {e}")


# ── Health / heartbeat (feed_health) ────────────────────────────────────────────

def record_health(db, feed, status, detail="", posts=0):
    """status: 'ok' | 'error' | 'noop'. Called at the end of every feed run so a
    watchdog can detect silence or failure."""
    if not db:
        return
    now = datetime.now(timezone.utc).isoformat()
    row = {"feed": feed, "last_run_at": now, "last_status": status,
           "last_detail": (detail or "")[:500], "posts_last_run": posts,
           "updated_at": now}
    if status == "ok":
        row["last_ok_at"] = now
    if posts > 0:
        row["last_post_at"] = now
    try:
        db.table("feed_health").upsert(row).execute()
    except Exception as e:
        print(f"  [tg_common] health write error: {e}")


# ── Telegram ──────────────────────────────────────────────────────────────────

def tg_send(token, channel, text, dry_run=False):
    """Send one HTML message. Returns True on success (or dry-run)."""
    if dry_run:
        print("\n" + text + "\n" + "─" * 50)
        return True
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": channel, "text": text, "parse_mode": "HTML",
                  "disable_web_page_preview": True}, timeout=10)
        if r.status_code != 200:
            print(f"  [TG] HTTP {r.status_code}: {r.text[:200]}")
            return False
        return True
    except Exception as e:
        print(f"  [TG] error: {e}")
        return False


# ── Shared formatting ───────────────────────────────────────────────────────────

def pretty_name(name: str) -> str:
    """De-shout 'GHORPADE Yashaswini' -> 'Ghorpade Yashaswini', keeping order.
    Handles doubles pairs 'A SURNAME/B SURNAME' across the slash."""
    def fix(part):
        return " ".join(w.title() if w.isupper() else w for w in part.split())
    if "/" in (name or ""):
        return "/".join(fix(p.strip()) for p in name.split("/"))
    return fix(name or "")


def round_short(round_txt: str) -> str:
    import re
    txt = re.sub(r"\s*-\s*Match\s*\d+$", "", round_txt or "", flags=re.IGNORECASE).strip()
    low = txt.lower()
    if "qualif" in low:
        m = re.search(r"(\d+)", low)
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
    return txt or "—"


def fmt_player(name, org, rank, is_india, deshout=True):
    """Uniform 'Name (ORG, rank)' — India italic + IND; no '#'."""
    pretty = pretty_name(name) if deshout else name
    o = "IND" if is_india else (org or "")
    bits = ([o] if o else []) + ([str(rank)] if rank else [])
    paren = f" ({', '.join(bits)})" if bits else ""
    return f"<i>{pretty}{paren}</i>" if is_india else f"{pretty}{paren}"
