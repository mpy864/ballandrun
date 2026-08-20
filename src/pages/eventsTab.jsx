import { Fragment, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { card, chip, T } from '../lib/ui.js'
import { loadEventList, loadEventYears, loadEventDetail, loadTopsEventIds,
         SORTS, sortEvents, difficultyOf, DEFAULT_SORT } from '../lib/events.js'

const WIN = '#12a150'
const LOSS = '#dc2626'
const GOLD = '#b8860b'

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const parts = d => {
  if (!d) return null
  const [y, m, day] = String(d).split('-').map(Number)
  return { y, m, day }
}
const fmtDate = d => {
  const p = parts(d)
  return p ? `${p.day} ${MON[(p.m || 1) - 1]} ${String(p.y).slice(2)}` : ''
}
// "11–13 Aug 26" when a tournament stays in one month, "28 Jul – 2 Aug 26" when it
// crosses one. Repeating the month on both sides of a three-day event is noise.
const fmtRange = (from, to) => {
  const a = parts(from), b = parts(to)
  if (!a && !b) return ''
  if (!a || !b) return fmtDate(from || to)
  if (a.y === b.y && a.m === b.m) {
    return a.day === b.day
      ? `${a.day} ${MON[a.m - 1]} ${String(a.y).slice(2)}`
      : `${a.day}–${b.day} ${MON[a.m - 1]} ${String(a.y).slice(2)}`
  }
  return `${a.day} ${MON[a.m - 1]} – ${b.day} ${MON[b.m - 1]} ${String(b.y).slice(2)}`
}
const clean = n => (n || '').replace(/\s+presented\s+by\s+.*/i, '').replace(/\s+20\d\d$/, '')

// ─── expanded report for one tournament ──────────────────────────────────────

function Section({ title, note, children }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 7 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em',
                       textTransform: 'uppercase', color: T.muted }}>{title}</span>
        {note && <span style={{ fontSize: 11.5, color: T.muted }}>{note}</span>}
      </div>
      {children}
    </div>
  )
}

function UpsetRow({ r }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 46px 1fr', gap: 10,
                  padding: '4px 0', fontSize: 12.5, alignItems: 'baseline' }}>
      <span style={{ color: T.ink, fontWeight: 550 }}>
        {r.player_name}
        {r.player_rank != null && <span style={{ color: T.muted, fontWeight: 400 }}> #{r.player_rank}</span>}
      </span>
      <span className="tabnum" style={{ textAlign: 'center', fontWeight: 700,
                                        color: r.won ? WIN : LOSS }}>{r.score}</span>
      <span style={{ color: T.slate }}>
        {r.opp_name}
        {r.opp_country && <span style={{ fontSize: 10.5, color: T.muted, marginLeft: 5 }}>{r.opp_country}</span>}
        {r.opp_rank != null && <span style={{ color: T.muted }}> #{r.opp_rank}</span>}
      </span>
    </div>
  )
}

function EventDetail({ ev, onOpenPlayer }) {
  const [d, setD] = useState(null)

  useEffect(() => {
    let c = false
    ;(async () => { const r = await loadEventDetail(ev.event_id); if (!c) setD(r) })()
    return () => { c = true }
  }, [ev.event_id])

  if (!d) return <div style={{ padding: '14px 2px', fontSize: 12.5, color: T.muted }}>Loading…</div>

  const singles = d.players.filter(p => p.kind === 'singles')
  const doubles = d.players.filter(p => p.kind !== 'singles')

  return (
    <div style={{ padding: '14px 2px 20px' }}>

      {/* header counts */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 30px', fontSize: 12.5, color: T.slate }}>
        <span><b style={{ color: T.ink }}>{ev.athletes}</b> Indian
          {' / '}<b style={{ color: T.ink }}>{ev.field_players ?? '—'}</b> total athletes</span>
        <span><b style={{ color: T.ink }}>{ev.field_countries ?? '—'}</b> countries</span>
        <span>
          Difficulty <b style={{ color: T.ink }}>{difficultyOf(ev.field_median_rank)?.label ?? '—'}</b>
          <span style={{ color: T.muted }}>
            {' — best in draw '}<b style={{ color: T.slate }}>#{ev.field_best_rank ?? '—'}</b>
            {', top quarter inside '}<b style={{ color: T.slate }}>#{ev.field_p25_rank ?? '—'}</b>
            {', typical entrant '}<b style={{ color: T.slate }}>#{ev.field_median_rank ?? '—'}</b>
          </span>
          {/* A median over a fraction of the draw is not the draw's median. Say so
              rather than presenting it as if every entrant were ranked. */}
          {ev.rank_coverage_pct != null && ev.rank_coverage_pct < 80 &&
            <span style={{ color: LOSS }}> · only {ev.rank_coverage_pct}% of the draw is ranked</span>}
        </span>
        <span>Points <b style={{ color: T.ink }}>{ev.contingent_points?.toLocaleString() ?? '—'}</b></span>
      </div>

      {/* deepest runs */}
      <Section title="Best results" note="deepest round reached, and everyone from the semifinals on">
        {d.runs.length === 0
          ? <div style={{ fontSize: 12.5, color: T.muted }}>No completed runs.</div>
          : d.runs.map((p, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '112px 1fr 150px',
                                  gap: 10, padding: '4px 0', fontSize: 12.5, alignItems: 'baseline' }}>
              <span style={{ fontWeight: 700, color: p.depth >= 9 ? GOLD : T.ink }}>{p.round}</span>
              <span style={{ fontWeight: 550, color: T.ink }}>{p.name}</span>
              <span style={{ color: T.muted }}>{p.discipline}</span>
            </div>
          ))}
      </Section>

      {/* how far everyone got */}
      <Section title="Every entrant" note="round reached">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 28px' }}>
          {[['Singles', singles], ['Doubles', doubles]].map(([label, list]) => (
            <div key={label}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.slate, margin: '4px 0 3px' }}>{label}</div>
              {list.length === 0
                ? <div style={{ fontSize: 12, color: T.muted }}>—</div>
                : list.map((p, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 96px 44px',
                                        gap: 8, padding: '3px 0', fontSize: 12, alignItems: 'baseline' }}>
                    <span
                      onClick={() => p.kind === 'singles' && p.playerId && onOpenPlayer(p.playerId)}
                      style={{ color: T.ink, cursor: p.kind === 'singles' && p.playerId ? 'pointer' : 'default',
                               overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name}
                      {p.rank != null && <span style={{ color: T.muted }}> #{p.rank}</span>}
                    </span>
                    <span style={{ color: T.slate }}>{p.round}</span>
                    <span className="tabnum" style={{ color: T.muted, textAlign: 'right' }}>{p.w}–{p.l}</span>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </Section>

      {/* all matches */}
      <Section title="All matches">
        {d.groups.map(g => (
          <div key={g.discipline} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: T.ink, margin: '6px 0 2px' }}>
              {g.discipline}
            </div>
            {g.rounds.map(r => (
              <div key={r.round}>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.05em',
                              textTransform: 'uppercase', color: T.muted, margin: '5px 0 1px' }}>{r.round}</div>
                {r.matches.map(m => (
                  <div key={m.match_id} style={{ display: 'grid',
                        gridTemplateColumns: '1fr 46px 1fr 148px', gap: 10, padding: '2px 0',
                        fontSize: 12, alignItems: 'baseline' }}>
                    <span style={{ color: T.ink, fontWeight: 550 }}>
                      {m.player_name}
                      {m.player_rank != null && <span style={{ color: T.muted, fontWeight: 400 }}> #{m.player_rank}</span>}
                    </span>
                    <span className="tabnum" style={{ textAlign: 'center', fontWeight: 700,
                                                      color: m.won ? WIN : LOSS }}>
                      {m.score && m.score !== '0-0' ? m.score : '—'}
                    </span>
                    <span style={{ color: T.slate }}>
                      {m.opp_name}
                      {m.opp_country && <span style={{ fontSize: 10.5, color: T.muted, marginLeft: 5 }}>{m.opp_country}</span>}
                      {m.opp_rank != null && <span style={{ color: T.muted }}> #{m.opp_rank}</span>}
                    </span>
                    <span className="tabnum" style={{ fontSize: 10.5, color: T.muted, textAlign: 'right',
                                                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.game_scores || ''}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </Section>

      {/* upsets last, as asked */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
        <Section title={`Upsets given · ${d.upsetsGiven.length}`} note="beat a better-ranked opponent">
          {d.upsetsGiven.length === 0
            ? <div style={{ fontSize: 12.5, color: T.muted }}>None.</div>
            : d.upsetsGiven.map(r => <UpsetRow key={r.match_id + r.player_name} r={r} />)}
        </Section>
        <Section title={`Upsets taken · ${d.upsetsTaken.length}`} note="lost to a lower-ranked opponent">
          {d.upsetsTaken.length === 0
            ? <div style={{ fontSize: 12.5, color: T.muted }}>None.</div>
            : d.upsetsTaken.map(r => <UpsetRow key={r.match_id + r.player_name} r={r} />)}
        </Section>
      </div>
    </div>
  )
}

// ─── the tab ─────────────────────────────────────────────────────────────────

const COLS = [
  { key: 'name',      label: 'Tournament', sort: 'name',      align: 'left'  },
  { key: 'dates',     label: 'Dates',      sort: 'date',      align: 'left'  },
  { key: 'athletes',  label: 'Indians',    sort: 'athletes',  align: 'right', sub: 'of total' },
  { key: 'record',    label: 'record',     sort: 'record',    align: 'right', wl: true },
  { key: 'points',    label: 'Points',     sort: 'points',    align: 'right' },
  { key: 'field',     label: 'Difficulty', sort: 'field',     align: 'right', sub: 'best · top25 · typical' },
  { key: 'countries', label: 'Countries',  sort: 'countries', align: 'right' },
  { key: 'upsets',    label: 'Upsets',     sort: 'upsets',    align: 'right', sub: 'given · taken' },
]

export default function EventsTab() {
  const navigate = useNavigate()
  const [all, setAll] = useState(null)
  const [years, setYears] = useState([])
  const [year, setYear] = useState(null)
  const [showSenior, setShowSenior] = useState(true)
  const [showJunior, setShowJunior] = useState(true)
  const [sortKey, setSortKey] = useState(DEFAULT_SORT.key)
  const [sortDir, setSortDir] = useState(DEFAULT_SORT.dir)
  const [open, setOpen] = useState(null)
  const [tops, setTops] = useState(new Set())

  const sorted = sortKey !== DEFAULT_SORT.key || sortDir !== DEFAULT_SORT.dir

  useEffect(() => {
    let c = false
    ;(async () => {
      const [ys, tp] = await Promise.all([loadEventYears(), loadTopsEventIds('tt')])
      if (c) return
      setYears(ys)
      setYear(ys[0] || null)
      setTops(tp)
    })()
    return () => { c = true }
  }, [])

  useEffect(() => {
    if (year === null) return
    let c = false
    setAll(null)
    ;(async () => { const e = await loadEventList({ year }); if (!c) setAll(e) })()
    return () => { c = true }
  }, [year])

  const rows = useMemo(() => {
    if (!all) return []
    const kept = all.filter(e => (e.isJunior ? showJunior : showSenior))
    return sortEvents(kept, sortKey, sortDir)
  }, [all, showSenior, showJunior, sortKey, sortDir])

  function clickSort(key) {
    if (!key) return
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(SORTS[key]?.dir || 'desc') }
  }

  const toggle = (on, set, label, count) => (
    <button onClick={() => set(v => !v)} style={{
      appearance: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
      padding: '5px 13px', borderRadius: 0,
      border: `1px solid ${on ? T.ink : T.border}`,
      background: on ? T.ink : 'transparent',
      color: on ? '#fff' : T.slate,
    }}>{label}{count != null && <span style={{ opacity: .65 }}> {count}</span>}</button>
  )

  const nJunior = (all || []).filter(e => e.isJunior).length
  const nSenior = (all || []).filter(e => !e.isJunior).length

  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      {/* controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    padding: '14px 22px', borderBottom: `1px solid ${T.divider}` }}>
        {toggle(showSenior, setShowSenior, 'Senior', nSenior)}
        {toggle(showJunior, setShowJunior, 'Junior', nJunior)}

        {/* Sorting is easy to enter and easy to forget you are in — without a way back,
            a reader who sorted by points half a minute ago reads the list as if it were
            chronological. Only shown while it applies. */}
        {sorted && (
          <button
            onClick={() => { setSortKey(DEFAULT_SORT.key); setSortDir(DEFAULT_SORT.dir) }}
            style={{ appearance: 'none', cursor: 'pointer', background: 'transparent',
                     border: 'none', padding: '5px 4px', fontSize: 12,
                     color: T.slate, textDecoration: 'underline' }}>
            Sorted by {SORTS[sortKey]?.label ?? sortKey} — back to newest first
          </button>
        )}

        <span style={{ flex: 1 }} />
        <select value={year ?? ''} onChange={e => setYear(e.target.value)}
          style={{ fontSize: 12.5, padding: '5px 9px', border: `1px solid ${T.border}`,
                   background: 'transparent', color: T.ink, borderRadius: 0 }}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {all === null
        ? <div style={{ padding: 34, textAlign: 'center', color: T.muted, fontSize: 13 }}>Loading…</div>
        : rows.length === 0
          ? <div style={{ padding: 34, textAlign: 'center', color: T.muted, fontSize: 13 }}>
              No tournaments. Turn Senior or Junior back on.
            </div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr>
                    {COLS.map(c => (
                      <th key={c.key}
                        onClick={() => clickSort(c.sort)}
                        style={{
                          textAlign: c.align, padding: '9px 12px', whiteSpace: 'nowrap',
                          fontSize: 10, fontWeight: 700, letterSpacing: '.07em',
                          textTransform: 'uppercase', color: sortKey === c.sort ? T.ink : T.muted,
                          borderBottom: `1px solid ${T.border}`,
                          cursor: c.sort ? 'pointer' : 'default', userSelect: 'none',
                        }}>
                        {/* W and L carry their result colour in the header too, so the
                            column reads as wins-then-losses without a legend. */}
                        {c.wl
                          ? <span><span style={{ color: WIN }}>W</span>
                              <span style={{ color: T.muted }}>/</span>
                              <span style={{ color: LOSS }}>L</span> {c.label}</span>
                          : c.label}
                        {sortKey === c.sort && <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                        {c.sub && (
                          <span style={{ display: 'block', fontSize: 8.5, fontWeight: 500,
                                         letterSpacing: '.02em', textTransform: 'none',
                                         color: T.muted, marginTop: 1 }}>{c.sub}</span>
                        )}
                      </th>
                    ))}
                    <th style={{ borderBottom: `1px solid ${T.border}`, width: 24 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(e => {
                    const isOpen = open === e.event_id
                    return (
                      // Key belongs on the Fragment, not its children: in a list React
                      // reconciles the outermost node, and a bare <> has no identity.
                      <Fragment key={e.event_id}>
                        <tr
                          onClick={() => setOpen(isOpen ? null : e.event_id)}
                          onMouseEnter={ev => { if (!isOpen) ev.currentTarget.style.background = 'rgba(0,0,0,0.022)' }}
                          onMouseLeave={ev => { if (!isOpen) ev.currentTarget.style.background = 'transparent' }}
                          style={{ cursor: 'pointer', background: isOpen ? 'rgba(0,0,0,0.03)' : 'transparent' }}>
                          <td style={{ padding: '10px 12px', borderBottom: isOpen ? 'none' : `1px solid ${T.divider}` }}>
                            <span style={{ fontWeight: 600, color: T.ink }}>{clean(e.event_name)}</span>
                            {e.isJunior && <span style={{ ...chip('#3730a3', { fontSize: 9, marginLeft: 7 }) }}>Junior</span>}
                            {tops.has(e.event_id) && <span style={{ ...chip(GOLD, { fontSize: 9, marginLeft: 5 }) }}>TOPS</span>}
                          </td>
                          <td className="tabnum" style={{ padding: '10px 12px', color: T.slate, whiteSpace: 'nowrap',
                                                          borderBottom: isOpen ? 'none' : `1px solid ${T.divider}` }}>
                            {fmtRange(e.first_date, e.last_date)}
                          </td>
                          <td className="tabnum" style={{ textAlign: 'right', padding: '10px 12px', borderBottom: isOpen ? 'none' : `1px solid ${T.divider}` }}>
                            {e.athletes}<span style={{ color: T.muted }}>/{e.field_players ?? '—'}</span>
                          </td>
                          <td className="tabnum" style={{ textAlign: 'right', padding: '10px 12px', borderBottom: isOpen ? 'none' : `1px solid ${T.divider}` }}>
                            <span style={{ color: WIN, fontWeight: 700 }}>{e.wins}</span>
                            <span style={{ color: T.muted }}>–</span>
                            <span style={{ color: LOSS, fontWeight: 700 }}>{e.losses}</span>
                            <span style={{ color: T.muted }}> {e.winPct}%</span>
                          </td>
                          <td className="tabnum" style={{ textAlign: 'right', padding: '10px 12px', borderBottom: isOpen ? 'none' : `1px solid ${T.divider}` }}>
                            {e.contingent_points?.toLocaleString() ?? '—'}
                          </td>
                          <td style={{ textAlign: 'right', padding: '10px 12px', whiteSpace: 'nowrap',
                                       borderBottom: isOpen ? 'none' : `1px solid ${T.divider}` }}>
                            {(() => {
                              const d = difficultyOf(e.field_median_rank)
                              if (!d) return <span style={{ color: T.muted }}>—</span>
                              // All three measures, not one with the others buried in a
                              // tooltip: the best entrant says whether anyone elite came,
                              // the top quarter describes the sharp end, the typical
                              // entrant describes the draw a player actually faces.
                              return (
                                <>
                                  <span style={{ fontWeight: d.weight, color: T.ink }}>{d.label}</span>
                                  <span className="tabnum" style={{ display: 'block', fontSize: 11, color: T.muted, marginTop: 1 }}>
                                    #{e.field_best_rank ?? '—'} · #{e.field_p25_rank ?? '—'} · #{e.field_median_rank}
                                  </span>
                                </>
                              )
                            })()}
                          </td>
                          <td className="tabnum" style={{ textAlign: 'right', padding: '10px 12px', borderBottom: isOpen ? 'none' : `1px solid ${T.divider}` }}>
                            {e.field_countries ?? '—'}
                          </td>
                          <td className="tabnum" style={{ textAlign: 'right', padding: '10px 12px', borderBottom: isOpen ? 'none' : `1px solid ${T.divider}` }}>
                            <span style={{ color: WIN }}>{e.upsets_given}</span>
                            <span style={{ color: T.muted }}>/</span>
                            <span style={{ color: LOSS }}>{e.upsets_taken}</span>
                          </td>
                          <td style={{ textAlign: 'right', padding: '10px 8px', color: T.muted, fontSize: 10,
                                       borderBottom: isOpen ? 'none' : `1px solid ${T.divider}` }}>
                            {isOpen ? '▾' : '▸'}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            {/* COLS (8) plus the caret column = 9 */}
                            <td colSpan={COLS.length + 1} style={{ padding: '0 22px', background: 'rgba(0,0,0,0.015)',
                                                     borderBottom: `1px solid ${T.divider}` }}>
                              <EventDetail ev={e} onOpenPlayer={id => navigate(`/player/${id}`)} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
    </div>
  )
}
