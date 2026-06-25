# Live Demo Script — TOPS Table Tennis Intelligence Dashboard
**Audience:** Secretary, Sports + Olympic discipline decision-makers
**Goal:** Showcase what's been built — a working, data-backed athlete intelligence system for TT — as a proof point for what data-driven Olympic preparation can look like.
**Live URL:** https://ballandrun.com
**Suggested length:** 15–18 min demo + 10 min Q&A

---

## Pre-demo checklist (do this the morning of, not the night before)

- [ ] Confirm `ballandrun.com` loads and renders (not blank) — hard refresh, check on the venue's actual wifi/projector laptop, not just your machine.
- [ ] Confirm you're logged in with an account that has access to all routes (everything except `/live` requires auth).
- [ ] Open `/tournament` and check the Tournament Odds tab actually shows numbers, not "No simulation data yet." If stale, re-run `python scripts/wttc_simulate.py --gender M --runs 5000 --push` (and `--gender W`) beforehand.
- [ ] Pick 1–2 real Indian players you'll drill into on `/player/:id` — pick ones with a clean, interesting story (a rank climb, a recent upset, a strong tournament run) rather than whoever's first alphabetically. The Sarthak Arya / Sreejani Chakraborty data we just pulled (76% and 69% win rates, tournament titles in the last year) are good examples.
- [ ] Close all unrelated browser tabs. Bookmark the 5 URLs you'll visit in order, in a single bookmark folder, so you're not typing URLs live in front of the room.
- [ ] Have a fallback: a few screenshots/exported CSVs in case wifi or the live site has issues. (We already have `player_results_last_year.csv` and `best_performance_per_tournament.csv` as backup evidence.)

---

## Opening framing (1–2 min, before touching the screen)

Say this, don't read it verbatim — but hit these beats:

> "Right now, when a coach picks a lineup, or a federation decides who gets funded for the next Olympic cycle, those decisions are made from memory, spreadsheets, and gut feel. What I want to show you today is what it looks like when every match an Indian player has ever played — internationally, at every age group — is sitting in one system, queryable in real time.
>
> This isn't a concept. It's live, in production, today, for table tennis. I'm going to show you four things: where India stands across every age group and discipline, what a single athlete's performance story looks like, how we compare players head-to-head for selection decisions, and how we're using simulation to forecast outcomes at an upcoming World Championship.
>
> The point isn't just table tennis. It's that this pattern — ingest results, compute the metrics that matter, make it visual and queryable — works for any discipline with a results trail."

---

## Screen 1 — India Dashboard (`/`) — "Where do we stand, right now"
**~3 min**

Navigate to the root URL. This is the landing page — the 30,000-foot view.

**Show:**
- Scroll through the discipline groupings (Men's Singles, Women's Singles, Doubles) × age levels (Senior down to U11).
- Point at a player with a green up-arrow (rank improving) and one highlighted in the top-50/top-10 band.

**Say:**
> "This is every ranked Indian player, every discipline, every age category, pulled live from the same database the international federation publishes rankings from. No one is manually updating this — it refreshes itself. If I were Secretary Sports, this is my Monday-morning view: who's moving up, who's stalled, where are we deep and where are we thin."

**Caveat to pre-empt a question:** if asked about senior doubles, say plainly: *"Senior doubles is the one gap — we haven't ingested that data source yet. Everything else here is live."* Don't get caught flat-footed on this; naming it yourself reads as competence, not weakness.

---

## Screen 2 — Player Profile (`/player/:ittf_id`) — "One athlete's full story"
**~4 min**

Click into your pre-picked player.

**Show, in order:**
1. **Rank tab** — the rank-history chart, point at the peak marker.
2. **Performance tab** — this is the centerpiece. Walk through 2–3 of the OKR metrics: win rate, win rate against top-50/top-100 opponents specifically, "clutch index" (deuce/close-game performance), momentum streaks.
3. **Win/Loss tab** — breakdown by opponent rank tier or by country, whichever tells the better story for this player.

**Say:**
> "This is the question every selector actually wants answered: not just 'did they win,' but 'who did they beat, how often do they win the close ones, are they trending up or down right now.' This used to take a coach hours of going through scoresheets. It's instant here."

If you have the win/loss numbers from the export we ran (e.g., "76% win rate, finals appearance in the last 12 months"), cite the specific number out loud — concrete numbers land better than describing a UI.

---

## Screen 3 — Head-to-Head Comparison (`/h2h`) — "Selection decisions, side by side"
**~3 min**

Pick 2–3 players in the same category (e.g., competing for the same national-team slot).

**Show:**
- Add them to the comparison, overlay their rank-history lines.
- Filter by event tier or opponent rank bucket to show how the comparison changes under different lenses.

**Say:**
> "When two players are close on raw ranking but a selection has to be made, this is where the real conversation happens — who performs better against quality opposition, who's trending the right direction heading into trials. This turns a debate into a data-backed conversation."

---

## Screen 4 — WTTC 2026 Tournament Simulator (`/tournament`) — "Forecasting the Olympic cycle"
**~4 min**

This is the forward-looking, highest-impact screen for an Olympics-focused audience — save it for near the end.

**Show:**
- **Tournament Odds tab**: India's stage-by-stage probability (Group winner → Main Draw → R32 → ... → Gold) for the WTTC 2026 Finals in London, from a 5,000-run Monte Carlo simulation.
- **Group Breakdown tab**: the exact round-robin group India is in, with every outcome path enumerated and the resulting probability of advancing.

**Say:**
> "This isn't a guess — it's a simulation run thousands of times using each player's current rating and historical head-to-head patterns. We can tell you today, months before the tournament, what India's realistic path to a medal looks like, and how that changes if a player's form shifts between now and then. That's the kind of forward planning that turns a single tournament into part of a managed four-year cycle."

**If asked "can this pick the lineup for us":** be honest — *"Right now this gives us the probability picture at the team level. A rubber-by-rubber lineup optimizer is a logical next step, not something we've built yet."* (This capability genuinely doesn't exist yet — don't imply it does.)

---

## Closing — the ask / the vision (2 min)

> "Everything you just saw is built and running today, for one discipline, largely by [however you want to credit the team/effort]. The architecture — ingest results, compute athlete-level intelligence, make it visual for both coaches and administrators — isn't table-tennis-specific. The case I'd make to this room is: this is a template. Wherever there's a results trail — and every Olympic discipline has one — this same approach gives every federation the same clarity we just walked through for table tennis."

Then stop talking and take questions. Don't keep selling past this point.

---

## Anticipated questions and honest answers

| Question | Answer |
|---|---|
| "Is this live data or a demo?" | Live — pulled from the same source the database is built from, refreshed automatically. |
| "What about senior doubles / [some other gap]?" | Name the specific gap honestly (senior doubles isn't ingested yet) — don't overclaim. |
| "Can it predict who should be in the team?" | It gives probability and performance data to inform that decision; it doesn't make the selection call. Be clear lineup optimization is a future step, not built. |
| "How much did this cost / how long did it take?" | [Fill in with your actual numbers — don't let me guess at this.] |
| "Can this work for [hockey/badminton/wrestling/etc.]?" | Yes in principle — the pattern is the same (results data → computed metrics → dashboard); the work is in sourcing that discipline's results feed, which varies sport to sport. |
| "Who maintains this?" | [Fill in — be ready with a real answer; "just me" is fine to say honestly but know the continuity risk it implies and have a one-line mitigation ready if asked.] |

---

## Things NOT to say

- Don't claim the lineup/rubber optimizer exists (the WTTC PRD scoped it as a goal; it is **not built**).
- Don't claim senior doubles coverage is complete.
- Don't present the title bar/browser tab text ("tops-tt-dashboard") as a brand name — if anyone asks what it's called, have an actual name ready, or just call it "the dashboard" / "the system."
