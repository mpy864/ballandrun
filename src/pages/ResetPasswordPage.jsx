import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { card, T, field, fieldFocus, fieldLabel, primaryBtn, formError } from '../lib/ui.js'

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
  const { clearRecovery } = useAuth()
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
    // Drop the recovery flag before navigating, or the shell renders this page again
    // instead of the dashboard the person has just earned their way back into.
    setTimeout(() => { clearRecovery?.(); navigate('/') }, 1500)
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif', position: 'relative', zIndex: 4,
    }}>
      <div style={{
        ...card, width: '100%', maxWidth: 380, padding: '36px 32px',
      }}>
        <div style={{ width: 28, height: 2, background: 'var(--tops-gold)', marginBottom: 18 }} />
        <h1 style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.025em', color: T.ink, margin: 0 }}>
          Set a new password
        </h1>

        {done ? (
          <p style={{ fontSize: 13.5, color: T.slate, marginTop: 12 }}>
            Password updated. Taking you in…
          </p>
        ) : !ready ? (
          <p style={{ fontSize: 13.5, color: T.muted, marginTop: 12 }}>
            Checking your link…
          </p>
        ) : (
          <form onSubmit={submit} style={{ marginTop: 18 }}>
            {['New password', 'Confirm password'].map((label, i) => (
              <div key={label} style={{ marginBottom: 14 }}>
                <label style={fieldLabel}>{label}</label>
                <input
                  type="password" required autoComplete="new-password" placeholder="••••••••"
                  value={i === 0 ? password : confirm}
                  onChange={e => (i === 0 ? setPassword : setConfirm)(e.target.value)}
                  style={field}
                  {...fieldFocus}
                />
              </div>
            ))}

            {error && <p style={formError}>{error}</p>}

            <button type="submit" disabled={loading || !password || !confirm}
                    style={primaryBtn(loading || !password || !confirm)}>
              {loading ? 'Saving…' : 'Save password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
