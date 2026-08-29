import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { loadLiveMatches, loadLatestIndiaResults } from '../lib/liveStrip.js'
import { shortRound } from '../lib/matchFormat.js'
import { card, chip, T } from '../lib/ui.js'

// ─── Live strip — the top of the TOPS tab ────────────────────────────────────
//
// Leads with Indian players on court, and falls back to the last day India played when
// none are — which is most of the time. Only 9% of live-tracked matches have an Indian
// in them and 2.5% have a TOPS athlete, so a strip that showed whatever happened to be
// live would show foreign juniors nearly every time anyone opened the page.
//
// The fallback is the point, not the apology. The day this was built, the last thing
// India did was win the Feeder Olomouc final in singles and doubles, and no screen in
// the app mentioned it.

const SQUAD_TONE = '#b45309'   // same accent the squad rows use
const MAX_ROWS   = 5
const POLL_MS    = 10_000

// shortRound() abbreviates for dense tables, where a column header supplies the context.
// A lone "F" in a one-line row does not read as "Final" — and the final is the row most
// worth reading. Everything else keeps its abbreviation.
function roundLabel(round) {
  const s = shortRound(round || '')
  return s === 'F' ? 'Final' : s
}

function fmtDay(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function Opponent({ name, country, rank }) {
  // A result is meaningless without who it was against. "Lost 0-3" says nothing;
  // "lost 0-3 to World No. 1" is the whole story.
  return (
    <span style={{ color: T.slate, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {name || 'Unknown'}
      {country ? <span style={{ color: T.muted }}>{' '}{country}</span> : null}
      {rank ? <span style={{ color: T.muted }}>{' '}#{rank}</span> : null}
    </span>
  )
}

function Row({ isSquad, live, lead, opp, oppCountry, oppRank, verb, score, sub, first }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 20px', fontSize: 13,
      borderTop: first ? 'none' : `1px solid ${T.divider}`,
    }}>
      {isSquad
        ? <span style={chip(SQUAD_TONE, { fontSize: 9.5 })}>TOPS</span>
        : <span style={{ width: 40 }} />}

      <span style={{
        fontWeight: isSquad ? 650 : 550, color: T.ink,
        minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {lead}
      </span>

      <span style={{ color: T.muted, fontSize: 12 }}>{verb}</span>
      <Opponent name={opp} country={oppCountry} rank={oppRank} />

      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
        {sub ? <span style={{ fontSize: 11.5, color: T.muted }}>{sub}</span> : null}
        <span className="tabnum" style={{
          fontSize: 13, fontWeight: 700,
          color: live ? '#b91c1c' : (score?.won ? '#065f46' : T.slate),
        }}>
          {score?.text}
        </span>
      </span>
    </div>
  )
}

export default function LiveStrip({ squadIds = [] }) {
  const navigate = useNavigate()
  const [live, setLive]       = useState([])
  const [latest, setLatest]   = useState({ date: null, rows: [] })
  const [loading, setLoading] = useState(true)
  const channelRef = useRef(null)

  const squad = new Set(squadIds)

  // Live refreshes on a timer; finished results do not. Re-fetching yesterday's finals
  // every ten seconds would be ten requests a minute for a number that cannot change.
  useEffect(() => {
    let cancelled = false

    async function pullLive() {
      const rows = await loadLiveMatches()
      if (!cancelled) { setLive(rows); setLoading(false) }
    }

    pullLive()
    loadLatestIndiaResults().then(r => { if (!cancelled) setLatest(r) })

    // Both a socket and a timer, deliberately. The Realtime WebSocket drops — the poll is
    // what brings the strip back when it does. LiveProbability pairs them the same way.
    const timer = setInterval(pullLive, POLL_MS)
    const channel = supabase
      .channel('tops-live-strip')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wtt_live_state' }, pullLive)
      .subscribe()
    channelRef.current = channel

    return () => {
      cancelled = true
      clearInterval(timer)
      supabase.removeChannel(channel)
    }
  }, [])

  if (loading) return null

  const indianLive = live.filter(m => m.isIndian)
  const anyLive    = live.length

  // Squad first, then everyone else. Within each, whatever order the source gave.
  const bySquad = (a, b) => (squad.has(b.indId) ? 1 : 0) - (squad.has(a.indId) ? 1 : 0)

  const showingLive = indianLive.length > 0
  const rows = showingLive
    ? [...indianLive].sort(bySquad).slice(0, MAX_ROWS)
    : [...latest.rows]
        .sort((a, b) => (squad.has(b.ind_p1_id) ? 1 : 0) - (squad.has(a.ind_p1_id) ? 1 : 0))
        .slice(0, MAX_ROWS)

  // Nothing live and India has not played in three weeks. Render nothing rather than an
  // empty box explaining its own emptiness.
  if (!showingLive && !rows.length && !anyLive) return null

  const hiddenCount = showingLive
    ? indianLive.length - rows.length
    : latest.rows.length - rows.length

  return (
    <div style={{ ...card, marginBottom: 16, overflow: 'hidden' }}>
      <style>{`@keyframes live-pulse {0%,100%{opacity:1}50%{opacity:0.25}}`}</style>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '12px 20px', borderBottom: rows.length ? `1px solid ${T.divider}` : 'none',
      }}>
        {showingLive ? (
          <>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 800,
              letterSpacing: 1.6, padding: '3px 8px', borderRadius: 3,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', background: '#fff',
                animation: 'live-pulse 1.4s ease-in-out infinite',
              }} />
              LIVE
            </span>
            <span style={{ fontSize: 14, fontWeight: 650, color: T.ink }}>
              {indianLive.length} Indian{indianLive.length === 1 ? '' : 's'} on court
            </span>
          </>
        ) : (
          <>
            <span style={{ fontSize: 14, fontWeight: 650, color: T.ink }}>
              {fmtDay(latest.date)}
            </span>
            <span style={{ fontSize: 12.5, color: T.muted }}>
              {latest.rows.length} Indian result{latest.rows.length === 1 ? '' : 's'}
              {' · '}{latest.rows.filter(r => r.won).length} won
            </span>
          </>
        )}

        {anyLive > 0 && (
          <button
            onClick={() => navigate('/live')}
            style={{
              marginLeft: 'auto', border: 'none', background: 'none', padding: 0,
              cursor: 'pointer', fontSize: 12, fontWeight: 600, color: T.accent,
              whiteSpace: 'nowrap',
            }}>
            {anyLive} live · all →
          </button>
        )}
      </div>

      {/* Rows */}
      {rows.map((r, i) => showingLive ? (
        <Row
          key={r.matchId}
          first={i === 0}
          live
          isSquad={squad.has(r.indId)}
          lead={r.indName}
          verb="vs"
          opp={r.oppName}
          oppCountry={r.oppCountry}
          oppRank={r.oppRank}
          sub={roundLabel(r.round)}
          score={{ text: `${r.games[0]}-${r.games[1]}  ${r.points[0]}-${r.points[1]}` }}
        />
      ) : (
        <Row
          key={r.match_id}
          first={i === 0}
          isSquad={squad.has(r.ind_p1_id) || squad.has(r.ind_p2_id)}
          lead={r.ind_name}
          verb={r.won ? 'bt' : 'lt'}
          opp={r.opp_name}
          oppCountry={r.opp_country}
          sub={roundLabel(r.round)}
          score={{ text: r.score || '—', won: r.won }}
        />
      ))}

      {hiddenCount > 0 && (
        <div style={{ padding: '8px 20px', fontSize: 12, color: T.muted, borderTop: `1px solid ${T.divider}` }}>
          +{hiddenCount} more
        </div>
      )}
    </div>
  )
}
