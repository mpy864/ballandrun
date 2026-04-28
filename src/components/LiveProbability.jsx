import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'

// ── CSS animations injected once ─────────────────────────────────────────────
const STYLES = `
  @keyframes live-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%       { opacity: 0.5; transform: scale(0.85); }
  }
  @keyframes fade-slide-in {
    from { opacity: 0; transform: translateY(-6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes score-flash {
    0%   { color: #f59e0b; }
    100% { color: #0f172a; }
  }
  @keyframes bar-glow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(59,130,246,0); }
    50%       { box-shadow: 0 0 12px 2px rgba(59,130,246,0.18); }
  }
  .live-dot  { animation: live-pulse 1.4s ease-in-out infinite; }
  .card-in   { animation: fade-slide-in 0.4s ease; }
  .score-pop { animation: score-flash 0.6s ease; }
  .bar-glow  { animation: bar-glow 2.5s ease-in-out infinite; }
`

function StyleInjector() {
  useEffect(() => {
    const el = document.createElement('style')
    el.textContent = STYLES
    document.head.appendChild(el)
    return () => document.head.removeChild(el)
  }, [])
  return null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const FLAG = {
  CHN:'🇨🇳', JPN:'🇯🇵', KOR:'🇰🇷', GER:'🇩🇪', FRA:'🇫🇷',
  SWE:'🇸🇪', SIN:'🇸🇬', HKG:'🇭🇰', TPE:'🇹🇼', IND:'🇮🇳',
  POR:'🇵🇹', EGY:'🇪🇬', USA:'🇺🇸', BRA:'🇧🇷', HUN:'🇭🇺',
  ROU:'🇷🇴', POL:'🇵🇱', AUT:'🇦🇹', BEL:'🇧🇪', ESP:'🇪🇸',
  ITA:'🇮🇹', CRO:'🇭🇷', NIG:'🇳🇬', MAR:'🇲🇦', SLO:'🇸🇮',
  CZE:'🇨🇿', SVK:'🇸🇰', DEN:'🇩🇰', NED:'🇳🇱', GBR:'🇬🇧',
  RSA:'🇿🇦', NOR:'🇳🇴', FIN:'🇫🇮', MAS:'🇲🇾', THA:'🇹🇭',
  CAN:'🇨🇦', AUS:'🇦🇺', GRE:'🇬🇷', SUI:'🇨🇭', UKR:'🇺🇦',
  BLR:'🇧🇾', SRB:'🇷🇸', QAT:'🇶🇦', KAZ:'🇰🇿', UZB:'🇺🇿',
}
const flag = code => FLAG[code] || ''

// ── Probability bar ───────────────────────────────────────────────────────────

function ProbBar({ pWin, name1, name2 }) {
  const p1 = (pWin * 100).toFixed(1)
  const p2 = ((1 - pWin) * 100).toFixed(1)

  return (
    <div style={{ margin: '18px 0 10px' }}>
      {/* Always-visible percentage labels above the bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ textAlign: 'left' }}>
          <span style={{ fontSize: 22, fontWeight: 900, color: '#1d4ed8', letterSpacing: -1 }}>
            {p1}%
          </span>
          <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6 }}>{name1}</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: 11, color: '#94a3b8', marginRight: 6 }}>{name2}</span>
          <span style={{ fontSize: 22, fontWeight: 900, color: '#c2410c', letterSpacing: -1 }}>
            {p2}%
          </span>
        </div>
      </div>

      {/* The bar itself */}
      <div
        className="bar-glow"
        style={{
          height: 14,
          borderRadius: 8,
          overflow: 'hidden',
          display: 'flex',
          background: '#f1f5f9',
          border: '1px solid #e2e8f0',
        }}
      >
        <div style={{
          width: `${p1}%`,
          background: 'linear-gradient(90deg, #1d4ed8, #3b82f6)',
          transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
          borderRadius: '8px 0 0 8px',
        }} />
        <div style={{
          width: `${p2}%`,
          background: 'linear-gradient(90deg, #c2410c, #f97316)',
          transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
          borderRadius: '0 8px 8px 0',
        }} />
      </div>
    </div>
  )
}

// ── Player nameplate ──────────────────────────────────────────────────────────

function Nameplate({ name, country, rank, side }) {
  const isLeft = side === 'left'
  return (
    <div style={{ textAlign: isLeft ? 'left' : 'right', flex: 1, minWidth: 0 }}>
      <div style={{
        fontSize: 12,
        color: isLeft ? '#1d4ed8' : '#c2410c',
        marginBottom: 4,
        fontWeight: 600,
        letterSpacing: 0.5,
      }}>
        {isLeft
          ? <>{flag(country)} {country}</>
          : <>{country} {flag(country)}</>
        }
      </div>
      <div style={{
        color: '#0f172a',
        fontSize: 17,
        fontWeight: 800,
        letterSpacing: -0.3,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {name}
      </div>
      {rank && (
        <div style={{
          marginTop: 5,
          display: 'inline-block',
          background: isLeft ? 'rgba(29,78,216,0.07)' : 'rgba(194,65,12,0.07)',
          border: `1px solid ${isLeft ? 'rgba(29,78,216,0.2)' : 'rgba(194,65,12,0.2)'}`,
          color: isLeft ? '#1d4ed8' : '#c2410c',
          fontSize: 11,
          fontWeight: 700,
          padding: '2px 8px',
          borderRadius: 20,
        }}>
          World #{rank}
        </div>
      )}
    </div>
  )
}

// ── Score board ───────────────────────────────────────────────────────────────

function ScoreBoard({ gamesA, gamesB, ptsA, ptsB }) {
  const scoreKey = `${gamesA}-${gamesB}-${ptsA}-${ptsB}`
  return (
    <div style={{
      background: '#f8fafc',
      borderRadius: 10,
      padding: '10px 20px',
      textAlign: 'center',
      flexShrink: 0,
      border: '1px solid #e2e8f0',
      minWidth: 110,
    }}>
      <div key={scoreKey} className="score-pop" style={{
        color: '#0f172a',
        fontSize: 28,
        fontWeight: 900,
        letterSpacing: 2,
        fontFamily: 'monospace',
      }}>
        {gamesA}
        <span style={{ color: '#cbd5e1', margin: '0 6px' }}>─</span>
        {gamesB}
      </div>
      <div style={{ color: '#94a3b8', fontSize: 10, marginTop: 2, letterSpacing: 1 }}>
        GAMES
      </div>
      <div style={{
        marginTop: 6,
        color: '#f59e0b',
        fontSize: 13,
        fontWeight: 700,
        fontFamily: 'monospace',
      }}>
        {ptsA} <span style={{ color: '#cbd5e1' }}>·</span> {ptsB}
      </div>
      <div style={{ color: '#94a3b8', fontSize: 9, letterSpacing: 1 }}>
        POINTS
      </div>
    </div>
  )
}

// ── Journey log ───────────────────────────────────────────────────────────────

function Journey({ log, pPrematch, pLive, ptsA, ptsB }) {
  const entries = []
  if (pPrematch != null) entries.push({ label: 'Pre-match', p: pPrematch, score: null, live: false })
  log.forEach(g => entries.push({
    label: `G${g.game_number}`,
    p: g.p_win_after,
    score: `${g.score_a}─${g.score_b}`,
    live: false,
  }))
  if (pLive != null) entries.push({
    label: 'Live',
    p: pLive,
    score: `${ptsA}─${ptsB}`,
    live: true,
  })

  if (entries.length < 2) return null

  return (
    <div style={{
      marginTop: 20,
      paddingTop: 20,
      borderTop: '1px solid #f1f5f9',
    }}>
      <div style={{
        color: '#94a3b8',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 2,
        marginBottom: 14,
      }}>
        PROBABILITY JOURNEY
      </div>

      {entries.map((e, i) => {
        const prev  = entries[i - 1]?.p
        const delta = prev != null ? e.p - prev : null
        const up    = delta > 0.002
        const down  = delta < -0.002
        const deltaLabel = up
          ? `↑ +${(delta * 100).toFixed(1)}%`
          : down
            ? `↓ ${(delta * 100).toFixed(1)}%`
            : ''

        return (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 9,
          }}>
            <div style={{ width: 52, display: 'flex', alignItems: 'center', gap: 5 }}>
              {e.live && (
                <span className="live-dot" style={{
                  width: 6, height: 6,
                  borderRadius: '50%',
                  background: '#ef4444',
                  flexShrink: 0,
                }} />
              )}
              <span style={{
                color: e.live ? '#0f172a' : '#94a3b8',
                fontSize: 11,
                fontWeight: e.live ? 700 : 400,
                fontFamily: 'monospace',
              }}>
                {e.label}
              </span>
            </div>

            <span style={{
              color: '#cbd5e1',
              fontSize: 11,
              fontFamily: 'monospace',
              width: 38,
              textAlign: 'right',
            }}>
              {e.score || ''}
            </span>

            {/* Two-sided mini bar */}
            <div style={{ flex: 1, height: 8, borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
              <div style={{
                width: `${(e.p * 100).toFixed(1)}%`,
                height: '100%',
                background: e.live ? 'linear-gradient(90deg,#1d4ed8,#3b82f6)' : '#cbd5e1',
                transition: 'width 0.5s ease',
              }} />
              <div style={{
                width: `${((1 - e.p) * 100).toFixed(1)}%`,
                height: '100%',
                background: e.live ? 'linear-gradient(90deg,#c2410c,#f97316)' : '#e2e8f0',
                transition: 'width 0.5s ease',
              }} />
            </div>

            {/* Both probabilities */}
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
              <span style={{
                color: e.live ? '#1d4ed8' : '#64748b',
                fontSize: 11,
                fontFamily: 'monospace',
                fontWeight: e.live ? 700 : 400,
              }}>
                {(e.p * 100).toFixed(1)}%
              </span>
              <span style={{ color: '#cbd5e1', fontSize: 10 }}>|</span>
              <span style={{
                color: e.live ? '#c2410c' : '#94a3b8',
                fontSize: 11,
                fontFamily: 'monospace',
                fontWeight: e.live ? 700 : 400,
              }}>
                {((1 - e.p) * 100).toFixed(1)}%
              </span>
            </div>

            <span style={{
              fontSize: 11,
              fontFamily: 'monospace',
              width: 72,
              flexShrink: 0,
              color: up ? '#16a34a' : down ? '#dc2626' : 'transparent',
            }}>
              {deltaLabel}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Single match card ─────────────────────────────────────────────────────────

function MatchCard({ match, gameLog, players, events }) {
  const log      = gameLog.filter(g => g.match_id === match.match_id)
  const p1       = players[match.comp1_id] || {}
  const p2       = players[match.comp2_id] || {}
  const pWin     = match.p_win ?? 0.5
  const eventName = events[match.event_id] || null

  const borderColor = pWin > 0.65
    ? 'rgba(29,78,216,0.25)'
    : pWin < 0.35
      ? 'rgba(194,65,12,0.25)'
      : 'rgba(245,158,11,0.25)'

  return (
    <div
      className="card-in"
      style={{
        background: 'rgba(255, 255, 255, 0.88)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 18,
        padding: '22px 24px',
        marginBottom: 20,
        border: `1px solid ${borderColor}`,
        boxShadow: '0 8px 40px rgba(0,0,0,0.28), 0 1px 0 rgba(255,255,255,0.6) inset',
      }}
    >
      {/* Round + LIVE badge */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 18,
      }}>
        <div>
          {eventName && (
            <div style={{ color: '#1d4ed8', fontSize: 11, fontWeight: 700, letterSpacing: 0.3, marginBottom: 2 }}>
              {eventName}
            </div>
          )}
          <span style={{ color: '#94a3b8', fontSize: 12, fontWeight: 500 }}>
            {match.round_name || 'Singles'}
          </span>
        </div>
        <span style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.25)',
          color: '#ef4444',
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 1.5,
          padding: '3px 10px',
          borderRadius: 20,
        }}>
          <span className="live-dot" style={{
            width: 6, height: 6,
            borderRadius: '50%',
            background: '#ef4444',
          }} />
          LIVE
        </span>
      </div>

      {/* Players + scoreboard */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        marginBottom: 4,
      }}>
        <Nameplate name={match.comp1_name} country={p1.country_code} rank={p1.rank} side="left" />
        <ScoreBoard gamesA={match.games_a} gamesB={match.games_b} ptsA={match.pts_a} ptsB={match.pts_b} />
        <Nameplate name={match.comp2_name} country={p2.country_code} rank={p2.rank} side="right" />
      </div>

      <ProbBar pWin={pWin} name1={match.comp1_name} name2={match.comp2_name} />

      <Journey
        log={log}
        pPrematch={match.p_prematch}
        pLive={match.p_win}
        ptsA={match.pts_a}
        ptsB={match.pts_b}
      />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LiveProbability() {
  const [matches,  setMatches]  = useState([])
  const [gameLog,  setGameLog]  = useState([])
  const [players,  setPlayers]  = useState({})
  const [events,   setEvents]   = useState({})   // { event_id: event_name }
  const [loading,  setLoading]  = useState(true)
  const channelRef              = useRef(null)

  const sortByMatchId = arr => [...arr].sort((a, b) => String(a.match_id).localeCompare(String(b.match_id)))

  const sortedMatches = useMemo(() => {
    const isIndia = m =>
      players[m.comp1_id]?.country_code === 'IND' ||
      players[m.comp2_id]?.country_code === 'IND'
    return [...matches].sort((a, b) => {
      const diff = (isIndia(a) ? 0 : 1) - (isIndia(b) ? 0 : 1)
      return diff !== 0 ? diff : String(a.match_id).localeCompare(String(b.match_id))
    })
  }, [matches, players])

  const fetchPlayers = useCallback(async (ids) => {
    if (!ids.length) return
    const [pRes, rRes] = await Promise.all([
      supabase.from('wtt_players').select('ittf_id, country_code').in('ittf_id', ids),
      supabase.from('rankings_singles_normalized')
        .select('player_id, rank, ranking_date')
        .in('player_id', ids)
        .order('ranking_date', { ascending: false }),
    ])
    const rankMap = {}
    ;(rRes.data || []).forEach(r => { if (!rankMap[r.player_id]) rankMap[r.player_id] = r.rank })
    const info = {}
    ;(pRes.data || []).forEach(p => { info[p.ittf_id] = { country_code: p.country_code, rank: rankMap[p.ittf_id] || null } })
    setPlayers(prev => ({ ...prev, ...info }))
  }, [])

  async function fetchData() {
    const [liveRes, logRes] = await Promise.all([
      supabase.from('wtt_live_state').select('*').eq('status', 'live'),
      supabase.from('wtt_game_log').select('*').order('completed_at', { ascending: true }),
    ])
    const live = liveRes.data || []
    setMatches(sortByMatchId(live))
    if (logRes.data) setGameLog(logRes.data)
    setLoading(false)
    const ids = [...new Set(live.flatMap(m => [m.comp1_id, m.comp2_id]).filter(Boolean))]
    fetchPlayers(ids)

    const eventIds = [...new Set(live.map(m => m.event_id).filter(Boolean))]
    if (eventIds.length) {
      const evRes = await supabase.from('wtt_events').select('event_id, event_name').in('event_id', eventIds)
      const evMap = {}
      ;(evRes.data || []).forEach(e => { evMap[e.event_id] = e.event_name })
      setEvents(evMap)
    }
  }

  useEffect(() => {
    fetchData()
    const channel = supabase
      .channel('live-prob-v2')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wtt_live_state' }, (payload) => {
        const row = payload.new
        setMatches(prev => {
          const next = [...prev]
          const idx  = next.findIndex(m => m.match_id === row.match_id)
          if (row.status === 'live') {
            if (idx >= 0) next[idx] = row
            else { next.push(row); fetchPlayers([row.comp1_id, row.comp2_id].filter(Boolean)) }
          } else {
            if (idx >= 0) next.splice(idx, 1)
          }
          return sortByMatchId(next)
        })
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wtt_game_log' },
        (payload) => setGameLog(prev => [...prev, payload.new])
      )
      .subscribe()
    channelRef.current = channel
    return () => { supabase.removeChannel(channel) }
  }, [])

  if (loading) {
    return <div style={{ color: '#94a3b8', textAlign: 'center', padding: 80, fontFamily: 'system-ui' }}>Loading…</div>
  }

  if (matches.length === 0) {
    return (
      <div style={{
        background: 'rgba(255,255,255,0.10)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 18,
        padding: '56px 32px',
        textAlign: 'center',
        border: '1px solid rgba(255,255,255,0.18)',
        boxShadow: '0 8px 40px rgba(0,0,0,0.28)',
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🏓</div>
        <div style={{ color: 'rgba(255,255,255,0.90)', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
          No live matches right now
        </div>
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 24 }}>
          Run the polling script when a tournament is live
        </div>
        <div style={{
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 8,
          padding: '12px 20px',
          display: 'inline-block',
          fontFamily: 'monospace',
          fontSize: 12,
          color: 'rgba(255,255,255,0.55)',
        }}>
          python scripts/live_updater.py --event &lt;id&gt; --points --db
        </div>
      </div>
    )
  }

  return (
    <>
      <StyleInjector />
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
        gap: 16,
      }}>
        {sortedMatches.map(m => (
          <MatchCard key={m.match_id} match={m} gameLog={gameLog} players={players} events={events} />
        ))}
      </div>
    </>
  )
}
