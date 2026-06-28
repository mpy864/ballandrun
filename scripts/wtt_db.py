"""
wtt_db.py — Persist simulator output to Supabase (M1).

Pushes per-competitor forecasts to `wtt_forecasts` (and optionally entries to
`wtt_entries`).  Used by simulate_event.py --push.  Requires SUPABASE_URL and
SUPABASE_SERVICE_KEY in the environment.
"""

from __future__ import annotations

import os


def _client():
    from supabase import create_client
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(url, key)


def _qkey(comp) -> str:
    ids = [str(i) for i in comp.player_ids if i is not None and i < 1_000_000]
    return "_".join(ids) if ids else f"slot:{comp.uid}"


def push_forecasts(event_id, sub_event, draw, stats, comp_by_uid, labels,
                   tier, runs, provisional=True, client=None) -> int:
    """Upsert one forecast row per competitor.  Returns rows written."""
    sb = client or _client()
    rows = []
    for uid, c in comp_by_uid.items():
        s = stats[uid]
        rows.append({
            "event_id": event_id,
            "sub_event": sub_event,
            "discipline": draw.discipline,
            "tier": tier,
            "qkey": _qkey(c),
            "label": " / ".join(c.names) if c.names else "TBD",
            "seed": int(c.seed or 0),
            "p_title": round(s["title"], 6),
            "reach": {k: round(v, 6) for k, v in s["reach"].items()},
            "runs": runs,
            "is_provisional": provisional,
        })
    for i in range(0, len(rows), 500):
        sb.table("wtt_forecasts").upsert(
            rows[i:i + 500], on_conflict="event_id,sub_event,qkey").execute()
    return len(rows)


def push_entries(event_id, sub_event, draw, client=None) -> int:
    """Upsert the entry list (real players only) for a sub-event."""
    sb = client or _client()
    rows = []
    seen = set()
    for a, b in draw.matches:
        for c in (a, b):
            for pid in c.player_ids:
                if pid is None or pid >= 1_000_000 or pid in seen:
                    continue
                seen.add(pid)
                rows.append({
                    "event_id": event_id,
                    "sub_event": sub_event,
                    "discipline": draw.discipline,
                    "player_id": pid,
                    "player_name": " / ".join(c.names) if c.names else None,
                    "org": c.org,
                    "seed": int(c.seed or 0),
                    "is_qualifier": bool(c.is_qualifier),
                })
    for i in range(0, len(rows), 500):
        sb.table("wtt_entries").upsert(
            rows[i:i + 500], on_conflict="event_id,sub_event,player_id").execute()
    return len(rows)
