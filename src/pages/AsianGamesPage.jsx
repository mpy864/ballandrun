import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase.js'
import { T, card, label as labelStyle, chip, accentVar } from '../lib/ui.js'
import { group, rise, FLAG } from '../components/brand.jsx'
import AuthBar from '../components/AuthBar.jsx'

/**
 * Asian Games 2026 table tennis — public live board.
 *
 * Built on the app's own primitives (T, card, label, chip) and its motion
 * language (group/rise from brand.jsx), so it reads as part of Ball&Run rather
 * than a page that arrived from somewhere else. The one thing it adds is a pair
 * of competitor colours: those carry identity in the probability bar and the
 * game chips, and they were checked for colour-vision separation rather than
 * picked by eye. Colour is never the only signal — every place they appear also
 * shows a name or a number.
 *
 * Reads the ag2026_* tables, which migration 032 opened to anonymous readers so
 * the link can be shared with no sign-up. Everything else in the database stays
 * closed, so this page must never query a wtt_* table: a logged-out visitor
 * would silently get zero rows and the section would look empty rather than
 * refused.
 */

const HOME = '#00889B'   // teal — the player on the left
const AWAY = '#DB5124'   // vermilion — the player on the right
const LIVE = '#c2410c'

const mono = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'
const nums = { fontFamily: mono, fontVariantNumeric: 'tabular-nums' }

/* A game is over at 11 with a margin of two. Anything else at the end of the
   string is the game being played right now. */
function splitGames(resDetail) {
  const games = []
  let playing = null
  String(resDetail || '').replace(/:/g, '-').split(',').forEach(chunk => {
    const m = chunk.trim().match(/^(\d+)-(\d+)$/)
    if (!m) return
    const a = +m[1], b = +m[2]
    if (!a && !b) return
    if (Math.max(a, b) >= 11 && Math.abs(a - b) >= 2) games.push([a, b])
    else playing = [a, b]
  })
  return { games, playing }
}

const genderOf = k => (String(k || '').slice(0, 1) === 'W' ? 'Women' : 'Men')

/* This is a TOPS board, so India comes first everywhere: its own section above
   the rest, and its rows lifted to the top of every list below. */
const IND = 'IND'
const isIndia = r => r.comp1_org === IND || r.comp2_org === IND ||
                     r.home_org === IND || r.away_org === IND || r.org === IND
const indiaFirst = rows => [...rows].sort((a, b) => (isIndia(b) ? 1 : 0) - (isIndia(a) ? 1 : 0))

/* Which side of the row India is on, and how the match reads from there. */
function fromIndia(r) {
  const first = r.comp1_org === IND
  const pre = r.p_prematch == null ? null
            : Math.round(100 * (first ? Number(r.p_prematch) : 1 - Number(r.p_prematch)))
  const gf = first ? r.games_a : r.games_b
  const ga = first ? r.games_b : r.games_a
  return {
    player: first ? r.comp1_name : r.comp2_name,
    opponent: first ? r.comp2_name : r.comp1_name,
    oppOrg: first ? r.comp2_org : r.comp1_org,
    gf, ga, won: gf > ga, pre,
  }
}

/* A saffron hairline on the left is the whole marker. It reads instantly in a
   list and costs no width, and every India row also names the player. */
const indiaMark = { borderLeft: `2px solid ${FLAG.saffron}` }

/* The probability bar: the table seen from above, split at the probability,
   with a two-pixel gap standing in for the net. */
function ProbBar({ p }) {
  if (p == null) {
    return <div style={{
      height: 24, borderRadius: T.radiusSm, marginTop: 12,
      background: 'repeating-linear-gradient(135deg,rgba(0,0,0,0.03),rgba(0,0,0,0.03) 5px,rgba(0,0,0,0.06) 5px,rgba(0,0,0,0.06) 6px)',
    }} />
  }
  const w = Math.max(0, Math.min(100, p * 100))
  return (
    <div style={{
      position: 'relative', height: 24, marginTop: 12,
      borderRadius: T.radiusSm, overflow: 'hidden', display: 'flex',
    }}>
      <span style={{ width: `calc(${w}% - 1px)`, background: HOME }} />
      <span style={{ width: 2, background: T.card, flex: 'none' }} />
      <span style={{ flex: 1, background: AWAY }} />
      <span style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', padding: '0 9px',
        ...nums, fontSize: 11.5, fontWeight: 600, color: '#fff',
        textShadow: '0 1px 2px rgba(0,0,0,0.3)',
      }}>
        <span>{Math.round(w)}%</span><span>{Math.round(100 - w)}%</span>
      </span>
    </div>
  )
}

function MatchCard({ row, live }) {
  const { games, playing } = splitGames(row.res_detail)
  const p = row.p_win != null ? Number(row.p_win)
          : row.p_prematch != null ? Number(row.p_prematch) : null
  const pre = row.p_prematch != null ? Math.round(100 * Number(row.p_prematch)) : null
  const won = row.games_a > row.games_b

  return (
    <motion.div variants={rise} style={{
      ...card, padding: '13px 15px 15px', marginBottom: 8,
      ...(isIndia(row) ? indiaMark : null),
    }}>
      {/* A team rubber is a real singles match, but it is only readable if you
          can see which tie it sits in and where that tie stands. */}
      {row.tie_label && (
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
          marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${T.divider}`,
        }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: T.ink }}>{row.tie_label}</span>
          {row.rubber_num > 0 && (
            <span style={{ fontSize: 12, color: T.slate }}>Match {row.rubber_num} of 5</span>
          )}
          {row.tie_score && (
            <span style={{ marginLeft: 'auto', ...nums, fontSize: 12, color: T.slate }}>
              tie {row.tie_score}
            </span>
          )}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 9 }}>
        <span style={{ ...labelStyle, fontSize: 10 }}>
          {genderOf(row.event_key)}{row.tie_label ? ' team' : ' singles'}
        </span>
        {row.round_label && <span style={chip(T.slate)}>{row.round_label}</span>}
        {live
          ? <span style={chip(LIVE, { fontWeight: 700 })}>Live</span>
          : <span style={chip(T.muted)}>Final</span>}
        {live && row.prob_level && <span style={chip(T.muted)}>{row.prob_level}</span>}
        {row.data_age_s != null && (
          <span style={{ marginLeft: 'auto', ...nums, fontSize: 10.5, color: T.muted }}>
            {row.data_age_s}s old
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, alignItems: 'end' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15.5, color: T.ink, lineHeight: 1.25, overflowWrap: 'anywhere' }}>
            {row.comp1_name || 'TBD'}
          </div>
          <div style={{ ...nums, fontSize: 10.5, color: HOME, letterSpacing: '0.06em', marginTop: 1 }}>
            {row.comp1_org || ''}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ ...nums, fontSize: 22, fontWeight: 600, color: T.ink, letterSpacing: '-0.01em' }}>
            {row.games_a ?? 0}<span style={{ color: T.muted, fontWeight: 400 }}>:</span>{row.games_b ?? 0}
          </div>
          {playing && (
            <div style={{ ...nums, fontSize: 11.5, color: LIVE, fontWeight: 600 }}>
              {playing[0]} : {playing[1]}
            </div>
          )}
        </div>
        <div style={{ minWidth: 0, textAlign: 'right' }}>
          <div style={{ fontWeight: 600, fontSize: 15.5, color: T.ink, lineHeight: 1.25, overflowWrap: 'anywhere' }}>
            {row.comp2_name || 'TBD'}
          </div>
          <div style={{ ...nums, fontSize: 10.5, color: AWAY, letterSpacing: '0.06em', marginTop: 1 }}>
            {row.comp2_org || ''}
          </div>
        </div>
      </div>

      <ProbBar p={p} />

      {(games.length > 0 || playing) && (
        <div style={{ display: 'flex', gap: 4, marginTop: 9, flexWrap: 'wrap' }}>
          {games.map(([a, b], i) => (
            <span key={i} style={chip(a > b ? HOME : AWAY, { ...nums, fontSize: 10.5 })}>{a}:{b}</span>
          ))}
          {playing && (
            <span style={{
              ...nums, fontSize: 10.5, padding: '3px 9px', borderRadius: 3,
              border: `1px dashed ${LIVE}`, color: LIVE, lineHeight: 1.4,
            }}>{playing[0]}:{playing[1]}</span>
          )}
        </div>
      )}

      {!live && pre != null && (
        <div style={{ marginTop: 9, fontSize: 12, color: T.slate }}>
          Pre-match {pre}% · {(pre > 50) === won ? 'favourite won' : 'upset'}
        </div>
      )}
    </motion.div>
  )
}

function Empty({ title, body }) {
  return (
    <motion.div variants={rise} style={{
      ...card, padding: '18px 16px', borderStyle: 'dashed', boxShadow: 'none',
    }}>
      <div style={{ fontWeight: 600, color: T.ink, marginBottom: 3 }}>{title}</div>
      <div style={{ fontSize: 13, color: T.slate, lineHeight: 1.55 }}>{body}</div>
    </motion.div>
  )
}

function Section({ title, note, children }) {
  return (
    <motion.section variants={rise} style={{ marginTop: 30 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 11, flexWrap: 'wrap' }}>
        <h2 style={{ ...labelStyle, margin: 0 }}>{title}</h2>
        {note && (
          <span style={{ fontSize: 12, color: T.muted, marginLeft: 'auto', maxWidth: 560, textAlign: 'right' }}>
            {note}
          </span>
        )}
      </div>
      {children}
    </motion.section>
  )
}

function OddsTable({ eventKey, rows }) {
  return (
    <div style={{ ...card, padding: '14px 16px 8px', overflowX: 'auto' }}>
      <div style={{ fontWeight: 600, color: T.ink, fontSize: 14, marginBottom: 10 }}>
        {genderOf(eventKey)}&rsquo;s Singles
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {['Player', 'Gold', 'Medal'].map((h, i) => (
              <th key={h} style={{
                ...labelStyle, fontSize: 10, padding: '0 0 6px',
                textAlign: i ? 'right' : 'left', borderBottom: `1px solid ${T.border}`,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const t = 100 * Number(r.p_title)
            return (
              <tr key={r.qkey}>
                <td style={{
                  padding: '7px 0 7px 8px', borderBottom: `1px solid ${T.divider}`, color: T.ink,
                  marginLeft: -8, ...(r.org === IND ? indiaMark : null),
                }}>
                  {r.label}
                  <span style={{ ...nums, fontSize: 10, color: T.muted, marginLeft: 6 }}>{r.org}</span>
                  {r.is_rated === false && (
                    <span style={{ marginLeft: 6, ...chip(T.muted, { fontSize: 9.5 }) }}>unrated</span>
                  )}
                </td>
                <td style={{
                  padding: '7px 0', borderBottom: `1px solid ${T.divider}`,
                  textAlign: 'right', ...nums, color: T.ink, minWidth: 72,
                }}>
                  {t.toFixed(1)}%
                  <div style={{
                    height: 2, borderRadius: 1, background: HOME,
                    marginTop: 3, marginLeft: 'auto', width: `${Math.max(1, t)}%`,
                  }} />
                </td>
                <td style={{
                  padding: '7px 0', borderBottom: `1px solid ${T.divider}`,
                  textAlign: 'right', ...nums, color: T.slate,
                }}>
                  {(100 * Number(r.p_medal)).toFixed(1)}%
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* Module scope, not inside IndiaBoard: a component declared during render is a
   new type on every render, so React would tear down and rebuild every row
   instead of updating it. */
const Row = ({ children, last }) => (
  <div style={{
    display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center',
    padding: '8px 13px', fontSize: 13,
    borderBottom: last ? 'none' : `1px solid ${T.divider}`,
  }}>{children}</div>
)

/* India's own section. Dense rows rather than full match cards: this is the
   part a TOPS coach checks first and often, so it has to answer "how did we do
   and who is next" in one screen, not four scrolls. */
function IndiaBoard({ live, results, next, odds }) {
  const won = results.filter(r => fromIndia(r).won).length
  const lost = results.length - won
  const upsets = results.filter(r => {
    const f = fromIndia(r)
    return f.pre != null && f.pre < 50 && f.won
  })

  return (
    <motion.section variants={rise} style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 11, flexWrap: 'wrap' }}>
        <h2 style={{
          ...labelStyle, margin: 0, fontSize: 12, color: T.ink,
          borderLeft: `3px solid ${FLAG.saffron}`, paddingLeft: 8,
        }}>India</h2>
        {results.length > 0 && (
          <span style={{ ...nums, fontSize: 13, color: T.slate }}>
            <b style={{ color: FLAG.green, fontWeight: 600 }}>{won} won</b>
            <span style={{ color: T.muted }}> · </span>
            {lost} lost
          </span>
        )}
        {upsets.length > 0 && (
          <span style={chip(FLAG.green)}>
            {upsets.length} {upsets.length === 1 ? 'win' : 'wins'} the model did not expect
          </span>
        )}
      </div>

      {live.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {live.map(r => <MatchCard key={r.unit_key} row={r} live />)}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(290px,1fr))', gap: 12 }}>

        <div style={{ ...card, ...indiaMark, overflow: 'hidden' }}>
          <div style={{ ...labelStyle, fontSize: 10, padding: '11px 13px 8px' }}>Next up</div>
          {next.length === 0
            ? <div style={{ padding: '0 13px 13px', fontSize: 13, color: T.slate }}>
                Nothing scheduled in the window.
              </div>
            : next.slice(0, 6).map((u, i, a) => (
              <Row key={u.unit_key} last={i === a.length - 1}>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere', color: T.ink }}>
                  {u.home_name || u.away_name
                    ? <>{u.home_name || 'Bye'}<span style={{ color: T.muted }}> v </span>{u.away_name || 'Bye'}</>
                    : <span style={{ color: T.slate }}>{u.event_desc}</span>}
                </span>
                <span style={{ ...nums, fontSize: 11, color: T.slate, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {new Date(u.start_at).toLocaleString('en-GB', {
                    weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo',
                  })}
                  {u.round_label ? ` · ${u.round_label}` : ''}
                </span>
              </Row>
            ))}
        </div>

        <div style={{ ...card, ...indiaMark, overflow: 'hidden' }}>
          <div style={{ ...labelStyle, fontSize: 10, padding: '11px 13px 8px' }}>
            Results · model verdict
          </div>
          {results.length === 0
            ? <div style={{ padding: '0 13px 13px', fontSize: 13, color: T.slate }}>
                No matches played yet.
              </div>
            : results.slice(0, 8).map((r, i, a) => {
              const f = fromIndia(r)
              const surprise = f.pre != null && (f.pre < 50) === f.won
              return (
                <Row key={r.unit_key} last={i === a.length - 1}>
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    <b style={{ fontWeight: 600, color: T.ink }}>{f.player}</b>
                    <span style={{ color: T.muted }}> v </span>
                    <span style={{ color: T.slate }}>{f.opponent}</span>
                    <span style={{ ...nums, fontSize: 10, color: T.muted, marginLeft: 5 }}>{f.oppOrg}</span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
                    <span style={{ ...nums, fontWeight: 600, color: f.won ? FLAG.green : T.slate }}>
                      {f.gf}&ndash;{f.ga}
                    </span>
                    {f.pre != null && (
                      <span style={chip(surprise ? FLAG.saffron : T.muted, { fontSize: 9.5 })}>
                        {f.pre}%
                      </span>
                    )}
                  </span>
                </Row>
              )
            })}
        </div>
      </div>

      {odds.length > 0 && (
        <div style={{ ...card, ...indiaMark, marginTop: 12, padding: '11px 13px 12px' }}>
          <div style={{ ...labelStyle, fontSize: 10, marginBottom: 8 }}>Singles medal chance</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px' }}>
            {odds.map(o => (
              <span key={o.qkey} style={{ fontSize: 13, color: T.ink }}>
                {o.label}
                <span style={{ ...nums, color: T.slate, marginLeft: 6 }}>
                  {(100 * Number(o.p_medal)).toFixed(1)}%
                </span>
              </span>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: T.muted, marginTop: 8 }}>
            Chance of reaching the semi-final, which is where the Games awards its two bronzes.
          </div>
        </div>
      )}
    </motion.section>
  )
}

export default function AsianGamesPage() {
  const [live, setLive] = useState([])
  const [recent, setRecent] = useState([])
  const [odds, setOdds] = useState([])
  const [sched, setSched] = useState([])
  const [indResults, setIndResults] = useState([])
  const [indNext, setIndNext] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const chanRef = useRef(null)

  async function load() {
    const now = Date.now()
    const from = new Date(now - 3 * 3600e3).toISOString()
    const to   = new Date(now + 30 * 3600e3).toISOString()

    // India is queried separately rather than filtered out of the lists above:
    // those carry a limit, and India's rows must never fall off the end of it.
    const [l, r, f, s, ir, inx] = await Promise.all([
      supabase.from('ag2026_live_state')
        .select('unit_key,event_key,round_label,comp1_name,comp2_name,comp1_org,comp2_org,games_a,games_b,pts_a,pts_b,best_of,p_win,p_prematch,prob_level,res_detail,data_age_s,parent_unit,rubber_num,tie_label,tie_score')
        // Rubbers of the same tie sit together, in playing order, so a team
        // session reads as one contest rather than five loose matches.
        .eq('status', 'live')
        .order('parent_unit', { ascending: true, nullsFirst: true })
        .order('rubber_num', { ascending: true }).limit(24),
      supabase.from('ag2026_live_state')
        .select('unit_key,event_key,round_label,comp1_name,comp2_name,comp1_org,comp2_org,games_a,games_b,p_prematch,res_detail,rubber_num,tie_label,tie_score')
        .eq('status', 'finished').not('p_prematch', 'is', null)
        .order('updated_at', { ascending: false }).limit(12),
      supabase.from('ag2026_forecasts')
        .select('event_key,qkey,label,org,p_title,p_medal,is_rated')
        .order('p_title', { ascending: false }),
      supabase.from('ag2026_units')
        .select('unit_key,round_label,event_desc,start_at,loc_desc,home_name,away_name,home_org,away_org,status')
        .eq('rubber_num', 0).not('start_at', 'is', null)
        .gte('start_at', from).lte('start_at', to)
        .order('start_at').limit(50),

      supabase.from('ag2026_live_state')
        .select('unit_key,event_key,round_label,comp1_name,comp2_name,comp1_org,comp2_org,games_a,games_b,p_prematch,res_detail,tie_label,rubber_num')
        .or(`comp1_org.eq.${IND},comp2_org.eq.${IND}`)
        .eq('status', 'finished').order('updated_at', { ascending: false }).limit(20),

      supabase.from('ag2026_units')
        .select('unit_key,round_label,event_desc,start_at,loc_desc,home_name,away_name,home_org,away_org,status')
        .eq('rubber_num', 0).or(`home_org.eq.${IND},away_org.eq.${IND}`)
        .not('start_at', 'is', null).gte('start_at', from)
        .order('start_at').limit(10),
    ])

    const bad = [l, r, f, s, ir, inx].find(x => x.error)
    setErr(bad ? bad.error.message : null)
    setLive(l.data || []); setRecent(r.data || [])
    setOdds(f.data || []); setSched(s.data || [])
    setIndResults(ir.data || []); setIndNext(inx.data || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // Polling fallback: the socket can drop, and a board that silently freezes
    // during a match is worse than one that refreshes a little late.
    const timer = setInterval(load, 20_000)
    const ch = supabase.channel('ag2026-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ag2026_live_state' }, load)
      .subscribe()
    chanRef.current = ch
    return () => { clearInterval(timer); supabase.removeChannel(ch) }
  }, [])

  const byEvent = {}
  odds.forEach(o => { (byEvent[o.event_key] ||= []).push(o) })

  const scored = recent.filter(r => Number(r.p_prematch) !== 0.5)
  const hits = scored.filter(r => (Number(r.p_prematch) > 0.5) === (r.games_a > r.games_b))
  const worstLag = live.reduce((m, r) => Math.max(m, r.data_age_s ?? 0), 0)

  const indWon = indResults.filter(r => fromIndia(r).won).length
  const indLive = live.filter(isIndia)

  const stats = [
    ['India record', indResults.length ? `${indWon}–${indResults.length - indWon}` : '—'],
    ['India live', indLive.length],
    ['Live now', live.length],
    ['Favourite won', scored.length ? `${Math.round(100 * hits.length / scored.length)}%` : '—'],
    ['Feed lag', live.length ? `${worstLag}s` : '—'],
  ]

  const days = {}
  sched.forEach(u => {
    const d = new Date(u.start_at).toLocaleDateString('en-GB',
      { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Asia/Tokyo' })
    ;(days[d] ||= []).push(u)
  })

  return (
    <div style={{
      ...accentVar(HOME),
      minHeight: '100vh', position: 'relative', zIndex: 4,
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      color: T.ink,
    }}>
      <AuthBar />
      <motion.div
        variants={group} initial="hidden" animate="show"
        style={{ maxWidth: 1000, margin: '0 auto', padding: '30px 16px 56px' }}
      >
        <motion.header variants={rise} style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={chip(HOME)}>Table tennis</span>
            <span style={{ ...labelStyle, fontSize: 10 }}>Singles &amp; team</span>
          </div>
          <h1 style={{
            fontSize: 'clamp(23px,4vw,31px)', fontWeight: 600, margin: '0 0 6px',
            letterSpacing: '-0.02em', lineHeight: 1.15, color: T.ink, textWrap: 'balance',
          }}>
            Asian Games 2026 — Aichi&ndash;Nagoya
          </h1>
          <div style={{ color: T.slate, fontSize: 13.5 }}>
            20&ndash;28 September · SKY HALL TOYOTA · live win probability from the Ball&amp;Run model
          </div>
        </motion.header>

        <motion.div variants={rise} style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(132px,1fr))', gap: 8,
        }}>
          {stats.map(([k, v]) => (
            <div key={k} style={{ ...card, padding: '11px 14px' }}>
              <div style={{ ...labelStyle, fontSize: 10 }}>{k}</div>
              <div style={{ ...nums, fontSize: 19, fontWeight: 600, color: T.ink, marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </motion.div>

        {err && (
          <motion.div variants={rise} style={{
            ...card, padding: '13px 15px', marginTop: 14, borderLeft: `2px solid ${LIVE}`,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 3 }}>Could not load the board</div>
            <div style={{ fontSize: 13, color: T.slate }}>{err}</div>
          </motion.div>
        )}

        <IndiaBoard live={indLive} results={indResults} next={indNext}
                    odds={odds.filter(o => o.org === IND)} />

        <Section title="All matches — live now" note="Refreshes every 20 seconds">
          {loading ? <Empty title="Loading" body="Fetching the current state of play." />
            : live.length ? indiaFirst(live).map(r => <MatchCard key={r.unit_key} row={r} live />)
            : <Empty title="Nothing on the tables right now"
                     body="Play runs roughly 10:00–21:00 Japan time. Singles begin on 23 September; team ties fill 20–22 September." />}
        </Section>

        <Section title="Gold medal odds"
                 note="20,000 simulations of the published draw. Medal % is reaching the semi-final, because the Games awards two bronzes and plays no third-place match.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12 }}>
            {Object.keys(byEvent).sort().map(k => (
              <OddsTable key={k} eventKey={k} rows={byEvent[k].slice(0, 10)} />
            ))}
          </div>
          {!odds.length && !loading && <Empty title="No forecast yet" body="The draw has not been simulated." />}
        </Section>

        <Section title="Schedule" note="Local time in Japan (JST)">
          {Object.keys(days).length === 0
            ? <Empty title="Nothing scheduled in the next 30 hours"
                     body="The table tennis programme runs 20–28 September." />
            : Object.entries(days).map(([d, list]) => (
              <div key={d} style={{ marginBottom: 12 }}>
                <div style={{ ...labelStyle, fontSize: 10, marginBottom: 6 }}>{d} · {list.length} matches</div>
                <div style={{ ...card, overflow: 'hidden' }}>
                  {list.map((u, i) => (
                    <div key={u.unit_key} style={{
                      display: 'grid', gridTemplateColumns: '52px 1fr auto', gap: 10, alignItems: 'center',
                      padding: '8px 13px', fontSize: 13, color: T.ink,
                      borderTop: i ? `1px solid ${T.divider}` : 'none',
                      ...(isIndia(u) ? indiaMark : null),
                    }}>
                      <span style={{ ...nums, fontSize: 12, color: T.slate }}>
                        {new Date(u.start_at).toLocaleTimeString('en-GB',
                          { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })}
                      </span>
                      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                        {u.home_name || u.away_name
                          ? <>{u.home_name || 'TBD'}<span style={{ color: T.muted }}> v </span>{u.away_name || 'TBD'}</>
                          : <span style={{ color: T.slate }}>{u.event_desc}</span>}
                      </span>
                      <span style={{ ...nums, fontSize: 10, color: T.muted, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {[u.round_label, u.loc_desc].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </Section>

        <Section title="All matches — recent results" note="Pre-match probability against what happened">
          {recent.length ? indiaFirst(recent).map(r => <MatchCard key={r.unit_key} row={r} live={false} />)
            : <Empty title="No completed matches scored yet"
                     body="Finished matches appear here with the probability the model gave before the first serve." />}
        </Section>

        <motion.footer variants={rise} style={{
          marginTop: 38, paddingTop: 16, borderTop: `1px solid ${T.border}`,
          fontSize: 12, lineHeight: 1.7, color: T.slate, maxWidth: 720,
        }}>
          <b style={{ color: T.ink, fontWeight: 600 }}>How the numbers are made.</b> Each match is
          scored by a logistic model over 15 difference features — Elo, world ranking, recent form,
          head-to-head, points won, clutch and deuce resilience — trained on 112,449 WTT singles
          matches and retrained on 2026&#8209;09&#8209;20. During play the pre-match figure is updated
          by a two-level Markov chain over games and points.<br /><br />
          <b style={{ color: T.ink, fontWeight: 600 }}>Labels.</b> <i>point</i> — the current
          game&rsquo;s score is known · <i>game</i> — completed games only · <i>prematch</i> — nothing
          played yet · <i>unrated</i> — no matches on the world circuit, modelled as the weakest
          player in the draw.<br /><br />
          <b style={{ color: T.ink, fontWeight: 600 }}>Source.</b> Official Asian Games results
          service, cached about 30 seconds at the edge. <i>Feed lag</i> above is the real age of the
          data, not the time since this page refreshed.
        </motion.footer>
      </motion.div>
    </div>
  )
}
