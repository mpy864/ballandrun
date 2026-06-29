#!/usr/bin/env python3
"""
send_todays_results.py — Backfill: send today's completed match results to Telegram.

Fetches all Official (completed) matches from today, filters for Indian players
and QF/SF/Finals, formats them identically to live_updater, and sends to Telegram.

Usage
-----
  python scripts/send_todays_results.py --auto --db
  python scripts/send_todays_results.py --event 3240 --db
  python scripts/send_todays_results.py --auto --db --dry-run
"""

import os, sys, re, time, argparse, requests
from datetime import datetime, date, timedelta

sys.path.insert(0, os.path.dirname(__file__))
from feature_model import MatchPredictor

try:
    from supabase import create_client as _sb_create
except ImportError:
    _sb_create = None

# ── WTT API ───────────────────────────────────────────────────────────────────

OFFICIAL_URL = (
    "https://wtt-website-live-events-api-prod-cmfzgabgbzhphabb.eastasia-01"
    ".azurewebsites.net/api/cms/GetOfficialResult"
)
HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept":     "application/json",
    "Referer":    "https://worldtabletennis.com/",
}

# ── Fetch completed matches ───────────────────────────────────────────────────

def fetch_todays_results(event_id: int) -> list[dict]:
    """Return all OFFICIAL singles matches from today for this event."""
    try:
        r = requests.get(
            OFFICIAL_URL,
            params={"EventId": event_id, "include_match_card": "true", "take": 500},
            headers=HEADERS, timeout=20,
        )
    except Exception as e:
        print(f"  [!] API error: {e}")
        return []

    if r.status_code != 200:
        print(f"  [!] HTTP {r.status_code}")
        return []

    data = r.json()
    if not isinstance(data, list):
        data = data.get("Data") or data.get("Result") or []

    today_utc = date.today().isoformat()   # e.g. "2026-06-10"
    matches = []

    # Pre-scan: does this event have any match with today's UTC timestamp?
    # If yes, also include OFFICIAL matches that lack a timestamp (API gap).
    # If no, only include matches that explicitly carry today's timestamp.
    has_today_activity = any(
        (((e.get("match_card") or e).get("matchStartTimeUTC") or "")).startswith(today_utc)
        for e in data
        if (e.get("match_card") or e).get("resultStatus") == "OFFICIAL"
    )

    for entry in data:
        mc = entry.get("match_card") or entry
        if not mc or mc.get("resultStatus") != "OFFICIAL":
            continue

        # Filter to today by UTC start time.
        # Matches without a timestamp are included only when the event is
        # provably active today (has at least one timestamped result today).
        start_utc = mc.get("matchStartTimeUTC") or ""
        if start_utc and not start_utc.startswith(today_utc):
            continue
        if not start_utc and not has_today_activity:
            continue

        comps = mc.get("competitiors") or []
        if len(comps) < 2:
            continue
        id1_raw = comps[0].get("competitiorId") or comps[0].get("competitorId") or ""
        id2_raw = comps[1].get("competitiorId") or comps[1].get("competitorId") or ""
        # Skip team entries that use underscore-separated IDs
        if "_" in str(id1_raw) or "_" in str(id2_raw):
            continue
        try:
            id1, id2 = int(id1_raw), int(id2_raw)
        except (ValueError, TypeError):
            continue
        is_dbl = (id1 >= 1_000_000 or id2 >= 1_000_000)

        # Org codes (country) available directly from API for both singles and doubles
        org1 = comps[0].get("competitiorOrg") or ""
        org2 = comps[1].get("competitiorOrg") or ""

        # Individual player IDs for doubles pairs (for ranking lookups)
        def _pids(comp):
            return [int(p["playerId"]) for p in (comp.get("players") or [])
                    if str(p.get("playerId", "")).isdigit()]
        players1 = _pids(comps[0]) if is_dbl else []
        players2 = _pids(comps[1]) if is_dbl else []

        # Parse overall result
        overall = str(mc.get("resultOverallScores") or mc.get("overallScores") or "")
        result = None
        if "-" in overall:
            try:
                w1, w2 = [int(x.strip()) for x in overall.split("-")[:2]]
                result = "W" if w1 > w2 else ("L" if w2 > w1 else None)
            except (ValueError, TypeError):
                pass

        if result is None:
            continue

        # Game scores
        game_scores_str = str(mc.get("resultsGameScores") or mc.get("gameScores") or "")

        matches.append({
            "event_id":        entry.get("eventId", event_id),
            "id1": id1, "id2": id2,
            "name1":  comps[0].get("competitiorName") or str(id1),
            "name2":  comps[1].get("competitiorName") or str(id2),
            "org1": org1, "org2": org2,
            "is_doubles": is_dbl,
            "players1": players1, "players2": players2,
            "result": result,
            "overall": overall,
            "game_scores_str": game_scores_str,
            "round":  mc.get("subEventDescription") or mc.get("roundName") or "",
            "start_utc": start_utc,
        })

    return matches


# ── Filtering ─────────────────────────────────────────────────────────────────

def _is_key_round(round_name: str) -> bool:
    low = round_name.lower()
    return any(k in low for k in ["quarter", "semi", "final"])


# ── Player info ───────────────────────────────────────────────────────────────

def _doubles_category(round_name: str) -> str:
    low = round_name.lower()
    if "mixed" in low:       return "XD"
    if "women" in low:       return "WD"
    return "MD"


def fetch_doubles_pair_rank(db, ids_pair: list[int], category: str) -> int | None:
    """Return the current doubles ranking for a specific pair (either player order).
    Returns None if the most recent data is older than 45 days (likely stale)."""
    if len(ids_pair) < 2 or not db:
        return None
    p1, p2 = ids_pair[0], ids_pair[1]
    try:
        r = db.table("rankings_doubles_teams") \
               .select("p1_ittf_id,p2_ittf_id,current_rank,publish_date") \
               .eq("category", category) \
               .or_(f"p1_ittf_id.eq.{p1},p2_ittf_id.eq.{p1},p1_ittf_id.eq.{p2},p2_ittf_id.eq.{p2}") \
               .order("publish_date", desc=True) \
               .execute()
        pair_set = {p1, p2}
        cutoff = (date.today() - timedelta(days=45)).isoformat()
        for row in (r.data or []):
            if {row["p1_ittf_id"], row["p2_ittf_id"]} == pair_set:
                if row["publish_date"] >= cutoff:
                    return row["current_rank"]
                return None  # data too stale
    except Exception as e:
        print(f"  [DB] doubles rank error: {e}")
    return None


def fetch_player_info(db, ids: list[int]) -> dict:
    """Returns {ittf_id: {country_code, rank}}."""
    if not db or not ids:
        return {}
    info = {}
    try:
        pr = db.table("wtt_players").select("ittf_id,country_code").in_("ittf_id", ids).execute()
        for r in (pr.data or []):
            info[r["ittf_id"]] = {"country_code": r["country_code"], "rank": None}

        rr = db.table("rankings_singles_normalized") \
               .select("player_id,rank,ranking_date") \
               .in_("player_id", ids) \
               .order("ranking_date", desc=True).execute()
        rank_map: dict[int, int] = {}
        for r in (rr.data or []):
            if r["player_id"] not in rank_map:
                rank_map[r["player_id"]] = r["rank"]
        for ittf_id in info:
            info[ittf_id]["rank"] = rank_map.get(ittf_id)
    except Exception as e:
        print(f"  [DB] player info error: {e}")
    return info


def fetch_event_name(db, event_id: int) -> str:
    if not db:
        return ""
    try:
        er = db.table("wtt_events").select("event_name").eq("event_id", event_id).execute()
        return er.data[0]["event_name"] if er.data else ""
    except Exception:
        return ""


# ── Formatting ────────────────────────────────────────────────────────────────

def _extract_venue(event_name: str) -> str:
    skip = {"wtt","grand","star","contender","smash","series","youth",
            "championships","team","world","table","tennis","junior","cadet","open","cup"}
    name = re.sub(r'\b\d{4}\b', '', event_name).strip()
    words = [w for w in name.split() if w.lower() not in skip]
    return words[-1] if words else ""


def _parse_disc_round(round_name: str) -> tuple[str, str]:
    for d in ["Women's Singles", "Men's Singles", "Mixed Doubles",
              "Women's Doubles", "Men's Doubles"]:
        if d.lower() in round_name.lower():
            rest = round_name[round_name.lower().find(d.lower()) + len(d):].strip(" -·|")
            return d, rest or round_name
    return "Singles", round_name


def _parse_game_scores(scores_str: str) -> list[tuple[int, int]]:
    out = []
    for g in str(scores_str).split(","):
        g = g.strip()
        if "-" not in g:
            continue
        try:
            a, b = int(g.split("-")[0]), int(g.split("-")[1])
            if a > 0 or b > 0:
                out.append((a, b))
        except (ValueError, IndexError):
            continue
    return out


def pretty_name(team_name: str) -> str:
    """De-shout WTT names ('GHORPADE Yashaswini' -> 'Ghorpade Yashaswini'),
    keeping the feed's surname-first order. Doubles ('A/B') -> surnames only."""
    if "/" in team_name:
        sides = [s.strip() for s in team_name.split("/") if s.strip()]
        return " / ".join((s.split()[0].title() if s.split() else s) for s in sides)
    return " ".join(p.title() for p in team_name.split())


def _fmt(name: str, country: str, rank, is_india: bool) -> str:
    o    = "IND" if is_india else (country or "")
    bits = ([o] if o else []) + ([str(rank)] if rank else [])
    paren = f" ({', '.join(bits)})" if bits else ""
    pretty = pretty_name(name)
    return f"<i>{pretty}{paren}</i>" if is_india else f"{pretty}{paren}"


# ── Sent-results deduplication tracker ───────────────────────────────────────

_PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_LOGS_DIR    = os.path.join(_PROJECT_DIR, "logs")


def _sent_key(event_id: int, id1: int, id2: int) -> str:
    return f"{event_id}_{min(id1, id2)}_{max(id1, id2)}"


def _tracker_path() -> str:
    return os.path.join(_LOGS_DIR, f"sent_results_{date.today().isoformat()}.txt")


def _load_sent() -> set:
    try:
        with open(_tracker_path()) as f:
            return {line.strip() for line in f if line.strip()}
    except FileNotFoundError:
        return set()


def _mark_sent(key: str):
    os.makedirs(_LOGS_DIR, exist_ok=True)
    with open(_tracker_path(), "a") as f:
        f.write(key + "\n")


def build_message(m: dict, event_name: str, p1_info: dict, p2_info: dict,
                  p_pre: float, correct) -> str:
    id1, id2 = m["id1"], m["id2"]
    result   = m["result"]

    c1 = p1_info.get("country_code", "")
    c2 = p2_info.get("country_code", "")
    r1 = p1_info.get("rank")
    r2 = p2_info.get("rank")

    ind1 = (c1 == "IND")
    ind2 = (c2 == "IND")

    # Parse game scores (A's perspective = comp1)
    raw_games = _parse_game_scores(m["game_scores_str"])

    # Orient: India always first; otherwise winner first
    if ind2 and not ind1:
        n1, country1, rank1 = m["name2"], c2, r2
        n2, country2, rank2 = m["name1"], c1, r1
        result_p1 = "W" if result == "L" else "L"
        overall_parts = m["overall"].split("-")
        ga1 = int(overall_parts[1]) if len(overall_parts) == 2 else 0
        gb1 = int(overall_parts[0]) if len(overall_parts) == 2 else 0
        game_scores = [(b, a) for a, b in raw_games]
        ind1, ind2 = True, False
    else:
        n1, country1, rank1 = m["name1"], c1, r1
        n2, country2, rank2 = m["name2"], c2, r2
        result_p1 = result
        overall_parts = m["overall"].split("-")
        ga1 = int(overall_parts[0]) if len(overall_parts) == 2 else 0
        gb1 = int(overall_parts[1]) if len(overall_parts) == 2 else 0
        game_scores = raw_games

    # For non-India: winner first
    if not ind1 and not ind2 and result_p1 == "L":
        n1, n2             = n2, n1
        country1, country2 = country2, country1
        rank1, rank2       = rank2, rank1
        result_p1          = "W"
        ga1, gb1           = gb1, ga1
        game_scores        = [(b, a) for a, b in game_scores]
        ind1, ind2         = ind2, ind1

    p1_str = _fmt(n1, country1, rank1, ind1)
    p2_str = _fmt(n2, country2, rank2, ind2)
    verb   = "defeated" if result_p1 == "W" else "lost to"
    scores = ", ".join(f"{a}-{b}" for a, b in game_scores) if game_scores else "–"

    disc, rnd  = _parse_disc_round(m["round"])
    rnd        = re.sub(r'\s*-\s*Match\s*\d+$', '', rnd, flags=re.IGNORECASE).strip()
    header     = f"<b>{event_name}</b>"

    base = (
        f"{header}\n"
        f"{disc}  |  {rnd}\n\n"
        f"{p1_str} {verb} {p2_str} by\n"
        f"<b>{ga1}–{gb1}</b>  ({scores})"
    )
    if m.get("is_doubles"):
        return base

    predicted  = m["name1"] if p_pre >= 0.5 else m["name2"]
    pred_mark  = "✅" if correct else ("❌" if correct is False else "–")
    return base + f"\nPredicted: {predicted}  {pred_mark}"


# ── Telegram ──────────────────────────────────────────────────────────────────

def tg_send(token: str, channel: str, text: str):
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": channel, "text": text, "parse_mode": "HTML"},
            timeout=10,
        )
        if r.status_code != 200:
            print(f"  [TG] HTTP {r.status_code}: {r.text[:200]}")
    except Exception as e:
        print(f"  [TG] error: {e}")


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
    if args.auto:
        from fetch_matches import WTT_2026_EVENT_IDS
        today = date.today()
        event_ids   = [
            eid for eid, (_, end) in WTT_2026_EVENT_IDS.items()
            if today - timedelta(days=args.lookback) <= date.fromisoformat(end) <= today + timedelta(days=args.lookback)
        ]
        event_names_map = {eid: WTT_2026_EVENT_IDS[eid][0] for eid in event_ids}
    else:
        event_ids = [args.event]
        try:
            from fetch_matches import WTT_2026_EVENT_IDS
            event_names_map = {args.event: WTT_2026_EVENT_IDS.get(args.event, (f"Event {args.event}",))[0]}
        except Exception:
            event_names_map = {args.event: f"Event {args.event}"}

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

    # Models
    print("Loading models...")
    mp = {}
    for g in ("M", "W"):
        try:
            mp[g] = MatchPredictor.load(g)
            print(f"  {g}: {len(mp[g].states)} players")
        except FileNotFoundError:
            print(f"  [!] No {g} model")
    if not mp:
        print("[!] No models found.")
        return
    print()

    total_sent   = 0
    already_sent = _load_sent()

    for eid in event_ids:
        ename = event_names_map.get(eid, f"Event {eid}")
        print(f"{'='*56}\n  {ename}  ({eid})\n{'='*56}")

        matches = fetch_todays_results(eid)
        print(f"  {len(matches)} completed match(es) today.")
        if not matches:
            continue

        # Batch-fetch all player info (singles IDs + individual IDs from doubles pairs)
        all_ids = set()
        for m in matches:
            if m["is_doubles"]:
                all_ids.update(m["players1"] + m["players2"])
            else:
                all_ids.add(m["id1"])
                all_ids.add(m["id2"])
        info_map  = fetch_player_info(db, list(all_ids))
        ename_db  = fetch_event_name(db, eid) or ename

        for m in matches:
            # India detection: use org codes from API (works for both singles and doubles)
            is_india = (m["org1"] == "IND" or m["org2"] == "IND")
            is_key   = _is_key_round(m["round"])
            if not is_india and not is_key:
                continue

            # Build player info dicts
            if m["is_doubles"]:
                cat = _doubles_category(m["round"])
                r1 = fetch_doubles_pair_rank(db, m["players1"], cat)
                r2 = fetch_doubles_pair_rank(db, m["players2"], cat)
                p1_info = {"country_code": m["org1"], "rank": r1}
                p2_info = {"country_code": m["org2"], "rank": r2}
                p_pre   = 0.5
                correct = None
            else:
                p1_info = info_map.get(m["id1"], {})
                p2_info = info_map.get(m["id2"], {})
                # Prediction for singles
                try:
                    key       = "W" if "Women" in m["round"] else "M"
                    predictor = mp.get(key) or next(iter(mp.values()))
                    sc        = predictor.predict_score(m["id1"], m["id2"])
                    p_pre     = sc["p_match"]
                except Exception:
                    p_pre = 0.5
                correct = ((p_pre > 0.5) == (m["result"] == "W")) if p_pre != 0.5 else None

            key = _sent_key(eid, m["id1"], m["id2"])
            if key in already_sent:
                print(f"  [SKIP] {m['name1']} vs {m['name2']} — already sent")
                continue

            msg = build_message(m, ename_db, p1_info, p2_info, p_pre, correct)

            t = m["start_utc"][11:16]
            print(f"  {'INDIA' if is_india else 'KEY  '} {t}  {m['name1']} vs {m['name2']}")

            if args.dry_run:
                print(f"\n{msg}\n{'─'*50}")
            else:
                tg_send(tg_token, tg_channel, msg)
                total_sent += 1
                _mark_sent(key)
                already_sent.add(key)
                time.sleep(0.4)   # avoid Telegram rate limit

    print(f"\nDone. {total_sent} message(s) sent.")


if __name__ == "__main__":
    main()
