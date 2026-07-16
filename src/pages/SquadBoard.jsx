import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ROSTER, DISCIPLINES } from '../lib/topsRoster.js'
import { makeVerdict } from '../lib/verdict.js'
import { okrLink } from '../lib/okrLink.js'
import { rosterPairKey } from '../lib/squadReadiness.js'
import { MANUAL_NOTE } from '../lib/watchlist.js'
import { computeRetentionRisk } from '../lib/retention.js'
import { card, chip, T } from '../lib/ui.js'

const TIER_TONE = { Core: '#b45309', Development: '#166534', TAGG: '#3730a3' }

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtDate = d => { if (!d) return ''; const [, m, day] = String(d).split('-').map(Number); return `${day} ${MON[(m || 1) - 1]}` }
const daysTo = d => Math.round((new Date(d) - new Date()) / 86400000)

// The Squad dashboard for one sport: KPIs, readiness board, upcoming events,
// India movers, and the watchlist. Typography-only, no icons.
export default function SquadBoard({ sport, entries, lookup, scores, pairScores, watch = [], movers = [], loading }) {
  const navigate = useNavigate()

  const retention = useMemo(
    () => computeRetentionRisk({ entries, scores, pairScores, lookup }),
    [entries, scores, pairScores, lookup])

  const { board, kpis, events } = useMemo(() => {
    const rows = []
    for (const e of entries || []) {
      if (e.youth) continue
      const disc = DISCIPLINES[e.discipline] || {}
      let sc, name, rank, ids
      if (disc.kind === 'doubles') {
        sc = pairScores[rosterPairKey(e.players)]
        name = e.players.map(p => lookup[p.id]?.name || p.name).join(' / ')
        rank = sc?.pair_rank; ids = e.players.map(p => p.id)
      } else {
        const pid = e.players[0]?.id
        sc = scores[pid]; name = lookup[pid]?.name || e.players[0]?.name
        rank = sc?.world_rank; ids = [pid]
      }
      if (!sc) continue
      rows.push({
        name, short: disc.short, dcolor: disc.color, kind: disc.kind, rank,
        score: sc.score, verdict: makeVerdict({ kind: disc.kind, score: sc }), ids, next: sc.next,
      })
    }
    rows.sort((a, b) => b.score - a.score)

    const kpis = {
      ready: rows.length,
      contenders: rows.filter(r => r.verdict?.tag === 'Contender').length,
      rising: rows.filter(r => r.verdict?.tag === 'Rising').length,
      avg: rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : 0,
    }

    const today = new Date().toISOString().slice(0, 10)
    const evMap = {}
    for (const r of rows) {
      if (!r.next || r.next.date < today) continue
      const k = `${r.next.name}__${r.next.date}`
      if (!evMap[k]) evMap[k] = { name: r.next.name, date: r.next.date, count: 0 }
      evMap[k].count++
    }
    const events = Object.values(evMap).sort((a, b) => a.date.localeCompare(b.date))
    kpis.next = events[0] || null

    return { board: rows, kpis, events: events.slice(0, 6) }
  }, [entries, lookup, scores, pairScores])

  const open = (r) => navigate(r.kind === 'doubles' && r.ids.length === 2
    ? okrLink({ level: 'Senior', kind: 'doubles', ids: r.ids })
    : okrLink({ level: 'Senior', kind: 'singles', id: r.ids[0] }))

  const Kpi = ({ label, value, sub }) => (
    <div style={{ flex: 1, padding: '4px 20px' }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.muted }}>{label}</div>
      <div className="tabnum" style={{ fontSize: 30, fontWeight: 700, color: T.ink, letterSpacing: '-0.02em', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: T.muted, marginTop: 1 }}>{sub}</div>}
    </div>
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
      {/* KPI band */}
      <div style={{ ...card, display: 'flex', alignItems: 'stretch', padding: '16px 4px', borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` }}>
        <Kpi label="Podium-ready" value={kpis?.ready ?? '—'} sub="athletes scored" />
        <div style={{ width: 1, background: T.divider }} />
        <Kpi label="Contenders" value={kpis?.contenders ?? '—'} sub="medal-level" />
        <div style={{ width: 1, background: T.divider }} />
        <Kpi label="Rising" value={kpis?.rising ?? '—'} sub="on the up" />
        <div style={{ width: 1, background: T.divider }} />
        <Kpi label="Avg readiness" value={kpis?.avg ?? '—'} sub="across squad" />
        <div style={{ width: 1, background: T.divider }} />
        <Kpi label="Next event" value={kpis?.next ? `${daysTo(kpis.next.date)}d` : '—'} sub={kpis?.next ? kpis.next.name.replace(/\s+20\d\d$/, '') : '—'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(0, 1fr)', gap: 20, marginTop: 20, alignItems: 'start' }}>
        {/* Readiness board */}
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '15px 22px', borderBottom: `1px solid ${T.divider}`, fontSize: 14, fontWeight: 600, color: T.ink }}>Readiness board</div>
          {loading ? <div style={{ padding: 28, color: T.muted, fontSize: 14 }}>Computing readiness…</div>
            : board.length === 0 ? <div style={{ padding: 28, color: T.muted, fontSize: 14 }}>No scored athletes.</div>
            : board.map((r, i) => (
              <button key={i} onClick={() => open(r)}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.022)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                style={{
                  display: 'grid', gridTemplateColumns: '22px 210px 1fr auto 34px', alignItems: 'center', gap: 14,
                  width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer',
                  padding: '12px 22px', borderTop: i ? `1px solid ${T.divider}` : 'none',
                }}>
                <span className="tabnum" style={{ fontSize: 12.5, fontWeight: 600, color: T.muted, textAlign: 'center' }}>{i + 1}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                  <span style={{ fontSize: 11.5, color: T.muted }}>
                    <span style={{ color: r.dcolor, fontWeight: 600 }}>{r.short}</span>{r.rank ? ` · #${r.rank}` : ''}
                  </span>
                </span>
                <span style={{ height: 5, background: 'rgba(0,0,0,0.07)', overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${r.score}%`, background: r.verdict?.dot || T.muted }} />
                </span>
                <span style={chip(r.verdict?.dot || '#86868b', { fontSize: 10 })}>{r.verdict?.tag}</span>
                <span className="tabnum" style={{ fontSize: 19, fontWeight: 700, color: T.ink, textAlign: 'right' }}>{r.score}</span>
              </button>
            ))}
        </div>

        {/* right rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ ...card, overflow: 'hidden' }}>
            {sectionHead('Upcoming events')}
            {loading ? <div style={{ padding: 20, color: T.muted, fontSize: 13 }}>…</div>
              : events.length === 0 ? <div style={{ padding: 20, color: T.muted, fontSize: 13 }}>No upcoming entries.</div>
              : events.map((e, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 20px', borderTop: i ? `1px solid ${T.divider}` : 'none' }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 550, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name.replace(/\s+20\d\d$/, '')}</span>
                    <span style={{ fontSize: 12, color: T.muted }}>{e.count} entered</span>
                  </span>
                  <span className="tabnum" style={{ fontSize: 12.5, fontWeight: 600, color: T.slate, whiteSpace: 'nowrap' }}>{fmtDate(e.date)}</span>
                </div>
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
