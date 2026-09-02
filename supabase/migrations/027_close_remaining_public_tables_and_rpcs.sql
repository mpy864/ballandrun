-- 027_close_remaining_public_tables_and_rpcs.sql
--
-- What the approval gate missed, found by running the Supabase security advisor after it.
--
-- Migration 024 walked a hand-written list of tables, which is the wrong way to close a
-- hole: anything not on the list stayed open. Four tables had RLS switched off entirely
-- and answered the publishable key from outside the app —
--
--   player_age_rank      178,830 rows
--   wtt_ranking_points    42,021 rows
--   tg_sent                  205 rows   (the Telegram send log)
--   feed_health               17 rows   (the pipeline health board)
--
-- This migration enumerates from the catalogue instead, so a table added tomorrow is
-- caught by the same rule rather than by somebody remembering to add it.

DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    EXECUTE format('DROP POLICY IF EXISTS approved_read ON public.%I', t.relname);
    EXECUTE format(
      'CREATE POLICY approved_read ON public.%I FOR SELECT USING ((SELECT public.is_approved()))',
      t.relname);
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon', t.relname);
  END LOOP;
END $$;
