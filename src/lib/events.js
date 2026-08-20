import { supabase } from './supabase.js'
import { ROSTER } from './topsRoster.js'
import { disciplineOrder } from './matchFormat.js'

// Which events had a TOPS athlete in them. "10 Indians went" reads differently when
// three of them are on the programme, so the table marks those rows.
export async function loadTopsEventIds(sportKey = 'tt') {
  const ids = [...new Set((ROSTER[sportKey] || [])
    .flatMap(e => (e.players || []).map(p => p.id))
    .filter(Boolean))]
  if (!ids.length) return new Set()

  const { data, error } = await supabase
    .from('india_player_matches').select('event_id').in('player_id', ids)
  if (error) { console.error('tops event ids failed', error); return new Set() }
  return new Set((data || []).map(r => r.event_id))
}

// Difficulty is shown as its three ranks — best in draw, top quarter, median — and
// nothing else. An Elite/Hard/Medium/Open label used to sit on top of them, but
// it was a judgement layered over figures that already say the same thing, and it
// could not survive the caveat underneath: a senior median is a WORLD rank while a
// junior median is a position within an age band, so one word cannot mean the same
// thing in both rows.

// ─── Event list ───────────────────────────────────────────────────────────────

// One row per tournament, newest first. Junior/senior is decided by where the
// majority of India's matches were played — an event is not tagged either way in the
// source, and the two are separate competitions that should never be pooled.
export async function loadEventList({ year = null } = {}) {
  let q = supabase
    .from('india_event_report')
    .select('event_id, event_name, first_date, last_date, matches, wins, losses, athletes,' +
            ' junior_matches, contingent_points, field_players, field_countries,' +
            ' field_best_rank, field_p25_rank, field_median_rank, rank_coverage_pct,' +
            ' upsets_given, upsets_taken')
    .order('last_date', { ascending: false })
    .limit(400)

  if (year) q = q.gte('last_date', `${year}-01-01`).lte('last_date', `${year}-12-31`)

  const { data, error } = await q
  if (error) { console.error('event list failed', error); return [] }

  return (data || []).map(e => ({
    ...e,
    isJunior: e.matches > 0 && e.junior_matches > e.matches / 2,
    winPct: e.matches ? Math.round((e.wins / e.matches) * 100) : null,
  }))
}

export async function loadEventYears() {
  const { data } = await supabase
    .from('india_event_report').select('last_date')
    .order('last_date', { ascending: false }).limit(400)
  const years = [...new Set((data || []).map(r => String(r.last_date).slice(0, 4)))]
  return years.filter(Boolean)
}

// ─── One event, everything ────────────────────────────────────────────────────

// Deliberately ONE query. Every section of the expanded report — deepest runs, per
// player rounds, upsets, the match list — is a different arrangement of the same rows,
// so fetching once and grouping in memory beats four round trips.
const DETAIL_LIMIT = 4000

export async function loadEventDetail(eventId) {
  const { data, error } = await supabase
    .from('india_player_matches')
    .select('match_id, player_name, player_id, player_rank, discipline, kind, round,' +
            ' round_depth, opp_name, opp_country, opp_rank, opp_is_indian, score,' +
            ' game_scores, won, upset_given, upset_taken')
    .eq('event_id', eventId)
    .limit(DETAIL_LIMIT)

  if (error) { console.error('event detail failed', error); return null }
  // round_depth is a Postgres numeric, and PostgREST sends numerics as STRINGS to keep
  // their precision — "10", "9", "1.03000000000000000000". Left as strings, `>` compares
  // them character by character, so "10" > "9" is false and every finalist was recorded
  // as having gone out in the semifinal. Coerce once, here, rather than at each use.
  const rows = (data || []).map(r => ({ ...r, round_depth: Number(r.round_depth) }))

  // The largest event on record returns 969 rows, so the limit has ample headroom —
  // but a truncated fetch would quietly drop matches and understate every round and
  // record below, which is precisely the kind of silent wrongness this page exists to
  // avoid. Say so instead.
  if (rows.length >= DETAIL_LIMIT) {
    console.error(`event ${eventId}: hit the ${DETAIL_LIMIT}-row limit — results below are incomplete`)
  }
  if (!rows.length) return { runs: [], players: [], upsetsGiven: [], upsetsTaken: [], groups: [], scale: [] }

  // ── how far each competitor went ──
  // Entry as well as exit: doubles draws often start at the Round of 32 while singles
  // start in qualifying, so where a competitor JOINED is half the story. A doubles
  // "Quarterfinal" can be one win; a singles "Round of 32" can be four.
  const byEntrant = new Map()
  for (const r of rows) {
    const key = `${r.player_name}||${r.discipline}`
    let e = byEntrant.get(key)
    if (!e) {
      e = { name: r.player_name, playerId: r.player_id, discipline: r.discipline,
            kind: r.kind, rank: r.player_rank,
            depth: -Infinity, round: null, fromDepth: Infinity, fromRound: null,
            w: 0, l: 0, exitUpset: false }
      byEntrant.set(key, e)
    }
    if (r.won) e.w++; else e.l++
    if (r.player_rank != null && (e.rank == null || r.player_rank < e.rank)) e.rank = r.player_rank
    if (r.round_depth > e.depth) {
      e.depth = r.round_depth; e.round = r.round
      // Whether the run ENDED in an upset — lost to someone ranked below them.
      e.exitUpset = !r.won && r.upset_taken
    }
    if (r.round_depth < e.fromDepth) { e.fromDepth = r.round_depth; e.fromRound = r.round }
  }
  // Event first, then rank inside it. Sorting purely by depth mixed the five events
  // together, so a Men's Doubles quarterfinal sat above a Women's Singles Round of 32
  // that took twice as many wins — two different draws being read as one ladder.
  // Grouped by event, every line in a block shares a draw and is comparable.
  // Unranked entrants sink within their block: no rank is not rank zero.
  const players = [...byEntrant.values()].sort((a, b) =>
    disciplineOrder(a.discipline) - disciplineOrder(b.discipline) ||
    String(a.discipline).localeCompare(String(b.discipline)) ||
    (a.rank == null) - (b.rank == null) ||
    (a.rank ?? 0) - (b.rank ?? 0) ||
    b.depth - a.depth ||
    String(a.name).localeCompare(String(b.name)))

  // The rounds this event actually had, in draw order. Built from the data rather than
  // a fixed list so a Feeder with no Round of 128 shows no empty column for it.
  const scale = [...new Map(rows.map(r => [r.round, r.round_depth])).entries()]
    .map(([round, depth]) => ({ round, depth }))
    .sort((a, b) => a.depth - b.depth)

  // Headline runs: everyone who reached the deepest round of the whole event, plus
  // anyone who reached a semifinal or better even if someone else went further.
  // SEMI_DEPTH matches india_player_matches.round_depth, where Semifinal is 9.
  // `players` is no longer in depth order, so take the maximum rather than the head of
  // the list, and keep this section deepest-first — it is the one place that IS a ladder.
  const SEMI_DEPTH = 9
  const top = players.reduce((m, p) => Math.max(m, p.depth), -1)
  const runs = players.filter(p => p.depth === top || p.depth >= SEMI_DEPTH)
    .sort((a, b) => b.depth - a.depth ||
                    disciplineOrder(a.discipline) - disciplineOrder(b.discipline))

  // ── upsets ──
  const upsetsGiven = rows.filter(r => r.upset_given)
    .sort((a, b) => (a.opp_rank - a.player_rank < b.opp_rank - b.player_rank ? 1 : -1))
  const upsetsTaken = rows.filter(r => r.upset_taken)
    .sort((a, b) => (a.player_rank - a.opp_rank < b.player_rank - b.opp_rank ? 1 : -1))

  // ── every match, discipline then round, deepest round first ──
  const gmap = new Map()
  for (const r of rows) {
    // An all-Indian tie appears twice here, once per player. Show it once in the
    // match list — the mirror row is what makes the OTHER player's record right, not
    // a second match.
    if (r.opp_is_indian && !gmap.has(`seen:${r.match_id}`)) gmap.set(`seen:${r.match_id}`, true)
    else if (r.opp_is_indian) continue

    const d = r.discipline || 'Other'
    if (!gmap.has(d)) gmap.set(d, new Map())
    const rounds = gmap.get(d)
    if (!rounds.has(r.round)) rounds.set(r.round, { round: r.round, depth: r.round_depth, matches: [] })
    rounds.get(r.round).matches.push(r)
  }
  const groups = [...gmap.entries()]
    .filter(([k]) => !String(k).startsWith('seen:'))
    .map(([discipline, rounds]) => ({
      discipline,
      rounds: [...rounds.values()].sort((a, b) => b.depth - a.depth),
      played: [...rounds.values()].reduce((n, r) => n + r.matches.length, 0),
    }))
    .sort((a, b) => b.played - a.played)

  return { runs, players, upsetsGiven, upsetsTaken, groups, scale }
}

// ─── Sorting the table ────────────────────────────────────────────────────────

// Two tournaments are compared by sorting the column that matters, rather than by a
// separate side-by-side screen: sorting on points, difficulty or win rate answers the
// question in one click and keeps every other event on screen as context.
export const SORTS = {
  date:      { label: 'Dates',    get: e => e.last_date,          dir: 'desc', numeric: false },
  name:      { label: 'Tournament', get: e => e.event_name,       dir: 'asc',  numeric: false },
  athletes:  { label: 'Indians',  get: e => e.athletes,           dir: 'desc' },
  record:    { label: 'Win %',    get: e => e.winPct,             dir: 'desc' },
  points:    { label: 'Points',   get: e => e.contingent_points,  dir: 'desc' },
  // Lower median rank = stronger field, so "hardest first" ascends.
  field:     { label: 'Difficulty', get: e => e.field_median_rank, dir: 'asc' },
  countries: { label: 'Countries', get: e => e.field_countries,   dir: 'desc' },
  upsets:    { label: 'Upsets',   get: e => e.upsets_given,       dir: 'desc' },
}

// Newest first — what the table shows before anyone touches a column header, and what
// the reset returns to.
export const DEFAULT_SORT = { key: 'date', dir: 'desc' }

export function sortEvents(events, key, dir) {
  const s = SORTS[key] || SORTS.date
  const mult = dir === 'asc' ? 1 : -1
  return [...events].sort((a, b) => {
    const x = s.get(a), y = s.get(b)
    // Missing values always sink, whichever way the column is sorted — an event with
    // no points recorded is not "the best" just because the sort flipped.
    if (x == null && y == null) return 0
    if (x == null) return 1
    if (y == null) return -1
    if (s.numeric === false) return String(x).localeCompare(String(y)) * mult
    return (Number(x) - Number(y)) * mult
  })
}
