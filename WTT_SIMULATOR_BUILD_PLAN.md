# WTT Event Simulator — Build Plan

_Last updated: 2026-06-28_

## 1. The goal in one sentence

Pick any WTT tournament (e.g. EventID 3242 = United States Smash 2026) and get a
**forecast of who will win** — each player's chance of reaching every round and
lifting the trophy — for every discipline (Men's/Women's Singles, Doubles, Mixed,
and Youth).

To do that we need three things working together:

1. **Get the data** — the entries (who's in) and the draw (who plays who).
2. **Build the bracket** — turn that data into a proper knockout tree.
3. **Simulate it** — play the bracket out thousands of times using a prediction
   model, and count how often each player wins.

This plan is organised as those three layers, plus how we roll it out across all
event types and keep it running automatically.

---

## 2. What already exists (so we reuse, not rebuild)

| Piece | File | Status |
|---|---|---|
| Results fetcher (played matches → Supabase) | `scripts/fetch_matches.py` | Works. Uses a **hardcoded list** of event IDs (not scalable). Pulls only *played* matches. |
| Match predictor (P(A beats B), Elo-based) | `scripts/feature_model.py` | Works. Keyed by player ITTF ID. This is our forecasting brain. |
| Tournament simulator | `scripts/wttc_simulate.py` | **Hardcoded** for the World Champs team event only. Not reusable as-is, but the Monte-Carlo + exact-DP patterns are good references. |
| Player profiles | `scripts/fetch_matches.py` (`ensure_players_in_db`) | Works. Auto-inserts new players from the WTT profile API. |
| Supabase tables | — | `wtt_events`, `wtt_players`, `wtt_matches_singles` exist. |

**Key facts established during investigation (2026-06-28):**

- **Entries + draws come from one endpoint:** the WTT `schedule.json` feed gives
  entries, seeds, qualifier flags, player IDs, and the full bracket — across all
  disciplines, for played *and* unplayed matches.
  Pattern: `…/websitecacheddata/{event_id}/schedule/schedule.json?q={timestamp}`.
  Response is **Brotli-compressed** (`Content-Encoding: br`) — must be decoded.
- `GetOfficialResult` (used by `fetch_matches.py`) only returns *played* matches,
  so it is **not** a draw source.
- The **WTT handbooks** (Series & Feeder 2026, Youth 2026) give fixed, authoritative
  tables for draw sizes, seed counts, seed positions, bye positions, match formats
  (Bo-N), and qualifying structures. This means **the bracket is deterministic** —
  we can build and forecast it from entries + seeds *before* WTT publishes the later
  rounds.

---

## 3. Layer 1 — Get the data

### 3.1 `schedule.json` fetcher (new: `scripts/fetch_schedule.py`)

A small module that, given an `event_id`, returns a clean, structured list of
matches. Responsibilities:

- Build the URL with a fresh timestamp; GET with the WTT headers.
- **Decode the body robustly** — try plain UTF-8, then Brotli, then gzip/deflate
  (the CDN sometimes varies). This is already proven in the 3242 prototype.
- Walk `Competition[].Unit[]` and, for each match unit, extract:
  - `SubEvent` (e.g. "Men's Singles"), `Round` (e.g. "R64-", "RND3", "R32-"),
    `Code` (encodes discipline + round + bracket position).
  - Both competitors: ITTF ID (`Code`/`IfId`), name, country, **Seed**,
    **Qualifier** flag, birthdate, gender.
  - `PreviousUnit` links (which matches feed this slot) — useful later for
    verifying advancement.
  - Bo-N hint (`MaxGamesPerIndividualMatch`) — usually blank pre-event, so we fall
    back to the handbook (see §4.2).
- De-duplicate units by `Code` (the feed lists the same match under several
  schedule statuses; keep one).

Output: a list of dicts ready to upsert, plus a parsed bracket position from `Code`.

### 3.2 Calendar auto-discovery (new: `scripts/fetch_calendar.py`)

Replace the ~150-line hardcoded `WTT_2026_EVENT_IDS` dict with the WTT event
calendar API so new tournaments appear on their own.

- Pull the calendar, store each event (id, name, tier, start/end dates, location)
  into `wtt_events`.
- Tag each event with its **tier** (Grand Smash / Champions / Finals / Star
  Contender / Contender / Feeder / Youth-*) — needed to pick the right handbook
  rules.
- `fetch_matches.py` and the new fetchers then iterate over the DB, not a constant.

> Until the calendar endpoint is confirmed, keep the hardcoded dict as a fallback so
> nothing breaks. Migrating is a clean swap behind `get_recent_event_ids()`.

### 3.3 Storage schema (new tables)

Keep it simple and additive — do not touch `wtt_matches_singles`.

- **`wtt_entries`** — one row per (event, sub_event, player):
  `event_id, sub_event, player_id, seed, is_qualifier, is_host_wildcard,
  draw_status (main/qualifying/wait), last_updated`.
- **`wtt_draw_matches`** — the bracket, played or not (a draw is just matches
  without scores):
  `match_id, event_id, sub_event, round, bracket_position, comp1_id, comp2_id,
  comp1_seed, comp2_seed, comp1_is_qualifier, comp2_is_qualifier, winner_id,
  game_scores, best_of, feeds_into (next bracket_position), last_updated`.
- (Doubles/mixed: store the pair as two player ids per side, or a `pair_id`.)

A nightly job upserts entries + draw_matches from `schedule.json`. Results simply
fill in `winner_id`/`game_scores` as play happens. Re-running is idempotent
(upsert on `match_id`), matching the existing pattern in `fetch_matches.py`.

---

## 4. Layer 2 — Build the bracket (deterministic)

### 4.1 Handbook rule tables (new: `scripts/wtt_rules.py`)

Encode the handbook's fixed tables once, as plain Python lookups keyed by
`(tier, sub_event, draw_size)`:

- **Draw structure:** draw size → number of seeds → byes → rounds.
  (e.g. Grand Smash singles: 64 draw, 16 seeds, 0 byes, R64→R32→R16→QF→SF→F.)
- **Seed positions:** exact draw-sheet slot for each seed (Seed 1 → slot 1, Seed 2
  → last slot, etc.) — straight from handbook §3.2.
- **Bye positions:** which seed slots get byes in 24/48/96 draws.
- **Match format (Bo-N) per round per tier** — see §4.2.
- **Qualifying type** per tier: knockout vs round-robin groups (snake seeded).

### 4.2 Match format table (confirmed from handbook)

| Tier | Singles main draw | Qualifying | Doubles/Mixed |
|---|---|---|---|
| Grand Smash | Bo5 (R64,R32,R16) → **Bo7 (QF,SF,F)** | Bo5 | Bo5 |
| Champions | Bo5 → Bo7 (QF,SF,F) | – | – |
| Finals | **Bo7 (all)** | – | Mixed Bo5 |
| Star Contender / Contender | Bo5 → **Bo7 (Final only)** | Bo5 | Bo5 |
| Feeder | Bo5 (all) | Bo5 | Bo5 |
| Youth Star Contender / Contender | Bo5 (all) | Bo5 (groups) | Bo5 |

### 4.3 Bracket builder (new: `scripts/build_bracket.py`)

Two modes, both producing the same tree object the simulator consumes:

1. **From the feed (preferred when available):** read the published first-round
   matches from `wtt_draw_matches`, order them by bracket position (parsed from
   `Code`), and link winners forward (M1+M2 → next slot, …) up to the final.
   This gives the *real* pairings (proven on 3242).
2. **From entries + seeds (projection, for pre-draw forecasting):** place seeds in
   their fixed positions, allocate byes, then fill remaining slots — enough to
   produce a valid bracket skeleton before WTT publishes it.

The tree is a list of rounds; each match knows its two slots and where the winner
advances. Qualifier slots are explicit placeholder nodes (see §5.3).

### 4.4 Qualifying engines

- **Knockout qualifying:** same builder as the main draw, smaller size; the N
  qualifiers are the round-N winners.
- **Group qualifying (Contender option + all Youth):** snake-seed players into
  groups, round-robin each group, then advance winners/runners-up (and a QER
  knockout playoff when 8 < groups < 16, per handbook). This is a **new engine**
  the current code doesn't have.

---

## 5. Layer 3 — The simulator

### 5.1 Generic knockout simulator (new: `scripts/simulate_event.py`)

Replace the WTTC-specific `wttc_simulate.py` with a generic engine:

```
simulate_event(event_id, sub_event, runs=20000):
    bracket = build_bracket(...)            # Layer 2
    for run in range(runs):
        play the bracket:
          for each match, p = P(A beats B) from the model (§5.2),
          adjusted for Bo-N (§5.4); flip a weighted coin; advance winner
        record how far each player got
    return per-player: P(win title), P(reach SF/QF/R16/...), expected round
```

- For exact head-to-head tie/round odds where useful, reuse the **exact DP**
  pattern from `wttc_simulate.py` (`p_win_tie`); for full-bracket title odds,
  Monte Carlo is simplest and flexible.

### 5.2 Predictor integration

- Use `feature_model.MatchPredictor` to get `P(player A beats player B)` from two
  ITTF IDs (it already uses all-time + recent Elo and form features built from the
  match history in Supabase).
- This is the single line that turns the seed-based "chalk" placeholder (used in the
  3242 prototype) into a real probabilistic forecast.

### 5.3 Qualifier & cold-start handling

- **Qualifier placeholder slots** in the main draw: either (a) simulate qualifying
  first and feed real winners in, or (b) treat the slot as a distribution over the
  likely qualifiers. Start with (a) where qualifying data exists, fall back to a
  generic "average qualifier" strength otherwise.
- **Cold-start players** (qualifiers, juniors, comebacks with little history): the
  Elo model is unreliable, so add a **fallback prior** from world ranking or seed,
  blended with whatever history exists. Prevents coin-flip nonsense.

### 5.4 Match length (Bo-N)

The model gives a per-*match* win probability; we must adjust it to the right
best-of-N for that round (from §4.2). Convert a single-game/edge estimate into a
Bo5 vs Bo7 match probability so longer formats correctly favour the stronger
player. (Read the format from the rule table, not the feed.)

### 5.5 Outputs

- A forecast table per event/sub-event: player, P(title), P(final), P(SF), …,
  expected finish.
- Persist to a `wtt_forecasts` table and/or export to the dashboard/CSV.
- A human-readable bracket dump (like the 3242 prototype) but with probabilities.

### 5.6 Doubles / mixed

The current model is singles-Elo only. For pairs:
- Short term: a simple pair rating (combine partners' singles Elo) so doubles/mixed
  run end-to-end, clearly flagged as approximate.
- Later: a proper pair-rating model trained on doubles results
  (`fetch_doubles_matches.py` already collects the data).

### 5.7 Live re-simulation

Once play starts, re-run the forecast conditioned on actual results (lock decided
matches, re-simulate the rest). `live_updater.py` already tracks live/finished
matches and can trigger this.

---

## 6. Coverage rollout (order of work)

1. **Senior Singles** — strongest model, simplest brackets. Ship first (incl. 3242).
2. **Senior Doubles / Mixed** — add pair ratings + 24-draw bye handling.
3. **Youth** — add ITTF *Youth* Ranking ingestion (a separate ranking list, likely
   not yet collected) + group-qualifying engine + KO16 main draws.

---

## 7. Automation

- Reuse the existing GitHub Actions / daily cadence.
- Phases per event, driven by `wtt_events` dates:
  - **Pre-event:** fetch entries + draws (`fetch_schedule.py`), build brackets,
    run pre-tournament forecast.
  - **During:** `live_updater.py` → re-simulate.
  - **Post:** `fetch_matches.py` keeps results (existing flow).
- A forward-looking window (upcoming events) plus the existing backward window
  (recently finished) so both forecasting and results stay current.

---

## 8. Known gaps / risks (be honest about these)

| Gap | Impact | Mitigation |
|---|---|---|
| Calendar endpoint not yet confirmed | Can't fully auto-discover | Keep hardcoded dict as fallback; confirm endpoint early |
| Cold-start players (qualifiers/juniors) | Weak predictions | Ranking/seed prior blend (§5.3) |
| Doubles/mixed model | Approximate until trained | Pair-rating placeholder, flag clearly |
| Youth ranking data not collected | Youth seeding/ratings unavailable | Add ITTF Youth Ranking fetcher before youth coverage |
| Draw is provisional pre-event | Forecast shifts as draw changes | Re-fetch nightly; mark forecasts provisional |
| Bo-N → match-prob conversion accuracy | Slight bias if mis-tuned | Calibrate against historical results (validation scripts exist) |

---

## 9. Milestones

- **M1 — Data foundation:** `fetch_schedule.py`, `wtt_entries` + `wtt_draw_matches`
  tables, nightly upsert. Calendar discovery (or fallback). _Low risk, additive._
- **M2 — Rules + bracket:** `wtt_rules.py` (handbook tables), `build_bracket.py`
  (feed + projection modes), knockout qualifying.
- **M3 — Singles simulator:** `simulate_event.py` wired to `feature_model.py`,
  Bo-N handling, qualifier/cold-start logic, `wtt_forecasts` output. Validate on a
  completed past event.
- **M4 — Doubles/mixed:** pair ratings, 24-draw byes.
- **M5 — Youth:** youth ranking ingestion, group-qualifying engine.
- **M6 — Live:** re-simulation on results via `live_updater.py`.

---

## 10. First concrete step

Build **M1 + a thin slice of M2/M3 for singles** so we can replace the seed-based
"chalk" projection in the 3242 prototype with a real model-driven forecast and see
title odds for US Smash Men's & Women's Singles. Everything is additive (new files,
new tables) so existing pipelines keep working.
