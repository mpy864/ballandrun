import { useAuth } from '../context/AuthContext'
import { card, T, ghostBtn } from '../lib/ui.js'

// ─── The waiting room ────────────────────────────────────────────────────────
//
// Where an account lands between signing up and being approved. It is deliberately a
// full page rather than an empty dashboard: a screen of blank panels reads as a broken
// site, and someone who thinks the site is broken does not come back.
//
// It shows no data at all. That is not only a UI choice — the RLS policies behind every
// table refuse a pending account too, so there is nothing here to render even if the
// shell were drawn around it.

export default function PendingPage() {
  const { session, signOut } = useAuth()

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif', padding: 20, position: 'relative', zIndex: 4,
    }}>
      <div style={{
        ...card, width: '100%', maxWidth: 440, padding: '36px 32px',
      }}>
        <div style={{ width: 28, height: 2, background: 'var(--tops-gold)', marginBottom: 18 }} />
        <h1 style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.025em', color: T.ink, margin: '0 0 10px' }}>
          Waiting for approval
        </h1>
        <p style={{ fontSize: 13.5, color: T.slate, lineHeight: 1.6, margin: 0 }}>
          Your account is set up. An administrator has to approve it before you can see
          any data.
        </p>
        <p style={{ fontSize: 12.5, color: T.muted, margin: '18px 0 0', paddingTop: 16,
                    borderTop: `1px solid ${T.divider}` }}>
          Signed in as <strong style={{ color: T.slate }}>{session?.user?.email}</strong>
        </p>

        <button onClick={signOut} style={{ ...ghostBtn, width: 'auto', marginTop: 18 }}>
          Sign out
        </button>
      </div>
    </div>
  )
}
