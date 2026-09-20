#!/usr/bin/env python3
"""
ag2026_api.py — transport for the Asian Games 2026 (Aichi-Nagoya) results backend.

Transport and decode only. No business logic, no DB, no model. Everything that
knows what a table tennis match *is* lives in ag2026_sync / ag2026_draw / ag2026_live.

The backend is undocumented. It powers https://results.asiangames2026.org and was
found by reading that site's JS bundle. No auth, no API key.

  URL shape:  /s/AG2026/{lang}/{discipline or ALL}/{resource}

THE DECODE QUIRK
----------------
Responses come back with `Content-Type: application/json` but the body is NOT json.
It is zlib-compressed bytes, encoded as a latin1 string, then serialised as UTF-8.
This is not HTTP Content-Encoding — requests/curl will not undo it for you. A raw
read looks like mojibake ('x\xed}ks\xdb8...').

Three steps get you back to JSON:

    text = resp.content.decode("utf-8")          # UTF-8 -> str of code points < 256
    raw  = bytes(ord(c) & 0xFF for c in text)    # code points -> the real bytes
    data = json.loads(zlib.decompress(raw))      # 1,298 b -> 9,047 b on disc/list

_decode() tries that first and then falls through plain-json / raw-zlib / gzip /
raw-deflate, mirroring the ladder in wtt_schedule._decode. The feed is undocumented
and runs for nine days; if they change compression mid-event we degrade instead of
going dark.

CACHING
-------
Served through CloudFront with a ~30 s TTL (measured 2026-09-20: Age climbed 4 -> 27,
then reset on a Miss). Polling faster than that returns identical bytes. Passing
bust=True appends ?_=<epoch_ms>, which forces a Miss — verified. Use it only for
units actually in play; the whole-day schedule does not need it.

Every response's Age / X-Cache is kept in last_cache() so callers can record how
stale the data they acted on actually was.
"""

import json
import gzip
import time
import zlib
import requests

BASE  = "https://back.results.asiangames2026.org"
CHAMP = "AG2026"
LANG  = "en"
DISC  = "TTE"                       # table tennis

SLEEP   = 0.4                       # polite gap between calls
RETRIES = 3
TIMEOUT = 25

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en",
    "Referer": "https://results.asiangames2026.org/",
}

# Populated by every get(); read with last_cache().
_LAST_CACHE = {"age": None, "x_cache": None, "status": None, "url": None}


def last_cache() -> dict:
    """Cache headers from the most recent get(). `age` is CloudFront's Age in
    seconds — i.e. how old the data you just received actually is."""
    return dict(_LAST_CACHE)


# ── Decode ────────────────────────────────────────────────────────────────────

def _latin1_zlib(body: bytes):
    """The documented case: zlib bytes carried as latin1-in-UTF-8."""
    text = body.decode("utf-8")
    raw  = bytes(ord(c) & 0xFF for c in text)
    return zlib.decompress(raw)


def _decode(body: bytes):
    """bytes -> parsed JSON. Tries the known encoding first, then degrades.

    Returns None for an empty body. Raises ValueError only when every strategy
    fails, which is the signal that the backend changed shape.
    """
    if not body:
        return None

    strategies = (
        ("latin1+zlib", _latin1_zlib),
        ("plain",       lambda b: b),
        ("zlib",        zlib.decompress),
        ("gzip",        gzip.decompress),
        ("deflate",     lambda b: zlib.decompress(b, -zlib.MAX_WBITS)),
        ("gzip-wbits",  lambda b: zlib.decompress(b, 16 + zlib.MAX_WBITS)),
    )

    for name, fn in strategies:
        try:
            out = fn(body)
        except Exception:
            continue
        try:
            return json.loads(out.decode("utf-8") if isinstance(out, bytes) else out)
        except Exception:
            continue

    raise ValueError(f"could not decode {len(body)} byte response")


# ── Fetch ─────────────────────────────────────────────────────────────────────

def get(path: str, tries: int = RETRIES, bust: bool = False, quiet: bool = False):
    """GET one endpoint. Returns parsed JSON, or None on 404 / empty body.

    Never raises on a network or HTTP problem — returns None and prints. The
    callers are long-running pollers; one bad response must not end the run.
    """
    url = BASE + path
    if bust:
        url += ("&" if "?" in url else "?") + f"_={int(time.time() * 1000)}"

    last_err = None
    for attempt in range(1, tries + 1):
        try:
            r = requests.get(url, headers=_HEADERS, timeout=TIMEOUT)
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            time.sleep(SLEEP * attempt)
            continue

        xc  = r.headers.get("X-Cache") or ""
        hdr = r.headers.get("Age") or ""
        # A Miss was served from the origin, so the data is 0 s old. CloudFront
        # sends no Age header on a Miss, and a cache-busted request is always a
        # Miss — without this, every busted fetch would record an unknown age.
        age = int(hdr) if hdr.isdigit() else (0 if "Miss" in xc else None)
        _LAST_CACHE.update({"age": age, "x_cache": xc or None,
                            "status": r.status_code, "url": path})

        if r.status_code == 404:
            return None
        if r.status_code != 200:
            last_err = f"HTTP {r.status_code}"
            time.sleep(SLEEP * attempt)
            continue

        try:
            return _decode(r.content)
        except ValueError as e:
            last_err = str(e)
            break                       # a decode failure will not fix itself on retry

    if not quiet:
        print(f"  [ag2026_api] {path} -> {last_err}")
    return None


def _s(*parts, disc: str = None) -> str:
    """Build '/s/AG2026/en/{disc}/...' — disc=None means no discipline segment."""
    head = [ "", "s", CHAMP, LANG ]
    if disc is not None:
        head.append(disc)
    return "/".join(head + [str(p) for p in parts])


# ── Endpoints (verified live 2026-09-20) ──────────────────────────────────────

def disc_list() -> list:
    """All disciplines at the Games. Table tennis is Key 'TTE'."""
    return get(_s("disc", "list", disc="ALL")) or []


def schedule_days(disc: str = DISC) -> list:
    """[{raw:'2026-09-20', day, month, weekDay, title}] — 9 days for TTE."""
    return get(_s("schedule", "days", disc=disc)) or []


def schedule_daily(day: str, disc: str = DISC, bust: bool = False) -> list:
    """One day's units, filtered to `disc`. day = 'YYYY-MM-DD'."""
    return get(_s("schedule", "daily", day, disc=disc), bust=bust) or []


def phases(disc: str = DISC) -> list:
    """[{Key, EvKey, Order, Desc, DescS, DescA, DescB}] — 53 for TTE."""
    return get(_s("phases", disc=disc)) or []


def entries_list(disc: str = DISC) -> dict:
    """{orgs, disciplines, participants} — 359 participants for TTE.
    Type 'A' = athlete (196), Type 'T' = team or pair."""
    return get(_s("entries", "list", disc=disc)) or {}


def entries_bio(reg: str, disc: str = DISC) -> dict:
    """{participant, entries, schedule}. participant.IFId is the ITTF id —
    the ONLY place it appears, and the join key to wtt_players.ittf_id."""
    return get(_s("entries", "bio", reg, disc=disc))


def entries_event(event_key: str, disc: str = DISC) -> dict:
    """{Disc, EvKey, EvDesc, Partics} — the entry list for one event."""
    return get(_s("entries", "event", event_key, disc=disc)) or {}


def brackets(event_key: str, disc: str = DISC) -> list:
    """The knockout draw: [{Code:'MAINDRAW', Desc, isDoubles, Phases:[...]}].

    This is where the singles draw actually lives. The daily schedule shows the
    same matches as PROVISIONAL with no Home/Away long after the draw is made.
    """
    return get(_s("brackets", event_key, disc=disc)) or []


def groups(phase_key: str, disc: str = DISC) -> dict:
    """{EvKey, EvDesc, Groups:[{Key, Type:'POOL', Desc, Matches:[...]}], Legends}."""
    return get(_s("groups", phase_key, disc=disc)) or {}


def results(unit_key: str, disc: str = DISC, bust: bool = False) -> dict:
    """{Info, Results, Competitors, SubUnits, Legends} for one unit.

    Results.ResDetail carries per-game scores as '11:1, 11:6, 11:5'.
    SubUnits are the individual rubbers of a team tie.
    """
    return get(_s("results", unit_key, disc=disc), bust=bust)


def current(unit_key: str, disc: str = DISC, v2: bool = False, bust: bool = True) -> dict:
    """Live state for one unit. Returned empty (null) for every finished unit
    tested on 2026-09-20 — whether it carries in-progress point scores during
    play is UNVERIFIED. Probe it on 21 Sep while a team tie is running."""
    leaf = "current-v2" if v2 else "current"
    return get(_s(leaf, unit_key, disc=disc), bust=bust, quiet=True)


def final_rank(event_key: str, disc: str = DISC) -> dict:
    return get(_s("final-rank", event_key, disc=disc)) or {}


def medals_standings(disc: str = "ALL") -> list:
    return get(_s("medals", "standings", disc=disc)) or []


if __name__ == "__main__":
    import sys
    path = sys.argv[1] if len(sys.argv) > 1 else _s("schedule", "days", disc=DISC)
    data = get(path)
    print(json.dumps(data, indent=1, ensure_ascii=False))
    print(f"\n-- cache: {last_cache()}", file=sys.stderr)
