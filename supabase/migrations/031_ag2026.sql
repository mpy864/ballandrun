-- 031_ag2026.sql
--
-- Asian Games 2026 (Aichi-Nagoya) table tennis: live prediction dashboard.
--
-- A separate namespace from wtt_*, deliberately. The WTT live pipeline runs on cron
-- through the whole of the Games; a mistake in a nine-day tournament feed must not be
-- able to touch it. Nothing here alters an existing table.
--
-- Two ids matter and they are NOT the same number:
--   reg      the Games accreditation id, e.g. '380315'. Unique per athlete per Games.
--   ittf_id  the IFId from entries/bio, e.g. 123980. This is the join key to
--            wtt_players and to the model's player_states.
-- Measured on 2026-09-20: 97 of 98 singles entrants carry an IFId, and all 96 distinct
-- ids resolve in wtt_players. One Lebanese athlete has none and is not in the draw.
--
-- The unit key is the ODF RSC code, e.g.
--   M.SINGLES-----------.R64-.00010000
--   |__event__________| |ph| |idx||rb|
-- match_idx = int(unit[:4]) is the bracket slot; rubber_num = int(unit[4:]) is 0 for a
-- match or a team tie, and 1..5 for the individual rubbers inside a tie. Rubbers are
-- stored as ordinary rows so the live poller needs no special case for team events.


-- ── Accreditation -> ITTF id bridge ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ag2026_athletes (
    reg           text PRIMARY KEY,            -- Games accreditation id
    ittf_id       int,                         -- IFId; NULL = unbridged
    id_source     text    DEFAULT 'ifid',      -- ifid | name | none
    org           text,
    gender        text,                        -- M | W
    ptype         text,                        -- A = athlete, T = team/pair
    name          text,
    name_s        text,
    given_name    text,
    family_name   text,
    dob           date,
    in_singles    boolean DEFAULT false,
    in_team       boolean DEFAULT false,
    in_doubles    boolean DEFAULT false,
    last_updated  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ag_ath_ittf   ON public.ag2026_athletes (ittf_id);
CREATE INDEX IF NOT EXISTS idx_ag_ath_single ON public.ag2026_athletes (gender, in_singles);


-- ── Every scheduled unit: a match, a team tie, or one rubber of a tie ────────

CREATE TABLE IF NOT EXISTS public.ag2026_units (
    unit_key      text PRIMARY KEY,            -- full RSC code
    event_key     text NOT NULL,               -- M.SINGLES-----------
    event_desc    text,
    phase_key     text,
    phase_desc    text,
    round_code    text,                        -- R64 | QFNL | GPA ...
    round_label   text,                        -- R64 | QF | F | BM | GRP  (NULL = unmapped)
    discipline    text,                        -- singles | team | doubles | mixed
    gender        text,                        -- M | W | X
    match_idx     int,                         -- bracket slot, int(unit[:4])
    rubber_num    int DEFAULT 0,               -- 0 = the match/tie itself
    parent_unit   text,                        -- the tie key, for a rubber
    status        text,                        -- PROVISIONAL | OFFICIAL | UNOFFICIAL ...
    is_live       boolean DEFAULT false,
    is_bye        boolean DEFAULT false,
    start_at      timestamptz,                 -- DateTimeRaw carries +09:00; keep the zone
    estimated     boolean DEFAULT false,
    venue_desc    text,
    loc_desc      text,                        -- 'Table 1'
    best_of       int,
    medal         text,
    home_reg      text,
    away_reg      text,
    home_ittf     int,
    away_ittf     int,
    home_org      text,
    away_org      text,
    home_name     text,
    away_name     text,
    home_result   int,
    away_result   int,
    winner_side   text,                        -- home | away | NULL
    res_detail    text,                        -- '11:1, 11:6, 11:5'
    duration      text,
    p_prematch    numeric(6,4),                -- P(home wins), frozen at first sight
    raw           jsonb,                       -- the whole unit object, nothing lost
    last_updated  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ag_units_event  ON public.ag2026_units (event_key, round_label, match_idx);
CREATE INDEX IF NOT EXISTS idx_ag_units_day    ON public.ag2026_units (start_at);
CREATE INDEX IF NOT EXISTS idx_ag_units_live   ON public.ag2026_units (is_live) WHERE is_live;
CREATE INDEX IF NOT EXISTS idx_ag_units_parent ON public.ag2026_units (parent_unit) WHERE parent_unit IS NOT NULL;


-- ── Live win probability, one row per unit in play ──────────────────────────

CREATE TABLE IF NOT EXISTS public.ag2026_live_state (
    unit_key     text PRIMARY KEY,
    event_key    text NOT NULL,
    round_label  text,
    comp1_id     int,
    comp2_id     int,
    comp1_name   text,
    comp2_name   text,
    comp1_org    text,
    comp2_org    text,
    games_a      int DEFAULT 0,
    games_b      int DEFAULT 0,
    pts_a        int,                          -- NULL when point data is unavailable
    pts_b        int,
    best_of      int DEFAULT 5,
    p_prematch   numeric(6,4),
    p_win        numeric(6,4),
    prob_level   text DEFAULT 'game',          -- point | game | prematch
    res_detail   text,
    status       text,                         -- live | finished
    data_age_s   int,                          -- CloudFront Age at fetch: the real lag
    updated_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ag_live_status ON public.ag2026_live_state (status, updated_at DESC);


-- ── Per-game probability trail ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ag2026_game_log (
    unit_key      text NOT NULL,
    game_number   int  NOT NULL,
    event_key     text,
    comp1_id      int,
    comp2_id      int,
    score_a       int,
    score_b       int,
    games_a_after int,
    games_b_after int,
    p_win_after   numeric(6,4),
    logged_at     timestamptz DEFAULT now(),
    PRIMARY KEY (unit_key, game_number)
);


-- ── Monte-Carlo bracket forecasts ───────────────────────────────────────────
-- p_medal is reach['SF']: the Asian Games awards two bronzes and plays no
-- third-place match, so reaching the semi-final IS the medal.

CREATE TABLE IF NOT EXISTS public.ag2026_forecasts (
    event_key      text NOT NULL,
    qkey           text NOT NULL,              -- ittf id, or ids joined for a pair
    discipline     text,
    label          text,                       -- display name
    org            text,
    seed           int DEFAULT 0,
    ittf_id        int,
    is_rated       boolean DEFAULT true,       -- false = fell back to Elo 1450
    p_title        numeric(8,6),
    p_medal        numeric(8,6),
    reach          jsonb,
    runs           int,
    is_provisional boolean DEFAULT true,
    last_updated   timestamptz DEFAULT now(),
    PRIMARY KEY (event_key, qkey)
);
CREATE INDEX IF NOT EXISTS idx_ag_fc ON public.ag2026_forecasts (event_key, p_title DESC);


-- ── Raw payload capture ─────────────────────────────────────────────────────
-- So that a wrong answer on 23 Sep can be compared against a known-good capture
-- instead of re-fetched from a feed that has since moved on.

CREATE TABLE IF NOT EXISTS public.ag2026_raw (
    id           bigserial PRIMARY KEY,
    endpoint     text NOT NULL,
    unit_key     text,
    note         text,
    http_status  int,
    cache_hdr    text,
    age_s        int,
    body         jsonb,
    fetched_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ag_raw ON public.ag2026_raw (endpoint, fetched_at DESC);


-- ── Security posture ────────────────────────────────────────────────────────
-- Migration 027 walks the catalogue, but migrations run once: it cannot reach
-- tables created after it. Apply the same rule here explicitly.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ag2026_athletes','ag2026_units','ag2026_live_state',
                           'ag2026_game_log','ag2026_forecasts','ag2026_raw']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS approved_read ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY approved_read ON public.%I FOR SELECT USING ((SELECT public.is_approved()))', t);
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;
