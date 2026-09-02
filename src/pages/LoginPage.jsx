import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { T } from '../lib/ui.js'
import { Rings, SchemeName, GoldRule, Vision, Mission, group, rise, wipe } from '../components/brand.jsx'

// ─── Sign in / sign up / recover ─────────────────────────────────────────────
//
// Four modes on one card. The page used to carry two — password and magic link — and
// neither could create an account or set a password. Every account that exists was made
// by typing an email into the magic-link box, which quietly created a user with a random
// password nobody could ever learn. Four people signed in once that way on 12 June 2026
// and never came back; there was no screen where they could have set a password, and no
// "forgot password" to recover one.
//
// Signing up is open to anyone. Seeing anything is not: a new account is 'pending' until
// an admin approves it, so the open door leads to a waiting room rather than the data.

const MODES = {
  password: { title: 'Sign in',        blurb: 'Enter your email and password.' },
  signup:   { title: 'Create account', blurb: 'Choose a password. An admin will approve your access.' },
  magic:    { title: 'Sign in',        blurb: "Enter your email — we'll send a sign-in link." },
  forgot:   { title: 'Reset password', blurb: "Enter your email — we'll send a reset link." },
}

const MIN_PASSWORD = 8

const inputStyle = {
  width: '100%', padding: '10px 12px', border: '1.5px solid #e2e8f0',
  borderRadius: 8, fontSize: 14, color: '#0f172a', outline: 'none',
  boxSizing: 'border-box',
}

function Field({ label, type, value, onChange, placeholder, autoComplete }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <input
        type={type} required value={value} autoComplete={autoComplete}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
        onFocus={e => e.target.style.borderColor = '#6366f1'}
        onBlur={e => e.target.style.borderColor = '#e2e8f0'}
      />
    </div>
  )
}

export default function LoginPage() {
  const { signInWithEmail } = useAuth()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [sent, setSent]         = useState(null)   // null | 'magic' | 'forgot' | 'signup'
  const [error, setError]       = useState(null)
  const [loading, setLoading]   = useState(false)
  const [mode, setMode]         = useState('password')

  function go(next) {
    setMode(next); setError(null); setSent(null); setPassword(''); setConfirm('')
  }

  async function submit(e) {
    e.preventDefault()
    setError(null)

    if (mode === 'signup') {
      if (password.length < MIN_PASSWORD) return setError(`Password must be at least ${MIN_PASSWORD} characters.`)
      if (password !== confirm)           return setError('The two passwords do not match.')
    }

    setLoading(true)
    let err = null

    if (mode === 'password') {
      ({ error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password }))
    } else if (mode === 'signup') {
      // emailRedirectTo matters: Supabase mails a confirmation link and it has to come
      // back to this app, not to Supabase's own domain.
      ({ error: err } = await supabase.auth.signUp({
        email: email.trim(), password,
        options: { emailRedirectTo: window.location.origin },
      }))
      if (!err) setSent('signup')
    } else if (mode === 'magic') {
      ({ error: err } = await signInWithEmail(email.trim()))
      if (!err) setSent('magic')
    } else if (mode === 'forgot') {
      ({ error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset`,
      }))
      if (!err) setSent('forgot')
    }

    setLoading(false)
    if (err) setError(err.message)
  }

  const m = MODES[mode]
  const canSubmit = email
    && (mode === 'magic' || mode === 'forgot' || password)
    && (mode !== 'signup' || confirm)

  const NOTICE = {
    magic:  ['Check your inbox',  <>We sent a sign-in link to <strong>{email}</strong>.</>],
    forgot: ['Check your inbox',  <>We sent a password reset link to <strong>{email}</strong>.</>],
    signup: ['Account created',   <>Confirm your email at <strong>{email}</strong>, then sign in. An admin will approve your access.</>],
  }[sent] || []

  const still = useReducedMotion()
  const anim = still ? { initial: false }
                     : { variants: group, initial: 'hidden', animate: 'show' }
  const v = still ? undefined : rise
  const vWipe = still ? undefined : wipe

  return (
    // The first screen anyone ever sees used to say "Sign in" on an empty page, while the
    // statement of what TOPS is for sat one route away, behind the login. It belongs here:
    // this is the only screen a person outside the scheme will ever look at.
    //
    // Two columns that become one below ~880px, using the same intrinsic reflow as the
    // rest of the app — auto-fit with a min() cap, so a narrow phone never gets a column
    // wider than the screen. The statement leads on a phone and the form follows it.
    <div style={{
      minHeight: '100dvh', display: 'flex', alignItems: 'center',
      fontFamily: 'system-ui, sans-serif', position: 'relative', zIndex: 4,
      padding: 'clamp(28px, 5vw, 64px)',
    }}>
      <Rings animate={!still} />

      <div style={{
        position: 'relative', zIndex: 1,
        width: '100%', maxWidth: 1180, margin: '0 auto',
        display: 'grid', gap: 'clamp(32px, 5vw, 72px)', alignItems: 'center',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(400px, 100%), 1fr))',
      }}>
        {/* ── The statement ── */}
        <motion.section {...anim}>
          <SchemeName variants={v} />
          {/* A step smaller than on Home: there it owns the page, here it shares the
              screen with a form and must not shout over the thing you came to do. */}
          <Vision variants={v} scale={0.82} />
          <div style={{ marginTop: 38, paddingTop: 30, borderTop: `1px solid ${T.divider}`, maxWidth: 560 }}>
            <GoldRule variants={vWipe} />
            <Mission variants={v} scale={0.72} />
          </div>
        </motion.section>

        {/* ── The form ── */}
        <div style={{
        width: '100%', maxWidth: 380, justifySelf: 'end', padding: '40px 32px',
        background: 'white', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      }}>
        <div style={{ marginBottom: 32 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 6 }}>
            TOPS TT Intelligence
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0 }}>{m.title}</h1>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>{m.blurb}</p>
        </div>

        {sent ? (
          <>
            <div style={{ padding: '16px 18px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#15803d', margin: 0 }}>{NOTICE[0]}</p>
              <p style={{ fontSize: 12, color: '#166534', marginTop: 4 }}>{NOTICE[1]}</p>
            </div>
            <button type="button" onClick={() => go('password')} style={linkBtn}>
              Back to sign in
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            <Field label="Email address" type="email" value={email} onChange={setEmail}
                   placeholder="you@example.com" autoComplete="email" />

            {(mode === 'password' || mode === 'signup') && (
              <Field label="Password" type="password" value={password} onChange={setPassword}
                     placeholder="••••••••"
                     autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
            )}

            {mode === 'signup' && (
              <Field label="Confirm password" type="password" value={confirm} onChange={setConfirm}
                     placeholder="••••••••" autoComplete="new-password" />
            )}

            {error && <p style={{ fontSize: 12, color: '#dc2626', marginBottom: 12 }}>{error}</p>}

            <button type="submit" disabled={loading || !canSubmit} style={{
              width: '100%', padding: '11px',
              background: loading || !canSubmit ? '#a5b4fc' : '#6366f1',
              color: 'white', border: 'none', borderRadius: 8,
              fontSize: 14, fontWeight: 700,
              cursor: loading || !canSubmit ? 'not-allowed' : 'pointer',
            }}>
              {loading ? 'Working…'
                : mode === 'signup' ? 'Create account'
                : mode === 'magic'  ? 'Send sign-in link'
                : mode === 'forgot' ? 'Send reset link'
                : 'Sign in'}
            </button>

            {/* Only what is useful from where you are. Offering all four at once turns a
                login card into a menu. */}
            {mode === 'password' && (
              <>
                <button type="button" onClick={() => go('signup')} style={linkBtn}>Create an account</button>
                <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                  <button type="button" onClick={() => go('forgot')} style={{ ...subtle, flex: 1 }}>Forgot password?</button>
                  <button type="button" onClick={() => go('magic')}  style={{ ...subtle, flex: 1 }}>Email me a link</button>
                </div>
              </>
            )}
            {mode !== 'password' && (
              <button type="button" onClick={() => go('password')} style={linkBtn}>Back to sign in</button>
            )}
          </form>
        )}

        <p style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 24 }}>
          Anyone can create an account. Access to data is approved by an administrator.
        </p>
        </div>
      </div>
    </div>
  )
}

const linkBtn = {
  width: '100%', marginTop: 10, padding: '9px',
  background: 'none', border: '1px solid #e2e8f0', borderRadius: 8,
  fontSize: 13, color: '#64748b', cursor: 'pointer',
}
const subtle = {
  padding: '8px', background: 'none', border: 'none',
  fontSize: 12, color: '#6366f1', cursor: 'pointer',
}
