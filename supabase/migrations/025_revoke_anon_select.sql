-- 025_revoke_anon_select.sql
--
-- RLS denies correctly but not cheaply. Even hoisted into an InitPlan the approval check
-- is not a plan-time constant, so it never becomes a One-Time Filter that skips the scan:
--
--   Seq Scan on youth_rankings_singles
--     Filter: (InitPlan 1).col1
--     Rows Removed by Filter: 1724932
--     Execution Time: 1700 ms
--
-- Three tables blew the statement timeout and returned HTTP 500 to an anonymous caller,
-- who could have repeated that at will.
--
-- Grants are checked before RLS and cost nothing. anon has no business reading any of
-- this, so revoke it there and let RLS do the finer work for signed-in users. Denial for
-- a stranger is now a 75ms permission error instead of a 1.7-second scan.
--
-- authenticated and service_role are untouched: the app reads as authenticated, and the
-- ingest scripts use the service key.

DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT DISTINCT tablename FROM pg_policies
    WHERE schemaname = 'public' AND cmd = 'SELECT' AND qual LIKE '%is_approved%'
  LOOP
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon', t.tablename);
  END LOOP;
END $$;

DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'india_match_results','india_match_ranked','india_player_matches','india_result_events',
    'india_upcoming_entries','india_upcoming_entry_athletes','wtt_events_graded',
    'v_player_event_result'
  ] LOOP
    IF to_regclass('public.' || v) IS NOT NULL THEN
      EXECUTE format('REVOKE SELECT ON public.%I FROM anon', v);
    END IF;
  END LOOP;
END $$;
