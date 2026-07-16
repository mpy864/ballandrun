import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'
import { okrLink } from '../lib/okrLink.js'

const card = { background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(15,23,42,0.08)', borderRadius: 14 }

const DISCIPLINES = [
  { code: 'MS', label: 'MS', kind: 'singles', gender: 'M' },
  { code: 'WS', label: 'WS', kind: 'singles', gender: 'W' },
  { code: 'MD', label: 'MD', kind: 'doubles' },
  { code: 'WD', label: 'WD', kind: 'doubles' },
  { code: 'XD', label: 'XD', kind: 'doubles' },
]
const LEVELS = ['Senior', 'U19', 'U17', 'U15', 'U13']

function Move({ diff }) {
  if (diff == null || diff === 0) return null
  const n = Number(diff)
  return n < 0
    ? <span style={{ color: '#22c55e', fontSize: 11, fontWeight: 700 }}>▲{Math.abs(n)}</span>
    : <span style={{ color: '#f87171', fontSize: 11, fontWeight: 700 }}>▼{n}</span>
}

function Row({ r, onClick }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px', borderTop: '1px solid #f1f5f9', cursor: 'pointer' }}>
      <span style={{ width: 46, fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{r.rank ? `#${r.rank}` : '—'}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
      <Move diff={r.rank_change} />
    </div>
  )
}

// ─── Talent — all India players, every discipline and level ─────────────────

export function TalentTab({ onOpen, navigate }) {
  const [indPlayers, setIndPlayers] = useState(null)   // {id: {name,gender}}
  const [disc, setDisc] = useState('MS')
  const [level, setLevel] = useState('Senior')
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  // load India player registry once
  useEffect(() => {
    let c = false
    ;(async () => {
      const { data } = await supabase.from('wtt_players').select('ittf_id, player_name, gender').eq('country_code', 'IND')
      const map = {}; for (const p of data || []) map[p.ittf_id] = { name: p.player_name, gender: p.gender }
      if (!c) setIndPlayers(map)
    })()
    return () => { c = true }
  }, [])

  useEffect(() => {
    if (!indPlayers) return
    const d = DISCIPLINES.find(x => x.code === disc)
    let c = false
    setLoading(true)
    ;(async () => {
      const indIds = Object.keys(indPlayers).map(Number)
      let out = []

      if (level === 'Senior' && d.kind === 'singles') {
        const { data } = await supabase.from('rankings_singles_normalized')
          .select('player_id, rank, rank_change, gender, ranking_date')
          .in('player_id', indIds).eq('gender', d.gender)
          .order('ranking_date', { ascending: false }).limit(1500)
        const latest = {}
        for (const r of data || []) if (!latest[r.player_id]) latest[r.player_id] = r
        out = Object.values(latest).map(r => ({ kind: 'singles', id: r.player_id, label: indPlayers[r.player_id]?.name || `#${r.player_id}`, rank: r.rank, rank_change: r.rank_change }))
          .sort((a, b) => (a.rank || 9999) - (b.rank || 9999))
      }

      else if (level === 'Senior' && d.kind === 'doubles') {
        const idset = new Set(indIds)
        const { data } = await supabase.from('rankings_doubles_teams')
          .select('p1_ittf_id, p2_ittf_id, team_name, current_rank, previous_rank, category, publish_date')
          .eq('category', disc).order('publish_date', { ascending: false }).limit(2500)
        const latestDate = data?.[0]?.publish_date
        out = (data || [])
          .filter(r => r.publish_date === latestDate && (idset.has(r.p1_ittf_id) || idset.has(r.p2_ittf_id)))
          .map(r => ({ kind: 'doubles', ids: [r.p1_ittf_id, r.p2_ittf_id], label: r.team_name, rank: r.current_rank, rank_change: r.previous_rank ? r.previous_rank - r.current_rank : null }))
          .sort((a, b) => (a.rank || 9999) - (b.rank || 9999))
      }

      else if (d.kind === 'singles') {  // youth singles
        const { data } = await supabase.from('youth_rankings_singles')
          .select('ittf_id, player_name, current_rank, rank_diff, sub_event, age_category, publish_date')
          .eq('country_code', 'IND').eq('sub_event', disc).eq('age_category', level)
          .order('publish_date', { ascending: false }).limit(1000)
        const latestDate = data?.[0]?.publish_date
        out = (data || []).filter(r => r.publish_date === latestDate)
          .map(r => ({ kind: 'singles', id: Number(r.ittf_id), label: r.player_name, rank: r.current_rank, rank_change: r.rank_diff }))
          .sort((a, b) => (a.rank || 9999) - (b.rank || 9999))
      }

      else {  // youth doubles
        const { data } = await supabase.from('youth_rankings_doubles')
          .select('ittf_id1, player_name1, ittf_id2, player_name2, current_rank, rank_diff, sub_event, age_category, publish_date')
          .eq('country_code1', 'IND').eq('sub_event', disc).eq('age_category', level)
          .order('publish_date', { ascending: false }).limit(1000)
        const latestDate = data?.[0]?.publish_date
        out = (data || []).filter(r => r.publish_date === latestDate)
          .map(r => ({ kind: 'doubles', ids: [Number(r.ittf_id1), Number(r.ittf_id2)], label: `${r.player_name1} / ${r.player_name2}`, rank: r.current_rank, rank_change: r.rank_diff }))
          .sort((a, b) => (a.rank || 9999) - (b.rank || 9999))
      }

      if (!c) { setRows(out); setLoading(false) }
    })()
    return () => { c = true }
  }, [indPlayers, disc, level])

  // level is 'Senior' or a youth band ('U11'..'U19'); okrLink derives the segment.
  const open = (r) => navigate(okrLink({ level, kind: r.kind, id: r.id, ids: r.ids }))
  const filtered = useMemo(() => rows.filter(r => !q || r.label.toLowerCase().includes(q.toLowerCase())), [rows, q])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* filters */}
      <div style={{ ...card, padding: '12px 16px', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Discipline</span>
          {DISCIPLINES.map(x => (
            <button key={x.code} onClick={() => setDisc(x.code)} style={{ padding: '5px 11px', borderRadius: 7, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', background: disc === x.code ? '#0f172a' : '#f1f5f9', color: disc === x.code ? '#fff' : '#475569' }}>{x.label}</button>
          ))}
        </div>
        <div style={{ width: 1, height: 22, background: '#e2e8f0' }} />
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Level</span>
          {LEVELS.map(l => (
            <button key={l} onClick={() => setLevel(l)} style={{ padding: '5px 11px', borderRadius: 7, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', background: level === l ? '#0f172a' : '#f1f5f9', color: level === l ? '#fff' : '#475569' }}>{l}</button>
          ))}
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" style={{ marginLeft: 'auto', fontSize: 12, padding: '6px 10px', borderRadius: 7, border: '1px solid #e2e8f0', outline: 'none' }} />
      </div>

      {/* list */}
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ padding: '11px 16px', display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8' }}>
          <span>{disc} · {level}</span><span>{filtered.length}</span>
        </div>
        {loading ? <div style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8' }}>Loading…</div>
          : filtered.length === 0 ? <div style={{ padding: '30px 0', textAlign: 'center', color: '#cbd5e1', fontSize: 13, borderTop: '1px solid #f1f5f9' }}>No players for {disc} · {level}.</div>
          : filtered.slice(0, 150).map((r, i) => <Row key={i} r={r} onClick={() => open(r)} />)}
      </div>
    </div>
  )
}

// ─── Events ───────────────────────────────────────────────────────────────────

export function EventsTab({ navigate }) {
  const [byEvent, setByEvent] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let c = false
    ;(async () => {
      const { data: fc } = await supabase.from('wtt_forecasts').select('event_id, sub_event, label, p_title').order('p_title', { ascending: false })
      const evIds = [...new Set((fc || []).map(f => f.event_id))]
      const { data: evs } = await supabase.from('wtt_events').select('event_id, event_name').in('event_id', evIds.length ? evIds : [0])
      const evMap = Object.fromEntries((evs || []).map(e => [e.event_id, e]))
      const groups = {}
      for (const f of fc || []) {
        const k = `${f.event_id}|${f.sub_event}`
        if (!groups[k]) groups[k] = { key: k, event: evMap[f.event_id], sub_event: f.sub_event, top: [] }
        if (groups[k].top.length < 5) groups[k].top.push(f)
      }
      if (!c) { setByEvent(Object.values(groups)); setLoading(false) }
    })()
    return () => { c = true }
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
        <div key={g.key} style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: 13, fontWeight: 900, color: '#0f172a' }}>{g.event?.event_name || `Event ${g.key}`}</div>
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
      <button onClick={() => navigate('/forecast')} style={{ alignSelf: 'center', fontSize: 12, fontWeight: 700, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}>Open full forecast page →</button>
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
    let c = false
    ;(async () => {
      const { data: pl } = await supabase.from('wtt_players').select('ittf_id, player_name').eq('country_code', 'IND')
      const ids = (pl || []).map(p => p.ittf_id)
      const { data: ranks } = await supabase.from('rankings_singles_normalized').select('player_id, rank, ranking_date').in('player_id', ids).order('ranking_date', { ascending: false }).limit(2000)
      const seen = {}; for (const p of pl || []) seen[p.ittf_id] = { id: p.ittf_id, name: p.player_name }
      for (const r of ranks || []) if (seen[r.player_id] && seen[r.player_id].rank == null) seen[r.player_id].rank = r.rank
      const list = Object.values(seen).filter(v => v.rank != null).sort((x, y) => x.rank - y.rank)
      if (!c) setPlayers(list)
    })()
    return () => { c = true }
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{sel(a, setA)}{sel(b, setB)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}><Col k="a" /><Col k="b" /></div>
      <button onClick={() => navigate('/h2h')} style={{ alignSelf: 'center', fontSize: 12, fontWeight: 700, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}>Full head-to-head (match history) →</button>
    </div>
  )
}
