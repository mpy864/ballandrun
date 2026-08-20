// Pure formatting for match rows. No imports on purpose: this is the fiddly logic
// (draw ordering, score perspective) and keeping it free of the Supabase client means
// it can be exercised outside a browser.

// WTT stores a free-text round_phase — "Women's Singles - Round of 32 - Match 9" — and
// india_match_results keeps the middle segment. Sorting those strings alphabetically
// puts "Final" before "Group 1" and "Quarterfinal" before "Round of 16", so map each
// label to its real position in the draw instead.
// The tiers below were taken from the labels actually present in india_match_results,
// not guessed. Qualifying alone is 625 matches — ranking it as "unknown" would have
// sorted the qualifiers after the final.
const ROUND_RANK = {
  'Qualification Elimination Round': 2,
  'Preliminary': 5,
  'Round of 128': 10, 'Round of 64': 11, 'Round of 32': 12, 'Round of 16': 13,
  '3rd Place': 19, 'Bronze': 19,
  'Quarterfinal': 20, 'Quarterfinals': 20,
  'Semifinal': 21, 'Semifinals': 21,
  'Final': 22,
}

export function roundRank(label = '') {
  if (ROUND_RANK[label] != null) return ROUND_RANK[label]

  // "Group 1" .. "Group 12" — group play first, in numeric order.
  const g = /^Group\s+(\d+)/i.exec(label)
  if (g) return Number(g[1]) / 100                 // 0.01 .. 0.12

  // "Qualifying Round 1" .. "4" — after groups, before the main draw.
  const q = /^Qualifying Round\s+(\d+)/i.exec(label)
  if (q) return 1 + Number(q[1]) / 100             // 1.01 .. 1.04

  // "Pos. 17-32" — classification matches, played alongside the late rounds.
  if (/^Pos\./i.test(label)) return 15

  // "Match 7" is a parsing artefact: those round_phase values had only two segments
  // ("Men's Singles - Match 7"), so no round survived. Real matches, unknown stage —
  // keep them, but after everything that does have a stage.
  if (/^Match\s+\d+$/i.test(label)) return 90

  return 99                                         // 'Other' and anything unrecognised
}

// Per-game scores are stored from comp1's side, so flip them when the Indian player
// was comp2: "11-8,9-11" becomes "8-11,11-9".
export function gamesFor(m) {
  if (!m || !m.game_scores) return ''
  if (m.ind_is_comp1) return m.game_scores
  return m.game_scores.split(',')
    .map(g => {
      const [a, b] = g.split('-')
      return b === undefined ? g : `${b.trim()}-${a.trim()}`
    })
    .join(',')
}

// 72 ITTF-sourced matches carry a result but no score, stored as "0-0". Rendering that
// literally would read as a genuine nil-all, so callers show a dash instead.
export function hasScore(m) {
  return !!m && !!m.score && m.score !== '0-0'
}
