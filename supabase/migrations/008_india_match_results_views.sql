-- 008_india_match_results_views.sql — applied 2026-08-20
--
-- Backs the Results page. 106k singles and 12k doubles matches were in the database
-- with no page showing them; match data only surfaced inside PlayerPage, PairProfile
-- and H2H.
--
-- india_match_results normalises every match so the Indian side is always "ind".
-- match_score, game_scores and result are all stored relative to comp1, so an Indian
-- playing as comp2 whose row says result='W' actually LOST. That is a trap every
-- consumer would otherwise have to remember.
--
-- India v India (1,155 singles matches) is not an edge case. comp1 is taken as the
-- Indian side there, deterministic because its test is evaluated first, and
-- opp_is_indian marks the row so the UI can present an all-Indian tie rather than
-- implying a foreign opponent.
--
-- Player ids rather than competitor ids: singles comp1_id is an ittf player id while
-- doubles comp1_id is a TEAM id, and the two are different types. ind_p1_id /
-- ind_p2_id (p2 null for singles) gives one shape that links to a player page either
-- way.
--
-- game_scores stays raw with ind_is_comp1 alongside; flipping a comma-separated list
-- of per-game scores is trivial in the client and ugly here.
--
-- Verified after creation: of 10,100 rows with a numeric score, 73 disagree with the
-- win flag. 72 are ITTF-sourced rows carrying a result but no score, stored as '0-0'
-- (the UI shows a dash). The last is a Mixed Team World Cup rubber abandoned at 1-1
-- once the tie was decided. Neither is a normalisation error.

create or replace view public.india_match_results
with (security_invoker = true) as

with s as (
    select m.match_id, m.event_id, e.event_name, m.event_date, m.event_category,
           m.age_group, m.round_phase, m.match_score, m.game_scores, m.result,
           m.comp1_id, m.comp2_id,
           p1.player_name as p1n, p2.player_name as p2n,
           p1.country_code as p1c, p2.country_code as p2c,
           (p1.country_code = 'IND') as ind_is_comp1
    from wtt_matches_singles m
    join wtt_events  e  on e.event_id = m.event_id
    join wtt_players p1 on p1.ittf_id = m.comp1_id
    join wtt_players p2 on p2.ittf_id = m.comp2_id
    where m.result in ('W', 'L')
      and 'IND' in (p1.country_code, p2.country_code)
),
d as (
    select m.match_id, m.event_id, e.event_name, m.event_date, m.event_category,
           m.age_group, m.round_phase, m.match_score, m.game_scores, m.result,
           m.comp1_p1_id, m.comp1_p2_id, m.comp2_p1_id, m.comp2_p2_id,
           a1.player_name a1n, a2.player_name a2n, b1.player_name b1n, b2.player_name b2n,
           a1.country_code a1c, b1.country_code b1c,
           ('IND' in (a1.country_code, a2.country_code)) as ind_is_comp1
    from wtt_matches_doubles m
    join wtt_events  e  on e.event_id = m.event_id
    left join wtt_players a1 on a1.ittf_id = m.comp1_p1_id
    left join wtt_players a2 on a2.ittf_id = m.comp1_p2_id
    left join wtt_players b1 on b1.ittf_id = m.comp2_p1_id
    left join wtt_players b2 on b2.ittf_id = m.comp2_p2_id
    where m.result in ('W', 'L')
      and 'IND' in (a1.country_code, a2.country_code, b1.country_code, b2.country_code)
)

select 'singles'::text as kind, match_id, event_id, event_name, event_date,
       event_category as discipline, age_group,
       coalesce(nullif(split_part(round_phase, ' - ', 2), ''), 'Other') as round,
       ind_is_comp1,
       (case when ind_is_comp1 then comp1_id else comp2_id end)   as ind_p1_id,
       null::integer                                              as ind_p2_id,
       (case when ind_is_comp1 then p1n else p2n end)             as ind_name,
       (case when ind_is_comp1 then comp2_id else comp1_id end)   as opp_p1_id,
       null::integer                                              as opp_p2_id,
       (case when ind_is_comp1 then p2n else p1n end)             as opp_name,
       (case when ind_is_comp1 then p2c else p1c end)             as opp_country,
       ((case when ind_is_comp1 then p2c else p1c end) = 'IND')   as opp_is_indian,
       (case when ind_is_comp1 then match_score
             else split_part(match_score, '-', 2) || '-' || split_part(match_score, '-', 1) end) as score,
       game_scores,
       (case when ind_is_comp1 then result = 'W' else result = 'L' end) as won
from s

union all

select 'doubles'::text, match_id, event_id, event_name, event_date,
       event_category, age_group,
       coalesce(nullif(split_part(round_phase, ' - ', 2), ''), 'Other'),
       ind_is_comp1,
       (case when ind_is_comp1 then comp1_p1_id else comp2_p1_id end),
       (case when ind_is_comp1 then comp1_p2_id else comp2_p2_id end),
       (case when ind_is_comp1 then concat_ws(' / ', a1n, a2n) else concat_ws(' / ', b1n, b2n) end),
       (case when ind_is_comp1 then comp2_p1_id else comp1_p1_id end),
       (case when ind_is_comp1 then comp2_p2_id else comp1_p2_id end),
       (case when ind_is_comp1 then concat_ws(' / ', b1n, b2n) else concat_ws(' / ', a1n, a2n) end),
       (case when ind_is_comp1 then b1c else a1c end),
       ((case when ind_is_comp1 then b1c else a1c end) = 'IND'),
       (case when ind_is_comp1 then match_score
             else split_part(match_score, '-', 2) || '-' || split_part(match_score, '-', 1) end),
       game_scores,
       (case when ind_is_comp1 then result = 'W' else result = 'L' end)
from d;

grant select on public.india_match_results to anon, authenticated;


-- Tournaments with Indian results, one row each — the Results page selector, plus the
-- headline record so a tournament can be judged without opening it. Aggregated here
-- because PostgREST cannot express DISTINCT or GROUP BY; the alternative is pulling
-- every match row into the browser just to list the events.

create or replace view public.india_result_events
with (security_invoker = true) as
select
    event_id,
    event_name,
    min(event_date)                          as first_date,
    max(event_date)                          as last_date,
    count(*)                                 as matches,
    count(*) filter (where won)              as wins,
    count(*) filter (where not won)          as losses,
    count(distinct ind_p1_id)                as athletes,
    count(*) filter (where kind = 'doubles') as doubles_matches,
    -- An all-Indian tie is a guaranteed win and a guaranteed loss; useful context when
    -- a record looks oddly even.
    count(*) filter (where opp_is_indian)    as all_indian_matches
from india_match_results
group by event_id, event_name;

grant select on public.india_result_events to anon, authenticated;
