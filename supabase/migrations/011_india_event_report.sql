-- 011_india_event_report.sql — applied 2026-08-20
--
-- Everything the Events tab needs, per tournament: contingent points, field strength,
-- unique players and countries, record, upsets given and taken.
--
-- MATERIALISED, because field strength needs a rank for EVERY player in the draw — not
-- just the Indians — resolved as of the event date. Roughly 50k as-of lookups across
-- ~160 events: fine nightly, far too slow per page load.
--
-- The as-of resolution is deliberately SET-BASED (join + distinct on) rather than a
-- correlated subquery per player. The subquery version used its index correctly at
-- 5.7ms a call, which is fine once and fatal 50,000 times — it blew the statement
-- timeout outright. Same logic, different shape, orders of magnitude apart.
--
-- Field strength reports median and p25, never the mean. Rank distributions are
-- heavily right-skewed — a few elites and a long tail of qualifiers — so the mean is
-- dragged upward and describes nobody: Europe Smash Sweden has mean 93 against median
-- 68. The median is the typical opponent; p25 and best describe the sharp end, which is
-- what decides whether an athlete runs into someone world-class. The two together
-- separate events a single number cannot: Champions Yokohama (median 24) and Feeder
-- Vientiane (median 340) are different sports.
--
-- Youth draws resolve against YOUTH rankings for the matching band. Senior rankings
-- covered just 26% of a junior field — only those juniors already senior-ranked —
-- making every junior event look far stronger than it was.
--
-- rank_coverage_pct is carried on purpose: a median over a quarter of the field is not
-- the field's median, and the UI should be able to say so.
--
-- REFRESHED BY pg_cron, NOT by the workflow. Calling the refresh through PostgREST is
-- cancelled after ~8s by the API role's statement_timeout, and raising it inside a
-- function does not help — statement_timeout is armed when the OUTER statement begins,
-- so a SET LOCAL inside the call comes too late to re-arm it. pg_cron runs it in the
-- database at 01:15 UTC, after daily_sync's 00:30 feeds have landed.

drop materialized view if exists public.india_event_report;

create materialized view public.india_event_report as
with ind_events as (
    select event_id from india_match_results group by event_id
),
ev as (
    select m.event_id, min(m.event_date) as ev_date
    from wtt_matches_singles m
    join ind_events ie on ie.event_id = m.event_id
    group by m.event_id
),
field as (
    select distinct m.event_id, x.pid, ev.ev_date,
      coalesce(substring(coalesce(m.event_category, split_part(m.round_phase,' - ',1)) from '^U[0-9]+'), 'Senior') as band,
      case when coalesce(m.event_category, split_part(m.round_phase,' - ',1)) ~* 'girls|women' then 'WS'
           when coalesce(m.event_category, split_part(m.round_phase,' - ',1)) ~* 'boys|men'    then 'MS' end as sub
    from wtt_matches_singles m
    join ev on ev.event_id = m.event_id
    cross join lateral (values (m.comp1_id), (m.comp2_id)) as x(pid)
    where x.pid is not null
),
sen as (
    select distinct on (f.event_id, f.pid) f.event_id, f.pid, s.rank as rank_then
    from field f
    join rankings_singles_normalized s on s.player_id = f.pid and s.ranking_date <= f.ev_date
    where f.band = 'Senior'
    order by f.event_id, f.pid, s.ranking_date desc
),
you as (
    select distinct on (f.event_id, f.pid) f.event_id, f.pid, y.age_cat_rank as rank_then
    from field f
    join youth_rankings_singles y on y.ittf_id = f.pid::text and y.age_category = f.band
                                 and y.sub_event = f.sub and y.publish_date <= f.ev_date
    where f.band <> 'Senior'
    order by f.event_id, f.pid, y.publish_date desc
),
allr as (select * from sen union all select * from you),
strength as (
    select f.event_id,
           count(distinct f.pid)                                        as field_players,
           count(distinct r.pid)                                        as field_ranked,
           round(100.0 * count(distinct r.pid) / nullif(count(distinct f.pid),0)) as rank_coverage_pct,
           min(r.rank_then)                                             as field_best_rank,
           percentile_cont(0.25) within group (order by r.rank_then)::int as field_p25_rank,
           percentile_cont(0.50) within group (order by r.rank_then)::int as field_median_rank
    from field f
    left join allr r on r.event_id = f.event_id and r.pid = f.pid
    group by f.event_id
),
countries as (
    select f.event_id, count(distinct p.country_code) as field_countries
    from field f join wtt_players p on p.ittf_id = f.pid
    group by f.event_id
),
india as (
    select event_id, event_name,
           min(event_date) as first_date, max(event_date) as last_date,
           count(*) as matches,
           count(*) filter (where won) as wins,
           count(*) filter (where not won) as losses,
           count(distinct ind_p1_id) as athletes,
           count(*) filter (where kind='singles') as singles_matches,
           count(*) filter (where kind='singles' and won) as singles_wins,
           count(*) filter (where kind='doubles') as doubles_matches,
           count(*) filter (where kind='doubles' and won) as doubles_wins,
           count(*) filter (where is_junior) as junior_matches,
           count(*) filter (where is_junior and won) as junior_wins,
           count(*) filter (where opp_is_indian) as all_indian_matches,
           count(*) filter (where upset_given) as upsets_given,
           count(*) filter (where upset_taken) as upsets_taken
    from india_match_ranked group by event_id, event_name
),
pts as (
    select p.event_id,
           sum(p.ranking_points)           as contingent_points,
           max(p.ranking_points)           as best_haul,
           count(distinct p.competitor_id) as point_scorers
    from wtt_ranking_points p
    join wtt_players pl on pl.ittf_id = p.competitor_id and pl.country_code = 'IND'
    group by p.event_id
)
select i.*,
       s.field_players, s.field_ranked, s.rank_coverage_pct,
       s.field_best_rank, s.field_p25_rank, s.field_median_rank,
       c.field_countries,
       pt.contingent_points, pt.best_haul, pt.point_scorers
from india i
left join strength  s  on s.event_id  = i.event_id
left join countries c  on c.event_id  = i.event_id
left join pts       pt on pt.event_id = i.event_id;

-- CONCURRENTLY requires a unique index, and keeps the view readable while it rebuilds
-- so the dashboard never blanks mid-refresh.
create unique index india_event_report_pk on public.india_event_report (event_id);
create index india_event_report_last_date on public.india_event_report (last_date desc);

grant select on public.india_event_report to anon, authenticated;


-- As-of rank lookup support. The youth primary key is (ittf_id, age_category,
-- sub_event, ranking_year, ranking_week) — its prefix matches the filter, but the
-- ordering column is publish_date, which the PK does not carry. At ~1M rows that
-- forced a sort per lookup.
create index if not exists youth_rankings_singles_asof
  on public.youth_rankings_singles (ittf_id, age_category, sub_event, publish_date desc);


select cron.unschedule('refresh-india-event-report')
where exists (select 1 from cron.job where jobname = 'refresh-india-event-report');

select cron.schedule(
    'refresh-india-event-report',
    '15 1 * * *',
    $$ refresh materialized view concurrently public.india_event_report $$
);
