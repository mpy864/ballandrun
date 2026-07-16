import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import AuthBar from '../components/AuthBar.jsx'
import PageBackground from '../components/PageBackground.jsx'
import { SPORTS } from '../lib/topsRoster.js'
import { card, chip, T } from '../lib/ui.js'

// ─── Crafted line marks (no emoji) ────────────────────────────────────────────
function SportMark({ sport, size = 24 }) {
  const c = sport.accent
  if (sport.key === 'tennis') {
    // racquet: oval head + strings + straight handle down (not a magnifier)
    return (
      <svg viewBox="0 0 28 28" width={size} height={size} fill="none"
        stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12.5" cy="9.5" rx="6.2" ry="7" />
        <path d="M12.5 3 V16 M6.4 9.5 H18.6" opacity="0.4" strokeWidth="1.3" />
        <path d="M12.5 16.5 V22.5" strokeWidth="2.6" />
        <circle cx="21.5" cy="5.5" r="1.7" fill={c} stroke="none" />
      </svg>
    )
  }
  // table tennis: paddle — round head + straight handle down + ball
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} fill="none"
      stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12.5" cy="9.8" rx="7" ry="7.3" fill={`color-mix(in srgb, ${c} 14%, #fff)`} />
      <path d="M12.5 16.8 V22.5" strokeWidth="2.6" />
      <circle cx="21.5" cy="5.5" r="1.7" fill={c} stroke="none" />
    </svg>
  )
}

// ─── Motion variants ──────────────────────────────────────────────────────────
const container = { hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.04 } } }
const rise = {
  hidden: { opacity: 0, y: 16 },
  show:   { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 130, damping: 18 } },
}

// ─── Sport card ───────────────────────────────────────────────────────────────
function SportCard({ sport, onClick }) {
  return (
    <motion.button
      onClick={onClick}
      variants={rise}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 400, damping: 26 }}
      style={{
        ...card, textAlign: 'left', cursor: 'pointer', padding: '22px 24px', width: '100%',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          width: 46, height: 46, borderRadius: 13, display: 'grid', placeItems: 'center',
          background: `color-mix(in srgb, ${sport.accent} 9%, #fff)`,
        }}>
          <SportMark sport={sport} size={24} />
        </span>
        <span style={sport.live ? chip('#34c759', { fontSize: 10 }) : chip('#86868b', { fontSize: 10 })}>
          {sport.live ? '● Live' : 'Setup'}
        </span>
      </div>

      <div>
        <h2 style={{ margin: 0, fontSize: 21, fontWeight: 600, color: T.ink, letterSpacing: '-0.02em' }}>
          {sport.name}
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 13.5, color: T.slate, lineHeight: 1.45 }}>{sport.blurb}</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
        <span style={{ fontSize: 12, color: T.muted }}>{sport.federation}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: sport.accent }}>Open →</span>
      </div>
    </motion.button>
  )
}

// ─── Landing ──────────────────────────────────────────────────────────────────
export default function TopsPlatformPage() {
  const navigate = useNavigate()

  return (
    <>
      <PageBackground />
      <div style={{ position: 'relative', zIndex: 4, minHeight: '100vh' }}>
        <AuthBar />
        <motion.div
          variants={container} initial="hidden" animate="show"
          style={{ maxWidth: 'var(--tops-content)', margin: '0 auto', padding: '72px 32px 72px' }}
        >
          <style>{`
            .tops-hero { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 64px; align-items: center; }
            @media (max-width: 900px) { .tops-hero { grid-template-columns: 1fr; gap: 40px; } }
          `}</style>

          <div className="tops-hero">
            {/* Left — message */}
            <div>
              <motion.p variants={rise} style={{
                margin: 0, fontSize: 12, fontWeight: 600, color: T.muted,
                letterSpacing: '0.16em', textTransform: 'uppercase',
              }}>
                Target Olympic Podium Scheme
              </motion.p>
              <motion.h1 variants={rise} style={{
                margin: '14px 0 0', fontSize: 56, fontWeight: 600, color: T.ink,
                letterSpacing: '-0.035em', lineHeight: 1.02,
              }}>
                TOPS Intelligence<br />Platform
              </motion.h1>
              <motion.p variants={rise} style={{
                margin: '20px 0 0', fontSize: 17, color: T.slate, maxWidth: 440, lineHeight: 1.5,
              }}>
                Podium readiness, benchmarking and selection intelligence for India's athletes.
              </motion.p>
              <motion.p variants={rise} style={{
                margin: '26px 0 0', paddingTop: 18, borderTop: `1px solid ${T.divider}`,
                fontSize: 12.5, fontWeight: 500, color: T.muted, maxWidth: 440,
              }}>
                An initiative of the Sports Authority of India.
              </motion.p>
            </div>

            {/* Right — sport selector */}
            <div>
              <motion.p variants={rise} style={{
                fontSize: 11, fontWeight: 700, color: T.muted, letterSpacing: '0.1em',
                textTransform: 'uppercase', margin: '0 0 14px 2px',
              }}>
                Select a sport
              </motion.p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {SPORTS.map(s => (
                  <SportCard key={s.key} sport={s} onClick={() => navigate(`/sport/${s.key}`)} />
                ))}
              </div>
            </div>
          </div>

          {/* Mission band */}
          <motion.div variants={rise} style={{
            marginTop: 56, background: 'var(--tops-navy, #0f172a)', borderRadius: 20,
            padding: '38px 30px', textAlign: 'center',
            boxShadow: '0 20px 60px rgba(15,23,42,0.22)',
          }}>
            <h2 style={{ margin: 0, fontSize: 40, fontWeight: 700, color: '#e3b341', letterSpacing: '-0.02em', lineHeight: 1 }}>
              TOPS
            </h2>
            <p style={{ margin: '14px 0 0', fontSize: 19, fontWeight: 600, color: '#e3b341', lineHeight: 1.3 }}>
              Building the nation through sport, by winning Olympic medals.
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 14, fontWeight: 500, color: 'color-mix(in srgb, #e3b341 82%, #fff)', lineHeight: 1.4 }}>
              And building the bench strength to make it sustainable.
            </p>
          </motion.div>
        </motion.div>
      </div>
    </>
  )
}
