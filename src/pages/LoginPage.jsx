import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { T, field, fieldFocus, fieldLabel, primaryBtn, ghostBtn, textBtn,
         formError } from '../lib/ui.js'
import { Rings, SchemeName, GoldRule, Vision, Mission, Capabilities,
         group, rise, wipe } from '../components/brand.jsx'
import { useMediaQuery, SMALL_SCREEN } from '../lib/useMediaQuery.js'

// ─── Sign in / sign up / recover ─────────────────────────────────────────────
//
// Four modes on one form. The page used to carry two — password and magic link — and
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

  const small = useMediaQuery(SMALL_SCREEN)
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
    // Two panels split by one full-height hairline, and no card around the form. A card
    // is a container that says "this group is separate from the page" — but the form is
    // not a group inside this page, it is one half of it. The rule does that job with a
    // single pixel, and the form then sits directly on the ground like the statement does.
    //
    // The split is drawn with useMediaQuery rather than a CSS breakpoint because the rule
    // and the layout have to disappear together: a border-left on a stacked full-width
    // block reads as a stray rail down the side of a phone.
    <div style={{
      minHeight: '100dvh', display: 'grid', alignItems: 'stretch',
      fontFamily: 'system-ui, sans-serif', position: 'relative', zIndex: 4,
      // The form column is sized by the form, not by a share of the page. As a fraction
      // it was 0.82fr — around 560px on a wide display for a 340px stack of fields, so
      // the rule sat a long way left of the thing it was separating and the right of the
      // screen was empty. `auto` makes the track exactly the form plus its padding, and
      // every pixel the page gains goes to the sentence instead.
      gridTemplateColumns: small ? '1fr' : 'minmax(0, 1fr) auto',
    }}>
      {/* ── The statement ──
          It started two steps down from Home, on the theory that it should not shout over
          the form. That was wrong about what the two are competing for: shrinking the
          statement never made the form louder, it left the left half under-filled.
          It now runs a step ABOVE Home. Home's statement shares its page with a sidebar
          and has to sit inside the app; this page has nothing else on it, so the sentence
          can carry the screen. */}
      <motion.section {...anim} style={{
        position: 'relative', overflow: 'hidden',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        gap: 'clamp(32px, 4vh, 64px)',
        padding: small ? 'clamp(48px, 9vw, 72px) clamp(24px, 7vw, 48px) 40px'
                       : 'clamp(52px, 5.5vw, 84px) clamp(48px, 6vw, 104px)',
      }}>
        {/* Scoped to this panel now, not the page. Bleeding across the rule would have
            put the watermark behind the password field. overflow:hidden crops it at the
            rule, which is what makes it read as material rather than decoration. */}
        <Rings animate={!still} />

        {/* Three zones, top / middle / bottom, held apart by space-between rather than by
            margins — so the vision sits on the top edge and the credo on the bottom one
            whatever the window height, and the capabilities take whatever is left. */}
        {/* No 760px cap on this block. The sentence is 45 characters; at the size the
            clamp gives it on a wide display that needs about 1,040px, and the cap was
            what forced it onto two lines. It still wraps on a narrow window, which is
            correct — textWrap: balance then evens the break rather than leaving one word
            stranded. */}
        <div style={{ position: 'relative', zIndex: 1, maxWidth: 1100 }}>
          <SchemeName variants={v} />
          <Vision variants={v} scale={1.05} />
        </div>

        <Capabilities variants={v} />

        <div style={{ position: 'relative', zIndex: 1 }}>
          <GoldRule variants={vWipe} />
          <Mission variants={v} scale={0.8} />
        </div>
      </motion.section>

      {/* ── The form ── on the page, not on a card. */}
      <div style={{
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        borderLeft: small ? 'none' : `1px solid ${T.border}`,
        borderTop:  small ? `1px solid ${T.border}` : 'none',
        padding: small ? 'clamp(36px, 8vw, 56px) clamp(24px, 7vw, 48px)'
                       : 'clamp(48px, 5vw, 80px) clamp(40px, 4.5vw, 72px)',
      }}>
        {/* A fixed width, not a max: the column is auto-sized, so an intrinsic
            width is what gives the track something definite to measure. */}
        <div style={{ width: small ? '100%' : 340, maxWidth: 340 }}>
        {/* Gold, once — the same accent that marks the mission on the left. It is the only
            colour on this half, which is what makes it register at all. */}
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

