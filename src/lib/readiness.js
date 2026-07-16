// ─── Podium-Readiness v2 + achievements ──────────────────────────────────────
// Pure functions, shared by the Squad cards. Fed a normalised match ledger
// (same shape the OKR loaders build) so Squad numbers match the OKR dashboard.
//
// Score (0–100), unified for singles & doubles:
//   Rank 45 · Trajectory 20 · Form 35 (3M win% + top-20 scalp bonus) · staleness penalty.
// Age is NOT scored (shown on card + used by verdict tags only).

import { cleanRound } from './playerMetrics.js'

const DAY = 86400000

const ROUND_DEPTH = {
  'Final': 6, 'Semi-Final': 5, 'Quarter-Final': 4,
  'Round of 16': 3, 'Round of 32': 2, 'Round of 64': 1,
}
const DEPTH_LABEL = { 7: 'Title', 6: 'Final', 5: 'SF', 4: 'QF', 3: 'R16', 2: 'R32', 1: 'R64' }

// ── Score ────────────────────────────────────────────────────────────────────
// opts.base = ln-denominator for the rank curve (500 singles, 300 doubles pairs)
export function computeReadiness({ rank, rank1y, wins3M, played3M, top20Wins12M, base = 500 }) {
  const r = rank && rank < 9999 ? rank : null
  const rankPts = r ? Math.max(0, 45 - 45 * Math.log(r) / Math.log(base)) : 0
  const traj = (rank1y != null && r != null) ? rank1y - r : 0;   // + = improved
  const trajPts = Math.min(20, Math.max(0, 10 + traj * 0.2))

  const stale = played3M === 0
  const winRate3M = played3M > 0 ? wins3M / played3M : 0
  const formBase = stale ? 0 : 25 * winRate3M
  const scalp = Math.min(10, 2.5 * (top20Wins12M || 0))
  const formPts = Math.min(35, formBase + scalp)

  let total = rankPts + trajPts + formPts
  if (stale) total -= 10
  total = Math.max(0, Math.min(100, total))

  return {
    score: Math.round(total),
    rank_pts: +rankPts.toFixed(1),
    traj_pts: +trajPts.toFixed(1),
    form_pts: +formPts.toFixed(1),
    trajectory: traj,
    stale,
    win_rate_3m: +(winRate3M * 100).toFixed(0),
    top20_wins: top20Wins12M || 0,
    played_3m: played3M,
  }
}

// ── Achievements (last 12M): two deepest runs + biggest win ───────────────────
// ledger: [{ tournamentKey, round, result:'W'|'L', rawDate, opponentRank, opponent }]
// eventsMap: { [event_id]: { name, tier } }  (tier = tops_grade, 1 = most prestigious)
export function computeAchievements(ledger, eventsMap = {}) {
  const byEvent = {}
  for (const m of ledger) {
    const round = cleanRound(m.round)
    let depth = ROUND_DEPTH[round] || 0
    if (round === 'Final' && m.result === 'W') depth = 7           // won the final = title
    if (depth === 0) continue
    const key = m.tournamentKey
    const meta = eventsMap[key] || {}
    if (!byEvent[key]) byEvent[key] = { key, depth: 0, date: m.rawDate, name: meta.name, tier: meta.tier }
    const e = byEvent[key]
    if (depth > e.depth) e.depth = depth
    if (m.rawDate > e.date) e.date = m.rawDate
  }

  const events = Object.values(byEvent)
  // Deepest first, then prestige (lower tier number = bigger event), then recency.
  events.sort((a, b) =>
    (b.depth * 10 + (6 - (b.tier ?? 6))) - (a.depth * 10 + (6 - (a.tier ?? 6)))
    || b.date - a.date)
  const runs = events.slice(0, 2).map(e => ({
    label: DEPTH_LABEL[e.depth] || '—',
    event: cleanEventName(e.name) || 'Event',
    year: e.date instanceof Date ? e.date.getFullYear() : null,
  }))

  let bestWin = null
  for (const m of ledger) {
    if (m.result === 'W' && m.opponentRank && m.opponentRank < 999) {
      if (!bestWin || m.opponentRank < bestWin.rank) {
        bestWin = {
          rank: m.opponentRank,
          name: m.opponent,
          event: cleanEventName(eventsMap[m.tournamentKey]?.name) || null,
          year: m.rawDate instanceof Date ? m.rawDate.getFullYear() : null,
        }
      }
    }
  }
  return { runs, bestWin }
}

function cleanEventName(name) {
  if (!name) return null
  return name.replace(/\s+presented\s+by\s+.*/i, '').replace(/\s+20\d\d$/, '').trim()
}

// ── Ledger helpers ────────────────────────────────────────────────────────────
export function cutoffDaysAgo(days) {
  const d = new Date(); d.setTime(d.getTime() - days * DAY); return d
}
