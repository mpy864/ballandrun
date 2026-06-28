import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// ── helpers ──────────────────────────────────────────────────────────────────
const TODAY = new Date().toISOString().slice(0, 10)

function classify(ev) {
  if (ev.end_date && TODAY > ev.end_date) return 'past'
  if (ev.start_date && TODAY < ev.start_date) return 'upcoming'
  return 'live'
}

const STATUS = {
  live:     { label: 'LIVE',     color: '#ef4444', tint: 'rgba(239,68,68,0.10)' },
  upcoming: { label: 'UPCOMING', color: '#1e46a0', tint: 'rgba(30,70,160,0.10)' },
  past:     { label: 'FINAL',    color: '#64748b', tint: 'rgba(100,116,139,0.12)' },
}

const fmtDate = (d) => d ? new Date(d).toLocaleDateString(undefined,
  { day: 'numeric', month: 'short' }) : ''
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`)
const REACH_COLS = ['R16', 'QF', 'SF', 'F']
const MEDAL = ['🥇', '🥈', '🥉']

// ── component ────────────────────────────────────────────────────────────────
export default function ForecastPage() {
  const [events, setEvents] = useState([])        // [{event_id, name, status, ...subs}]
  const [eventId, setEventId] = useState(null)
  const [sub, setSub] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  // 1) which events/sub-events have forecasts + their metadata
  useEffect(() => {
    (async () => {
      const { data: fc } = await supabase
        .from('wtt_forecasts').select('event_id, sub_event')
      const subsByEvent = {}
      for (const r of fc || []) {
        (subsByEvent[r.event_id] ||= new Set()).add(r.sub_event)
      }
      const ids = Object.keys(subsByEvent).map(Number)
      if (!ids.length) { setLoading(false); return }
      const { data: meta } = await supabase
        .from('wtt_events')
        .select('event_id, event_name, event_type, country, start_date, end_date')
        .in('event_id', ids)
      const metaById = Object.fromEntries((meta || []).map(m => [m.event_id, m]))
      const list = ids.map(id => {
        const m = metaById[id] || { event_id: id, event_name: `Event ${id}` }
        return { ...m, status: classify(m), subs: [...subsByEvent[id]].sort() }
      })
      const order = { live: 0, upcoming: 1, past: 2 }
      list.sort((a, b) => order[a.status] - order[b.status] ||
        (b.start_date || '').localeCompare(a.start_date || ''))
      setEvents(list)
      const first = list[0]
      setEventId(first.event_id)
      setSub(first.subs.includes("Men's Singles") ? "Men's Singles" : first.subs[0])
      setLoading(false)
    })()
  }, [])

  // 2) rows for the current event + sub-event
  useEffect(() => {
    if (!eventId || !sub) return
    (async () => {
      const { data } = await supabase.from('wtt_forecasts').select('*')
        .eq('event_id', eventId).eq('sub_event', sub)
        .order('p_title', { ascending: false })
      setRows(data || [])
    })()
  }, [eventId, sub])

  const ev = useMemo(() => events.find(e => e.event_id === eventId), [events, eventId])
  const grouped = useMemo(() => {
    const g = { live: [], upcoming: [], past: [] }
    for (const e of events) g[e.status].push(e)
    return g
  }, [events])

  const card = {
    background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(22px)',
    WebkitBackdropFilter: 'blur(22px)',
    border: '1px solid rgba(30,70,160,0.10)', borderRadius: 14,
    boxShadow: '0 8px 30px rgba(15,42,94,0.16)',
  }

  if (loading) return <Shell><div style={{ color: '#0f2a5e' }}>Loading…</div></Shell>
  if (!events.length) return (
    <Shell><div style={{ color: 'rgba(15,42,94,0.6)' }}>
      No forecasts yet. Run <code>scripts/run_forecasts.py</code> to populate.
    </div></Shell>
  )

  const st = STATUS[ev?.status || 'upcoming']

  return (
    <Shell>
      {/* header card */}
      <div style={{ ...card, padding: '18px 20px', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <Badge status={ev?.status} />
          <span style={{ color: 'rgba(15,42,94,0.55)', fontSize: 11, fontWeight: 700,
                         letterSpacing: 2, textTransform: 'uppercase' }}>
            Tournament Forecast
          </span>
        </div>
        <h1 style={{ color: '#0f2a5e', fontSize: 24, fontWeight: 800, margin: '0 0 4px' }}>
          {ev?.event_name}
        </h1>
        <div style={{ color: 'rgba(15,42,94,0.6)', fontSize: 13 }}>
          {ev?.event_type ? `${ev.event_type} · ` : ''}{ev?.country ? `${ev.country} · ` : ''}
          {fmtDate(ev?.start_date)} – {fmtDate(ev?.end_date)}
        </div>

        {/* event selector grouped by status */}
        <select
          value={eventId} onChange={(e) => {
            const id = Number(e.target.value)
            const next = events.find(x => x.event_id === id)
            setEventId(id)
            setSub(next.subs.includes("Men's Singles") ? "Men's Singles" : next.subs[0])
          }}
          style={{ marginTop: 14, padding: '8px 10px', borderRadius: 8,
                   border: '1px solid rgba(30,70,160,0.2)', fontSize: 14, width: '100%',
                   maxWidth: 460, background: '#fff', color: '#0f2a5e' }}
        >
          {['live', 'upcoming', 'past'].map(group =>
            grouped[group].length ? (
              <optgroup key={group} label={STATUS[group].label}>
                {grouped[group].map(e => (
                  <option key={e.event_id} value={e.event_id}>
                    {e.event_name} · {fmtDate(e.start_date)}
                  </option>
                ))}
              </optgroup>
            ) : null
          )}
        </select>

        {/* sub-event tabs */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {(ev?.subs || []).map(s => (
            <button key={s} onClick={() => setSub(s)}
              style={{
                padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 600,
                cursor: 'pointer', border: '1px solid rgba(30,70,160,0.18)',
                background: s === sub ? '#1e46a0' : '#fff',
                color: s === sub ? '#fff' : '#1e46a0',
              }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* table card */}
      <div style={{ ...card, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ color: 'rgba(15,42,94,0.6)' }}>
              <th style={{ textAlign: 'left', padding: '11px 14px' }}>#</th>
              <th style={{ textAlign: 'left', padding: '11px 14px' }}>Player</th>
              <th style={{ textAlign: 'left', padding: '11px 14px', width: '34%' }}>Title chance</th>
              {REACH_COLS.map(c => (
                <th key={c} style={{ textAlign: 'right', padding: '11px 14px' }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.qkey} style={{
                borderTop: '1px solid rgba(30,70,160,0.06)',
                background: i % 2 ? 'rgba(30,70,160,0.02)' : 'transparent',
              }}>
                <td style={{ padding: '9px 14px', color: 'rgba(15,42,94,0.5)' }}>
                  {MEDAL[i] || i + 1}
                </td>
                <td style={{ padding: '9px 14px', color: '#0f2a5e', fontWeight: 600 }}>
                  {r.seed ? <span style={{ color: 'rgba(15,42,94,0.4)' }}>[{r.seed}] </span> : null}
                  {r.label}
                </td>
                <td style={{ padding: '9px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 8, borderRadius: 4,
                                  background: 'rgba(30,70,160,0.08)', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(2, r.p_title * 100)}%`, height: '100%',
                                    background: i === 0 ? '#1e46a0' : 'rgba(30,70,160,0.55)' }} />
                    </div>
                    <span style={{ width: 48, textAlign: 'right', fontWeight: 800,
                                   color: '#1e46a0' }}>{pct(r.p_title)}</span>
                  </div>
                </td>
                {REACH_COLS.map(c => (
                  <td key={c} style={{ padding: '9px 14px', textAlign: 'right',
                                       color: 'rgba(15,42,94,0.7)' }}>{pct(r.reach?.[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: '10px 14px', fontSize: 11.5, color: 'rgba(15,42,94,0.5)' }}>
          {ev?.status === 'past'
            ? 'Pre-tournament prediction (final snapshot).'
            : 'Provisional — updates as the draw firms up and results come in.'}
          {rows[0]?.runs ? ` · ${rows[0].runs.toLocaleString()} simulations` : ''}
        </div>
      </div>
    </Shell>
  )
}

// ── small bits ───────────────────────────────────────────────────────────────
function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <style>{`@keyframes live-pulse {0%,100%{opacity:1}50%{opacity:0.25}}`}</style>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '36px 16px 48px' }}>
        {children}
      </div>
    </div>
  )
}

function Badge({ status }) {
  const s = STATUS[status || 'upcoming']
  return (
    <span style={{
      background: s.color, color: '#fff', fontSize: 10, fontWeight: 800,
      letterSpacing: 1.6, padding: '3px 9px', borderRadius: 4,
      display: 'inline-flex', alignItems: 'center', gap: 5,
    }}>
      {status === 'live' && (
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff',
                       animation: 'live-pulse 1.4s ease-in-out infinite' }} />
      )}
      {s.label}
    </span>
  )
}
