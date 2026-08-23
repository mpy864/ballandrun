-- Build the event report from the match snapshot, and stop the nightly refresh timing out.
--
-- Two problems, one commit.
--
-- 1. It read the LIVE views. `india` read india_match_ranked, which resolves four as-of
--    rank lookups per row with correlated subqueries, and `ind_events` read
--    india_match_results, which inner-joins wtt_players twice across 120k matches.
--    Rebuilding the report therefore recomputed every rank in the database from scratch,
--    on top of its own field-strength work. Both now read india_match_ranked_m, which
--    holds those rows with the ranks already resolved and is refreshed ten minutes
--    earlier at 01:05. Measured: the event list alone went 5.4s -> 0.3s, and the whole
--    refresh 159s -> 108s.
--
-- 2. 108s is still not safe. The database statement_timeout is 120s and pg_cron runs as
--    `postgres`, which does not override it. The refresh grew when wtt_players went from
--    8,686 to 57,008 rows: more matches became visible, and the field-strength maths now
--    covers 60,333 player-event rows with two percentile_cont passes. Twelve seconds of
--    headroom is not headroom — one slow night and the Events tab silently freezes on
--    yesterday's data, which is the exact failure this whole system keeps producing.
--    Both nightly jobs now clear the timeout first. A refresh is a batch job with nobody
--    waiting on it; the timeout is there to stop a runaway interactive query.
drop materialized view if exists india_event_report;

create materialized view india_event_report as
with ind_events as (
    select distinct event_id from india_match_ranked_m
), ev as (
    select m.event_id, min(m.event_date) as ev_date
      from wtt_matches_singles m
      join ind_events ie on ie.event_id = m.event_id
     group by m.event_id
), field as (
    select distinct m.event_id, x.pid, ev.ev_date,
           coalesce(substring(coalesce(m.event_category, split_part(m.round_phase, ' - ', 1)), '^U[0-9]+'), 'Senior') as band,
           case when coalesce(m.event_category, split_part(m.round_phase, ' - ', 1)) ~* 'girls|women' then 'WS'
                when coalesce(m.event_category, split_part(m.round_phase, ' - ', 1)) ~* 'boys|men'   then 'MS' end as sub
      from wtt_matches_singles m
      join ev on ev.event_id = m.event_id
      cross join lateral (values (m.comp1_id), (m.comp2_id)) x(pid)
     where x.pid is not null
), sen as (
    select distinct on (f.event_id, f.pid) f.event_id, f.pid, s.rank as rank_then
      from field f
      join rankings_singles_normalized s on s.player_id = f.pid and s.ranking_date <= f.ev_date
     where f.band = 'Senior'
     order by f.event_id, f.pid, s.ranking_date desc
), you as (
    select distinct on (f.event_id, f.pid) f.event_id, f.pid, y.age_cat_rank as rank_then
      from field f
      join youth_rankings_singles y on y.ittf_id = f.pid::text and y.age_category = f.band
                                   and y.sub_event = f.sub and y.publish_date <= f.ev_date
     where f.band <> 'Senior'
     order by f.event_id, f.pid, y.publish_date desc
), allr as (
    select event_id, pid, rank_then from sen
    union all
    select event_id, pid, rank_then from you
), strength as (
    select f.event_id,
           count(distinct f.pid) as field_players,
           count(distinct r.pid) as field_ranked,
           round(100.0 * count(distinct r.pid)::numeric / nullif(count(distinct f.pid), 0)::numeric) as rank_coverage_pct,
           min(r.rank_then) as field_best_rank,
           percentile_cont(0.25) within group (order by (r.rank_then::double precision))::integer as field_p25_rank,
           percentile_cont(0.50) within group (order by (r.rank_then::double precision))::integer as field_median_rank
      from field f
      left join allr r on r.event_id = f.event_id and r.pid = f.pid
     group by f.event_id
), countries as (
    select f.event_id, count(distinct p.country_code) as field_countries
      from field f join wtt_players p on p.ittf_id = f.pid
     group by f.event_id
), india as (
    select event_id, event_name,
           min(event_date) as first_date, max(event_date) as last_date,
           count(*) as matches,
           count(*) filter (where won) as wins,
           count(*) filter (where not won) as losses,
           count(distinct ind_p1_id) as athletes,
           count(*) filter (where kind = 'singles') as singles_matches,
           count(*) filter (where kind = 'singles' and won) as singles_wins,
           count(*) filter (where kind = 'doubles') as doubles_matches,
           count(*) filter (where kind = 'doubles' and won) as doubles_wins,
           count(*) filter (where is_junior) as junior_matches,
           count(*) filter (where is_junior and won) as junior_wins,
           count(*) filter (where opp_is_indian) as all_indian_matches,
           count(*) filter (where upset_given) as upsets_given,
           count(*) filter (where upset_taken) as upsets_taken
      from india_match_ranked_m
     group by event_id, event_name
), pts as (
    select p.event_id,
           sum(p.ranking_points) as contingent_points,
           max(p.ranking_points) as best_haul,
           count(distinct p.competitor_id) as point_scorers
      from wtt_ranking_points p
      join wtt_players pl on pl.ittf_id = p.competitor_id and pl.country_code = 'IND'
     group by p.event_id
)
select i.event_id, i.event_name, i.first_date, i.last_date, i.matches, i.wins, i.losses,
       i.athletes, i.singles_matches, i.singles_wins, i.doubles_matches, i.doubles_wins,
       i.junior_matches, i.junior_wins, i.all_indian_matches, i.upsets_given, i.upsets_taken,
       s.field_players, s.field_ranked, s.rank_coverage_pct, s.field_best_rank,
       s.field_p25_rank, s.field_median_rank, c.field_countries,
       pt.contingent_points, pt.best_haul, pt.point_scorers
  from india i
  left join strength s  on s.event_id  = i.event_id
  left join countries c on c.event_id  = i.event_id
  left join pts pt      on pt.event_id = i.event_id;

create unique index india_event_report_pk on india_event_report (event_id);
create index india_event_report_last_date on india_event_report (last_date desc);

grant select on india_event_report to anon, authenticated, service_role;

-- The nightly jobs, reinstated with no statement timeout.
select cron.unschedule('refresh-india-event-report');
select cron.schedule('refresh-india-event-report', '15 1 * * *',
  $$ set statement_timeout = 0; refresh materialized view concurrently public.india_event_report $$);

select cron.unschedule('refresh-india-match-ranked');
select cron.schedule('refresh-india-match-ranked', '5 1 * * *',
  $$ set statement_timeout = 0; refresh materialized view concurrently public.india_match_ranked_m $$);
