import { motion } from 'framer-motion'
import { T } from '../lib/ui.js'

// ─── The scheme's identity, in one place ─────────────────────────────────────
//
// These pieces were written for the home page and now have to appear on the login page
// too — which is the first screen anyone ever sees, and until now said only "Sign in".
// Copying them would have left two sets of ring geometry and two tricolours to keep in
// step, so they live here and both pages import them.
//
// Nothing here navigates or fetches. It is the statement of what TOPS is for, and it is
// the same statement whether or not you are signed in.

// The app's own motion language: AppShell animates every route change with an 8px rise
// over 220ms on this curve. Reusing it exactly is what makes a page feel like part of the
// app rather than something that arrived from a different design.
export const EASE = [0.22, 0.61, 0.36, 1]

// delayChildren waits out the route transition. Starting during it reads as a stutter.
export const group = { hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.18 } } }
export const rise = {
  hidden: { opacity: 0, y: 8 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
}
export const wipe = {
  hidden: { scaleX: 0 },
  show:   { scaleX: 1, transition: { duration: 0.42, ease: EASE } },
}

// ─── Background rings ────────────────────────────────────────────────────────
//
// Five rings, drawn rather than loaded: an SVG stays sharp at any size, costs no request
// and takes its colour from the page instead of baking one in.
//
// Deliberately monochrome and near-invisible. The Olympic rings are a protected mark, so
// this is a watermark at 4.5% — the shape as texture, not the emblem as branding, and
// none of the six official colours. It bleeds off the right edge for the same reason a
// masthead crops its motif: cropped, it reads as material; whole, it reads as clip art.
const R = 62, GAP = 12, STEP = R * 2 + GAP, DROP = R * 1.06, PAD = 6
const RINGS = [
  [0, 0], [STEP, 0], [STEP * 2, 0],
  [STEP / 2, DROP], [STEP * 1.5, DROP],
]
// Derived, not eyeballed: a viewBox guessed at leaves the group off-centre inside its own
// box, and translateY(-50%) then centres the box rather than the rings.
const VB = `${-(R + PAD)} ${-(R + PAD)} ${STEP * 2 + 2 * (R + PAD)} ${DROP + 2 * R + 2 * PAD}`

export function Rings({ animate = true, opacity = 0.045 }) {
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
        animate={animate ? { opacity, scale: 1 } : { opacity }}
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

// ─── The scheme's name, in the flag ──────────────────────────────────────────
//
// The middle band of the tricolour is white, which is invisible on a #fbfbfd page, so it
// is carried by the navy of the Ashoka Chakra — the usual way the flag is set on a light
// ground. Four words, three bands: the first takes saffron, the last takes green, and the
// two in the middle hold the navy, so the name reads as bookended rather than striped.
//
// These are the flag's hues deepened, not the flag's exact values, and the reason is
// measured rather than felt: against this background #FF9933 lands at 2.06:1 and #138808
// at 4.46:1, both short of the 4.5:1 that 12px bold type needs. The flag's colours are
// specified for a flag flying against the sky, not for small text on near-white. Deepened
// they reach 4.68 and 5.34 and still read unmistakably as saffron and green.
const FLAG = { saffron: '#B35900', navy: '#000080', green: '#0F7A06' }
const SCHEME = [
  ['Target',  FLAG.saffron],
  ['Olympic', FLAG.navy],
  ['Podium',  FLAG.navy],
  ['Scheme',  FLAG.green],
]

export function SchemeName({ variants }) {
  return (
    <motion.p variants={variants} style={{
      margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: '0.18em',
      textTransform: 'uppercase',
      // A word gap wide enough that four short words read as one institutional mark
      // rather than four coloured labels.
      display: 'flex', flexWrap: 'wrap', gap: '0 8px',
    }}>
      {SCHEME.map(([word, colour]) => (
        <span key={word} style={{ color: colour }}>{word}</span>
      ))}
    </motion.p>
  )
}

// 40 × 2px, drawn from the left. --tops-gold sat in index.css commented "mission accent"
// and unused; this is what it was reserved for.
export function GoldRule({ variants }) {
  return (
    <motion.div variants={variants} aria-hidden="true"
      style={{ width: 40, height: 2, transformOrigin: 'left center',
               background: 'var(--tops-gold)' }} />
  )
}

// ─── Vision ──────────────────────────────────────────────────────────────────
//
// The sentence carries the size, not the name. `scale` lets the login page set it a step
// smaller, where it shares the screen with a form rather than owning the page.
export function Vision({ variants, scale = 1 }) {
  return (
    <>
      {/* One line on a normal display. Not forced with nowrap — that would push the
          sentence off the right edge on a laptop instead of wrapping. The size is tied to
          the viewport so it fits, and text-wrap: balance evens the break on the narrow
          screens where it must happen anyway. */}
      <motion.h1 variants={variants} style={{
        margin: '18px 0 0',
        fontSize: `clamp(${22 * scale}px, ${3.1 * scale}vw, ${42 * scale}px)`,
        fontWeight: 600, letterSpacing: '-0.032em', lineHeight: 1.1, color: T.ink,
        textWrap: 'balance',
      }}>
        Building the nation by winning Olympic medals.
      </motion.h1>
      {/* Two sentences, two weights: the goal, then the thing that keeps it repeatable.
          The second is the whole reason a youth pipeline exists in this product. */}
      <motion.p variants={variants} style={{
        margin: '20px 0 0', fontSize: 18.5 * scale, fontWeight: 400,
        lineHeight: 1.45, color: T.slate, maxWidth: 480,
      }}>
        Sustained by building bench strength.
      </motion.p>
    </>
  )
}

// ─── What the dashboard holds ────────────────────────────────────────────────
//
// Eight lines, on the login page and on Home. Login has to answer "why would I sign in";
// Home has to answer "what am I looking at" for someone who just did.
//
// Not numbered. A number implies a sequence — first this, then that — and these are eight
// independent things; numbering them would be decoration wearing the costume of
// structure. They are ordered instead: the athlete, then the opposition, then the
// calendar, which is the order a selector actually thinks in.
//
// Each carries a qualifier because a bare label is a category, not a promise. "Daily
// matches" says nothing that "Matches" does not; "what your athletes did yesterday" says
// why you would open it.
const CAPABILITIES = [
  ['Performance profiles',  'every match, rank and result, per athlete'],
  ['Form and trajectory',   'where a career is heading, not just where it is'],
  ['Benchmarks',            'measured against the players ranked above them'],
  ['Competitor analysis',   'the opponents standing in the way'],
  ['World rankings',        "India's singles, doubles and youth standing"],
  ['Daily matches',         'what your athletes did yesterday'],
  ['Competition reports',   'how India did, event by event'],
  ['Live scores',           'with win probability while the match is on'],
]

export function Capabilities({ variants, maxWidth = 760 }) {
  return (
    <motion.div variants={variants} style={{ position: 'relative', zIndex: 1, maxWidth }}>
      {/* An eyebrow, not a heading. A heading here would have to be sized between the
          vision above and the item labels below, and there is no room between them — it
          would either compete with the sentence or outrank the list it introduces. Set
          small and uppercase it names the group without entering the size contest, which
          is the same job the scheme's name does at the top of the panel.
          "What's inside" rather than "What you can do": every line below is a noun, and a
          heading promising actions over a list of things is a mismatch the reader feels
          without being able to name. */}
      <p style={{
        margin: '0 0 14px', fontSize: 12, fontWeight: 700, letterSpacing: '0.14em',
        textTransform: 'uppercase', color: T.slate,
      }}>
        What's inside
      </p>

      <ul style={{
        listStyle: 'none', margin: 0, padding: 0,
        // Two columns of four wherever there is room, one below that. The min() cap is
        // what stops a 280px track forcing the page sideways on a phone.
        display: 'grid', gap: '0 clamp(24px, 3vw, 56px)',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
      }}>
        {/* No rule above each item. Eight hairlines across two columns drew a grid over a
            list that was already legible as a list — the space does the separating, so
            the eye counts items rather than lines. */}
        {CAPABILITIES.map(([label, note]) => (
          <li key={label} style={{ padding: '0 0 22px' }}>
            <span style={{ display: 'block', fontSize: 16, fontWeight: 600, color: T.ink,
                           letterSpacing: '-0.01em' }}>
              {label}
            </span>
            <span style={{ display: 'block', fontSize: 13.5, color: T.muted, marginTop: 3,
                           lineHeight: 1.45 }}>
              {note}
            </span>
          </li>
        ))}
      </ul>
    </motion.div>
  )
}

// ─── Mission ─────────────────────────────────────────────────────────────────
//
// Four parts, four treatments, and the split is the meaning: each line is a lead-in
// followed by its payload. "Measure" is the act and "what Matters" is the filter on it —
// same size, opposite weights, so the pair reads as one phrase with a hinge in the
// middle. Line two then inverts the arrangement: its lead-in is set small and muted so
// the eye lands on "Elite Humans", the only place a person is named.
export function Mission({ variants, scale = 1 }) {
  const big = `clamp(${24 * scale}px, ${3 * scale}vw, ${34 * scale}px)`
  return (
    <>
      <motion.p variants={variants} style={{
        margin: '22px 0 0', fontSize: big,
        letterSpacing: '-0.025em', lineHeight: 1.16, color: T.ink,
      }}>
        <span style={{ fontWeight: 600 }}>Measure</span>
        {' '}
        <span style={{ fontWeight: 300 }}>what Matters</span>
      </motion.p>
      <motion.p variants={variants} style={{
        margin: '4px 0 0', lineHeight: 1.16,
        display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '0 10px',
      }}>
        <span style={{
          fontSize: `clamp(${13 * scale}px, ${1.25 * scale}vw, ${16 * scale}px)`,
          fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.muted,
        }}>
          Performed by
        </span>
        <span style={{
          fontSize: big, fontWeight: 600, letterSpacing: '-0.025em', color: T.ink,
        }}>
          Elite Humans
        </span>
      </motion.p>
    </>
  )
}
