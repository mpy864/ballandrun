"""
singles_doubles_correlation.py

Studies how the correlation between a player's Singles Ranking and their
best Doubles Ranking changes WEEK OVER WEEK across ranking history.
Not a single snapshot correlation — the deliverable is the trend of
Pearson r / Spearman rho over time.

Doubles ranking caveat: rankings_doubles_teams stores one row per ranked
PAIR per week; a player can appear in many pair-rows the same week (one
per partner). This script collapses each player-week to their best
(min) current_rank across all pairs containing them (optionally filtered
by --doubles-category), which is the only well-defined single "doubles
rank" for that player that week.

Usage:
  export SUPABASE_URL=... SUPABASE_SERVICE_KEY=...
  python scripts/singles_doubles_correlation.py
  python scripts/singles_doubles_correlation.py --gender M --max-rank 300
"""

import os
import sys
import argparse
from collections import defaultdict

import numpy as np
import pandas as pd
from scipy.stats import pearsonr, spearmanr, linregress
import altair as alt
from supabase import create_client, Client

PAGE_SIZE = 5000


# ── Fetch ──────────────────────────────────────────────────────────────


def fetch_singles(supabase: Client, from_year: int | None) -> pd.DataFrame:
    """Paginate rankings_singles_normalized: player_id, rank, gender,
    ranking_year, ranking_week, ranking_date. Ordered by
    (ranking_year, ranking_week, player_id) for stable .range() pagination."""
    rows, page = [], 0
    while True:
        q = (
            supabase.table("rankings_singles_normalized")
            .select("player_id,rank,gender,ranking_year,ranking_week,ranking_date")
            .order("ranking_year")
            .order("ranking_week")
            .order("player_id")
        )
        if from_year:
            q = q.gte("ranking_year", from_year)
        resp = q.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1).execute()
        batch = resp.data or []
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        page += 1
    return pd.DataFrame(rows)


def fetch_doubles(
    supabase: Client, from_year: int | None, categories: list[str] | None
) -> pd.DataFrame:
    """Paginate rankings_doubles_teams: pair_id, p1_ittf_id, p2_ittf_id,
    category, current_rank, ranking_year, ranking_week. Ordered by `id`
    (real integer identity PK) for stable pagination."""
    rows, page = [], 0
    while True:
        q = (
            supabase.table("rankings_doubles_teams")
            .select(
                "id,pair_id,p1_ittf_id,p2_ittf_id,category,current_rank,"
                "ranking_year,ranking_week"
            )
            .order("id")
        )
        if from_year:
            q = q.gte("ranking_year", from_year)
        if categories:
            q = q.in_("category", categories)
        resp = q.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1).execute()
        batch = resp.data or []
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        page += 1
    return pd.DataFrame(rows)


# ── Reshape ────────────────────────────────────────────────────────────


def best_doubles_rank_by_player_week(doubles_df: pd.DataFrame) -> pd.DataFrame:
    """Unpivot pair rows into one row per (player, year, week, current_rank)
    for both p1 and p2, drop nulls, then take min(current_rank) per
    (player_id, ranking_year, ranking_week). This is the 'best pairing'
    collapse justified by the 1-to-17-pairs-per-player-week finding."""
    if len(doubles_df) == 0:
        return pd.DataFrame(
            columns=["player_id", "ranking_year", "ranking_week", "doubles_rank"]
        )

    p1 = doubles_df.rename(columns={"p1_ittf_id": "player_id"})[
        ["player_id", "ranking_year", "ranking_week", "current_rank"]
    ]
    p2 = doubles_df.rename(columns={"p2_ittf_id": "player_id"})[
        ["player_id", "ranking_year", "ranking_week", "current_rank"]
    ]
    long = pd.concat([p1, p2], ignore_index=True).dropna(
        subset=["player_id", "current_rank"]
    )
    if len(long) == 0:
        return pd.DataFrame(
            columns=["player_id", "ranking_year", "ranking_week", "doubles_rank"]
        )

    long["player_id"] = long["player_id"].astype(int)
    return (
        long.groupby(["player_id", "ranking_year", "ranking_week"])["current_rank"]
        .min()
        .reset_index()
        .rename(columns={"current_rank": "doubles_rank"})
    )


def build_week_pairs(
    singles_df: pd.DataFrame,
    doubles_best_df: pd.DataFrame,
    gender: str | None,
) -> pd.DataFrame:
    """Inner-join singles rank onto doubles-best rank per (player, year, week).
    gender filter applied here (from singles_df.gender — the PLAYER's own
    gender — never from the doubles table's category-derived gender)."""
    s = singles_df.rename(columns={"rank": "singles_rank"})
    if gender:
        s = s[s["gender"] == gender]
    if len(s) == 0 or len(doubles_best_df) == 0:
        return pd.DataFrame()

    merged = s.merge(
        doubles_best_df, on=["player_id", "ranking_year", "ranking_week"]
    )
    if len(merged) == 0:
        return pd.DataFrame()

    week_date = (
        s.groupby(["ranking_year", "ranking_week"])["ranking_date"]
        .min()
        .reset_index()
        .rename(columns={"ranking_date": "week_start_date"})
    )
    return merged.merge(week_date, on=["ranking_year", "ranking_week"])


# ── Weekly correlation ───────────────────────────────────────────────


def compute_weekly_correlations(
    pairs_df: pd.DataFrame, min_players: int, max_rank: int | None
) -> pd.DataFrame:
    """Group by week, compute Pearson/Spearman where n >= min_players.
    Optionally filter singles_rank <= max_rank before computing."""
    df = pairs_df.copy()
    if max_rank:
        df = df[df["singles_rank"] <= max_rank]

    out = []
    for (yr, wk), g in df.groupby(["ranking_year", "ranking_week"]):
        n = len(g)
        if n < min_players:
            continue
        pr, pp = pearsonr(g["singles_rank"], g["doubles_rank"])
        sr, sp = spearmanr(g["singles_rank"], g["doubles_rank"])
        out.append(
            {
                "ranking_year": yr,
                "ranking_week": wk,
                "week_start_date": g["week_start_date"].iloc[0],
                "n_players": n,
                "pearson_r": pr,
                "pearson_p": pp,
                "spearman_r": sr,
                "spearman_p": sp,
            }
        )
    return (
        pd.DataFrame(out).sort_values(["ranking_year", "ranking_week"]).reset_index(drop=True)
    )


# ── Trend-of-trend + summary ────────────────────────────────────────


def summarize_trend(weekly: pd.DataFrame) -> dict:
    """linregress(week_index, spearman_r) — is the correlation itself
    strengthening/weakening over the study window? Reports slope, p, r^2."""
    if len(weekly) < 2:
        return {
            "n_weeks": len(weekly),
            "slope_per_week": None,
            "trend_p": None,
            "trend_r2": None,
            "first": weekly.iloc[0].to_dict() if len(weekly) > 0 else None,
            "last": weekly.iloc[-1].to_dict() if len(weekly) > 0 else None,
            "min_row": None,
            "max_row": None,
        }

    x = np.arange(len(weekly))
    slope, intercept, r, p, se = linregress(x, weekly["spearman_r"])
    return {
        "n_weeks": len(weekly),
        "slope_per_week": slope,
        "trend_p": p,
        "trend_r2": r**2,
        "first": weekly.iloc[0].to_dict(),
        "last": weekly.iloc[-1].to_dict(),
        "min_row": weekly.loc[weekly["spearman_r"].idxmin()].to_dict(),
        "max_row": weekly.loc[weekly["spearman_r"].idxmax()].to_dict(),
    }


def pooled_correlation(
    pairs_df: pd.DataFrame, max_rank: int | None
) -> tuple[float, float, float, float]:
    """Overall correlation pooling every (player, week) pair across all history
    — the single-snapshot-equivalent baseline the trend deviates from."""
    df = pairs_df if not max_rank else pairs_df[pairs_df["singles_rank"] <= max_rank]
    if len(df) < 3:
        return None, None, None, None
    pr, pp = pearsonr(df["singles_rank"], df["doubles_rank"])
    sr, sp = spearmanr(df["singles_rank"], df["doubles_rank"])
    return pr, pp, sr, sp


# ── Output ───────────────────────────────────────────────────────────


def save_outputs(weekly: pd.DataFrame, output_dir: str, gender_label: str):
    """Save CSV and altair chart."""
    os.makedirs(output_dir, exist_ok=True)
    csv_path = os.path.join(
        output_dir, f"singles_doubles_correlation_{gender_label}.csv"
    )
    weekly.to_csv(csv_path, index=False)

    base = alt.Chart(weekly).encode(
        x=alt.X("week_start_date:T", title="Ranking week")
    )
    line = base.mark_line(color="#4C78A8").encode(
        y=alt.Y(
            "spearman_r:Q",
            title="Spearman ρ (singles rank vs. doubles rank)",
        ),
        tooltip=[
            "week_start_date:T",
            "spearman_r:Q",
            "pearson_r:Q",
            "n_players:Q",
        ],
    )
    points = base.mark_circle().encode(
        y="spearman_r:Q",
        size=alt.Size("n_players:Q", title="players/week"),
        tooltip=["week_start_date:T", "spearman_r:Q", "n_players:Q"],
    )
    chart = (line + points).properties(
        width=900,
        height=400,
        title="Singles↔Doubles Ranking Correlation — trend over time",
    )
    html_path = os.path.join(
        output_dir, f"singles_doubles_correlation_{gender_label}.html"
    )
    chart.save(html_path)
    return csv_path, html_path


# ── Main ─────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="Analyze correlation between Singles and Doubles rankings over time."
    )
    parser.add_argument(
        "--gender",
        choices=["M", "W"],
        default=None,
        help="Filter by player gender (M or W); default: combined",
    )
    parser.add_argument(
        "--doubles-category",
        default="ALL",
        choices=["ALL", "MD_WD", "MD", "WD", "XD"],
        help="Which doubles categories to include (default: ALL)",
    )
    parser.add_argument(
        "--from-year",
        type=int,
        default=None,
        help="Only include rankings from this year onward (default: all)",
    )
    parser.add_argument(
        "--min-players",
        type=int,
        default=15,
        help="Minimum sample size (players) per week to compute correlation (default: 15)",
    )
    parser.add_argument(
        "--max-rank",
        type=int,
        default=None,
        help="Cap singles rank to exclude long-tail noise (suggest 300 for "
        "competitively meaningful sample; default: None)",
    )
    parser.add_argument(
        "--output-dir",
        default="analysis_output",
        help="Directory to save CSV and HTML outputs (default: analysis_output)",
    )
    args = parser.parse_args()

    cat_map = {
        "ALL": None,
        "MD_WD": ["MD", "WD"],
        "MD": ["MD"],
        "WD": ["WD"],
        "XD": ["XD"],
    }
    categories = cat_map[args.doubles_category]

    supabase = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"]
    )

    print("[1/5] Fetching singles rankings...")
    singles_df = fetch_singles(supabase, args.from_year)
    print(f"  -> {len(singles_df)} rows")

    print("[2/5] Fetching doubles pair rankings...")
    doubles_df = fetch_doubles(supabase, args.from_year, categories)
    print(f"  -> {len(doubles_df)} pair-rows")

    print("[3/5] Collapsing to best doubles rank per player-week...")
    doubles_best = best_doubles_rank_by_player_week(doubles_df)
    pairs_df = build_week_pairs(singles_df, doubles_best, args.gender)
    print(f"  -> {len(pairs_df)} player-week pairs with both ranks")

    if len(pairs_df) == 0:
        print("ERROR: No paired data after filtering. Aborting.")
        sys.exit(1)

    print("[4/5] Computing weekly Pearson/Spearman correlations...")
    weekly = compute_weekly_correlations(pairs_df, args.min_players, args.max_rank)
    print(f"  -> {len(weekly)} weeks with n >= {args.min_players}")

    if len(weekly) == 0:
        print("ERROR: No weeks met the minimum sample size threshold. Aborting.")
        sys.exit(1)

    print("[5/5] Saving CSV + chart, printing summary...")
    gender_label = args.gender or "ALL"
    csv_path, html_path = save_outputs(weekly, args.output_dir, gender_label)

    pr, pp, sr, sp = pooled_correlation(pairs_df, args.max_rank)

    if pr is not None:
        print(
            f"\nPooled (all history): Pearson r={pr:.3f} (p={pp:.2g}), "
            f"Spearman rho={sr:.3f} (p={sp:.2g}), n={len(pairs_df)}"
        )
    else:
        print(f"\nPooled (all history): insufficient data for correlation")

    trend = summarize_trend(weekly)

    if trend["slope_per_week"] is not None:
        print(
            f"Trend of Spearman rho over {trend['n_weeks']} weeks: "
            f"slope={trend['slope_per_week']:+.5f}/week (p={trend['trend_p']:.2g}, "
            f"R^2={trend['trend_r2']:.3f})"
        )
        print(
            f"First week rho={trend['first']['spearman_r']:.3f}  "
            f"Last week rho={trend['last']['spearman_r']:.3f}"
        )
        print(
            f"Weakest week: {trend['min_row']['week_start_date']} "
            f"rho={trend['min_row']['spearman_r']:.3f}"
        )
        print(
            f"Strongest week: {trend['max_row']['week_start_date']} "
            f"rho={trend['max_row']['spearman_r']:.3f}"
        )
    else:
        print(f"Trend analysis: insufficient weeks for slope calculation")

    print(f"\nSaved: {csv_path}")
    print(f"Saved: {html_path}")


if __name__ == "__main__":
    main()
