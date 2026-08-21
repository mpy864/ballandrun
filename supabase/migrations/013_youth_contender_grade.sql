-- Grade the WTT Youth Contender circuit.
--
-- tops_grade_rules matches an event by NAME pattern, and the rule for the Contender
-- circuit was '%WTT Contender%'. Every youth stop is called "WTT Youth Contender
-- Almaty 2026" — the word Youth sits between WTT and Contender, so the pattern never
-- matched and 229 events fell through to no grade at all. On the player pages those
-- events showed as "Unclassified", which for a junior is most of their season: it was
-- 29W/9L of Divyanshi Bhowmick's 36W/13L.
--
-- Graded 4, level with the senior WTT Contender, as decided.
--
-- The Star Contender line needs no rule: wtt_events_graded picks the LOWEST matching
-- tops_grade, so "WTT Youth Star Contender" matches both '%Star Contender%' (3) and
-- the new rule (4), and keeps 3 — level with the senior Star Contender, which is the
-- right answer for the same reason.

-- `where not exists` rather than `on conflict`: there is no unique index on pattern,
-- so a second run would otherwise insert a duplicate rule.
insert into tops_grade_rules (pattern, tops_grade)
select '%Youth Contender%', 4
where not exists (select 1 from tops_grade_rules where pattern = '%Youth Contender%');
