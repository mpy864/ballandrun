import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'

const card = { background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(15,23,42,0.08)', borderRadius: 14 }

// tennisexplorer gives "Last First" — show "First Last" where safely possible
function pretty(name) {
  const parts = (name || '').trim().split(/\s+/)
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : name
}

export default function TennisView() {
  const [rows, setRows] = useState([])
  const [tour, setTour] = useState('ATP')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let c = false
    ;(async () => {
      const [{ data: rk }, { data: pl }] = await Promise.all([
        supabase.from('tennis_rankings').select('tour, player_id, rank, points').order('rank'),
        supabase.from('tennis_players').select('tour, player_id, name'),
      ])
      const nm = Object.fromEntries((pl || []).map(p => [`${p.tour}|${p.player_id}`, p.name]))
      const merged = (rk || []).map(r => ({ ...r, name: pretty(nm[`${r.tour}|${r.player_id}`] || r.player_id) }))
      if (!c) { setRows(merged); setLoading(false) }
    })()
    return () => { c = true }
  }, [])

  const list = useMemo(() =>
    rows.filter(r => r.tour === tour).filter(r => !q || r.name.toLowerCase().includes(q.toLowerCase())),
    [rows, tour, q])

  if (loading) return <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}>Loading tennis rankings…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ margin: '0 0 2px 2px', fontSize: 11, color: '#94a3b8' }}>
        Indian players ranked on the ATP / WTA tour. Source: tennisexplorer. Match data and readiness scores come next.
      </p>
      <div style={{ ...card, padding: '11px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {['ATP', 'WTA'].map(t => (
          <button key={t} onClick={() => setTour(t)} style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', background: tour === t ? '#0f172a' : '#f1f5f9', color: tour === t ? '#fff' : '#475569' }}>
            {t === 'ATP' ? 'Men (ATP)' : 'Women (WTA)'}
          </button>
        ))}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" style={{ marginLeft: 'auto', fontSize: 12, padding: '6px 10px', borderRadius: 7, border: '1px solid #e2e8f0', outline: 'none' }} />
        <span style={{ fontSize: 11, color: '#94a3b8' }}>{list.length}</span>
      </div>
      <div style={{ ...card, overflow: 'hidden' }}>
        {list.length === 0
          ? <div style={{ padding: '30px 0', textAlign: 'center', color: '#cbd5e1', fontSize: 13 }}>No players.</div>
          : list.map((r, i) => (
              <div key={`${r.tour}-${r.player_id}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px', borderTop: i ? '1px solid #f1f5f9' : 'none' }}>
                <span style={{ width: 52, fontSize: 15, fontWeight: 800, color: '#0f172a' }}>#{r.rank}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>{r.points ?? '—'} pts</span>
              </div>
            ))}
      </div>
    </div>
  )
}
