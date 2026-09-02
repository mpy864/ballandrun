import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import LoginPage from './pages/LoginPage.jsx'
import DynamicOKRDashboard from './components/DynamicOKRDashboard.jsx'
import IndiaDashboard from './pages/IndiaDashboard.jsx'
import H2HDashboard from './components/H2HDashboard.jsx'
import LivePage from './pages/LivePage.jsx'
import TournamentPage from './pages/TournamentPage.jsx'
import YouthPipelinePage from './pages/YouthPipelinePage.jsx'
import PlayerPage from './pages/PlayerPage.jsx'
import IndiaPage from './pages/IndiaPage.jsx'
import ForecastPage from './pages/ForecastPage.jsx'
import TopsPlatformPage from './pages/TopsPlatformPage.jsx'
import HomePage from './pages/HomePage.jsx'
import PendingPage from './pages/PendingPage.jsx'
import ResetPasswordPage from './pages/ResetPasswordPage.jsx'
import AccountPage from './pages/AccountPage.jsx'
import ApprovalsPage from './pages/ApprovalsPage.jsx'
import SportPage from './pages/SportPage.jsx'
import PairProfile from './pages/PairProfile.jsx'
import PageBackground from './components/PageBackground.jsx'
import AppShell from './components/AppShell.jsx'

// Authed layout: the persistent shell (sidebar) wraps all signed-in routes.
//
// Two gates, not one. Being signed in gets you past the first; being approved gets you
// past the second. Signup is open to anyone, so without the second gate a stranger with
// an email address would land on the squad board.
function ShellLayout() {
  const { session, loading, profileLoading, isPending } = useAuth()
  if (loading || profileLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tops-muted)', fontSize: 14 }}>
        Loading…
      </div>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  if (isPending) return <PendingPage />
  return <AppShell />
}

function RedirectIfAuthed({ children }) {
  const { session, loading } = useAuth()
  if (loading) return null
  if (session) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <>
      <PageBackground />
      <Routes>
        <Route path="/login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
        <Route path="/live" element={<LivePage />} />
        {/* Outside the shell: the reset link arrives with a recovery session, not an
            approved one, so it must not pass through the approval gate. */}
        <Route path="/reset" element={<ResetPasswordPage />} />

        {/* All signed-in routes live inside the app shell */}
        <Route element={<ShellLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/platform" element={<TopsPlatformPage />} />
          <Route path="/rankings" element={<IndiaDashboard />} />
          <Route path="/okr" element={<DynamicOKRDashboard />} />
          <Route path="/h2h" element={<H2HDashboard />} />
          <Route path="/youth" element={<YouthPipelinePage />} />
          <Route path="/tournament" element={<TournamentPage />} />
          <Route path="/player/:ittf_id" element={<PlayerPage />} />
          <Route path="/india" element={<IndiaPage />} />
          <Route path="/forecast" element={<ForecastPage />} />
          <Route path="/sport/:sport" element={<SportPage />} />
          <Route path="/pair/:pair" element={<PairProfile />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />
        </Route>
      </Routes>
    </>
  )
}
