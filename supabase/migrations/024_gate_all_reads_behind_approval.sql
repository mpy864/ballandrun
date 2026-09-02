-- 024_gate_all_reads_behind_approval.sql
--
-- 24 SELECT policies were written USING (true) — readable by anyone, signed in or not.
-- The anon key ships inside the JavaScript bundle every browser downloads, so this was
-- not "public to logged-in users"; it was public to the internet: 57,008 athlete
-- profiles with dates of birth, every ranking, every entry list, the domestic Indian
-- matches, and the forecast and simulation output.
--
-- Postgres ORs permissive policies together, so a table carrying both an auth_read
-- policy and a true policy was fully public and the auth check did nothing at all.
--
-- The check is written (SELECT public.is_approved()), not public.is_approved(). An RLS
-- qual is applied as a filter on the scan, and a bare function call there is evaluated
-- per row — on a 1.7M-row table that blew the statement timeout. The scalar subquery
-- makes the planner hoist it into an InitPlan, one evaluation per statement. The
-- policies already on this database use the same trick: they say (SELECT auth.uid())
-- rather than auth.uid().
--
-- The ingest scripts are unaffected: they use the service key, which bypasses RLS.

DO $$
DECLARE
  t text;
  p record;
  tables text[] := ARRAY[
    'elite_benchmark_profile','player_benchmark_stats','rankings_singles_normalized',
    'rankings_doubles_teams','tennis_entries','tennis_events','tennis_match_stats',
    'tennis_matches','tennis_players','tennis_rankings','ttfi_domestic_matches',
    'ttfi_tournaments','tops_grade_rules','wtt_draw_matches','wtt_entries','wtt_events',
    'wtt_forecasts','wtt_game_log','wtt_live_state','wtt_match_results',
    'wtt_matches_singles','wtt_matches_doubles','wtt_pairs','wtt_players',
    'wttc_lineup_results','wttc_sim_results','youth_rankings_doubles',
    'youth_rankings_singles'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'skipping %, does not exist', t;
      CONTINUE;
    END IF;

    -- Drop every existing SELECT policy first. Leaving one behind would defeat the new
    -- one, because permissive policies are OR'd.
    FOR p IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND cmd = 'SELECT'
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY approved_read ON public.%I FOR SELECT USING ((SELECT public.is_approved()))', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
