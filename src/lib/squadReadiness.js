// ─── Shared Squad/Home readiness loader ──────────────────────────────────────
// Single source of truth for computing readiness for a roster (TOPS entries).
// Used by SportPage (Squad) and HomePage (leaders) so numbers are identical.
// Presentation-agnostic; reuses the readiness.js formulas + doubles loader.

import { supabase } from './supabase.js'
import { properName } from './matchFormat.js'
import { DISCIPLINES } from './topsRoster.js'
import { computeReadiness, computeAchievements, cutoffDaysAgo } from './readiness.js'
import { loadRosterDoublesLedgers } from './doublesOkr.js'

export function ageFromDob(dob) {
  if (!dob) return null
  const b = new Date(dob), t = new Date()
  let a = t.getFullYear() - b.getFullYear()
  const mo = t.getMonth() - b.getMonth()
  if (mo < 0 || (mo === 0 && t.getDate() < b.getDate())) a--
  return a
}
function avgAge(dobs) {
  const ages = dobs.map(ageFromDob).filter(a => a != null)
  return ages.length ? Math.round(ages.reduce((s, v) => s + v, 0) / ages.length) : null
}
function pickBetterEvent(a, b, today) {
  const af = a.date >= today, bf = b.date >= today
  if (af !== bf) return af ? a : b
  if (af) return a.date <= b.date ? a : b
  return a.date >= b.date ? a : b
}
async function loadEntryRows(ids) {
  const { data } = await supabase.from('wtt_entries')
    .select('player_id, sub_event, discipline, partner_id, seed, is_qualifier, event_id').in('player_id', ids)
  if (!data?.length) return []
  const evIds = [...new Set(data.map(d => d.event_id))]
  const evMap = {}
  // Chunks are independent — one wave, not a queue.
  const evChunks = []
  for (let i = 0; i < evIds.length; i += 400) evChunks.push(evIds.slice(i, i + 400))
  const evResults = await Promise.all(evChunks.map(c =>
    supabase.from('wtt_events').select('event_id, event_name, start_date').in('event_id', c)))
  for (const { data: evs } of evResults) for (const e of evs || []) evMap[e.event_id] = e
  return (data || []).map(d => {
    const ev = evMap[d.event_id]
    if (!ev || !ev.start_date) return null
    return {
      player_id: d.player_id, partner_id: d.partner_id, discipline: d.discipline,
      name: ev.event_name, date: ev.start_date, seed: d.seed, qual: d.is_qualifier, sub: d.sub_event,
    }
  }).filter(Boolean)
}
function bestFrom(rows) {
  const today = new Date().toISOString().slice(0, 10)
  let best = null
  for (const r of rows) best = best ? pickBetterEvent(best, r, today) : r
  if (!best) return null
  return { name: best.name, date: best.date, seed: best.seed, qual: best.qual, provisional: best.date >= today }
}
function nextSingles(rows, pid) {
  return bestFrom(rows.filter(r => Number(r.player_id) === Number(pid) && r.discipline === 'singles'))
}
function nextPair(rows, a, b) {
  return bestFrom(rows.filter(r =>
    Number(r.player_id) === Number(a) && r.discipline === 'doubles' && Number(r.partner_id) === Number(b)))
}

// Stable key for a roster pair entry (sorted player ids).
export function rosterPairKey(players) {
  return (players || []).map(p => p.id).filter(Boolean).sort((a, b) => a - b).join('_')
}

// Indian participation in upcoming events — every Indian athlete, senior and junior,
// not just the scored squad. Reads the india_upcoming_entries view, which aggregates
// in the database; counting distinct players here would mean pulling every Indian
// entry row into the browser on each load.
// The default fetches the whole window, not a screenful. A Senior/Junior filter over a
// truncated list silently lies: with the old limit of 6 there were 18 events in the view,
// and choosing Junior showed whichever juniors happened to fall in the first six by date
// rather than the nine that exist. How many rows to DISPLAY is the panel's decision;
// how many exist is not.
export async function loadIndiaUpcomingEvents(limit = 60) {
  const { data, error } = await supabase
    .from('india_upcoming_entries')
    // country matters as much as the name: half the calendar is named after the host
    // city, so "WTT Contender Panagyurishte" never says Bulgaria anywhere on screen.
    .select('event_id, event_name, country, start_date, days_away, athletes, entries, senior_athletes, junior_athletes')
    .order('start_date', { ascending: true })
    .limit(limit)
  if (error) { console.error('upcoming india entries failed', error); return [] }
  return data || []
}

// Which upcoming events have a squad athlete entered. Used to mark those rows —
// "10 Indians are going" matters differently when 3 of them are yours.
export async function loadSquadEventIds(playerIds) {
  if (!playerIds?.length) return new Set()
  const { data, error } = await supabase
    .from('india_upcoming_entry_athletes')
    .select('event_id, player_id')
    .in('player_id', playerIds)
  if (error) { console.error('squad event ids failed', error); return new Set() }
  return new Set((data || []).map(d => d.event_id))
}

// One event's Indian athletes with the draws they are entered in. Fetched only when
// a row is expanded, so the panel stays cheap for the common case.
export async function loadEventAthletes(eventId, squadIds = []) {
  const { data, error } = await supabase
    .from('india_upcoming_entry_athletes')
    .select('player_id, player_name, sub_event, is_junior')
    .eq('event_id', eventId)
  if (error) { console.error('event athletes failed', error); return [] }

  const squad = new Set(squadIds.map(Number))
  const byPlayer = new Map()
  for (const r of data || []) {
    const k = Number(r.player_id)
    if (!byPlayer.has(k)) {
      byPlayer.set(k, { id: k, name: properName(r.player_name), junior: false, draws: [], squad: squad.has(k) })
    }
    const p = byPlayer.get(k)
    p.junior = p.junior || r.is_junior
    if (r.sub_event && !p.draws.includes(r.sub_event)) p.draws.push(r.sub_event)
  }
  // Squad first, then most draws, then alphabetical.
  return [...byPlayer.values()]
    .map(p => ({ ...p, draws: p.draws.sort() }))
    .sort((a, b) => (b.squad - a.squad) || (b.draws.length - a.draws.length)
                    || a.name.localeCompare(b.name))
}

// India-wide singles rank gainers this week (biggest rank improvements).
export async function loadIndiaMovers(limit = 6) {
  const { data: latest } = await supabase.from('rankings_singles_normalized')
    .select('ranking_date').order('ranking_date', { ascending: false }).limit(1)
  const d = latest?.[0]?.ranking_date
  if (!d) return []
  const { data: inds } = await supabase.from('wtt_players')
    .select('ittf_id, player_name').eq('country_code', 'IND').limit(3000)
  if (!inds?.length) return []
  const nameById = {}, ids = []
  for (const p of inds) { nameById[p.ittf_id] = properName(p.player_name); ids.push(p.ittf_id) }
  // The chunks exist because a URL has a length limit, not because they depend on each
  // other. Awaiting them one at a time paid four round trips of browser latency for
  // work the database finishes in milliseconds.
  const chunks = []
  for (let i = 0; i < ids.length; i += 800) chunks.push(ids.slice(i, i + 800))
  const results = await Promise.all(chunks.map(c =>
    supabase.from('rankings_singles_normalized')
      .select('player_id, rank, rank_change').eq('ranking_date', d).lte('rank', 400)
      .in('player_id', c)))
  const rows = []
  for (const { data } of results) for (const r of data || []) rows.push(r)
  return rows
    .filter(r => r.rank_change != null && r.rank_change < 0 && r.rank < 999)
    .sort((a, b) => a.rank_change - b.rank_change)
    .slice(0, limit)
    .map(r => ({ name: nameById[r.player_id], rank: r.rank, change: -r.rank_change }))
}

// entries: the roster array for a sport (ROSTER[sportKey]).
// → { lookup, scores (by player_id), pairScores (by rosterPairKey) }
export async function loadSquadReadiness(entries) {
  const allIdsSet = new Set()
  for (const e of entries) {
    for (const p of e.players || []) if (p.id) allIdsSet.add(p.id)
    for (const w of e.watch || []) allIdsSet.add(w)
  }
  const allIds = [...allIdsSet]
  const singlesIds = []
  for (const e of entries) {
    if ((DISCIPLINES[e.discipline] || {}).kind === 'singles' && e.players?.[0]?.id) singlesIds.push(e.players[0].id)
  }
  if (!allIds.length) return { lookup: {}, scores: {}, pairScores: {} }

  const rankHistCut = cutoffDaysAgo(400).toISOString().slice(0, 10)
  const [{ data: players }, { data: ranks }] = await Promise.all([
    supabase.from('wtt_players').select('ittf_id, player_name, country_code, dob').in('ittf_id', allIds),
    supabase.from('rankings_singles_normalized').select('player_id, rank, rank_change, ranking_date').in('player_id', allIds).gte('ranking_date', rankHistCut).order('ranking_date', { ascending: false }),
  ])
  const map = {}
  for (const p of players || []) map[p.ittf_id] = { id: p.ittf_id, name: properName(p.player_name), country: p.country_code, dob: p.dob }
  const cut1y = cutoffDaysAgo(350).toISOString().slice(0, 10)
  const rank1y = {}
  for (const r of ranks || []) {
    const m = map[r.player_id] || (map[r.player_id] = { id: r.player_id })
    if (m.rank == null) { m.rank = r.rank; m.rank_change = r.rank_change }
    if (r.ranking_date <= cut1y && rank1y[r.player_id] == null) rank1y[r.player_id] = r.rank
  }

  const cut3 = cutoffDaysAgo(92)
  const doublesEntries = entries.filter(e => (DISCIPLINES[e.discipline] || {}).kind === 'doubles' && (e.players || []).filter(p => p.id).length === 2)
  const pairs = doublesEntries.map(e => { const [a, b] = e.players.map(p => p.id); return { a, b } })
  const entryRowsP = loadEntryRows(allIds)
  const doublesLedgersP = pairs.length ? loadRosterDoublesLedgers(supabase, pairs) : Promise.resolve({})

  const scoreMap = {}
  let entryRows = []
  if (singlesIds.length) {
    const idsCsv = singlesIds.join(',')
    const idsSet = new Set(singlesIds.map(Number))
    const { data: sm } = await supabase.from('wtt_matches_singles')
      .select('comp1_id, comp2_id, result, event_date, event_id, round_phase')
      .or(`comp1_id.in.(${idsCsv}),comp2_id.in.(${idsCsv})`)
      .gte('event_date', cutoffDaysAgo(365).toISOString().slice(0, 10))
      .limit(8000)

    const oppIds = new Set()
    for (const m of sm || []) {
      const c1 = Number(m.comp1_id), c2 = Number(m.comp2_id)
      if (idsSet.has(c1)) oppIds.add(c2)
      if (idsSet.has(c2)) oppIds.add(c1)
    }
    // Chunking is a URL-length limit, not a dependency — every chunk asks an unrelated
    // question. Awaiting each in turn made the page pay one round trip of browser
    // latency per chunk, which is the whole cost here: the queries themselves come back
    // in tens of milliseconds. The opponent and event lookups do not depend on each
    // other either, so all of it goes in one wave.
    const oppArr = [...oppIds]
    const evIds = [...new Set((sm || []).map(m => m.event_id))]
    const chunk = (arr, n) => {
      const out = []
      for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
      return out
    }

    const oppName = {}, oppRank = {}, eventsMap = {}
    await Promise.all([
      ...chunk(oppArr, 400).map(async c => {
        const [{ data: op }, { data: orr }] = await Promise.all([
          supabase.from('wtt_players').select('ittf_id, player_name').in('ittf_id', c),
          supabase.from('rankings_singles_normalized').select('player_id, rank, ranking_date').in('player_id', c).gte('ranking_date', rankHistCut).order('ranking_date', { ascending: false }),
        ])
        for (const p of op || []) oppName[p.ittf_id] = properName(p.player_name)
        for (const r of orr || []) if (oppRank[r.player_id] == null) oppRank[r.player_id] = r.rank
      }),
      ...chunk(evIds, 400).map(async c => {
        const { data: ev } = await supabase.from('wtt_events_graded').select('event_id, event_name, tops_grade').in('event_id', c)
        for (const e of ev || []) eventsMap[String(e.event_id)] = { name: e.event_name, tier: e.tops_grade }
      }),
    ])

    const byPlayer = {}; for (const pid of singlesIds) byPlayer[pid] = []
    for (const m of sm || []) {
      const c1 = Number(m.comp1_id), c2 = Number(m.comp2_id)
      const rawDate = new Date(m.event_date)
      for (const isComp1 of [true, false]) {
        const pid = isComp1 ? c1 : c2
        if (!idsSet.has(pid)) continue
        const won = isComp1 ? m.result === 'W' : m.result === 'L'
        const oppId = isComp1 ? c2 : c1
        byPlayer[pid].push({
          tournamentKey: String(m.event_id), round: m.round_phase || '',
          result: won ? 'W' : 'L', rawDate,
          opponentRank: oppRank[oppId] ?? 999, opponent: oppName[oppId] || 'Unknown',
        })
      }
    }
    entryRows = await entryRowsP
    for (const pid of singlesIds) {
      const led = byPlayer[pid]
      const in3 = led.filter(x => x.rawDate >= cut3)
      const rd = computeReadiness({
        rank: map[pid]?.rank, rank1y: rank1y[pid],
        wins3M: in3.filter(x => x.result === 'W').length, played3M: in3.length,
        top20Wins12M: led.filter(x => x.result === 'W' && x.opponentRank <= 20).length, base: 500,
      })
      scoreMap[pid] = { ...rd, world_rank: map[pid]?.rank, age: ageFromDob(map[pid]?.dob),
        achievements: computeAchievements(led, eventsMap), next: nextSingles(entryRows, pid) }
    }
  } else {
    entryRows = await entryRowsP
  }

  const pairMap = {}
  const ledgersByKey = await doublesLedgersP
  if (doublesEntries.length) {
    const keyOf = (a, b) => (Number(a) < Number(b) ? `${Number(a)}_${Number(b)}` : `${Number(b)}_${Number(a)}`)
    for (const e of doublesEntries) {
      const [a, b] = e.players.map(p => p.id)
      const d = ledgersByKey[keyOf(a, b)]
      if (!d || d.ranking == null) continue
      const led = d.ledger
      const in3 = led.filter(x => x.rawDate >= cut3)
      const rd = computeReadiness({
        rank: d.ranking, rank1y: d.history.find(r => r.ranking_date <= cut1y)?.rank,
        wins3M: in3.filter(x => x.result === 'W').length, played3M: in3.length,
        top20Wins12M: led.filter(x => x.result === 'W' && x.opponentRank <= 20).length, base: 300,
      })
      const dEventsMap = {}; for (const x of led) dEventsMap[x.tournamentKey] = { name: x.tournament, tier: x.eventTier }
      pairMap[rosterPairKey(e.players)] = { ...rd, pair_rank: d.ranking, age: avgAge([map[a]?.dob, map[b]?.dob]),
        achievements: computeAchievements(led, dEventsMap), next: nextPair(entryRows, a, b) }
    }
  }

  return { lookup: map, scores: scoreMap, pairScores: pairMap }
}
