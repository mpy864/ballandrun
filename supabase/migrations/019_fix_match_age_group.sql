-- Set age_group from the DRAW the match was in, not the player who was in it.
--
-- Two things get confused here, and this is the third place in this codebase they have
-- been confused: the band a PLAYER belongs to, and the band of the COMPETITION they
-- entered. A 16-year-old is U17. She can enter the U19 draw. The match belongs to U19;
-- only she belongs to U17.
--
-- age_group held the player's band. 26,111 junior singles matches were filed one step
-- too young, and the error is almost perfectly one-directional — U17 tagged on a U19
-- draw 8,853 times, U15 on U17 7,677 times, U13 on U15 4,856 times, and only 9 rows out
-- of 26,111 in the other direction. That is the signature of a player-band value, not a
-- random mislabel. 5,901 players affected, 277 of them Indian.
--
-- Why it survived nightly refreshes: parse_match() (singles) never wrote age_group at
-- all, and an upsert only touches the columns it is given. So a value left by an older
-- version sat there untouched while last_updated kept moving — rows written in May 2026
-- still carried a 2024 mistake. parse_doubles_match() always wrote it, which is why
-- wtt_matches_doubles is clean: 0 wrong out of 6,769. The parser is fixed in the same
-- commit; without that this update would be undone.
--
-- round_phase is the source of truth and already correct on all 83,142 rows: it reads
-- "U19 Girls' Singles - Group 6 - Match 1". Nothing needs re-downloading.
--
-- 1,037 rows are deliberately left alone. They have no band in round_phase and none in
-- event_category either, so there is nothing to derive from. A wrong value that is
-- visible beats a guess that is not.

update wtt_matches_singles
   set age_group = substring(round_phase from '^U[0-9]+')
 where round_phase ~ '^U[0-9]+'
   and age_group is distinct from substring(round_phase from '^U[0-9]+');

-- 42,129 rows changed: 26,111 corrected, 16,018 filled in for the first time.
-- After: 83,142 of 83,142 agree with their draw.
