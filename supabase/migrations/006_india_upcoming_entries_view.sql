-- 006_india_upcoming_entries_view.sql — applied 2026-08-20
--
-- The Squad board's "Upcoming events" panel counted how many of the 7 scored SQUAD
-- entries had each event as their NEXT fixture. Three problems in one small panel:
--
--   * the numbers always summed to the squad size (1+4+1+1 = 7) because every squad
--     member was counted exactly once, at whichever event came first for them
--   * it was labelled "entered", which it never measured. Almaty read "4 entered"
--     while 10 Indian athletes were actually entered
--   * juniors were absent entirely, since the board skips youth rows. 13 Indian
--     juniors were entered for Youth Contender Puerto Princesa and none appeared
--
-- This view answers the question the panel claims to: how many Indian athletes are
-- entered for each upcoming event.
--
-- Aggregated in the database on purpose. Counting distinct players in the browser
-- would mean fetching every Indian entry row on each page load.
--
-- Junior draws are identified by sub_event, which is 'U11 Boys' Singles',
-- 'U19 Mixed Doubles' and so on — every youth sub_event starts with U + digits.
--
-- junior_athletes + senior_athletes can exceed athletes: a player entered in both a
-- U19 and a senior draw at one event is correctly counted in each.
--
-- security_invoker so the same row-level rules apply as when the app reads
-- wtt_entries directly.

create or replace view public.india_upcoming_entries
with (security_invoker = true) as
select
    e.event_id,
    e.event_name,
    e.start_date,
    (e.start_date - current_date)                                        as days_away,
    count(distinct en.player_id)                                         as athletes,
    count(*)                                                             as entries,
    count(distinct en.player_id) filter (where en.sub_event ~ '^U[0-9]') as junior_athletes,
    count(distinct en.player_id) filter (where en.sub_event !~ '^U[0-9]') as senior_athletes,
    max(en.last_updated)                                                 as entries_refreshed_at
from wtt_entries en
join wtt_events  e on e.event_id = en.event_id
join wtt_players p on p.ittf_id  = en.player_id and p.country_code = 'IND'
where e.start_date >= current_date
group by e.event_id, e.event_name, e.start_date;

grant select on public.india_upcoming_entries to anon, authenticated;
