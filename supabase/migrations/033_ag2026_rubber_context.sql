-- 033_ag2026_rubber_context.sql
--
-- Give a team rubber the context it needs to be readable on its own.
--
-- A team tie is five individual singles matches, and each one is scored
-- separately: WANG Chuqin v ABDULHUSSEIN Abdullah is its own match with its own
-- live probability. But ag2026_live_state stored only the two players, so on the
-- board that rubber appeared as an unattached singles match. A viewer could not
-- tell it was the first of five in China v Qatar, or that the tie was already
-- 2-0 up.
--
-- The poller knows all of this at write time — it walks the tie to reach the
-- rubbers — so it is cheaper to store it than to make the page re-derive it with
-- a second query per rubber.

ALTER TABLE public.ag2026_live_state
  ADD COLUMN IF NOT EXISTS parent_unit text,   -- the tie this rubber belongs to
  ADD COLUMN IF NOT EXISTS rubber_num  int DEFAULT 0,  -- 1..5; 0 = a standalone match
  ADD COLUMN IF NOT EXISTS tie_label   text,   -- 'China v Qatar'
  ADD COLUMN IF NOT EXISTS tie_score   text;   -- '2-0', the tie score in rubbers

CREATE INDEX IF NOT EXISTS idx_ag_live_parent
  ON public.ag2026_live_state (parent_unit) WHERE parent_unit IS NOT NULL;

-- The anon read grant and the ag2026_public_read policy from migration 032 are
-- table-level, so they cover these columns already. Nothing to re-grant.
