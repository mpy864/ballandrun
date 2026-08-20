import { useNavigate } from 'react-router-dom'
import { SPORTS } from '../lib/topsRoster.js'
import { T } from '../lib/ui.js'

// Placeholder home — to be rebuilt. Kept intentionally plain: title + entry points.
export default function HomePage() {
  const navigate = useNavigate()
  return (
    <div style={{ maxWidth: 'var(--tops-content)', margin: '0 auto', padding: '64px 40px' }}>
      <p style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.muted }}>
        Target Olympic Podium Scheme
      </p>
      <h1 style={{ margin: '10px 0 0', fontSize: 34, fontWeight: 600, letterSpacing: '-0.03em', color: T.ink }}>
        TOPS Intelligence
      </h1>
      <p style={{ margin: '8px 0 0', fontSize: 15, color: T.slate }}>
        Select a sport to view its TOPS athletes and podium readiness.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 28 }}>
        {SPORTS.map(s => (
          <button key={s.key} onClick={() => navigate(`/sport/${s.key}`)}
            style={{
              padding: '14px 20px', borderRadius: 'var(--tops-radius)', border: `1px solid ${T.border}`,
              background: 'rgba(255,255,255,0.7)', cursor: 'pointer', textAlign: 'left', minWidth: 180,
            }}>
            <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: T.ink }}>{s.name}</span>
            <span style={{ fontSize: 12, color: T.muted }}>{s.live ? 'Live rankings' : 'Rankings only'}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
