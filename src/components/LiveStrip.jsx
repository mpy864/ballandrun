import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { loadLiveMatches, loadLatestIndiaResults } from '../lib/liveStrip.js'
import { shortRound, roundRank, properName } from '../lib/matchFormat.js'
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

// Official names carry a title sponsor and the year — "WTT Feeder Olomouc 2026 Presented
// by X". Neither belongs in a one-line header. Same trim SquadBoard applies to the
// upcoming-events rows.
function shortEventName(name = '') {
  return name.replace(/\s+presented by .*$/i, '').replace(/\s+20\d\d$/, '').trim()
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

function Row({ isSquad, showChip, live, lead, opp, oppCountry, oppRank, verb, score, sub, first }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 20px', fontSize: 13,
      borderTop: first ? 'none' : `1px solid ${T.divider}`,
    }}>
      {showChip && (isSquad
        ? <span style={chip(SQUAD_TONE, { fontSize: 9.5 })}>TOPS</span>
        : <span style={{ width: 40 }} />)}

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
  const [expanded, setExpanded] = useState(false)
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
  const showingLive = indianLive.length > 0

  // Squad first, then the deepest round. Both halves matter: two days in three carry more
  // than five results — the average day has 16 and the busiest had 87 — so the five rows
  // on show are a ranking, not the first five the database happened to return. Sorting by
  // squad alone left a semi-final sitting above the final it led to.
  const rank = (isSquad, round) => (isSquad ? 1000 : 0) + roundRank(round)
  const ordered = showingLive
    ? [...indianLive].sort((a, b) =>
        rank(squad.has(b.indId), b.round) - rank(squad.has(a.indId), a.round))
    : [...latest.rows].sort((a, b) =>
        rank(squad.has(b.ind_p1_id) || squad.has(b.ind_p2_id), b.round) -
        rank(squad.has(a.ind_p1_id) || squad.has(a.ind_p2_id), a.round))

  const rows = expanded ? ordered : ordered.slice(0, MAX_ROWS)
  const hiddenCount = ordered.length - rows.length

  // The chip earns its place by telling squad rows apart from the rest. When every row is
  // squad it says the same thing five times down the left edge and stops being a signal.
  const mixedSquad = showingLive
    ? new Set(ordered.map(r => squad.has(r.indId))).size > 1
    : new Set(ordered.map(r => squad.has(r.ind_p1_id) || squad.has(r.ind_p2_id))).size > 1

  // One event most days, so name it — a Feeder final and a Champions final are not the
  // same result. On a day spanning several, the date alone is the honest header.
  const eventNames = showingLive
    ? [...new Set(ordered.map(r => r.eventName).filter(Boolean))]
    : [...new Set(ordered.map(r => r.event_name).filter(Boolean))]
  const oneEvent = eventNames.length === 1 ? eventNames[0] : null

  // Nothing live and India has not played in three weeks. Render nothing rather than an
  // empty box explaining its own emptiness.
  if (!showingLive && !rows.length && !anyLive) return null

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
            {oneEvent && (
              <span style={{ fontSize: 12.5, color: T.muted }}>
                {shortEventName(oneEvent)}
              </span>
            )}
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
          showChip={mixedSquad}
          isSquad={squad.has(r.indId)}
          lead={properName(r.indName)}
          verb="vs"
          opp={properName(r.oppName)}
          oppCountry={r.oppCountry}
          oppRank={r.oppRank}
          sub={roundLabel(r.round)}
          score={{ text: `${r.games[0]}-${r.games[1]}  ${r.points[0]}-${r.points[1]}` }}
        />
      ) : (
        <Row
          key={r.match_id}
          first={i === 0}
          showChip={mixedSquad}
          isSquad={squad.has(r.ind_p1_id) || squad.has(r.ind_p2_id)}
          lead={properName(r.ind_name)}
          verb={r.won ? 'defeated' : 'lost to'}
          opp={properName(r.opp_name)}
          oppCountry={r.opp_country}
          sub={roundLabel(r.round)}
          score={{ text: r.score || '—', won: r.won }}
        />
      ))}

      {/* Opens in place. Two days in three carry more than five results, so a dead
          "+82 more" would be the normal state of this row rather than the exception. */}
      {(hiddenCount > 0 || expanded) && (
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            display: 'block', width: '100%', textAlign: 'left', appearance: 'none',
            border: 'none', background: 'none', cursor: 'pointer',
            padding: '8px 20px', fontSize: 12, color: T.muted,
            borderTop: `1px solid ${T.divider}`,
          }}>
          {expanded ? 'Show fewer' : `Show all ${ordered.length} results`}
        </button>
      )}
    </div>
  )
}
