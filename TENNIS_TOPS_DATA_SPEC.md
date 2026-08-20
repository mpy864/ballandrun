# Tennis TOPS Dashboard — Data Point & Source Specification

Working document. Maps every clause of the SAI TOPS Tennis Athlete Selection Policy
(Draft) to the data fields required to evaluate it automatically, and the source each
field must come from.

Status legend for **Have?**:
- **YES** — already in Supabase today
- **PARTIAL** — field exists but incomplete / wrong grain / not backfilled
- **NO** — not captured anywhere
- **INTERNAL** — no public source exists; must come from SAI / AITA / NCSSR

---

## 0. Summary of the four blocking gaps

| # | Gap | Blocks | Severity |
|---|-----|--------|----------|
| 1 | `tennis_matches` has no tournament identity or **event level** | Every achievement criterion (§3.1.1, §3.1.2, §4.1.2, §5.1.2) — ~60% of the policy | Critical |
| 2 | No **date of birth** on athletes | All of §4 (Development), all of TAGG Jr Dev, the U24/U22 achievement bands | Critical |
| 3 | No **ITF Junior rankings** | §4.1.1(a)/(b) junior columns, TAGG Jr Dev | Critical |
| 4 | No **internal athlete-status store** (induction, review, warning, injury, fitness, sanctions) | §3.2, §4.2, §5.2, §6, §7, §8 — i.e. all of retention & exclusion | Critical |

Gaps 1–3 are engineering work on existing pipelines. Gap 4 is a new data-entry
surface — the dashboard must become a system of record, not just a viewer.

---

## 1. Athlete master (`tennis_athletes`)

Required by: everything.

| Field | Type | Required by | Source | Have? |
|---|---|---|---|---|
| `athlete_id` | uuid PK | all | internal | NO |
| `full_name` | text | all | AITA registry | YES (`tennis_players.name`) |
| `gender` | M/W | all criteria are gender-split | AITA / tour | PARTIAL (inferred from `tour`) |
| `date_of_birth` | date | **§4 all**, §4.1.2 U24/U22, TAGG Jr 14–18 | AITA registration · ITF IPIN · ATP/WTA profile | **NO** |
| `age_at_review` | derived | §4.1.1, §4.1.2, §4.2 | computed — *see Q5* | NO |
| `ioc` | text | filter to IND | tour | YES |
| `atp_id` / `wta_id` | text | ranking join | ATP/WTA | PARTIAL |
| `itf_ipin` | text | ITF junior + ITF World Tour join | ITF | NO |
| `aita_id` | text | domestic join, DOB source of truth | AITA | NO |
| `te_slug` | text | current scraper key | tennisexplorer | YES (`player_id`) |

> **Identity resolution is its own task.** ATP, WTA, ITF Junior, ITF World Tour, AITA
> and tennisexplorer all use different player IDs and different name formats
> ("Last First" vs "First Last"). A crosswalk table with manual override is required
> before any criterion can be evaluated reliably.

---

## 2. Rankings (`tennis_rankings` — extend)

Required by: §3.1.1, §3.1.2, §4.1.1(a)/(b), §5.1.1, §5.2.

| Field | Required by | Source | Have? |
|---|---|---|---|
| `tour` (ATP/WTA/ITF_JR) | all ranking rules | — | PARTIAL (no ITF_JR) |
| `discipline` (singles/doubles) | §3.1.1 vs §3.1.2, §5.1.1 | ATP/WTA | PARTIAL (doubles rank not stored separately) |
| `ranking_date` (weekly) | §5.1.1, §5.2 weeks-held counts | ATP/WTA publish Mondays | YES |
| `rank`, `points` | all | — | YES |
| `is_protected` | §6 injury pause | ATP/WTA PR list | NO |

**Grain requirement:** weekly snapshots retained **indefinitely**, not just current.
Three rules count time-at-rank:

- §5.1.1 TAGG inclusion — rank held **≥12 weeks within a 6-month window**
- §5.2 TAGG retention — rank held **≥26 weeks in a year** from induction date
- §4.2 / §3.2 — point-in-time at review, but the trend drives the warning decision

Current `fetch_tennis.py` writes one snapshot per run and only for players surfaced
on the India-filtered pages. Needs: (a) a weekly scheduled run, (b) a historical
backfill of at least 3 years, (c) an ITF Junior equivalent, (d) doubles ranks
persisted with `discipline='doubles'`.

### 2a. ITF Junior rankings — new pipeline
Needed for §4.1.1(a) ages 15–18, §4.1.1(b) ages 14–18, and the TAGG Junior Dev cohort.
Fields: `itf_ipin`, `ranking_date`, `combined_rank`, `points`, `events_counted`.
Source: itftennis.com junior rankings (country filter IND). No current scraper.

---

## 3. Tournaments & results — **the main build**

This is gap #1. Two new tables.

### 3a. `tennis_event_levels` — reference/taxonomy table

The policy references event tiers by name. Before anything can be evaluated, each
tier needs a canonical code and a mapping from the raw strings each source emits.

| `level_code` | Tour | Policy clauses citing it |
|---|---|---|
| `GS` Grand Slam | ATP/WTA | §3.1.1, §3.1.2, §4.1.2 |
| `OLY` Olympics | — | §3.1.1, §3.1.2, §5.1.2 |
| `M1000` Masters 1000 / `W1000` | ATP/WTA | §3.1.1 |
| `A500` / `W500` | ATP/WTA | §3.1.1, §3.1.2, §4.1.2 |
| `A250` / `W250` | ATP/WTA | §3.1.1, §3.1.2 |
| `W125` / `CH125` | WTA 125 / Challenger 125 | §5.1.2 |
| `CH50` `CH75` `CH100` `CH175` | ATP Challenger | §4.1.2 |
| `M15` `M25` (ITF Men) | ITF | §4.1.2 |
| `W15` `W35` `W50` `W75` `W100` | ITF Women | §4.1.2 |
| `JGS` `J500` `J300` `J200` `J100` | ITF Junior | §4.1.2 / TAGG Jr |
| `DC` Davis Cup / `BJK` BJK Cup | ITF | §5.1.2 |
| `AG` Asian Games | OCA | §5.1.2 |

> ⚠️ **The policy's terminology does not map cleanly.** §4.1.2 says *"ATP/ITF 75"*,
> *"ATP 50"*, and *"ATP Challenger 75"*. There is no "ATP 50" or "ATP 75" tier —
> these are presumably **Challenger 50 / 75**, or possibly ITF **M15/M25** as the
> men's mirror of ITF **W50/W75**. This must be pinned down before the taxonomy is
> frozen. *See Q2.*

### 3b. `tennis_tournaments`

| Field | Required by | Source |
|---|---|---|
| `tournament_id`, `name`, `year` | all achievements | ATP/WTA/ITF |
| `level_code` → `tennis_event_levels` | **all achievements** | derived from source category |
| `start_date`, `end_date` | 12-month rolling windows (§3.1.2, §5.1.2) | ATP/WTA/ITF |
| `surface`, `city`, `country` | context/UI | YES on matches |
| `draw_size` | validating round codes | ATP/WTA/ITF |

### 3c. `tennis_results` (player × tournament × discipline)

One row per athlete per event — this is what criteria actually query, rather than
reconstructing from match rows.

| Field | Type | Required by | Source | Have? |
|---|---|---|---|---|
| `athlete_id` | fk | all | — | — |
| `tournament_id` | fk | all | — | **NO** |
| `discipline` | singles/doubles | §3.1.1 vs §3.1.2 | — | PARTIAL |
| `entry_type` | DA / **Q** / WC / LL / PR | **§4.1.2 "main-draw entry … through qualifiers"** | ATP/WTA/ITF entry lists + qualifying draws | **NO** |
| `round_reached` | W/F/SF/QF/R16/R32/R64/R128/Q3/Q2/Q1 | **all achievements** | draws | PARTIAL (per-match `round` only) |
| `is_title` | bool | §3.1.1 250 winner, §3.1.2 two 250 titles, §4.1.2 | derived | NO |
| `partner_athlete_id` | fk | §3.1.2 pair support | doubles draws | PARTIAL |
| `partner_ioc` | text | pair support needs an **Indian** partner | tour | NO |
| `seed`, `opponent_ranks` | — | §3.1.1 rationale ("beat top-30"), expert review | draws | NO |

**`entry_type` is the hardest field.** It is not present in match-result scrapes at
all — it requires the qualifying draw or the published entry list. Options: (a) infer
"came through qualifying" by detecting Q-round wins immediately preceding a main-draw
appearance at the same event; (b) ingest ITF/ATP entry lists directly; (c) manual flag.
Recommend (a) as automated, with (c) as override.

---

## 4. Derived aggregates (materialised views)

These are what the dashboard's verdict engine reads.

| View | Definition | Serves |
|---|---|---|
| `v_best_result_by_level` | best `round_reached` per athlete × level × discipline, **all-time and trailing 12/24m** | §3.1.1, §3.1.2, §4.1.2 |
| `v_titles_rolling_12m` | count of `is_title` per level, trailing 12 months | §3.1.2 (two 250 titles), §5.1.2 |
| `v_weeks_at_rank` | weeks with rank ≤ N, over an arbitrary window | §5.1.1 (12/26wk), §5.2 |
| `v_pair_history` | events played together, first & last date, per athlete pair | §3.1.2 pair support (**≥10 competitions over ≥6 months**) |
| `v_age_band_target` | athlete's age → required ATP/WTA/ITF-Jr rank from the §4.1.1 matrices | §4.1.1(a)/(b), §4.2 |
| `v_criteria_status` | per athlete × cohort: which criteria are met, which is closest, gap-to-threshold | the whole dashboard |

The §4.1.1 matrices themselves are **reference data**, not fetched data — encode them
declaratively alongside [src/lib/topsCriteria.js](src/lib/topsCriteria.js), versioned in
git so every policy revision is reviewable in a diff.

---

## 5. Internal athlete status — no public source (gap #4)

None of this exists in any feed. The dashboard must capture it, or read it from a SAI
system of record. **Without this, retention and exclusion cannot be shown at all.**

### 5a. `tops_membership` — §1, §3.2, §4.2, §5.2
| Field | Required by |
|---|---|
| `cohort` (CORE / DEV / TAGG / TAGG_JR) | §1 |
| `discipline_supported` (singles / doubles / both) | §3.1.1 vs §3.1.2 |
| `induction_date` | §5.2 ("from the date of inclusion"), §4.2 windows |
| `induction_route` (RANKING / ACHIEVEMENT / EXPERT) | **§4.2 — the proving window differs by route** |
| `proving_window_end` | derived, §4.2 |
| `is_pair_support`, `pair_partner_id` | §3.1.2 |
| `status` (ACTIVE / WARNED / LEEWAY / PAUSED / EXCLUDED) | §3.2, §4.2, §5.2 |

### 5b. `tops_reviews` — §3.2, §4.2, §5.2, §8
`review_date`, `reviewed_by`, `criteria_met[]`, `outcome`
(RETAINED / WARNED / SHIFTED_COHORT / EXCLUDED), `warning_issued_date`,
`leeway_end_date` (= warning + 6 months), `mocecision_ref`, `written_notice_date`.

### 5c. `tops_medical_pause` — §6
`pause_start`, `pause_end`, `injury_cert_ref`, `validated_by` (HPD Tennis / AITA),
`ncssr_validation_ref`, `approved_by_tops_date`, `fit_to_play_cert_ref`,
`fit_to_play_date`, `cumulative_pause_days` (**cap 365**).
Every proving-window and review-date calculation must subtract approved pause days.

### 5d. `tops_fitness_tests` — §7
`test_date`, `conducted_by` (HPD / AITA), `result` (PASS/FAIL), `components[]`,
`fit_to_play_cert_ref`, `submitted_to_tops_date`, `next_due_date` (annual).

### 5e. `tops_sanctions` — §7
`type` (ANTI_DOPING / DISCIPLINARY), `authority` (NADA / ITF / AITA), `start_date`,
`end_date`, `ref`. **Overrides everything — immediate exclusion for the duration.**
Semi-public source: NADA sanction list, ITF anti-doping decisions.

### 5f. `tops_expert_nominations` — §4.1.3
`nominated_by`, `nomination_date`, `justification`, `competent_authority_approval`,
`approval_date`.

### 5g. `tops_exclusions` — §7, §8
`exclusion_date`, `reason_code` (FAILED_RETENTION / SANCTION / VOLUNTARY_WITHDRAWAL /
RETIREMENT / UNAVAILABILITY / MISREPRESENTATION), `moc_decision_ref`,
`reinstatement_eligible_from` (= exclusion + 6 months).

---

## 6. Multi-sport event history — §5.1.2

| Data point | Source | Have? |
|---|---|---|
| Asian Games previous edition — singles finish (top 8?), doubles finish (top 4?) | OCA official results · Olympedia | NO |
| Olympics previous edition — participation / qualification flag | IOC · ITF Olympic entry list | NO |
| Davis Cup / BJK Cup — ties, W-L, opponent rank, tie level | ITF Davis Cup & BJK Cup sites | NO |

Low volume (dozens of rows). **Recommend manual seed + annual update**, not a scraper.
Note §5.1.2's Davis/BJK limb is *"based on expert assessment"* — so the dashboard
should surface the record and let a human decide, rather than auto-evaluating it.

---

## 7. Source inventory & reliability

| Source | Provides | Access | Reliability |
|---|---|---|---|
| **tennisexplorer.com** *(current)* | ATP/WTA/ITF ranks, match history, DOB, tournament names | HTML scrape | Medium. Regex-based, breaks on markup change. Terms-of-use grey area. **Does carry tournament names and DOB — currently discarded by our parser.** |
| **ATP / WTA official** | Authoritative ranks, event level, draws, entry lists, seeds | No public API; bot-protected | High data quality, low access reliability |
| **ITF (itftennis.com)** | **Junior rankings**, ITF World Tour M/W results, entry lists, IPIN | Partial JSON endpoints | Medium-high. The only real source for juniors and W15–W100. |
| **AITA** | Indian player registry, DOB, AITA ID, domestic results | Manual / scrape | Authoritative for Indian athlete identity |
| **Jeff Sackmann `tennis_atp` / `tennis_wta`** | Historical match+tournament level, clean CSV | GitHub | Our scraper's docstring says taken private in 2025 — **verify**; if available it is by far the cheapest fix for gap #1's historical backfill |
| **OCA / Olympedia / IOC** | Asian Games, Olympic results | Manual | High, low volume |
| **NADA / ITF anti-doping** | Sanction lists | Published lists | High |
| **SAI / TOPS internal (MIS, athlete files)** | §5 in full — induction, reviews, medical, fitness, exclusions | Manual entry / integration | Sole source. Blocking. |
| **HPD (Tennis) / NCSSR** | Fitness test results, injury & Fit-to-Play certificates | Manual | Sole source |

**Priority fix:** the fastest path to unblocking gap #1 is to extend the *existing*
tennisexplorer parsers to capture the tournament name and category already present on
the page, plus DOB from the player header — rather than standing up a new source.
Level classification then becomes a string→`level_code` mapping problem, which is
tractable and auditable.

---

## 8. Open questions for the committee — these change the data model

| # | Question | Why it changes the build |
|---|---|---|
| **Q1** | **§3.2 Core retention = Core inclusion.** Three of four inclusion limbs are career-historical ("R16 at *any* Grand Slam"). Does a single R16 retain Core support indefinitely, or is there a rolling window? | Determines whether `v_best_result_by_level` needs trailing-window variants at all, and whether Core status can ever lapse on form. TAGG §5.1.2 already scopes to 12 months; Core does not. |
| **Q2** | What are **"ATP 50"**, **"ATP/ITF 75"**, **"ATP Challenger 75"** in §4.1.2? Challenger 50/75, or ITF M15/M25? | Freezes the `tennis_event_levels` taxonomy. Cannot be guessed. |
| **Q3** | §4.1.2's junior row (R16 Junior GS / QF J500 / SF J300 / Winner J200, **ages 14–18**) sits under **TOPS Development**, but 14–18 athletes are now defined as **TAGG Junior Development**. Does that row move to TAGG Jr Dev? | Decides which cohort the rule evaluates under — and TAGG Jr Dev currently has **no criteria section in the policy at all**. |
| **Q4** | §5.1.1 inclusion = rank held **12 weeks in a 6-month window**; §5.2 retention = **26 weeks in a year**. Consecutive or cumulative? Measured on published weekly ranking dates? | Defines `v_weeks_at_rank` semantics exactly. |
| **Q5** | Age computed **as at the review date**, as at **1 January**, or as at **event date**? | §4.1.1 bands and the U24/U22 achievement bands shift by up to a year depending on the answer. ITF junior eligibility conventionally uses a Jan-1 rule. |
| **Q6** | §3.1.2 pair support: "**10 competitions** over at least six months" — tournaments entered together, or matches played together? | Changes `v_pair_history` by roughly an order of magnitude. |
| **Q7** | §4.2: "retained for minimum 02 years **or till the age 18 years, whichever is higher**" — compares a duration to an age. Intended reading: max(induction + 2 years, 18th birthday)? | Defines `proving_window_end`. |
| **Q8** | Does the dashboard **record** review/warning/exclusion decisions (system of record), or only **display** them from a SAI system? | Determines whether §5's tables are write surfaces with auth + audit trail, or read-only mirrors. Large scope difference. |

---

## 9. Suggested build order

1. **DOB + identity crosswalk** — unblocks all of §4 and every age band. Small.
2. **Tournament + level capture** in existing scrapers → `tennis_tournaments`, `tennis_results`, `tennis_event_levels`. Unblocks ~60% of the policy.
3. **ITF Junior ranking pipeline** — unblocks §4.1.1 junior columns and TAGG Jr Dev.
4. **Criteria engine** — port the [topsCriteria.js](src/lib/topsCriteria.js) declarative pattern to tennis; encode §3, §4.1.1, §4.1.2, §5.1 with `auto: true/false` per limb.
5. **Internal status tables + entry UI** — §5. Unblocks retention, warning, leeway, exclusion, injury pause.
6. **Aggregate views + athlete verdict cards** — gap-to-threshold, next review date, warning countdown.
7. **Multi-sport event history** — manual seed, §5.1.2.

Items 1–3 are prerequisites; 4 and 5 can run in parallel once they land.
