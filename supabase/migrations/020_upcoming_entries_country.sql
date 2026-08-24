-- 020_upcoming_entries_country.sql
--
-- Add country to india_upcoming_entries.
--
-- Half the WTT calendar is named after the host city rather than the country. The
-- Bulgaria event is "WTT Contender Panagyurishte"; the upcoming-events panel showed that
-- name alone, so nothing on screen said Bulgaria and the event read as one nobody had
-- heard of. The column exists on wtt_events and the view already joins to it — it simply
-- was not carried through.
--
-- Nothing else about the view changes. country goes LAST, not next to event_name where
-- it reads better: CREATE OR REPLACE VIEW can only append columns, and inserting one in
-- the middle fails with "cannot change name of view column".

CREATE OR REPLACE VIEW india_upcoming_entries AS
SELECT
    e.event_id,
    e.event_name,
    e.start_date,
    e.start_date - CURRENT_DATE                                              AS days_away,
    count(DISTINCT en.player_id)                                             AS athletes,
    count(*)                                                                 AS entries,
    count(DISTINCT en.player_id) FILTER (WHERE en.sub_event ~ '^U[0-9]')     AS junior_athletes,
    count(DISTINCT en.player_id) FILTER (WHERE en.sub_event !~ '^U[0-9]')    AS senior_athletes,
    max(en.last_updated)                                                     AS entries_refreshed_at,
    e.country
FROM wtt_entries en
JOIN wtt_events  e ON e.event_id = en.event_id
JOIN wtt_players p ON p.ittf_id  = en.player_id AND p.country_code = 'IND'
WHERE e.start_date >= CURRENT_DATE
GROUP BY e.event_id, e.event_name, e.start_date, e.country;
