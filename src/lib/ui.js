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

// Flat editorial "card": no box. A section reads via its own hairline rules
// (header borderBottom, row borderTop) and whitespace, not a bordered surface.
export const card = {
  background: 'transparent',
  border: 'none',
  borderRadius: 0,
  boxShadow: 'none',
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
