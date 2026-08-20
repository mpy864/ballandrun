import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getSport, CATEGORIES, DISCIPLINES, ROSTER } from '../lib/topsRoster.js'
import { makeVerdict } from '../lib/verdict.js'
import { okrLink } from '../lib/okrLink.js'
import { loadSquadReadiness, loadIndiaMovers, loadIndiaUpcomingEvents, loadSquadEventIds } from '../lib/squadReadiness.js'
import { loadWatchlist } from '../lib/watchlist.js'
import SquadBoard from './SquadBoard.jsx'
import { TalentTab, CompareTab } from './sportTabs.jsx'
import EventsTab from './eventsTab.jsx'
import TennisView from './tennisView.jsx'

// â”€â”€â”€ Atoms â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function RankMove({ diff }) {
  if (diff == null || diff === 0) return null
  const n = Number(diff)
  return n < 0
    ? <span style={{ color: '#22c55e', fontSize: 10, fontWeight: 700 }}>â–²{Math.abs(n)}</span>
    : <span style={{ color: '#f87171', fontSize: 10, fontWeight: 700 }}>â–¼{n}</span>
}

function DiscBadge({ disc }) {
  const c = disc?.color || '#64748b'
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 99,
      background: `${c}15`, color: c, border: `1px solid ${c}30`, letterSpacing: '0.05em', whiteSpace: 'nowrap',
    }}>{disc?.short || 'â€”'}</span>
  )
}

function TagPill({ v }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, padding: '3px 9px', borderRadius: 99, whiteSpace: 'nowrap',
      background: v.bg, color: v.color, border: `1px solid ${v.border}`, letterSpacing: '0.04em', textTransform: 'uppercase',
    }}>{v.tag}</span>
  )
}

function ScoreNum({ score }) {
  if (!score) return <span style={{ fontSize: 13, fontWeight: 800, color: '#cbd5e1' }}>â€”</span>
  const v = Number(score.score)
  const tip = `Rank ${score.rank_pts}/45 Â· Trajectory ${score.traj_pts}/20 Â· Form ${score.form_pts}/35`
    + (score.stale ? ' Â· STALE âˆ’10' : '')
  return <span title={`Readiness ${v}/100\n${tip}`} style={{ fontSize: 15, fontWeight: 900, color: '#0f172a' }}>{v}</span>
}

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function fmtShortDate(d) {
  if (!d) return ''
  const [y, m, day] = String(d).split('-').map(Number)
  return `${day} ${MON[(m || 1) - 1]}`
}
function cleanEventLabel(name) {
  return (name || '').replace(/\s+presented\s+by\s+.*/i, '').replace(/\s+20\d\d$/, '').trim()
}

// â”€â”€â”€ Athlete / pair card (verdict-first) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function EntryCard({ entry, lookup, score, live, onOpen, onOpenEntry }) {
  const [open, setOpen] = useState(false)
  const disc = DISCIPLINES[entry.discipline] || {}
  const players = entry.players || []
  const watch = (entry.watch || []).map(id => lookup[id]).filter(Boolean)
  const singlesRank = live && players[0]?.id ? lookup[players[0].id]?.rank : null
  const rankShown = disc.kind === 'doubles' ? score?.pair_rank : singlesRank
  const v = live ? makeVerdict({ kind: disc.kind, score, singlesRank }) : null

  return (
    <div style={{ background: '#fff', border: '1px solid #e8edf4', borderRadius: 10, overflow: 'hidden', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 12px' }}>
        {v && <span style={{ width: 9, height: 9, borderRadius: 99, background: v.dot, flexShrink: 0, marginTop: 5 }} />}

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* names + meta */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <span
              onClick={() => live && onOpenEntry(entry)}
              style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', cursor: live ? 'pointer' : 'default' }}
            >
              {players.map((p, i) => (live && p.id ? lookup[p.id]?.name : null) || p.name || `#${p.id}`).join(' / ')}
            </span>
            <DiscBadge disc={disc} />
            {live && rankShown && (
              <span style={{ fontSize: 10, color: '#94a3b8' }}>
                World #{rankShown} {disc.kind !== 'doubles' && <RankMove diff={lookup[players[0]?.id]?.rank_change} />}
              </span>
            )}
          </div>
          {/* age Â· next tournament */}
          {live && score && (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
              {score.age != null && <span>Age {score.age}</span>}
              {score.age != null && ' Â· '}
              {score.next
                ? <span>Next: <b style={{ color: '#334155', fontWeight: 600 }}>{cleanEventLabel(score.next.name)}</b>
                    {' '}<span style={{ color: '#94a3b8' }}>
                      {fmtShortDate(score.next.date)}{score.next.seed ? ` Â· seed ${score.next.seed}` : ''}{score.next.qual ? ' Â· Q' : ''}
                    </span>
                    {score.next.provisional && <span style={{ color: '#a855f7', fontStyle: 'italic' }}> Â· provisional</span>}</span>
                : <span style={{ color: '#94a3b8' }}>No upcoming entry</span>}
            </div>
          )}
          {/* achievements: 2 deepest runs + biggest win */}
          {live && score?.achievements && (score.achievements.runs?.length > 0 || score.achievements.bestWin) && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
              {score.achievements.runs.map((r, i) => (
                <span key={i} style={{ fontSize: 9.5, fontWeight: 700, color: '#0369a1', background: '#e0f2fe', border: '1px solid #bae6fd', padding: '2px 7px', borderRadius: 99 }}>
                  {r.label} Â· {r.event}{r.year ? ` ${r.year}` : ''}
                </span>
              ))}
              {score.achievements.bestWin && (
                <span style={{ fontSize: 9.5, fontWeight: 700, color: '#15803d', background: '#dcfce7', border: '1px solid #bbf7d0', padding: '2px 7px', borderRadius: 99 }}>
                  beat #{score.achievements.bestWin.rank} {score.achievements.bestWin.name}
                  {score.achievements.bestWin.event ? ` Â· ${score.achievements.bestWin.event}` : ''}
                  {score.achievements.bestWin.year ? ` ${score.achievements.bestWin.year}` : ''}
                </span>
              )}
            </div>
          )}
          {entry.note && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{entry.note}</div>}
        </div>

        {/* score + tag */}
        {live && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
            <ScoreNum score={score} />
            {v && <TagPill v={v} />}
          </div>
        )}

        {watch.length > 0 && (
          <button
            onClick={() => setOpen(o => !o)}
            style={{
              flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 7,
              border: '1px solid #e2e8f0', cursor: 'pointer',
              background: open ? '#0f172a' : '#f8fafc', color: open ? '#fff' : '#475569',
            }}
          >Watch Â· {watch.length}</button>
        )}
      </div>

      {open && watch.length > 0 && (
        <div style={{ borderTop: '1px solid #f1f5f9', background: '#fbfcfe' }}>
          <div style={{ padding: '5px 12px', fontSize: 9, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Rivals to monitor
          </div>
          {watch.sort((a, b) => (a.rank || 9999) - (b.rank || 9999)).map(w => (
            <div key={w.id} onClick={() => onOpen(w.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', cursor: 'pointer', borderTop: '1px solid #f1f5f9' }}>
              <span style={{ width: 42, textAlign: 'center', fontSize: 13, fontWeight: 800, color: '#334155' }}>{w.rank ? `#${w.rank}` : 'â€”'}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#334155' }}>{w.name}</span>
              {w.country && <span style={{ fontSize: 9, fontWeight: 700, color: '#64748b', background: '#f1f5f9', padding: '2px 6px', borderRadius: 99 }}>{w.country}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// â”€â”€â”€ Youth (TAGG) card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const YOUTH_EVENT_COLOR = { BS: '#3b82f6', GS: '#ec4899', BD: '#8b5cf6', GD: '#f59e0b', XD: '#10b981' }

function bestRank(e) {
  return (e.youth && e.events?.length) ? Math.min(...e.events.map(x => x[1])) : 9999
}

function YouthCard({ entry, onOpenEntry }) {
  const p = entry.players[0]
  return (
    <div onClick={() => onOpenEntry(entry)}
      style={{ background: '#fff', border: '1px solid #e8edf4', borderRadius: 10, marginBottom: 8, padding: '11px 12px', cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{p.name}</span>
        <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 99, background: '#eef2ff', color: '#3730a3', border: '1px solid #a5b4fc', letterSpacing: '0.04em' }}>{entry.age}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        {entry.events.map(([e, r], i) => {
          const c = YOUTH_EVENT_COLOR[e] || '#64748b'
          return (
            <span key={i} style={{ fontSize: 10, fontWeight: 700, color: c, background: `${c}15`, border: `1px solid ${c}30`, padding: '2px 7px', borderRadius: 99 }}>
              {e} #{r}
            </span>
          )
        })}
      </div>
    </div>
  )
}

// â”€â”€â”€ Category column â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function pairKey(players) {
  return (players || []).map(p => p.id).filter(Boolean).sort((a, b) => a - b).join('_')
}
function entryScore(entry, scores, pairScores) {
  const disc = DISCIPLINES[entry.discipline] || {}
  if (disc.kind === 'singles') return scores[entry.players?.[0]?.id]
  return pairScores[pairKey(entry.players)]
}
function sortValue(entry, scores, pairScores) {
  return Number(entryScore(entry, scores, pairScores)?.score) || 0
}

function CategoryColumn({ cat, entries, lookup, scores, pairScores, live, onOpen, onOpenEntry }) {
  const inCat = entries.filter(e => e.category === cat.key)
  const ordered = live ? [...inCat].sort((a, b) =>
    (a.youth && b.youth) ? bestRank(a) - bestRank(b)
    : sortValue(b, scores, pairScores) - sortValue(a, scores, pairScores)) : inCat
  return (
    <div style={{ background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(15,23,42,0.08)', borderRadius: 14, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingBottom: 10, borderBottom: `2px solid ${cat.border}` }}>
        <span style={{ width: 4, height: 30, borderRadius: 99, background: cat.color }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: cat.color }}>{cat.label}</div>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>{cat.blurb}</div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, color: cat.color, background: cat.bg, border: `1px solid ${cat.border}`, padding: '2px 9px', borderRadius: 99 }}>{inCat.length}</span>
      </div>
      {ordered.length === 0
        ? <div style={{ fontSize: 12, color: '#cbd5e1', textAlign: 'center', padding: '20px 0' }}>No athletes yet</div>
        : ordered.map((e, i) => e.youth ? (
            <YouthCard key={`tagg-${e.players[0].id}-${i}`} entry={e} onOpenEntry={onOpenEntry} />
          ) : (
            <EntryCard key={`${e.discipline}-${e.players.map(p => p.id || p.name).join('_')}-${i}`}
              entry={e} lookup={lookup} score={entryScore(e, scores, pairScores)} live={live} onOpen={onOpen} onOpenEntry={onOpenEntry} />
          ))}
    </div>
  )
}

// â”€â”€â”€ Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const TABS = [
  { key: 'squad',   label: 'TOPS' },   // key stays 'squad' â€” internal, not shown
  { key: 'talent',  label: 'Talent' },
  { key: 'events',  label: 'Events' },
  { key: 'compare', label: 'Compare' },
]

export default function SportPage() {
  const { sport: sportKey } = useParams()
  const navigate = useNavigate()
  const sport = getSport(sportKey)

  const [tab, setTab] = useState('squad')
  const [lookup, setLookup] = useState({})
  const [scores, setScores] = useState({})
  const [pairScores, setPairScores] = useState({})
  const [watch, setWatch] = useState([])
  const [movers, setMovers] = useState([])
  const [upcoming, setUpcoming] = useState([])
  const [squadEventIds, setSquadEventIds] = useState(new Set())
  const [loading, setLoading] = useState(true)

  const entries = ROSTER[sportKey] || []

  // Every card opens the OKR dashboard, preselected to the right segment + entity.
  // /player and /pair remain only as fallback when ids are missing.
  const openEntry = (entry) => {
    const disc = DISCIPLINES[entry.discipline] || {}
    const ids = (entry.players || []).map(p => p.id).filter(Boolean)
    if (entry.youth) {
      // Youth cards are player-centric â†’ youth-singles OKR profile.
      if (ids[0]) return navigate(okrLink({ level: entry.age, kind: 'singles', id: ids[0] }))
      return
    }
    if (disc.kind === 'doubles' && ids.length === 2) {
      return navigate(okrLink({ level: 'Senior', kind: 'doubles', ids }))
    }
    if (ids[0]) return navigate(okrLink({ level: 'Senior', kind: 'singles', id: ids[0] }))
  }

  const allIds = useMemo(() => {
    if (!sport?.live) return []
    const s = new Set()
    for (const e of entries) {
      for (const p of e.players || []) if (p.id) s.add(p.id)
      for (const w of e.watch || []) s.add(w)
    }
    return [...s]
  }, [sportKey])

  // Roster athletes only â€” no watchlist rivals. Includes youth/TAGG entries, which
  // the readiness board skips but which are still squad for this purpose.
  const squadIds = useMemo(() => {
    const s = new Set()
    for (const e of entries) for (const p of e.players || []) if (p.id) s.add(p.id)
    return [...s]
  }, [sportKey])

  const singlesIds = useMemo(() => {
    if (!sport?.live) return []
    const s = new Set()
    for (const e of entries) {
      if ((DISCIPLINES[e.discipline] || {}).kind === 'singles' && e.players?.[0]?.id) s.add(e.players[0].id)
    }
    return [...s]
  }, [sportKey])

  useEffect(() => {
    if (!sport) return
    let cancelled = false
    async function load() {
      setLoading(true)
      if (!(sport.live && allIds.length)) {
        if (!cancelled) { setLookup({}); setScores({}); setPairScores({}); setLoading(false) }
        return
      }
      try {
        const { lookup, scores, pairScores } = await loadSquadReadiness(entries)
        if (!cancelled) { setLookup(lookup); setScores(scores); setPairScores(pairScores) }
        // Watchlist + India movers are singles-ranking based â†’ Table Tennis only for now.
        if (sportKey === 'tt') {
          const [w, mv, ue, sq] = await Promise.all([
            loadWatchlist(), loadIndiaMovers(6), loadIndiaUpcomingEvents(6),
            loadSquadEventIds(squadIds),
          ])
          if (!cancelled) { setWatch(w); setMovers(mv); setUpcoming(ue); setSquadEventIds(sq) }
        }
      } catch (e) { console.error('squad readiness failed', e) }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [sportKey])

  if (!sport) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui', color: '#64748b' }}>
        Unknown sport. <button onClick={() => navigate('/')} style={{ marginLeft: 6, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}>Home</button>
      </div>
    )
  }

  return (
    <>
      <div>
        <div style={{ maxWidth: 'var(--tops-wide)', margin: '0 auto', padding: '28px 40px 56px' }}>

          {/* Header */}
          <div style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 10, fontWeight: 700, color: 'var(--tops-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  â† TOPS Intelligence
                </button>
                <h1 style={{ margin: '4px 0 0', fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--tops-ink)' }}>{sport.name}</h1>
              </div>
              <button onClick={() => navigate('/okr')} style={{ fontSize: 12, fontWeight: 600, color: 'var(--tops-slate)', background: 'none', border: 'none', cursor: 'pointer' }}>OKR</button>
            </div>
            {sportKey !== 'tennis' && <div style={{ display: 'flex', gap: 24, marginTop: 16, borderBottom: '1px solid var(--tops-border)' }}>
              {TABS.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)} style={{
                  padding: '0 0 10px', marginBottom: -1, background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 13.5, fontWeight: 600,
                  color: tab === t.key ? 'var(--tops-ink)' : 'var(--tops-muted)',
                  borderBottom: tab === t.key ? '2px solid var(--tops-accent)' : '2px solid transparent',
                }}>{t.label}</button>
              ))}
            </div>}
          </div>

          {/* Non-live sport */}
          {!sport.live && (
            <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', padding: '12px 16px', marginBottom: 16, fontSize: 12, color: '#b45309' }}>
              Live ranking adapter pending. Showing static roster.
            </div>
          )}

          {sportKey === 'tennis' ? (
            <TennisView />
          ) : loading ? (
            <div style={{ textAlign: 'center', padding: '80px 0', color: '#94a3b8', fontSize: 14 }}>Loading {sport.name}â€¦</div>
          ) : tab === 'squad' ? (
            <SquadBoard sport={sport} entries={entries} lookup={lookup} scores={scores} pairScores={pairScores} watch={watch} movers={movers} upcoming={upcoming} squadEventIds={squadEventIds} squadIds={squadIds} loading={loading} />
          ) : tab === 'talent' ? (
            <TalentTab onOpen={id => navigate(okrLink({ level: 'Senior', kind: 'singles', id }))} navigate={navigate} />
          ) : tab === 'events' ? (
            <EventsTab />
          ) : (
            <CompareTab navigate={navigate} />
          )}
        </div>
      </div>
    </>
  )
}
