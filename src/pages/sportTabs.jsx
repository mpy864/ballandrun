import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'

// Shared card style
const card = { background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(15,23,42,0.08)', borderRadius: 14 }

function Move({ diff }) {
  if (diff == null || diff === 0) return null
  const n = Number(diff)
  return n < 0
    ? <span style={{ color: '#22c55e', fontSize: 11, fontWeight: 700 }}>▲{Math.abs(n)}</span>
    : <span style={{ color: '#f87171', fontSize: 11, fontWeight: 700 }}>▼{n}</span>
}

function Row({ p, onOpen }) {
  return (
    <div onClick={() => onOpen(p.id)} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px',
      borderTop: '1px solid #f1f5f9', cursor: 'pointer',
    }}>
      <span style={{ width: 46, fontSize: 15, fontWeight: 800, color: '#0f172a' }}>#{p.rank}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
      <Move diff={p.rank_change} />
      <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 99, background: p.gender === 'M' ? '#eff6ff' : '#fdf2f8', color: p.gender === 'M' ? '#2563eb' : '#db2777' }}>
        {p.gender === 'M' ? 'MS' : 'WS'}
      </span>
    </div>
  )
}

// ─── Talent ───────────────────────────────────────────────────────────────────

export function TalentTab({ onOpen }) {
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [g, setG] = useState('all')
  const [q, setQ] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: pl } = await supabase.from('wtt_players').select('ittf_id, player_name, gender').eq('country_code', 'IND')
      const ids = (pl || []).map(p => p.ittf_id)
      const nameMap = Object.fromEntries((pl || []).map(p => [p.ittf_id, p.player_name]))
      const { data: ranks } = await supabase.from('rankings_singles_normalized')
        .select('player_id, rank, rank_change, gender, ranking_date')
        .in('player_id', ids).order('ranking_date', { ascending: false }).limit(2000)
      const latest = {}
      for (const r of ranks || []) {
        if (!latest[r.player_id]) latest[r.player_id] = { id: r.player_id, name: nameMap[r.player_id] || `#${r.player_id}`, rank: r.rank, rank_change: r.rank_change, gender: r.gender }
      }
      if (!cancelled) { setPlayers(Object.values(latest).sort((a, b) => a.rank - b.rank)); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => players
    .filter(p => g === 'all' || p.gender === g)
    .filter(p => !q || p.name.toLowerCase().includes(q.toLowerCase())), [players, g, q])

  const rising = useMemo(() => players.filter(p => (p.rank_change ?? 0) <= -10).sort((a, b) => a.rank_change - b.rank_change).slice(0, 6), [players])

  if (loading) return <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}>Loading India players…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {rising.length > 0 && (
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '11px 16px', fontSize: 13, fontWeight: 900, color: '#15803d' }}>Rising into contention</div>
          {rising.map(p => <Row key={p.id} p={p} onOpen={onOpen} />)}
        </div>
      )}
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '11px 16px', flexWrap: 'wrap' }}>
          {['all', 'M', 'W'].map(x => (
            <button key={x} onClick={() => setG(x)} style={{
              padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer',
              background: g === x ? '#0f172a' : '#f1f5f9', color: g === x ? '#fff' : '#475569',
            }}>{x === 'all' ? 'All' : x === 'M' ? 'Men' : 'Women'}</button>
          ))}
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search player…" style={{
            marginLeft: 'auto', fontSize: 12, padding: '6px 10px', borderRadius: 7, border: '1px solid #e2e8f0', outline: 'none',
          }} />
          <span style={{ fontSize: 11, color: '#94a3b8' }}>{filtered.length}</span>
        </div>
        {filtered.slice(0, 100).map(p => <Row key={p.id} p={p} onOpen={onOpen} />)}
      </div>
    </div>
  )
}

// ─── Events ───────────────────────────────────────────────────────────────────

export function EventsTab({ onOpen, navigate }) {
  const [byEvent, setByEvent] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: fc } = await supabase.from('wtt_forecasts').select('event_id, sub_event, label, qkey, p_title').order('p_title', { ascending: false })
      const evIds = [...new Set((fc || []).map(f => f.event_id))]
      const { data: evs } = await supabase.from('wtt_events').select('event_id, event_name, start_date, end_date').in('event_id', evIds.length ? evIds : [0])
      const evMap = Object.fromEntries((evs || []).map(e => [e.event_id, e]))
      const groups = {}
      for (const f of fc || []) {
        const k = `${f.event_id}|${f.sub_event}`
        if (!groups[k]) groups[k] = { event_id: f.event_id, sub_event: f.sub_event, event: evMap[f.event_id], top: [] }
        if (groups[k].top.length < 5) groups[k].top.push(f)
      }
      if (!cancelled) { setByEvent(Object.values(groups)); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}>Loading events…</div>
  if (!byEvent.length) return (
    <div style={{ ...card, padding: '40px 20px', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
      No forecasts yet. <button onClick={() => navigate('/forecast')} style={{ color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}>Open full forecast page →</button>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {byEvent.map(g => (
        <div key={`${g.event_id}-${g.sub_event}`} style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: 13, fontWeight: 900, color: '#0f172a' }}>{g.event?.event_name || `Event ${g.event_id}`}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>{g.sub_event} · title odds</div>
          </div>
          {g.top.map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderTop: i ? '1px solid #f1f5f9' : 'none' }}>
              <span style={{ flex: 1, fontSize: 13, color: '#0f172a' }}>{t.label}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>{Math.round(Number(t.p_title) * 100)}%</span>
            </div>
          ))}
        </div>
      ))}
      <button onClick={() => navigate('/forecast')} style={{ alignSelf: 'center', fontSize: 12, fontWeight: 700, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}>
        Open full forecast page →
      </button>
    </div>
  )
}

// ─── Compare ──────────────────────────────────────────────────────────────────

export function CompareTab({ navigate }) {
  const [players, setPlayers] = useState([])
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [rows, setRows] = useState({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: pl } = await supabase.from('wtt_players').select('ittf_id, player_name').eq('country_code', 'IND')
      const ids = (pl || []).map(p => p.ittf_id)
      const { data: ranks } = await supabase.from('rankings_singles_normalized').select('player_id, rank, ranking_date').in('player_id', ids).order('ranking_date', { ascending: false }).limit(2000)
      const seen = {}
      const list = []
      for (const p of pl || []) seen[p.ittf_id] = { id: p.ittf_id, name: p.player_name }
      for (const r of ranks || []) if (seen[r.player_id] && seen[r.player_id].rank == null) seen[r.player_id].rank = r.rank
      for (const v of Object.values(seen)) if (v.rank != null) list.push(v)
      list.sort((x, y) => x.rank - y.rank)
      if (!cancelled) setPlayers(list)
    }
    load()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    async function score(id, key) {
      if (!id) return setRows(r => ({ ...r, [key]: null }))
      const { data } = await supabase.rpc('podium_readiness', { p_ids: [Number(id)] })
      setRows(r => ({ ...r, [key]: data?.[0] || null }))
    }
    score(a, 'a'); score(b, 'b')
  }, [a, b])

  const sel = (val, set) => (
    <select value={val} onChange={e => set(e.target.value)} style={{ width: '100%', fontSize: 13, padding: '9px 10px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
      <option value="">Select player…</option>
      {players.map(p => <option key={p.id} value={p.id}>{p.name} · #{p.rank}</option>)}
    </select>
  )

  const Col = ({ k }) => {
    const s = rows[k]
    return (
      <div style={{ ...card, padding: 16, textAlign: 'center' }}>
        {!s ? <div style={{ color: '#cbd5e1', fontSize: 12, padding: '20px 0' }}>—</div> : (
          <>
            <div style={{ fontSize: 30, fontWeight: 900, color: '#0f172a' }}>{s.score}</div>
            <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Readiness</div>
            <div style={{ marginTop: 10, fontSize: 12, color: '#475569' }}>World #{s.world_rank} · Age {s.age ?? '—'}</div>
          </>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {sel(a, setA)}{sel(b, setB)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Col k="a" /><Col k="b" />
      </div>
      <button onClick={() => navigate('/h2h')} style={{ alignSelf: 'center', fontSize: 12, fontWeight: 700, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}>
        Full head-to-head (match history) →
      </button>
    </div>
  )
}
