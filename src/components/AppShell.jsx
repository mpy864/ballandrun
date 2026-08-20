import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext.jsx'
import { SPORTS } from '../lib/topsRoster.js'
import { T } from '../lib/ui.js'

const ROLE_LABEL = { admin: 'Admin', coach: 'Coach', org: 'Organisation', athlete: 'Athlete' }

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

export default function AppShell() {
  const { session, profile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const accent = accentFor(location.pathname)

  return (
    <div style={{ position: 'relative', zIndex: 4, display: 'flex', minHeight: '100vh', ['--tops-accent']: accent }}>
      {/* ── Sidebar ── */}
      <aside style={{
        width: 248, flexShrink: 0, position: 'sticky', top: 0, alignSelf: 'flex-start', height: '100vh',
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
          <NavLabel>Tools</NavLabel>
          <NavItem to="/results" label="Results" />
          <NavItem to="/okr" label="Profiles" />
          <NavItem to="/h2h" label="Compare" />
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
      <main style={{ flex: 1, minWidth: 0 }}>
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
