-- Snapshot the ranked matches instead of recomputing them on every page view.
--
-- india_match_ranked resolves four as-of rank lookups per row with correlated
-- subqueries. Postgres cannot push an `event_id = ...` filter down into those, so
-- opening ONE tournament computed ranks for all 10,127 rows first — roughly 20,000 index
-- scans to return 26. Singles alone made that slow; adding the doubles lookups in
-- migration 015 took the Events tab to 12.8 seconds, which is where this was noticed.
--
-- Two separate fixes, and the second only became visible after the first:
--
--   1. Snapshot the view.                        12,783ms -> 180ms
--   2. Store round_depth in the snapshot too.       180ms ->   3.8ms
--
-- The second is the less obvious one. india_player_matches used to derive round_depth in
-- a CTE and reference that CTE twice, once for India's side and once for the mirrored
-- all-Indian rows. A CTE referenced more than once is materialised, which makes it a
-- fence: `event_id = 3216` could not reach the index underneath it, so every read still
-- scanned all 10,127 rows. Computing the value once at snapshot time removes the fence.
--
-- Freshness is unchanged in practice. india_event_report has always been a nightly
-- snapshot, so this page was never live to the minute; this simply makes its other
-- source agree with it.

create materialized view if not exists india_match_ranked_m as
select r.*,
  case
    when r.round ~ '^Group [0-9]+' then 0.5
    when r.round ~ '^Qualifying Round [0-9]'
      then 1::numeric + coalesce(nullif(regexp_replace(r.round, '\D', '', 'g'), '')::numeric, 0::numeric) / 100::numeric
    when r.round = 'Qualification Elimination Round' then 1.5
    when r.round = 'Preliminary'  then 2::numeric
    when r.round = 'Round of 128' then 3::numeric
    when r.round = 'Round of 64'  then 4::numeric
    when r.round = 'Round of 32'  then 5::numeric
    when r.round = 'Round of 16'  then 6::numeric
    when r.round ~ '^Pos\.'       then 6.5
    when r.round = any (array['3rd Place','Bronze'])          then 7::numeric
    when r.round = any (array['Quarterfinal','Quarterfinals']) then 8::numeric
    when r.round = any (array['Semifinal','Semifinals'])       then 9::numeric
    when r.round = 'Final'        then 10::numeric
    else 0::numeric
  end as round_depth
from india_match_ranked r;

-- The unique index is not decoration: REFRESH ... CONCURRENTLY requires one, and
-- without CONCURRENTLY the nightly refresh locks readers out of the Events tab.
create unique index if not exists idx_imrm_key
  on india_match_ranked_m (match_id, ind_p1_id, opp_p1_id, discipline);
create index if not exists idx_imrm_event on india_match_ranked_m (event_id);

-- Same shape as before, reading the snapshot and with no CTE to fence the filter.
create or replace view india_player_matches as
select match_id, event_id, event_name, event_date, discipline, age_band, is_junior, kind,
       round, round_depth,
       ind_p1_id as player_id, ind_p2_id as partner_id, ind_name as player_name,
       ind_rank as player_rank,
       opp_name, opp_country, opp_rank, opp_is_indian,
       score, game_scores, won, upset_given, upset_taken
from india_match_ranked_m
union all
-- An all-Indian tie appears once per player, so the second half mirrors those rows:
-- the opponent becomes the player, the score is flipped, and the upset flags invert.
select match_id, event_id, event_name, event_date, discipline, age_band, is_junior, kind,
       round, round_depth,
       opp_p1_id as player_id, opp_p2_id as partner_id, opp_name as player_name,
       opp_rank as player_rank,
       ind_name as opp_name, 'IND'::text as opp_country, ind_rank as opp_rank,
       true as opp_is_indian,
       split_part(score, '-', 2) || '-' || split_part(score, '-', 1) as score,
       game_scores, not won as won,
       opp_rank is not null and ind_rank is not null and not won and opp_rank > ind_rank as upset_given,
       opp_rank is not null and ind_rank is not null and won     and opp_rank < ind_rank as upset_taken
from india_match_ranked_m
where opp_is_indian;

-- Rebuilt nightly or the tab silently stops showing new matches. 01:05, ten minutes
-- before india_event_report at 01:15: both are built from the same source, so refreshing
-- the cheaper one first keeps the two consistent with each other rather than a night
-- apart.
select cron.schedule(
  'refresh-india-match-ranked',
  '5 1 * * *',
  $$ refresh materialized view concurrently public.india_match_ranked_m $$
);
