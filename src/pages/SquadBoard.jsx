import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadEventAthletes } from '../lib/squadReadiness.js'
import { ROSTER, DISCIPLINES } from '../lib/topsRoster.js'
import { okrLink } from '../lib/okrLink.js'
import { rosterPairKey } from '../lib/squadReadiness.js'
import { MANUAL_NOTE } from '../lib/watchlist.js'
import { computeRetentionRisk } from '../lib/retention.js'
import { card, chip, T } from '../lib/ui.js'

const TIER_TONE = { Core: '#b45309', Development: '#166534', TAGG: '#3730a3' }
const SQUAD_TONE = '#b45309'   // matches the Core tier accent

// One upcoming event: headline counts, expanding to the Indian athletes entered and
// the draws each is in. Athletes load on open — most rows are never expanded, and
// pulling every entry up front is what makes a panel like this slow as entries grow.
function UpcomingEvent({ e, hasSquad, squadIds, first }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState(null)      // null = not fetched yet

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && rows === null) setRows(await loadEventAthletes(e.event_id, squadIds))
  }

  const parts = []
  if (e.senior_athletes > 0 && e.junior_athletes > 0) {
    parts.push(`${e.senior_athletes} senior`, `${e.junior_athletes} junior`)
  } else if (e.junior_athletes > 0) {
    parts.push('junior')
  }

  return (
    <div style={{ borderTop: first ? 'none' : `1px solid ${T.divider}` }}>
      <button
        onClick={toggle}
        onMouseEnter={ev => ev.currentTarget.style.background = 'rgba(0,0,0,0.022)'}
        onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          width: '100%', textAlign: 'left', border: 'none', background: 'transparent',
          cursor: 'pointer', padding: '12px 20px',
        }}>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13.5, fontWeight: hasSquad ? 650 : 550, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {e.event_name.replace(/\s+20\d\d$/, '')}
          </span>
          <span style={{ fontSize: 12, color: T.muted }}>
            <b style={{ color: T.slate, fontWeight: 700 }}>{e.athletes}</b>
            {' '}athlete{e.athletes === 1 ? '' : 's'}
            {parts.length ? ` · ${parts.join(', ')}` : ''}
            {' · '}{e.entries} entr{e.entries === 1 ? 'y' : 'ies'}
          </span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
          {hasSquad && <span style={chip(SQUAD_TONE, { fontSize: 9.5 })}>TOPS</span>}
          <span className="tabnum" style={{ fontSize: 12.5, fontWeight: 600, color: T.slate }}>{fmtDate(e.start_date)}</span>
          <span style={{ fontSize: 10, color: T.muted, width: 8 }}>{open ? '▾' : '▸'}</span>
        </span>
      </button>

      {open && (
        <div style={{ background: 'rgba(0,0,0,0.015)', padding: '2px 0 6px' }}>
          {rows === null
            ? <div style={{ padding: '8px 20px', fontSize: 12, color: T.muted }}>Loading…</div>
            : rows.length === 0
              ? <div style={{ padding: '8px 20px', fontSize: 12, color: T.muted }}>No Indian entries.</div>
              : rows.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 20px' }}>
                    <span style={{ fontSize: 12.5, fontWeight: p.squad ? 650 : 500, color: T.ink, minWidth: 132 }}>
                      {p.name}
                      {p.squad && <span style={{ color: SQUAD_TONE, fontWeight: 700 }}> ·</span>}
                    </span>
                    <span style={{ fontSize: 11.5, color: T.muted }}>{p.draws.join(' · ')}</span>
                  </div>
                ))}
        </div>
      )}
    </div>
  )
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtDate = d => { if (!d) return ''; const [, m, day] = String(d).split('-').map(Number); return `${day} ${MON[(m || 1) - 1]}` }

// The Squad dashboard for one sport: readiness board, upcoming events,
// India movers, and the watchlist. Typography-only, no icons.
export default function SquadBoard({ sport, entries, lookup, scores, pairScores, watch = [], movers = [],
                                     upcoming = [], squadEventIds = new Set(), squadIds = [], loading }) {
  const navigate = useNavigate()

  const retention = useMemo(
    () => computeRetentionRisk({ entries, scores, pairScores, lookup }),
    [entries, scores, pairScores, lookup])

  const board = useMemo(() => {
    const rows = []
    for (const e of entries || []) {
      if (e.youth) continue
      const disc = DISCIPLINES[e.discipline] || {}
      let name, rank, ids
      if (disc.kind === 'doubles') {
        name = e.players.map(p => lookup[p.id]?.name || p.name).join(' / ')
        rank = pairScores[rosterPairKey(e.players)]?.pair_rank
        ids = e.players.map(p => p.id)
      } else {
        const pid = e.players[0]?.id
        name = lookup[pid]?.name || e.players[0]?.name
        // From the ranking table, not from the readiness row. Both hold the same number,
        // but taking it from the score would keep this list depending on the score.
        rank = lookup[pid]?.rank
        ids = [pid]
      }
      // No `if (!score) continue` any more. A panel titled "TOPS athletes" that quietly
      // omits a TOPS athlete because a readiness row was missing for them is a title that
      // lies; unranked simply shows a dash.
      rows.push({ name, short: disc.short, dcolor: disc.color, kind: disc.kind, rank, ids })
    }
    // World rank, best first. Unranked sink rather than sorting as rank zero.
    rows.sort((a, b) => (a.rank == null) - (b.rank == null) || (a.rank ?? 0) - (b.rank ?? 0))
    return rows
  }, [entries, lookup, pairScores])

  // Upcoming events come from the india_upcoming_entries view — every Indian athlete
  // entered, senior and junior. This panel used to count how many of the scored SQUAD
  // had each event as their NEXT fixture, so its numbers always summed to the squad
  // size and were labelled "entered", which they never were: Almaty read 4 against 10
  // Indians actually entered, and juniors were absent because the board skips them.
  const [showSenior, setShowSenior] = useState(true)
  const [showJunior, setShowJunior] = useState(true)

  // An event counts as senior if any senior went and as junior if any junior did, so a
  // mixed event answers to both switches rather than being forced into one.
  const nSenior = (upcoming || []).filter(e => e.senior_athletes > 0).length
  const nJunior = (upcoming || []).filter(e => e.junior_athletes > 0).length
  const shownEvents = (upcoming || []).filter(e =>
    (showSenior && e.senior_athletes > 0) || (showJunior && e.junior_athletes > 0))

  const open = (r) => navigate(r.kind === 'doubles' && r.ids.length === 2
    ? okrLink({ level: 'Senior', kind: 'doubles', ids: r.ids })
    : okrLink({ level: 'Senior', kind: 'singles', id: r.ids[0] }))

  // Same control as the Events tab, so the two places you filter by level behave alike:
  // both on by default, and each independent — an event can carry seniors and juniors at
  // once (Almaty has ten of one and two of the other), so these are not two halves of a
  // whole and a three-way All/Senior/Junior switch would misdescribe them.
  const levelToggle = (on, set, label, count) => (
    <button onClick={() => set(v => !v)} style={{
      appearance: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
      padding: '3px 9px', borderRadius: 0,
      border: `1px solid ${on ? T.ink : T.border}`,
      background: on ? T.ink : 'transparent',
      color: on ? '#fff' : T.slate,
    }}>{label}{count != null && <span style={{ opacity: .65 }}> {count}</span>}</button>
  )

  const sectionHead = (title, sub, right) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 22px', borderBottom: `1px solid ${T.divider}` }}>
      <span style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>{title}</span>
      {sub && <span style={{ fontSize: 12.5, color: T.muted }}>{sub}</span>}
      {right}
    </div>
  )

  return (
    <div>
      {/* No KPI band. Every figure in it was a count of the board directly underneath —
          podium-ready was its row count, contenders and rising were its own tags tallied,
          the average was the average of the scores already listed beside each name. The
          board says all of it, in the same screenful, per athlete. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
        {/* TOPS athletes — the roster, ordered by world rank.
            The readiness score is parked, not deleted: podium_readiness still runs and
            still feeds this list, but nothing here is drawn from it. It cannot be, half
            way: the score set the bar's length, the Contender/Rising/Plateaued tag and
            the row order all at once, so showing the list in score order under hidden
            tags would leave an opinion nobody currently trusts driving the page while
            being invisible. Rank is a number that means one thing and says where it came
            from. When the score's basis is settled, the bar, tag and ordering come back
            together. */}
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '15px 22px', borderBottom: `1px solid ${T.divider}`, fontSize: 14, fontWeight: 600, color: T.ink }}>
            TOPS athletes
            <span style={{ fontSize: 12.5, fontWeight: 400, color: T.muted, marginLeft: 8 }}>by world rank</span>
          </div>
          {loading ? <div style={{ padding: 28, color: T.muted, fontSize: 14 }}>Loading…</div>
            : board.length === 0 ? <div style={{ padding: 28, color: T.muted, fontSize: 14 }}>No athletes.</div>
            : board.map((r, i) => (
              <button key={i} onClick={() => open(r)}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.022)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                style={{
                  display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) auto', alignItems: 'center', gap: 14,
                  width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer',
                  padding: '12px 22px', borderTop: i ? `1px solid ${T.divider}` : 'none',
                }}>
                <span className="tabnum" style={{ fontSize: 12.5, fontWeight: 600, color: T.muted, textAlign: 'center' }}>{i + 1}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                  <span style={{ fontSize: 11.5, color: r.dcolor, fontWeight: 600 }}>{r.short}</span>
                </span>
                <span className="tabnum" style={{ fontSize: 15, fontWeight: 600, color: r.rank ? T.ink : T.muted }}>
                  {r.rank ? `#${r.rank}` : '—'}
                </span>
              </button>
            ))}
        </div>

        {/* right rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ ...card, overflow: 'hidden' }}>
            {sectionHead('Upcoming events', 'Indian athletes entered',
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {levelToggle(showSenior, setShowSenior, 'Senior', nSenior)}
                {levelToggle(showJunior, setShowJunior, 'Junior', nJunior)}
              </span>)}
            {loading ? <div style={{ padding: 20, color: T.muted, fontSize: 13 }}>…</div>
              : upcoming.length === 0 ? <div style={{ padding: 20, color: T.muted, fontSize: 13 }}>No Indian entries in the next 75 days.</div>
              : shownEvents.length === 0 ? <div style={{ padding: 20, color: T.muted, fontSize: 13 }}>Nothing in the selected level.</div>
              : shownEvents.map((e, i) => (
                  <UpcomingEvent key={e.event_id ?? i} e={e} first={i === 0}
                    hasSquad={squadEventIds.has(e.event_id)} squadIds={squadIds} />
                ))}
          </div>

          {movers.length > 0 && (
            <div style={{ ...card, overflow: 'hidden' }}>
              {sectionHead('Biggest movers · India')}
              {movers.map((m, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 20px', borderTop: i ? `1px solid ${T.divider}` : 'none' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 550, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
                    <span className="tabnum" style={{ fontSize: 12, color: T.muted }}>#{m.rank}</span>
                    <span className="tabnum" style={{ fontSize: 12.5, fontWeight: 700, color: '#12a150' }}>+{m.change}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Watchlist — non-roster Indians who meet or approach a Core/Development/TAGG route */}
      {watch.length > 0 && (
        <div style={{ ...card, overflow: 'hidden', marginTop: 20 }}>
          {sectionHead('Watchlist', 'Indian players who meet or are near a TOPS route, not currently listed')}
          {watch.slice(0, 12).map((w, i) => (
            <button key={i} onClick={() => navigate(okrLink(w.okr))}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.022)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              style={{
                display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 12,
                width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer',
                padding: '12px 22px', borderTop: i ? `1px solid ${T.divider}` : 'none',
              }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
                <span style={{ fontSize: 11.5, color: T.muted }}>{w.disc} · {w.band} · #{w.rank}</span>
              </span>
              <span style={chip(TIER_TONE[w.tierLabel] || T.muted, { fontSize: 9.5 })}>{w.tierLabel}</span>
              {w.status === 'meets'
                ? (w.pendingMaintenance
                    ? <span style={chip('#c2790b', { fontSize: 10 })}>holding period</span>
                    : <span style={chip('#12a150', { fontSize: 10 })}>Meets</span>)
                : <span style={chip('#f59e0b', { fontSize: 10 })}>{w.gap} from cut-off</span>}
            </button>
          ))}
          <div style={{ padding: '10px 22px 14px', fontSize: 11, color: T.muted, borderTop: `1px solid ${T.divider}` }}>{MANUAL_NOTE}</div>
        </div>
      )}

      {/* Retention watch — roster athletes no longer holding a rank/age route */}
      {retention.length > 0 && (
        <div style={{ ...card, overflow: 'hidden', marginTop: 20 }}>
          {sectionHead('Retention watch', 'Listed athletes who no longer hold a rank/age route')}
          {retention.map((r, i) => (
            <button key={i} onClick={() => navigate(r.link)}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.022)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              style={{
                display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 12,
                width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer',
                padding: '12px 22px', borderTop: i ? `1px solid ${T.divider}` : 'none',
              }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                <span style={{ fontSize: 11.5, color: T.muted }}>{r.disc} · {r.reason}</span>
              </span>
              <span style={chip('#dc2626', { fontSize: 10 })}>At risk</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
