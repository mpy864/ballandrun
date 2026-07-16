// ─────────────────────────────────────────────────────────────────────────────
// TOPS Intelligence — sport registry, athlete categories and roster.
//
// A sport is a key + a data-adapter flag; every sport reuses the same category
// structure and the same page.  Adding a sport = add a SPORTS entry + a ROSTER
// block.
//
// ROSTER is a FLAT list of entries.  Each entry is one selection slot:
//   { category, discipline, players:[{id,name}], watch:[ids] }
// Singles entries have one player; doubles / mixed have two.  An athlete may
// appear in several entries (e.g. a men's-doubles slot and a mixed slot).
// ─────────────────────────────────────────────────────────────────────────────

export const SPORTS = [
  {
    key: 'tt',
    name: 'Table Tennis',
    icon: '🏓',
    live: true,
    federation: 'Table Tennis Federation of India',
    blurb: 'WTT & ITTF world rankings, results and title forecasts',
    accent: '#2563eb',
  },
  {
    key: 'tennis',
    name: 'Tennis',
    icon: '🎾',
    live: true,
    federation: 'All India Tennis Association',
    blurb: 'ATP / WTA rankings (senior) — matches & juniors next',
    accent: '#16a34a',
  },
]

export const CATEGORIES = [
  { key: 'core',        label: 'TOPS Core',       blurb: 'Podium-focused elite',     color: '#b45309', bg: '#fffbeb', border: '#fcd34d' },
  { key: 'development', label: 'TOPS Development', blurb: 'Next-cycle prospects',     color: '#166534', bg: '#f0fdf4', border: '#86efac' },
  { key: 'tagg',        label: 'TAGG',            blurb: 'Target Asian Games Group', color: '#3730a3', bg: '#eef2ff', border: '#a5b4fc' },
]

// discipline code → label + colour + kind (singles are scored; doubles pending)
export const DISCIPLINES = {
  MS: { label: "Men's Singles",   short: 'MS', color: '#3b82f6', kind: 'singles' },
  WS: { label: "Women's Singles", short: 'WS', color: '#ec4899', kind: 'singles' },
  MD: { label: "Men's Doubles",   short: 'MD', color: '#8b5cf6', kind: 'doubles' },
  WD: { label: "Women's Doubles", short: 'WD', color: '#f59e0b', kind: 'doubles' },
  XD: { label: "Mixed Doubles",   short: 'XD', color: '#10b981', kind: 'doubles' },
}

// Official TOPS roster (as provided).  For `live` sports, `id` is the ITTF id;
// name + world rank are pulled live from the DB (name here is a fallback label).
// `watch` = ITTF ids of rivals to monitor (empty until provided).
export const ROSTER = {
  tt: [
    { category: 'core', discipline: 'WS', players: [{ id: 115920, name: 'Manika Batra' }], watch: [] },
    { category: 'core', discipline: 'WS', players: [{ id: 122718, name: 'Sreeja Akula' }], watch: [] },
    { category: 'core', discipline: 'MD', players: [{ id: 123682, name: 'Manav Thakkar' }, { id: 131879, name: 'Manush Shah' }], watch: [] },
    { category: 'core', discipline: 'XD', players: [{ id: 131879, name: 'Manush Shah' }, { id: 131395, name: 'Diya Chitale' }], watch: [] },

    { category: 'development', discipline: 'WS', players: [{ id: 137850, name: 'Yashaswini Ghorpade' }], watch: [] },
    { category: 'development', discipline: 'MS', players: [{ id: 200316, name: 'Ankur Bhattacharjee' }], watch: [] },
    { category: 'development', discipline: 'WS', players: [{ id: 201368, name: 'Syndrela Das' }], watch: [] },

    // TAGG — Target Asian Games Group (Junior/Youth).
    // Youth entries: `youth: true`, `age` (U15/U17), `events` = [[event, age-category rank]].
    { category: 'tagg', youth: true, age: 'U15', players: [{ id: 201460, name: 'Akash Rajavelu' }],        events: [['BD', 4]] },
    { category: 'tagg', youth: true, age: 'U15', players: [{ id: 212643, name: 'Rishaan Chattopadhayay' }], events: [['BD', 4]] },
    { category: 'tagg', youth: true, age: 'U15', players: [{ id: 202751, name: 'Aditya Das' }],             events: [['BS', 14], ['XD', 6]] },
    { category: 'tagg', youth: true, age: 'U15', players: [{ id: 201145, name: 'Ankolika Chakraborty' }],   events: [['GS', 8], ['GD', 10], ['XD', 6]] },
    { category: 'tagg', youth: true, age: 'U15', players: [{ id: 202752, name: 'Naisha Rewaskar' }],        events: [['GS', 17], ['GD', 10]] },
    { category: 'tagg', youth: true, age: 'U15', players: [{ id: 203837, name: 'Tanishka Kalbhairav' }],    events: [['GS', 19]] },
    { category: 'tagg', youth: true, age: 'U17', players: [{ id: 200318, name: 'Ananya Muralidharan' }],    events: [['GD', 10]] },
    { category: 'tagg', youth: true, age: 'U17', players: [{ id: 202723, name: 'Divyanshi Bhowmick' }],     events: [['GS', 5], ['GD', 1]] },
    { category: 'tagg', youth: true, age: 'U17', players: [{ id: 200319, name: 'Prisha Goel' }],            events: [['GS', 19]] },
    { category: 'tagg', youth: true, age: 'U17', players: [{ id: 201368, name: 'Syndrela Das' }],           events: [['GS', 9], ['GD', 1]] },
    // Added on selector's instruction — resolved across singles AND doubles youth rankings.
    { category: 'tagg', youth: true, age: 'U17', players: [{ id: 201372, name: 'Sarthak Arya' }],           events: [['BS', 28], ['BD', 80], ['XD', 64]] },
    { category: 'tagg', youth: true, age: 'U17', players: [{ id: 200839, name: 'Kavya Bhatt' }],            events: [['GS', 19], ['GD', 111], ['XD', 164]] },
    { category: 'tagg', youth: true, age: 'U17', players: [{ id: 145804, name: 'Hansini Mathan' }],         events: [['GS', 24], ['GD', 47], ['XD', 127]] },
    { category: 'tagg', youth: true, age: 'U15', players: [{ id: 202918, name: 'Ahona Ray' }],              events: [['GS', 22], ['GD', 58]] },
    { category: 'tagg', youth: true, age: 'U15', players: [{ id: 213004, name: 'Sreejani Chakraborty' }],   events: [['GS', 27], ['GD', 58]] },
  ],

  // Static placeholder until the tennis ranking adapter is built.
  tennis: [
    { category: 'core',        discipline: 'MS', players: [{ name: 'Sumit Nagal' }] },
    { category: 'core',        discipline: 'WS', players: [{ name: 'Sahaja Yamalapalli' }] },
    { category: 'development', discipline: 'MS', players: [{ name: 'Manas Dhamne' }] },
    { category: 'development', discipline: 'WS', players: [{ name: 'Shrivalli Bhamidipaty' }] },
  ],
}

export function getSport(key) {
  return SPORTS.find(s => s.key === key) || null
}
