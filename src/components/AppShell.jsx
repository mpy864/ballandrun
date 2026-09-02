import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext.jsx'
import { SPORTS } from '../lib/topsRoster.js'
import { T } from '../lib/ui.js'
import { useMediaQuery, SMALL_SCREEN } from '../lib/useMediaQuery.js'

const ROLE_LABEL = { admin: 'Admin', coach: 'Coach', org: 'Organisation', athlete: 'Athlete', pending: 'Pending approval' }

function accentFor(pathname) {
  const m = pathname.match(/^\/sport\/(\w+)/)
  if (m) return (SPORTS.find(s => s.key === m[1])?.accent) || '#2563eb'
  return '#2563eb'
}

function NavItem({ to, label, end }) {
  return (
    <NavLink to={to} end={end}
      style={({ isActive }) => ({
        display: 'block', padding: '8px 12px',
        borderLeft: `2px solid ${isActive ? 'var(--tops-accent)' : 'transparent'}`,
        fontSize: 14, fontWeight: isActive ? 600 : 500, textDecoration: 'none',
        color: isActive ? T.ink : T.slate,
        transition: 'color .12s ease',
      })}
    >
      {label}
    </NavLink>
  )
}

function NavLabel({ children }) {
  return <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.muted, padding: '0 12px', margin: '18px 0 6px' }}>{children}</div>
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M2.5 4.5h13M2.5 9h13M2.5 13.5h13" />
    </svg>
  )
}

export default function AppShell() {
  const { session, profile, signOut, isAdmin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const accent = accentFor(location.pathname)

  const small = useMediaQuery(SMALL_SCREEN)
  const [open, setOpen] = useState(false)
  const railRef = useRef(null)
  const menuRef = useRef(null)

  // Navigating closes the drawer. Without this it stays open over the page you just
  // asked for, which on a phone means the answer is behind the menu that produced it.
  useEffect(() => { setOpen(false) }, [location.pathname])

  // Growing past the breakpoint must clear the open state, or the rail comes back with
  // a stale transform and the scrim sits invisibly over a desktop page.
  useEffect(() => { if (!small) setOpen(false) }, [small])

  // While the drawer is open it owns the screen: Escape closes it, the page behind does
  // not scroll, and focus moves into the drawer and returns to the button afterwards.
  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    railRef.current?.querySelector('a, button')?.focus()
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
      menuRef.current?.focus()
    }
  }, [open])

  return (
    <div style={{ position: 'relative', zIndex: 4, display: 'flex', minHeight: '100vh', ['--tops-accent']: accent }}>
      {/* Tapping away closes the drawer — the behaviour everyone tries first. */}
      <div className="tops-rail-scrim" data-open={open ? 'true' : 'false'}
        onClick={() => setOpen(false)} aria-hidden="true" />

      {/* ── Sidebar: permanent rail on desktop, drawer below 900px ── */}
      <aside
        ref={railRef}
        className="tops-rail"
        data-open={open ? 'true' : 'false'}
        // Shut on a phone it is not just off-screen, it is out of the tab order and out
        // of the screen-reader tree. A hidden menu you can still tab into is a trap.
        {...(small && !open ? { inert: '', 'aria-hidden': 'true' } : {})}
        style={{
          display: 'flex', flexDirection: 'column',
          background: 'var(--tops-bg-2)',
          borderRight: `1px solid ${T.border}`, padding: '20px 12px 14px',
        }}>
        {/* brand */}
        <button onClick={() => navigate('/')} style={{ display: 'flex', alignItems: 'baseline', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 10px 4px', textAlign: 'left' }}>
          <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', color: T.ink }}>TOPS</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: T.muted }}>Intelligence</span>
        </button>

        {/* nav */}
        <nav style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
          <NavItem to="/" end label="Home" />
          <NavLabel>Sports</NavLabel>
          {SPORTS.map(s => (
            <NavItem key={s.key} to={`/sport/${s.key}`} label={s.name} />
          ))}
          {/* No TOOLS section. Profiles was /okr, which is the player screen every
              athlete click already opens through okrLink() — from the sidebar it opened
              with nobody selected. Compare was /h2h, which each sport page's Compare tab
              already links to as "Full head-to-head (match history) →"; the tab is the
              summary and /h2h is the depth behind it, and a sidebar link short-circuited
              that. Both routes stay live and stay reachable. */}

          {/* Account is where a password gets changed; Approvals is where a signup gets
              let in. Approvals is shown only to an admin — the page refuses non-admins
              anyway, and RLS refuses them the rows, but a link nobody may follow is
              still clutter. */}
          <NavLabel>Account</NavLabel>
          <NavItem to="/account" label="My account" />
          {isAdmin && <NavItem to="/approvals" label="Approvals" />}
        </nav>

        {/* footer / user */}
        <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: `1px solid ${T.border}` }}>
          {profile && (
            <div style={{ padding: '2px 10px 10px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--tops-accent)' }}>
                {ROLE_LABEL[profile.role] || profile.role}
              </div>
              <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {session?.user?.email}
              </div>
            </div>
          )}
          <button onClick={async () => { await signOut(); navigate('/login') }}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 9, border: 'none', background: 'transparent', cursor: 'pointer', color: T.slate, fontSize: 13, fontWeight: 550 }}>
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Content ── */}
      {/* minWidth: 0 is load-bearing, not tidiness: a flex child defaults to min-content
          width, so one wide table inside would otherwise stretch main and push the page
          sideways instead of scrolling within its own container. */}
      <main style={{ flex: 1, minWidth: 0 }}>
        {/* Only rendered below the breakpoint, by CSS. It carries the menu button and
            the brand, so the drawer is reachable and the page still says where you are. */}
        <div className="tops-railbar">
          <button
            ref={menuRef}
            onClick={() => setOpen(v => !v)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 40, height: 40, margin: -8, padding: 0,   // 40px touch target
              border: 'none', background: 'transparent', cursor: 'pointer', color: T.ink,
            }}>
            <MenuIcon />
          </button>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
            <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.03em', color: T.ink }}>TOPS</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: T.muted }}>Intelligence</span>
          </span>
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={location.pathname}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}>
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
