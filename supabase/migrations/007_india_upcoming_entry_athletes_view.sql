-- 007_india_upcoming_entry_athletes_view.sql — applied 2026-08-20
--
-- Row-level companion to india_upcoming_entries (006): which Indian athletes are
-- entered for each upcoming event, and in which draws. Backs the expandable detail
-- on the Squad board's Upcoming events panel, fetched only when a row is opened —
-- most rows are never expanded, and loading every entry up front is what would make
-- that panel slow as entries grow.
--
-- Deliberately repeats the Indian filter and the junior rule (youth sub_events start
-- with U + digits) from 006 rather than deriving one from the other, so the summary
-- counts and the expanded list can never disagree about who counts.
--
-- security_invoker so the same row-level rules apply as when the app reads
-- wtt_entries directly.

create or replace view public.india_upcoming_entry_athletes
with (security_invoker = true) as
select
    e.event_id,
    e.start_date,
    en.player_id,
    coalesce(p.player_name, en.player_name)  as player_name,
    en.sub_event,
    en.discipline,
    en.seed,
    en.is_qualifier,
    (en.sub_event ~ '^U[0-9]')               as is_junior
from wtt_entries en
join wtt_events  e on e.event_id = en.event_id
join wtt_players p on p.ittf_id  = en.player_id and p.country_code = 'IND'
where e.start_date >= current_date;

grant select on public.india_upcoming_entry_athletes to anon, authenticated;
