#!/usr/bin/env python3
"""
ag2026_sync.py — pull Asian Games 2026 table tennis entries, the ID bridge, the
schedule and the draw into the ag2026_* tables.

THE ID BRIDGE IS THE WHOLE POINT
--------------------------------
The feed names athletes by `Reg`, a Games accreditation id. The model is keyed on
the ITTF id. They are different numbers and neither can be derived from the other.

`IFId` on the bio endpoint is the ITTF id, and bio is the ONLY endpoint that carries
it. So one bio call per athlete, once, cached in ag2026_athletes.reg -> ittf_id.
Measured 2026-09-20: 97 of 98 singles entrants have an IFId; all 96 distinct ids
resolve in wtt_players. The one exception is a Lebanese athlete who is not in the
singles draw.

There is deliberately no fuzzy name matching. resolve_by_name() exists only as an
exact-match last resort for an athlete with no IFId, and it logs loudly when it
fires. Guessing names across 28 nations is how you get Wang Chuqin's Elo attached
to someone else.

RUN
    python scripts/ag2026_sync.py                # entries + schedule + draw
    python scripts/ag2026_sync.py --refresh-bios # re-pull every IFId
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ag2026_api as ag
from ag2026_draw import parse_rsc, round_label, discipline_of, unit_best_of, SINGLES_EVENTS
from tg_common import get_db, reported

FEED  = "ag2026-sync"
BATCH = 500

TEAM_EVENTS = ("M.TEAM--------------", "W.TEAM--------------")


# ── helpers ──────────────────────────────────────────────────────────────────

def _chunked_upsert(db, table: str, rows: list, on_conflict: str) -> int:
    """Upsert in 500-row chunks, the pattern fetch_ttfi.py uses."""
    n = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        db.table(table).upsert(chunk, on_conflict=on_conflict).execute()
        n += len(chunk)
    return n


def _dt(raw: str):
    """DateTimeRaw carries its +09:00 offset. Keep the zone; never store naive."""
    return raw if raw else None


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def ittf_by_reg_map(db) -> dict:
    """{reg: ittf_id} for every bridged athlete."""
    out, page, size = {}, 0, 1000
    while True:
        r = db.table("ag2026_athletes").select("reg,ittf_id") \
              .order("reg").range(page * size, page * size + size - 1).execute()
        if not r.data:
            break
        for row in r.data:
            if row.get("ittf_id"):
                out[row["reg"]] = row["ittf_id"]
        if len(r.data) < size:
            break
        page += 1
    return out


# ── entries + ID bridge ──────────────────────────────────────────────────────

def resolve_by_name(db, family: str, given: str, org: str, gender: str):
    """Exact last-resort match for an athlete with no IFId. Never fuzzy.

    Requires family name, country and gender to all agree, and refuses to answer
    when more than one player fits.
    """
    if not family:
        return None
    r = db.table("wtt_players").select("ittf_id,player_name") \
          .eq("country_code", org).eq("gender", gender) \
          .ilike("player_name", f"%{family}%").execute()
    hits = r.data or []
    if given:
        narrowed = [h for h in hits if given.lower() in (h["player_name"] or "").lower()]
        if narrowed:
            hits = narrowed
    if len(hits) == 1:
        print(f"  [ag2026_sync] NAME-MATCHED {family} {given} ({org}) -> {hits[0]['ittf_id']}"
              f" — no IFId in the feed; verify this one by hand")
        return hits[0]["ittf_id"]
    if len(hits) > 1:
        print(f"  [ag2026_sync] AMBIGUOUS {family} {given} ({org}): {len(hits)} candidates, refusing")
    return None


def fix_duplicate_ids(db) -> dict:
    """Repair ITTF ids the feed hands to two different athletes.

    The Asian Games feed is not immune to data entry errors. Measured 2026-09-20,
    two ids were each claimed by two people:

        134974  ALI Fathimath (MDV)  and  NAZIM Aishath (MDV)
        203063  KHAN Abbas (PAK)     and  KHAN Muhammad (PAK)

    Left alone this is worse than a missing id. Both athletes inherit one player's
    Elo, and simulate_draw locks results by player_ids[0], so a finished match could
    advance the wrong person.

    Date of birth settles it exactly. The feed gives every athlete a BirthDateRaw and
    wtt_players stores dob, so the claimant whose dob matches keeps the id and the
    other is re-resolved on (country, gender, dob) — an exact triple, never a name
    guess. If that does not land on exactly one player the id is cleared, which
    leaves the athlete unrated rather than wrongly rated.
    """
    r = db.table("ag2026_athletes").select("reg,name,org,gender,dob,ittf_id") \
          .not_.is_("ittf_id", "null").execute()
    rows = r.data or []

    by_id = {}
    for row in rows:
        by_id.setdefault(row["ittf_id"], []).append(row)
    dupes = {pid: rs for pid, rs in by_id.items() if len(rs) > 1}
    if not dupes:
        return {"duplicates": 0, "reassigned": 0, "cleared": 0}

    reassigned, cleared, notes = 0, 0, []
    for pid, claimants in dupes.items():
        truth = db.table("wtt_players").select("ittf_id,player_name,dob") \
                  .eq("ittf_id", pid).limit(1).execute().data
        true_dob = (truth[0].get("dob") if truth else None)

        keeps = [c for c in claimants if c.get("dob") and c["dob"] == true_dob]
        keeper = keeps[0]["reg"] if len(keeps) == 1 else None

        for c in claimants:
            if c["reg"] == keeper:
                continue
            alt = None
            if c.get("dob"):
                hit = db.table("wtt_players").select("ittf_id,player_name") \
                        .eq("country_code", c["org"]).eq("gender", c["gender"]) \
                        .eq("dob", c["dob"]).execute().data or []
                uniq = {h["ittf_id"] for h in hit}
                if len(uniq) == 1:
                    alt = uniq.pop()
            db.table("ag2026_athletes").update(
                {"ittf_id": alt, "id_source": "dob" if alt else "dup"}
            ).eq("reg", c["reg"]).execute()
            if alt:
                reassigned += 1
                notes.append(f"{c['name']} ({c['org']}) {pid} -> {alt} by dob {c['dob']}")
            else:
                cleared += 1
                notes.append(f"{c['name']} ({c['org']}) {pid} -> cleared, no exact dob match")

    return {"duplicates": len(dupes), "reassigned": reassigned,
            "cleared": cleared, "notes": notes}


def sync_entries(db, refresh_bios: bool = False) -> dict:
    """entries/list -> ag2026_athletes, filling ittf_id from entries/bio.

    ~196 athletes at SLEEP=0.4 is about 80 s on a cold run and near-zero after,
    because a reg that already has an ittf_id is not re-fetched.
    """
    data = ag.entries_list()
    parts = data.get("participants") or []
    if not parts:
        return {"athletes": 0, "bridged": 0, "missing_ifid": []}

    known = {} if refresh_bios else ittf_by_reg_map(db)

    rows, missing, bios = [], [], 0
    for p in parts:
        reg = str(p.get("Reg") or "")
        if not reg:
            continue
        ins = p.get("Inscriptions") or []
        # isMember False means they are entered in that event in their own right;
        # True means they appear inside someone else's pair or team entry.
        own = [i for i in ins if not i.get("isMember")]

        row = {
            "reg":        reg,
            "org":        p.get("Org"),
            "gender":     p.get("Gender"),
            "ptype":      p.get("Type"),
            "name":       p.get("Name"),
            "name_s":     p.get("NameS"),
            "in_singles": any("SINGLES" in (i.get("EvKey") or "") for i in own),
            "in_team":    any("TEAM"    in (i.get("EvKey") or "") for i in ins),
            "in_doubles": any("DOUBLES" in (i.get("EvKey") or "") for i in own),
        }

        if p.get("Type") == "A":
            if reg in known:
                row["ittf_id"], row["id_source"] = known[reg], "ifid"
            else:
                bio = ag.entries_bio(reg)
                bios += 1
                part = (bio or {}).get("participant") or {}
                ifid = _int(part.get("IFId"))
                row["dob"]         = part.get("BirthDateRaw") or None
                row["given_name"]  = part.get("GivenName")
                row["family_name"] = part.get("FamilyName")
                if ifid:
                    row["ittf_id"], row["id_source"] = ifid, "ifid"
                else:
                    alt = resolve_by_name(db, part.get("FamilyName"), part.get("GivenName"),
                                          p.get("Org"), p.get("Gender"))
                    row["ittf_id"]   = alt
                    row["id_source"] = "name" if alt else "none"
                    missing.append(f"{p.get('Org')} {p.get('Name')} (reg {reg})")
        rows.append(row)

    _chunked_upsert(db, "ag2026_athletes", rows, "reg")

    athletes = [r for r in rows if r["ptype"] == "A"]
    bridged  = [r for r in athletes if r.get("ittf_id")]
    singles  = [r for r in athletes if r["in_singles"]]
    return {
        "rows": len(rows), "athletes": len(athletes), "bridged": len(bridged),
        "singles": len(singles),
        "singles_bridged": len([r for r in singles if r.get("ittf_id")]),
        "bio_calls": bios, "missing_ifid": missing,
    }


# ── schedule ─────────────────────────────────────────────────────────────────

def _unit_row(u: dict, ittf: dict, parent: str = None) -> dict | None:
    key = u.get("Key") or (u.get("Info") or {}).get("Key")
    if not key:
        return None
    r = parse_rsc(key)
    if not r:
        return None

    label = round_label(r["round_code"], u.get("PhaseDesc") or u.get("PhaseDescA") or "")
    disc  = r["discipline"]
    home, away = u.get("Home") or {}, u.get("Away") or {}
    hreg, areg = str(home.get("Reg") or "") or None, str(away.get("Reg") or "") or None

    winner = None
    if home.get("Winner"):
        winner = "home"
    elif away.get("Winner"):
        winner = "away"

    return {
        "unit_key":    key,
        "event_key":   r["event_key"],
        "event_desc":  u.get("EventDesc"),
        "phase_key":   r["phase_key"],
        "phase_desc":  u.get("PhaseDesc"),
        "round_code":  r["round_code"],
        "round_label": label,
        "discipline":  disc,
        "gender":      r["gender"],
        "match_idx":   r["match_idx"],
        "rubber_num":  r["rubber_num"],
        "parent_unit": parent,
        "status":      u.get("Status"),
        "is_live":     bool(u.get("IsLive")),
        "is_bye":      bool((u.get("Info") or {}).get("IsBye")),
        "start_at":    _dt(u.get("DateTimeRaw")),
        "estimated":   bool(u.get("Estimated")),
        "venue_desc":  u.get("VenueDesc"),
        "loc_desc":    u.get("LocDesc"),
        "best_of":     unit_best_of(u, disc, label or "R64"),
        "medal":       u.get("Medal"),
        "home_reg":    hreg,
        "away_reg":    areg,
        "home_ittf":   ittf.get(hreg),
        "away_ittf":   ittf.get(areg),
        "home_org":    home.get("Org"),
        "away_org":    away.get("Org"),
        "home_name":   home.get("Name") or home.get("NameS"),
        "away_name":   away.get("Name") or away.get("NameS"),
        "home_result": _int(home.get("Result")),
        "away_result": _int(away.get("Result")),
        "winner_side": winner,
        "raw":         u,
    }


def sync_schedule(db, days: list | None = None) -> dict:
    """Every TTE unit across every competition day -> ag2026_units."""
    ittf = ittf_by_reg_map(db)
    days = days or [d["raw"] for d in ag.schedule_days()]

    rows, live = [], 0
    for day in days:
        for u in ag.schedule_daily(day):
            row = _unit_row(u, ittf)
            if row:
                rows.append(row)
                live += bool(row["is_live"])

    if rows:
        _chunked_upsert(db, "ag2026_units", rows, "unit_key")

    singles = [r for r in rows if r["discipline"] == "singles"]
    drawn   = [r for r in singles if r["home_reg"] and r["away_reg"]]
    return {"units": len(rows), "days": len(days), "live": live,
            "singles": len(singles), "singles_drawn": len(drawn),
            "unmapped_round": len([r for r in rows if r["round_label"] is None])}


# ── draw ─────────────────────────────────────────────────────────────────────

def sync_brackets(db, events: tuple = SINGLES_EVENTS) -> dict:
    """brackets/{event} -> fill in the competitors the daily schedule omits.

    The schedule lists singles matches as PROVISIONAL with no Home/Away well after
    the draw is made. The bracket has the real thing. Verified 2026-09-20: the two
    agree on 100 of 102 singles unit keys exactly (the other two are ceremonies).
    """
    ittf = ittf_by_reg_map(db)
    rows, drawn = [], 0

    for ev in events:
        for b in ag.brackets(ev):
            for ph in b.get("Phases") or []:
                for m in ph.get("Matches") or []:
                    u = dict(m.get("Info") or {})
                    u["Home"], u["Away"] = m.get("Home") or {}, m.get("Away") or {}
                    u["PhaseDesc"] = ph.get("Desc")
                    row = _unit_row(u, ittf)
                    if not row:
                        continue
                    # The bracket has no times or venues; do not overwrite the
                    # schedule's with blanks.
                    for blank in ("start_at", "venue_desc", "loc_desc", "event_desc"):
                        if not row.get(blank):
                            row.pop(blank, None)
                    rows.append(row)
                    drawn += bool(row.get("home_name") and row.get("away_name"))

    if rows:
        _chunked_upsert(db, "ag2026_units", rows, "unit_key")
    return {"bracket_units": len(rows), "both_named": drawn}


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh-bios", action="store_true")
    ap.add_argument("--skip-entries", action="store_true")
    ap.add_argument("--day", help="sync only this day, YYYY-MM-DD")
    args = ap.parse_args()

    with reported(FEED) as run:
        db = get_db()
        if db is None:
            raise RuntimeError("no Supabase credentials")

        bits = []
        if not args.skip_entries:
            e = sync_entries(db, refresh_bios=args.refresh_bios)
            print(f"[entries] {e['athletes']} athletes, {e['bridged']} bridged, "
                  f"{e['singles']} in singles ({e['singles_bridged']} bridged), "
                  f"{e['bio_calls']} bio calls")
            for miss in e["missing_ifid"]:
                print(f"  no IFId: {miss}")
            bits.append(f"{e['bridged']}/{e['athletes']} bridged")

            d = fix_duplicate_ids(db)
            if d["duplicates"]:
                print(f"[dupes] {d['duplicates']} ittf_id(s) claimed twice — "
                      f"{d['reassigned']} reassigned by dob, {d['cleared']} cleared")
                for n in d["notes"]:
                    print(f"  {n}")
                bits.append(f"{d['duplicates']} dupes fixed")

        s = sync_schedule(db, [args.day] if args.day else None)
        print(f"[schedule] {s['units']} units over {s['days']} days, "
              f"{s['singles']} singles ({s['singles_drawn']} drawn), live={s['live']}")
        if s["unmapped_round"]:
            print(f"  {s['unmapped_round']} units with an unmapped round code")
        bits.append(f"{s['units']} units")

        b = sync_brackets(db)
        print(f"[draw] {b['bracket_units']} bracket units, {b['both_named']} with both players")
        bits.append(f"draw {b['both_named']} named")

        run["detail"] = ", ".join(bits)


if __name__ == "__main__":
    main()
