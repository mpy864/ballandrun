"""Excel-ready archive of the database, for readers who use Excel only.

Writes two folders:
  out/TT_Data/       Table Tennis (raw data, Analysis/, India/)
  out/Tennis_Data/   Tennis      (raw data, Analysis/, India/)

Every file is a plain CSV (UTF-8 with BOM, so names show correctly in Excel),
with player and event names already filled in, readable column headers, and
no file over 1,000,000 rows (Excel's limit is 1,048,576). Each folder gets a
00_READ_ME.xlsx listing every file, what it holds and its columns.

Needs SUPABASE_DB_URL (Postgres connection string, session pooler).
Usage: python scripts/export_excel_archive.py [--out out] [--only-sql]
"""
import argparse
import csv
import io
import os
import sys

MAX_ROWS = 1_000_000
BOM = "﻿".encode("utf-8")

# ---------------------------------------------------------------- TT queries
TT_SINGLES = """
select m.event_date "Date", e.event_name "Event", m.event_category "Category",
       m.age_group "Age Group", m.round_phase "Round",
       p1.player_name "Player 1", p1.country_code "Player 1 Country",
       p2.player_name "Player 2", p2.country_code "Player 2 Country",
       case m.result when 'W' then p1.player_name when 'L' then p2.player_name end "Winner",
       m.match_score "Score (Player 1 - Player 2)", m.game_scores "Game Scores",
       m.comp1_id "Player 1 ITTF ID", m.comp2_id "Player 2 ITTF ID",
       m.event_id "Event ID", m.match_id "Match ID"
  from wtt_matches_singles m
  left join wtt_events e on e.event_id = m.event_id
  left join wtt_players p1 on p1.ittf_id = m.comp1_id
  left join wtt_players p2 on p2.ittf_id = m.comp2_id
 {where}
 order by m.event_date, e.event_name, m.match_id"""

TT_DOUBLES = """
select m.event_date "Date", e.event_name "Event", m.event_category "Category",
       m.age_group "Age Group", m.round_phase "Round",
       concat_ws(' / ', a1.player_name, a2.player_name) "Pair 1",
       concat_ws(' / ', a1.country_code, a2.country_code) "Pair 1 Countries",
       concat_ws(' / ', b1.player_name, b2.player_name) "Pair 2",
       concat_ws(' / ', b1.country_code, b2.country_code) "Pair 2 Countries",
       case m.result when 'W' then concat_ws(' / ', a1.player_name, a2.player_name)
                     when 'L' then concat_ws(' / ', b1.player_name, b2.player_name) end "Winner",
       m.match_score "Score (Pair 1 - Pair 2)", m.game_scores "Game Scores",
       m.event_id "Event ID", m.match_id "Match ID"
  from wtt_matches_doubles m
  left join wtt_events e on e.event_id = m.event_id
  left join wtt_players a1 on a1.ittf_id = m.comp1_p1_id
  left join wtt_players a2 on a2.ittf_id = m.comp1_p2_id
  left join wtt_players b1 on b1.ittf_id = m.comp2_p1_id
  left join wtt_players b2 on b2.ittf_id = m.comp2_p2_id
 {where}
 order by m.event_date, e.event_name, m.match_id"""
TT_DOUBLES_INDIA = ("where 'IND' in (a1.country_code, a2.country_code, "
                    "b1.country_code, b2.country_code)")

TT_SENIOR_SINGLES = """
select r.ranking_date "Ranking Date", r.ranking_year "Year", r.ranking_week "Week",
       r.gender "Gender", r.rank "Rank", p.player_name "Player", p.country_code "Country",
       r.points "Points", r.previous_rank "Previous Rank", r.rank_change "Rank Change",
       r.player_id "ITTF ID"
  from rankings_singles_normalized r
  left join wtt_players p on p.ittf_id = r.player_id
 {where}
 order by r.ranking_date, r.gender, r.rank"""

TT_SENIOR_DOUBLES = """
select r.publish_date "Ranking Date", r.ranking_year "Year", r.ranking_week "Week",
       r.category "Category", r.gender "Gender", r.current_rank "Rank",
       concat_ws(' / ', a.player_name, b.player_name) "Pair",
       concat_ws(' / ', a.country_code, b.country_code) "Countries",
       r.points "Points", r.previous_rank "Previous Rank",
       r.p1_ittf_id "Player 1 ITTF ID", r.p2_ittf_id "Player 2 ITTF ID"
  from rankings_doubles_teams r
  left join wtt_players a on a.ittf_id = r.p1_ittf_id
  left join wtt_players b on b.ittf_id = r.p2_ittf_id
 {where}
 order by r.publish_date, r.category, r.current_rank"""

TT_POINTS = """
select rp.ranking_year "Year", rp.ranking_month "Month", rp.ranking_week "Week",
       rp.ranking_category "Category", rp.age_category "Age Category",
       p.player_name "Player", p.country_code "Country",
       rp.event_name "Event", rp.result_position "Result", rp.ranking_points "Points",
       rp.competitor_id "ITTF ID"
  from wtt_ranking_points rp
  left join wtt_players p on p.ittf_id = rp.competitor_id
 {where}
 order by rp.ranking_year, rp.ranking_week, rp.ranking_category, p.player_name"""

TT_YOUTH_SINGLES = """
select publish_date "Ranking Date", ranking_year "Year", ranking_week "Week",
       age_category "Age Category", sub_event "Event", current_rank "Rank",
       age_cat_rank "Rank in Age Category", player_name "Player",
       country_code "Country Code", country_name "Country", points_ytd "Points",
       previous_rank "Previous Rank", rank_diff "Rank Change", ittf_id "ITTF ID"
  from youth_rankings_singles
 {where}
 order by publish_date, sub_event, current_rank"""

TT_YOUTH_DOUBLES = """
select publish_date "Ranking Date", ranking_year "Year", ranking_week "Week",
       age_category "Age Category", sub_event "Event", current_rank "Rank",
       age_cat_rank "Rank in Age Category",
       concat_ws(' / ', player_name1, player_name2) "Pair",
       concat_ws(' / ', country_code1, country_code2) "Countries",
       points "Points", previous_rank "Previous Rank", rank_diff "Rank Change",
       ittf_id1 "Player 1 ITTF ID", ittf_id2 "Player 2 ITTF ID"
  from youth_rankings_doubles
 {where}
 order by publish_date, sub_event, current_rank"""

TT_PLAYERS = """
select ittf_id "ITTF ID", player_name "Player", country_code "Country Code",
       country_name "Country", gender "Gender", dob "Date of Birth",
       handedness "Playing Hand", grip "Grip", blade_type "Blade"
  from wtt_players {where} order by player_name"""

# ------------------------------------------------------------ Tennis queries
TN_MATCHES = """
select m.match_date "Date", m.source "Tour", e.name "Tournament", e.level "Level",
       e.surface "Surface", m.event_year "Year", m.discipline "Discipline",
       m.round "Round",
       w.name "Winner", w.nationality "Winner Country", wp.name "Winner Partner",
       m.winner_rank "Winner Rank",
       l.name "Loser", l.nationality "Loser Country", lp.name "Loser Partner",
       m.loser_rank "Loser Rank", m.score "Score", m.outcome "Outcome",
       m.winner_id "Winner ID", m.loser_id "Loser ID", m.event_id "Event ID"
  from tennis_matches m
  left join tennis_events e on e.source = m.source and e.event_id = m.event_id
                           and e.event_year = m.event_year
  left join tennis_players w  on w.source  = m.source and w.player_id  = m.winner_id
  left join tennis_players wp on wp.source = m.source and wp.player_id = m.winner_partner_id
  left join tennis_players l  on l.source  = m.source and l.player_id  = m.loser_id
  left join tennis_players lp on lp.source = m.source and lp.player_id = m.loser_partner_id
 {where}
 order by m.match_date, e.name, m.round_order"""
TN_MATCHES_INDIA = ("where 'IND' in (w.nationality, wp.nationality, "
                    "l.nationality, lp.nationality)")

TN_ENTRIES = """
select n.source "Tour", n.event_year "Year", e.name "Tournament", e.level "Level",
       n.discipline "Discipline", p.name "Player", p.nationality "Country",
       pp.name "Partner", n.entry_type "Entry Type", n.seed "Seed",
       n.rank_at_entry "Rank at Entry", n.prize_usd "Prize (USD)", n.points "Points",
       n.player_id "Player ID", n.event_id "Event ID"
  from tennis_entries n
  left join tennis_events e on e.source = n.source and e.event_id = n.event_id
                           and e.event_year = n.event_year
  left join tennis_players p  on p.source  = n.source and p.player_id  = n.player_id
  left join tennis_players pp on pp.source = n.source and pp.player_id = n.partner_id
 {where}
 order by n.event_year, e.name, p.name"""

TN_RANKINGS = """
select r.rank_date "Ranking Date", r.source "Tour", p.name "Player",
       p.nationality "Country", r.singles_rank "Singles Rank",
       r.singles_points "Singles Points", r.doubles_rank "Doubles Rank",
       r.doubles_points "Doubles Points", r.combined_rank "Combined Rank",
       r.combined_points "Combined Points", r.player_id "Player ID"
  from tennis_rankings r
  left join tennis_players p on p.source = r.source and p.player_id = r.player_id
 {where}
 order by r.rank_date, r.singles_rank nulls last"""

TN_PLAYERS = """
select source "Tour", player_id "Player ID", name "Player", gender "Gender",
       nationality "Country", date_of_birth "Date of Birth", birth_year "Birth Year",
       birth_city "Birth City", play_hand "Playing Hand", backhand "Backhand",
       height_cm "Height (cm)", coach "Coach", last_seen "Last Seen"
  from tennis_players {where} order by name"""


def F(folder, name, desc, sql, where="", split=None):
    """One output file. split=(table, year_sql, extra_where) splits by year."""
    return dict(folder=folder, name=name, desc=desc, sql=sql, where=where, split=split)


def tt_files():
    I = "India"
    A = "Analysis"
    return [
        F("", "TT_Players", "All TT players: country, date of birth, playing hand, grip, blade.", TT_PLAYERS),
        F("", "TT_Events", "WTT/ITTF event calendar: tier, host country, dates.",
          'select event_id "Event ID", event_name "Event", event_type "Event Type", event_tier "Tier", '
          'country "Host Country", start_date "Start Date", end_date "End Date", year "Year" '
          'from wtt_events {where} order by start_date'),
        F("", "TT_Matches_Singles", "Every international singles match: players, winner, score, game scores.", TT_SINGLES),
        F("", "TT_Matches_Doubles", "Every international doubles match: pairs, winner, score.", TT_DOUBLES),
        F("", "TT_Senior_Rankings_Singles", "ITTF senior singles world rankings, week by week.", TT_SENIOR_SINGLES),
        F("", "TT_Senior_Rankings_Doubles", "ITTF senior doubles world rankings (pairs), week by week.", TT_SENIOR_DOUBLES),
        F("", "TT_Ranking_Points_By_Event", "Ranking points each player earned at each event.", TT_POINTS),
        F("", "TT_Youth_Rankings_Singles", "ITTF youth singles rankings (U11-U19), week by week. One file per year.",
          TT_YOUTH_SINGLES, split=("youth_rankings_singles", "ranking_year", "")),
        F("", "TT_Youth_Rankings_Doubles", "ITTF youth doubles rankings (pairs), week by week.", TT_YOUTH_DOUBLES),
        F("", "TT_Upcoming_Entries", "Players entered in upcoming events, with seeds.",
          'select e.event_name "Event", e.start_date "Start Date", n.sub_event "Event Category", '
          'n.discipline "Discipline", n.player_name "Player", n.org "Country", n.seed "Seed", '
          'n.is_qualifier "Qualifier", p.player_name "Partner", n.player_id "ITTF ID", n.event_id "Event ID" '
          'from wtt_entries n left join wtt_events e on e.event_id = n.event_id '
          'left join wtt_players p on p.ittf_id = n.partner_id {where} order by e.start_date, n.sub_event, n.seed'),
        F("", "TT_Domestic_Matches_TTFI", "Indian domestic (TTFI) matches: tournament, TOPS grade, players, state/unit, score.",
          'select t.season "Season", t.name "Tournament", t.tops_grade "TOPS Grade", d.event_name "Event", '
          'd.round "Round", d.match_datetime "Date/Time", d.player1_name "Player 1", d.player1_affil "Player 1 Unit", '
          'd.player2_name "Player 2", d.player2_affil "Player 2 Unit", d.winner_name "Winner", d.score_raw "Score", '
          'd.p1_sets "Player 1 Games", d.p2_sets "Player 2 Games", array_to_string(d.game_scores, \',\') "Game Scores", '
          'd.player1_id "Player 1 TTFI ID", d.player2_id "Player 2 TTFI ID" '
          'from ttfi_domestic_matches d left join ttfi_tournaments t on t.id = d.tournament_id {where} '
          'order by t.season, t.name, d.event_name, d.id'),
        F("", "TT_Domestic_Tournaments_TTFI", "Indian domestic (TTFI) tournaments with season and TOPS grade.",
          'select season "Season", name "Tournament", tops_grade "TOPS Grade", has_pdf_results "PDF Results", '
          'id "Tournament ID" from ttfi_tournaments {where} order by season, name'),
        F("", "TT_Asian_Games_2026_Athletes", "Asian Games 2026 TT athletes and the events they entered.",
          'select name "Athlete", org "Country", gender "Gender", dob "Date of Birth", ptype "Type", '
          'in_singles "Singles", in_doubles "Doubles", in_team "Team", ittf_id "ITTF ID" '
          'from ag2026_athletes {where} order by org, name'),
        F("", "TT_Asian_Games_2026_Matches", "Asian Games 2026 TT schedule and results, match by match.",
          'select start_at "Start Time", event_desc "Event", phase_desc "Phase", round_label "Round", '
          'discipline "Discipline", gender "Gender", rubber_num "Rubber", home_name "Home", home_org "Home Country", '
          'away_name "Away", away_org "Away Country", home_result "Home Score", away_result "Away Score", '
          'winner_side "Winner Side", res_detail "Game Scores", medal "Medal Match", status "Status", '
          'p_prematch "Pre-match Win Probability (Home)" from ag2026_units {where} order by start_at, unit_key'),
        # ---- Analysis
        F(A, "TT_Player_Benchmarks", "Per-player performance: win rate overall and vs Top 50/100, opponent strength, elite events.",
          'select * from player_benchmark_stats {where} order by gender, current_rank nulls last'),
        F(A, "TT_Elite_Benchmarks", "What elite level looks like: 25th/50th/75th percentile of each metric.",
          'select * from elite_benchmark_profile {where} order by gender, window_months, metric'),
        F(A, "TT_Tournament_Forecasts", "Model forecasts: each player's chance to win the title and reach each round.",
          'select e.event_name "Event", f.sub_event "Event Category", f.discipline "Discipline", f.label "Player/Pair", '
          'f.seed "Seed", f.p_title "Title Probability", f.reach::text "Reach Probability by Round", '
          'f.generated_at "Forecast Time" from wtt_forecasts f left join wtt_events e on e.event_id = f.event_id '
          '{where} order by e.event_name, f.sub_event, f.p_title desc'),
        F(A, "TT_Prediction_vs_Result", "Pre-match prediction vs actual result, match by match (model accuracy check).",
          'select r.completed_at "Completed", e.event_name "Event", r.round_name "Round", r.comp1_name "Player 1", '
          'r.comp2_name "Player 2", r.p_prematch "Pre-match Win Probability (Player 1)", r.games_a "Player 1 Games", '
          'r.games_b "Player 2 Games", r.result "Result", r.correct "Prediction Correct" '
          'from wtt_match_results r left join wtt_events e on e.event_id = r.event_id {where} order by r.completed_at'),
        F(A, "TT_WTTC_Team_Simulations", "World Team Championships: simulated chance of each team finishing at each stage.",
          'select gender "Gender", team "Team", result "Finish", probability "Probability", runs "Simulations", '
          'computed_at "Computed" from wttc_sim_results {where} order by gender, team'),
        F(A, "TT_WTTC_Lineup_Probabilities", "World Team Championships: win probability for each lineup match-up.",
          'select gender "Gender", team_a "Team A", team_b "Team B", lineup_a::text "Lineup A", lineup_b::text "Lineup B", '
          'p_win "Team A Win Probability", computed_at "Computed" from wttc_lineup_results {where} order by gender, team_a'),
        F(A, "TT_TOPS_Grade_Rules", "Rules used to give TTFI tournaments a TOPS grade.",
          'select pattern "Tournament Name Pattern", tops_grade "TOPS Grade" from tops_grade_rules {where} order by tops_grade'),
        # ---- India
        F(I, "India_TT_Players", "Indian TT players.", TT_PLAYERS, "where country_code = 'IND'"),
        F(I, "India_TT_Matches_Singles", "International singles matches with an Indian player.", TT_SINGLES,
          "where 'IND' in (p1.country_code, p2.country_code)"),
        F(I, "India_TT_Matches_Doubles", "International doubles matches with an Indian player.", TT_DOUBLES, TT_DOUBLES_INDIA),
        F(I, "India_TT_Match_Record", "Indian players' matches with opponent rank and upsets (given/taken).",
          'select * from india_match_ranked_m {where} order by event_date, event_name'),
        F(I, "India_TT_Senior_Rankings_Singles", "Indian players in senior singles world rankings.", TT_SENIOR_SINGLES,
          "where p.country_code = 'IND'"),
        F(I, "India_TT_Senior_Rankings_Doubles", "Indian pairs in senior doubles world rankings.", TT_SENIOR_DOUBLES,
          "where 'IND' in (a.country_code, b.country_code)"),
        F(I, "India_TT_Youth_Rankings_Singles", "Indian players in youth singles rankings.", TT_YOUTH_SINGLES,
          "where country_code = 'IND'"),
        F(I, "India_TT_Youth_Rankings_Doubles", "Indian pairs in youth doubles rankings.", TT_YOUTH_DOUBLES,
          "where 'IND' in (country_code1, country_code2)"),
        F(I, "India_TT_Ranking_Points_By_Event", "Ranking points Indian players earned at each event.", TT_POINTS,
          "where p.country_code = 'IND'"),
        F(I, "India_TT_Event_Report", "India's results event by event.",
          'select * from india_event_report_mv {where}'),
        F(I, "India_TT_Tournament_Performance", "India's performance tournament by tournament.",
          'select * from india_tournament_performance_mv {where}'),
        F(I, "India_TT_Leaderboard_Current", "Current leaderboard of Indian players.",
          'select * from mv_leaderboard_india_current {where}'),
        F(I, "India_TT_Player_Form", "Current form of Indian players.",
          'select * from mv_player_form_current {where}'),
        F(I, "India_TT_vs_Top_Opponents", "Indian players' record against top-ranked opponents.",
          'select * from mv_player_vs_top_opponents {where}'),
    ]


def tennis_files():
    I = "India"
    A = "Analysis"
    out = [
        F("", "Tennis_Players", "All tennis players (ATP, WTA, ITF): country, date of birth, hand, height, coach.", TN_PLAYERS),
        F("", "Tennis_Events", "Tennis tournaments: tour, level, surface, city, prize money, draw size.",
          'select source "Tour", event_year "Year", name "Tournament", event_type "Type", level "Level", '
          'surface "Surface", indoor_outdoor "Indoor/Outdoor", city "City", country "Country", '
          'start_date "Start Date", end_date "End Date", total_prize "Total Prize", '
          'sgl_draw_size "Singles Draw", dbl_draw_size "Doubles Draw", event_id "Event ID" '
          'from tennis_events {where} order by start_date'),
    ]
    for tour in ("ATP", "WTA", "ITF"):
        out.append(F("", f"Tennis_Matches_{tour}", f"Every {tour} match: winner, loser, ranks, score.",
                     TN_MATCHES, f"where m.source = '{tour}'"))
    for tour in ("ATP", "WTA", "ITF"):
        out.append(F("", f"Tennis_Entries_{tour}", f"Who entered each {tour} tournament: seed, rank at entry, prize, points.",
                     TN_ENTRIES, f"where n.source = '{tour}'"))
    for tour in ("ATP", "WTA", "ITF"):
        out.append(F("", f"Tennis_Rankings_{tour}", f"{tour} rankings week by week. Split into year ranges.",
                     TN_RANKINGS, f"where r.source = '{tour}'",
                     split=("tennis_rankings", "extract(year from rank_date)::int", f"source = '{tour}'")))
    out += [
        F(A, "Tennis_Best_Rank_By_Age", "Each player's best singles/doubles rank, age, and weeks ranked.",
          'select a.source "Tour", p.name "Player", p.nationality "Country", a.age "Age", '
          'a.best_singles "Best Singles Rank", a.best_doubles "Best Doubles Rank", a.weeks_ranked "Weeks Ranked", '
          'a.first_date "First Ranked", a.last_date "Last Ranked", a.player_id "Player ID" '
          'from player_age_rank a left join tennis_players p on p.source = a.source and p.player_id = a.player_id '
          '{where} order by p.name, a.age'),
        F(I, "India_Tennis_Players", "Indian tennis players.", TN_PLAYERS, "where nationality = 'IND'"),
        F(I, "India_Tennis_Matches", "All matches with an Indian player (ATP, WTA, ITF).", TN_MATCHES, TN_MATCHES_INDIA),
        F(I, "India_Tennis_Entries", "Tournaments Indian players entered.", TN_ENTRIES, "where p.nationality = 'IND'"),
        F(I, "India_Tennis_Rankings", "Indian players' rankings week by week.", TN_RANKINGS, "where p.nationality = 'IND'"),
    ]
    return out


# ------------------------------------------------------------------ helpers
def year_groups(cur, table, year_sql, extra):
    """Group consecutive years so each group stays under MAX_ROWS."""
    w = f"where {extra}" if extra else ""
    cur.execute(f"select {year_sql} y, count(*) from {table} {w} group by 1 order by 1")
    groups, cur_g, n = [], [], 0
    for y, c in cur.fetchall():
        if cur_g and n + c > MAX_ROWS:
            groups.append((cur_g[0], cur_g[-1]))
            cur_g, n = [], 0
        cur_g.append(y)
        n += c
    if cur_g:
        groups.append((cur_g[0], cur_g[-1]))
    return groups


def copy_to_file(cur, sql, path):
    with open(path, "wb") as fh:
        fh.write(BOM)
        cur.copy_expert(f"copy ({sql}) to stdout with csv header", fh)
    rows = 0
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.reader(fh)
        header = next(reader)
        for _ in reader:
            rows += 1
    return rows, header


def guard_split(path, rows):
    """Safety net: split any file still over MAX_ROWS into numbered parts."""
    if rows <= MAX_ROWS:
        return [(path, rows)]
    base = path[:-4]
    out = []
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.reader(fh)
        header = next(reader)
        part, n, w, f = 0, 0, None, None
        for row in reader:
            if w is None or n == MAX_ROWS:
                if f:
                    f.close()
                    out.append((p, n))
                part += 1
                p = f"{base}_part{part}.csv"
                f = open(p, "w", newline="", encoding="utf-8-sig")
                w = csv.writer(f)
                w.writerow(header)
                n = 0
            w.writerow(row)
            n += 1
        if f:
            f.close()
            out.append((p, n))
    os.remove(path)
    return out


def build(cur, root, files):
    index = []  # (folder, file, desc, rows, columns)
    for spec in files:
        folder = os.path.join(root, spec["folder"]) if spec["folder"] else root
        os.makedirs(folder, exist_ok=True)
        where = spec["where"]
        jobs = []
        if spec["split"]:
            table, ysql, extra = spec["split"]
            alias_y = ysql if spec["sql"] is not TN_RANKINGS else ysql.replace("rank_date", "r.rank_date")
            for y1, y2 in year_groups(cur, table, ysql, extra):
                cond = f"{alias_y} between {y1} and {y2}"
                w = f"{where} and {cond}" if where else f"where {cond}"
                label = f"{y1}" if y1 == y2 else f"{y1}-{y2}"
                jobs.append((f"{spec['name']}_{label}", w))
        else:
            jobs.append((spec["name"], where))
        for name, w in jobs:
            sql = spec["sql"].format(where=w)
            path = os.path.join(folder, f"{name}.csv")
            rows, header = copy_to_file(cur, sql, path)
            for p, r in guard_split(path, rows):
                rel = os.path.relpath(p, root)
                index.append((spec["folder"] or "(main)", os.path.basename(p), spec["desc"], r, ", ".join(header)))
                print(f"  {rel:70s} {r:>10,}", flush=True)
    return index


def write_readme(root, title, index):
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill
    wb = Workbook()
    ws = wb.active
    ws.title = "Start Here"
    lines = [
        (title, True),
        ("", False),
        ("How to use", True),
        ("1. Open any .csv file by double-clicking it. It opens in Excel.", False),
        ("2. Use Data > Filter to filter by player, country, date or event.", False),
        ("3. Use Insert > PivotTable for counts, totals and comparisons.", False),
        ("4. Start with the India folder: it has only Indian players and the files are small.", False),
        ("", False),
        ("Folders", True),
        ("(main)   - full raw data for all players worldwide", False),
        ("Analysis - figures computed from the raw data (benchmarks, forecasts, model accuracy)", False),
        ("India    - only Indian players (same columns as the main files)", False),
        ("", False),
        ("Notes", True),
        ("- Large files are split by year so each file opens in Excel (Excel limit: 1,048,576 rows).", False),
        ("- Player and event names are already filled in. IDs are kept in the last columns for matching.", False),
        ("- Country codes are 3-letter codes, e.g. IND = India.", False),
        ("- The 'Files' sheet lists every file, what it holds, number of rows and its columns.", False),
    ]
    for i, (text, bold) in enumerate(lines, 1):
        c = ws.cell(row=i, column=1, value=text)
        c.font = Font(bold=bold, size=14 if i == 1 else 11)
    ws.column_dimensions["A"].width = 110

    fs = wb.create_sheet("Files")
    head = ["Folder", "File", "What it holds", "Rows", "Columns"]
    fs.append(head)
    for c in fs[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1F4E78")
    for row in index:
        fs.append(list(row))
    for col, wdt in zip("ABCDE", (12, 48, 70, 12, 120)):
        fs.column_dimensions[col].width = wdt
    for r in fs.iter_rows(min_row=2):
        r[3].number_format = "#,##0"
        r[2].alignment = Alignment(wrap_text=True, vertical="top")
        r[4].alignment = Alignment(wrap_text=True, vertical="top")
    fs.freeze_panes = "A2"
    fs.auto_filter.ref = fs.dimensions
    wb.save(os.path.join(root, "00_READ_ME.xlsx"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="out")
    ap.add_argument("--only-sql", action="store_true", help="print every query and exit")
    args = ap.parse_args()

    sets = [("TT_Data", "Table Tennis data archive", tt_files()),
            ("Tennis_Data", "Tennis data archive", tennis_files())]

    if args.only_sql:
        for _, _, files in sets:
            for s in files:
                print(s["name"], "::", " ".join(s["sql"].format(where=s["where"]).split()))
        return

    import psycopg2
    conn = psycopg2.connect(os.environ["SUPABASE_DB_URL"])
    conn.set_session(readonly=True)
    cur = conn.cursor()
    cur.execute("set statement_timeout = 0")
    for folder, title, files in sets:
        root = os.path.join(args.out, folder)
        os.makedirs(root, exist_ok=True)
        print(f"\n{folder}", flush=True)
        index = build(cur, root, files)
        write_readme(root, title, index)
        total = sum(r[3] for r in index)
        print(f"{folder}: {len(index)} files, {total:,} rows", flush=True)
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
