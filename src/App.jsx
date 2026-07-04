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
import SportPage from './pages/SportPage.jsx'
import PageBackground from './components/PageBackground.jsx'

function ProtectedRoute({ children }) {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
        color: '#94a3b8',
        fontSize: 14,
      }}>
        Loading…
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />
  return children
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
      <Route path="/" element={
        <ProtectedRoute>
          <TopsPlatformPage />
        </ProtectedRoute>
      } />
      <Route path="/rankings" element={
        <ProtectedRoute>
          <IndiaDashboard />
        </ProtectedRoute>
      } />
      <Route path="/okr" element={
        <ProtectedRoute>
          <DynamicOKRDashboard />
        </ProtectedRoute>
      } />
      <Route path="/h2h" element={
        <ProtectedRoute>
          <H2HDashboard />
        </ProtectedRoute>
      } />
      <Route path="/live" element={<LivePage />} />
      <Route path="/youth" element={
        <ProtectedRoute>
          <YouthPipelinePage />
        </ProtectedRoute>
      } />
      <Route path="/tournament" element={
        <ProtectedRoute>
          <TournamentPage />
        </ProtectedRoute>
      } />
      <Route path="/player/:ittf_id" element={
        <ProtectedRoute>
          <PlayerPage />
        </ProtectedRoute>
      } />
      <Route path="/india" element={
        <ProtectedRoute>
          <IndiaPage />
        </ProtectedRoute>
      } />
      <Route path="/forecast" element={
        <ProtectedRoute>
          <ForecastPage />
        </ProtectedRoute>
      } />
      <Route path="/platform" element={
        <ProtectedRoute>
          <TopsPlatformPage />
        </ProtectedRoute>
      } />
      <Route path="/sport/:sport" element={
        <ProtectedRoute>
          <SportPage />
        </ProtectedRoute>
      } />
    </Routes>
    </>
  )
}
