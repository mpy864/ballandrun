import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { card, T } from '../lib/ui.js'

// ─── Your account ────────────────────────────────────────────────────────────
//
// Changing a password used to require the forgot-password round trip through an inbox,
// because there was no screen for it. This is the same updateUser call the reset page
// makes; the difference is only that you are already signed in.

const MIN_PASSWORD = 8

const ROLE_NOTE = {
  pending: 'Waiting for an administrator to approve your access.',
  athlete: 'You can see rankings, players and results.',
  coach:   'You can see your club and its athletes.',
  org:     'Full read access.',
  admin:   'Full access, and you approve other accounts.',
}

export default function AccountPage() {
  const { session, profile } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [msg, setMsg]           = useState(null)
  const [error, setError]       = useState(null)
  const [loading, setLoading]   = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError(null); setMsg(null)
    if (password.length < MIN_PASSWORD) return setError(`Password must be at least ${MIN_PASSWORD} characters.`)
    if (password !== confirm)           return setError('The two passwords do not match.')

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) return setError(error.message)
    setPassword(''); setConfirm('')
    setMsg('Password updated.')
  }

  return (
    <div style={{ padding: '28px 0', maxWidth: 460 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: T.ink, margin: '0 0 4px' }}>Account</h1>
      <p style={{ fontSize: 13, color: T.muted, margin: '0 0 20px' }}>{session?.user?.email}</p>

      <div style={{ ...card, padding: '16px 20px', marginBottom: 16 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>
          Access level
        </p>
        <p style={{ fontSize: 15, fontWeight: 600, color: T.ink, margin: 0, textTransform: 'capitalize' }}>
          {profile?.role || '—'}
        </p>
        <p style={{ fontSize: 12.5, color: T.muted, margin: '4px 0 0' }}>
          {ROLE_NOTE[profile?.role] || ''}
        </p>
      </div>

      <form onSubmit={submit} style={{ ...card, padding: '16px 20px' }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>
          Change password
        </p>

        {['New password', 'Confirm password'].map((label, i) => (
          <div key={label} style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.slate, display: 'block', marginBottom: 6 }}>
              {label}
            </label>
            <input
              type="password" required autoComplete="new-password" placeholder="••••••••"
              value={i === 0 ? password : confirm}
              onChange={e => (i === 0 ? setPassword : setConfirm)(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', border: `1.5px solid ${T.border}`,
                borderRadius: 8, fontSize: 14, color: T.ink, outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
        ))}

        {error && <p style={{ fontSize: 12, color: '#dc2626', marginBottom: 10 }}>{error}</p>}
        {msg   && <p style={{ fontSize: 12, color: '#15803d', marginBottom: 10 }}>{msg}</p>}

        <button type="submit" disabled={loading || !password || !confirm} style={{
          padding: '10px 18px', background: loading ? '#a5b4fc' : '#6366f1', color: '#fff',
          border: 'none', borderRadius: 8, fontSize: 13.5, fontWeight: 700,
          cursor: loading || !password ? 'not-allowed' : 'pointer',
        }}>
          {loading ? 'Saving…' : 'Update password'}
        </button>
      </form>
    </div>
  )
}
