# WTTC 2026 — Strategy & Probability Tool
## Product Requirements Document

**Date:** April 21, 2026
**Tournament:** ITTF World Team Table Tennis Championships Finals — London (April 28 – May 10, 2026)
**Owner:** TOPS / India National Coaching Staff

---

## 1. North Star Metric (NSM)

> **P(India wins a specific team tie) given a chosen lineup — and which alternative lineup maximises that probability.**

The tool answers one question before every match:
*"Coach, if you field Thakkar / Sathiyan / Shah against Slovakia — your win probability is 68%. If you swap Sathiyan for Harmeet in Rubber 2, it goes to 71%."*

---

## 2. What We Are NOT Building (Scope Boundary)

| Out of scope | Why |
|---|---|
| Live in-match dashboard (point-by-point) | Coaches can't change lineup mid-tie |
| Beautiful UX / web app | Simple tables and docs are sufficient |
| `benchmark_elite.py` analysis | Deferred to post-WTTC |
| Doubles-specific rating model | Insufficient data; using player Elo average |

---

## 3. What We Are Building

### 3.1 Tournament Probability Table
Pre-computed probability of India reaching each round across 10,000 simulated tournaments.

```
Stage          Men's    Women's
────────────── ──────── ────────
Group winner   91%       96%
Main Draw      97%       99%
Round of 32    63%       54%
Round of 16    38%       31%
Quarter-Final  14%        9%
Semi-Final      4%        2%
Gold            1%        0.4%
```

Refreshed daily as draws unfold.

### 3.2 Match Win Probability (per upcoming tie)
For any known upcoming opponent:
- P(India wins the tie) with current best lineup
- Rubber-by-rubber win probabilities
- How win probability changes depending on who we put in each rubber

### 3.3 Lineup Optimizer (the core tool)
Given India's 5-player squad and one opponent:
- Try all **C(5,3) = 10** player selection combinations
- For each selection, try key **rubber assignment permutations**
- Rank every option by P(win the tie)
- Output: a ranked table the coach can act on immediately

---

## 4. Tournament Format (ITTF Playing System V1.1)

### 4.1 Stages
| Stage | Teams | Format | Who advances |
|---|---|---|---|
| Stage 1a (G1–G2) | 8 elite teams | Round-robin of 4 | All 8 → Main Draw |
| Stage 1b (G3–G16) | 56 teams | Round-robin of 4 | 14 winners + 6 best runners-up → Main Draw direct; 8 remaining runners-up → Prelim Round |
| Prelim Round | 8 runners-up | 4 knockout ties | 4 winners → Main Draw |
| Main Draw | 32 teams | Single elimination R32→Final | — |

### 4.2 India's Groups
| Gender | Group | Teams |
|---|---|---|
| Men | G7 (Stage 1b) | **IND**, SVK, TUN, GUA |
| Women | G6 (Stage 1b) | **IND**, UKR, UGA, RWA |

### 4.3 Rubber Order (per tie — 4 singles + 1 doubles, first to 3)
```
R1: A₁ vs B₂
R2: A₂ vs B₁
R3: A₁+A₂ vs B₁+B₂  [doubles]
R4: A₃ vs B₃
R5: A₁ vs B₁          [if needed — decisive rubber]
```
Where A₁ = India's #1 selected player for this tie (not necessarily highest-ranked).

**Coach's decision = who plays A₁, A₂, A₃, and who sits out.**

---

## 5. Registered Squads

### Men's India
| Player | Current Rank |
|---|---|
| Manav Thakkar | ~47 |
| Sathiyan Gnanasekaran | ~67 |
| Manush Shah | ~68 |
| Harmeet Desai | ~90 |
| Payas Jain | — |

### Women's India
*(Sreeja Akula replaced by Sutirtha Mukherjee — official)*

| Player | Current Rank |
|---|---|
| Manika Batra | ~26 |
| Sutirtha Mukherjee | ~70 |
| Yashaswini Ghorpade | ~95 |
| Diya Chitale | ~110 |
| Syndrela Das | — |

---

## 6. Data: What We Have vs. What We Need

### 6.1 What We Have (already in Supabase)
| Data | Volume | Quality |
|---|---|---|
| Singles match results (WTT + ITTF) | 89,902 matches | Good |
| ITTF world rankings (normalized) | April 2026 | Good |
| Player profiles (name, country, DOB) | ~3,500 players | Good |
| Elo ratings (computed) | 3,175 players | Good |

### 6.2 What We Are Missing

**Critical gaps:**

1. **Team event match history** — Our DB has singles data only. We don't have historical team tie results (who beat whom 3-1, which rubbers were won). This means:
   - The simulation treats each rubber as an independent singles match
   - We cannot calibrate team-specific dynamics (some players perform differently in team vs individual events)
   - *Acceptable limitation for now — Elo per-player is the best available proxy*

2. **Doubles match data** — No doubles-specific Elo. Currently using average of two players' singles Elo.
   - *Known inaccuracy — doubles pairing chemistry is unmodelled*

3. **Head-to-head data for group opponents** — TUN, GUA, UGA, RWA players are rarely in major WTT events. Their Elo ratings will default to ~1450 (baseline).
   - *Will show India winning ~95%+ vs these opponents — which is likely accurate*

4. **SVK and UKR players** — In the DB but with fewer matches than top-tier players. Ratings are less reliable.

### 6.3 Do We Need Live Scrapers?

**Short answer: No, for this tool. Yes, for round-by-round updates.**

| Use case | Live scraper needed? |
|---|---|
| Pre-match lineup optimizer | ❌ — historical Elo is sufficient |
| Tournament bracket probabilities | ❌ — pre-computed daily |
| After each round: update who India faces next | ✅ — need completed tie results |
| Update Elo after each tie's singles results | ✅ — but low priority |

**What we need for WTTC specifically:**
- A lightweight scraper that checks WTT's WTTC results page after each round and updates the bracket
- The existing `fetch_matches.py` can be adapted for this — same API, new event IDs
- **This is a one-time, low-effort adaptation, not a new scraper**

---

## 7. Architecture — Option C (Hybrid)

```
┌─────────────────────────────────────────────────────┐
│  PYTHON (runs daily via GitHub Actions)              │
│                                                       │
│  elo_ratings.py → compute ratings for all players    │
│  wttc_2026_predict.py → 10k Monte Carlo runs        │
│  → store results in Supabase table: wttc_sim_results │
└─────────────────────────────────────────────────────┘
            ↓ stored
┌─────────────────────────────────────────────────────┐
│  SUPABASE                                            │
│  Tables: wtt_players, elo_ratings, wttc_sim_results  │
└─────────────────────────────────────────────────────┘
            ↓ read
┌─────────────────────────────────────────────────────┐
│  PYTHON (runs on demand — the actual tool)           │
│                                                       │
│  lineup_optimizer.py                                  │
│  → takes: India squad + opponent country              │
│  → enumerates all 10 squad selections × rubber orders │
│  → outputs ranked table: Lineup → P(win)             │
│  → outputs as .txt / .csv for coach's use            │
└─────────────────────────────────────────────────────┘
```

**No web frontend needed. Output is a text table or CSV that can be copy-pasted into a doc.**

---

## 8. Step-by-Step Build Plan

### Step 1 — Verify Data Quality ✅ (done)
- Elo computed for 3,175 players from 89,902 matches
- Official squads and groups loaded into `wttc_2026_predict.py`

### Step 2 — Store Elo Ratings in Supabase (1 day)
**Why:** `lineup_optimizer.py` needs to read Elo without recomputing 89k matches every run.
**What:** Add a `player_elo` table. After each `compute_elo()` run, write results to DB.
**Script:** Add `save_elo_to_db()` to `elo_ratings.py`

### Step 3 — Build `lineup_optimizer.py` (1–2 days)
The core tool. Logic:

```
INPUT:
  - India squad (5 players with Elo ratings)
  - Opponent squad (3 players with Elo ratings)
  - Gender (M/W)

PROCESS:
  For each combination of 3 from India's 5 (C(5,3) = 10):
    For each assignment to positions A₁, A₂, A₃ (key permutations):
      Simulate 1,000 ties (fast — 5 rubbers each)
      → P(India wins) = ties won / 1000

OUTPUT (sorted by P(win)):
  Rank | A₁          | A₂          | A₃          | P(win) | R1  | R2  | R3  | R4  | R5
  1    | Thakkar     | Sathiyan    | Shah        | 68.3%  | 74% | 62% | 58% | 55% | 74%
  2    | Thakkar     | Shah        | Sathiyan    | 65.1%  | 74% | 55% | 58% | 62% | 74%
  ...
  10   | Harmeet     | Payas       | Sathiyan    | 31.2%  | 45% | 28% | 36% | 38% | 45%
```

Also output: **sensitivity analysis**
"If Thakkar has an off-day (Elo -100), best lineup becomes X with P(win) = Y%"

### Step 4 — Store & Refresh Tournament Probabilities (1 day)
- Create Supabase table `wttc_sim_results`: `{gender, team, result, probability, computed_at}`
- `wttc_2026_predict.py` writes here after each run
- GitHub Actions runs daily during tournament (Apr 28 – May 10)

### Step 5 — Tournament Path Output (0.5 days)
Simple script that reads `wttc_sim_results` and prints:

```
INDIA MEN'S — WTTC 2026 London — as of April 28
═════════════════════════════════════════════════
Group Stage (G7):
  vs GUA  →  P(win) = 97%  [Thakkar/Sathiyan/Shah]
  vs TUN  →  P(win) = 89%  [Thakkar/Sathiyan/Shah]
  vs SVK  →  P(win) = 71%  [Thakkar/Shah/Harmeet — optimizer recommends]

Expected group finish: 1st (91% probability)
If 2nd in group: enters best runners-up pool (P direct qual = 73%)

Main Draw path:
  R32    →  P(reach) = 97%
  R16    →  P(reach) = 63%  [likely opponent: DEN or POL]
  QF     →  P(reach) = 38%  [likely: JPN or FRA — P(beat) = 22%]
  SF     →  P(reach) =  4%
```

### Step 6 — Round-by-Round Update Script (1 day)
After each round, run:
```
python scripts/wttc_update_results.py --round R32
```
- Fetches completed tie results from WTT API (same API as `fetch_matches.py`)
- Updates bracket: who is India's actual next opponent
- Re-runs Monte Carlo with updated bracket
- Outputs new probability table

---

## 9. Key Model Assumptions & Limitations

| Assumption | Impact | Confidence |
|---|---|---|
| Each rubber is independent | Ignores momentum shifts | Medium — acceptable |
| Doubles = average of two players' Elo | Undervalues good doubles pairs | Low accuracy but consistent |
| TUN/GUA/UGA/RWA opponents at ~Elo 1450 | May overestimate India's win % | High — these are genuinely weak teams |
| Elo doesn't capture in-form/injury/travel fatigue | Can't be modelled without daily data | Medium risk |
| Rubber order: R1=A₁vsB₂, R2=A₂vsB₁, R3=Doubles, R4=A₃vsB₃, R5=A₁vsB₁ | If ITTF uses different order, optimizer rankings change | **Needs confirmation from Playing System PDF** |

---

## 10. What the Coaches Get (Deliverables per Match)

### Before each tie (delivered as a text/CSV file):

**File 1: `IND_vs_SVK_men_lineup.txt`**
- Top-3 recommended lineups ranked by P(win)
- Per-rubber win probabilities for each
- Sensitivity: best lineup if player X is unavailable

**File 2: `tournament_path_update.txt`**
- Updated tournament probabilities after each round
- India's most likely upcoming opponents
- P(India reaches medal round)

---

## 11. Build Priority Order

| Priority | Item | Status | Effort |
|---|---|---|---|
| P0 | `elo_ratings.py` — working | ✅ Done | — |
| P0 | `wttc_2026_predict.py` — official groups + squads | ✅ Done | — |
| P1 | Store Elo to Supabase (`player_elo` table) | ⏳ | 0.5 day |
| P1 | `lineup_optimizer.py` — core tool | ⏳ | 1.5 days |
| P1 | Confirm rubber order from Playing System PDF | ⏳ | 30 min |
| P2 | `wttc_update_results.py` — round-by-round updater | ⏳ | 1 day |
| P2 | Store simulation results to Supabase | ⏳ | 0.5 day |
| P3 | Sensitivity / what-if analysis in optimizer | ⏳ | 0.5 day |

**Tournament starts April 28. We have ~7 days. P1 items are the entire value of the tool.**

---

## 12. Open Questions (need answers to proceed)

1. **Rubber order**: What is the exact rubber sequence in the Playing System PDF? (R1 player assignment)
2. **Doubles pair**: Who is India's designated doubles pair for Men's and Women's? This changes R3 calculation.
3. **Supabase service key**: Needed to run `lineup_optimizer.py` locally. Available?
4. **Opponent squad depth**: SVK (Men) and UKR (Women) are the only non-trivial group opponents. Do we have their Elo data in DB?
