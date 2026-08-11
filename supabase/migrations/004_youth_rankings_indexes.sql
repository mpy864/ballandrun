-- 004_youth_rankings_indexes.sql — applied 2026-08-10
--
-- Numbered 004, not 003: a 003_tennis.sql exists in the ATPWTA scraper folder and was
-- applied to this same database. It is not in this repo, which is its own problem —
-- see the note in scripts/_retired/README.md.
--
-- The only indexes on the youth tables were their primary keys, which lead with
-- ittf_id / pair_id. Nothing could serve a filter on publish_date, so every such query
-- did a sequential scan. That was survivable at ~570k rows. Writing one row per band a
-- competitor is eligible for (99c5412) plus the 12-month backfill took the tables past
-- 1.8M, and check_data_quality.py started hitting statement timeouts:
--
--     canceling statement due to statement timeout (57014)
--
-- This is not only a tooling concern. YouthPipelinePage.jsx filters
-- `.gte('publish_date', cutoff)` over a 3-12 month window, and sportTabs.jsx orders by
-- publish_date to find the newest week — both were reading the same scans.
--
-- After: the two checks that timed out complete in 7-11s.

create index if not exists youth_rankings_singles_pub_band_sub
  on public.youth_rankings_singles (publish_date, age_category, sub_event);

create index if not exists youth_rankings_doubles_pub_band_sub
  on public.youth_rankings_doubles (publish_date, age_category, sub_event);

-- The Talent tab asks for one country's competitors in one band, newest week first.
create index if not exists youth_rankings_singles_country_band_sub
  on public.youth_rankings_singles (country_code, age_category, sub_event, publish_date desc);
