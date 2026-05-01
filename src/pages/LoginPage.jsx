import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

export default function LoginPage() {
  const { signInWithEmail } = useAuth()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent]         = useState(false)
  const [error, setError]       = useState(null)
  const [loading, setLoading]   = useState(false)
  const [mode, setMode]         = useState('password') // 'magic' | 'password'

  async function handleMagicLink(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await signInWithEmail(email.trim())
    setLoading(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  async function handlePassword(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({
      email:    email.trim(),
      password: password,
    })
    setLoading(false)
    if (error) setError(error.message)
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif',
      position: 'relative',
      zIndex: 4,
    }}>
      <div style={{
        width: '100%',
        maxWidth: 380,
        padding: '40px 32px',
        background: 'white',
        borderRadius: 16,
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      }}>
        <div style={{ marginBottom: 32 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 6 }}>
            TOPS TT Intelligence
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0 }}>
            Sign in
          </h1>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>
            {mode === 'magic' ? "Enter your email — we'll send a magic link." : 'Enter your email and password.'}
          </p>
        </div>

        {sent ? (
          <div style={{ padding: '16px 18px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#15803d', margin: 0 }}>Check your inbox</p>
            <p style={{ fontSize: 12, color: '#166534', marginTop: 4 }}>
              We sent a link to <strong>{email}</strong>. Click it to sign in.
            </p>
          </div>
        ) : (
          <form onSubmit={mode === 'magic' ? handleMagicLink : handlePassword}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
                Email address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={{
                  width: '100%', padding: '10px 12px', border: '1.5px solid #e2e8f0',
                  borderRadius: 8, fontSize: 14, color: '#0f172a', outline: 'none',
                  boxSizing: 'border-box',
                }}
                onFocus={e => e.target.style.borderColor = '#6366f1'}
                onBlur={e => e.target.style.borderColor = '#e2e8f0'}
              />
            </div>

            {mode === 'password' && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={{
                    width: '100%', padding: '10px 12px', border: '1.5px solid #e2e8f0',
                    borderRadius: 8, fontSize: 14, color: '#0f172a', outline: 'none',
                    boxSizing: 'border-box',
                  }}
                  onFocus={e => e.target.style.borderColor = '#6366f1'}
                  onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                />
              </div>
            )}

            {error && (
              <p style={{ fontSize: 12, color: '#dc2626', marginBottom: 12 }}>{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !email || (mode === 'password' && !password)}
              style={{
                width: '100%', padding: '11px',
                background: loading ? '#a5b4fc' : '#6366f1',
                color: 'white', border: 'none', borderRadius: 8,
                fontSize: 14, fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Signing in…' : mode === 'magic' ? 'Send magic link' : 'Sign in'}
            </button>

            <button
              type="button"
              onClick={() => { setMode(m => m === 'magic' ? 'password' : 'magic'); setError(null); }}
              style={{
                width: '100%', marginTop: 10, padding: '9px',
                background: 'none', border: '1px solid #e2e8f0',
                borderRadius: 8, fontSize: 13, color: '#64748b',
                cursor: 'pointer',
              }}
            >
              {mode === 'magic' ? 'Use password instead' : 'Use magic link instead'}
            </button>
          </form>
        )}

        <p style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 24 }}>
          Access is by invitation only.
        </p>
      </div>
    </div>
  )
}
