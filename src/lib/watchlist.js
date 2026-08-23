// ─── Watchlist: Indian athletes who MEET or are APPROACHING a TOPS route ──────
// Scans three candidate pools against the real criteria (topsCriteria.js) and
// returns non-roster Indians classified into Core / Development / TAGG:
//   • senior singles  — world rank + age + maintenance  → Core / Development
//   • senior doubles  — pair world rank + age + maint.   → Core / Development
//   • youth singles/doubles — U15/U17 age-category rank  → TAGG (cohort 14–17)
// Rank + age + maintenance routes are auto; event routes (Olympic/Asian/Youth/
// WTT rounds) are documented in the config but need manual review.

import { supabase } from './supabase.js'
import { ROSTER } from './topsRoster.js'
import { ageFromDob } from './squadReadiness.js'
import { evaluatePlayer, maxRankFor, TIER_ORDER, TIER_LABEL } from './topsCriteria.js'

export const MANUAL_NOTE =
  'Rank + age routes are auto-checked. Event routes (Olympic/Asian/Youth medals, WTT rounds) need manual review.'

function rosterIds() {
  const s = new Set()
  for (const e of ROSTER.tt || []) for (const p of e.players || []) if (p.id) s.add(Number(p.id))
  return s
}

const DAY = 86400000
// worst (largest) rank across a window ending at `ref`; 999 if history too short.
function windowStats(rowsDesc, ref) {
  const current = rowsDesc[0]?.rank ?? null
  const earliest = rowsDesc[rowsDesc.length - 1]?.date
  const worstSince = (days) => {
    const start = new Date(ref.getTime() - days * DAY)
    const inWin = rowsDesc.filter(r => new Date(r.date) >= start)
    const hasHistory = earliest && new Date(earliest) <= start
    if (!hasHistory || !inWin.length) return 999
    return Math.max(...inWin.map(r => r.rank))
  }
  return { current, worst3m: worstSince(92), worst6m: worstSince(183) }
}

const GENDER_SINGLES = g => (g === 'W' || g === 'F' || g === 'women' ? 'WS' : 'MS')
const bucketOf = disc => (disc === 'XD' ? 'mixed' : (disc === 'MS' || disc === 'WS' ? 'singles' : 'doubles'))

export async function loadWatchlist() {
  const inRoster = rosterIds()
  const out = new Map()   // key `${id}:${bucket}` → best row

  // Indian player directory (dob for age, name fallback).
  const { data: inds } = await supabase.from('wtt_players')
    .select('ittf_id, player_name, dob, country_code').eq('country_code', 'IND').limit(4000)
  const indIds = new Set((inds || []).map(p => Number(p.ittf_id)))
  const dobById = {}, nameById = {}
  for (const p of inds || []) { dobById[p.ittf_id] = p.dob; nameById[p.ittf_id] = p.player_name }

  const consider = (row) => {
    if (!row || !row.id || inRoster.has(Number(row.id))) return
    const key = `${row.id}:${row.discBucket}`
    const prev = out.get(key)
    if (!prev || better(row, prev)) out.set(key, row)
  }

  await Promise.all([
    scanSeniorSingles({ indIds, dobById, nameById, consider }),
    scanSeniorDoubles({ indIds, dobById, nameById, consider }),
    scanTaggSingles({ dobById, nameById, consider }),
    scanTaggDoubles({ dobById, nameById, consider }),
  ])

  const rows = [...out.values()]
  rows.sort((a, b) => {
    const am = a.status === 'meets', bm = b.status === 'meets'
    if (am !== bm) return am ? -1 : 1
    if (am) return TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.rank - b.rank
    return (a.gap ?? 999) - (b.gap ?? 999)
  })
  return rows
}

// meets beats approaching; then better tier; then better (lower) rank.
function better(a, b) {
  const rank = s => (s === 'meets' ? 0 : s === 'approaching' ? 1 : 2)
  if (rank(a.status) !== rank(b.status)) return rank(a.status) < rank(b.status)
  const ta = TIER_ORDER.indexOf(a.tier), tb = TIER_ORDER.indexOf(b.tier)
  if (ta !== tb) return ta < tb
  return (a.rank ?? 999) < (b.rank ?? 999)
}

function rowFrom(res, base) {
  if (res.status === 'below') return null
  return {
    ...base, status: res.status, tier: res.tier, tierLabel: TIER_LABEL[res.tier],
    band: res.band, gap: res.gap, pendingMaintenance: res.pendingMaintenance || false,
  }
}

// ── Senior singles → Core / Development ──
async function scanSeniorSingles({ indIds, dobById, nameById, consider }) {
  const { data: latest } = await supabase.from('rankings_singles_normalized')
    .select('ranking_date').order('ranking_date', { ascending: false }).limit(1)
  const ref = latest?.[0]?.ranking_date ? new Date(latest[0].ranking_date) : null
  if (!ref) return
  const cap = maxRankFor('singles')
  const since = new Date(ref.getTime() - 200 * DAY).toISOString().slice(0, 10)
  const ids = [...indIds]
  const byPlayer = {}
  // Independent chunks, so one wave rather than a queue. Ordering within a player is
  // preserved because each row is filed under its own player_id and the sort that
  // matters is the per-request `order`, not the order the responses arrive in.
  const chunks = []
  for (let i = 0; i < ids.length; i += 700) chunks.push(ids.slice(i, i + 700))
  const results = await Promise.all(chunks.map(c =>
    supabase.from('rankings_singles_normalized')
      .select('player_id, rank, gender, ranking_date').gte('ranking_date', since)
      .in('player_id', c).order('ranking_date', { ascending: false })))
  for (const { data } of results)
    for (const r of data || []) (byPlayer[r.player_id] ||= []).push({ rank: r.rank, date: r.ranking_date, gender: r.gender })
  for (const pid of Object.keys(byPlayer)) {
    const rows = byPlayer[pid]
    if ((rows[0]?.rank ?? 999) > cap) continue
    const st = windowStats(rows, ref)
    const res = evaluatePlayer({ discipline: 'singles', worldRank: st.current, worst3m: st.worst3m, worst6m: st.worst6m, age: ageFromDob(dobById[pid]) })
    const disc = GENDER_SINGLES(rows[0]?.gender)
    consider(rowFrom(res, {
      id: Number(pid), name: nameById[pid], disc, discBucket: 'singles', rank: st.current,
      okr: { level: 'Senior', kind: 'singles', id: Number(pid) },
    }))
  }
}

// ── Senior doubles (MD/WD/XD) → Core / Development ──
async function scanSeniorDoubles({ indIds, dobById, nameById, consider }) {
  const { data: latest } = await supabase.from('rankings_doubles_teams')
    .select('publish_date').order('publish_date', { ascending: false }).limit(1)
  const ref = latest?.[0]?.publish_date ? new Date(latest[0].publish_date) : null
  if (!ref) return
  const cap = Math.max(maxRankFor('mixed'), maxRankFor('doubles'))
  const since = new Date(ref.getTime() - 200 * DAY).toISOString().slice(0, 10)
  const { data } = await supabase.from('rankings_doubles_teams')
    .select('pair_id, p1_ittf_id, p2_ittf_id, category, current_rank, publish_date')
    .gte('publish_date', since).lte('current_rank', cap).order('publish_date', { ascending: false })
  const byPair = {}
  for (const r of data || []) (byPair[r.pair_id] ||= []).push(r)
  for (const pid of Object.keys(byPair)) {
    const hist = byPair[pid]
    const head = hist[0]
    const p1 = Number(head.p1_ittf_id), p2 = Number(head.p2_ittf_id)
    const indian = [p1, p2].filter(x => indIds.has(x))
    if (!indian.length) continue
    const discBucket = bucketOf(head.category)
    const st = windowStats(hist.map(r => ({ rank: r.current_rank, date: r.publish_date })), ref)
    // Development doubles age cap applies to BOTH players (assumption).
    const age = Math.max(ageFromDob(dobById[p1]) ?? -1, ageFromDob(dobById[p2]) ?? -1)
    const res = evaluatePlayer({ discipline: discBucket, worldRank: st.current, worst3m: st.worst3m, worst6m: st.worst6m, age: age < 0 ? null : age })
    for (const cand of indian) {
      consider(rowFrom(res, {
        id: cand, ids: [p1, p2], name: nameById[cand], disc: head.category, discBucket, rank: st.current,
        okr: { level: 'Senior', kind: 'doubles', ids: [p1, p2] },
      }))
    }
  }
}

// ── TAGG singles (U15/U17 age-category) ──
//
// Nested `for` loops with an `await` inside run one request at a time. Four band/event
// combinations, two requests each, was eight round trips in a queue — and browser
// latency, not query time, is what this page pays: the SQL underneath answers in
// milliseconds. The combinations do not depend on each other, so they go together.
//
// Deliberately still two requests per combination rather than one shared "latest week".
// Each band is asked for its OWN latest week, which is what the old code did, and if one
// band is ever published late that band simply reads its own most recent week instead of
// coming back empty against someone else's.
async function scanTaggSingles({ dobById, nameById, consider }) {
  const combos = []
  for (const age of ['U15', 'U17']) for (const sub of ['MS', 'WS']) combos.push({ age, sub })

  await Promise.all(combos.map(async ({ age, sub }) => {
    const { data: latest } = await supabase.from('youth_rankings_singles')
      .select('ranking_year, ranking_week').eq('age_category', age).eq('sub_event', sub)
      .order('ranking_year', { ascending: false }).order('ranking_week', { ascending: false }).limit(1)
    const ly = latest?.[0]; if (!ly) return
    const { data } = await supabase.from('youth_rankings_singles')
      .select('ittf_id, player_name, age_cat_rank').eq('country_code', 'IND')
      .eq('age_category', age).eq('sub_event', sub)
      .eq('ranking_year', ly.ranking_year).eq('ranking_week', ly.ranking_week)
      .lte('age_cat_rank', maxRankFor('singles', 'ageCategory'))
    for (const r of data || []) {
      if (r.age_cat_rank == null) continue
      const id = Number(r.ittf_id)
      const res = evaluatePlayer({ discipline: 'singles', ageCatRanks: { [age]: r.age_cat_rank }, age: ageFromDob(dobById[id]) })
      consider(rowFrom(res, {
        id, name: nameById[id] || r.player_name, disc: sub, discBucket: 'singles', rank: r.age_cat_rank,
        okr: { level: age, kind: 'singles', id },
      }))
    }
  }))
}

// ── TAGG doubles (U15/U17 age-category, MD/WD/XD) ──
// Six combinations here rather than four, so twelve queued round trips became one wave.
async function scanTaggDoubles({ dobById, nameById, consider }) {
  const combos = []
  for (const age of ['U15', 'U17']) for (const sub of ['MD', 'WD', 'XD']) combos.push({ age, sub })

  await Promise.all(combos.map(async ({ age, sub }) => {
      const { data: latest } = await supabase.from('youth_rankings_doubles')
        .select('ranking_year, ranking_week').eq('age_category', age).eq('sub_event', sub)
        .order('ranking_year', { ascending: false }).order('ranking_week', { ascending: false }).limit(1)
      const ly = latest?.[0]; if (!ly) return
      const { data } = await supabase.from('youth_rankings_doubles')
        .select('ittf_id1, player_name1, country_code1, ittf_id2, player_name2, country_code2, age_cat_rank')
        .eq('age_category', age).eq('sub_event', sub)
        .eq('ranking_year', ly.ranking_year).eq('ranking_week', ly.ranking_week)
        .lte('age_cat_rank', maxRankFor(sub === 'XD' ? 'mixed' : 'doubles', 'ageCategory'))
      const discBucket = sub === 'XD' ? 'mixed' : 'doubles'
      for (const r of data || []) {
        if (r.age_cat_rank == null) continue
        const members = [
          { id: Number(r.ittf_id1), name: r.player_name1, ind: r.country_code1 === 'IND' },
          { id: Number(r.ittf_id2), name: r.player_name2, ind: r.country_code2 === 'IND' },
        ]
        if (!members.some(m => m.ind)) continue
        const res = evaluatePlayer({ discipline: discBucket, ageCatRanks: { [age]: r.age_cat_rank }, age: ageFromDob(dobById[members[0].id]) ?? ageFromDob(dobById[members[1].id]) })
        for (const m of members.filter(x => x.ind)) {
          consider(rowFrom(res, {
            id: m.id, ids: members.map(x => x.id), name: nameById[m.id] || m.name, disc: sub, discBucket, rank: r.age_cat_rank,
            okr: { level: age, kind: 'doubles', ids: members.map(x => x.id) },
          }))
        }
      }
  }))
}
