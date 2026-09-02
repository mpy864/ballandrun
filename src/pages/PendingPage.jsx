import { useAuth } from '../context/AuthContext'

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
        width: '100%', maxWidth: 420, padding: '40px 32px', textAlign: 'center',
        background: '#fff', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 8px' }}>
          TOPS TT Intelligence
        </p>
        <h1 style={{ fontSize: 21, fontWeight: 800, color: '#0f172a', margin: '0 0 10px' }}>
          Waiting for approval
        </h1>
        <p style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.6, margin: 0 }}>
          Your account is set up. An administrator has to approve it before you can see
          any data.
        </p>
        <p style={{ fontSize: 12.5, color: '#64748b', marginTop: 14 }}>
          Signed in as <strong>{session?.user?.email}</strong>
        </p>

        <button onClick={signOut} style={{
          marginTop: 22, padding: '9px 20px', background: 'none',
          border: '1px solid #e2e8f0', borderRadius: 8,
          fontSize: 13, color: '#64748b', cursor: 'pointer',
        }}>
          Sign out
        </button>
      </div>
    </div>
  )
}
