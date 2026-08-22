-- Give doubles matches a rank.
--
-- india_match_ranked opened both rank expressions with:
--
--     CASE WHEN b.kind <> 'singles' THEN NULL::integer
--
-- so every doubles match carried a NULL rank on both sides. That is why the dashboard
-- showed no upsets and no difficulty for any doubles event, senior or junior — not
-- because the numbers were missing, but because the view discarded them. They were
-- there the whole time: 337,550 senior pair rows in rankings_doubles_teams and 493,439
-- youth pair rows in youth_rankings_doubles, both current.
--
-- Pairs are matched unordered. WTT lists a pair in whichever order it pleases and the
-- match record does the same, so joining p1 to p1 would miss roughly half of them;
-- least()/greatest() puts both sides in the same order before comparing.
--
-- Discipline drives which sub-event to read, because a pair holds three unrelated
-- rankings at once — the same two players can be ranked in MD and XD with different
-- partners and different numbers. Reading the wrong one would be worse than reading
-- none, so an unrecognised discipline yields NULL rather than a guess.
--
-- Coverage is partial and that is honest: 617 of 904 senior India doubles matches can
-- find a pair rank as of today. A pair ranked for the first time after an event, or one
-- that never entered the list, stays NULL — and every consumer already treats NULL as
-- "not comparable" rather than as zero.

create or replace view india_match_ranked as
with base as (
  select r.*,
    case
      when r.discipline ~* 'girls|women' then 'WS'
      when r.discipline ~* 'boys|men'    then 'MS'
      else null
    end as youth_sub,
    -- Which doubles list this match belongs to. Mixed is tested first: "U19 Mixed
    -- Doubles" also matches the men/boys pattern on the word "Mixed"? It does not, but
    -- ordering it first removes any doubt as the labels change.
    case
      when r.kind = 'singles'          then null
      when r.discipline ~* 'mixed'     then 'XD'
      when r.discipline ~* 'girls|women' then 'WD'
      when r.discipline ~* 'boys|men'  then 'MD'
      else null
    end as dbl_sub
  from india_match_results r
), withrank as (
  select b.*,
    case
      -- ── singles ──────────────────────────────────────────────────────────
      when b.kind = 'singles' and b.is_junior then (
        select y.age_cat_rank from youth_rankings_singles y
        where y.ittf_id = b.ind_p1_id::text and y.age_category = b.age_band
          and y.sub_event = b.youth_sub and y.publish_date <= b.event_date
        order by y.publish_date desc limit 1)
      when b.kind = 'singles' then (
        select s.rank from rankings_singles_normalized s
        where s.player_id = b.ind_p1_id and s.ranking_date <= b.event_date
        order by s.ranking_date desc limit 1)
      -- ── doubles ──────────────────────────────────────────────────────────
      when b.dbl_sub is null or b.ind_p2_id is null then null
      when b.is_junior then (
        select y.age_cat_rank from youth_rankings_doubles y
        where least(y.ittf_id1::bigint, y.ittf_id2::bigint) = least(b.ind_p1_id, b.ind_p2_id)
          and greatest(y.ittf_id1::bigint, y.ittf_id2::bigint) = greatest(b.ind_p1_id, b.ind_p2_id)
          and y.age_category = b.age_band and y.sub_event = b.dbl_sub
          and y.publish_date <= b.event_date
        order by y.publish_date desc limit 1)
      else (
        select t.current_rank from rankings_doubles_teams t
        where least(t.p1_ittf_id, t.p2_ittf_id) = least(b.ind_p1_id, b.ind_p2_id)
          and greatest(t.p1_ittf_id, t.p2_ittf_id) = greatest(b.ind_p1_id, b.ind_p2_id)
          and t.category = b.dbl_sub and t.publish_date <= b.event_date
        order by t.publish_date desc limit 1)
    end as ind_rank,
    case
      when b.kind = 'singles' and b.is_junior then (
        select y.age_cat_rank from youth_rankings_singles y
        where y.ittf_id = b.opp_p1_id::text and y.age_category = b.age_band
          and y.sub_event = b.youth_sub and y.publish_date <= b.event_date
        order by y.publish_date desc limit 1)
      when b.kind = 'singles' then (
        select s.rank from rankings_singles_normalized s
        where s.player_id = b.opp_p1_id and s.ranking_date <= b.event_date
        order by s.ranking_date desc limit 1)
      when b.dbl_sub is null or b.opp_p2_id is null then null
      when b.is_junior then (
        select y.age_cat_rank from youth_rankings_doubles y
        where least(y.ittf_id1::bigint, y.ittf_id2::bigint) = least(b.opp_p1_id, b.opp_p2_id)
          and greatest(y.ittf_id1::bigint, y.ittf_id2::bigint) = greatest(b.opp_p1_id, b.opp_p2_id)
          and y.age_category = b.age_band and y.sub_event = b.dbl_sub
          and y.publish_date <= b.event_date
        order by y.publish_date desc limit 1)
      else (
        select t.current_rank from rankings_doubles_teams t
        where least(t.p1_ittf_id, t.p2_ittf_id) = least(b.opp_p1_id, b.opp_p2_id)
          and greatest(t.p1_ittf_id, t.p2_ittf_id) = greatest(b.opp_p1_id, b.opp_p2_id)
          and t.category = b.dbl_sub and t.publish_date <= b.event_date
        order by t.publish_date desc limit 1)
    end as opp_rank
  from base b
)
select kind, match_id, event_id, event_name, event_date, discipline, age_band, is_junior,
       age_group, round, ind_is_comp1, ind_p1_id, ind_p2_id, ind_name, opp_p1_id, opp_p2_id,
       opp_name, opp_country, opp_is_indian, score, game_scores, won, youth_sub,
       ind_rank, opp_rank,
       ind_rank is not null and opp_rank is not null and won     and ind_rank > opp_rank as upset_given,
       ind_rank is not null and opp_rank is not null and not won and ind_rank < opp_rank as upset_taken
from withrank w;

-- Without these the view times out. The lookup matches an UNORDERED pair, so it filters
-- on least()/greatest() rather than on the columns themselves, and a plain index on
-- p1_ittf_id cannot serve that — Postgres scanned 337k and 493k rows once per match row.
-- Index the expressions the view actually uses.
create index if not exists idx_rdt_pair_lookup
  on rankings_doubles_teams (
    least(p1_ittf_id, p2_ittf_id),
    greatest(p1_ittf_id, p2_ittf_id),
    category,
    publish_date desc);

create index if not exists idx_yrd_pair_lookup
  on youth_rankings_doubles (
    least(ittf_id1::bigint, ittf_id2::bigint),
    greatest(ittf_id1::bigint, ittf_id2::bigint),
    age_category,
    sub_event,
    publish_date desc);
