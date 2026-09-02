import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// ─── Where the reset email lands ─────────────────────────────────────────────
//
// Supabase does not hand this page a token to spend. It signs the user in from the link
// and fires a PASSWORD_RECOVERY event, so by the time this renders there is already a
// session — a short-lived one whose only purpose is to allow one updateUser call.
//
// That is why the page waits for the session rather than reading the URL: on a cold load
// the event has not fired yet, and a form that submits before it does fails with "Auth
// session missing" for reasons the person reading it cannot act on.

const MIN_PASSWORD = 8

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [ready, setReady]       = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [error, setError]       = useState(null)
  const [done, setDone]         = useState(false)
  const [loading, setLoading]   = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN')) setReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function submit(e) {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_PASSWORD) return setError(`Password must be at least ${MIN_PASSWORD} characters.`)
    if (password !== confirm)           return setError('The two passwords do not match.')

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) return setError(error.message)
    setDone(true)
    setTimeout(() => navigate('/'), 1500)
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif', position: 'relative', zIndex: 4,
    }}>
      <div style={{
        width: '100%', maxWidth: 380, padding: '40px 32px',
        background: 'white', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: '0 0 6px' }}>
          Set a new password
        </h1>

        {done ? (
          <p style={{ fontSize: 13, color: '#15803d', marginTop: 12 }}>
            Password updated. Taking you in…
          </p>
        ) : !ready ? (
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 12 }}>
            Checking your link…
          </p>
        ) : (
          <form onSubmit={submit} style={{ marginTop: 18 }}>
            {['New password', 'Confirm password'].map((label, i) => (
              <div key={label} style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
                  {label}
                </label>
                <input
                  type="password" required autoComplete="new-password" placeholder="••••••••"
                  value={i === 0 ? password : confirm}
                  onChange={e => (i === 0 ? setPassword : setConfirm)(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 12px', border: '1.5px solid #e2e8f0',
                    borderRadius: 8, fontSize: 14, color: '#0f172a', outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            ))}

            {error && <p style={{ fontSize: 12, color: '#dc2626', marginBottom: 12 }}>{error}</p>}

            <button type="submit" disabled={loading || !password || !confirm} style={{
              width: '100%', padding: '11px',
              background: loading ? '#a5b4fc' : '#6366f1', color: 'white',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}>
              {loading ? 'Saving…' : 'Save password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
