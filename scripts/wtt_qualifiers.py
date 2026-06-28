"""
wtt_qualifiers.py — Resolve real qualifiers and slot them into the main draw.

Qualifying winners aren't always pushed into the main-draw display immediately,
but the results exist in GetOfficialResult.  This module:
  - reads the winners of the LAST qualifying round per sub-event, and
  - fills the main-draw "Qualifier N" placeholder slots with those real players.

Only decided matches are used, so it degrades gracefully while qualifying is
still in progress (undecided slots stay as generic placeholders).
"""

from __future__ import annotations

import re
import requests

_RESULTS_URL = ("https://wtt-website-live-events-api-prod-cmfzgabgbzhphabb"
                ".eastasia-01.azurewebsites.net/api/cms/GetOfficialResult")
_HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "application/json",
            "Referer": "https://worldtabletennis.com/"}


def _winner(c1, c2, overall):
    """Return the winning competitor dict given 'a-b' overall score."""
    m = re.match(r"\s*(\d+)\s*-\s*(\d+)", overall or "")
    if not m:
        return None
    a, b = int(m.group(1)), int(m.group(2))
    if a == b:
        return None
    return c1 if a > b else c2


def resolve_qualifiers(event_id: int) -> dict:
    """{sub_event_name: [ {id:int, name:str, org:str}, ... ]} for last-round winners."""
    try:
        r = requests.get(_RESULTS_URL,
                         params={"EventId": event_id, "include_match_card": "true", "take": 2000},
                         headers=_HEADERS, timeout=25)
        data = r.json()
    except Exception:
        return {}
    if isinstance(data, dict):
        data = data.get("Data") or data.get("Result") or []

    # find the max qualifying round per sub-event
    max_round: dict = {}
    for c in data:
        mc = c.get("match_card") or {}
        sub = mc.get("subEventName")
        m = re.search(r"Qualifying Round (\d+)", mc.get("subEventDescription") or "")
        if sub and m:
            max_round[sub] = max(max_round.get(sub, 0), int(m.group(1)))

    out: dict = {}
    for c in data:
        mc = c.get("match_card") or {}
        sub = mc.get("subEventName")
        if not sub or sub not in max_round:
            continue
        m = re.search(r"Qualifying Round (\d+)", mc.get("subEventDescription") or "")
        if not m or int(m.group(1)) != max_round[sub]:
            continue
        comps = mc.get("competitiors") or []
        if len(comps) < 2:
            continue
        w = _winner(comps[0], comps[1],
                    mc.get("overallScores") or mc.get("resultOverallScores"))
        if not w:
            continue
        try:
            wid = int(w.get("competitiorId") or w.get("competitorId"))
        except (TypeError, ValueError):
            continue
        out.setdefault(sub, []).append({
            "id": wid,
            "name": w.get("competitiorName") or "",
            "org": w.get("competitiorOrg") or "",
        })
    return out


def fill_placeholder_qualifiers(draw, winners, rng) -> int:
    """
    Replace 'Qualifier N' placeholder slots in `draw` with real qualifiers.
    Already-named qualifiers are kept; remaining winners are randomly assigned
    to the empty placeholder slots (WTT's slotting is itself a random draw).
    Returns the number of slots filled.
    """
    already = set()
    placeholders = []
    for a, b in draw.matches:
        for c in (a, b):
            real_ids = [p for p in c.player_ids if p is not None and p < 1_000_000]
            if c.is_qualifier and not c.is_placeholder and real_ids:
                already.update(real_ids)            # qualifier already named
            elif c.is_qualifier and c.is_placeholder:
                placeholders.append(c)              # empty "Qualifier N" slot

    remaining = [w for w in winners if w["id"] not in already]
    rng.shuffle(remaining)
    filled = 0
    for ph, w in zip(placeholders, remaining):
        ph.player_ids = [w["id"]]
        ph.names = [w["name"]]
        ph.org = w["org"]
        ph.is_placeholder = False
        ph.is_qualifier = True
        filled += 1
    return filled
