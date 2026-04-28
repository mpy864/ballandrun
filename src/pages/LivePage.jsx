import LiveProbability from '../components/LiveProbability.jsx'

const MEN   = ['Harmeet', 'Manav', 'Mansuh', 'Payas', 'Sathiyan']
const WOMEN = ['Diya', 'Manika', 'Sutirtha', 'Syndrela', 'yashaswini']

export default function LivePage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#c8daf5',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative',
      overflow: 'hidden',
    }}>

      {/* ── Player photo collage (fixed, behind everything) ──────────────── */}
      <div style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gridTemplateRows: 'repeat(2, 1fr)',
        transform: 'scale(1.06)',
        transformOrigin: 'center center',
        filter: 'blur(6px) saturate(0.80)',
        opacity: 0.65,
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

      {/* ── SAI logo watermark (large, centred, very subtle) ─────────────── */}
      <div style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1,
        pointerEvents: 'none',
      }}>
        <img
          src="/players/SAI logo.png"
          alt=""
          draggable={false}
          style={{
            width: 340,
            opacity: 0.07,
            filter: 'blur(1px)',
            objectFit: 'contain',
          }}
        />
      </div>

      {/* ── Light blue wash overlay ───────────────────────────────────────── */}
      <div style={{
        position: 'fixed',
        inset: 0,
        background: 'linear-gradient(160deg, rgba(190,215,248,0.42) 0%, rgba(210,228,252,0.35) 50%, rgba(190,215,248,0.42) 100%)',
        zIndex: 2,
        pointerEvents: 'none',
      }} />

      {/* ── SAI attribution — top right corner (fixed) ───────────────────── */}
      <div style={{
        position: 'fixed',
        top: 22,
        right: 28,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        pointerEvents: 'none',
      }}>
        <span style={{
          fontSize: 9,
          fontWeight: 600,
          color: 'rgba(15,42,94,0.55)',
          letterSpacing: 1.5,
          textTransform: 'uppercase',
        }}>
          Built by
        </span>
        <img
          src="/players/SAI logo.png"
          alt="SAI"
          style={{
            height: 44,
            objectFit: 'contain',
            filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.12))',
          }}
        />
        <span style={{
          fontSize: 9,
          fontWeight: 600,
          color: 'rgba(15,42,94,0.55)',
          letterSpacing: 1.5,
          textTransform: 'uppercase',
        }}>
          with passion
        </span>
      </div>

      {/* ── Page content ─────────────────────────────────────────────────── */}
      <div style={{
        position: 'relative',
        zIndex: 3,
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
              color: 'rgba(15,42,94,0.55)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 2.5,
              textTransform: 'uppercase',
            }}>
              Match Probability
            </span>
          </div>

          <h1 style={{
            color: '#0f2a5e',
            fontSize: 24,
            fontWeight: 800,
            margin: '0 0 5px',
            letterSpacing: -0.5,
            lineHeight: 1.2,
            textShadow: '0 1px 8px rgba(255,255,255,0.6)',
          }}>
            World Team Table Tennis Championships
          </h1>
          <div style={{
            color: 'rgba(15,42,94,0.62)',
            fontSize: 13,
            fontWeight: 500,
            letterSpacing: 0.3,
          }}>
            London 2026 &nbsp;·&nbsp; OVO Arena Wembley &nbsp;·&nbsp;
            <span style={{ color: '#1a3a8f', fontWeight: 700 }}>
              🇮🇳 India
            </span>
          </div>
        </div>

        <LiveProbability />

      </div>
    </div>
  )
}
