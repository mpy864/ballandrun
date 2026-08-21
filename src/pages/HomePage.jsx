import { motion, useReducedMotion } from 'framer-motion'
import { T } from '../lib/ui.js'

// Home says what the platform is for. It does not navigate.
//
// It used to carry a title and two sport buttons, and every one of them was already on
// the same screen: the buttons went to /sport/tt and /sport/tennis, which is exactly the
// sidebar's SPORTS section, and the heading repeated the sidebar brand at top-left. A
// second copy of the sidebar, plus a gap.
//
// What is here instead reads top to bottom as one argument: the goal, then the standard
// it is held to. The vision leads because it is the institutional statement — what TOPS
// is for. The mission closes because it is the working credo — how the platform behaves
// in service of it. Air and one hairline separate them; nothing boxes them in.

// The app's own motion language: AppShell animates every route change with an 8px rise
// over 220ms on this curve. Reusing it exactly is what makes this page feel like part of
// the app rather than something that arrived from a different design.
const EASE = [0.22, 0.61, 0.36, 1]

// delayChildren waits out the route transition. Starting during it reads as a stutter.
const group = { hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.18 } } }
const rise = {
  hidden: { opacity: 0, y: 8 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
}
const wipe = {
  hidden: { scaleX: 0 },
  show:   { scaleX: 1, transition: { duration: 0.42, ease: EASE } },
}

// ─── Background ──────────────────────────────────────────────────────────────

// Five rings, drawn rather than loaded: an SVG stays sharp at any size, costs no request
// and takes its colour from the page instead of baking one in.
//
// Deliberately monochrome and near-invisible. The Olympic rings are a protected mark, so
// this is a watermark at 4.5% — the shape as texture, not the emblem as branding, and
// none of the six official colours. It bleeds off the right edge for the same reason a
// masthead crops its motif: cropped, it reads as material; whole, it reads as clip art.
//
// Standard ring geometry — three above, two below, offset by one radius and overlapping.
// At this opacity, true interlocking would be invisible, so plain circles are honest
// about what they are.
const R = 62, GAP = 12, STEP = R * 2 + GAP, DROP = R * 1.06, PAD = 6
const RINGS = [
  [0, 0], [STEP, 0], [STEP * 2, 0],
  [STEP / 2, DROP], [STEP * 1.5, DROP],
]
// Derived, not eyeballed: a viewBox guessed at leaves the group off-centre inside its own
// box, and translateY(-50%) then centres the box rather than the rings.
const VB = `${-(R + PAD)} ${-(R + PAD)} ${STEP * 2 + 2 * (R + PAD)} ${DROP + 2 * R + 2 * PAD}`

function Rings({ animate }) {
  return (
    // Its own clipping layer, so bleeding off the right can never give the page a
    // sideways scrollbar.
    <div aria-hidden="true" style={{
      position: 'absolute', inset: 0, overflow: 'hidden',
      pointerEvents: 'none', zIndex: 0,
    }}>
      <motion.svg
        viewBox={VB}
        style={{
          position: 'absolute', right: '-9%', top: '50%',
          width: 'min(860px, 78%)', transform: 'translateY(-50%)',
          color: T.ink,
        }}
        initial={animate ? { opacity: 0, scale: 0.985 } : false}
        animate={animate ? { opacity: 0.045, scale: 1 } : { opacity: 0.045 }}
        transition={{ duration: 1.2, ease: EASE, delay: 0.25 }}
      >
        {RINGS.map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r={R}
            fill="none" stroke="currentColor" strokeWidth={7} />
        ))}
      </motion.svg>
    </div>
  )
}

// 40 × 2px, drawn from the left. --tops-gold has sat in index.css commented
// "mission accent" and unused; this is what it was reserved for.
function GoldRule({ variants }) {
  return (
    <motion.div variants={variants} aria-hidden="true"
      style={{ width: 40, height: 2, transformOrigin: 'left center',
               background: 'var(--tops-gold)' }} />
  )
}

export default function HomePage() {
  // Nothing else in src/ respects this yet. It should, but that is a wider change than
  // this page.
  const still = useReducedMotion()
  const anim = still
    ? { initial: false }                       // render final state, animate nothing
    : { variants: group, initial: 'hidden', animate: 'show' }
  const v = still ? undefined : rise
  const vWipe = still ? undefined : wipe

  return (
    <div style={{
      position: 'relative', minHeight: '100vh',
      display: 'flex', flexDirection: 'column',
      maxWidth: 'var(--tops-content)', margin: '0 auto', padding: '72px 40px 44px',
    }}>
      <Rings animate={!still} />

      {/* ── Vision ── the masthead. The sentence carries the size, not the wordmark:
          "TOPS" is already the brand at top-left of the sidebar, so setting it huge here
          would be the third time the same word introduces the same page. */}
      <motion.section {...anim} style={{ position: 'relative', zIndex: 1, maxWidth: 620 }}>
        <motion.p variants={v} style={{
          margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: '0.18em',
          textTransform: 'uppercase', color: 'var(--tops-gold)',
        }}>
          TOPS
        </motion.p>
        <motion.h1 variants={v} style={{
          margin: '18px 0 0', fontSize: 'clamp(30px, 4.4vw, 46px)', fontWeight: 600,
          letterSpacing: '-0.032em', lineHeight: 1.1, color: T.ink,
        }}>
          Building the nation by winning Olympic medals.
        </motion.h1>
        {/* Two sentences, two weights: the goal, then the thing that keeps it repeatable.
            The second is the whole reason a youth pipeline exists in this product. */}
        <motion.p variants={v} style={{
          margin: '20px 0 0', fontSize: 18.5, fontWeight: 400,
          lineHeight: 1.45, color: T.slate, maxWidth: 480,
        }}>
          Sustained by building bench strength.
        </motion.p>
      </motion.section>

      {/* ── Mission ── the closing credo, on the bottom edge of a tall screen and after
          the content on a short one. Gold appears twice on this page and never the same
          way — the wordmark above, a drawn rule here — which is what makes the two blocks
          read as a pair without repeating a device. */}
      <motion.section
        {...(still
          ? { initial: false }
          : { variants: group, initial: 'hidden', whileInView: 'show',
              viewport: { once: true, amount: 0.6 } })}
        style={{
          position: 'relative', zIndex: 1, marginTop: 'auto', paddingTop: 30,
          borderTop: `1px solid ${T.divider}`, maxWidth: 640,
        }}>
        <GoldRule variants={vWipe} />
        {/* One sentence over two lines: same size so they read as a couplet, weight and
            colour carrying the hierarchy instead of a size step. */}
        <motion.p variants={v} style={{
          margin: '20px 0 0', fontSize: 'clamp(24px, 3vw, 32px)', fontWeight: 600,
          letterSpacing: '-0.025em', lineHeight: 1.18, color: T.ink,
        }}>
          Measure what Matters
        </motion.p>
        <motion.p variants={v} style={{
          margin: 0, fontSize: 'clamp(24px, 3vw, 32px)', fontWeight: 400,
          letterSpacing: '-0.025em', lineHeight: 1.18, color: T.slate,
        }}>
          Performed by Elite Humans
        </motion.p>
      </motion.section>
    </div>
  )
}
