import LiveProbability from '../components/LiveProbability.jsx'

const MEN   = ['Harmeet', 'Manav', 'Mansuh', 'Payas', 'Sathiyan']
const WOMEN = ['Diya', 'Manika', 'Sutirtha', 'Syndrela', 'yashaswini']

export default function LivePage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#07101f',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative',
      overflow: 'hidden',
    }}>

      {/* ── Player photo collage (fixed behind everything) ───────────────── */}
      <div style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gridTemplateRows: 'repeat(2, 1fr)',
        transform: 'scale(1.08)',
        transformOrigin: 'center center',
        filter: 'blur(22px) saturate(0.6)',
        opacity: 0.22,
        zIndex: 0,
        pointerEvents: 'none',
      }}>
        {[...MEN, ...WOMEN].map(name => (
          <img
            key={name}
            src={`/players/${name}.jpeg`}
            alt=""
            draggable={false}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'top center',
              display: 'block',
            }}
          />
        ))}
      </div>

      {/* ── Dark gradient overlay ────────────────────────────────────────── */}
      <div style={{
        position: 'fixed',
        inset: 0,
        background: [
          'linear-gradient(160deg,',
          '  rgba(4,10,30,0.90) 0%,',
          '  rgba(8,22,58,0.80) 50%,',
          '  rgba(4,10,30,0.92) 100%)',
        ].join(''),
        zIndex: 1,
        pointerEvents: 'none',
      }} />

      {/* ── Page content ────────────────────────────────────────────────── */}
      <div style={{
        position: 'relative',
        zIndex: 2,
        maxWidth: 900,
        margin: '0 auto',
        padding: '36px 16px 48px',
      }}>

        {/* Header */}
        <div style={{ marginBottom: 36 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 10,
          }}>
            <span style={{
              background: '#ef4444',
              color: '#fff',
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: 1.8,
              padding: '3px 9px',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}>
              <span style={{
                width: 6, height: 6,
                borderRadius: '50%',
                background: '#fff',
                display: 'inline-block',
                animation: 'live-pulse 1.4s ease-in-out infinite',
              }} />
              LIVE
            </span>
            <span style={{
              color: 'rgba(255,255,255,0.38)',
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: 2.5,
              textTransform: 'uppercase',
            }}>
              Match Probability
            </span>
          </div>

          <h1 style={{
            color: '#ffffff',
            fontSize: 24,
            fontWeight: 800,
            margin: '0 0 4px',
            letterSpacing: -0.5,
            lineHeight: 1.2,
          }}>
            World Team Table Tennis Championships
          </h1>
          <div style={{
            color: 'rgba(255,255,255,0.45)',
            fontSize: 13,
            fontWeight: 400,
            letterSpacing: 0.3,
          }}>
            London 2026 &nbsp;·&nbsp; ExCeL Centre &nbsp;·&nbsp;
            <span style={{ color: 'rgba(255,200,60,0.7)', fontWeight: 600 }}>
              🇮🇳 India
            </span>
          </div>
        </div>

        <LiveProbability />

      </div>
    </div>
  )
}
