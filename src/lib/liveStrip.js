import { supabase } from './supabase.js'

// ─── Data for the live strip on the TOPS tab ─────────────────────────────────
//
// Two loaders, because the strip has two jobs and they refresh at different rates.
//
// The strip leads with Indian matches on court. That is rarer than it sounds: of 3,810
// matches tracked live over four months, 342 (9.0%) had an Indian in them and 97 (2.5%)
// had a TOPS squad athlete. WTT live-scores its bigger tables only — just 21.6% of
// India's 1,552 matches in 120 days were ever tracked live at all.
//
// So most of the time there is nothing Indian live, and the strip falls back to the last
// day India actually played. That is not a consolation prize: on 28 Aug 2026 Ankur
// Bhattacharjee won the Feeder Olomouc final in singles and doubles, and no screen in the
// app said so.

// ── Live ─────────────────────────────────────────────────────────────────────

// Every match currently on court, each flagged for Indian involvement.
//
// The caller wants both numbers: how many are live in total (for the header) and which
// ones to actually show (the Indian ones). Returning the whole set and letting the
// component filter keeps that honest — a header reading "5 live" beside an empty body is
// the truth, and hiding the 5 would not be.
export async function loadLiveMatches() {
  const { data, error } = await supabase
    .from('wtt_live_state')
    .select('match_id,event_id,comp1_id,comp2_id,comp1_name,comp2_name,games_a,games_b,pts_a,pts_b,round_name,updated_at')
    .eq('status', 'live')
  if (error) { console.error('live matches failed', error); return [] }

  const rows = data || []
  if (!rows.length) return []

  const ids = [...new Set(rows.flatMap(r => [r.comp1_id, r.comp2_id]).filter(Boolean))]
  const eventIds = [...new Set(rows.map(r => r.event_id).filter(Boolean))]

  const [pRes, rRes, eRes] = await Promise.all([
    supabase.from('wtt_players').select('ittf_id,country_code').in('ittf_id', ids),
    // Newest rank per player. Ordering descending and keeping the first sighting is what
    // LiveProbability does; a live match has no "rank at the time" to reach for.
    supabase.from('rankings_singles_normalized')
      .select('player_id,rank,ranking_date')
      .in('player_id', ids)
      .order('ranking_date', { ascending: false })
      .limit(4000),
    supabase.from('wtt_events').select('event_id,event_name').in('event_id', eventIds),
  ])

  const country = {}
  for (const p of (pRes.data || [])) country[p.ittf_id] = p.country_code
  const rank = {}
  for (const r of (rRes.data || [])) if (!(r.player_id in rank)) rank[r.player_id] = r.rank
  const eventName = {}
  for (const e of (eRes.data || [])) eventName[e.event_id] = e.event_name

  return rows.map(r => {
    const c1 = country[r.comp1_id] || null
    const c2 = country[r.comp2_id] || null
    // Which side is India's decides which name leads the row and which score comes first.
    const indIsComp1 = c1 === 'IND'
    const isIndian = indIsComp1 || c2 === 'IND'

    // round_name is the whole phrase — "U17 Girls' Singles - Round of 16 - Match 2" — not
    // the round. Passing it to shortRound() matched nothing and returned it unchanged, so
    // a live row would have printed the entire string where the round belongs. Split it:
    // the discipline is the first segment and the round is the second.
    const parts = String(r.round_name || '').split(' - ').map(x => x.trim())

    return {
      matchId: r.match_id,
      eventId: r.event_id,
      eventName: eventName[r.event_id] || null,
      discipline: parts[0] || '',
      round: parts[1] || '',
      isIndian,
      indIsComp1,
      indId: indIsComp1 ? r.comp1_id : r.comp2_id,
      indName: indIsComp1 ? r.comp1_name : r.comp2_name,
      oppId: indIsComp1 ? r.comp2_id : r.comp1_id,
      oppName: indIsComp1 ? r.comp2_name : r.comp1_name,
      oppCountry: indIsComp1 ? c2 : c1,
      oppRank: rank[indIsComp1 ? r.comp2_id : r.comp1_id] ?? null,
      games: indIsComp1 ? [r.games_a, r.games_b] : [r.games_b, r.games_a],
      points: indIsComp1 ? [r.pts_a, r.pts_b] : [r.pts_b, r.pts_a],
      updatedAt: r.updated_at,
    }
  })
}

// ── The latest day India played ──────────────────────────────────────────────

// Every Indian result from the most recent day India was on court.
//
// One round trip, not two: ask for the window, then keep whatever the newest date in it
// turns out to be. Looking up max(event_date) first and then querying it again would
// double the latency for no gain.
//
// 21 days because the gaps are real — India played on 13 Aug and then not again until
// 24 Aug. A 7-day window would have shown nothing across that stretch.
export async function loadLatestIndiaResults(days = 21) {
  const since = new Date()
  since.setDate(since.getDate() - days)

  const { data, error } = await supabase
    .from('india_match_results')
    .select('match_id,kind,event_id,event_name,event_date,discipline,round,ind_name,ind_p1_id,ind_p2_id,opp_name,opp_country,score,won')
    .gte('event_date', since.toISOString().slice(0, 10))
    .order('event_date', { ascending: false })
    .limit(400)
  if (error) { console.error('latest india results failed', error); return { date: null, rows: [] } }

  const rows = data || []
  if (!rows.length) return { date: null, rows: [] }

  const date = rows[0].event_date
  return { date, rows: rows.filter(r => r.event_date === date) }
}
