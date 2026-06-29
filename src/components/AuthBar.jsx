import { useAuth } from '../context/AuthContext.jsx'
import { useNavigate } from 'react-router-dom'

const ROLE_LABEL = { admin: 'Admin', coach: 'Coach', org: 'Organisation', athlete: 'Athlete' }
const ROLE_COLOR = { admin: '#6366f1', coach: '#10b981', org: '#3b82f6', athlete: '#f59e0b' }

export default function AuthBar() {
  const { session, profile, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const homeLink = (
    <a href="/" style={{
      fontSize: 12, fontWeight: 600, color: '#64748b', textDecoration: 'none',
    }}>
      Home
    </a>
  )

  if (!session || !profile) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 16px',
        background: 'white', borderBottom: '1px solid #e2e8f0', fontSize: 12,
      }}>
        {homeLink}
      </div>
    )
  }

  const role  = profile.role
  const email = session.user.email

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr auto 1fr',
      alignItems: 'center',
      padding: '8px 16px',
      background: 'white',
      borderBottom: '1px solid #e2e8f0',
      fontSize: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          padding: '2px 8px',
          borderRadius: 99,
          background: `${ROLE_COLOR[role]}18`,
          color: ROLE_COLOR[role],
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          {ROLE_LABEL[role]}
        </span>
        <span style={{ color: '#64748b' }}>{email}</span>
        {role === 'athlete' && profile?.audit_views_remaining != null && (
          <span style={{ color: '#94a3b8', fontSize: 11 }}>
            · {profile.audit_views_remaining} audit view{profile.audit_views_remaining !== 1 ? 's' : ''} remaining this month
          </span>
        )}
      </div>
      <div style={{ textAlign: 'center' }}>
        {homeLink}
      </div>
      <button
        onClick={handleSignOut}
        style={{
          justifySelf: 'end',
          fontSize: 11,
          fontWeight: 600,
          color: '#64748b',
          background: 'none',
          border: '1px solid #e2e8f0',
          borderRadius: 6,
          padding: '4px 10px',
          cursor: 'pointer',
        }}
      >
        Sign out
      </button>
    </div>
  )
}
