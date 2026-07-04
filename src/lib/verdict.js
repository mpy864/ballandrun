// Plain-language verdict + status tag from the Podium-Readiness score.
// Turns a number into a sentence a selector can read and repeat.

const TAGS = {
  Contender: { color: '#15803d', bg: '#dcfce7', border: '#86efac', dot: '#22c55e' },
  Rising:    { color: '#15803d', bg: '#dcfce7', border: '#86efac', dot: '#22c55e' },
  Holding:   { color: '#b45309', bg: '#fffbeb', border: '#fcd34d', dot: '#f59e0b' },
  Plateaued: { color: '#c2410c', bg: '#fff7ed', border: '#fdba74', dot: '#f97316' },
  Watch:     { color: '#64748b', bg: '#f1f5f9', border: '#e2e8f0', dot: '#94a3b8' },
}

const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s)

function band(r) {
  if (!r) return 'unranked'
  if (r <= 10)  return 'world top-10'
  if (r <= 20)  return 'world top-20'
  if (r <= 50)  return 'world top-50'
  if (r <= 100) return 'world top-100'
  return 'outside the world top-100'
}

// kind: 'singles' | 'doubles'; score: podium_readiness row or pair row or null
export function makeVerdict({ kind, score, singlesRank }) {
  const isPair = kind === 'doubles'
  if (!score) return { tag: 'Watch', ...TAGS.Watch, sentence: 'Not scored yet. Monitor.' }

  const v    = Number(score.score)
  const rank = isPair ? score.pair_rank : (score.world_rank ?? singlesRank)
  const traj = Number(score.trajectory) || 0
  const age  = isPair
    ? (score.avg_age != null ? Number(score.avg_age) : null)
    : (score.age != null ? Number(score.age) : null)

  let tag
  if (v >= 65 || (isPair && rank && rank <= 8) || (!isPair && rank && rank <= 20)) tag = 'Contender'
  else if (traj >= 30 && age != null && age <= 22) tag = 'Rising'
  else if (traj <= 0 && age != null && age >= 28)  tag = 'Plateaued'
  else if (rank && rank <= 60) tag = 'Holding'
  else if (traj >= 15)         tag = 'Rising'
  else                         tag = 'Watch'

  const dir = traj >= 30 ? 'rising fast' : traj >= 10 ? 'rising' : traj <= -10 ? 'slipping' : 'steady'
  const contender = (isPair && rank && rank <= 8) || (!isPair && rank && rank <= 20)

  let sentence
  if (tag === 'Contender')      sentence = `${cap(band(rank))}${isPair ? ' pair' : ''}, ${dir}. Genuine medal contender.`
  else if (tag === 'Rising')    sentence = `${age ? `Age ${age}, ` : ''}${dir}${traj > 0 ? `, up ${traj} places in a year` : ''}. Strong prospect.`
  else if (tag === 'Holding')   sentence = `${cap(band(rank))}, ${dir}. ${contender ? 'Genuine medal contender.' : 'Continental medal level.'}`
  else if (tag === 'Plateaued') sentence = `Rank ${dir === 'steady' ? 'flat' : dir}, limited runway. Reliable at continental level.`
  else                          sentence = 'Early stage. Monitor progress.'

  return { tag, ...TAGS[tag], sentence }
}
