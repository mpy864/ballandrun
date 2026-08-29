-- 021_match_event_date_index.sql
--
-- Index event_date on both match tables.
--
-- Neither table had one. They carried indexes on match_id, event_id and the player
-- columns, but nothing on the date — so every date-ranged query fell back to a
-- sequential scan. Asking india_match_results for the last seven days:
--
--   Parallel Seq Scan on wtt_matches_singles   Rows Removed by Filter: 53,878
--   Seq Scan on wtt_matches_doubles            Rows Removed by Filter: 12,783
--   Execution Time: 939.157 ms
--
-- 939 ms to return 15 rows. The live strip on the TOPS tab reads that view on every
-- load, but it is not the only caller — anything asking "what happened recently" pays
-- the same cost today.
--
-- DESC because every caller wants the newest first.

CREATE INDEX IF NOT EXISTS idx_singles_event_date
    ON wtt_matches_singles (event_date DESC);

CREATE INDEX IF NOT EXISTS idx_doubles_event_date
    ON wtt_matches_doubles (event_date DESC);
