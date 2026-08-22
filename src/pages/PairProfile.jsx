import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import AuthBar from '../components/AuthBar.jsx'
import PageBackground from '../components/PageBackground.jsx'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const DISC = { MD: "Men's Doubles", WD: "Women's Doubles", XD: "Mixed Doubles" }
const card = { background: 'rgba(255,255,255,0.92)', border: '1px solid rgba(15,23,42,0.08)', borderRadius: 14 }
const ROUND_ORDER = ['Final', 'Semifinal', 'Quarterfinal', 'Round of 16', 'Round of 32', 'Round of 64', 'Qualifying Round 1', 'Qualifying Round 2', 'Group']

// ─── Metrics from the pair's matches (mirrors the singles Performance tab) ───
function computeMetrics(ms) {
  if (!ms.length) return null
  let wins = 0, straightW = 0, straightL = 0, comebackW = 0, decN = 0, decW = 0, deuceN = 0, deuceW = 0
  const rounds = {}
  for (const m of ms) {
    const [c1g, c2g] = (m.match_score || '').split('-').map(Number)
    const pg = m.on_c1 ? c1g : c2g
    const og = m.on_c1 ? c2g : c1g
    const win = m.player_result === 'W'
    if (win) wins++
    if (win && og === 0) straightW++
    if (!win && pg === 0) straightL++
    const games = (m.game_scores || '').split(',').map(g => {
      const [a, b] = g.split('-').map(Number)
      if ([a, b].some(x => isNaN(x))) return null
      return m.on_c1 ? [a, b] : [b, a]
    }).filter(Boolean)
    if (win && games[0] && games[0][0] < games[0][1]) comebackW++
    if (!isNaN(pg) && !isNaN(og) && (pg + og === 5 || pg + og === 7)) { decN++; if (win) decW++ }
    for (const [pp, op] of games) if (Math.max(pp, op) >= 11 && Math.min(pp, op) >= 10) { deuceN++; if (pp > op) deuceW++ }
    const r = m.round || 'Other'
    rounds[r] = rounds[r] || { w: 0, l: 0 }
    win ? rounds[r].w++ : rounds[r].l++
  }
  const n = ms.length
  return {
    n, wins, losses: n - wins, winRate: (wins / n) * 100,
    straightW, straightL, comebackW,
    decN, decRate: decN ? (decW / decN) * 100 : null,
    deuceN, deuceRate: deuceN ? (deuceW / deuceN) * 100 : null,
    form: ms.slice(0, 10).map(m => m.player_result),
    rounds,
  }
}

function Stat({ label, value, sub }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color: '#0f172a' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#94a3b8' }}>{sub}</div>}
    </div>
  )
}

function Metric({ label, value, desc, accent }) {
  return (
    <div style={{ ...card, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, color: '#64748b' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 900, color: accent || '#0f172a' }}>{value}</div>
      {desc && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{desc}</div>}
    </div>
  )
}

const TABS = ['Rank', 'Results', 'Performance']

export default function PairProfile() {
  const { pair } = useParams()
  const [a, b] = (pair || '').split('_').map(Number)

  const [names, setNames] = useState({})
  const [rankRows, setRankRows] = useState([])
  const [score, setScore] = useState(null)
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('Rank')

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
        .order('event_date', { ascending: false }).limit(200)
      const together = (dm || []).filter(m =>
        ([m.comp1_p1_id, m.comp1_p2_id].includes(a) && [m.comp1_p1_id, m.comp1_p2_id].includes(b)) ||
        ([m.comp2_p1_id, m.comp2_p2_id].includes(a) && [m.comp2_p1_id, m.comp2_p2_id].includes(b)))

      const oppIds = new Set()
      for (const m of together) {
        const onC1 = [m.comp1_p1_id, m.comp1_p2_id].includes(a)
        if (onC1) { oppIds.add(m.comp2_p1_id); oppIds.add(m.comp2_p2_id) }
        else { oppIds.add(m.comp1_p1_id); oppIds.add(m.comp1_p2_id) }
      }
      oppIds.delete(null); oppIds.delete(undefined)
      const { data: opps } = await supabase.from('wtt_players').select('ittf_id, player_name').in('ittf_id', oppIds.size ? [...oppIds] : [0])
      const om = Object.fromEntries((opps || []).map(p => [p.ittf_id, p.player_name]))
      const enriched = together.map(m => {
        const onC1 = [m.comp1_p1_id, m.comp1_p2_id].includes(a)
        const o1 = om[onC1 ? m.comp2_p1_id : m.comp1_p1_id]
        const o2 = om[onC1 ? m.comp2_p2_id : m.comp1_p2_id]
        const rp = (m.round_phase || '').split(' - ')
        return {
          ...m, on_c1: onC1,
          player_result: onC1 ? m.result : (m.result === 'W' ? 'L' : 'W'),
          opp_name: [o1, o2].filter(Boolean).join(' / ') || 'Unknown',
          round: rp.length >= 2 ? rp[1] : (m.round_phase || ''),
        }
      })

      if (!cancelled) { setNames(nm); setRankRows(rk || []); setScore(sc?.[0] || null); setMatches(enriched); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [pair])

  const latest = rankRows[rankRows.length - 1]
  const disc = DISC[score?.category || latest?.category] || 'Doubles'
  const nameStr = [names[a]?.player_name, names[b]?.player_name].filter(Boolean).join(' / ') || `${a} / ${b}`
  const country = names[a]?.country_code || ''
  const chart = rankRows.filter(r => r.current_rank != null).map(r => ({ d: r.publish_date, rank: r.current_rank }))
  const metrics = useMemo(() => computeMetrics(matches), [matches])

  return (
    <>
      <PageBackground />
      <div style={{ position: 'relative', zIndex: 4, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <AuthBar />
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '22px 16px 56px' }}>
          <button onClick={() => window.history.back()} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginBottom: 12 }}>← Back</button>

          {loading ? <div style={{ textAlign: 'center', padding: '80px 0', color: '#94a3b8' }}>Loading pair…</div> : (
            <>
              {/* Header with stats (mirrors singles) */}
              <div style={{ ...card, padding: '16px 22px', marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#8b5cf6', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{disc}{country ? ` · ${country}` : ''}</div>
                <h1 style={{ margin: '2px 0 12px', fontSize: 22, fontWeight: 900, color: '#0f172a' }}>{nameStr}</h1>
                <div style={{ display: 'grid', gap: 10,
                              gridTemplateColumns: 'repeat(auto-fit, minmax(min(120px, 100%), 1fr))' }}>
                  <Stat label="World Rank" value={latest?.current_rank ? `#${latest.current_rank}` : '—'} />
                  <Stat label="Readiness" value={score ? score.score : '—'} />
                  <Stat label="Win Rate" value={metrics ? `${metrics.winRate.toFixed(0)}%` : '—'} sub={metrics ? `${metrics.wins}W ${metrics.losses}L` : null} />
                  <Stat label="Matches" value={metrics ? metrics.n : 0} />
                </div>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                {TABS.map(t => (
                  <button key={t} onClick={() => setTab(t)} style={{ padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', background: tab === t ? '#0f172a' : '#f1f5f9', color: tab === t ? '#fff' : '#64748b' }}>{t}</button>
                ))}
              </div>

              {tab === 'Rank' && (
                <>
                  {score && (
                    <div style={{ ...card, padding: '14px 20px', marginBottom: 14 }}>
                      <div style={{ fontSize: 13, fontWeight: 900, color: '#0f172a', marginBottom: 10 }}>Podium-Readiness {score.score}/100</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
                        {[['Pair rank', score.rank_pts, 55], ['Trajectory', score.traj_pts, 25], ['Runway (age)', score.runway_pts, 20]].map(([lbl, v, mx]) => (
                          <div key={lbl}><div style={{ fontSize: 11, color: '#64748b' }}>{lbl}</div><div style={{ fontSize: 15, fontWeight: 800 }}>{v}<span style={{ fontSize: 11, color: '#cbd5e1' }}>/{mx}</span></div></div>
                        ))}
                        <div><div style={{ fontSize: 11, color: '#64748b' }}>Avg age</div><div style={{ fontSize: 15, fontWeight: 800 }}>{score.avg_age ?? '—'}</div></div>
                      </div>
                    </div>
                  )}
                  {chart.length > 1 && (
                    <div style={{ ...card, padding: '14px 20px 6px' }}>
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
                </>
              )}

              {tab === 'Results' && (
                <div style={{ ...card, overflow: 'hidden' }}>
                  <div style={{ padding: '13px 18px', borderBottom: '1px solid #f1f5f9', fontSize: 13, fontWeight: 900, color: '#0f172a' }}>Doubles results together</div>
                  {matches.length === 0
                    ? <div style={{ padding: '30px 20px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No doubles matches yet.</div>
                    : matches.map(m => (
                        <div key={m.match_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 18px', borderTop: '1px solid #f1f5f9', background: m.player_result === 'W' ? 'rgba(22,163,74,0.04)' : 'rgba(220,38,38,0.03)' }}>
                          <span style={{ fontSize: 12, fontWeight: 800, width: 14, color: m.player_result === 'W' ? '#16a34a' : '#dc2626' }}>{m.player_result === 'W' ? '✓' : '✗'}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#1e293b' }}>{m.opp_name}</span>
                            {m.round && <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 6 }}>{m.round}</span>}
                          </div>
                          <span style={{ fontSize: 11, color: '#64748b', flexShrink: 0 }}>{m.match_score}</span>
                          <span style={{ fontSize: 10, color: '#94a3b8', width: 74, textAlign: 'right', flexShrink: 0 }}>{m.event_date || ''}</span>
                        </div>
                      ))}
                </div>
              )}

              {tab === 'Performance' && (
                !metrics ? <div style={{ ...card, padding: '30px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No match data yet.</div> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px 2px' }}>Outcomes</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
                        <Metric label="Win Rate" value={`${metrics.winRate.toFixed(0)}%`} desc={`${metrics.wins}W · ${metrics.losses}L`} accent={metrics.winRate >= 50 ? '#16a34a' : '#f87171'} />
                        <Metric label="Straight-set wins" value={metrics.straightW} desc="won without dropping a game" accent="#16a34a" />
                        <Metric label="Straight-set losses" value={metrics.straightL} desc="lost without winning a game" accent="#f87171" />
                        <Metric label="Current form" value={metrics.form.filter(r => r === 'W').length + 'W ' + metrics.form.filter(r => r === 'L').length + 'L'} desc={metrics.form.join(' ')} />
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px 2px' }}>Under Pressure</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
                        <Metric label="Deciding-game win %" value={metrics.decRate != null ? `${metrics.decRate.toFixed(0)}%` : '—'} desc={`${metrics.decN} deciding matches`} accent="#f59e0b" />
                        <Metric label="Deuce win %" value={metrics.deuceRate != null ? `${metrics.deuceRate.toFixed(0)}%` : '—'} desc={`${metrics.deuceN} games to 10-10`} accent="#f59e0b" />
                        <Metric label="Comeback wins" value={metrics.comebackW} desc="won after losing game 1" accent="#38bdf8" />
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px 2px' }}>Tournament Depth</div>
                      <div style={{ ...card, overflow: 'hidden' }}>
                        {ROUND_ORDER.filter(r => metrics.rounds[r]).map((r, i) => {
                          const g = metrics.rounds[r]; const t = g.w + g.l
                          return (
                            <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderTop: i ? '1px solid #f1f5f9' : 'none' }}>
                              <span style={{ flex: 1, fontSize: 12, color: '#0f172a' }}>{r}</span>
                              <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>{g.w}–{g.l}</span>
                              <span style={{ fontSize: 12, color: '#94a3b8', width: 44, textAlign: 'right' }}>{Math.round(g.w / t * 100)}%</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
