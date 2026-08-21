import { motion, useReducedMotion } from 'framer-motion'
import { T } from '../lib/ui.js'

// Home says what the platform is for. It does not navigate.
//
// It used to carry a title and two sport buttons, and every one of them was already on
// the same screen: the buttons went to /sport/tt and /sport/tennis, which is exactly the
// sidebar's SPORTS section, and the heading repeated the sidebar brand at top-left. A
// second copy of the sidebar, plus a gap.
//
// With that gone the statements have the page, and the question that would otherwise sit
// in this design — a manifesto a daily user must scroll past — does not arise. There is
// nothing to scroll past.

// The app's own motion language: AppShell animates every route change with an 8px rise
// over 220ms on this curve. Reusing it exactly is what makes this block feel like part of
// the page rather than something that arrived from a different design.
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
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      maxWidth: 'var(--tops-content)', margin: '0 auto', padding: '64px 40px 40px',
    }}>

      {/* ── Mission ── centred in the space above the vision, so the emptiness reads as
          composition rather than as a gap. */}
      <motion.section {...anim}
        style={{ flex: 1, display: 'flex', flexDirection: 'column',
                 justifyContent: 'center', maxWidth: 640 }}>
        <GoldRule variants={vWipe} />
        {/* One sentence over two lines: same size so they read as a couplet, weight and
            colour carrying the hierarchy instead of a size step. */}
        <motion.p variants={v} style={{
          margin: '18px 0 0', fontSize: 36, fontWeight: 600,
          letterSpacing: '-0.025em', lineHeight: 1.18, color: T.ink,
        }}>
          Measure what Matters
        </motion.p>
        <motion.p variants={v} style={{
          margin: 0, fontSize: 36, fontWeight: 400,
          letterSpacing: '-0.025em', lineHeight: 1.18, color: T.slate,
        }}>
          Performed by Elite Humans
        </motion.p>
      </motion.section>

      {/* ── Vision ── on the bottom edge of a tall screen, after the content on a short
          one. Gold appears here as the wordmark rather than as a second rule: the same
          colour twice, never the same device, is what makes the two blocks a pair. */}
      <motion.section
        {...(still
          ? { initial: false }
          : { variants: group, initial: 'hidden', whileInView: 'show',
              viewport: { once: true, amount: 0.6 } })}
        style={{ marginTop: 72, paddingTop: 28, maxWidth: 560,
                 borderTop: `1px solid ${T.divider}` }}>
        <motion.p variants={v} style={{
          margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--tops-gold)',
        }}>
          TOPS
        </motion.p>
        <motion.p variants={v} style={{
          margin: '12px 0 0', fontSize: 17, fontWeight: 500, lineHeight: 1.45, color: T.ink,
        }}>
          Building the nation by winning Olympic medals.
        </motion.p>
        <motion.p variants={v} style={{
          margin: '4px 0 0', fontSize: 15, fontWeight: 400, lineHeight: 1.45, color: T.slate,
        }}>
          Sustained by building bench strength.
        </motion.p>
      </motion.section>
    </div>
  )
}
