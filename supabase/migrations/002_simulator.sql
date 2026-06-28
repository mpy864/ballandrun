-- ============================================================
-- WTT Event Simulator schema  (M1 data layer)
-- Entries, draw (bracket) matches, and per-player forecasts.
-- Additive: does not touch existing tables.
-- ============================================================

-- Entry list per sub-event ----------------------------------------------------
CREATE TABLE IF NOT EXISTS wtt_entries (
    event_id      int      NOT NULL,
    sub_event     text     NOT NULL,
    discipline    text     NOT NULL,          -- singles | doubles | mixed | team
    player_id     int      NOT NULL,          -- ITTF id (< 1,000,000)
    player_name   text,
    org           text,
    seed          int      DEFAULT 0,
    is_qualifier  boolean  DEFAULT false,
    last_updated  timestamptz DEFAULT now(),
    PRIMARY KEY (event_id, sub_event, player_id)
);

-- Bracket matches (a draw = matches without scores) ---------------------------
CREATE TABLE IF NOT EXISTS wtt_draw_matches (
    match_id      text     PRIMARY KEY,        -- event_id + sub + round + position
    event_id      int      NOT NULL,
    sub_event     text     NOT NULL,
    discipline    text     NOT NULL,
    round         text     NOT NULL,           -- R64, R32, ... F
    position      int,
    comp1_key     text,                        -- player id(s) joined, or 'Q' placeholder
    comp2_key     text,
    comp1_label   text,
    comp2_label   text,
    winner_key    text,
    best_of       int,
    last_updated  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wtt_draw_event ON wtt_draw_matches (event_id, sub_event);

-- Forecast: per-competitor probabilities -------------------------------------
CREATE TABLE IF NOT EXISTS wtt_forecasts (
    event_id      int      NOT NULL,
    sub_event     text     NOT NULL,
    discipline    text     NOT NULL,
    tier          text,
    qkey          text     NOT NULL,           -- stable competitor key (ids joined)
    label         text,                        -- display name(s)
    seed          int      DEFAULT 0,
    p_title       numeric  NOT NULL,
    reach         jsonb    NOT NULL,           -- {"R32":0.9,"R16":0.8,...,"F":0.5}
    runs          int,
    is_provisional boolean DEFAULT true,       -- true until draw is locked / event done
    generated_at  timestamptz DEFAULT now(),
    PRIMARY KEY (event_id, sub_event, qkey)
);
CREATE INDEX IF NOT EXISTS idx_wtt_forecasts_event ON wtt_forecasts (event_id, sub_event, p_title DESC);
