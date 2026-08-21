-- Grade the South Asia youth championships.
--
-- "ITTF-ATTU South Asia Youth Championships Shimla 2026" matched no rule: the senior
-- pattern is '%South Asian Regional%', and this reads "South Asia Youth". It is the
-- only ungraded event India has actually played — 64 Indian matches — the other 49
-- ungraded youth events are the African, Oceanian, Pan American and European
-- championships, which India does not enter.
--
-- Graded 5 rather than 4, as decided: WTT Youth Contender now sits at 4 and draws a
-- European and East Asian field, while this is a six-nation regional. Putting them on
-- the same grade would flatten the difference the grade exists to show.

insert into tops_grade_rules (pattern, tops_grade)
select '%South Asia Youth%', 5
where not exists (select 1 from tops_grade_rules where pattern = '%South Asia Youth%');
