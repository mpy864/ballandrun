-- 032_ag2026_public_read.sql
--
-- Open the Asian Games 2026 tables to anonymous readers, and only those.
--
-- Migrations 024-028 closed this database to anon deliberately, and that stays
-- true for every wtt_*, ttfi_*, rankings_* and India table. This migration is a
-- narrow, explicit exception so the /asiangames page can be shared with a coach
-- by link, with no sign-up and no approval step.
--
-- What this publishes: the draw, the schedule, live scores, the per-game
-- probability trail, and the model's win probabilities and medal odds for one
-- nine-day tournament. Anyone with the URL can read it. That is the trade
-- being made — the WTT model's own forecasts, player database and domestic
-- data remain closed.
--
-- ag2026_raw is deliberately NOT opened: it stores whole unedited payloads
-- captured for debugging, which is an internal diagnostic surface, not content.

-- 1. Read grant for the anonymous role on the five content tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ag2026_athletes','ag2026_units','ag2026_live_state',
                           'ag2026_game_log','ag2026_forecasts']
  LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO anon', t);

    -- RLS policies are permissive and OR together, so this sits alongside the
    -- existing approved_read rather than replacing it: an approved signed-in
    -- user still reads through that one, and everyone else reads through this.
    EXECUTE format('DROP POLICY IF EXISTS ag2026_public_read ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY ag2026_public_read ON public.%I FOR SELECT TO anon, authenticated USING (true)', t);
  END LOOP;
END $$;

-- 2. Live updates for logged-out viewers.
-- postgres_changes only delivers rows from tables in this publication, and the
-- page falls back to polling if a socket cannot be established — but without
-- this the fallback is the only path and the board lags by the poll interval.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                  WHERE pubname = 'supabase_realtime' AND tablename = 'ag2026_live_state') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ag2026_live_state;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                  WHERE pubname = 'supabase_realtime' AND tablename = 'ag2026_game_log') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ag2026_game_log;
  END IF;
END $$;

-- 3. Nothing here grants INSERT, UPDATE or DELETE to anyone. Writes stay with
--    the service key the GitHub Actions jobs use.
