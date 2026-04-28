import LiveProbability from '../components/LiveProbability.jsx'

export default function LivePage() {
  return (
    <div style={{
      minHeight: '100vh',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative',
      zIndex: 4,
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '36px 16px 48px' }}>

        {/* Header */}
        <div style={{ marginBottom: 36 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{
              background: '#ef4444', color: '#fff',
              fontSize: 10, fontWeight: 800, letterSpacing: 1.8,
              padding: '3px 9px', borderRadius: 4,
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', background: '#fff',
                display: 'inline-block', animation: 'live-pulse 1.4s ease-in-out infinite',
              }} />
              LIVE
            </span>
            <span style={{
              color: 'rgba(15,42,94,0.55)', fontSize: 11, fontWeight: 600,
              letterSpacing: 2.5, textTransform: 'uppercase',
            }}>
              Match Probability
            </span>
          </div>

          <h1 style={{
            color: '#0f2a5e', fontSize: 24, fontWeight: 800,
            margin: '0 0 5px', letterSpacing: -0.5, lineHeight: 1.2,
            textShadow: '0 1px 8px rgba(255,255,255,0.6)',
          }}>
            World Team Table Tennis Championships
          </h1>
          <div style={{ color: 'rgba(15,42,94,0.62)', fontSize: 13, fontWeight: 500 }}>
            London 2026 &nbsp;·&nbsp; OVO Arena Wembley
          </div>
        </div>

        <LiveProbability />

      </div>
    </div>
  )
}
