import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import AuthBar from '../components/AuthBar.jsx'
import PageBackground from '../components/PageBackground.jsx'

// ─── Constants ────────────────────────────────────────────────────────────────

const DISCIPLINES = [
  { code: 'MS', label: "Boys' Singles",  short: 'MS' },
  { code: 'WS', label: "Girls' Singles", short: 'WS' },
  { code: 'MD', label: "Boys' Doubles",  short: 'MD' },
  { code: 'WD', label: "Girls' Doubles", short: 'WD' },
  { code: 'XD', label: "Mixed Doubles",  short: 'XD' },
]

const LEVELS = ['Senior', 'U19', 'U17', 'U15', 'U13', 'U11']

const LEVEL_STYLE = {
  Senior: { color: '#92400e', bg: '#fef3c7', border: '#fcd34d', dot: '#f59e0b' },
  U19:    { color: '#14532d', bg: '#f0fdf4', border: '#86efac', dot: '#22c55e' },
  U17:    { color: '#1e3a8a', bg: '#eff6ff', border: '#93c5fd', dot: '#3b82f6' },
  U15:    { color: '#78350f', bg: '#fff7ed', border: '#fdba74', dot: '#f97316' },
  U13:    { color: '#4c1d95', bg: '#faf5ff', border: '#c4b5fd', dot: '#8b5cf6' },
  U11:    { color: '#1e293b', bg: '#f8fafc', border: '#cbd5e1', dot: '#94a3b8' },
}

const DISC_COLOR = {
  MS: '#3b82f6', WS: '#ec4899', MD: '#8b5cf6', WD: '#f59e0b', XD: '#10b981',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function RankMove({ diff }) {
  if (diff == null) return null
  const n = Number(diff)
  if (n === 0) return <span style={{ color: '#cbd5e1', fontSize: 11 }}>—</span>
  // negative = improved (rank number went down = better)
  return n < 0
    ? <span style={{ color: '#22c55e', fontSize: 11, fontWeight: 700 }}>↑{Math.abs(n)}</span>
    : <span style={{ color: '#f87171', fontSize: 11, fontWeight: 700 }}>↓{n}</span>
}

function LevelPill({ level }) {
  const s = LEVEL_STYLE[level] || LEVEL_STYLE.U11
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 99,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      letterSpacing: '0.06em', whiteSpace: 'nowrap',
    }}>{level}</span>
  )
}

function DiscPill({ code }) {
  const color = DISC_COLOR[code] || '#64748b'
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 99,
      background: `${color}15`, color, border: `1px solid ${color}30`,
      letterSpacing: '0.06em',
    }}>{code}</span>
  )
}

// ─── Player Row ───────────────────────────────────────────────────────────────

function PlayerRow({ player, rank, showDisc, onClick }) {
  const [hovered, setHovered] = useState(false)
  const displayRank = player.rank || player.current_rank
  const isTop10 = displayRank <= 10
  const isTop50 = displayRank <= 50

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 18px', cursor: 'pointer',
        background: hovered ? '#f8fafc' : 'transparent',
        transition: 'background 0.1s',
        borderBottom: '1px solid #f1f5f9',
      }}
    >
      {/* Position in group */}
      <div style={{ width: 20, textAlign: 'center', flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 600 }}>{rank}</span>
      </div>

      {/* World rank */}
      <div style={{ width: 54, flexShrink: 0 }}>
        <div style={{
          fontSize: 16, fontWeight: 800, lineHeight: 1,
          color: isTop10 ? '#0f172a' : isTop50 ? '#334155' : '#64748b',
        }}>
          #{displayRank}
        </div>
        <div style={{ marginTop: 2 }}>
          <RankMove diff={player.rank_diff} />
        </div>
      </div>

      {/* Name */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: '#0f172a',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {player.player_name}
        </div>
        {player.isDoubles && (
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>Pair</div>
        )}
        {!player.isSenior && !player.isDoubles && player.age_cat_rank && (
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>
            Age Cat #{player.age_cat_rank}
          </div>
        )}
      </div>

      {/* Badges */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
        <LevelPill level={player.level} />
        {showDisc && <DiscPill code={player.sub_event} />}
      </div>

      {/* Arrow */}
      <span style={{ color: hovered ? '#64748b' : '#e2e8f0', fontSize: 16, flexShrink: 0, transition: 'color 0.1s' }}>›</span>
    </div>
  )
}

// ─── Section (Discipline × Level group) ──────────────────────────────────────

function Section({ disc, level, players, onPlayerClick, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const s  = LEVEL_STYLE[level] || LEVEL_STYLE.U11
  const dc = DISC_COLOR[disc.code] || '#64748b'
  const top = players[0]
  const topRank = top?.rank || top?.current_rank

  if (!players.length) return null

  return (
    <div style={{
      background: '#fff', border: '1px solid #e8edf4', borderRadius: 10,
      overflow: 'hidden', marginBottom: 8,
    }}>
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '11px 18px', background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ width: 4, height: 32, borderRadius: 99, background: dc, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{disc.label}</span>
            <LevelPill level={level} />
            <span style={{
              fontSize: 10, color: '#94a3b8', background: '#f8fafc',
              padding: '1px 6px', borderRadius: 99, border: '1px solid #e2e8f0',
            }}>
              {players.length} player{players.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        {/* Top player preview when collapsed */}
        {!open && topRank && (
          <div style={{ textAlign: 'right', flexShrink: 0, marginRight: 8 }}>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>Best: </span>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>#{topRank}</span>
            <span style={{ fontSize: 11, color: '#64748b', marginLeft: 5 }}>
              {top.player_name.split(' ')[0]}
            </span>
          </div>
        )}
        <span style={{ color: '#94a3b8', fontSize: 16, flexShrink: 0 }}>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {/* Player rows */}
      {open && (
        <div style={{ borderTop: '1px solid #f1f5f9' }}>
          {players.map((p, i) => (
            <PlayerRow
              key={i} player={p} rank={i + 1}
              showDisc={false}
              onClick={() => onPlayerClick(p)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function IndiaDashboard() {
  const navigate = useNavigate()

  const [loading, setLoading]       = useState(true)
  const [seniorSingles, setSeniorSingles] = useState([])
  const [youthSingles,  setYouthSingles]  = useState([])
  const [youthDoubles,  setYouthDoubles]  = useState([])

  const [filterDisc,  setFilterDisc]  = useState('all')
  const [filterLevel, setFilterLevel] = useState('all')

  // ── Data fetch ──────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      const { data: indPlayers } = await supabase
        .from('wtt_players')
        .select('ittf_id, player_name, dob, gender')
        .eq('country_code', 'IND')

      const playerMap = Object.fromEntries((indPlayers || []).map(p => [String(p.ittf_id), p]))
      const indIds    = (indPlayers || []).map(p => p.ittf_id)

      // Senior singles
      const { data: srRaw } = await supabase
        .from('rankings_singles_normalized')
        .select('player_id, rank, gender, ranking_date, previous_rank, rank_change')
        .in('player_id', indIds)
        .order('ranking_date', { ascending: false })
        .limit(600)

      const latestSDate = srRaw?.[0]?.ranking_date
      setSeniorSingles(
        (srRaw || [])
          .filter(r => r.ranking_date === latestSDate)
          .map(r => ({
            ittf_id:     r.player_id,
            player_name: playerMap[String(r.player_id)]?.player_name || `Player ${r.player_id}`,
            rank:        r.rank,
            rank_diff:   r.rank_change,
            sub_event:   r.gender === 'M' ? 'MS' : 'WS',
            level:       'Senior',
            isDoubles:   false,
            isSenior:    true,
          }))
          .sort((a, b) => a.rank - b.rank)
      )

      // Youth singles
      const { data: ysRaw } = await supabase
        .from('youth_rankings_singles')
        .select('ittf_id, player_name, sub_event, age_category, current_rank, age_cat_rank, publish_date, rank_diff')
        .eq('country_code', 'IND')
        .in('sub_event', ['MS', 'WS'])
        .order('publish_date', { ascending: false })
        .limit(3000)

      const latestYS = {}
      for (const r of ysRaw || []) {
        const k = `${r.sub_event}_${r.age_category}`
        if (!latestYS[k]) latestYS[k] = r.publish_date
      }
      setYouthSingles(
        (ysRaw || [])
          .filter(r => r.publish_date === latestYS[`${r.sub_event}_${r.age_category}`])
          .map(r => ({ ...r, level: r.age_category, isDoubles: false, isSenior: false }))
          .sort((a, b) => (a.current_rank || 9999) - (b.current_rank || 9999))
      )

      // Youth doubles
      const { data: dblRaw } = await supabase
        .from('youth_rankings_doubles')
        .select('ittf_id1, player_name1, ittf_id2, player_name2, country_code1, country_code2, sub_event, age_category, current_rank, publish_date, rank_diff')
        .or('country_code1.eq.IND,country_code2.eq.IND')
        .order('publish_date', { ascending: false })
        .limit(500)

      const latestDbl = {}
      for (const r of dblRaw || []) {
        const k = `${r.sub_event}_${r.age_category || 'Open'}`
        if (!latestDbl[k]) latestDbl[k] = r.publish_date
      }
      setYouthDoubles(
        (dblRaw || [])
          .filter(r => r.publish_date === latestDbl[`${r.sub_event}_${r.age_category || 'Open'}`])
          .map(r => ({
            ...r,
            player_name: `${r.player_name1} / ${r.player_name2}`,
            rank:        r.current_rank,
            level:       r.age_category || 'Open',
            isDoubles:   true,
            isSenior:    false,
          }))
          .sort((a, b) => (a.current_rank || 9999) - (b.current_rank || 9999))
      )

      setLoading(false)
    }
    load()
  }, [])

  // ── Build grouped sections ───────────────────────────────────────────────────

  const sections = useMemo(() => {
    const discs = filterDisc === 'all' ? DISCIPLINES : DISCIPLINES.filter(d => d.code === filterDisc)
    const levels = filterLevel === 'all' ? LEVELS : LEVELS.filter(l => l === filterLevel)
    const result = []

    for (const disc of discs) {
      for (const level of levels) {
        let players = []
        if (disc.code === 'MS' || disc.code === 'WS') {
          if (level === 'Senior') {
            players = seniorSingles.filter(p => p.sub_event === disc.code)
          } else {
            players = youthSingles.filter(p => p.sub_event === disc.code && p.age_category === level)
          }
        } else {
          if (level === 'Senior') continue  // no senior doubles data
          players = youthDoubles.filter(p => p.sub_event === disc.code && p.level === level)
        }
        if (players.length) {
          result.push({ disc, level, players: players.slice(0, 10) })
        }
      }
    }
    return result
  }, [filterDisc, filterLevel, seniorSingles, youthSingles, youthDoubles])

  // ── Total count ─────────────────────────────────────────────────────────────

  const totalCount = useMemo(() => sections.reduce((s, g) => s + g.players.length, 0), [sections])

  // ── Navigation ───────────────────────────────────────────────────────────────

  function goToProfile(player) {
    if (player.isDoubles) {
      navigate(`/player/${player.ittf_id1}?sub=${player.sub_event}&age=${player.level}`)
    } else {
      navigate(`/player/${player.ittf_id}?sub=${player.sub_event}&age=${player.level}`)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      <PageBackground />
      <div style={{ position: 'relative', zIndex: 4, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <AuthBar />
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px 52px' }}>

          {/* ── Header ── */}
          <div style={{
            background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
            border: '1px solid rgba(15,23,42,0.08)', borderRadius: 14,
            padding: '14px 20px', marginBottom: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 24 }}>🇮🇳</span>
              <div>
                <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  TOPS · Table Tennis
                </p>
                <h1 style={{ margin: 0, fontSize: 19, fontWeight: 900, color: '#0f172a', letterSpacing: -0.4 }}>
                  India Rankings
                </h1>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              {[
                { href: '/okr',        label: 'OKR Dashboard' },
                { href: '/h2h',        label: 'H2H / Compare' },
                { href: '/live',       label: 'Live'          },
                { href: '/tournament', label: 'Tournament'    },
              ].map(l => (
                <a key={l.href} href={l.href} style={{
                  fontSize: 12, fontWeight: 600, color: '#475569',
                  textDecoration: 'none', whiteSpace: 'nowrap',
                }}>
                  {l.label}
                </a>
              ))}
            </div>
          </div>

          {/* ── Filter bar ── */}
          <div style={{
            background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
            border: '1px solid rgba(15,23,42,0.08)', borderRadius: 12,
            padding: '12px 16px', marginBottom: 16,
            display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center',
          }}>
            {/* Discipline */}
            <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 2 }}>
                Category
              </span>
              {['all', ...DISCIPLINES.map(d => d.code)].map(c => (
                <button key={c} onClick={() => setFilterDisc(c)} style={{
                  padding: '5px 11px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                  border: 'none', cursor: 'pointer',
                  background: filterDisc === c ? '#0f172a' : '#f1f5f9',
                  color:      filterDisc === c ? '#fff'    : '#475569',
                }}>
                  {c === 'all' ? 'All' : c}
                </button>
              ))}
            </div>

            <div style={{ width: 1, height: 24, background: '#e2e8f0', flexShrink: 0 }} />

            {/* Level */}
            <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 2 }}>
                Level
              </span>
              {['all', ...LEVELS].map(l => (
                <button key={l} onClick={() => setFilterLevel(l)} style={{
                  padding: '5px 11px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                  border: 'none', cursor: 'pointer',
                  background: filterLevel === l ? '#0f172a' : '#f1f5f9',
                  color:      filterLevel === l ? '#fff'    : '#475569',
                }}>
                  {l === 'all' ? 'All' : l}
                </button>
              ))}
            </div>

            {!loading && (
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                {totalCount} player{totalCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* ── Content ── */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: '80px 0', color: '#94a3b8', fontSize: 14 }}>
              Loading India rankings…
            </div>
          ) : sections.length === 0 ? (
            <div style={{
              background: 'rgba(255,255,255,0.88)', borderRadius: 12,
              padding: '60px 20px', textAlign: 'center', color: '#94a3b8', fontSize: 13,
            }}>
              No Indian players found for the selected filters.
            </div>
          ) : (
            <div>
              {sections.map(({ disc, level, players }, i) => (
                <Section
                  key={`${disc.code}_${level}`}
                  disc={disc} level={level} players={players}
                  onPlayerClick={goToProfile}
                  defaultOpen={i < 3}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
