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
