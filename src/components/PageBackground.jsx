// Flat editorial page background: a single calm near-white fill (no gradient),
// with one small refined SAI mark in the corner for brand.
export default function PageBackground() {
  return (
    <>
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: 'var(--tops-bg-2)',
      }} />

      {/* "Built by SAI" — quiet bottom-right corner mark (clear of the top bar) */}
      <div style={{
        position: 'fixed', bottom: 18, right: 22, zIndex: 5,
        display: 'flex', alignItems: 'center', gap: 8,
        pointerEvents: 'none', opacity: 0.7,
      }}>
        <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--tops-muted)', letterSpacing: 1, textTransform: 'uppercase' }}>Built by</span>
        <img src="/Players/SAI%20logo.png" alt="SAI"
          style={{ height: 26, objectFit: 'contain' }} />
      </div>
    </>
  )
}
