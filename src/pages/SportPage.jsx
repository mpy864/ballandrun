import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import AuthBar from '../components/AuthBar.jsx'
import PageBackground from '../components/PageBackground.jsx'
import { getSport, CATEGORIES, DISCIPLINES, ROSTER } from '../lib/topsRoster.js'
import { makeVerdict } from '../lib/verdict.js'
import { TalentTab, EventsTab, CompareTab } from './sportTabs.jsx'

// ─── Atoms ────────────────────────────────────────────────────────────────────

function RankMove({ diff }) {
  if (diff == null || diff === 0) return null
  const n = Number(diff)
  return n < 0
    ? <span style={{ color: '#22c55e', fontSize: 10, fontWeight: 700 }}>▲{Math.abs(n)}</span>
    : <span style={{ color: '#f87171', fontSize: 10, fontWeight: 700 }}>▼{n}</span>
}

function DiscBadge({ disc }) {
  const c = disc?.color || '#64748b'
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 99,
      background: `${c}15`, color: c, border: `1px solid ${c}30`, letterSpacing: '0.05em', whiteSpace: 'nowrap',
    }}>{disc?.short || '—'}</span>
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
  if (!score) return <span style={{ fontSize: 13, fontWeight: 800, color: '#cbd5e1' }}>—</span>
  const v = Number(score.score)
  const tip = score.form_pts != null
    ? `Rank ${score.rank_pts}/40 · Trajectory ${score.traj_pts}/25 · Runway ${score.runway_pts}/15 · Form ${score.form_pts}/20`
    : `Pair rank ${score.rank_pts}/55 · Trajectory ${score.traj_pts}/25 · Runway ${score.runway_pts}/20`
  return <span title={`Readiness ${v}/100\n${tip}`} style={{ fontSize: 15, fontWeight: 900, color: '#0f172a' }}>{v}</span>
}

// ─── Athlete / pair card (verdict-first) ─────────────────────────────────────

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
          {/* verdict */}
          {v && <div style={{ fontSize: 11.5, color: '#475569', marginTop: 3, lineHeight: 1.35 }}>{v.sentence}</div>}
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
          >Watch · {watch.length}</button>
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
              <span style={{ width: 42, textAlign: 'center', fontSize: 13, fontWeight: 800, color: '#334155' }}>{w.rank ? `#${w.rank}` : '—'}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#334155' }}>{w.name}</span>
              {w.country && <span style={{ fontSize: 9, fontWeight: 700, color: '#64748b', background: '#f1f5f9', padding: '2px 6px', borderRadius: 99 }}>{w.country}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Category column ──────────────────────────────────────────────────────────

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
  const ordered = live ? [...inCat].sort((a, b) => sortValue(b, scores, pairScores) - sortValue(a, scores, pairScores)) : inCat
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
        : ordered.map((e, i) => (
            <EntryCard key={`${e.discipline}-${e.players.map(p => p.id || p.name).join('_')}-${i}`}
              entry={e} lookup={lookup} score={entryScore(e, scores, pairScores)} live={live} onOpen={onOpen} onOpenEntry={onOpenEntry} />
          ))}
    </div>
  )
}

// ─── Team-performance table ──────────────────────────────────────────────────

function TeamPerformance({ rows }) {
  if (!rows) return null
  return (
    <div style={{ background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(15,23,42,0.08)', borderRadius: 14, overflow: 'hidden', marginTop: 18 }}>
      <div style={{ padding: '13px 18px', borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ fontSize: 14, fontWeight: 900, color: '#0f172a' }}>India — results by tournament</div>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>Singles, 2026 season · newest first</div>
      </div>
      {rows.length === 0
        ? <div style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No tournament data.</div>
        : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f8fafc', color: '#64748b', textAlign: 'left' }}>
                  <th style={{ padding: '8px 18px', fontWeight: 700 }}>Tournament</th>
                  <th style={{ padding: '8px 10px', fontWeight: 700 }}>Date</th>
                  <th style={{ padding: '8px 10px', fontWeight: 700, textAlign: 'center' }}>W–L</th>
                  <th style={{ padding: '8px 18px', fontWeight: 700, width: 120 }}>Win %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const losses = Number(r.matches) - Number(r.wins)
                  const pct = Number(r.win_pct) || 0
                  return (
                    <tr key={r.event_id} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '9px 18px', color: '#0f172a', fontWeight: 600 }}>{r.event_name}</td>
                      <td style={{ padding: '9px 10px', color: '#64748b', whiteSpace: 'nowrap' }}>{r.start_date || '—'}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 700, color: '#0f172a' }}>{r.wins}–{losses}</td>
                      <td style={{ padding: '9px 18px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 7, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: pct >= 50 ? '#22c55e' : '#f59e0b' }} />
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', width: 30, textAlign: 'right' }}>{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'squad',   label: 'Squad' },
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
  const [tournaments, setTournaments] = useState(null)
  const [loading, setLoading] = useState(true)

  const entries = ROSTER[sportKey] || []

  // Pair card → pair profile; singles card → player profile
  const openEntry = (entry) => {
    const disc = DISCIPLINES[entry.discipline] || {}
    const ids = (entry.players || []).map(p => p.id).filter(Boolean)
    if (disc.kind === 'doubles' && ids.length === 2) return navigate(`/pair/${ids.join('_')}`)
    if (ids[0]) navigate(`/player/${ids[0]}`)
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
      if (sport.live && allIds.length) {
        const [{ data: players }, { data: ranks }] = await Promise.all([
          supabase.from('wtt_players').select('ittf_id, player_name, country_code').in('ittf_id', allIds),
          supabase.from('rankings_singles_normalized').select('player_id, rank, rank_change, ranking_date').in('player_id', allIds).order('ranking_date', { ascending: false }),
        ])
        const map = {}
        for (const p of players || []) map[p.ittf_id] = { id: p.ittf_id, name: p.player_name, country: p.country_code }
        for (const r of ranks || []) {
          const m = map[r.player_id] || (map[r.player_id] = { id: r.player_id })
          if (m.rank == null) { m.rank = r.rank; m.rank_change = r.rank_change }
        }
        if (!cancelled) setLookup(map)

        const doublesEntries = entries.filter(e => (DISCIPLINES[e.discipline] || {}).kind === 'doubles' && (e.players || []).filter(p => p.id).length === 2)
        const [{ data: prRows }, { data: tRows }, pairResults] = await Promise.all([
          singlesIds.length ? supabase.rpc('podium_readiness', { p_ids: singlesIds }) : Promise.resolve({ data: [] }),
          supabase.rpc('india_tournament_performance'),
          Promise.all(doublesEntries.map(e => {
            const [a, b] = e.players.map(p => p.id)
            return supabase.rpc('podium_readiness_pair', { p_id1: a, p_id2: b }).then(r => ({ key: pairKey(e.players), row: r.data?.[0] || null }))
          })),
        ])
        const scoreMap = {}; for (const r of prRows || []) scoreMap[r.player_id] = r
        const pairMap = {}; for (const x of pairResults) if (x.row) pairMap[x.key] = x.row
        if (!cancelled) { setScores(scoreMap); setPairScores(pairMap); setTournaments(tRows || []) }
      } else if (!cancelled) {
        setLookup({}); setScores({}); setPairScores({}); setTournaments(null)
      }
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
      <PageBackground />
      <div style={{ position: 'relative', zIndex: 4, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <AuthBar />
        <div style={{ maxWidth: 1140, margin: '0 auto', padding: '22px 16px 56px' }}>

          {/* Header + menu */}
          <div style={{ background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(15,23,42,0.08)', borderRadius: 14, padding: '12px 18px', marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <span style={{ fontSize: 26 }}>{sport.icon}</span>
              <div style={{ flex: 1 }}>
                <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  ← TOPS Intelligence
                </button>
                <h1 style={{ margin: 0, fontSize: 19, fontWeight: 900, color: '#0f172a' }}>{sport.name}</h1>
              </div>
              <button onClick={() => navigate('/okr')} style={{ fontSize: 12, fontWeight: 600, color: '#475569', background: 'none', border: 'none', cursor: 'pointer' }}>OKR</button>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {TABS.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)} style={{
                  padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer',
                  background: tab === t.key ? '#0f172a' : '#f1f5f9', color: tab === t.key ? '#fff' : '#64748b',
                }}>{t.label}</button>
              ))}
            </div>
          </div>

          {/* Non-live sport */}
          {!sport.live && (
            <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 12, padding: '12px 16px', marginBottom: 16, fontSize: 12, color: '#b45309' }}>
              Live ranking adapter pending. Showing static roster.
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: 'center', padding: '80px 0', color: '#94a3b8', fontSize: 14 }}>Loading {sport.name}…</div>
          ) : tab === 'squad' ? (
            <>
              {sport.live && (
                <p style={{ margin: '0 0 12px 2px', fontSize: 11, color: '#94a3b8' }}>
                  Each athlete is scored 0–100 for medal readiness. Colour and tag show status; the line explains why. Hover the number for the breakdown.
                </p>
              )}
              <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start' }}>
                {CATEGORIES.map(cat => (
                  <CategoryColumn key={cat.key} cat={cat} entries={entries} lookup={lookup} scores={scores} pairScores={pairScores} live={sport.live} onOpen={id => navigate(`/player/${id}`)} onOpenEntry={openEntry} />
                ))}
              </div>
              {sport.live && <TeamPerformance rows={tournaments} />}
            </>
          ) : tab === 'talent' ? (
            <TalentTab onOpen={id => navigate(`/player/${id}`)} navigate={navigate} />
          ) : tab === 'events' ? (
            <EventsTab onOpen={id => navigate(`/player/${id}`)} navigate={navigate} />
          ) : (
            <CompareTab navigate={navigate} />
          )}
        </div>
      </div>
    </>
  )
}
