"""
wtt_results.py — Read decided MAIN-DRAW match winners for live forecasting.

Maps each completed main-draw match to (sub_event, round_label, match_index)
-> winner_id, so the simulator can lock results that already happened and only
simulate the remaining bracket.
"""

from __future__ import annotations

import re
import requests

_URL = ("https://wtt-website-live-events-api-prod-cmfzgabgbzhphabb.eastasia-01"
        ".azurewebsites.net/api/cms/GetOfficialResult")
_H = {"User-Agent": "Mozilla/5.0", "Accept": "application/json",
      "Referer": "https://worldtabletennis.com/"}


def _round_label(desc: str) -> str | None:
    d = desc.lower()
    if "qualifying" in d:
        return None
    if "round of 128" in d: return "R128"
    if "round of 64" in d:  return "R64"
    if "round of 32" in d:  return "R32"
    if "round of 16" in d:  return "R16"
    if "quarter" in d:      return "QF"
    if "semi" in d:         return "SF"
    if "final" in d:        return "F"
    return None


def get_results(event_id: int) -> dict:
    """{(sub_event, round_label, match_idx): winner_id} for decided main-draw matches."""
    data = None
    for attempt in range(3):                       # retry: avoid silently showing stale odds
        try:
            data = requests.get(_URL, params={"EventId": event_id,
                                "include_match_card": "true", "take": 2000},
                                headers=_H, timeout=25).json()
            break
        except Exception:
            data = None
    if data is None:
        return {}
    if isinstance(data, dict):
        data = data.get("Data") or data.get("Result") or []

    out: dict = {}
    for c in data:
        mc = c.get("match_card") or {}
        sub = mc.get("subEventName") or ""
        desc = mc.get("subEventDescription") or ""
        label = _round_label(desc)
        if not label:
            continue
        m = re.search(r"Match\s+(\d+)", desc)
        if not m:
            continue
        idx = int(m.group(1))
        comps = mc.get("competitiors") or []
        if len(comps) < 2:
            continue
        ov = mc.get("overallScores") or mc.get("resultOverallScores") or ""
        mm = re.match(r"\s*(\d+)\s*-\s*(\d+)", ov)
        if not mm:
            continue
        a, b = int(mm.group(1)), int(mm.group(2))
        if a == b:
            continue
        win = comps[0] if a > b else comps[1]
        try:
            wid = int(win.get("competitiorId") or win.get("competitorId"))
        except (TypeError, ValueError):
            continue
        if wid >= 1_000_000:
            continue
        out[(sub, label, idx)] = wid
    return out


def progress(draw_matches, res, labels):
    """
    Walk the bracket applying locked results to get each competitor's ACTUAL
    status. Returns (status, champion_uid):
      status[uid] = ('out', round)  | ('champ',) | ('alive', round)
    """
    def isbye(x):
        return x is not None and x.is_placeholder and x.player_ids == [None] and not x.is_qualifier

    status = {}
    cur = [c for m in draw_matches for c in m]
    for c in cur:
        status[c.uid] = ('alive', labels[0])
    champ = None

    for lvl, label in enumerate(labels):
        if len(cur) < 2:
            break
        nxt = [None] * (len(cur) // 2)
        nextlbl = labels[lvl + 1] if lvl + 1 < len(labels) else label
        for i in range(0, len(cur), 2):
            a, b = cur[i], cur[i + 1]
            idx = i // 2 + 1
            if a is None or b is None:
                continue
            if isbye(b):
                nxt[idx - 1] = a; status[a.uid] = ('alive', nextlbl); continue
            if isbye(a):
                nxt[idx - 1] = b; status[b.uid] = ('alive', nextlbl); continue
            wid = res.get((label, idx))
            if wid is None:                     # match pending -> both still alive here
                status[a.uid] = ('alive', label); status[b.uid] = ('alive', label)
                continue
            win = a if (a.player_ids and a.player_ids[0] == wid) else \
                  (b if (b.player_ids and b.player_ids[0] == wid) else None)
            if win is None:
                continue
            lose = b if win is a else a
            status[lose.uid] = ('out', label)
            if label == labels[-1]:
                status[win.uid] = ('champ',); champ = win.uid
            else:
                status[win.uid] = ('alive', nextlbl)
            nxt[idx - 1] = win
        cur = nxt
        if all(x is None for x in cur):
            break
    return status, champ
