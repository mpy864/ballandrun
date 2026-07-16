// ─── Retention risk (auto signal) ────────────────────────────────────────────
// Flags current roster athletes who NO LONGER hold any rank/age induction route,
// i.e. they now depend on event-based retention (WTT/World/Asian rounds) which we
// check manually. Pure: reuses the readiness data already loaded for the Squad
// (scores/pairScores), no extra DB calls. Maintenance is treated as neutral here
// (current rank = held) — we only ask "is there a rank/age route at all?".

import { DISCIPLINES } from './topsRoster.js'
import { rosterPairKey } from './squadReadiness.js'
import { evaluatePlayer } from './topsCriteria.js'
import { okrLink } from './okrLink.js'

const bucketOf = (entry) => {
  const kind = (DISCIPLINES[entry.discipline] || {}).kind
  if (kind === 'singles') return 'singles'
  return entry.discipline === 'XD' ? 'mixed' : 'doubles'
}

export function computeRetentionRisk({ entries, scores, pairScores, lookup }) {
  const out = []
  for (const e of entries || []) {
    if (e.youth) continue                    // TAGG has no retention rule in the doc
    const disc = DISCIPLINES[e.discipline] || {}
    const bucket = bucketOf(e)
    let rank, age, name, ids, link
    if (disc.kind === 'doubles') {
      const sc = pairScores[rosterPairKey(e.players)]
      rank = sc?.pair_rank; age = sc?.age; ids = e.players.map(p => p.id)
      name = e.players.map(p => lookup[p.id]?.name || p.name).join(' / ')
      link = okrLink({ level: 'Senior', kind: 'doubles', ids })
    } else {
      const pid = e.players[0]?.id
      const sc = scores[pid]
      rank = sc?.world_rank; age = sc?.age; ids = [pid]
      name = lookup[pid]?.name || e.players[0]?.name
      link = okrLink({ level: 'Senior', kind: 'singles', id: pid })
    }
    // Maintenance-neutral: current rank stands in for the window.
    const res = evaluatePlayer({ discipline: bucket, worldRank: rank ?? null, worst3m: rank ?? null, worst6m: rank ?? null, age })
    if (res.status === 'meets') continue
    out.push({
      name, disc: disc.short, ids, link,
      reason: rank == null ? 'Unranked — retention depends on results (manual)'
        : `No rank/age route (now #${rank}) — retention depends on results (manual)`,
    })
  }
  return out
}
