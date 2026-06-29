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
