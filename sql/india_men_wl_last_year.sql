-- ============================================================================
--  W/L for five Indian men, senior Men's Singles, last 12 months
--
--  Three buckets per player:
--    A. vs world top 50
--    B. vs Asian countries (Russia and Turkiye excluded)
--    C. vs the top 5 of their own country, among Asian countries
--
--  A player can land in more than one bucket. A match against Lin Shidong is
--  counted in all three; the buckets are three questions about the same set of
--  matches, not a split of it.
--
--  Ranks are the opponent's rank ON THE DAY OF THE MATCH — the last ranking
--  published on or before event_date. Beating a then-No.12 who has since
--  dropped to 80 still counts as beating a top-50 player. See NOTE 2 to switch
--  this to today's rank instead.
-- ============================================================================

WITH params AS (
    SELECT
        (CURRENT_DATE - INTERVAL '12 months')::date AS since,
        CURRENT_DATE                                AS until,
        50                                          AS world_top_n,
        5                                           AS country_top_n
),

-- ── The five athletes ────────────────────────────────────────────────────────
focus AS (
    SELECT * FROM (VALUES
        (111641, 'Harmeet DESAI'),
        (123682, 'Manav THAKKAR'),
        (131879, 'Manush SHAH'),
        (103126, 'Sathiyan GNANASEKARAN'),
        (131917, 'Payas JAIN')
    ) AS t(ittf_id, label)
),

-- ── Asian countries ──────────────────────────────────────────────────────────
--  ITTF/ATTU membership by its three-letter codes. RUS and TUR are deliberately
--  absent: Russia sits in the Asian union since 2023 and Turkiye straddles the
--  two, and both were excluded by request.
asian AS (
    SELECT * FROM (VALUES
        ('CHN'),('JPN'),('KOR'),('PRK'),('TPE'),('HKG'),('MAC'),('MGL'),
        ('IND'),('PAK'),('BAN'),('SRI'),('NEP'),('BHU'),('MDV'),('AFG'),
        ('SGP'),('MAS'),('THA'),('VIE'),('INA'),('PHI'),('MYA'),('CAM'),
        ('LAO'),('BRU'),('TLS'),
        ('IRI'),('IRQ'),('QAT'),('KSA'),('UAE'),('KUW'),('BRN'),('OMA'),
        ('YEM'),('JOR'),('LBN'),('SYR'),('PLE'),
        ('UZB'),('KAZ'),('KGZ'),('TJK'),('TKM')
    ) AS t(country_code)
),

-- ── Every senior Men's Singles match one of the five played ──────────────────
--  age_group IS NULL is what marks a senior draw; U11-U19 rows carry their band.
--  Flipped so each row reads from the focus player's side.
matches AS (
    SELECT
        f.ittf_id                                             AS player_id,
        f.label                                               AS player,
        m.match_id,
        m.event_date,
        CASE WHEN m.comp1_id = f.ittf_id THEN m.comp2_id
             ELSE m.comp1_id END                              AS opponent_id,
        CASE WHEN (m.comp1_id = f.ittf_id AND m.result = 'W')
               OR (m.comp2_id = f.ittf_id AND m.result = 'L')
             THEN 1 ELSE 0 END                                AS won
    FROM wtt_matches_singles m
    JOIN focus f  ON f.ittf_id IN (m.comp1_id, m.comp2_id)
    CROSS JOIN params p
    WHERE m.event_date BETWEEN p.since AND p.until
      AND m.age_group IS NULL          -- senior only
      AND m.result IN ('W', 'L')       -- drop unplayed / walkover placeholders
),

-- ── Opponent identity + world rank on the day ────────────────────────────────
enriched AS (
    SELECT
        mt.*,
        op.player_name    AS opponent,
        op.country_code   AS opponent_country,
        r.rank            AS opponent_rank_at_match
    FROM matches mt
    JOIN wtt_players op ON op.ittf_id = mt.opponent_id
    LEFT JOIN LATERAL (
        SELECT rk.rank
        FROM rankings_singles_normalized rk
        WHERE rk.player_id    = mt.opponent_id
          AND rk.gender       = 'M'
          AND rk.ranking_date <= mt.event_date
        ORDER BY rk.ranking_date DESC
        LIMIT 1
    ) r ON TRUE
    WHERE op.gender = 'M'              -- Men's Singles on both sides of the net
),

-- ── Top N of each Asian country, by the newest published week ────────────────
--  "Top 5 of their respective country" is read as: the opponent is one of the
--  five best-ranked men their own country has. Countries with fewer than five
--  ranked men contribute everyone they have.
latest_week AS (
    SELECT ranking_year, ranking_week
    FROM rankings_singles_normalized
    WHERE gender = 'M'
    ORDER BY ranking_year DESC, ranking_week DESC
    LIMIT 1
),
country_top AS (
    SELECT
        rk.player_id,
        pl.country_code,
        ROW_NUMBER() OVER (PARTITION BY pl.country_code ORDER BY rk.rank) AS rank_in_country
    FROM rankings_singles_normalized rk
    JOIN latest_week lw ON lw.ranking_year = rk.ranking_year
                       AND lw.ranking_week = rk.ranking_week
    JOIN wtt_players pl ON pl.ittf_id = rk.player_id
    JOIN asian a        ON a.country_code = pl.country_code
    WHERE rk.gender = 'M'
      AND rk.rank IS NOT NULL
),

-- ── Tag each match with the buckets it belongs to ────────────────────────────
tagged AS (
    SELECT
        e.*,
        (e.opponent_rank_at_match IS NOT NULL
         AND e.opponent_rank_at_match <= p.world_top_n)          AS is_top_world,
        (a.country_code IS NOT NULL)                             AS is_asian,
        (a.country_code IS NOT NULL
         AND ct.rank_in_country IS NOT NULL
         AND ct.rank_in_country <= p.country_top_n)              AS is_country_top
    FROM enriched e
    CROSS JOIN params p
    LEFT JOIN asian a       ON a.country_code = e.opponent_country
    LEFT JOIN country_top ct ON ct.player_id  = e.opponent_id
)

-- ── Result ───────────────────────────────────────────────────────────────────
SELECT
    player,
    bucket,
    COUNT(*)                                                  AS matches,
    SUM(won)                                                  AS wins,
    COUNT(*) - SUM(won)                                       AS losses,
    ROUND(100.0 * SUM(won) / NULLIF(COUNT(*), 0), 1)          AS win_pct
FROM (
    SELECT player, won, 'A. vs world top 50'          AS bucket, 1 AS ord FROM tagged WHERE is_top_world
    UNION ALL
    SELECT player, won, 'B. vs Asia (no RUS/TUR)'     AS bucket, 2 AS ord FROM tagged WHERE is_asian
    UNION ALL
    SELECT player, won, 'C. vs country top 5 (Asia)'  AS bucket, 3 AS ord FROM tagged WHERE is_country_top
    UNION ALL
    SELECT player, won, 'D. all senior MS (baseline)' AS bucket, 4 AS ord FROM tagged
) s
GROUP BY player, bucket, ord
ORDER BY player, ord;


-- ============================================================================
--  NOTE 1 — the match list behind any bucket
--  Swap the final SELECT for this to see the matches themselves.
-- ============================================================================
--
--  SELECT player, event_date, opponent, opponent_country,
--         opponent_rank_at_match, CASE WHEN won = 1 THEN 'W' ELSE 'L' END AS res,
--         is_top_world, is_asian, is_country_top
--  FROM tagged
--  ORDER BY player, event_date DESC;
--
-- ============================================================================
--  NOTE 2 — today's rank instead of rank-on-the-day
--  In `enriched`, drop the `AND rk.ranking_date <= mt.event_date` line. The
--  LATERAL then returns each opponent's newest rank, and bucket A becomes
--  "opponents who are top 50 now".
--
--  NOTE 3 — a match counts in more than one bucket by design. Bucket D is every
--  senior Men's Singles match in the window, so A, B and C read as shares of it.
--
--  NOTE 4 — opponents outside the top 1000 have no rank row at all, so
--  opponent_rank_at_match is NULL and they never enter bucket A. That is
--  correct: unranked is not top 50.
-- ============================================================================
