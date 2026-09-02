-- 028_revoke_rpc_execute_from_public.sql
--
-- Every SECURITY DEFINER function in this schema is reachable at /rest/v1/rpc/<name>, and
-- SECURITY DEFINER means it runs as the owner — bypassing the RLS the tables now carry.
-- So the gate on the tables did nothing for anything reachable this way.
--
-- The worst of them: refresh_india_event_report() sets its own statement_timeout to 900s
-- and rebuilds a materialised view. Anyone on the internet could POST to it, repeatedly,
-- and each call is fifteen minutes of database.
--
-- REVOKE ... FROM anon does not close this. Postgres grants EXECUTE on every new function
-- to PUBLIC, and anon inherits it there; taking it from anon leaves the PUBLIC grant
-- untouched. refresh_india_tournament_mv() still answered an anonymous POST after a
-- migration that claimed to have closed it, which is how this was caught.
--
-- Default-deny from PUBLIC, then hand back exactly what is needed.

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;

-- The two the login page needs before a session exists. Each answers one bit about the
-- caller and nothing about anybody else.
GRANT EXECUTE ON FUNCTION public.is_approved() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin()    TO anon, authenticated;

-- Data the app reads for a signed-in user.
GRANT EXECUTE ON FUNCTION public.podium_readiness(integer[])             TO authenticated;
GRANT EXECUTE ON FUNCTION public.podium_readiness_pair(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.india_tournament_performance(date)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_audit_view(integer)             TO authenticated;

-- Nothing else gets a grant. The refresh functions and handle_new_user() — a trigger
-- function, never an endpoint — are now reachable only by the service key, which is what
-- the nightly jobs already use.

-- ── search_path ─────────────────────────────────────────────────────────────
--
-- A SECURITY DEFINER function without a pinned search_path resolves its table names
-- against the caller's search_path. Someone able to create a table in a schema earlier on
-- that path could choose which "wtt_matches_singles" the function reads, while it runs as
-- the owner.

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('compute_elo_ratings', 'compute_elo_ratings_excl',
                        'patch_singles_age_cat_ranks', 'patch_doubles_age_cat_ranks',
                        'fn_write_match_result')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path TO ''public''', f.sig);
  END LOOP;
END $$;
