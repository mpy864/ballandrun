# Retired scripts

## Youth ranking backfills — retired 2026-08-10

All three duplicated the youth ingest and modelled age bands as **exclusive** buckets:

```python
AGE_CATEGORIES = ["U13", "U15", "U17", "U19"]     # no U11, and exclusive
```

WTT bands are inclusive — "Under 19" means 19 and under, so a U17 player is ranked in
U19 too. `scripts/fetch_youth_rankings.py` was corrected on 2026-08-10 to write one row
per band a competitor is eligible for and to compute band positions itself. Running any
of these afterwards would have overwritten the corrected rows with the old shape, and
`backfill_youth_rankings.yml` had a Run button pointed at the first of them.

Superseded by `scripts/fetch_youth_rankings.py`, which now covers both incremental and
historical work via `--weeks N` or `--from-year/--from-week/--to-year/--to-week`.

Two were already broken on their own terms:

| File | Why it went |
|---|---|
| `backfill_youth_rankings.py` | duplicate ingest carrying the old band model |
| `backfill_youth_doubles_only.py` | existed **only** to work around a bug in the above — its own docstring says `week_exists` checked singles, so doubles got a single snapshot |
| `backfill_age_cat_rank.py` | patched `age_cat_rank` in place; structurally impossible now, since inclusive bands need new rows rather than a column update |

`backfill_age_cat_rank.py` called the Postgres functions `patch_singles_age_cat_ranks`
and `patch_doubles_age_cat_ranks`. Those are now unused but have been left in the
database; dropping them is a separate migration.

## tennisexplorer scrapers — retired 2026-08-08

These scraped tennisexplorer.com into `tennis_players`, `tennis_rankings`,
`tennis_matches` and `tennis_matches_doubles`. Those four tables were dropped on
2026-08-08 and the scripts no longer run against anything.

Superseded by `C:\ATPWTA Scrapings\atp_fetch.py` + `atp_load.py`, which use the official
ATP feeds and write to `tennis_tour_*`.

Kept rather than deleted because the tennisexplorer HTML parsing is non-trivial and
that site remains the only easy source for some non-ATP data. A backup of the dropped
tables is at `C:\ATPWTA Scrapings\backup\`.

| File | Wrote to |
|---|---|
| `fetch_tennis.py` | `tennis_players`, `tennis_rankings` |
| `fetch_tennis_doubles.py` | `tennis_players`, `tennis_matches_doubles` |
| `fetch_tennis_matches.py` | `tennis_matches` |
