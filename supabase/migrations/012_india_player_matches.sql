-- 012_india_player_matches.sql — applied 2026-08-21
--
-- One row per INDIAN COMPETITOR per match — the right grain for anything per-athlete.
--
-- india_match_ranked holds one row per MATCH, normalised to "the Indian side". That is
-- correct for counting a tournament's matches and wrong for counting a player's,
-- because an all-Indian tie has two Indian sides and only one of them is ind_name.
--
-- Found by a user noticing an implausible number, not by a check:
--
--   Syndrela Das lost the Qualifying Round 3 at Europe Smash Sweden to Diya Chitale.
--   The row exists, with Diya as ind_name and Syndrela as opp_name. Grouping by
--   ind_name therefore showed Syndrela reaching only Qualifying Round 2 on a 2-0
--   record. She reached Round 3 and went 2-1.
--
-- Every Indian who has ever lost to another Indian was understated the same way, and
-- the upset counts were too — Sreeja Akula's loss to Diya was invisible, so that
-- tournament read 3 upsets taken instead of 4. 1,155 singles matches are affected.
--
-- This view emits the mirror row for all-Indian ties: perspective swapped, result
-- negated, score reversed, upset flags exchanged.
--
-- round_depth belongs here rather than in each caller, so "deepest round reached" is a
-- max() instead of a lookup table repeated in SQL and again in JavaScript. Group play
-- sorts below qualifying, qualifying below the main draw, unrecognised rounds last.

create or replace view public.india_player_matches
with (security_invoker = true) as
with depth as (
    select *,
        case
            when round ~ '^Group [0-9]+'            then 0.5
            when round ~ '^Qualifying Round [0-9]'  then 1 + coalesce(nullif(regexp_replace(round,'\D','','g'),'')::numeric,0)/100
            when round = 'Qualification Elimination Round' then 1.5
            when round = 'Preliminary'              then 2
            when round = 'Round of 128'             then 3
            when round = 'Round of 64'              then 4
            when round = 'Round of 32'              then 5
            when round = 'Round of 16'              then 6
            when round ~ '^Pos\.'                   then 6.5
            when round in ('3rd Place','Bronze')    then 7
            when round in ('Quarterfinal','Quarterfinals') then 8
            when round in ('Semifinal','Semifinals') then 9
            when round = 'Final'                    then 10
            else 0
        end as round_depth
    from india_match_ranked
)
select match_id, event_id, event_name, event_date, discipline, age_band, is_junior,
       kind, round, round_depth,
       ind_p1_id as player_id, ind_p2_id as partner_id, ind_name as player_name,
       ind_rank  as player_rank,
       opp_name, opp_country, opp_rank, opp_is_indian,
       score, game_scores, won, upset_given, upset_taken
from depth

union all

select match_id, event_id, event_name, event_date, discipline, age_band, is_junior,
       kind, round, round_depth,
       opp_p1_id, opp_p2_id, opp_name,
       opp_rank,
       ind_name, 'IND', ind_rank, true,
       split_part(score,'-',2) || '-' || split_part(score,'-',1),
       game_scores,
       not won,
       (opp_rank is not null and ind_rank is not null and not won and opp_rank > ind_rank),
       (opp_rank is not null and ind_rank is not null and won     and opp_rank < ind_rank)
from depth
where opp_is_indian;

grant select on public.india_player_matches to anon, authenticated;
