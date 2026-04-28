const MEN   = ['Harmeet', 'Manav', 'Mansuh', 'Payas', 'Sathiyan']
const WOMEN = ['Diya', 'Manika', 'Sutirtha', 'Syndrela', 'yashaswini']

export default function PageBackground() {
  return (
    <>
      {/* ── Base background colour ────────────────────────────────────────── */}
      <div style={{
        position: 'fixed', inset: 0,
        background: '#c8daf5',
        zIndex: 0, pointerEvents: 'none',
      }} />

      {/* ── Player photo collage ─────────────────────────────────────────── */}
      <div style={{
        position: 'fixed', inset: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gridTemplateRows: 'repeat(2, 1fr)',
        transform: 'scale(1.06)',
        transformOrigin: 'center center',
        filter: 'blur(4px) saturate(0.85)',
        opacity: 0.72,
        zIndex: 1, pointerEvents: 'none',
      }}>
        {[...MEN, ...WOMEN].map(name => (
          <img
            key={name}
            src={`/Players/${name}.jpeg`}
            alt=""
            draggable={false}
            style={{
              width: '100%', height: '100%',
              objectFit: 'cover', objectPosition: 'top center',
              display: 'block',
            }}
          />
        ))}
      </div>

      {/* ── SAI logo — large centred watermark ──────────────────────────── */}
      <div style={{
        position: 'fixed', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2, pointerEvents: 'none',
      }}>
        <img
          src="/Players/SAI%20logo.png"
          alt=""
          draggable={false}
          style={{ width: 340, opacity: 0.07, filter: 'blur(1px)', objectFit: 'contain' }}
        />
      </div>

      {/* ── Soft wash overlay ────────────────────────────────────────────── */}
      <div style={{
        position: 'fixed', inset: 0,
        background: 'rgba(220,232,252,0.30)',
        zIndex: 3, pointerEvents: 'none',
      }} />

      {/* ── "Built by SAI with passion" — top-right corner ──────────────── */}
      <div style={{
        position: 'fixed', top: 22, right: 28,
        zIndex: 9999,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        pointerEvents: 'none',
      }}>
        <span style={{
          fontSize: 9, fontWeight: 600,
          color: 'rgba(15,42,94,0.55)',
          letterSpacing: 1.5, textTransform: 'uppercase',
        }}>Built by</span>
        <img
          src="/Players/SAI%20logo.png"
          alt="SAI"
          style={{ height: 44, objectFit: 'contain', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.12))' }}
        />
        <span style={{
          fontSize: 9, fontWeight: 600,
          color: 'rgba(15,42,94,0.55)',
          letterSpacing: 1.5, textTransform: 'uppercase',
        }}>with passion</span>
      </div>
    </>
  )
}
