import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import AuthBar from '../components/AuthBar.jsx'
import PageBackground from '../components/PageBackground.jsx'
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'

const AGE_GROUPS = ['U11', 'U13', 'U15', 'U17', 'U19']

const DISCIPLINES = [
  { code: 'MS', label: 'Boys Singles',  table: 'singles', gender: 'M' },
  { code: 'WS', label: 'Girls Singles', table: 'singles', gender: 'W' },
  { code: 'MD', label: 'Boys Doubles',  table: 'doubles', gender: 'M' },
  { code: 'WD', label: 'Girls Doubles', table: 'doubles', gender: 'W' },
  { code: 'XD', label: 'Mixed Doubles', table: 'doubles', gender: 'X' },
]

const PIPELINE_BADGE = {
  U19: { label: 'LA 2028 Ready',     color: '#16a34a', bg: 'rgba(22,163,74,0.08)',  border: 'rgba(22,163,74,0.2)'  },
  U17: { label: 'LA 2028 Pipeline',  color: '#2563eb', bg: 'rgba(37,99,235,0.08)',  border: 'rgba(37,99,235,0.2)'  },
  U15: { label: 'LA 2032 Pipeline',  color: '#d97706', bg: 'rgba(217,119,6,0.08)',  border: 'rgba(217,119,6,0.2)'  },
  U13: { label: 'Emerging',          color: '#7c3aed', bg: 'rgba(124,58,237,0.08)', border: 'rgba(124,58,237,0.2)' },
  U11: { label: 'Grassroots',        color: '#64748b', bg: 'rgba(100,116,139,0.08)',border: 'rgba(100,116,139,0.2)'},
}

const DISC_LABEL = Object.fromEntries(DISCIPLINES.map(d => [d.code, d.label]))

function rankColor(rank) {
  if (!rank) return '#64748b'
  if (rank <= 10)  return '#16a34a'
  if (rank <= 50)  return '#2563eb'
  if (rank <= 100) return '#d97706'
  return '#64748b'
}

const CHART_COLORS = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#ec4899','#84cc16','#f97316','#6366f1',
  '#14b8a6','#f43f5e','#a855f7','#22c55e','#eab308',
]

const CHART_DISCS = [
  { code: 'MS', label: 'Boys Singles',  table: 'singles' },
  { code: 'WS', label: 'Girls Singles', table: 'singles' },
  { code: 'MD', label: 'Boys Doubles',  table: 'doubles' },
  { code: 'WD', label: 'Girls Doubles', table: 'doubles' },
  { code: 'XD', label: 'Mixed Doubles', table: 'doubles' },
]

function Top64Chart({ ageGroup }) {
  const [months, setMonths]         = useState(6)
  const [subEvent, setSubEvent]     = useState('MS')
  const [chartData, setChartData]   = useState([])
  const [players, setPlayers]       = useState([])
  const [loading, setLoading]       = useState(false)

  useEffect(() => {
    if (!ageGroup || ageGroup === 'all') return
    let cancelled = false
    setLoading(true)

    async function load() {
      const cutoff = new Date()
      cutoff.setMonth(cutoff.getMonth() - months)
      const cutoffStr = cutoff.toISOString().split('T')[0]

      const disc = CHART_DISCS.find(d => d.code === subEvent)
      const isDoubles = disc?.table === 'doubles'

      let rows = []
      if (isDoubles) {
        const { data } = await supabase
          .from('youth_rankings_doubles')
          .select('pair_id, player_name1, player_name2, country_code1, country_code2, publish_date, age_cat_rank, current_rank')
          .eq('age_category', ageGroup)
          .eq('sub_event', subEvent)
          .or('country_code1.eq.IND,country_code2.eq.IND')
          .gte('publish_date', cutoffStr)
          .order('publish_date', { ascending: true })
          .limit(10000)
        // Normalise to common shape
        rows = (data || []).map(r => ({
          id:   r.pair_id,
          name: `${r.player_name1?.split(' ').slice(-1)[0]} / ${r.player_name2?.split(' ').slice(-1)[0]}`,
          publish_date:  r.publish_date,
          age_cat_rank:  r.age_cat_rank,
          current_rank:  r.current_rank,
        }))
      } else {
        const { data } = await supabase
          .from('youth_rankings_singles')
          .select('ittf_id, player_name, publish_date, age_cat_rank, current_rank')
          .eq('country_code', 'IND')
          .eq('age_category', ageGroup)
          .eq('sub_event', subEvent)
          .gte('publish_date', cutoffStr)
          .order('publish_date', { ascending: true })
          .limit(10000)
        rows = (data || []).map(r => ({
          id:   r.ittf_id,
          name: r.player_name,
          publish_date:  r.publish_date,
          age_cat_rank:  r.age_cat_rank,
          current_rank:  r.current_rank,
        }))
      }

      if (cancelled) return

      // Find players who were ever in top 64
      const inTop64 = new Set(
        rows.filter(r => (r.age_cat_rank || r.current_rank) <= 64).map(r => r.id)
      )
      const top64Rows = rows.filter(r => inTop64.has(r.id))

      // Unique players sorted by best rank
      const playerMap = {}
      for (const r of top64Rows) {
        const rank = r.age_cat_rank || r.current_rank
        if (!playerMap[r.id]) playerMap[r.id] = { id: r.id, name: r.name, best: 9999 }
        if (rank < playerMap[r.id].best) playerMap[r.id].best = rank
      }
      const sortedPlayers = Object.values(playerMap).sort((a, b) => a.best - b.best)

      // Reshape: one row per publish_date
      const byDate = {}
      for (const r of top64Rows) {
        const d = r.publish_date
        if (!byDate[d]) byDate[d] = { date: d }
        byDate[d][r.id] = r.age_cat_rank || r.current_rank
      }
      const formatted = Object.values(byDate)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(row => ({ ...row, label: row.date.slice(5) }))

      if (!cancelled) {
        setChartData(formatted)
        setPlayers(sortedPlayers)
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [ageGroup, subEvent, months])

  if (!ageGroup || ageGroup === 'all') return null

  return (
    <div style={{
      background: 'rgba(255,255,255,0.88)',
      backdropFilter: 'blur(18px)',
      border: '1px solid rgba(30,70,160,0.10)',
      borderRadius: 16,
      padding: '20px 20px 16px',
      marginBottom: 24,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 2 }}>
            India {ageGroup} · Top 64 Tracker
          </div>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            {players.length} Indian player{players.length !== 1 ? 's' : ''} reached top 64 in this period
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Sub-event toggle */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {CHART_DISCS.map(d => (
              <button key={d.code} onClick={() => setSubEvent(d.code)} style={{
                fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20,
                border: subEvent === d.code ? '1px solid #1d4ed8' : '1px solid #e2e8f0',
                background: subEvent === d.code ? '#1d4ed8' : 'white',
                color: subEvent === d.code ? 'white' : '#64748b',
                cursor: 'pointer',
              }}>{d.label}</button>
            ))}
          </div>
          {/* Time toggle */}
          <div style={{ display: 'flex', gap: 4 }}>
            {[3, 6, 12].map(m => (
              <button key={m} onClick={() => setMonths(m)} style={{
                fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20,
                border: months === m ? '1px solid #334155' : '1px solid #e2e8f0',
                background: months === m ? '#334155' : 'white',
                color: months === m ? 'white' : '#64748b',
                cursor: 'pointer',
              }}>{m}M</button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, padding: '30px 0' }}>Loading…</div>
      ) : players.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, padding: '30px 0' }}>
          No Indian players in top 64 for this period.
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#94a3b8' }}
                interval={Math.max(1, Math.floor(chartData.length / 8))} />
              <YAxis reversed domain={[1, 64]} tick={{ fontSize: 9, fill: '#94a3b8' }}
                label={{ value: 'Rank', angle: -90, position: 'insideLeft', fontSize: 9, fill: '#94a3b8' }} />
              <Tooltip
                contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0', background: 'rgba(255,255,255,0.96)' }}
                formatter={(val, name) => {
                  const p = players.find(p => p.id === name)
                  return [`#${val}`, p?.name || name]
                }}
                labelFormatter={l => `Week of ${l}`}
              />
              {/* Reference lines for milestones */}
              <ReferenceLine y={16} stroke="#16a34a" strokeDasharray="4 3" strokeOpacity={0.5}
                label={{ value: 'Top 16', position: 'right', fontSize: 8, fill: '#16a34a' }} />
              <ReferenceLine y={32} stroke="#f59e0b" strokeDasharray="4 3" strokeOpacity={0.5}
                label={{ value: 'Top 32', position: 'right', fontSize: 8, fill: '#f59e0b' }} />
              <ReferenceLine y={64} stroke="#ef4444" strokeDasharray="4 3" strokeOpacity={0.4}
                label={{ value: 'Top 64', position: 'right', fontSize: 8, fill: '#ef4444' }} />
              {players.map((p, i) => (
                <Line
                  key={p.id}
                  type="monotone"
                  dataKey={p.id}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  name={p.id}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>

          {/* Player legend */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {players.map((p, i) => (
              <div key={p.ittf_id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 10, height: 3, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: '#475569' }}>
                  {p.name} <span style={{ color: '#94a3b8' }}>#{p.best}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function SparkLine({ data }) {
  if (!data || data.length < 2) return null
  const min = Math.min(...data.map(d => d.rank))
  const max = Math.max(...data.map(d => d.rank))
  const domain = [Math.max(1, min - 5), max + 5]
  return (
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
        <defs>
          <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}    />
          </linearGradient>
        </defs>
        <YAxis domain={domain} reversed hide />
        <Area type="monotone" dataKey="rank" stroke="#3b82f6" strokeWidth={1.5}
          fill="url(#sg)" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function PlayerCard({ player, isDoubles, onClick, selected }) {
  const badge = PIPELINE_BADGE[player.age_category] || PIPELINE_BADGE.U11
  const rank  = player.age_cat_rank || player.current_rank
  const diff  = player.rank_diff
  const name  = isDoubles
    ? `${player.player_name1} / ${player.player_name2}`
    : player.player_name

  return (
    <div onClick={onClick} style={{
      background: selected ? 'rgba(37,99,235,0.06)' : 'rgba(255,255,255,0.88)',
      border: selected ? '1.5px solid rgba(37,99,235,0.35)' : '1px solid rgba(30,70,160,0.10)',
      borderRadius: 14,
      padding: '14px 16px',
      cursor: 'pointer',
      transition: 'all 0.15s',
      backdropFilter: 'blur(12px)',
    }}>
      {/* Top row: name + badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', lineHeight: 1.3,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {name}
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
            {DISC_LABEL[player.sub_event]} · {player.age_category}
          </div>
        </div>
        <div style={{
          fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: '2px 7px',
          borderRadius: 20, background: badge.bg, color: badge.color,
          border: `1px solid ${badge.border}`, whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {badge.label}
        </div>
      </div>

      {/* Rank row */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 28, fontWeight: 900, lineHeight: 1, color: rankColor(rank), letterSpacing: -1 }}>
          #{rank ?? '—'}
        </span>
        <div>
          <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>
            Age Cat Rank
          </div>
          {diff != null && diff !== 0 && (
            <div style={{ fontSize: 10, fontWeight: 700, color: diff > 0 ? '#16a34a' : '#ef4444' }}>
              {diff > 0 ? `↑${diff}` : `↓${Math.abs(diff)}`} this week
            </div>
          )}
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>World Rank</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>#{player.current_rank ?? '—'}</div>
        </div>
      </div>

      {/* Sparkline */}
      {player.sparkline && <SparkLine data={player.sparkline} />}

      {/* Points */}
      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
        {Math.round(player.points_ytd ?? player.points ?? 0).toLocaleString()} pts
      </div>
    </div>
  )
}

function MatchRow({ match, playerId }) {
  const isComp1 = match.comp1_id === parseInt(playerId)
  const result  = isComp1 ? match.result : (match.result === 'W' ? 'L' : 'W')
  const oppName = isComp1 ? match.comp2_name : match.comp1_name
  const scores  = match.game_scores || match.match_score || '—'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 10px', borderRadius: 8,
      background: result === 'W' ? 'rgba(22,163,74,0.05)' : 'rgba(220,38,38,0.04)',
      border: result === 'W' ? '1px solid rgba(22,163,74,0.15)' : '1px solid rgba(220,38,38,0.12)',
      marginBottom: 4,
    }}>
      <span style={{ fontSize: 13, fontWeight: 800, width: 16, color: result === 'W' ? '#16a34a' : '#dc2626' }}>
        {result === 'W' ? '✓' : '✗'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {oppName || 'Unknown'}
        </div>
        <div style={{ fontSize: 10, color: '#94a3b8' }}>
          {match.event_name || ''} · {match.event_date || ''}
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#64748b', textAlign: 'right', flexShrink: 0 }}>
        {scores}
      </div>
    </div>
  )
}

function DoublesMatchRow({ match }) {
  const result = match.result_player
  const scores = match.game_scores || match.match_score || '—'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 10px', borderRadius: 8,
      background: result === 'W' ? 'rgba(22,163,74,0.05)' : 'rgba(220,38,38,0.04)',
      border: result === 'W' ? '1px solid rgba(22,163,74,0.15)' : '1px solid rgba(220,38,38,0.12)',
      marginBottom: 4,
    }}>
      <span style={{ fontSize: 13, fontWeight: 800, width: 16, color: result === 'W' ? '#16a34a' : '#dc2626' }}>
        {result === 'W' ? '✓' : '✗'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          vs {match.opp_name}
        </div>
        <div style={{ fontSize: 10, color: '#94a3b8' }}>
          {match.round_phase || ''}{match.round_phase && match.event_date ? ' · ' : ''}{match.event_date || ''}
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#64748b', textAlign: 'right', flexShrink: 0 }}>
        {scores}
      </div>
    </div>
  )
}

function PlayerProfile({ player, isDoubles, onClose }) {
  const [history, setHistory]   = useState([])
  const [matches, setMatches]   = useState([])
  const [loading, setLoading]   = useState(true)

  const ittfId = isDoubles ? player.ittf_id1 : player.ittf_id

  useEffect(() => {
    if (!ittfId) return
    let cancelled = false
    setLoading(true)

    async function load() {
      // Ranking history
      const table = isDoubles ? 'youth_rankings_doubles' : 'youth_rankings_singles'
      const { data: hist } = await supabase
        .from(table)
        .select('ranking_year, ranking_week, publish_date, age_cat_rank, current_rank, points_ytd, points, rank_diff')
        .eq(isDoubles ? 'ittf_id1' : 'ittf_id', ittfId)
        .eq('sub_event', player.sub_event)
        .order('ranking_year', { ascending: true })
        .order('ranking_week', { ascending: true })
        .limit(200)

      // Match history
      let matchData = []
      const numId = parseInt(ittfId)
      if (!isDoubles) {
        const [{ data: asComp1 }, { data: asComp2 }] = await Promise.all([
          supabase.from('wtt_matches_singles')
            .select('match_id, comp1_id, comp2_id, result, game_scores, match_score, event_date, event_id')
            .eq('comp1_id', numId)
            .not('age_group', 'is', null)
            .order('event_date', { ascending: false })
            .limit(30),
          supabase.from('wtt_matches_singles')
            .select('match_id, comp1_id, comp2_id, result, game_scores, match_score, event_date, event_id')
            .eq('comp2_id', numId)
            .not('age_group', 'is', null)
            .order('event_date', { ascending: false })
            .limit(30),
        ])
        matchData = [...(asComp1 || []), ...(asComp2 || [])]
          .sort((a, b) => new Date(b.event_date) - new Date(a.event_date))
          .slice(0, 40)

        // Fetch opponent names
        const oppIds = [...new Set(matchData.map(m =>
          m.comp1_id === numId ? m.comp2_id : m.comp1_id
        ))]
        if (oppIds.length > 0) {
          const { data: pls } = await supabase
            .from('wtt_players')
            .select('ittf_id, player_name')
            .in('ittf_id', oppIds)
          const pMap = Object.fromEntries((pls || []).map(p => [p.ittf_id, p.player_name]))
          matchData = matchData.map(m => ({
            ...m,
            comp1_name: m.comp1_id === numId ? player.player_name : pMap[m.comp1_id],
            comp2_name: m.comp2_id === numId ? player.player_name : pMap[m.comp2_id],
          }))
        }
      } else {
        // Doubles: query wtt_matches_doubles by any of the 4 pair-player slots
        const { data: dbMatches } = await supabase
          .from('wtt_matches_doubles')
          .select('match_id, comp1_p1_id, comp1_p2_id, comp2_p1_id, comp2_p2_id, result, game_scores, match_score, event_date, round_phase')
          .or(`comp1_p1_id.eq.${numId},comp1_p2_id.eq.${numId},comp2_p1_id.eq.${numId},comp2_p2_id.eq.${numId}`)
          .order('event_date', { ascending: false })
          .limit(40)

        if (dbMatches?.length) {
          // Collect all opponent IDs
          const oppIdSet = new Set()
          for (const m of dbMatches) {
            const onComp1 = m.comp1_p1_id === numId || m.comp1_p2_id === numId
            if (onComp1) { oppIdSet.add(m.comp2_p1_id); oppIdSet.add(m.comp2_p2_id) }
            else         { oppIdSet.add(m.comp1_p1_id); oppIdSet.add(m.comp1_p2_id) }
          }
          oppIdSet.delete(null); oppIdSet.delete(undefined)

          const { data: pls } = await supabase
            .from('wtt_players')
            .select('ittf_id, player_name')
            .in('ittf_id', [...oppIdSet])
          const pMap = Object.fromEntries((pls || []).map(p => [p.ittf_id, p.player_name]))

          matchData = dbMatches.map(m => {
            const onComp1 = m.comp1_p1_id === numId || m.comp1_p2_id === numId
            const result_player = onComp1 ? m.result : (m.result === 'W' ? 'L' : 'W')
            const opp1Id = onComp1 ? m.comp2_p1_id : m.comp1_p1_id
            const opp2Id = onComp1 ? m.comp2_p2_id : m.comp1_p2_id
            const opp_name = [pMap[opp1Id], pMap[opp2Id]].filter(Boolean).join(' / ') || 'Unknown pair'
            return { ...m, result_player, opp_name }
          })
        }
      }

      if (!cancelled) {
        setHistory(hist || [])
        setMatches(matchData)
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [ittfId, player.sub_event, isDoubles])

  const chartData = history.map(h => ({
    label: `W${h.ranking_week}/${h.ranking_year}`,
    rank:  h.age_cat_rank || h.current_rank,
    world: h.current_rank,
  })).filter(d => d.rank)

  const bestRank  = history.length ? Math.min(...history.map(h => h.age_cat_rank || h.current_rank).filter(Boolean)) : null
  const firstRank = history[0]?.age_cat_rank || history[0]?.current_rank
  const lastRank  = history[history.length - 1]?.age_cat_rank || history[history.length - 1]?.current_rank
  const improvement = firstRank && lastRank ? firstRank - lastRank : null

  const wins = isDoubles
    ? matches.filter(m => m.result_player === 'W')
    : matches.filter(m => (m.comp1_id === parseInt(ittfId) ? m.result : (m.result === 'W' ? 'L' : 'W')) === 'W')
  const losses = isDoubles
    ? matches.filter(m => m.result_player === 'L')
    : matches.filter(m => (m.comp1_id === parseInt(ittfId) ? m.result : (m.result === 'W' ? 'L' : 'W')) === 'L')

  const name = isDoubles
    ? `${player.player_name1} / ${player.player_name2}`
    : player.player_name
  const badge = PIPELINE_BADGE[player.age_category] || PIPELINE_BADGE.U11

  return (
    <div style={{
      background: 'rgba(255,255,255,0.92)',
      backdropFilter: 'blur(18px)',
      borderRadius: 18,
      border: '1px solid rgba(30,70,160,0.12)',
      boxShadow: '0 8px 40px rgba(30,70,160,0.12)',
      padding: '24px 24px 20px',
      marginTop: 4,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', marginBottom: 4 }}>{name}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
              background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`,
            }}>{badge.label}</span>
            <span style={{ fontSize: 11, color: '#64748b' }}>
              {DISC_LABEL[player.sub_event]} · {player.age_category}
            </span>
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: '1px solid #e2e8f0', borderRadius: 8,
          padding: '4px 10px', fontSize: 12, color: '#64748b', cursor: 'pointer',
        }}>Close</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '30px 0' }}>Loading…</div>
      ) : (
        <>
          {/* Quick stats */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
            {[
              { label: 'Current Age Cat Rank', value: `#${player.age_cat_rank ?? '—'}` },
              { label: 'Current World Rank',   value: `#${player.current_rank ?? '—'}` },
              { label: 'Best Rank (history)',  value: bestRank ? `#${bestRank}` : '—' },
              { label: 'Improvement (all time)', value: improvement != null
                ? (improvement > 0 ? `↑${improvement}` : improvement < 0 ? `↓${Math.abs(improvement)}` : '—')
                : '—',
                color: improvement > 0 ? '#16a34a' : improvement < 0 ? '#ef4444' : '#64748b',
              },
              { label: isDoubles ? 'Doubles Matches' : 'Youth Matches', value: matches.length },
              { label: 'Win Rate', value: matches.length ? `${Math.round(wins.length / matches.length * 100)}%` : '—' },
            ].map(s => (
              <div key={s.label} style={{
                background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10,
                padding: '10px 14px', minWidth: 90,
              }}>
                <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: s.color || '#0f172a' }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Ranking chart */}
          {chartData.length > 1 && (
            <div style={{ marginBottom: 22 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: 2,
                textTransform: 'uppercase', marginBottom: 10 }}>
                Age Category Rank — {history.length} weeks
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}   />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#94a3b8' }}
                    interval={Math.floor(chartData.length / 6)} />
                  <YAxis reversed tick={{ fontSize: 9, fill: '#94a3b8' }}
                    domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                    formatter={(v, n) => [`#${v}`, n === 'rank' ? 'Age Cat Rank' : 'World Rank']}
                  />
                  <Area type="monotone" dataKey="rank" stroke="#3b82f6" strokeWidth={2}
                    fill="url(#rg)" dot={false} name="rank" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Match history */}
          {matches.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: 2,
                textTransform: 'uppercase', marginBottom: 10 }}>
                Recent {isDoubles ? 'Doubles' : 'Youth'} Matches — {wins.length}W {losses.length}L
              </div>
              {matches.slice(0, 20).map(m =>
                isDoubles
                  ? <DoublesMatchRow key={m.match_id} match={m} />
                  : <MatchRow key={m.match_id} match={m} playerId={ittfId} />
              )}
            </div>
          )}

          {matches.length === 0 && (
            <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '12px 0' }}>
              No youth {isDoubles ? 'doubles ' : ''}match data available for this player.
            </p>
          )}
        </>
      )}
    </div>
  )
}

export default function YouthPipelinePage() {
  const [singles, setSingles]           = useState([])
  const [doubles, setDoubles]           = useState([])
  const [sparklines, setSparklines]     = useState({})
  const [loading, setLoading]           = useState(true)
  const [filterAge, setFilterAge]       = useState('all')
  const [filterDisc, setFilterDisc]     = useState('all')
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [selectedIsDoubles, setSelectedIsDoubles] = useState(false)

  useEffect(() => {
    async function fetchAll() {
      setLoading(true)

      // Latest singles snapshot for India
      const { data: latestSinglesRow } = await supabase
        .from('youth_rankings_singles')
        .select('ranking_year, ranking_week')
        .eq('country_code', 'IND')
        .order('ranking_year', { ascending: false })
        .order('ranking_week', { ascending: false })
        .limit(1)
      const ls = latestSinglesRow?.[0]

      // Latest doubles snapshot for India
      const { data: latestDoublesRow } = await supabase
        .from('youth_rankings_doubles')
        .select('ranking_year, ranking_week')
        .or('country_code1.eq.IND,country_code2.eq.IND')
        .order('ranking_year', { ascending: false })
        .order('ranking_week', { ascending: false })
        .limit(1)
      const ld = latestDoublesRow?.[0]

      const [singlesRes, doublesRes] = await Promise.all([
        ls ? supabase.from('youth_rankings_singles')
          .select('*')
          .eq('country_code', 'IND')
          .eq('ranking_year', ls.ranking_year)
          .eq('ranking_week', ls.ranking_week)
          .order('age_category').order('sub_event').order('age_cat_rank', { ascending: true })
          .limit(500) : { data: [] },

        ld ? supabase.from('youth_rankings_doubles')
          .select('*')
          .or('country_code1.eq.IND,country_code2.eq.IND')
          .eq('ranking_year', ld.ranking_year)
          .eq('ranking_week', ld.ranking_week)
          .order('age_category').order('sub_event').order('age_cat_rank', { ascending: true })
          .limit(500) : { data: [] },
      ])

      // Filter out stray MDI/WDI/XDI rows from singles table — real doubles data is in youth_rankings_doubles
      setSingles((singlesRes.data || []).filter(p => !['MDI','WDI','XDI'].includes(p.sub_event)))
      setDoubles(doublesRes.data || [])
      setLoading(false)

      // Fetch sparklines — last 12 weeks per player (singles only, for perf)
      if (singlesRes.data?.length) {
        const ids = [...new Set(singlesRes.data.map(p => p.ittf_id))]
        const { data: hist } = await supabase
          .from('youth_rankings_singles')
          .select('ittf_id, sub_event, ranking_year, ranking_week, age_cat_rank, current_rank')
          .eq('country_code', 'IND')
          .order('ranking_year', { ascending: true })
          .order('ranking_week', { ascending: true })
          .limit(5000)

        const map = {}
        for (const h of (hist || [])) {
          const key = `${h.ittf_id}__${h.sub_event}`
          if (!map[key]) map[key] = []
          map[key].push({ rank: h.age_cat_rank || h.current_rank })
        }
        setSparklines(map)
      }
    }
    fetchAll()
  }, [])

  const allPlayers = useMemo(() => {
    const s = singles.map(p => ({ ...p, _type: 'singles' }))
    const d = doubles.map(p => ({ ...p, _type: 'doubles' }))
    return [...s, ...d]
  }, [singles, doubles])

  const filtered = useMemo(() => {
    return allPlayers.filter(p => {
      if (filterAge !== 'all' && p.age_category !== filterAge) return false
      if (filterDisc !== 'all' && p.sub_event !== filterDisc) return false
      return true
    })
  }, [allPlayers, filterAge, filterDisc])

  // Group by age_category for display
  const grouped = useMemo(() => {
    const map = {}
    for (const p of filtered) {
      if (!map[p.age_category]) map[p.age_category] = []
      map[p.age_category].push(p)
    }
    return map
  }, [filtered])

  const navigate = useNavigate()

  function selectPlayer(p) {
    const isDoubles = p._type === 'doubles'
    const id = isDoubles ? p.ittf_id1 : p.ittf_id
    if (!id) return
    navigate(`/player/${id}?sub=${p.sub_event}&age=${p.age_category}`)
  }

  const totalIndia   = allPlayers.length
  const singlesCount = singles.length
  const doublesCount = doubles.length
  const topRanked    = allPlayers.filter(p => (p.age_cat_rank || p.current_rank) <= 10).length

  return (
    <>
      <PageBackground />
      <div style={{ position: 'relative', zIndex: 4, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <AuthBar />
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px 48px' }}>

          {/* ── Header ── */}
          <div style={{ marginBottom: 24 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12,
              background: 'rgba(255,255,255,0.82)',
              backdropFilter: 'blur(18px)',
              WebkitBackdropFilter: 'blur(18px)',
              border: '1px solid rgba(30,70,160,0.08)',
              borderRadius: 14,
              padding: '16px 20px',
            }}>
              <div>
                <p style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 }}>
                  TOPS · Table Tennis
                </p>
                <h1 style={{ fontSize: 26, fontWeight: 900, color: '#0f172a', margin: 0, letterSpacing: -0.5 }}>
                  India Youth Pipeline
                </h1>
                <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                  All Indian youth players ranked internationally · U11 → U19
                </p>
              </div>
              <a href="/" style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none', marginTop: 8, fontWeight: 600 }}>
                ← Senior Dashboard
              </a>
            </div>

            {/* Summary stats */}
            {!loading && (
              <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                {[
                  { label: 'Total players', value: totalIndia },
                  { label: 'Singles', value: singlesCount },
                  { label: 'Doubles', value: doublesCount },
                  { label: 'Top 10 ranked', value: topRanked, highlight: true },
                ].map(s => (
                  <div key={s.label} style={{
                    background: s.highlight ? 'rgba(22,163,74,0.08)' : 'rgba(255,255,255,0.75)',
                    border: s.highlight ? '1px solid rgba(22,163,74,0.2)' : '1px solid rgba(30,70,160,0.10)',
                    borderRadius: 12, padding: '10px 16px', backdropFilter: 'blur(12px)',
                  }}>
                    <div style={{ fontSize: 9, color: s.highlight ? '#16a34a' : '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>
                      {s.label}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: s.highlight ? '#16a34a' : '#0f172a' }}>
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Filters ── */}
          <div style={{
            background: 'rgba(255,255,255,0.82)', backdropFilter: 'blur(18px)',
            border: '1px solid rgba(30,70,160,0.08)', borderRadius: 14,
            padding: '14px 16px', marginBottom: 20,
          }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              {/* Age group */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['all', ...AGE_GROUPS].map(ag => (
                  <button key={ag} onClick={() => setFilterAge(ag)}
                    style={{
                      fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 20,
                      border: filterAge === ag ? '1px solid #1d4ed8' : '1px solid #e2e8f0',
                      background: filterAge === ag ? '#1d4ed8' : 'white',
                      color: filterAge === ag ? 'white' : '#64748b',
                      cursor: 'pointer',
                    }}>
                    {ag === 'all' ? 'All Ages' : ag}
                  </button>
                ))}
              </div>
              <div style={{ width: 1, height: 20, background: '#e2e8f0' }} />
              {/* Discipline */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[{ code: 'all', label: 'All Events' }, ...DISCIPLINES].map(d => (
                  <button key={d.code} onClick={() => setFilterDisc(d.code)}
                    style={{
                      fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 20,
                      border: filterDisc === d.code ? '1px solid #334155' : '1px solid #e2e8f0',
                      background: filterDisc === d.code ? '#334155' : 'white',
                      color: filterDisc === d.code ? 'white' : '#64748b',
                      cursor: 'pointer',
                    }}>
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Top 64 Chart ── */}
          <Top64Chart ageGroup={filterAge} />

          {/* ── Content ── */}
          {loading ? (
            <div style={{ textAlign: 'center', color: '#94a3b8', padding: '60px 0', fontSize: 14 }}>
              Loading India youth players…
            </div>
          ) : (
            <>
              {AGE_GROUPS.filter(ag => filterAge === 'all' || filterAge === ag).map(ag => {
                const players = grouped[ag]
                if (!players?.length) return null
                const badge = PIPELINE_BADGE[ag]
                return (
                  <div key={ag} style={{ marginBottom: 32 }}>
                    {/* Age group header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                      <div style={{
                        fontSize: 16, fontWeight: 800, color: '#0f172a',
                      }}>{ag}</div>
                      <div style={{
                        fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                        background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`,
                      }}>{badge.label}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{players.length} players</div>
                    </div>

                    {/* Cards grid */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                      gap: 10,
                    }}>
                      {players.map((p, i) => {
                        const isDoubles = p._type === 'doubles'
                        const key = `${p.ittf_id ?? p.ittf_id1}__${p.sub_event}`
                        const sparkline = sparklines[key] || []
                        return (
                          <PlayerCard
                            key={`${p.ittf_id ?? p.pair_id}__${p.sub_event}__${i}`}
                            player={{ ...p, sparkline }}
                            isDoubles={isDoubles}
                            onClick={() => selectPlayer(p)}
                            selected={false}
                          />
                        )
                      })}
                    </div>
                  </div>
                )
              })}

              {filtered.length === 0 && (
                <div style={{ textAlign: 'center', color: '#94a3b8', padding: '40px 0', fontSize: 14 }}>
                  No players found for selected filters.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
