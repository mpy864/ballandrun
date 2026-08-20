import { supabase } from './supabase.js'
import { roundRank } from './matchFormat.js'

// ─── Loaders ──────────────────────────────────────────────────────────────────

// Tournaments with Indian results, newest first.
export async function loadResultEvents(limit = 40) {
  const { data, error } = await supabase
    .from('india_result_events')
    .select('event_id, event_name, first_date, last_date, matches, wins, losses, athletes, doubles_matches, all_indian_matches')
    .order('last_date', { ascending: false })
    .limit(limit)
  if (error) { console.error('result events failed', error); return [] }
  return data || []
}

// Every Indian result in one tournament, grouped discipline → round.
export async function loadEventResults(eventId) {
  const { data, error } = await supabase
    .from('india_match_results')
    .select('match_id, kind, discipline, age_group, round, ind_name, ind_p1_id, opp_name, opp_country, opp_is_indian, score, game_scores, won, event_date, ind_is_comp1')
    .eq('event_id', eventId)
    .limit(2000)
  if (error) { console.error('event results failed', error); return [] }

  const groups = new Map()
  for (const m of data || []) {
    const disc = m.discipline || m.age_group || 'Other'
    if (!groups.has(disc)) groups.set(disc, new Map())
    const rounds = groups.get(disc)
    if (!rounds.has(m.round)) rounds.set(m.round, [])
    rounds.get(m.round).push(m)
  }

  return [...groups.entries()]
    .map(([discipline, rounds]) => ({
      discipline,
      // Deepest round first — a tournament reads backwards from the final.
      rounds: [...rounds.entries()]
        .map(([round, matches]) => ({ round, matches }))
        .sort((a, b) => roundRank(b.round) - roundRank(a.round)),
      played: [...rounds.values()].reduce((n, ms) => n + ms.length, 0),
      won: [...rounds.values()].reduce((n, ms) => n + ms.filter(m => m.won).length, 0),
    }))
    .sort((a, b) => b.played - a.played)
}

