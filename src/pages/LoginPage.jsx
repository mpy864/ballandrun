import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { T, card, field, fieldFocus, fieldLabel, primaryBtn, ghostBtn, textBtn,
         formError } from '../lib/ui.js'
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

function Field({ label, type, value, onChange, placeholder, autoComplete }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={fieldLabel}>{label}</label>
      <input
        type={type} required value={value} autoComplete={autoComplete}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={field}
        {...fieldFocus}
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
        width: '100%', maxWidth: 1440, margin: '0 auto',
        display: 'grid', gap: 'clamp(32px, 5vw, 80px)', alignItems: 'center',
        // auto-fit reflows to one column below roughly 900px without a breakpoint to keep
        // in step. The min() cap means a narrow phone never gets a column wider than the
        // screen. minmax(0,…) rather than minmax(0,1fr) on the second track is not
        // available here, so the card constrains itself instead — see maxWidth below.
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))',
      }}>
        {/* ── The statement ──
            It started two steps down from Home, on the theory that it should not shout
            over the form. That was wrong about what the two are competing for: the form is
            a 380px panel on a 1440px page, and shrinking the statement never made the form
            louder — it left the left half under-filled.
            It now runs a step ABOVE Home. Home's statement shares its page with a sidebar
            and has to sit inside the app; this page has nothing else on it, so the
            sentence can carry the screen. */}
        <motion.section {...anim} style={{ maxWidth: 760 }}>
          <SchemeName variants={v} />
          <Vision variants={v} scale={1.28} />
          <div style={{ marginTop: 44, paddingTop: 34, borderTop: `1px solid ${T.divider}` }}>
            <GoldRule variants={vWipe} />
            <Mission variants={v} scale={1.06} />
          </div>
        </motion.section>

        {/* ── The form ──
            A bounded panel on the app's own tokens, not a card floating on a 24px blur.
            Pushed to the right edge of its column: centred, it drifted toward the middle
            of the page and sat closer to the statement than to anything else. */}
        <div style={{
        ...card, width: '100%', maxWidth: 380, justifySelf: 'end', padding: '36px 32px',
      }}>
        {/* Gold, once, at the top of the card — the same accent that marks the mission
            on the left. It is the only colour on this panel, which is what makes it
            register at all. */}
        <div style={{ width: 28, height: 2, background: 'var(--tops-gold)', marginBottom: 18 }} />
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.025em', color: T.ink, margin: 0 }}>
            {m.title}
          </h1>
          <p style={{ fontSize: 13, color: T.slate, marginTop: 6, lineHeight: 1.45 }}>{m.blurb}</p>
        </div>

        {sent ? (
          <>
            {/* No green success box. A tinted panel with its own border is a second card
                inside the card; the message is the only thing on screen, so it can simply
                be the text. */}
            <p style={{ fontSize: 14, fontWeight: 600, color: T.ink, margin: 0 }}>{NOTICE[0]}</p>
            <p style={{ fontSize: 13, color: T.slate, margin: '6px 0 22px', lineHeight: 1.5 }}>{NOTICE[1]}</p>
            <button type="button" onClick={() => go('password')} style={ghostBtn}>
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

            {error && <p style={formError}>{error}</p>}

            <button type="submit" disabled={loading || !canSubmit}
                    style={primaryBtn(loading || !canSubmit)}>
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
                <button type="button" onClick={() => go('signup')}
                        style={{ ...ghostBtn, marginTop: 10 }}>Create an account</button>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 12 }}>
                  <button type="button" onClick={() => go('forgot')} style={textBtn}>Forgot password?</button>
                  <button type="button" onClick={() => go('magic')}  style={textBtn}>Email me a link</button>
                </div>
              </>
            )}
            {mode !== 'password' && (
              <button type="button" onClick={() => go('password')}
                      style={{ ...ghostBtn, marginTop: 10 }}>Back to sign in</button>
            )}
          </form>
        )}

        <p style={{ fontSize: 11.5, color: T.muted, marginTop: 24, lineHeight: 1.5,
                    paddingTop: 18, borderTop: `1px solid ${T.divider}` }}>
          Anyone can create an account. Access to data is approved by an administrator.
        </p>
        </div>
      </div>
    </div>
  )
}

