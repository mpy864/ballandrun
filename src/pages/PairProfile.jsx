import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import AuthBar from '../components/AuthBar.jsx'
import PageBackground from '../components/PageBackground.jsx'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const DISC = { MD: "Men's Doubles", WD: "Women's Doubles", XD: "Mixed Doubles" }
const card = { background: 'rgba(255,255,255,0.92)', border: '1px solid rgba(15,23,42,0.08)', borderRadius: 14 }

export default function PairProfile() {
  const { pair } = useParams()
  const [a, b] = (pair || '').split('_').map(Number)

  const [names, setNames] = useState({})
  const [rankRows, setRankRows] = useState([])
  const [score, setScore] = useState(null)
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: pl } = await supabase.from('wtt_players').select('ittf_id, player_name, country_code').in('ittf_id', [a, b])
      const nm = Object.fromEntries((pl || []).map(p => [p.ittf_id, p]))

      const { data: rk } = await supabase.from('rankings_doubles_teams')
        .select('current_rank, previous_rank, points, category, publish_date')
        .or(`and(p1_ittf_id.eq.${a},p2_ittf_id.eq.${b}),and(p1_ittf_id.eq.${b},p2_ittf_id.eq.${a})`)
        .order('publish_date', { ascending: true })

      const { data: sc } = await supabase.rpc('podium_readiness_pair', { p_id1: a, p_id2: b })

      const { data: dm } = await supabase.from('wtt_matches_doubles')
        .select('match_id, comp1_p1_id, comp1_p2_id, comp2_p1_id, comp2_p2_id, result, match_score, game_scores, event_date, round_phase, event_category')
        .or(`comp1_p1_id.eq.${a},comp1_p2_id.eq.${a},comp2_p1_id.eq.${a},comp2_p2_id.eq.${a}`)
        .order('event_date', { ascending: false }).limit(50)
      const together = (dm || []).filter(m =>
        ([m.comp1_p1_id, m.comp1_p2_id].includes(a) && [m.comp1_p1_id, m.comp1_p2_id].includes(b)) ||
        ([m.comp2_p1_id, m.comp2_p2_id].includes(a) && [m.comp2_p1_id, m.comp2_p2_id].includes(b)))

      if (!cancelled) { setNames(nm); setRankRows(rk || []); setScore(sc?.[0] || null); setMatches(together); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [pair])

  const latest = rankRows[rankRows.length - 1]
  const disc = DISC[score?.category || latest?.category] || 'Doubles'
  const nameStr = [names[a]?.player_name, names[b]?.player_name].filter(Boolean).join(' / ') || `${a} / ${b}`
  const country = names[a]?.country_code || ''
  const chart = rankRows.filter(r => r.current_rank != null).map(r => ({ d: r.publish_date, rank: r.current_rank }))

  return (
    <>
      <PageBackground />
      <div style={{ position: 'relative', zIndex: 4, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <AuthBar />
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '22px 16px 56px' }}>
          <button onClick={() => window.history.back()} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginBottom: 12 }}>← Back</button>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '80px 0', color: '#94a3b8' }}>Loading pair…</div>
          ) : (
            <>
              {/* Header */}
              <div style={{ ...card, padding: '18px 22px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#8b5cf6', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{disc}{country ? ` · ${country}` : ''}</div>
                  <h1 style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 900, color: '#0f172a' }}>{nameStr}</h1>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>World rank</div>
                  <div style={{ fontSize: 26, fontWeight: 900, color: '#0f172a' }}>{latest?.current_rank ? `#${latest.current_rank}` : '—'}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Readiness</div>
                  <div style={{ fontSize: 26, fontWeight: 900, color: '#0f172a' }}>{score ? score.score : '—'}</div>
                </div>
              </div>

              {/* Readiness breakdown */}
              {score && (
                <div style={{ ...card, padding: '14px 20px', marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 900, color: '#0f172a', marginBottom: 10 }}>Podium-Readiness {score.score}/100</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
                    {[['Pair rank', score.rank_pts, 55], ['Trajectory', score.traj_pts, 25], ['Runway (age)', score.runway_pts, 20]].map(([lbl, v, max]) => (
                      <div key={lbl}>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{lbl}</div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{v}<span style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 600 }}>/{max}</span></div>
                      </div>
                    ))}
                    <div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>Avg age</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{score.avg_age ?? '—'}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Ranking trend */}
              {chart.length > 1 && (
                <div style={{ ...card, padding: '14px 20px 6px', marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 900, color: '#0f172a', marginBottom: 8 }}>Pair ranking trend</div>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={chart} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                      <XAxis dataKey="d" tick={{ fontSize: 10, fill: '#94a3b8' }} minTickGap={40} />
                      <YAxis reversed domain={['dataMin', 'dataMax']} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="rank" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Doubles matches */}
              <div style={{ ...card, overflow: 'hidden' }}>
                <div style={{ padding: '13px 18px', borderBottom: '1px solid #f1f5f9', fontSize: 13, fontWeight: 900, color: '#0f172a' }}>
                  Doubles results together
                </div>
                {matches.length === 0
                  ? <div style={{ padding: '30px 20px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No doubles matches yet. Filling after the next data sync.</div>
                  : matches.map(m => {
                      const onC1 = [m.comp1_p1_id, m.comp1_p2_id].includes(a)
                      const res = onC1 ? m.result : (m.result === 'W' ? 'L' : 'W')
                      return (
                        <div key={m.match_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 18px', borderTop: '1px solid #f1f5f9' }}>
                          <span style={{ width: 20, fontWeight: 800, color: res === 'W' ? '#16a34a' : '#f87171' }}>{res}</span>
                          <span style={{ flex: 1, fontSize: 12, color: '#475569' }}>{m.round_phase || m.event_category || ''}</span>
                          <span style={{ fontSize: 12, color: '#64748b' }}>{m.match_score}</span>
                          <span style={{ fontSize: 11, color: '#94a3b8' }}>{m.event_date || ''}</span>
                        </div>
                      )
                    })}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
