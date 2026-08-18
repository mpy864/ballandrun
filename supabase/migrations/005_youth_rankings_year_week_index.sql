-- 005_youth_rankings_year_week_index.sql — applied 2026-08-18
--
-- db_latest_week() in scripts/fetch_youth_rankings.py does:
--
--     order by ranking_year desc, ranking_week desc limit 1
--
-- With no index on those columns that is a full scan plus a sort. Fine at ~570k rows.
-- The inclusive-band change plus the 12-month backfill (a5d243b) took the tables past
-- 1M, and this began failing with:
--
--     canceling statement due to statement timeout (57014)
--
-- That call is the FIRST thing the nightly sync does in default mode, so the youth
-- feed stopped entirely. It sat on 2026 W33 while WTT had already published W34, for
-- a week, and nothing said so:
--
--   * daily_sync's youth job failed alone (correct, after 80026ba) but the ingests
--     still do not report to feed_health, so no alert fired
--   * check_data_quality.py passed, because the newest week PRESENT was internally
--     consistent and 8 days old is inside its 10-day freshness threshold
--
-- 004 indexed (publish_date, age_category, sub_event), which cannot serve an ORDER BY
-- on ranking_year/ranking_week. A btree scans backwards, so ascending column order is
-- sufficient for the descending limit-1 lookup.

create index if not exists youth_rankings_singles_year_week
  on public.youth_rankings_singles (ranking_year, ranking_week);

create index if not exists youth_rankings_doubles_year_week
  on public.youth_rankings_doubles (ranking_year, ranking_week);
