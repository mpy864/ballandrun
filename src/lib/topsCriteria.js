// ─── TOPS / TAGG selection criteria — real induction & retention rules ────────
// Versioned, declarative reference data (kept in code + git so every change is
// reviewable). Three tiers: Core, Development, TAGG(Junior). Rules are either
//   { type:'rank', ... , auto:true }   — evaluated automatically from rankings
//   { type:'event', ... , auto:false } — encoded for the record, checked MANUALLY
// (Olympic/Asian/Youth/WTT-round results we don't reliably hold).
//
// Rank rules carry `rankType`:
//   'world'       — senior ITTF/WTT world rank (Core, Development).
//   'ageCategory' — U15/U17 age-category world rank (TAGG).
// Development bands are senior world rank GATED BY AGE. TAGG uses age-category
// rank + the 14–17 cohort, no maintenance period.

export const CRITERIA_META = {
  version: 'FY2024-25',
  effectiveDate: '2024-01-01',
  source: 'TOPS Induction & Retention Criteria (Core, Development) + TAGG Junior Group',
}

// discipline buckets: 'singles' (MS/WS) · 'mixed' (XD) · 'doubles' (MD/WD)
const rankRule = (o) => ({ type: 'rank', auto: true, maintainMonths: 0, ...o })
const eventRule = (o) => ({ type: 'event', auto: false, ...o })

export const CRITERIA = {
  core: {
    induction: {
      singles: [
        rankRule({ rankType: 'world', max: 8, note: 'Direct' }),
        rankRule({ rankType: 'world', min: 9, max: 32, maintainMonths: 6, manual: 'discussion', note: 'With discussion' }),
        eventRule({ comp: ['Olympics', 'World Ch', 'World Cup'], edition: 'latest', result: 'QF+' }),
        eventRule({ comp: ['Asian Games'], edition: 'latest', result: 'Silver+' }),
      ],
      mixed: [
        rankRule({ rankType: 'world', max: 10, maintainMonths: 3 }),
        eventRule({ comp: ['Olympics'], edition: 'latest', result: 'QF+' }),
        eventRule({ comp: ['World Ch', 'World Cup'], edition: 'last2', result: 'QF+' }),
        eventRule({ comp: ['Asian Games'], edition: 'latest', result: 'Bronze+ and WR<10' }),
      ],
      doubles: [
        rankRule({ rankType: 'world', max: 10, maintainMonths: 3 }),
      ],
    },
    retention: {
      appliesTo: 'inducted-non-rank', windowMonths: 12, auto: false,
      anyOf: [
        { comp: 'WTT Finals', singles: 'Qual', doubles: 'Qual' },
        { comp: 'World/Asian Ch or Cup', singles: 'R16', doubles: 'R16' },
        { comp: 'Smash', singles: 'R16', doubles: 'SF' },
        { comp: 'Champions', singles: 'R16', doubles: null },
        { comp: 'Star Contender', singles: 'SF', doubles: 'Final' },
        { comp: 'Contender', singles: 'Final', doubles: 'Winner' },
      ],
    },
  },

  development: {
    induction: {
      singles: [
        rankRule({ rankType: 'world', min: 33, max: 60, maxAge: 24, maintainMonths: 6 }),
        rankRule({ rankType: 'world', min: 61, max: 80, maxAge: 23, maintainMonths: 6 }),
        rankRule({ rankType: 'world', min: 81, max: 100, maxAge: 22, maintainMonths: 6 }),
        rankRule({ rankType: 'world', min: 101, max: 120, maxAge: 21, maintainMonths: 6 }),
        rankRule({ rankType: 'world', min: 121, max: 150, maxAge: 20, maintainMonths: 6 }),
        rankRule({ rankType: 'world', min: 151, max: 180, maxAge: 19, maintainMonths: 6 }),
        eventRule({ comp: ['Youth Olympics', 'Youth World Ch'], result: 'SF', ageCat: 'U19' }),
      ],
      mixed: [
        rankRule({ rankType: 'world', min: 11, max: 16, maxAge: 24, maintainMonths: 6 }),
        rankRule({ rankType: 'world', min: 17, max: 32, maxAge: 20, maintainMonths: 6 }),
        eventRule({ comp: ['Youth Olympics', 'Youth World Ch'], result: 'SF', ageCat: 'U19' }),
      ],
      doubles: [
        rankRule({ rankType: 'world', min: 11, max: 20, maxAge: 24, maintainMonths: 6 }),
        rankRule({ rankType: 'world', min: 21, max: 25, maxAge: 22, maintainMonths: 6 }),
        rankRule({ rankType: 'world', min: 26, max: 40, maxAge: 20, maintainMonths: 6 }),
        eventRule({ comp: ['Asian Games', 'Asian Ch'], edition: 'latest', result: 'Medal' }),
      ],
    },
    retention: {
      appliesTo: 'age-over-24', windowMonths: 12, auto: false,
      anyOf: [
        { comp: 'World Ch / World Cup', singles: 'R64', doubles: 'R32' },
        { comp: 'Asian Ch / Asian Cup', singles: 'R64', doubles: 'R32' },
        { comp: 'Smash', singles: 'Qual Rd', doubles: 'R16' },
        { comp: 'Champions', singles: 'R32', doubles: null },
        { comp: 'Star Contender', singles: 'QF', doubles: 'SF' },
        { comp: 'Contender', singles: 'SF', doubles: 'Final' },
      ],
    },
  },

  // TAGG Junior Group — age-category world ranking, cohort 14–17, no maintenance.
  tagg: {
    induction: {
      singles: [
        rankRule({ rankType: 'ageCategory', ageCategory: 'U15', max: 32, ageMin: 14, maxAge: 17 }),
        rankRule({ rankType: 'ageCategory', ageCategory: 'U17', max: 32, ageMin: 14, maxAge: 17 }),
      ],
      mixed: [
        rankRule({ rankType: 'ageCategory', ageCategory: 'U15', max: 16, ageMin: 14, maxAge: 17 }),
        rankRule({ rankType: 'ageCategory', ageCategory: 'U17', max: 16, ageMin: 14, maxAge: 17 }),
      ],
      doubles: [
        rankRule({ rankType: 'ageCategory', ageCategory: 'U15', max: 16, ageMin: 14, maxAge: 17 }),
        rankRule({ rankType: 'ageCategory', ageCategory: 'U17', max: 16, ageMin: 14, maxAge: 17 }),
      ],
    },
  },
}

export const TIER_ORDER = ['core', 'development', 'tagg']
export const TIER_LABEL = { core: 'Core', development: 'Development', tagg: 'TAGG' }

// How close (ranks above the qualifying max) counts as "approaching". Our design
// choice on top of the official qualify line — tunable.
const WATCH_MARGIN = { singles: 10, mixed: 5, doubles: 5 }

const bandLabel = (rule) => {
  const lo = rule.min && rule.min > 1 ? `${rule.min}–` : '≤'
  const pre = rule.rankType === 'ageCategory' ? `${rule.ageCategory} ` : ''
  return `${pre}${lo}${rule.max}`
}

function ruleRank(rule, input) {
  if (rule.rankType === 'ageCategory') return input.ageCatRanks?.[rule.ageCategory] ?? null
  return input.worldRank ?? null
}

// Worst (numerically largest) rank held across the rule's maintenance window.
// maintainMonths 0 → just the current rank. ageCategory → current rank (no maint).
function worstFor(rule, input) {
  if (rule.rankType === 'ageCategory' || !rule.maintainMonths) return ruleRank(rule, input)
  if (rule.maintainMonths >= 6) return input.worst6m ?? null
  if (rule.maintainMonths >= 3) return input.worst3m ?? null
  return ruleRank(rule, input)
}

// Age gate. Unknown age: allowed for ageCategory rules (being in a U15/U17 world
// list already implies youth); disallowed for age-capped world rules (can't
// confirm a senior is young enough).
function ageWithin(rule, age) {
  const capped = rule.maxAge != null || rule.ageMin != null
  if (!capped) return true
  if (age == null) return rule.rankType === 'ageCategory'
  if (rule.ageMin != null && age < rule.ageMin) return false
  if (rule.maxAge != null && age > rule.maxAge) return false
  return true
}

// Evaluate one candidate against every AUTO rank rule, best tier first.
// input: { discipline, worldRank, worst3m, worst6m, age, ageCatRanks }
// → { status:'meets'|'approaching'|'below', tier, rule, band, gap, pendingMaintenance }
export function evaluatePlayer(input) {
  let approach = null
  for (const tier of TIER_ORDER) {
    const rules = CRITERIA[tier]?.induction?.[input.discipline] || []
    let solid = null, pending = null
    for (const rule of rules) {
      if (rule.type !== 'rank' || !rule.auto) continue
      const rank = ruleRank(rule, input)
      if (rank == null) continue
      const ageOk = ageWithin(rule, input.age)
      if (rank <= rule.max && ageOk) {
        const worst = worstFor(rule, input)
        if (worst != null && worst <= rule.max) {
          solid = solid || { status: 'meets', tier, rule, band: bandLabel(rule), gap: 0 }
        } else {
          pending = pending || { status: 'meets', tier, rule, band: bandLabel(rule), gap: 0, pendingMaintenance: true }
        }
      } else if (ageOk && rank > rule.max && rank <= rule.max + (WATCH_MARGIN[input.discipline] || 8)) {
        const gap = rank - rule.max
        if (!approach || gap < approach.gap) approach = { status: 'approaching', tier, rule, band: bandLabel(rule), gap }
      }
    }
    if (solid) return solid
    if (pending) return pending
  }
  return approach || { status: 'below' }
}

// Widest world / age-category rank we ever need to fetch for a discipline (max +
// watch margin), for query bounds.
export function maxRankFor(discipline, rankType = 'world') {
  let m = 0
  for (const tier of TIER_ORDER) {
    for (const rule of CRITERIA[tier]?.induction?.[discipline] || []) {
      if (rule.type === 'rank' && rule.rankType === rankType) m = Math.max(m, rule.max)
    }
  }
  return m ? m + (WATCH_MARGIN[discipline] || 8) : 0
}
