import { useNavigate } from 'react-router-dom'
import AuthBar from '../components/AuthBar.jsx'
import PageBackground from '../components/PageBackground.jsx'
import { SPORTS } from '../lib/topsRoster.js'

// ─── Sport card ───────────────────────────────────────────────────────────────

function SportCard({ sport, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        position: 'relative', textAlign: 'left', cursor: 'pointer',
        background: 'rgba(255,255,255,0.92)',
        border: '1px solid rgba(15,23,42,0.08)', borderRadius: 16,
        padding: '22px 22px 20px', width: '100%',
        boxShadow: '0 1px 3px rgba(15,23,42,0.06)',
        transition: 'transform 0.12s, box-shadow 0.12s',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 10px 26px rgba(15,23,42,0.12)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(15,23,42,0.06)' }}
    >
      {/* accent stripe */}
      <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: sport.accent, borderRadius: '16px 16px 0 0' }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 40, lineHeight: 1 }}>{sport.icon}</span>
        <span style={{
          fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
          padding: '3px 9px', borderRadius: 99,
          background: sport.live ? '#dcfce7' : '#f1f5f9',
          color:      sport.live ? '#15803d' : '#94a3b8',
          border: `1px solid ${sport.live ? '#86efac' : '#e2e8f0'}`,
        }}>
          {sport.live ? '● Live data' : 'Setup'}
        </span>
      </div>

      <div>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: '#0f172a', letterSpacing: -0.4 }}>
          {sport.name}
        </h2>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: '#64748b' }}>{sport.blurb}</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>{sport.federation}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: sport.accent }}>Open →</span>
      </div>
    </button>
  )
}

// ─── Landing page ─────────────────────────────────────────────────────────────

export default function TopsPlatformPage() {
  const navigate = useNavigate()

  return (
    <>
      <PageBackground />
      <div style={{ position: 'relative', zIndex: 4, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <AuthBar />
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '40px 16px 60px' }}>

          {/* Hero */}
          <div style={{ textAlign: 'center', marginBottom: 34 }}>
            <p style={{
              margin: 0, fontSize: 11, fontWeight: 800, color: '#64748b',
              letterSpacing: '0.18em', textTransform: 'uppercase',
            }}>
              Target Olympic Podium Scheme
            </p>
            <h1 style={{
              margin: '8px 0 0', fontSize: 40, fontWeight: 900, color: '#0f172a',
              letterSpacing: -1.4, lineHeight: 1.05,
            }}>
              TOPS Intelligence Platform
            </h1>
            <p style={{ margin: '12px auto 0', fontSize: 14, color: '#475569', maxWidth: 520 }}>
              Athlete tracking, benchmarking and selection intelligence for Core, Development and TAGG athletes.
            </p>
          </div>

          {/* Sport selector */}
          <p style={{
            fontSize: 11, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.1em',
            textTransform: 'uppercase', margin: '0 0 12px 4px',
          }}>
            Select a sport
          </p>
          <div style={{
            display: 'grid', gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          }}>
            {SPORTS.map(s => (
              <SportCard key={s.key} sport={s} onClick={() => navigate(`/sport/${s.key}`)} />
            ))}
          </div>

          {/* Mission statement — replaces the "more sports" note */}
          <div style={{ textAlign: 'left', marginTop: 40 }}>
            <h2 style={{ margin: 0, fontSize: 36, fontWeight: 900, color: '#0a0a0a', letterSpacing: -1, lineHeight: 1 }}>
              TOPS
            </h2>
            <p style={{ margin: '8px 0 0', fontSize: 18, fontWeight: 800, color: '#0a0a0a', lineHeight: 1.2 }}>
              Building nation via sports by winning medals at Olympics.
            </p>
            <p style={{ margin: '5px 0 0', fontSize: 14, fontWeight: 600, color: '#0a0a0a', lineHeight: 1.3 }}>
              Building bench-strength to make it sustainable.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
