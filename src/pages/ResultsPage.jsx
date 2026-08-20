import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { card, chip, T } from '../lib/ui.js'
import { loadResultEvents, loadEventResults } from '../lib/results.js'
import { gamesFor, hasScore } from '../lib/matchFormat.js'

const WIN = '#12a150'
const LOSS = '#dc2626'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtDate = d => {
  if (!d) return ''
  const [y, m, day] = String(d).split('-').map(Number)
  return `${day} ${MON[(m || 1) - 1]} ${String(y).slice(2)}`
}
const cleanName = n => (n || '').replace(/\s+presented\s+by\s+.*/i, '').replace(/\s+20\d\d$/, '')

// ─── One match ────────────────────────────────────────────────────────────────

function MatchRow({ m, onOpen }) {
  const games = gamesFor(m)
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 54px 1fr 150px', alignItems: 'baseline',
      gap: 12, padding: '7px 22px', borderTop: `1px solid ${T.divider}`,
    }}>
      <span
        onClick={() => m.ind_p1_id && m.kind === 'singles' && onOpen(m.ind_p1_id)}
        style={{
          fontSize: 13, fontWeight: 600, color: T.ink,
          cursor: m.kind === 'singles' && m.ind_p1_id ? 'pointer' : 'default',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{m.ind_name}</span>

      <span className="tabnum" style={{
        fontSize: 13, fontWeight: 800, textAlign: 'center',
        color: hasScore(m) ? (m.won ? WIN : LOSS) : T.muted,
      }}>{hasScore(m) ? m.score : '—'}</span>

      <span style={{ fontSize: 13, color: T.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {m.opp_name}
        {m.opp_country && (
          <span style={{ fontSize: 10.5, color: T.muted, marginLeft: 6 }}>{m.opp_country}</span>
        )}
      </span>

      <span className="tabnum" style={{ fontSize: 11, color: T.muted, textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {games}
      </span>
    </div>
  )
}

// ─── One discipline within a tournament ──────────────────────────────────────

function DisciplineBlock({ d, onOpen }) {
  return (
    <div style={{ ...card, overflow: 'hidden', marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '13px 22px', borderBottom: `1px solid ${T.divider}` }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>{d.discipline}</span>
        <span style={{ fontSize: 12.5, color: T.muted }}>
          {d.won}–{d.played - d.won}
        </span>
      </div>

      {d.rounds.map(r => (
        <div key={r.round}>
          <div style={{
            padding: '8px 22px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em',
            textTransform: 'uppercase', color: T.muted, background: 'rgba(0,0,0,0.015)',
          }}>{r.round}</div>
          {r.matches.map(m => <MatchRow key={m.match_id} m={m} onOpen={onOpen} />)}
        </div>
      ))}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ResultsPage() {
  const navigate = useNavigate()
  const [events, setEvents] = useState(null)
  const [selected, setSelected] = useState(null)
  const [groups, setGroups] = useState(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    let c = false
    ;(async () => {
      const evs = await loadResultEvents(60)
      if (c) return
      setEvents(evs)
      if (evs.length) setSelected(evs[0])      // newest tournament by default
    })()
    return () => { c = true }
  }, [])

  useEffect(() => {
    if (!selected) return
    let c = false
    setGroups(null)
    ;(async () => {
      const g = await loadEventResults(selected.event_id)
      if (!c) setGroups(g)
    })()
    return () => { c = true }
  }, [selected?.event_id])

  const filtered = useMemo(
    () => (events || []).filter(e => !q || cleanName(e.event_name).toLowerCase().includes(q.toLowerCase())),
    [events, q])

  const openPlayer = id => navigate(`/player/${id}`)

  return (
    <div style={{ maxWidth: 'var(--tops-wide)', margin: '0 auto', padding: '28px 40px 56px' }}>
      <div style={{ marginBottom: 22 }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 10, fontWeight: 700, color: T.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          ← TOPS Intelligence
        </button>
        <h1 style={{ margin: '4px 0 0', fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', color: T.ink }}>Results</h1>
        <p style={{ margin: '6px 0 0', fontSize: 13.5, color: T.muted }}>
          Every Indian result in a tournament, by discipline and round.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 300px) minmax(0, 1fr)', gap: 22, alignItems: 'start' }}>

        {/* tournament picker */}
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', borderBottom: `1px solid ${T.divider}` }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search tournaments…"
              style={{ width: '100%', fontSize: 12.5, padding: '7px 10px', borderRadius: 7, border: `1px solid ${T.border}`, outline: 'none', background: 'transparent', color: T.ink }} />
          </div>
          {events === null
            ? <div style={{ padding: 22, fontSize: 13, color: T.muted }}>Loading…</div>
            : filtered.length === 0
              ? <div style={{ padding: 22, fontSize: 13, color: T.muted }}>No tournaments found.</div>
              : <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                  {filtered.map(e => {
                    const on = selected?.event_id === e.event_id
                    return (
                      <button key={e.event_id} onClick={() => setSelected(e)}
                        onMouseEnter={ev => { if (!on) ev.currentTarget.style.background = 'rgba(0,0,0,0.022)' }}
                        onMouseLeave={ev => { if (!on) ev.currentTarget.style.background = 'transparent' }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                          padding: '10px 18px', borderTop: `1px solid ${T.divider}`,
                          background: on ? 'rgba(0,0,0,0.045)' : 'transparent',
                        }}>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: on ? 650 : 550, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {cleanName(e.event_name)}
                        </span>
                        <span style={{ fontSize: 11.5, color: T.muted }}>
                          {fmtDate(e.last_date)} · <b style={{ color: T.slate, fontWeight: 700 }}>{e.wins}–{e.losses}</b> · {e.athletes} athlete{e.athletes === 1 ? '' : 's'}
                        </span>
                      </button>
                    )
                  })}
                </div>}
        </div>

        {/* results for the selected tournament */}
        <div>
          {!selected
            ? <div style={{ ...card, padding: 40, textAlign: 'center', color: T.muted, fontSize: 13 }}>Select a tournament.</div>
            : (
              <>
                <div style={{ ...card, padding: '16px 22px', borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: 17, fontWeight: 600, color: T.ink }}>{cleanName(selected.event_name)}</div>
                  <div style={{ fontSize: 12.5, color: T.muted, marginTop: 3 }}>
                    {fmtDate(selected.first_date)}
                    {selected.first_date !== selected.last_date ? ` – ${fmtDate(selected.last_date)}` : ''}
                    {' · '}<b style={{ color: T.slate, fontWeight: 700 }}>{selected.wins}–{selected.losses}</b>
                    {' · '}{selected.matches} match{selected.matches === 1 ? '' : 'es'}
                    {' · '}{selected.athletes} athlete{selected.athletes === 1 ? '' : 's'}
                    {selected.all_indian_matches > 0 && (
                      <span style={{ marginLeft: 8 }}>
                        <span style={chip('#6e6e73', { fontSize: 9.5 })}>
                          {selected.all_indian_matches} all-Indian
                        </span>
                      </span>
                    )}
                  </div>
                </div>

                {groups === null
                  ? <div style={{ ...card, padding: 40, textAlign: 'center', color: T.muted, fontSize: 13 }}>Loading results…</div>
                  : groups.length === 0
                    ? <div style={{ ...card, padding: 40, textAlign: 'center', color: T.muted, fontSize: 13 }}>No results recorded.</div>
                    : groups.map(d => <DisciplineBlock key={d.discipline} d={d} onOpen={openPlayer} />)}
              </>
            )}
        </div>
      </div>
    </div>
  )
}
