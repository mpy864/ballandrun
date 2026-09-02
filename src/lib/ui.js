// ─── Shared Apple-grade UI primitives (inline-style pages) ───────────────────
// Values reference the CSS tokens in index.css so everything stays consistent.

export const T = {
  ink: 'var(--tops-ink)',
  slate: 'var(--tops-slate)',
  muted: 'var(--tops-muted)',
  border: 'var(--tops-border)',
  divider: 'var(--tops-divider)',
  accent: 'var(--tops-accent)',
  card: 'var(--tops-card)',
  radius: 'var(--tops-radius)',
  radiusSm: 'var(--tops-radius-sm)',
  pill: 'var(--tops-pill)',
  shadow: 'var(--tops-shadow)',
}

// A real panel: white, bounded, sitting a step above the page.
//
// This was a transparent no-op — the "flat editorial" idea that a section reads from its
// own hairlines and whitespace alone. It is a real style, but an unforgiving one, and
// the verdict on the actual screens was that those pages looked unfinished next to the
// ones with bounded cards. A boundary is what makes a group of numbers read as a
// deliberate panel rather than as text that happens to be near other text.
//
// Every page that uses this picks up the change at once, which is the whole reason it
// lives in one place: 23 uses across 7 files, one edit.
export const card = {
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: T.radius,
  boxShadow: T.shadow,
}

// Small uppercase label / eyebrow.
export const label = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: T.muted,
}

// Soft, muted pill. `tone` is a semantic hex; produces a low-sat tint + tinted text.
export function chip(tone = '#6e6e73', extra = {}) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    fontSize: 10.5, fontWeight: 600, lineHeight: 1.4,
    padding: '3px 9px', borderRadius: 3, whiteSpace: 'nowrap',
    background: `color-mix(in srgb, ${tone} 12%, #fff)`,
    color: `color-mix(in srgb, ${tone} 78%, #1d1d1f)`,
    ...extra,
  }
}

// Gentle hover feedback for interactive rows/blocks — a faint tint, no lift/shadow.
export const hoverLift = {
  onMouseEnter: e => { e.currentTarget.style.background = 'rgba(0,0,0,0.022)' },
  onMouseLeave: e => { e.currentTarget.style.background = 'transparent' },
}

// Set the per-page accent (sport colour) via a CSS var on a wrapper element.
export function accentVar(color) {
  return { ['--tops-accent']: color }
}

// ─── Forms ───────────────────────────────────────────────────────────────────
//
// The five auth pages were written outside this file and showed it: 16px radius against
// the token's 10, a 24px-blur shadow against the token's 1px, and #6366f1 — the indigo
// every framework starter ships with — as the primary colour. Three signatures of a page
// assembled from defaults rather than designed, and they were the first screens anyone
// saw.
//
// What replaces the indigo is ink. The scheme already owns a palette: saffron, navy and
// green carry its name, and gold marks the mission. Spending one of those on a Sign in
// button would cheapen it — the tricolour means something here and a button does not. So
// the button takes the same near-black the squad board's active toggles use, and gold
// appears once, as a hairline, where the eye should start.

export const field = {
  width: '100%', padding: '10px 12px', boxSizing: 'border-box',
  border: `1px solid ${T.border}`, borderRadius: T.radiusSm,
  fontSize: 14, color: T.ink, background: T.card, outline: 'none',
  // Focus is a darkened border, not a coloured glow. A glow needs a hue, and every hue
  // in this palette is already carrying a meaning.
  transition: 'border-color .12s ease',
}
export const fieldFocus = {
  onFocus: e => { e.target.style.borderColor = T.ink },
  onBlur:  e => { e.target.style.borderColor = T.border },
}

export const fieldLabel = {
  display: 'block', marginBottom: 6,
  fontSize: 12, fontWeight: 600, color: T.slate,
}

export function primaryBtn(disabled = false) {
  return {
    width: '100%', padding: '11px 16px',
    background: disabled ? T.muted : T.ink, color: '#fff',
    border: 'none', borderRadius: T.radiusSm,
    fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em',
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

export const ghostBtn = {
  width: '100%', padding: '10px 16px',
  background: 'transparent', color: T.slate,
  border: `1px solid ${T.border}`, borderRadius: T.radiusSm,
  fontSize: 13.5, fontWeight: 550, cursor: 'pointer',
}

// A text link, not a button dressed as one. Slate rather than a hue, because nothing on
// these pages is important enough to spend a colour on.
export const textBtn = {
  padding: '6px 2px', background: 'none', border: 'none',
  fontSize: 12.5, fontWeight: 550, color: T.slate,
  cursor: 'pointer', textDecoration: 'underline',
  textUnderlineOffset: 3, textDecorationColor: T.border,
}

export const formError = { fontSize: 12.5, color: '#a8342a', margin: '0 0 12px' }
export const formOk    = { fontSize: 12.5, color: '#1f6b3a', margin: '0 0 12px' }
