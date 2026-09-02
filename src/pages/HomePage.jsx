import { motion, useReducedMotion } from 'framer-motion'
import { T } from '../lib/ui.js'
import { Rings, SchemeName, GoldRule, Vision, Mission, Capabilities,
         group, rise, wipe } from '../components/brand.jsx'

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
//
// The pieces themselves now live in components/brand.jsx, because the login page shows
// the same statement and two copies of the ring geometry would drift apart.

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
    // tops-fill subtracts the small-screen top bar, so the vision lands on the bottom
    // edge of the window on both layouts rather than 57px below it on a phone.
    <div className="tops-fill" style={{
      position: 'relative',
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      gap: 'clamp(40px, 5vh, 72px)',
      maxWidth: 'var(--tops-content)', margin: '0 auto',
      padding: '64px var(--tops-gutter) 72px',
    }}>
      <Rings animate={!still} />

      {/* ── Vision ── the masthead. The sentence carries the size, not the name: the
          sidebar already says TOPS twice, as the brand and as a nav item. */}
      <motion.section {...anim} style={{ position: 'relative', zIndex: 1 }}>
        <SchemeName variants={v} />
        <Vision variants={v} />
      </motion.section>

      {/* ── What's inside ── the same eight lines the login page shows.
          Login has to answer "why would I sign in"; Home answers "what am I looking at"
          for the person who just did. Nothing about the answer changes between them, so
          neither does the component. */}
      <Capabilities variants={v} />

      {/* ── Mission ── the closing credo. It sits clear of the bottom edge rather than
          against it: a statement pressed into the last few pixels of the window reads as
          overflow, not as a close. */}
      <motion.section
        {...(still
          ? { initial: false }
          : { variants: group, initial: 'hidden', whileInView: 'show',
              viewport: { once: true, amount: 0.6 } })}
        style={{
          position: 'relative', zIndex: 1, paddingTop: 34,
          borderTop: `1px solid ${T.divider}`, maxWidth: 720,
        }}>
        <GoldRule variants={vWipe} />
        <Mission variants={v} />
      </motion.section>
    </div>
  )
}
