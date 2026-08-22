import { Fragment, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { card, chip, T } from '../lib/ui.js'
import { loadEventList, loadEventYears, loadEventDetail, loadTopsEventIds,
         SORTS, sortEvents, DEFAULT_SORT } from '../lib/events.js'
import { shortRound } from '../lib/matchFormat.js'

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

// ─── progression chart ───────────────────────────────────────────────────────

// A dumbbell per entrant: where they joined the draw, where they went out.
//
// The form comes from the data's job — entry-to-exit per item — so it is one hue in
// two shades, not a categorical palette. Colour is spent on exactly one thing: an
// exit that was an upset, which is a status, not an identity.
//
// The table view below is not a fallback. It is the same numbers in a form that
// survives a screen reader, a printout and colour blindness, and it stays reachable.
function Progression({ scale, players }) {
  const [hover, setHover] = useState(null)
  if (!scale.length || !players.length) return null

  const LANE = 20, TOP = 20
  // The name column shrinks with the screen instead of holding 178px. At a fixed width
  // it left roughly 150px of plot on a phone, so every dumbbell collapsed into the same
  // short stub and the chart stopped saying anything. Both the axis row and every lane
  // read the same variable, so they cannot drift apart.
  const LEFT = 'clamp(92px, 30vw, 178px)'
  const colW = 100 / scale.length                // percent per round
  const at = depth => {                          // centre of a round's column, in %
    const i = scale.findIndex(s => s.depth === depth)
    return (i < 0 ? 0 : i) * colW + colW / 2
  }

  // One block per event, in the order the loader already put them. The event name is a
  // heading over its own lines rather than a column repeated beside every mark — the
  // repetition was the caption competing with the thing it captioned.
  const blocks = []
  for (const p of players) {
    if (!blocks.length || blocks[blocks.length - 1].discipline !== p.discipline)
      blocks.push({ discipline: p.discipline, rows: [] })
    blocks[blocks.length - 1].rows.push(p)
  }

  const Grid = () => scale.map(s => (
    <span key={s.round} style={{
      position: 'absolute', left: `${at(s.depth)}%`, top: 0, bottom: 0,
      width: 1, background: 'rgba(0,0,0,0.05)',
    }} />
  ))

  return (
    <div style={{ position: 'relative', padding: '2px 0' }}>
      {/* axis: deepest round at the right, so a longer bar is always a better run */}
      <div style={{ display: 'grid', gridTemplateColumns: `${LEFT} 1fr`, gap: 10 }}>
        <div />
        <div style={{ position: 'relative', height: TOP }}>
          {scale.map(s => (
            <span key={s.round} style={{
              position: 'absolute', left: `${at(s.depth)}%`, transform: 'translateX(-50%)',
              fontSize: 9, fontWeight: 700, letterSpacing: '.03em',
              color: T.muted, whiteSpace: 'nowrap',
            }}>{shortRound(s.round)}</span>
          ))}
        </div>
      </div>

      {blocks.map(b => (
        <div key={b.discipline} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em',
                        textTransform: 'uppercase', color: T.ink, padding: '4px 0 3px' }}>
            {b.discipline}
          </div>

          {b.rows.map(p => {
            const id = `${p.name}||${p.discipline}`
            const x1 = at(p.fromDepth), x2 = at(p.depth)
            const on = hover === id
            return (
              <div key={id}
                onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)}
                style={{ display: 'grid', gridTemplateColumns: `${LEFT} 1fr`, gap: 10,
                         alignItems: 'center', height: LANE,
                         background: on ? 'rgba(0,0,0,0.035)' : 'transparent' }}>
                <span title={p.name}
                  style={{ fontSize: 11, color: T.ink, overflow: 'hidden',
                           textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {p.name}
                  {p.rank != null && <span style={{ color: T.muted }}> #{p.rank}</span>}
                </span>

                <div style={{ position: 'relative', height: LANE }}>
                  <Grid />
                  {/* 2px connector — its length IS the number of wins */}
                  <span style={{
                    position: 'absolute', left: `${Math.min(x1, x2)}%`, width: `${Math.abs(x2 - x1)}%`,
                    top: '50%', height: 2, marginTop: -1, borderRadius: 2, background: T.muted,
                  }} />
                  {/* entered the draw */}
                  <span style={{
                    position: 'absolute', left: `${x1}%`, top: '50%',
                    width: 8, height: 8, marginLeft: -4, marginTop: -4, borderRadius: 99,
                    background: T.muted, boxShadow: '0 0 0 2px #fff',
                  }} />
                  {/* went out — status colour only when the exit was a loss to a lower rank */}
                  <span style={{
                    position: 'absolute', left: `${x2}%`, top: '50%',
                    width: 10, height: 10, marginLeft: -5, marginTop: -5, borderRadius: 99,
                    background: p.exitUpset ? LOSS : T.ink, boxShadow: '0 0 0 2px #fff',
                  }} />
                </div>
              </div>
            )
          })}
        </div>
      ))}

      {/* Reserved height: without it the caption jumped every time the pointer moved
          onto a bar, which shifted the whole column under the reader's cursor. */}
      <div style={{ fontSize: 11, color: T.slate, minHeight: 30, paddingTop: 4,
                    borderTop: '1px solid rgba(0,0,0,0.07)' }}>
        {hover
          ? (() => {
              const p = players.find(x => `${x.name}||${x.discipline}` === hover)
              if (!p) return null
              return <>
                <b style={{ color: T.ink }}>{p.name}</b>
                {' — in at '}{p.fromRound}{', out at '}{p.round}{' · '}{p.w}–{p.l}
                {p.exitUpset && <span style={{ color: LOSS }}> · lost to a lower-ranked opponent</span>}
              </>
            })()
          : <span style={{ color: T.muted }}>
              Left dot = entered the draw, right dot = went out; bar length = wins.
              <span style={{ color: LOSS, marginLeft: 5 }}>●</span> exit was a loss to a lower rank.
            </span>}
      </div>
    </div>
  )
}

function UpsetRow({ r }) {
  return (
    <div style={{ display: 'grid',
                  gridTemplateColumns: 'minmax(0, 170px) 42px minmax(0, 1fr)', gap: 10,
                  padding: '3px 0', fontSize: 12, alignItems: 'baseline' }}>
      <span style={{ color: T.ink, fontWeight: 550, overflow: 'hidden',
                     textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {r.player_name}
        {r.player_rank != null && <span style={{ color: T.muted, fontWeight: 400 }}> #{r.player_rank}</span>}
      </span>
      <span className="tabnum" style={{ textAlign: 'center', fontWeight: 700,
                                        color: r.won ? WIN : LOSS }}>{r.score}</span>
      <span style={{ color: T.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {r.opp_name}
        {r.opp_country && <span style={{ fontSize: 10.5, color: T.muted, marginLeft: 5 }}>{r.opp_country}</span>}
        {r.opp_rank != null && <span style={{ color: T.muted }}> #{r.opp_rank}</span>}
      </span>
    </div>
  )
}

function EventDetail({ ev, onOpenPlayer }) {
  const [d, setD] = useState(null)
  // All matches stays shut. Europe Smash alone is 25 of them across five disciplines,
  // and opening a row to be met by four screens of scorelines buries the summary that
  // most readers came for.
  const [showMatches, setShowMatches] = useState(true)
  // The chart is the default read; the list is the same numbers in a form that
  // survives a screen reader, a printout and colour blindness. Both stay reachable.
  const [asTable, setAsTable] = useState(false)

  useEffect(() => {
    let c = false
    ;(async () => { const r = await loadEventDetail(ev.event_id); if (!c) setD(r) })()
    return () => { c = true }
  }, [ev.event_id])

  if (!d) return <div style={{ padding: '14px 2px', fontSize: 12.5, color: T.muted }}>Loading…</div>

  // A single column with the discipline beside each name, rather than singles and
  // doubles side by side: the two lists are never the same length, so the short one
  // left a column of empty space next to the long one.
  const entrants = d.players

  return (
    // Full width, not the old 940 cap: the point of this panel is that one tournament
    // fits on one screen, and that only works if the chart and the scorelines can sit
    // side by side instead of one below the other.
    <div style={{ padding: '14px 2px 20px' }}>

      {/* header counts */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 30px', fontSize: 12.5, color: T.slate }}>
        <span><b style={{ color: T.ink }}>{ev.athletes}</b> Indian
          {' / '}<b style={{ color: T.ink }}>{ev.field_players ?? '—'}</b> total athletes</span>
        <span><b style={{ color: T.ink }}>{ev.field_countries ?? '—'}</b> countries</span>
        <span>
          <span style={{ color: T.muted }}>
            {'Best in draw '}<b style={{ color: T.ink }}>#{ev.field_best_rank ?? '—'}</b>
            {', top quarter inside '}<b style={{ color: T.ink }}>#{ev.field_p25_rank ?? '—'}</b>
            {', median '}<b style={{ color: T.ink }}>#{ev.field_median_rank ?? '—'}</b>
          </span>
          {/* A median over a fraction of the draw is not the draw's median. Say so
              rather than presenting it as if every entrant were ranked. */}
          {ev.rank_coverage_pct != null && ev.rank_coverage_pct < 80 &&
            <span style={{ color: LOSS }}> · only {ev.rank_coverage_pct}% of the draw is ranked</span>}
        </span>
        <span>Points <b style={{ color: T.ink }}>{ev.contingent_points?.toLocaleString() ?? '—'}</b></span>
      </div>

      {/* deepest runs */}
      <Section title="Best results" note="deepest round, plus everyone from the semifinals on">
        {d.runs.length === 0
          ? <div style={{ fontSize: 12.5, color: T.muted }}>No completed runs.</div>
          : d.runs.map((p, i) => (
            <div key={i} style={{ display: 'grid',
                                  gridTemplateColumns: 'minmax(90px, 128px) minmax(0, 1fr) minmax(0, 132px)',
                                  gap: 12, padding: '3px 0', fontSize: 12.5, alignItems: 'baseline' }}>
              <span style={{ fontWeight: 700, color: p.depth >= 9 ? GOLD : T.ink }}>{p.round}</span>
              <span style={{ fontWeight: 550, color: T.ink }}>{p.name}</span>
              <span style={{ color: T.muted, fontSize: 11.5 }}>{p.discipline}</span>
            </div>
          ))}
      </Section>

      {/* The two detail panels, side by side. auto-fit means they stack by themselves on
          a narrow screen rather than each being squeezed to half of nothing. */}
      {/* tops-cols, not a bare minmax(460px, 1fr): without its min(…, 100%) guard a
          460px floor forces a 460px column inside a 360px phone, and the whole PAGE
          scrolls sideways rather than the column narrowing. */}
      <div className="tops-cols" style={{ ['--col']: '460px', gap: '0 32px' }}>

      {/* how far everyone got — chart by default, table always one click away */}
      <Section title="Every entrant" note={asTable ? 'round reached' : 'entered → went out'}>
        <button onClick={() => setAsTable(v => !v)}
          style={{ appearance: 'none', border: 'none', background: 'transparent', padding: 0,
                   cursor: 'pointer', fontSize: 11.5, color: T.slate, textDecoration: 'underline',
                   marginBottom: 6 }}>
          {asTable ? 'Show chart' : 'Show as table'}
        </button>

        {!asTable
          ? <Progression scale={d.scale} players={entrants} />
          : entrants.map((p, i) => (
          <div key={i} style={{ display: 'grid',
                                gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr) minmax(0,1fr) 38px',
                                gap: 10, padding: '2px 0', fontSize: 11.5, alignItems: 'baseline',
                                // same event blocks as the chart, so the two views read alike
                                marginTop: i && entrants[i - 1].discipline !== p.discipline ? 8 : 0 }}>
            <span
              onClick={() => p.kind === 'singles' && p.playerId && onOpenPlayer(p.playerId)}
              style={{ color: T.ink, cursor: p.kind === 'singles' && p.playerId ? 'pointer' : 'default',
                       overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.name}
              {p.rank != null && <span style={{ color: T.muted }}> #{p.rank}</span>}
            </span>
            {/* nowrap: "Qualifying Round 3" was breaking across two lines and doubling
                the height of half the list */}
            <span style={{ color: T.slate, whiteSpace: 'nowrap' }}>{p.round}</span>
            <span style={{ color: T.muted, fontSize: 11.5, overflow: 'hidden',
                           textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.discipline}</span>
            <span className="tabnum" style={{ color: T.muted, textAlign: 'right' }}>{p.w}–{p.l}</span>
          </div>
        ))}
      </Section>

      {/* every scoreline, in its own scroll pane beside the chart. It used to be shut by
          default because 25 matches buried the summary underneath it; in a column of its
          own it buries nothing, so it opens with the row. */}
      <Section title={`All matches · ${d.groups.reduce((n, g) => n + g.played, 0)}`}
               note="deepest round first">
        <button onClick={() => setShowMatches(v => !v)}
          style={{ appearance: 'none', border: 'none', background: 'transparent', padding: 0,
                   cursor: 'pointer', fontSize: 11.5, color: T.slate, textDecoration: 'underline',
                   marginBottom: 6 }}>
          {showMatches ? 'Hide every scoreline' : 'Show every scoreline'}
        </button>
        <div style={{ maxHeight: showMatches ? 560 : 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {showMatches && d.groups.map(g => (
          <div key={g.discipline} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: T.ink, margin: '6px 0 2px' }}>
              {g.discipline}
            </div>
            {g.rounds.map(r => (
              <div key={r.round}>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.05em',
                              textTransform: 'uppercase', color: T.muted, margin: '5px 0 1px' }}>{r.round}</div>
                {/* Fluid now that this lives in half the width — fixed 210/46/230/1fr
                    columns overflowed the pane. The game scores wrap rather than being
                    clipped: a five-game scoreline is the one most worth reading. */}
                {r.matches.map(m => (
                  <div key={m.match_id} style={{ display: 'grid',
                        gridTemplateColumns: 'minmax(0,1fr) 42px minmax(0,1.05fr) minmax(76px,0.7fr)',
                        gap: 10, padding: '2px 0', fontSize: 11.5, alignItems: 'baseline' }}>
                    <span style={{ color: T.ink, fontWeight: 550, overflow: 'hidden',
                                   textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.player_name}
                      {m.player_rank != null && <span style={{ color: T.muted, fontWeight: 400 }}> #{m.player_rank}</span>}
                    </span>
                    <span className="tabnum" style={{ textAlign: 'center', fontWeight: 700,
                                                      color: m.won ? WIN : LOSS }}>
                      {m.score && m.score !== '0-0' ? m.score : '—'}
                    </span>
                    <span style={{ color: T.slate, overflow: 'hidden',
                                   textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.opp_name}
                      {m.opp_country && <span style={{ fontSize: 10.5, color: T.muted, marginLeft: 5 }}>{m.opp_country}</span>}
                      {m.opp_rank != null && <span style={{ color: T.muted }}> #{m.opp_rank}</span>}
                    </span>
                    <span className="tabnum" style={{ fontSize: 10, color: T.muted,
                                                      lineHeight: 1.35, wordBreak: 'break-word' }}>
                      {m.game_scores || ''}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
        </div>
      </Section>

      </div>{/* end of the two detail columns */}

      {/* upsets last, as asked */}
      <div className="tops-cols" style={{ ['--col']: '460px', gap: '0 32px' }}>
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
  { key: 'field',     label: 'Difficulty', sort: 'field',     align: 'right', sub: 'best · top25 · median' },
  { key: 'countries', label: 'Countries',  sort: 'countries', align: 'right' },
  { key: 'upsets',    label: 'Upsets',     sort: 'upsets',    align: 'right', sub: 'given · taken' },
]

export default function EventsTab() {
  const navigate = useNavigate()
  const [all, setAll] = useState(null)
  const [years, setYears] = useState([])
  // undefined = years not fetched yet; null = "All years"; a string = that season.
  // These are three different states and collapsing the last two stopped All years
  // ever loading.
  const [year, setYear] = useState(undefined)
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
    if (year === undefined) return          // years not fetched yet
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
        {/* "All years" is what makes cross-season comparison possible: pick it, then
            sort by points or difficulty and 2024, 2025 and 2026 rank against each
            other in one list. A single-year filter can only ever answer one season. */}
        <select value={year ?? ''} onChange={e => setYear(e.target.value || null)}
          style={{ fontSize: 12.5, padding: '5px 9px', border: `1px solid ${T.border}`,
                   background: 'transparent', color: T.ink, borderRadius: 0 }}>
          <option value="">All years</option>
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
                          {/* Just the three ranks. The Elite/Hard/Medium/Open labels were
                              a judgement stacked on top of the numbers, and the numbers
                              already say it. */}
                          <td className="tabnum" style={{ textAlign: 'right', padding: '10px 12px',
                                       whiteSpace: 'nowrap', color: T.slate,
                                       borderBottom: isOpen ? 'none' : `1px solid ${T.divider}` }}>
                            {e.field_median_rank == null
                              ? <span style={{ color: T.muted }}>—</span>
                              : <>#{e.field_best_rank ?? '—'}
                                  <span style={{ color: T.muted }}> · </span>#{e.field_p25_rank ?? '—'}
                                  <span style={{ color: T.muted }}> · </span>
                                  <span style={{ color: T.ink, fontWeight: 600 }}>#{e.field_median_rank}</span>
                                </>}
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
