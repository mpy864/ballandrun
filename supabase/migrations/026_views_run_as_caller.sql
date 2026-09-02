-- 026_views_run_as_caller.sql
--
-- The approval gate had a hole: views.
--
-- A view without security_invoker runs with its OWNER's privileges, so it reads the
-- underlying tables as postgres and RLS never applies. Gating wtt_matches_singles
-- therefore did nothing for india_match_results, which selects from it — a pending
-- account was refused the table and handed the same rows through the view. This was
-- caught by testing a pending user directly, not by reading the policies.
--
-- security_invoker makes a view run as whoever queries it, so the policies underneath do
-- their job.
--
-- Materialised views cannot do this: RLS does not apply to them and there is no
-- security_invoker option, so the only lever is the grant.

DO $$
DECLARE v record;
BEGIN
  FOR v IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
      AND coalesce((SELECT option_value FROM pg_options_to_table(c.reloptions)
                    WHERE option_name = 'security_invoker'), 'false') = 'false'
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v.relname);
  END LOOP;

  FOR v IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'm'
  LOOP
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon, authenticated', v.relname);
  END LOOP;
END $$;

-- Revoking the matviews outright was right for the five nothing reads and wrong for the
-- two the Events tab does read: it broke the tab for everyone, admin included.
-- india_player_matches selects from india_match_ranked_m, and events.js reads
-- india_event_report by name. Both now go through a view that keeps the OWNER's rights —
-- the only way to reach a matview whose grants are gone — and carries the approval check
-- in its own WHERE clause instead.

DROP VIEW IF EXISTS public.india_player_matches;
CREATE VIEW public.india_player_matches WITH (security_invoker = false) AS
SELECT * FROM public.india_match_ranked_m WHERE (SELECT public.is_approved());
GRANT SELECT ON public.india_player_matches TO authenticated;

-- The matview is renamed so a gated view can take the name events.js already asks for.
-- CONCURRENTLY's unique index rides along with the rename.
ALTER MATERIALIZED VIEW public.india_event_report RENAME TO india_event_report_mv;

CREATE VIEW public.india_event_report WITH (security_invoker = false) AS
SELECT * FROM public.india_event_report_mv WHERE (SELECT public.is_approved());
GRANT SELECT ON public.india_event_report TO authenticated;
REVOKE SELECT ON public.india_event_report_mv FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_india_event_report()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
    set local statement_timeout = '900s';
    refresh materialized view concurrently public.india_event_report_mv;
end;
$function$;
