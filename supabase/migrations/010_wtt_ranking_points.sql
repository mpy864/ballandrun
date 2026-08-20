-- 010_wtt_ranking_points.sql — applied 2026-08-20
--
-- Ranking points earned per player, per event, from WTT's GetRankingPointsBreakdown.
--
-- This closes the one requirement that could not be met from existing data:
-- rankings_*.points are rolling totals, and a week-over-week delta mixes points gained
-- with points expiring out of WTT's rolling window. The breakdown endpoint gives the
-- per-event figure directly.
--
-- result_position is WTT's own record of how far a competitor went (W, F, SF, QF, R16,
-- R32, R64, GL, QR1...) — a more authoritative source for "round reached" than
-- inferring it from match rows.
--
-- Team events express position as a share, e.g. 'W-48%', 'F-47%': the team result plus
-- that player's contribution. base_position keeps the leading token for grouping while
-- result_position preserves the original.
--
-- Rows are NOT pruned when WTT stops returning them. Unlike entries — a live list where
-- a withdrawal means someone is no longer going — points earned is a historical fact.
-- Winning Montpellier 2025 for 1000 points stays true after that result rolls out of
-- the current ranking window.
--
-- Loaded by scripts/fetch_ranking_points.py, which runs in daily_sync and reports to
-- feed_health as 'wtt-ranking-points'. First load: 41,122 rows across 10 categories
-- (SEN and YOU x MS/WS/MD/WD/XD).

create table if not exists public.wtt_ranking_points (
    competitor_id     integer     not null,
    event_id          integer     not null,
    ranking_category  text        not null,          -- MS / WS / MD / WD / XD
    age_category      text        not null,          -- SEN / U21 / U11..U19
    category_code     text,                          -- SEN / YOU
    event_name        text,
    result_position   text,                          -- 'W', 'SF', 'R16', 'W-48%'
    base_position     text,                          -- 'W', 'SF', 'R16'
    ranking_points    integer,
    ranking_year      integer,
    ranking_month     integer,
    ranking_week      integer,
    last_updated      timestamptz not null default now(),
    primary key (competitor_id, event_id, ranking_category, age_category)
);

create index if not exists wtt_ranking_points_event
  on public.wtt_ranking_points (event_id);
create index if not exists wtt_ranking_points_competitor
  on public.wtt_ranking_points (competitor_id);

grant select on public.wtt_ranking_points to anon, authenticated;
