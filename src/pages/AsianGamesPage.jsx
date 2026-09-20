import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import AuthBar from '../components/AuthBar.jsx'

/**
 * Asian Games 2026 table tennis — public live board.
 *
 * Reads the ag2026_* tables, which migration 032 opened to anonymous readers so
 * this page can be shared by link with no sign-up. Everything else in the
 * database stays closed, so this page must never query a wtt_* table: a
 * logged-out visitor would silently get zero rows and the section would look
 * empty rather than broken.
 *
 * Two competitor colours carry identity throughout (teal = the player on the
 * left, vermilion = the player on the right). They were checked for
 * colour-vision separation rather than picked by eye, and every place they
 * appear also carries a name or a number, so colour is never the only signal.
 */

const NAVY = '#0f2a5e'
const HOME = '#00889B'
const AWAY = '#DB5124'
const LIVE = '#ef4444'

const card = {
  background: 'rgba(255,255,255,0.82)',
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
  border: '1px solid rgba(30,70,160,0.08)',
  borderRadius: 14,
}
const mono = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const label = {
  fontSize: 10, fontWeight: 700, letterSpacing: 2,
  textTransform: 'uppercase', color: 'rgba(15,42,94,0.45)',
}

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

function Pill({ children, tone = 'quiet' }) {
  const tones = {
    live: { background: LIVE, color: '#fff', borderColor: LIVE, fontWeight: 700 },
    quiet: { background: 'transparent', color: 'rgba(15,42,94,0.5)', borderColor: 'rgba(30,70,160,0.18)' },
    dashed: { background: 'transparent', color: 'rgba(15,42,94,0.45)', borderColor: 'rgba(30,70,160,0.25)', borderStyle: 'dashed' },
  }
  return (
    <span style={{
      fontFamily: mono, fontSize: 9.5, letterSpacing: 1.2, textTransform: 'uppercase',
      padding: '2px 7px', borderRadius: 4, borderWidth: 1, borderStyle: 'solid',
      whiteSpace: 'nowrap', ...tones[tone],
    }}>{children}</span>
  )
}

/* The probability bar: the table seen from above, split at the probability,
   with a two-pixel gap standing in for the net. */
function ProbBar({ p }) {
  if (p == null) {
    return <div style={{
      height: 26, borderRadius: 5, marginTop: 12,
      background: 'repeating-linear-gradient(135deg,rgba(15,42,94,0.05),rgba(15,42,94,0.05) 5px,rgba(15,42,94,0.10) 5px,rgba(15,42,94,0.10) 6px)',
    }} />
  }
  const w = Math.max(0, Math.min(100, p * 100))
  return (
    <div style={{ position: 'relative', height: 26, marginTop: 12, borderRadius: 5, overflow: 'hidden', display: 'flex' }}>
      <span style={{ width: `calc(${w}% - 1px)`, background: HOME }} />
      <span style={{ width: 2, background: 'rgba(255,255,255,0.95)', flex: 'none' }} />
      <span style={{ flex: 1, background: AWAY }} />
      <span style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', padding: '0 9px',
        fontFamily: mono, fontSize: 12, fontWeight: 600, color: '#fff',
        fontVariantNumeric: 'tabular-nums', textShadow: '0 1px 2px rgba(0,0,0,0.35)',
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
    <div style={{ ...card, padding: '14px 16px 16px', marginBottom: 10,
                  borderLeft: live ? `3px solid ${LIVE}` : card.border }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ ...label, letterSpacing: 1.4 }}>{genderOf(row.event_key)}</span>
        {row.round_label && <Pill>{row.round_label}</Pill>}
        {live ? <Pill tone="live">● Live</Pill> : <Pill>Final</Pill>}
        {live && row.prob_level && <Pill>{row.prob_level}</Pill>}
        {row.data_age_s != null && (
          <span style={{ marginLeft: 'auto', fontFamily: mono, fontSize: 10.5, color: 'rgba(15,42,94,0.42)' }}>
            {row.data_age_s}s old
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, alignItems: 'end' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: NAVY, lineHeight: 1.2, overflowWrap: 'anywhere' }}>
            {row.comp1_name || 'TBD'}
          </div>
          <div style={{ fontFamily: mono, fontSize: 10.5, color: HOME, letterSpacing: 1 }}>{row.comp1_org || ''}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: mono, fontSize: 23, fontWeight: 700, color: NAVY, fontVariantNumeric: 'tabular-nums' }}>
            {row.games_a ?? 0}<span style={{ opacity: 0.35 }}>:</span>{row.games_b ?? 0}
          </div>
          {playing && (
            <div style={{ fontFamily: mono, fontSize: 12, color: LIVE, fontWeight: 600 }}>
              {playing[0]} : {playing[1]}
            </div>
          )}
        </div>
        <div style={{ minWidth: 0, textAlign: 'right' }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: NAVY, lineHeight: 1.2, overflowWrap: 'anywhere' }}>
            {row.comp2_name || 'TBD'}
          </div>
          <div style={{ fontFamily: mono, fontSize: 10.5, color: AWAY, letterSpacing: 1 }}>{row.comp2_org || ''}</div>
        </div>
      </div>

      <ProbBar p={p} />

      {(games.length > 0 || playing) && (
        <div style={{ display: 'flex', gap: 5, marginTop: 9, flexWrap: 'wrap' }}>
          {games.map(([a, b], i) => (
            <span key={i} style={{
              fontFamily: mono, fontSize: 11, padding: '1px 6px', borderRadius: 3,
              border: `1px solid ${a > b ? HOME : AWAY}`, color: a > b ? HOME : AWAY,
              fontVariantNumeric: 'tabular-nums',
            }}>{a}:{b}</span>
          ))}
          {playing && (
            <span style={{
              fontFamily: mono, fontSize: 11, padding: '1px 6px', borderRadius: 3,
              border: `1px dashed ${LIVE}`, color: LIVE,
            }}>{playing[0]}:{playing[1]}</span>
          )}
        </div>
      )}

      {!live && pre != null && (
        <div style={{ marginTop: 9, fontSize: 12, color: 'rgba(15,42,94,0.55)' }}>
          Pre-match {pre}% · {(pre > 50) === won ? 'favourite won' : 'upset'}
        </div>
      )}
    </div>
  )
}

function Empty({ title, body }) {
  return (
    <div style={{ ...card, padding: '20px 18px', borderStyle: 'dashed' }}>
      <div style={{ fontWeight: 700, color: NAVY, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, color: 'rgba(15,42,94,0.6)' }}>{body}</div>
    </div>
  )
}

function Section({ title, note, children }) {
  return (
    <section style={{ marginTop: 34 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 13, flexWrap: 'wrap' }}>
        <h2 style={{ ...label, fontSize: 11, margin: 0 }}>{title}</h2>
        {note && <span style={{ fontSize: 12, color: 'rgba(15,42,94,0.5)', marginLeft: 'auto' }}>{note}</span>}
      </div>
      {children}
    </section>
  )
}

function OddsTable({ eventKey, rows }) {
  return (
    <div style={{ ...card, padding: '14px 16px 6px', overflowX: 'auto' }}>
      <div style={{ fontWeight: 700, color: NAVY, fontSize: 14, marginBottom: 10 }}>
        {genderOf(eventKey)}&rsquo;s Singles
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {['Player', 'Gold', 'Medal'].map((h, i) => (
              <th key={h} style={{
                ...label, fontSize: 9.5, letterSpacing: 1.4, padding: '0 0 6px',
                textAlign: i ? 'right' : 'left', borderBottom: '1px solid rgba(30,70,160,0.15)',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const t = 100 * Number(r.p_title)
            return (
              <tr key={r.qkey}>
                <td style={{ padding: '7px 0', borderBottom: '1px solid rgba(30,70,160,0.07)', color: NAVY, fontWeight: 500 }}>
                  {r.label}
                  <span style={{ fontFamily: mono, fontSize: 10, color: 'rgba(15,42,94,0.45)', marginLeft: 6 }}>{r.org}</span>
                  {r.is_rated === false && <span style={{ marginLeft: 6 }}><Pill tone="dashed">unrated</Pill></span>}
                </td>
                <td style={{ padding: '7px 0', borderBottom: '1px solid rgba(30,70,160,0.07)', textAlign: 'right',
                             fontFamily: mono, fontVariantNumeric: 'tabular-nums', color: NAVY, minWidth: 74 }}>
                  {t.toFixed(1)}%
                  <div style={{ height: 3, borderRadius: 2, background: HOME, marginTop: 3, marginLeft: 'auto',
                                width: `${Math.max(1, t)}%` }} />
                </td>
                <td style={{ padding: '7px 0', borderBottom: '1px solid rgba(30,70,160,0.07)', textAlign: 'right',
                             fontFamily: mono, fontVariantNumeric: 'tabular-nums', color: 'rgba(15,42,94,0.65)' }}>
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

export default function AsianGamesPage() {
  const [live, setLive] = useState([])
  const [recent, setRecent] = useState([])
  const [odds, setOdds] = useState([])
  const [sched, setSched] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const chanRef = useRef(null)

  async function load() {
    const now = new Date()
    const from = new Date(now.getTime() - 3 * 3600e3).toISOString()
    const to   = new Date(now.getTime() + 30 * 3600e3).toISOString()

    const [l, r, f, s] = await Promise.all([
      supabase.from('ag2026_live_state')
        .select('unit_key,event_key,round_label,comp1_name,comp2_name,comp1_org,comp2_org,games_a,games_b,pts_a,pts_b,best_of,p_win,p_prematch,prob_level,res_detail,data_age_s')
        .eq('status', 'live').order('updated_at', { ascending: false }).limit(24),
      supabase.from('ag2026_live_state')
        .select('unit_key,event_key,round_label,comp1_name,comp2_name,comp1_org,comp2_org,games_a,games_b,p_prematch,res_detail')
        .eq('status', 'finished').not('p_prematch', 'is', null)
        .order('updated_at', { ascending: false }).limit(12),
      supabase.from('ag2026_forecasts')
        .select('event_key,qkey,label,org,p_title,p_medal,is_rated')
        .order('p_title', { ascending: false }),
      supabase.from('ag2026_units')
        .select('unit_key,round_label,event_desc,start_at,loc_desc,home_name,away_name,status')
        .eq('rubber_num', 0).not('start_at', 'is', null)
        .gte('start_at', from).lte('start_at', to)
        .order('start_at').limit(50),
    ])

    const firstErr = [l, r, f, s].find(x => x.error)
    if (firstErr) setErr(firstErr.error.message)
    else setErr(null)

    setLive(l.data || [])
    setRecent(r.data || [])
    setOdds(f.data || [])
    setSched(s.data || [])
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

  const played = recent.length
  const scored = recent.filter(r => Number(r.p_prematch) !== 0.5)
  const hits = scored.filter(r => (Number(r.p_prematch) > 0.5) === (r.games_a > r.games_b))
  const worstLag = live.reduce((m, r) => Math.max(m, r.data_age_s ?? 0), 0)

  const stats = [
    ['Live now', live.length],
    ['Recent scored', played],
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
    <div style={{ minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif', position: 'relative', zIndex: 4 }}>
      <AuthBar />
      <div style={{ maxWidth: 980, margin: '0 auto', padding: '32px 16px 56px' }}>

        <header style={{ ...card, padding: '18px 20px', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9, flexWrap: 'wrap' }}>
            <Pill tone="live">● Live</Pill>
            <span style={{ ...label }}>Table Tennis · Singles &amp; Team</span>
          </div>
          <h1 style={{ color: NAVY, fontSize: 25, fontWeight: 800, margin: '0 0 5px', letterSpacing: -0.5, lineHeight: 1.2 }}>
            Asian Games 2026 — Aichi&ndash;Nagoya
          </h1>
          <div style={{ color: 'rgba(15,42,94,0.62)', fontSize: 13 }}>
            20&ndash;28 September · SKY HALL TOYOTA · win probability from the WTT model
          </div>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginBottom: 4 }}>
          {stats.map(([k, v]) => (
            <div key={k} style={{ ...card, padding: '11px 14px' }}>
              <div style={label}>{k}</div>
              <div style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, color: NAVY, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
            </div>
          ))}
        </div>

        {err && (
          <div style={{ ...card, padding: '14px 16px', marginTop: 16, borderLeft: `3px solid ${LIVE}` }}>
            <div style={{ fontWeight: 700, color: NAVY, marginBottom: 3 }}>Could not load the board</div>
            <div style={{ fontSize: 13, color: 'rgba(15,42,94,0.6)' }}>{err}</div>
          </div>
        )}

        <Section title="Live now" note="Refreshes every 20 seconds">
          {loading ? <Empty title="Loading" body="Fetching the current state of play." />
            : live.length ? live.map(r => <MatchCard key={r.unit_key} row={r} live />)
            : <Empty title="Nothing on the tables right now"
                     body="Play runs roughly 10:00–21:00 Japan time. Singles begin on 23 September; team ties fill 20–22 September." />}
        </Section>

        <Section title="Gold medal odds"
                 note="20,000 simulations · medal % is reaching the semi-final, because the Games awards two bronzes and plays no third-place match">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 14 }}>
            {Object.keys(byEvent).sort().map(k => (
              <OddsTable key={k} eventKey={k} rows={byEvent[k].slice(0, 10)} />
            ))}
          </div>
          {!odds.length && !loading && <Empty title="No forecast yet" body="The draw has not been simulated." />}
        </Section>

        <Section title="Schedule" note="Local time in Japan (JST)">
          {Object.keys(days).length === 0
            ? <Empty title="Nothing scheduled in the next 30 hours" body="The table tennis programme runs 20–28 September." />
            : Object.entries(days).map(([d, list]) => (
              <div key={d} style={{ marginBottom: 14 }}>
                <div style={{ ...label, marginBottom: 7 }}>{d} · {list.length} matches</div>
                <div style={{ ...card, overflow: 'hidden' }}>
                  {list.map((u, i) => (
                    <div key={u.unit_key} style={{
                      display: 'grid', gridTemplateColumns: '54px 1fr auto', gap: 10, alignItems: 'center',
                      padding: '9px 13px', fontSize: 13, color: NAVY,
                      borderTop: i ? '1px solid rgba(30,70,160,0.07)' : 'none',
                    }}>
                      <span style={{ fontFamily: mono, fontSize: 12, color: 'rgba(15,42,94,0.7)' }}>
                        {new Date(u.start_at).toLocaleTimeString('en-GB',
                          { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })}
                      </span>
                      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                        {u.home_name || u.away_name
                          ? <>{u.home_name || 'TBD'}<span style={{ opacity: 0.4 }}> v </span>{u.away_name || 'TBD'}</>
                          : <span style={{ opacity: 0.6 }}>{u.event_desc}</span>}
                      </span>
                      <span style={{ fontFamily: mono, fontSize: 10, color: 'rgba(15,42,94,0.45)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {[u.round_label, u.loc_desc].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </Section>

        <Section title="Recent results" note="Pre-match probability against what happened">
          {recent.length ? recent.map(r => <MatchCard key={r.unit_key} row={r} live={false} />)
            : <Empty title="No completed matches scored yet"
                     body="Finished matches appear here with the probability the model gave before the first serve." />}
        </Section>

        <footer style={{ marginTop: 40, paddingTop: 18, borderTop: '1px solid rgba(30,70,160,0.10)',
                         fontSize: 12, lineHeight: 1.7, color: 'rgba(15,42,94,0.58)' }}>
          <b style={{ color: NAVY }}>How the numbers are made.</b> Each match is scored by a logistic
          model over 15 difference features — Elo, world ranking, recent form, head-to-head, points won,
          clutch and deuce resilience — trained on 112,449 WTT singles matches and retrained on
          2026&#8209;09&#8209;20. During play the pre-match figure is updated by a two-level Markov chain
          over games and points.<br /><br />
          <b style={{ color: NAVY }}>Labels.</b> <i>point</i> — the current game&rsquo;s score is known ·{' '}
          <i>game</i> — completed games only · <i>prematch</i> — nothing played yet ·{' '}
          <i>unrated</i> — no matches on the world circuit, modelled as the weakest player in the draw.<br /><br />
          <b style={{ color: NAVY }}>Source.</b> Official Asian Games results service, cached about 30
          seconds at the edge. <i>Feed lag</i> above is the real age of the data, not the time since this
          page refreshed.
        </footer>
      </div>
    </div>
  )
}
