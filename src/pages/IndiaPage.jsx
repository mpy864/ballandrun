import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import AuthBar from '../components/AuthBar.jsx'
import PageBackground from '../components/PageBackground.jsx'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'

// ─── Constants ────────────────────────────────────────────────────────────────

const DISCIPLINES = [
  { code: 'MS', label: "Boys' Singles" },
  { code: 'WS', label: "Girls' Singles" },
  { code: 'MD', label: "Boys' Doubles" },
  { code: 'WD', label: "Girls' Doubles" },
  { code: 'XD', label: "Mixed Doubles" },
]

const LEVELS = ['Senior', 'U19', 'U17', 'U15', 'U13', 'U11']

const LEVEL_STYLE = {
  Senior: { color: '#b45309', bg: '#fef3c7', border: '#fde68a' },
  U19:    { color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0' },
  U17:    { color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  U15:    { color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  U13:    { color: '#6d28d9', bg: '#faf5ff', border: '#e9d5ff' },
  U11:    { color: '#475569', bg: '#f8fafc', border: '#e2e8f0' },
}

const COMPARE_COLORS = ['#3b82f6', '#ec4899', '#10b981', '#f59e0b']

// ─── Helpers ──────────────────────────────────────────────────────────────────

// rank_diff = current - previous: negative = improved (↑), positive = declined (↓)
function RankDiff({ diff }) {
  if (diff == null) return null
  const n = Number(diff)
  if (n === 0) return <span style={{ color: '#94a3b8', fontSize: 11 }}>—</span>
  return n < 0
    ? <span style={{ color: '#10b981', fontSize: 11, fontWeight: 700 }}>↑{Math.abs(n)}</span>
    : <span style={{ color: '#f87171', fontSize: 11, fontWeight: 700 }}>↓{n}</span>
}

function LevelBadge({ level }) {
  const s = LEVEL_STYLE[level] || LEVEL_STYLE.U11
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      letterSpacing: '0.05em', whiteSpace: 'nowrap',
    }}>{level}</span>
  )
}

function playerKey(p) {
  if (p.isSenior)   return `senior_${p.ittf_id}_${p.sub_event}`
  if (p.isDoubles)  return `doubles_${p.ittf_id1}_${p.ittf_id2}_${p.sub_event}`
  return `youth_${p.ittf_id}_${p.sub_event}_${p.level}`
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function IndiaPage() {
  const navigate = useNavigate()

  const [tab, setTab]         = useState('intelligence')
  const [loading, setLoading] = useState(true)

  // Data
  const [seniorSingles, setSeniorSingles] = useState([])
  const [youthSingles,  setYouthSingles]  = useState([])
  const [youthDoubles,  setYouthDoubles]  = useState([])

  // Intelligence tab
  const [disc, setDisc] = useState('MS')

  // Profiles tab
  const [pfDisc,  setPfDisc]  = useState('all')
  const [pfLevel, setPfLevel] = useState('all')
  const [search,  setSearch]  = useState('')

  // Comparison tab
  const [compareList,    setCompareList]    = useState([])   // {…player, _key}
  const [compareHistory, setCompareHistory] = useState({})   // key → [{date,rank}]
  const [cmpLoading,     setCmpLoading]     = useState(false)

  // ── Data fetch ────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      // IND player metadata
      const { data: indPlayers } = await supabase
        .from('wtt_players')
        .select('ittf_id, player_name, dob, gender')
        .eq('country_code', 'IND')

      const playerMap = Object.fromEntries((indPlayers || []).map(p => [String(p.ittf_id), p]))
      const indIds    = (indPlayers || []).map(p => p.ittf_id)

      // ── Senior singles (rankings_singles_normalized) ──
      const { data: seniorRaw } = await supabase
        .from('rankings_singles_normalized')
        .select('player_id, rank, gender, ranking_date, previous_rank, rank_change')
        .in('player_id', indIds)
        .order('ranking_date', { ascending: false })
        .limit(600)

      const latestSDate = seniorRaw?.[0]?.ranking_date
      const seniorData = (seniorRaw || [])
        .filter(r => r.ranking_date === latestSDate)
        .map(r => ({
          ittf_id:     r.player_id,
          player_name: playerMap[String(r.player_id)]?.player_name || `Player ${r.player_id}`,
          rank:        r.rank,
          rank_diff:   r.rank_change,  // rank_change: negative = improved
          sub_event:   r.gender === 'M' ? 'MS' : 'WS',
          level:       'Senior',
          isDoubles:   false,
          isSenior:    true,
        }))
        .sort((a, b) => a.rank - b.rank)

      setSeniorSingles(seniorData)

      // ── Youth singles ──
      const { data: youthRaw } = await supabase
        .from('youth_rankings_singles')
        .select('ittf_id, player_name, sub_event, age_category, current_rank, age_cat_rank, publish_date, rank_diff')
        .eq('country_code', 'IND')
        .in('sub_event', ['MS', 'WS'])
        .order('publish_date', { ascending: false })
        .limit(3000)

      // Keep only latest snapshot per (sub_event × age_category)
      const latestCell = {}
      for (const r of youthRaw || []) {
        const k = `${r.sub_event}_${r.age_category}`
        if (!latestCell[k]) latestCell[k] = r.publish_date
      }
      const youthData = (youthRaw || [])
        .filter(r => r.publish_date === latestCell[`${r.sub_event}_${r.age_category}`])
        .map(r => ({ ...r, level: r.age_category, isDoubles: false, isSenior: false }))
        .sort((a, b) => (a.current_rank || 9999) - (b.current_rank || 9999))

      setYouthSingles(youthData)

      // ── Youth doubles ──
      const { data: dblRaw } = await supabase
        .from('youth_rankings_doubles')
        .select('ittf_id1, player_name1, ittf_id2, player_name2, country_code1, country_code2, sub_event, age_category, current_rank, publish_date, rank_diff')
        .or('country_code1.eq.IND,country_code2.eq.IND')
        .order('publish_date', { ascending: false })
        .limit(500)

      const latestDbl = {}
      for (const r of dblRaw || []) {
        const k = `${r.sub_event}_${r.age_category || 'Open'}`
        if (!latestDbl[k]) latestDbl[k] = r.publish_date
      }
      const dblData = (dblRaw || [])
        .filter(r => r.publish_date === latestDbl[`${r.sub_event}_${r.age_category || 'Open'}`])
        .map(r => ({
          ...r,
          player_name: `${r.player_name1} / ${r.player_name2}`,
          rank:        r.current_rank,
          level:       r.age_category || 'Open',
          isDoubles:   true,
          isSenior:    false,
        }))
        .sort((a, b) => (a.current_rank || 9999) - (b.current_rank || 9999))

      setYouthDoubles(dblData)
      setLoading(false)
    }
    load()
  }, [])

  // ── Intelligence: pipeline per discipline ─────────────────────────────────

  const pipeline = useMemo(() => {
    const result = {}
    for (const level of LEVELS) {
      if (disc === 'MS' || disc === 'WS') {
        result[level] = level === 'Senior'
          ? seniorSingles.filter(p => p.sub_event === disc)
          : youthSingles.filter(p => p.sub_event === disc && p.age_category === level)
      } else {
        result[level] = level === 'Senior'
          ? []  // senior doubles not ingested yet
          : youthDoubles.filter(p => p.sub_event === disc && p.level === level)
      }
    }
    return result
  }, [disc, seniorSingles, youthSingles, youthDoubles])

  // ── Profiles: flat filtered list ─────────────────────────────────────────

  const profilesList = useMemo(() => {
    const all = []
    const q = search.toLowerCase()
    const matchName = name => !q || name.toLowerCase().includes(q)
    const matchDisc  = code  => pfDisc  === 'all' || pfDisc  === code
    const matchLevel = level => pfLevel === 'all' || pfLevel === level

    for (const p of seniorSingles) {
      if (!matchDisc(p.sub_event) || !matchLevel('Senior') || !matchName(p.player_name)) continue
      all.push({ ...p, _key: playerKey(p), rank_display: p.rank })
    }
    for (const p of youthSingles) {
      if (!matchDisc(p.sub_event) || !matchLevel(p.age_category) || !matchName(p.player_name)) continue
      all.push({ ...p, _key: playerKey(p), rank_display: p.current_rank })
    }
    for (const p of youthDoubles) {
      if (!matchDisc(p.sub_event) || !matchLevel(p.level) || !matchName(p.player_name)) continue
      all.push({ ...p, _key: playerKey(p), rank_display: p.current_rank })
    }
    return all.sort((a, b) => (a.rank_display || 9999) - (b.rank_display || 9999))
  }, [seniorSingles, youthSingles, youthDoubles, pfDisc, pfLevel, search])

  // ── Comparison ────────────────────────────────────────────────────────────

  async function addToCompare(player) {
    const key = player._key || playerKey(player)
    if (compareList.find(p => p._key === key) || compareList.length >= 4) return
    setCompareList(prev => [...prev, { ...player, _key: key }])
    setCmpLoading(true)

    let history = []
    if (player.isSenior) {
      const { data } = await supabase
        .from('rankings_singles_normalized')
        .select('ranking_date, rank')
        .eq('player_id', player.ittf_id)
        .order('ranking_date', { ascending: true })
        .limit(104)
      history = (data || []).map(r => ({ date: r.ranking_date, rank: r.rank }))
    } else if (player.isDoubles) {
      const { data } = await supabase
        .from('youth_rankings_doubles')
        .select('publish_date, current_rank')
        .eq('ittf_id1', player.ittf_id1)
        .eq('ittf_id2', player.ittf_id2)
        .eq('sub_event', player.sub_event)
        .order('publish_date', { ascending: true })
        .limit(104)
      history = (data || []).map(r => ({ date: r.publish_date, rank: r.current_rank }))
    } else {
      const { data } = await supabase
        .from('youth_rankings_singles')
        .select('publish_date, current_rank')
        .eq('ittf_id', player.ittf_id)
        .eq('sub_event', player.sub_event)
        .order('publish_date', { ascending: true })
        .limit(104)
      history = (data || []).map(r => ({ date: r.publish_date, rank: r.current_rank }))
    }

    setCompareHistory(prev => ({ ...prev, [key]: history }))
    setCmpLoading(false)
  }

  function removeFromCompare(key) {
    setCompareList(prev => prev.filter(p => p._key !== key))
    setCompareHistory(prev => { const n = { ...prev }; delete n[key]; return n })
  }

  const compareChartData = useMemo(() => {
    if (!compareList.length) return []
    const allDates = new Set()
    for (const p of compareList) {
      for (const h of compareHistory[p._key] || []) allDates.add(h.date)
    }
    return [...allDates].sort().map(date => {
      const pt = { date }
      for (const p of compareList) {
        const h = (compareHistory[p._key] || []).find(r => r.date === date)
        if (h) pt[p._key] = h.rank
      }
      return pt
    })
  }, [compareList, compareHistory])

  // ── Navigation ────────────────────────────────────────────────────────────

  function goToProfile(player) {
    const id = player.isDoubles ? player.ittf_id1 : player.ittf_id
    navigate(`/player/${id}?sub=${player.sub_event}&age=${player.level || 'Senior'}`)
  }

  const inCompare = key => !!compareList.find(p => p._key === key)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <PageBackground />
      <div style={{ position: 'relative', zIndex: 4, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <AuthBar />
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '24px 16px 52px' }}>

          {/* Header */}
          <div style={{
            background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)', border: '1px solid rgba(30,70,160,0.08)',
            borderRadius: 14, padding: '16px 20px', marginBottom: 20,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <span style={{ fontSize: 28, lineHeight: 1 }}>🇮🇳</span>
              <div>
                <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#0f172a', letterSpacing: -0.5 }}>
                  India TT — Intelligence Hub
                </h1>
                <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
                  Senior + Youth · All disciplines · International rankings
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                { id: 'intelligence', label: 'Intelligence' },
                { id: 'profiles',    label: 'All Profiles' },
                { id: 'comparison',  label: 'Comparison'   },
              ].map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} style={{
                  padding: '7px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  border: 'none', cursor: 'pointer',
                  background: tab === t.id ? '#0f172a' : '#f1f5f9',
                  color:      tab === t.id ? '#fff'    : '#64748b',
                }}>
                  {t.label}
                  {t.id === 'comparison' && compareList.length > 0 && (
                    <span style={{
                      marginLeft: 6, background: '#6366f1', color: '#fff',
                      fontSize: 10, fontWeight: 800, padding: '1px 5px', borderRadius: 8,
                    }}>{compareList.length}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8', fontSize: 14 }}>
              Loading India data…
            </div>
          ) : (
            <>
              {/* ══════════════════════════════════════════════════════════════
                  INTELLIGENCE TAB
              ══════════════════════════════════════════════════════════════ */}
              {tab === 'intelligence' && (
                <div>
                  {/* Discipline pills */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
                    {DISCIPLINES.map(d => (
                      <button key={d.code} onClick={() => setDisc(d.code)} style={{
                        padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                        border: 'none', cursor: 'pointer',
                        background: disc === d.code
                          ? '#0f172a'
                          : 'rgba(255,255,255,0.85)',
                        color:      disc === d.code ? '#fff' : '#475569',
                        backdropFilter: 'blur(8px)',
                        boxShadow: disc === d.code ? 'none' : '0 1px 3px rgba(0,0,0,0.06)',
                      }}>
                        {d.label}
                      </button>
                    ))}
                  </div>

                  {/* Pipeline */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {LEVELS.map(level => {
                      const players = pipeline[level] || []
                      const s = LEVEL_STYLE[level]
                      const noSeniorDoubles = level === 'Senior' && disc !== 'MS' && disc !== 'WS'

                      return (
                        <div key={level} style={{
                          background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(18px)',
                          WebkitBackdropFilter: 'blur(18px)',
                          border: `1.5px solid ${s.border}`, borderRadius: 12, overflow: 'hidden',
                        }}>
                          {/* Level header */}
                          <div style={{
                            padding: '9px 16px', background: s.bg,
                            borderBottom: (players.length > 0 && !noSeniorDoubles) ? `1px solid ${s.border}` : 'none',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: s.color }}>
                              {level === 'Senior' ? 'Senior' : level}
                            </span>
                            <span style={{ fontSize: 11, color: s.color, opacity: 0.65 }}>
                              {noSeniorDoubles
                                ? 'Senior doubles — data not ingested yet'
                                : players.length === 0
                                ? 'No Indian players ranked'
                                : `${players.length} player${players.length !== 1 ? 's' : ''}`}
                            </span>
                          </div>

                          {/* Player rows */}
                          {!noSeniorDoubles && players.map((p, i) => {
                            const rank    = p.rank || p.current_rank
                            const key     = playerKey(p)
                            return (
                              <div key={i}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 12,
                                  padding: i === 0 ? '12px 16px' : '9px 16px',
                                  borderBottom: i < players.length - 1 ? '1px solid #f1f5f9' : 'none',
                                  cursor: 'pointer', transition: 'background 0.1s',
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                              >
                                {/* World rank */}
                                <div style={{ width: 52, flexShrink: 0 }}>
                                  <div style={{
                                    fontSize: i === 0 ? 20 : 15, fontWeight: 800,
                                    color: i === 0 ? '#0f172a' : '#475569',
                                  }}>#{rank}</div>
                                  <RankDiff diff={p.rank_diff} />
                                </div>

                                {/* Name */}
                                <div style={{ flex: 1, minWidth: 0 }} onClick={() => goToProfile(p)}>
                                  <div style={{
                                    fontSize: i === 0 ? 14 : 13, fontWeight: i === 0 ? 700 : 500,
                                    color: '#0f172a', whiteSpace: 'nowrap',
                                    overflow: 'hidden', textOverflow: 'ellipsis',
                                  }}>
                                    {p.player_name}
                                  </div>
                                  {!p.isSenior && !p.isDoubles && p.age_cat_rank && (
                                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
                                      Age Cat #{p.age_cat_rank}
                                    </div>
                                  )}
                                  {p.isDoubles && (
                                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>Pair</div>
                                  )}
                                </div>

                                {/* Actions */}
                                <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                                  <button
                                    onClick={() => {
                                      const pk = playerKey(p)
                                      if (inCompare(pk)) return
                                      addToCompare({ ...p, _key: pk })
                                    }}
                                    disabled={inCompare(playerKey(p)) || compareList.length >= 4}
                                    style={{
                                      padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                                      border: '1px solid #e2e8f0', cursor: 'pointer',
                                      background: inCompare(playerKey(p)) ? '#f1f5f9' : '#fff',
                                      color:      inCompare(playerKey(p)) ? '#94a3b8' : '#6366f1',
                                    }}>
                                    {inCompare(playerKey(p)) ? '✓' : '+'}
                                  </button>
                                  <button onClick={() => goToProfile(p)} style={{
                                    padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                                    border: 'none', cursor: 'pointer', background: '#0f172a', color: '#fff',
                                  }}>
                                    {p.isSenior ? 'Dashboard →' : 'Profile →'}
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* ══════════════════════════════════════════════════════════════
                  PROFILES TAB
              ══════════════════════════════════════════════════════════════ */}
              {tab === 'profiles' && (
                <div>
                  {/* Filter bar */}
                  <div style={{
                    background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(18px)',
                    WebkitBackdropFilter: 'blur(18px)', border: '1px solid rgba(30,70,160,0.08)',
                    borderRadius: 12, padding: '14px 16px', marginBottom: 14,
                  }}>
                    <input
                      type="text" placeholder="Search player or pair…"
                      value={search} onChange={e => setSearch(e.target.value)}
                      style={{
                        width: '100%', padding: '8px 12px', borderRadius: 8,
                        border: '1px solid #e2e8f0', fontSize: 13, marginBottom: 12,
                        outline: 'none', boxSizing: 'border-box', background: '#f8fafc',
                      }}
                    />
                    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                      <div>
                        <p style={{ fontSize: 10, color: '#94a3b8', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 5px' }}>Category</p>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {['all', ...DISCIPLINES.map(d => d.code)].map(c => (
                            <button key={c} onClick={() => setPfDisc(c)} style={{
                              padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                              border: 'none', cursor: 'pointer',
                              background: pfDisc === c ? '#0f172a' : '#f1f5f9',
                              color:      pfDisc === c ? '#fff'    : '#64748b',
                            }}>
                              {c === 'all' ? 'All' : c}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p style={{ fontSize: 10, color: '#94a3b8', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 5px' }}>Level</p>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {['all', ...LEVELS].map(l => (
                            <button key={l} onClick={() => setPfLevel(l)} style={{
                              padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                              border: 'none', cursor: 'pointer',
                              background: pfLevel === l ? '#0f172a' : '#f1f5f9',
                              color:      pfLevel === l ? '#fff'    : '#64748b',
                            }}>
                              {l === 'all' ? 'All' : l}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Player list */}
                  <div style={{
                    background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(18px)',
                    WebkitBackdropFilter: 'blur(18px)', border: '1px solid rgba(30,70,160,0.08)',
                    borderRadius: 12, overflow: 'hidden',
                  }}>
                    {profilesList.length === 0 ? (
                      <div style={{ padding: '48px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                        No players found
                      </div>
                    ) : profilesList.map((p, i) => (
                      <div key={p._key} style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
                        borderBottom: i < profilesList.length - 1 ? '1px solid #f1f5f9' : 'none',
                      }}>
                        {/* Rank */}
                        <div style={{ width: 46, flexShrink: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                            #{p.rank_display}
                          </div>
                          <RankDiff diff={p.rank_diff} />
                        </div>

                        {/* Name + badges */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: 13, fontWeight: 600, color: '#0f172a',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {p.player_name}
                          </div>
                          <div style={{ display: 'flex', gap: 4, marginTop: 3, alignItems: 'center' }}>
                            <LevelBadge level={p.level} />
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: '2px 6px',
                              background: '#f1f5f9', color: '#475569', borderRadius: 5,
                            }}>{p.sub_event}</span>
                            {!p.isSenior && !p.isDoubles && p.age_cat_rank && (
                              <span style={{ fontSize: 10, color: '#94a3b8' }}>Age Cat #{p.age_cat_rank}</span>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                          <button
                            onClick={() => addToCompare(p)}
                            disabled={inCompare(p._key) || compareList.length >= 4}
                            style={{
                              padding: '5px 9px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                              border: '1px solid #e2e8f0', cursor: 'pointer',
                              background: inCompare(p._key) ? '#f1f5f9' : '#fff',
                              color:      inCompare(p._key) ? '#94a3b8' : '#6366f1',
                            }}>
                            {inCompare(p._key) ? '✓ Added' : '+ Compare'}
                          </button>
                          <button onClick={() => goToProfile(p)} style={{
                            padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                            border: 'none', cursor: 'pointer', background: '#0f172a', color: '#fff',
                          }}>
                            {p.isSenior ? 'Dashboard →' : 'Profile →'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p style={{ textAlign: 'center', marginTop: 10, fontSize: 11, color: '#94a3b8' }}>
                    {profilesList.length} player{profilesList.length !== 1 ? 's' : ''} shown
                  </p>
                </div>
              )}

              {/* ══════════════════════════════════════════════════════════════
                  COMPARISON TAB
              ══════════════════════════════════════════════════════════════ */}
              {tab === 'comparison' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {compareList.length === 0 ? (
                    <div style={{
                      background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(18px)',
                      border: '1px solid rgba(30,70,160,0.08)', borderRadius: 12,
                      padding: '60px 20px', textAlign: 'center',
                    }}>
                      <p style={{ fontSize: 15, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                        No players selected
                      </p>
                      <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 20 }}>
                        Go to All Profiles or Intelligence, tap + Compare on up to 4 players, then come back here.
                      </p>
                      <button onClick={() => setTab('profiles')} style={{
                        padding: '9px 22px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                        border: 'none', cursor: 'pointer', background: '#0f172a', color: '#fff',
                      }}>
                        Browse Profiles
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Selected players chips */}
                      <div style={{
                        background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(18px)',
                        border: '1px solid rgba(30,70,160,0.08)', borderRadius: 12, padding: '14px 16px',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                          <p style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
                            Comparing {compareList.length} player{compareList.length > 1 ? 's' : ''}
                          </p>
                          <button onClick={() => setTab('profiles')} style={{
                            padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                            border: '1px solid #e2e8f0', background: '#fff', color: '#6366f1', cursor: 'pointer',
                          }}>+ Add more</button>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {compareList.map((p, i) => (
                            <div key={p._key} style={{
                              display: 'flex', alignItems: 'center', gap: 7,
                              padding: '6px 12px', borderRadius: 8,
                              border: `2px solid ${COMPARE_COLORS[i]}`,
                              background: `${COMPARE_COLORS[i]}12`,
                            }}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: COMPARE_COLORS[i], flexShrink: 0 }} />
                              <span style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>{p.player_name}</span>
                              <span style={{ fontSize: 10, color: '#94a3b8' }}>{p.sub_event} {p.level}</span>
                              <button onClick={() => removeFromCompare(p._key)} style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: '#94a3b8', fontSize: 16, lineHeight: 1, padding: 0,
                              }}>×</button>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* World rank chart */}
                      <div style={{
                        background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(18px)',
                        border: '1px solid rgba(30,70,160,0.08)', borderRadius: 12, padding: '16px',
                      }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
                          World Rank Over Time
                        </p>
                        {cmpLoading ? (
                          <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
                            Loading history…
                          </div>
                        ) : compareChartData.length < 2 ? (
                          <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
                            Not enough history to chart
                          </div>
                        ) : (
                          <ResponsiveContainer width="100%" height={280}>
                            <LineChart data={compareChartData} margin={{ top: 5, right: 16, bottom: 0, left: -10 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                              <XAxis dataKey="date"
                                tickFormatter={d => new Date(d).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                                tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false}
                                interval="preserveStartEnd"
                              />
                              <YAxis reversed domain={['dataMin - 5', 'dataMax + 5']}
                                tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false}
                                tickFormatter={v => `#${Math.round(v)}`} allowDecimals={false}
                              />
                              <Tooltip
                                contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }}
                                labelFormatter={d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                formatter={(v, name) => {
                                  const p = compareList.find(pl => pl._key === name)
                                  return [`#${v}`, p?.player_name || name]
                                }}
                              />
                              {compareList.map((p, i) => (
                                <Line key={p._key} type="monotone" dataKey={p._key}
                                  stroke={COMPARE_COLORS[i]} strokeWidth={2}
                                  dot={false} connectNulls isAnimationActive={false}
                                />
                              ))}
                            </LineChart>
                          </ResponsiveContainer>
                        )}
                      </div>

                      {/* Stats table */}
                      <div style={{
                        background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(18px)',
                        border: '1px solid rgba(30,70,160,0.08)', borderRadius: 12, overflow: 'hidden',
                      }}>
                        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9' }}>
                          <p style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
                            Current Rankings
                          </p>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: '#f8fafc' }}>
                              <th style={{ padding: '8px 16px', textAlign: 'left',   fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Player</th>
                              <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Category</th>
                              <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Level</th>
                              <th style={{ padding: '8px 16px', textAlign: 'right',  fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>World Rank</th>
                            </tr>
                          </thead>
                          <tbody>
                            {compareList.map((p, i) => (
                              <tr key={p._key} style={{ borderTop: '1px solid #f1f5f9' }}>
                                <td style={{ padding: '10px 16px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: COMPARE_COLORS[i], flexShrink: 0 }} />
                                    <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{p.player_name}</span>
                                  </div>
                                </td>
                                <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                  <span style={{ fontSize: 12, fontWeight: 700, color: '#6366f1' }}>{p.sub_event}</span>
                                </td>
                                <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                  <LevelBadge level={p.level} />
                                </td>
                                <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                                  <span style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                                    #{p.rank || p.current_rank}
                                  </span>
                                  <span style={{ marginLeft: 6 }}><RankDiff diff={p.rank_diff} /></span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
