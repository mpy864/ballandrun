-- 009_match_discipline_and_rank_at_time.sql — applied 2026-08-20
--
-- Two problems with 008, and the rank-at-match-time layer the Events tab needs.
--
-- 1. DISCIPLINE WAS MOSTLY NULL
--    event_category is NULL on 7,101 of 9,013 Indian singles rows — 79% — so grouping
--    by discipline put most of the archive into "Other". It is however present in
--    round_phase, whose first segment is exactly that ("Women's Singles - Round of 32
--    - Match 9"). Only 9 matches have neither.
--
-- 2. THE SAME DISCIPLINE WAS SPELT TWO WAYS
--    "U17 Girls Singles" and "U19 Girls' Singles" both occur, so grouping on the raw
--    string split one discipline in two. The label is rebuilt from its parts: band
--    (U11..U19 or senior), who (Mixed/Boys/Girls/Men/Women — women tested BEFORE men,
--    since "Women's" contains "men"), and format. age_band is exposed separately so
--    junior/senior splits need no string parsing in the client.
--
-- 3. RANK AT THE TIME OF COMPETITION
--    The last ranking PUBLISHED ON OR BEFORE the match date. Not the seeding, and not
--    the ranking when entries were taken, which can be weeks earlier.
--
--    Youth draws resolve against YOUTH rankings for the matching age band. Measured on
--    WTT Youth Contender Almaty, senior rankings covered 26% of the field — only those
--    juniors already senior-ranked — which made junior events look far stronger than
--    they were. Youth rankings give 100% at U15/U17/U19, 68-88% at U13, 63% at U11.
--    age_cat_rank is the position within the band, which is what the draw is.
--
--    Upsets, no minimum gap:
--      given  our player holds the WORSE rank (bigger number) and wins
--      taken  our player holds the BETTER rank (smaller number) and loses
--
--    Doubles carry no rank yet — pair ranking is keyed on the pair, and a pair never
--    ranked together has no position. ind_rank/opp_rank are null there so both upset
--    flags are false rather than wrong.
--
-- Views are dropped rather than replaced: create or replace cannot rename or reorder
-- view columns, and india_result_events depends on india_match_results.

drop view if exists public.india_match_ranked;
drop view if exists public.india_result_events;
drop view if exists public.india_match_results;

create view public.india_match_results
with (security_invoker = true) as
with raw as (
    select 'singles'::text as kind, m.match_id, m.event_id, e.event_name, m.event_date,
           coalesce(m.event_category, split_part(m.round_phase, ' - ', 1)) as disc_raw,
           m.age_group, m.round_phase, m.match_score, m.game_scores, m.result,
           m.comp1_id::int as a_p1, null::int as a_p2,
           m.comp2_id::int as b_p1, null::int as b_p2,
           p1.player_name as an, p2.player_name as bn,
           p1.country_code as ac, p2.country_code as bc,
           (p1.country_code = 'IND') as ind_is_comp1
    from wtt_matches_singles m
    join wtt_events  e  on e.event_id = m.event_id
    join wtt_players p1 on p1.ittf_id = m.comp1_id
    join wtt_players p2 on p2.ittf_id = m.comp2_id
    where m.result in ('W', 'L') and 'IND' in (p1.country_code, p2.country_code)
    union all
    select 'doubles', m.match_id, m.event_id, e.event_name, m.event_date,
           coalesce(m.event_category, split_part(m.round_phase, ' - ', 1)),
           m.age_group, m.round_phase, m.match_score, m.game_scores, m.result,
           m.comp1_p1_id, m.comp1_p2_id, m.comp2_p1_id, m.comp2_p2_id,
           concat_ws(' / ', a1.player_name, a2.player_name),
           concat_ws(' / ', b1.player_name, b2.player_name),
           case when 'IND' in (a1.country_code, a2.country_code) then 'IND'
                else coalesce(a1.country_code, a2.country_code) end,
           case when 'IND' in (b1.country_code, b2.country_code) then 'IND'
                else coalesce(b1.country_code, b2.country_code) end,
           ('IND' in (a1.country_code, a2.country_code))
    from wtt_matches_doubles m
    join wtt_events  e  on e.event_id = m.event_id
    left join wtt_players a1 on a1.ittf_id = m.comp1_p1_id
    left join wtt_players a2 on a2.ittf_id = m.comp1_p2_id
    left join wtt_players b1 on b1.ittf_id = m.comp2_p1_id
    left join wtt_players b2 on b2.ittf_id = m.comp2_p2_id
    where m.result in ('W', 'L')
      and 'IND' in (a1.country_code, a2.country_code, b1.country_code, b2.country_code)
),
parts as (
    select raw.*,
           substring(disc_raw from '^U[0-9]+') as band,
           case when disc_raw ~* 'mixed' then 'Mixed'
                when disc_raw ~* 'girls' then 'Girls'
                when disc_raw ~* 'boys'  then 'Boys'
                when disc_raw ~* 'women' then 'Women'
                when disc_raw ~* 'men'   then 'Men' end as who,
           case when disc_raw ~* 'doubles' then 'Doubles'
                when disc_raw ~* 'singles' then 'Singles' end as fmt
    from raw
)
select
    kind, match_id, event_id, event_name, event_date,
    coalesce(nullif(concat_ws(' ', band,
        case who when 'Men'  then 'Men''s' when 'Women' then 'Women''s'
                 when 'Boys' then 'Boys''' when 'Girls' then 'Girls'''
                 else who end, fmt), ''), 'Unknown')                 as discipline,
    coalesce(band, 'Senior')                                         as age_band,
    (band is not null)                                               as is_junior,
    age_group,
    coalesce(nullif(split_part(round_phase, ' - ', 2), ''), 'Other')  as round,
    ind_is_comp1,
    (case when ind_is_comp1 then a_p1 else b_p1 end)                 as ind_p1_id,
    (case when ind_is_comp1 then a_p2 else b_p2 end)                 as ind_p2_id,
    (case when ind_is_comp1 then an else bn end)                     as ind_name,
    (case when ind_is_comp1 then b_p1 else a_p1 end)                 as opp_p1_id,
    (case when ind_is_comp1 then b_p2 else a_p2 end)                 as opp_p2_id,
    (case when ind_is_comp1 then bn else an end)                     as opp_name,
    (case when ind_is_comp1 then bc else ac end)                     as opp_country,
    ((case when ind_is_comp1 then bc else ac end) = 'IND')           as opp_is_indian,
    (case when ind_is_comp1 then match_score
          else split_part(match_score, '-', 2) || '-' || split_part(match_score, '-', 1) end) as score,
    game_scores,
    (case when ind_is_comp1 then result = 'W' else result = 'L' end)  as won
from parts;

grant select on public.india_match_results to anon, authenticated;


create view public.india_match_ranked
with (security_invoker = true) as
with base as (
    select r.*,
           case when r.discipline ~* 'girls|women' then 'WS'
                when r.discipline ~* 'boys|men'    then 'MS' end as youth_sub
    from india_match_results r
),
withrank as (
    select b.*,
        case when b.kind <> 'singles' then null
             when b.is_junior then (
                 select y.age_cat_rank from youth_rankings_singles y
                 where y.ittf_id = b.ind_p1_id::text and y.age_category = b.age_band
                   and y.sub_event = b.youth_sub and y.publish_date <= b.event_date
                 order by y.publish_date desc limit 1)
             else (
                 select s.rank from rankings_singles_normalized s
                 where s.player_id = b.ind_p1_id and s.ranking_date <= b.event_date
                 order by s.ranking_date desc limit 1) end as ind_rank,
        case when b.kind <> 'singles' then null
             when b.is_junior then (
                 select y.age_cat_rank from youth_rankings_singles y
                 where y.ittf_id = b.opp_p1_id::text and y.age_category = b.age_band
                   and y.sub_event = b.youth_sub and y.publish_date <= b.event_date
                 order by y.publish_date desc limit 1)
             else (
                 select s.rank from rankings_singles_normalized s
                 where s.player_id = b.opp_p1_id and s.ranking_date <= b.event_date
                 order by s.ranking_date desc limit 1) end as opp_rank
    from base b
)
select w.*,
       (w.ind_rank is not null and w.opp_rank is not null
        and w.won     and w.ind_rank > w.opp_rank) as upset_given,
       (w.ind_rank is not null and w.opp_rank is not null
        and not w.won and w.ind_rank < w.opp_rank) as upset_taken
from withrank w;

grant select on public.india_match_ranked to anon, authenticated;


create view public.india_result_events
with (security_invoker = true) as
select
    event_id, event_name,
    min(event_date)                              as first_date,
    max(event_date)                              as last_date,
    count(*)                                     as matches,
    count(*) filter (where won)                  as wins,
    count(*) filter (where not won)              as losses,
    count(distinct ind_p1_id)                    as athletes,
    count(*) filter (where kind = 'singles')     as singles_matches,
    count(*) filter (where kind = 'singles' and won) as singles_wins,
    count(*) filter (where kind = 'doubles')     as doubles_matches,
    count(*) filter (where kind = 'doubles' and won) as doubles_wins,
    count(*) filter (where is_junior)            as junior_matches,
    count(*) filter (where is_junior and won)    as junior_wins,
    count(*) filter (where opp_is_indian)        as all_indian_matches
from india_match_results
group by event_id, event_name;

grant select on public.india_result_events to anon, authenticated;
