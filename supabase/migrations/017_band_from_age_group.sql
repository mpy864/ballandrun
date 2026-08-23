-- Recover the age band from the match's own age_group when the label cannot supply it.
--
-- band was read only from disc_raw — event_category, or the first segment of round_phase.
-- Several ITTF youth events arrive with both of those null, because the ITTF feed does
-- not populate them. band came out null, is_junior went false, age_band became 'Senior',
-- and the as-of lookup then used the player's SENIOR world rank for a junior championship.
--
-- Divyanshi Bhowmick at the Asian Youth Championships was compared at #124, her senior
-- world rank, in a field that ranks her about #11. That distorts every upset judgement in
-- those matches, in both directions.
--
-- The rows already carried age_group (U11..U19). The view selected it and then ignored it
-- for the band. 135 matches across four championships are recovered by reading it.
--
-- Format falls back to `kind`, which the UNION knows for certain, so these now read
-- "U19 Singles" rather than "Unknown". Gender stays absent because the row genuinely does
-- not say — a partial label beats an invented one.
--
-- NOT fixed here: 40 matches at Asian Youth Championships Bangkok 2026, whose age_group
-- is null as well. Nothing in the match record says which band was played, so they still
-- resolve as Senior. That is wrong, and the honest place to fix it is upstream in
-- fetch_ittf_matches.py where the band is still visible — not by guessing from the event
-- name here, which would put a U15 and a U19 in the same bucket.

create or replace view india_match_results as
with raw as (
    select 'singles'::text as kind, m.match_id, m.event_id, e.event_name, m.event_date,
           coalesce(m.event_category, split_part(m.round_phase, ' - ', 1)) as disc_raw,
           m.age_group, m.round_phase, m.match_score, m.game_scores, m.result,
           m.comp1_id as a_p1, null::integer as a_p2,
           m.comp2_id as b_p1, null::integer as b_p2,
           p1.player_name as an, p2.player_name as bn,
           p1.country_code as ac, p2.country_code as bc,
           (p1.country_code = 'IND') as ind_is_comp1
      from wtt_matches_singles m
      join wtt_events e on e.event_id = m.event_id
      join wtt_players p1 on p1.ittf_id = m.comp1_id
      join wtt_players p2 on p2.ittf_id = m.comp2_id
     where m.result in ('W','L')
       and 'IND' in (p1.country_code, p2.country_code)
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
      join wtt_events e on e.event_id = m.event_id
      left join wtt_players a1 on a1.ittf_id = m.comp1_p1_id
      left join wtt_players a2 on a2.ittf_id = m.comp1_p2_id
      left join wtt_players b1 on b1.ittf_id = m.comp2_p1_id
      left join wtt_players b2 on b2.ittf_id = m.comp2_p2_id
     where m.result in ('W','L')
       and 'IND' in (a1.country_code, a2.country_code, b1.country_code, b2.country_code)
),
parts as (
    select raw.*,
           -- age_group is the fallback, and it is authoritative where present: it comes
           -- from the match record itself rather than from parsing a free-text label.
           coalesce(substring(disc_raw from '^U[0-9]+'), age_group) as band,
           case when disc_raw ~* 'mixed' then 'Mixed'
                when disc_raw ~* 'girls' then 'Girls'
                when disc_raw ~* 'boys'  then 'Boys'
                when disc_raw ~* 'women' then 'Women'
                when disc_raw ~* 'men'   then 'Men' end as who,
           coalesce(
             case when disc_raw ~* 'doubles' then 'Doubles'
                  when disc_raw ~* 'singles' then 'Singles' end,
             initcap(kind)) as fmt
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
    case when ind_is_comp1 then a_p1 else b_p1 end                   as ind_p1_id,
    case when ind_is_comp1 then a_p2 else b_p2 end                   as ind_p2_id,
    case when ind_is_comp1 then an   else bn   end                   as ind_name,
    case when ind_is_comp1 then b_p1 else a_p1 end                   as opp_p1_id,
    case when ind_is_comp1 then b_p2 else a_p2 end                   as opp_p2_id,
    case when ind_is_comp1 then bn   else an   end                   as opp_name,
    case when ind_is_comp1 then bc   else ac   end                   as opp_country,
    (case when ind_is_comp1 then bc else ac end) = 'IND'             as opp_is_indian,
    case when ind_is_comp1 then match_score
         else split_part(match_score,'-',2) || '-' || split_part(match_score,'-',1) end as score,
    game_scores,
    case when ind_is_comp1 then result = 'W' else result = 'L' end   as won
from parts;
