import { useState, useEffect, useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import AuthBar from '../components/AuthBar.jsx'
import PageBackground from '../components/PageBackground.jsx'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react'

// ─── Constants ───────────────────────────────────────────────────────────────

const PIPELINE_BADGE = {
  U19: { label: 'LA 2028 Ready',    color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
  U17: { label: 'LA 2028 Pipeline', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  U15: { label: 'LA 2032 Pipeline', color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  U13: { label: 'Emerging',         color: '#7c3aed', bg: '#faf5ff', border: '#e9d5ff' },
  U11: { label: 'Grassroots',       color: '#64748b', bg: '#f8fafc', border: '#e2e8f0' },
}

const DISC_LABEL = {
  MS: 'Boys Singles', WS: 'Girls Singles',
  MD: 'Boys Doubles', WD: 'Girls Doubles', XD: 'Mixed Doubles',
}

const ROUND_DEPTH = {
  'Final': 0, 'Semi-Final': 1, 'Quarter-Final': 2,
  'Round of 16': 3, 'Round of 32': 4, 'Round of 64': 5,
  'Round of 128': 6, 'Group Stage': 7,
}

const WL_FILTERS = [
  { id: 'round',      label: 'By Round'    },
  { id: 'country',   label: 'By Country'  },
  { id: 'competitor', label: 'By Opponent' },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cleanRound(r) {
  if (!r || r === 'N/A') return null
  const rofMatch = r.match(/Round of \d+/i)
  if (rofMatch) return rofMatch[0]
  const low = r.toLowerCase()
  if (low.includes('semifinal') || low.includes('semi-final') || low.includes('semi final')) return 'Semi-Final'
  if (low.includes('quarterfinal') || low.includes('quarter-final') || low.includes('quarter final')) return 'Quarter-Final'
  if (low.includes('final')) return 'Final'
  if (low.includes('group')) return 'Group Stage'
  if (low.includes('qualifying')) return 'Qualifying'
  const parts = r.split(' - ')
  return parts.length > 1 ? parts[parts.length - 2] || null : r
}

function calcAge(dob) {
  if (!dob) return null
  const b = new Date(dob)
  const today = new Date()
  let age = today.getFullYear() - b.getFullYear()
  const m = today.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--
  return age
}

function cleanEventName(name) {
  if (!name) return 'Unknown'
  return name.replace(/\s+presented\s+by\s+.*/i, '').trim()
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function WindowToggle({ value, onChange }) {
  return (
    <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
      {['6M', '12M', 'All'].map(w => (
        <button key={w} onClick={() => onChange(w)}
          className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
            value === w ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
          {w}
        </button>
      ))}
    </div>
  )
}

function WLRow({ label, wins, losses, isOpen, onToggle, children }) {
  const total = wins + losses
  const winPct = total ? (wins / total) * 100 : 0
  return (
    <>
      <tr
        onClick={() => total > 0 && onToggle()}
        style={{ cursor: total > 0 ? 'pointer' : 'default', borderBottom: '0.5px solid #f1f5f9' }}
        className="transition-colors hover:bg-slate-50/60">
        <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 500, color: '#1e293b', whiteSpace: 'nowrap' }}>{label}</td>
        <td style={{ padding: '10px 14px' }}>
          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: '#f1f5f9' }}>
            <div style={{ width: `${winPct}%`, background: '#3b82f6', transition: 'width 0.5s' }} />
            <div style={{ width: `${100 - winPct}%`, background: '#fca5a5', transition: 'width 0.5s' }} />
          </div>
        </td>
        <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12 }}>
          <span style={{ color: '#059669', fontWeight: 600 }}>{wins}W</span>
          <span style={{ color: '#94a3b8' }}> / </span>
          <span style={{ color: '#f87171', fontWeight: 600 }}>{losses}L</span>
          {total > 0 && <span style={{ color: '#94a3b8', marginLeft: 6 }}>{winPct.toFixed(0)}%</span>}
        </td>
      </tr>
      {isOpen && (
        <tr style={{ background: 'rgba(239,246,255,0.4)' }}>
          <td colSpan={3} style={{ padding: '8px 14px' }}>
            {children}
          </td>
        </tr>
      )}
    </>
  )
}

function MatchMiniRow({ match }) {
  const result = match.player_result
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '5px 8px', borderRadius: 6,
      background: result === 'W' ? 'rgba(22,163,74,0.04)' : 'rgba(220,38,38,0.03)',
      marginBottom: 3,
    }}>
      <span style={{ fontSize: 11, fontWeight: 800, width: 14, color: result === 'W' ? '#16a34a' : '#dc2626' }}>
        {result === 'W' ? '✓' : '✗'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#1e293b' }}>{match.opp_name || 'Unknown'}</span>
        {match.round && (
          <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 6 }}>{match.round}</span>
        )}
      </div>
      <span style={{ fontSize: 11, color: '#64748b', flexShrink: 0 }}>{match.game_scores || match.match_score || '—'}</span>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PlayerPage() {
  const { ittf_id } = useParams()
  const [searchParams] = useSearchParams()
  const subEvent    = searchParams.get('sub') || 'MS'
  const ageCategory = searchParams.get('age') || null
  const isDoubles   = ['MD', 'WD', 'XD', 'MDI', 'WDI', 'XDI'].includes(subEvent)
  const numId       = parseInt(ittf_id)

  const [playerInfo,  setPlayerInfo]  = useState(null)
  const [partnerInfo, setPartnerInfo] = useState(null)
  const [rankHistory, setRankHistory] = useState([])
  const [matches,     setMatches]     = useState([])
  const [events,      setEvents]      = useState({})
  const [loading,     setLoading]     = useState(true)
  const [activeTab,   setActiveTab]   = useState('rank')
  const [rankWindow,  setRankWindow]  = useState('All')
  const [wlFilter,    setWlFilter]    = useState('round')
  const [openRow,     setOpenRow]     = useState(null)
  const [openPerfSec, setOpenPerfSec] = useState(null)

  useEffect(() => {
    if (!numId) return
    let cancelled = false
    setLoading(true)
    setRankHistory([])
    setMatches([])

    async function load() {
      // 1. Player info
      const { data: pls } = await supabase
        .from('wtt_players')
        .select('ittf_id, player_name, dob, country_code, handedness, grip')
        .eq('ittf_id', numId)
        .limit(1)
      const info = pls?.[0] || null

      // 2. Ranking history
      const rankTable  = isDoubles ? 'youth_rankings_doubles' : 'youth_rankings_singles'
      const rankIdCol  = isDoubles ? 'ittf_id1' : 'ittf_id'
      const rankCols   = isDoubles
        ? 'ranking_year, ranking_week, publish_date, current_rank, points, rank_diff, age_category, ittf_id2'
        : 'ranking_year, ranking_week, publish_date, age_cat_rank, current_rank, points_ytd, rank_diff, age_category'
      const { data: hist } = await supabase.from(rankTable)
        .select(rankCols)
        .eq(rankIdCol, numId)
        .eq('sub_event', subEvent)
        .order('ranking_year', { ascending: true })
        .order('ranking_week', { ascending: true })
        .limit(300)

      // Partner info for doubles
      let partner = null
      if (isDoubles && hist?.length) {
        const partnerId = parseInt(hist[0].ittf_id2)
        if (partnerId) {
          const { data: pd } = await supabase
            .from('wtt_players')
            .select('ittf_id, player_name, country_code')
            .eq('ittf_id', partnerId)
            .limit(1)
          partner = pd?.[0] || null
        }
      }

      // 3. Match history
      let matchData = []
      if (!isDoubles) {
        const [{ data: asComp1 }, { data: asComp2 }] = await Promise.all([
          supabase.from('wtt_matches_singles')
            .select('match_id, comp1_id, comp2_id, result, game_scores, match_score, event_date, event_id, round_phase, age_group')
            .eq('comp1_id', numId)
            .not('age_group', 'is', null)
            .order('event_date', { ascending: false })
            .limit(60),
          supabase.from('wtt_matches_singles')
            .select('match_id, comp1_id, comp2_id, result, game_scores, match_score, event_date, event_id, round_phase, age_group')
            .eq('comp2_id', numId)
            .not('age_group', 'is', null)
            .order('event_date', { ascending: false })
            .limit(60),
        ])
        matchData = [...(asComp1 || []), ...(asComp2 || [])]
          .sort((a, b) => new Date(b.event_date) - new Date(a.event_date))
          .slice(0, 100)

        // Opponent names
        const oppIds = [...new Set(matchData.map(m => m.comp1_id === numId ? m.comp2_id : m.comp1_id))]
        let oppMap = {}
        if (oppIds.length) {
          const { data: opps } = await supabase
            .from('wtt_players').select('ittf_id, player_name, country_code')
            .in('ittf_id', oppIds)
          oppMap = Object.fromEntries((opps || []).map(p => [p.ittf_id, p]))
        }

        // Event names
        const eventIds = [...new Set(matchData.map(m => m.event_id).filter(Boolean))]
        let evtMap = {}
        if (eventIds.length) {
          const { data: evts } = await supabase
            .from('wtt_events').select('event_id, event_name')
            .in('event_id', eventIds)
          evtMap = Object.fromEntries((evts || []).map(e => [e.event_id, e.event_name]))
        }

        matchData = matchData.map(m => {
          const onComp1 = m.comp1_id === numId
          const oppId = onComp1 ? m.comp2_id : m.comp1_id
          const opp = oppMap[oppId]
          return {
            ...m,
            opp_name:      opp?.player_name || `Player ${oppId}`,
            opp_country:   opp?.country_code || '—',
            player_result: onComp1 ? m.result : (m.result === 'W' ? 'L' : 'W'),
            round:         cleanRound(m.round_phase),
            event_name:    cleanEventName(evtMap[m.event_id]),
          }
        })
        if (!cancelled) setEvents(evtMap)
      } else {
        // Doubles
        const { data: dbm } = await supabase
          .from('wtt_matches_doubles')
          .select('match_id, comp1_p1_id, comp1_p2_id, comp2_p1_id, comp2_p2_id, result, game_scores, match_score, event_date, round_phase')
          .or(`comp1_p1_id.eq.${numId},comp1_p2_id.eq.${numId},comp2_p1_id.eq.${numId},comp2_p2_id.eq.${numId}`)
          .order('event_date', { ascending: false })
          .limit(80)

        if (dbm?.length) {
          const oppIdSet = new Set()
          for (const m of dbm) {
            const onComp1 = m.comp1_p1_id === numId || m.comp1_p2_id === numId
            if (onComp1) { oppIdSet.add(m.comp2_p1_id); oppIdSet.add(m.comp2_p2_id) }
            else         { oppIdSet.add(m.comp1_p1_id); oppIdSet.add(m.comp1_p2_id) }
          }
          oppIdSet.delete(null); oppIdSet.delete(undefined)
          const { data: opps } = await supabase
            .from('wtt_players').select('ittf_id, player_name, country_code')
            .in('ittf_id', [...oppIdSet])
          const pMap = Object.fromEntries((opps || []).map(p => [p.ittf_id, p]))

          matchData = dbm.map(m => {
            const onComp1 = m.comp1_p1_id === numId || m.comp1_p2_id === numId
            const o1 = pMap[onComp1 ? m.comp2_p1_id : m.comp1_p1_id]
            const o2 = pMap[onComp1 ? m.comp2_p2_id : m.comp1_p2_id]
            return {
              ...m,
              opp_name:      [o1?.player_name, o2?.player_name].filter(Boolean).join(' / ') || 'Unknown',
              opp_country:   o1?.country_code || '—',
              player_result: onComp1 ? m.result : (m.result === 'W' ? 'L' : 'W'),
              round:         cleanRound(m.round_phase),
              event_name:    'Youth Doubles',
            }
          })
        }
      }

      if (!cancelled) {
        setPlayerInfo(info)
        setPartnerInfo(partner)
        setRankHistory(hist || [])
        setMatches(matchData)
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [numId, subEvent, ageCategory, isDoubles])

  // ── Derived data ─────────────────────────────────────────────────────────

  const chartData = useMemo(() => {
    const cutoff = rankWindow === 'All' ? null : (() => {
      const d = new Date()
      d.setMonth(d.getMonth() - parseInt(rankWindow))
      return d
    })()
    return rankHistory
      .filter(h => !cutoff || new Date(h.publish_date) >= cutoff)
      .map(h => ({
        x:     new Date(h.publish_date).getTime(),
        rank:  h.age_cat_rank || h.current_rank,
        world: h.current_rank,
        label: h.publish_date?.slice(5),
      }))
      .filter(d => d.rank)
  }, [rankHistory, rankWindow])

  const wins   = useMemo(() => matches.filter(m => m.player_result === 'W'), [matches])
  const losses = useMemo(() => matches.filter(m => m.player_result === 'L'), [matches])

  const currentRank      = rankHistory[rankHistory.length - 1]?.age_cat_rank
  const worldRank        = rankHistory[rankHistory.length - 1]?.current_rank
  const peakRank         = rankHistory.length ? Math.min(...rankHistory.map(h => h.age_cat_rank || h.current_rank).filter(Boolean)) : null
  const firstInWindow    = chartData[0]?.rank
  const lastInWindow     = chartData[chartData.length - 1]?.rank
  const rankChange       = firstInWindow && lastInWindow ? firstInWindow - lastInWindow : null

  const currentAgeCat    = ageCategory || rankHistory[rankHistory.length - 1]?.age_category
  const badge            = PIPELINE_BADGE[currentAgeCat] || PIPELINE_BADGE.U11
  const age              = calcAge(playerInfo?.dob)

  const name = isDoubles && partnerInfo
    ? `${playerInfo?.player_name || '…'} / ${partnerInfo.player_name}`
    : playerInfo?.player_name || `Player ${ittf_id}`

  const style = [
    playerInfo?.handedness?.replace(' Hand', ''),
    playerInfo?.grip,
  ].filter(Boolean).join(' · ')

  // Win/Loss breakdowns
  const byRound = useMemo(() => {
    const map = {}
    for (const m of matches) {
      const r = m.round || 'Other'
      if (!map[r]) map[r] = { w: 0, l: 0, matches: [] }
      if (m.player_result === 'W') map[r].w++
      else if (m.player_result === 'L') map[r].l++
      map[r].matches.push(m)
    }
    return Object.entries(map).sort(([a], [b]) => (ROUND_DEPTH[a] ?? 99) - (ROUND_DEPTH[b] ?? 99))
  }, [matches])

  const byCountry = useMemo(() => {
    const map = {}
    for (const m of matches) {
      const c = m.opp_country || '—'
      if (!map[c]) map[c] = { w: 0, l: 0, matches: [] }
      if (m.player_result === 'W') map[c].w++
      else if (m.player_result === 'L') map[c].l++
      map[c].matches.push(m)
    }
    return Object.entries(map).sort(([, a], [, b]) => (b.w + b.l) - (a.w + a.l))
  }, [matches])

  const byCompetitor = useMemo(() => {
    const map = {}
    for (const m of matches) {
      const n = m.opp_name || 'Unknown'
      if (!map[n]) map[n] = { w: 0, l: 0, matches: [] }
      if (m.player_result === 'W') map[n].w++
      else if (m.player_result === 'L') map[n].l++
      map[n].matches.push(m)
    }
    return Object.entries(map).sort(([, a], [, b]) => (b.w + b.l) - (a.w + a.l))
  }, [matches])

  const perfMetrics = useMemo(() => {
    if (!matches.length) return null
    let straightWins = 0, straightLosses = 0, comebacks = 0
    let clutchWins = 0, clutchTotal = 0
    let totalPlayerPts = 0, totalOppPts = 0, totalGames = 0
    const depthMap = {
      early:  { label: 'Early Rounds', rounds: new Set(['Group Stage', 'Round of 128', 'Round of 64', 'Round of 32', 'Qualifying']), w: 0, l: 0 },
      qfsf:   { label: 'QF / SF',      rounds: new Set(['Quarter-Final', 'Semi-Final']), w: 0, l: 0 },
      finals: { label: 'Finals',       rounds: new Set(['Final']), w: 0, l: 0 },
    }
    for (const m of matches) {
      const onComp1 = m.comp1_id === numId
      const parts = m.match_score?.split('-').map(Number)
      if (parts?.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        const pg = onComp1 ? parts[0] : parts[1]
        const og = onComp1 ? parts[1] : parts[0]
        if (m.player_result === 'W' && og === 0) straightWins++
        if (m.player_result === 'L' && pg === 0) straightLosses++
        if (pg + og === 5) { clutchTotal++; if (m.player_result === 'W') clutchWins++ }
      }
      const games = (m.game_scores || '').split(',')
        .map(s => s.trim().split('-').map(Number))
        .filter(g => g.length === 2 && !isNaN(g[0]) && !isNaN(g[1]) && g[0] + g[1] > 0)
      for (const g of games) {
        const pp = onComp1 ? g[0] : g[1]
        const op = onComp1 ? g[1] : g[0]
        totalPlayerPts += pp; totalOppPts += op; totalGames++
      }
      if (m.player_result === 'W' && games.length >= 2) {
        const g1p = onComp1 ? games[0][0] : games[0][1]
        const g1o = onComp1 ? games[0][1] : games[0][0]
        if (g1p < g1o) comebacks++
      }
      if (m.round) {
        for (const bucket of Object.values(depthMap)) {
          if (bucket.rounds.has(m.round)) {
            if (m.player_result === 'W') bucket.w++; else bucket.l++
          }
        }
      }
    }
    return {
      straightWins, straightLosses, comebacks,
      clutchIndex: clutchTotal >= 3 ? (clutchWins / clutchTotal) * 100 : null,
      clutchWins, clutchTotal,
      currentForm: matches.slice(0, 10).map(m => m.player_result),
      avgPtDiff: totalGames > 0 ? (totalPlayerPts - totalOppPts) / totalGames : null,
      ppg: totalGames > 0 ? totalPlayerPts / totalGames : null,
      tournamentDepth: Object.values(depthMap),
    }
  }, [matches, numId])

  // Matches grouped by event
  const matchGroups = useMemo(() => {
    const map = {}
    for (const m of matches) {
      const key = m.event_id || m.event_name || 'unknown'
      if (!map[key]) map[key] = { name: m.event_name || 'Unknown', date: m.event_date, matches: [] }
      map[key].matches.push(m)
    }
    return Object.values(map).sort((a, b) => new Date(b.date) - new Date(a.date))
  }, [matches])

  const TABS = [
    { id: 'rank',        label: 'Rank'        },
    { id: 'winloss',     label: 'Win / Loss'  },
    { id: 'performance', label: 'Performance' },
    { id: 'form',        label: 'Form'        },
  ]

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <PageBackground />
      <div style={{ position: 'relative', zIndex: 4, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <AuthBar />
        <div style={{ maxWidth: 780, margin: '0 auto', padding: '24px 16px 48px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Back bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'rgba(255,255,255,0.82)',
            backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
            border: '1px solid rgba(30,70,160,0.08)',
            borderRadius: 12, padding: '10px 16px',
          }}>
            <a href="/youth" style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 13, textDecoration: 'none', fontWeight: 600 }}>
              <ArrowLeft size={14} /> Youth Pipeline
            </a>
            <span style={{ color: '#e2e8f0' }}>·</span>
            <span style={{ fontSize: 13, color: '#94a3b8' }}>{name}</span>
          </div>

          {loading ? (
            <div className="bg-white border border-slate-200 rounded-xl px-5 py-16 text-center text-slate-400 text-sm">
              Loading player data…
            </div>
          ) : (
            <>
              {/* ── Player header card ── */}
              <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                  <div>
                    <p className="text-base font-semibold text-slate-800">{name}</p>
                    <p className="text-xs text-slate-400 mt-0.5 uppercase tracking-wide">
                      {DISC_LABEL[subEvent]}
                      {currentAgeCat ? ` · ${currentAgeCat}` : ''}
                      {age != null ? ` · Age ${age}` : ''}
                      {style ? ` · ${style}` : ''}
                    </p>
                    {currentAgeCat && (
                      <span style={{
                        display: 'inline-block', marginTop: 8,
                        fontSize: 10, fontWeight: 700, padding: '2px 10px', borderRadius: 20,
                        background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`,
                      }}>{badge.label}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-6 flex-wrap">
                    {[
                      { label: 'Age Cat Rank', value: currentRank ? `#${currentRank}` : '—' },
                      { label: 'World Rank',   value: worldRank   ? `#${worldRank}`   : '—' },
                      { label: 'Win Rate',     value: matches.length ? `${Math.round(wins.length / matches.length * 100)}%` : '—' },
                      { label: 'Matches',      value: matches.length || '—' },
                    ].map(s => (
                      <div key={s.label} className="text-center">
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-0.5">{s.label}</p>
                        <p className="text-xl font-bold text-slate-800">{s.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Tabbed card ── */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">

                {/* Tab bar */}
                <div className="flex border-b border-slate-100">
                  {TABS.map(tab => (
                    <button key={tab.id} onClick={() => { setActiveTab(tab.id); setOpenRow(null) }}
                      className={`flex-1 py-3.5 text-sm font-medium transition-all relative ${
                        activeTab === tab.id ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}>
                      {tab.label}
                      {activeTab === tab.id && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-800 rounded-full" />
                      )}
                    </button>
                  ))}
                </div>

                {/* ── RANK TAB ── */}
                {activeTab === 'rank' && (
                  <div className="p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-slate-500 font-medium">Is this player improving?</p>
                      <WindowToggle value={rankWindow} onChange={setRankWindow} />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                      <div className="text-center">
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-0.5">
                          {rankWindow === 'All' ? 'First ranked' : `${rankWindow} ago`}
                        </p>
                        <p className="text-xl font-bold text-slate-700">{firstInWindow ? `#${firstInWindow}` : '—'}</p>
                      </div>
                      <span style={{ fontSize: 20, color: rankChange > 0 ? '#10b981' : rankChange < 0 ? '#f87171' : '#e2e8f0' }}>→</span>
                      <div className="text-center">
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-0.5">Today</p>
                        <p className="text-xl font-bold text-slate-800">{currentRank ? `#${currentRank}` : '—'}</p>
                      </div>
                      {peakRank && (
                        <div className="text-center ml-2">
                          <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-0.5">Period peak</p>
                          <p className="text-xl font-bold text-blue-500">#{peakRank}</p>
                        </div>
                      )}
                      <div style={{ marginLeft: 'auto' }}>
                        {rankChange > 0
                          ? <span className="text-xs font-semibold px-3 py-1 rounded-full bg-emerald-50 text-emerald-700">↑ Improving</span>
                          : rankChange < 0
                          ? <span className="text-xs font-semibold px-3 py-1 rounded-full bg-red-50 text-red-500">↓ Declining</span>
                          : <span className="text-xs font-semibold px-3 py-1 rounded-full bg-slate-100 text-slate-500">— Stable</span>
                        }
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-xl p-4">
                      {chartData.length > 1 ? (
                        <ResponsiveContainer width="100%" height={200}>
                          <AreaChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: -10 }}>
                            <defs>
                              <linearGradient id="youthGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.12} />
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}    />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis dataKey="x" type="number" scale="time"
                              domain={['dataMin', 'dataMax']}
                              tickFormatter={ts => new Date(ts).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                              tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                            <YAxis reversed domain={['dataMin - 2', 'dataMax + 2']}
                              tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false}
                              tickFormatter={v => `#${Math.round(v)}`} allowDecimals={false} />
                            <Tooltip
                              cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '3 3' }}
                              contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, padding: '6px 10px' }}
                              labelFormatter={(_l, p) => p?.[0]?.payload?.label ? `Week of ${p[0].payload.label}` : ''}
                              formatter={v => [`#${v}`, 'Age Cat Rank']}
                            />
                            {peakRank && (
                              <ReferenceLine y={peakRank} stroke="#10b981" strokeDasharray="4 4" strokeWidth={1.5}
                                label={{ value: `Peak #${peakRank}`, position: 'insideTopRight', fontSize: 9, fill: '#10b981' }} />
                            )}
                            <Area type="monotone" dataKey="rank" stroke="#3b82f6" strokeWidth={2}
                              fill="url(#youthGrad)" dot={false}
                              activeDot={{ r: 4, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }}
                              isAnimationActive={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
                          Not enough data for {rankWindow} window
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── WIN/LOSS TAB ── */}
                {activeTab === 'winloss' && (
                  <div className="p-5 space-y-4">
                    <p className="text-xs text-slate-500 font-medium">Where are they winning and losing?</p>

                    {/* Filter chips */}
                    <div className="flex gap-2">
                      {WL_FILTERS.map(f => (
                        <button key={f.id} onClick={() => { setWlFilter(f.id); setOpenRow(null) }}
                          className={`text-xs font-medium px-3 py-1 rounded-full border transition-all ${
                            wlFilter === f.id
                              ? 'border-slate-700 bg-slate-800 text-white'
                              : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}>
                          {f.label}
                        </button>
                      ))}
                    </div>

                    {/* Overall summary row + table */}
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
                        <colgroup>
                          <col style={{ width: '28%' }} />
                          <col style={{ width: '40%' }} />
                          <col style={{ width: '32%' }} />
                        </colgroup>
                        <tbody>
                          {/* Overall row */}
                          <tr style={{ borderBottom: '0.5px solid #e2e8f0', background: '#f8fafc' }}>
                            <td style={{ padding: '10px 14px', verticalAlign: 'top' }}>
                              <p style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Overall</p>
                              <p style={{ fontSize: 13, fontWeight: 600 }}>
                                <span style={{ color: '#059669' }}>{wins.length}W</span>
                                <span style={{ color: '#94a3b8' }}> / </span>
                                <span style={{ color: '#f87171' }}>{losses.length}L</span>
                                {matches.length > 0 && (
                                  <span style={{ color: '#64748b', marginLeft: 6 }}>
                                    · {Math.round(wins.length / matches.length * 100)}%
                                  </span>
                                )}
                              </p>
                            </td>
                            <td style={{ padding: '10px 14px', verticalAlign: 'middle' }}>
                              <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: '#f1f5f9' }}>
                                <div style={{ width: `${matches.length ? wins.length / matches.length * 100 : 0}%`, background: '#3b82f6' }} />
                                <div style={{ flex: 1, background: '#fca5a5' }} />
                              </div>
                            </td>
                            <td style={{ padding: '10px 14px', verticalAlign: 'top', textAlign: 'right' }}>
                              <p style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Recent form</p>
                              <div style={{ display: 'flex', gap: 3, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                {matches.slice(0, 10).map((m, i) => (
                                  <div key={i} style={{
                                    width: 18, height: 18, borderRadius: '50%',
                                    fontSize: 9, fontWeight: 700,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: m.player_result === 'W' ? '#dcfce7' : '#fee2e2',
                                    color: m.player_result === 'W' ? '#16a34a' : '#dc2626',
                                  }}>
                                    {m.player_result}
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>

                          {/* By Round */}
                          {wlFilter === 'round' && byRound.map(([round, { w, l, matches: rm }]) => (
                            <WLRow key={round} label={round} wins={w} losses={l}
                              isOpen={openRow === round}
                              onToggle={() => setOpenRow(openRow === round ? null : round)}>
                              {rm.slice(0, 10).map((m, i) => <MatchMiniRow key={i} match={m} />)}
                            </WLRow>
                          ))}

                          {/* By Country */}
                          {wlFilter === 'country' && byCountry.map(([country, { w, l, matches: cm }]) => (
                            <WLRow key={country} label={country} wins={w} losses={l}
                              isOpen={openRow === country}
                              onToggle={() => setOpenRow(openRow === country ? null : country)}>
                              {cm.slice(0, 10).map((m, i) => <MatchMiniRow key={i} match={m} />)}
                            </WLRow>
                          ))}

                          {/* By Opponent */}
                          {wlFilter === 'competitor' && byCompetitor.map(([name, { w, l, matches: cm }]) => (
                            <WLRow key={name} label={name} wins={w} losses={l}
                              isOpen={openRow === name}
                              onToggle={() => setOpenRow(openRow === name ? null : name)}>
                              {cm.slice(0, 10).map((m, i) => <MatchMiniRow key={i} match={m} />)}
                            </WLRow>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ── PERFORMANCE TAB ── */}
                {activeTab === 'performance' && (
                  <div className="p-5 space-y-3">
                    {!perfMetrics ? (
                      <p style={{ textAlign: 'center', color: '#94a3b8', padding: '40px 0', fontSize: 13 }}>No match data to compute metrics.</p>
                    ) : (() => {
                      const sections = [
                        {
                          key: 'outcomes',
                          heading: 'Outcomes',
                          summary: `${Math.round(wins.length / matches.length * 100)}% win rate · Form: ${perfMetrics.currentForm.join(' ')}`,
                          items: [
                            { label: 'Win Rate',           value: `${Math.round(wins.length / matches.length * 100)}%`,    accent: wins.length / matches.length >= 0.5 ? '#10b981' : '#f87171', desc: `${wins.length}W · ${losses.length}L · ${matches.length} matches` },
                            { label: 'Avg Point Diff',     value: perfMetrics.avgPtDiff != null ? `${perfMetrics.avgPtDiff >= 0 ? '+' : ''}${perfMetrics.avgPtDiff.toFixed(1)}` : '—', accent: perfMetrics.avgPtDiff != null && perfMetrics.avgPtDiff >= 0 ? '#10b981' : '#f87171', desc: 'Average point margin per game' },
                            { label: 'Points Per Game',    value: perfMetrics.ppg != null ? perfMetrics.ppg.toFixed(1) : '—', accent: '#6366f1', desc: 'Avg points scored per game (attack volume)' },
                            { label: 'Current Form',       value: (() => { const w = perfMetrics.currentForm.filter(r => r === 'W').length; return `${w}W ${perfMetrics.currentForm.length - w}L` })(), sub: perfMetrics.currentForm.join(' '), accent: (() => { const w = perfMetrics.currentForm.filter(r => r === 'W').length; return w / Math.max(perfMetrics.currentForm.length, 1) >= 0.5 ? '#10b981' : '#f87171' })(), desc: `Last ${perfMetrics.currentForm.length} matches` },
                            { label: 'Straight-Set Wins',  value: `${perfMetrics.straightWins}`,  sub: wins.length > 0 ? `${((perfMetrics.straightWins / wins.length) * 100).toFixed(0)}% of wins` : null,   accent: '#10b981', desc: 'Won without dropping a game — dominant victories' },
                            { label: 'Straight-Set Losses',value: `${perfMetrics.straightLosses}`, sub: losses.length > 0 ? `${((perfMetrics.straightLosses / losses.length) * 100).toFixed(0)}% of losses` : null, accent: '#f87171', desc: 'Lost without winning a game — complete capitulations' },
                          ],
                        },
                        {
                          key: 'mental',
                          heading: 'Mental Game — Under Pressure',
                          summary: `Clutch ${perfMetrics.clutchIndex != null ? perfMetrics.clutchIndex.toFixed(0) + '%' : '—'} · ${perfMetrics.comebacks} comebacks`,
                          items: [
                            { label: 'Clutch Index',         value: perfMetrics.clutchIndex != null ? `${perfMetrics.clutchIndex.toFixed(1)}%` : '—', sub: perfMetrics.clutchTotal >= 3 ? `${perfMetrics.clutchWins}/${perfMetrics.clutchTotal} deciding matches` : `Only ${perfMetrics.clutchTotal} deciding matches`, accent: '#f59e0b', desc: 'Win rate in 5-game matches (3-2 / 2-3)' },
                            { label: 'Comeback Wins',        value: `${perfMetrics.comebacks}`, sub: wins.length > 0 ? `${((perfMetrics.comebacks / wins.length) * 100).toFixed(0)}% of wins` : null, accent: '#38bdf8', desc: 'Won after losing game 1 — mental resilience' },
                          ],
                        },
                        {
                          key: 'depth',
                          heading: 'Tournament Depth',
                          summary: perfMetrics.tournamentDepth.map(b => { const t = b.w + b.l; return t ? `${b.label} ${((b.w/t)*100).toFixed(0)}%` : null }).filter(Boolean).join(' · ') || 'No round data',
                          items: perfMetrics.tournamentDepth.map(b => ({
                            label: b.label,
                            value: b.w + b.l > 0 ? `${((b.w / (b.w + b.l)) * 100).toFixed(1)}%` : '—',
                            sub: b.w + b.l > 0 ? `${b.w}W ${b.l}L` : 'No data',
                            accent: b.w + b.l > 0 && b.w / (b.w + b.l) >= 0.5 ? '#10b981' : '#f59e0b',
                            desc: `Win rate in ${b.label.toLowerCase()}`,
                          })),
                        },
                      ]
                      return sections.map(sec => {
                        const isOpen = openPerfSec === sec.key
                        return (
                          <div key={sec.key} className="border border-slate-200 rounded-xl overflow-hidden">
                            <button onClick={() => setOpenPerfSec(isOpen ? null : sec.key)}
                              className={`w-full flex items-center justify-between px-4 py-3.5 text-left transition-colors ${isOpen ? 'bg-slate-50 border-b border-slate-100' : 'hover:bg-slate-50/60'}`}>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-slate-800">{sec.heading}</p>
                                {!isOpen && <p className="text-xs text-slate-400 mt-0.5">{sec.summary}</p>}
                              </div>
                              {isOpen ? <ChevronUp size={15} className="text-slate-400 shrink-0" /> : <ChevronDown size={15} className="text-slate-400 shrink-0" />}
                            </button>
                            {isOpen && (
                              <div className="divide-y divide-slate-100">
                                {sec.items.map(item => (
                                  <div key={item.label} className="flex items-center gap-3 px-4 py-3">
                                    <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 99, background: item.accent, flexShrink: 0 }} />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-slate-800">{item.label}</p>
                                      <p className="text-xs text-slate-400 mt-0.5">{item.desc}</p>
                                    </div>
                                    <div className="text-right shrink-0">
                                      <p className="text-base font-bold" style={{ color: item.accent }}>{item.value}</p>
                                      {item.sub && <p className="text-[11px] text-slate-400 mt-0.5">{item.sub}</p>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })
                    })()}
                  </div>
                )}

                {/* ── FORM TAB ── */}
                {activeTab === 'form' && (
                  <div>
                    {matchGroups.length === 0 ? (
                      <p style={{ textAlign: 'center', color: '#94a3b8', padding: '40px 0', fontSize: 13 }}>
                        No match history found.
                      </p>
                    ) : (
                      matchGroups.map((g, gi) => (
                        <details key={gi} open={gi === 0} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <summary style={{
                            cursor: 'pointer', padding: '12px 20px',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            listStyle: 'none', userSelect: 'none',
                          }}>
                            <div>
                              <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{g.name}</span>
                              <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 8 }}>{g.date}</span>
                            </div>
                            <span style={{ fontSize: 11, color: '#94a3b8' }}>
                              {g.matches.filter(m => m.player_result === 'W').length}W {g.matches.filter(m => m.player_result === 'L').length}L
                            </span>
                          </summary>
                          <div style={{ background: '#f8fafc', padding: '10px 16px' }}>
                            {g.matches.map(m => (
                              <div key={m.match_id} style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '7px 10px', borderRadius: 8, marginBottom: 4,
                                background: m.player_result === 'W' ? 'rgba(22,163,74,0.05)' : 'rgba(220,38,38,0.04)',
                                border: m.player_result === 'W' ? '1px solid rgba(22,163,74,0.15)' : '1px solid rgba(220,38,38,0.12)',
                              }}>
                                <span style={{ fontSize: 13, fontWeight: 800, width: 16, color: m.player_result === 'W' ? '#16a34a' : '#dc2626' }}>
                                  {m.player_result === 'W' ? '✓' : '✗'}
                                </span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {m.opp_name}
                                  </div>
                                  {m.round && <div style={{ fontSize: 10, color: '#94a3b8' }}>{m.round}</div>}
                                </div>
                                <div style={{ fontSize: 11, color: '#64748b', textAlign: 'right', flexShrink: 0 }}>
                                  {m.game_scores || m.match_score || '—'}
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
                      ))
                    )}
                  </div>
                )}

              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
