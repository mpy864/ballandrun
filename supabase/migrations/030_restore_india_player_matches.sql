-- 030_restore_india_player_matches.sql
--
-- The Events tab's expand arrow spun on "Loading…" forever. Every click returned
-- HTTP 400: "column india_player_matches.player_name does not exist".
--
-- This is a regression from migration 026. That migration had to put the matview behind
-- an approval check, and did it by replacing the view with:
--
--     SELECT * FROM india_match_ranked_m WHERE (SELECT public.is_approved())
--
-- SELECT * looked like a faithful copy. It was not. The view built in migration 016 did
-- two things that SELECT * silently discarded:
--
--   1. It RENAMED three columns — ind_p1_id → player_id, ind_name → player_name,
--      ind_rank → player_rank — which is the contract events.js reads against.
--
--   2. It UNIONed a mirrored copy of every all-Indian match. That is the entire
--      difference between this view (one row per Indian PLAYER) and india_match_results
--      (one row per MATCH). Without it a Manika-v-Sreeja tie counts once, not twice, and
--      one of the two players loses the match from her record.
--
-- Both are restored here, verbatim from 016. The only additions are the approval gate,
-- which must sit on BOTH halves of the union — a filter on the first branch does nothing
-- for the second — and security_invoker = false, which is what lets the view reach a
-- matview whose own grants were revoked.

DROP VIEW IF EXISTS public.india_player_matches;

CREATE VIEW public.india_player_matches WITH (security_invoker = false) AS
SELECT match_id, event_id, event_name, event_date, discipline, age_band, is_junior, kind,
       round, round_depth,
       ind_p1_id  AS player_id,
       ind_p2_id  AS partner_id,
       ind_name   AS player_name,
       ind_rank   AS player_rank,
       opp_name, opp_country, opp_rank, opp_is_indian,
       score, game_scores, won, upset_given, upset_taken
FROM public.india_match_ranked_m
WHERE (SELECT public.is_approved())

UNION ALL

-- The mirror. Opponent becomes the player, the score is flipped, and the upset flags
-- invert with it: beating someone ranked above you is an upset GIVEN from the other side
-- of the same result.
SELECT match_id, event_id, event_name, event_date, discipline, age_band, is_junior, kind,
       round, round_depth,
       opp_p1_id  AS player_id,
       opp_p2_id  AS partner_id,
       opp_name   AS player_name,
       opp_rank   AS player_rank,
       ind_name   AS opp_name,
       'IND'::text AS opp_country,
       ind_rank   AS opp_rank,
       true       AS opp_is_indian,
       split_part(score, '-', 2) || '-' || split_part(score, '-', 1) AS score,
       game_scores,
       NOT won AS won,
       opp_rank IS NOT NULL AND ind_rank IS NOT NULL AND NOT won AND opp_rank > ind_rank AS upset_given,
       opp_rank IS NOT NULL AND ind_rank IS NOT NULL AND won     AND opp_rank < ind_rank AS upset_taken
FROM public.india_match_ranked_m
WHERE opp_is_indian AND (SELECT public.is_approved());

GRANT SELECT ON public.india_player_matches TO authenticated;
