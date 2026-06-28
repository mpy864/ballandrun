"""
wtt_schedule.py — Fetch + parse the WTT schedule.json feed (entries + draws).

One endpoint gives entries, seeds, qualifier flags, player IDs and the full
bracket for every discipline, played or not.  Response is Brotli-compressed.

Public API:
    data = fetch_schedule(event_id)
    subs = parse_event(data)          # {sub_event_name: SubEventDraw}
"""

from __future__ import annotations

import re
import gzip
import zlib
import json
from dataclasses import dataclass, field
from datetime import datetime

import requests
try:
    import brotli
except ImportError:  # pragma: no cover
    brotli = None

_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json",
    "Origin": "https://www.worldtabletennis.com",
    "Referer": "https://www.worldtabletennis.com/",
}
_URL = ("https://wtt-web-frontdoor-withoutcache-cqakg0andqf5hchn.a01.azurefd.net"
        "/websitecacheddata/{event_id}/schedule/schedule.json?q={q}")


def _decode(raw: bytes) -> str:
    candidates = [lambda b: b.decode("utf-8")]
    if brotli:
        candidates.append(brotli.decompress)
    candidates += [gzip.decompress, lambda b: zlib.decompress(b, 16 + zlib.MAX_WBITS)]
    for fn in candidates:
        try:
            out = fn(raw)
            return out.decode("utf-8") if isinstance(out, bytes) else out
        except Exception:
            continue
    raise RuntimeError("could not decode schedule.json response")


def fetch_schedule(event_id: int) -> list:
    q = datetime.now().strftime("%Y-%m-%d%H:%M")
    r = requests.get(_URL.format(event_id=event_id, q=q), headers=_HEADERS, timeout=25)
    r.raise_for_status()
    return json.loads(_decode(r.content))


# ── Data model (discipline-agnostic) ────────────────────────────────────────

@dataclass
class Competitor:
    """One side of a match: a player (singles) or a pair/team (multiple ids)."""
    uid: int                      # unique slot index in the draw (for tallying)
    player_ids: list              # list[int|None]
    names: list                   # list[str]
    org: str = ""
    seed: int = 0
    is_qualifier: bool = False
    is_placeholder: bool = False  # TBD / "Qualifier N" with no real player id

    @property
    def label(self) -> str:
        s = f"[{self.seed}] " if self.seed else ""
        nm = " / ".join(self.names) if self.names else "TBD"
        q = " (Q)" if self.is_qualifier else ""
        return f"{s}{nm} ({self.org}){q}" if self.org else f"{s}{nm}{q}"


@dataclass
class SubEventDraw:
    name: str
    discipline: str               # singles | doubles | mixed
    first_round: str              # e.g. "R64"
    matches: list = field(default_factory=list)  # list[(Competitor, Competitor)]


def _g(u, k):
    v = u.get(k)
    return v.get("Value") if isinstance(v, dict) else v


def _discipline_of(sub: str) -> str:
    s = (sub or "").lower()
    if "mixed" in s:
        return "mixed"
    if "doubles" in s:
        return "doubles"
    return "singles"


def _athletes(competitor: dict):
    """Return (ids, names) for a competitor (1 for singles, 2 for a pair)."""
    ids, names = [], []
    comp = competitor.get("Composition") or {}
    for a in comp.get("Athlete") or []:
        code = a.get("Code") or a.get("Description", {}).get("IfId")
        try:
            ids.append(int(code))
        except (TypeError, ValueError):
            ids.append(None)
        d = a.get("Description", {})
        gn, fn = d.get("GivenName"), d.get("FamilyName")
        names.append((f"{fn} {gn}".strip() if (gn or fn) else d.get("TeamName")) or "")
    if not ids:
        # fall back to top-level competitor fields
        code = competitor.get("Code")
        if code and "_" in str(code):
            for c in str(code).split("_"):
                try: ids.append(int(c))
                except ValueError: ids.append(None)
        else:
            try: ids.append(int(code))
            except (TypeError, ValueError): ids.append(None)
        names.append(competitor.get("Description", {}).get("TeamName") or "")
    return ids, names


def _pos(code: str) -> int:
    m = re.search(r"R\d+-(\d+)", code or "")
    return int(m.group(1)) if m else 9999


def _first_main_round(rounds: set) -> str | None:
    """Pick the main-draw entry round (largest R<size>-)."""
    sized = []
    for r in rounds:
        m = re.match(r"R(\d+)", r)
        if m:
            sized.append((int(m.group(1)), r))
    if not sized:
        return None
    return max(sized)[1]


def parse_event(data: list) -> dict:
    """Return {sub_event_name: SubEventDraw} with the main-draw first round filled."""
    units = [u for d in data for u in ((d.get("Competition") or {}).get("Unit") or [])]
    bycode = {u.get("Code"): u for u in units}

    # rounds available per sub-event
    rounds_by_sub: dict = {}
    for u in bycode.values():
        sub = str(_g(u, "SubEvent"))
        rnd = str(_g(u, "Round")).rstrip("-")
        rounds_by_sub.setdefault(sub, set()).add(rnd)

    out: dict = {}
    uid = 0
    for sub, rounds in rounds_by_sub.items():
        first = _first_main_round(rounds)
        if not first:
            continue
        disc = _discipline_of(sub)
        draw = SubEventDraw(name=sub, discipline=disc, first_round=first)
        # collect that round's matches, ordered by bracket position
        raw = []
        for code, u in bycode.items():
            if str(_g(u, "SubEvent")) != sub:
                continue
            if str(_g(u, "Round")).rstrip("-") != first:
                continue
            starts = (u.get("StartList") or {}).get("Start") or []
            comps = [s.get("Competitor") for s in starts]
            raw.append((_pos(code), comps))
        raw.sort(key=lambda x: x[0])

        for _, comps in raw:
            pair = []
            for c in (comps + [None, None])[:2]:
                if not c:
                    pair.append(Competitor(uid, [None], ["TBD"], is_placeholder=True))
                    uid += 1
                    continue
                ids, names = _athletes(c)
                # Real ITTF player ids are < 1,000,000; 1M+ are registration/
                # placeholder ids (e.g. unresolved "Qualifier N" slots).
                no_real_id = all(i is None or i >= 1_000_000 for i in ids)
                blank_name = all(not (n or "").strip() for n in names)
                placeholder = no_real_id or blank_name or \
                    any("qualifier" in (n or "").lower() for n in names)
                pair.append(Competitor(
                    uid=uid, player_ids=ids, names=names,
                    org=c.get("Organization") or "",
                    seed=c.get("Seed") or 0,
                    is_qualifier=bool(c.get("Qualifier")),
                    is_placeholder=placeholder,
                ))
                uid += 1
            draw.matches.append((pair[0], pair[1]))
        out[sub] = draw
    return out
