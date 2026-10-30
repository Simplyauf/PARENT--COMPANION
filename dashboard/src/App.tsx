import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Landing from './pages/Landing'
import InstallBanner from './components/InstallBanner'

// Route-level code splitting — the landing page shouldn't pay for the dashboard
const Auth = lazy(() => import('./pages/Auth'))
const CheckInbox = lazy(() => import('./pages/CheckInbox'))
const AuthCallback = lazy(() => import('./pages/AuthCallback'))
const Setup = lazy(() => import('./pages/Setup'))
const Activate = lazy(() => import('./pages/Activate'))
const Dashboard = lazy(() => import('./pages/Dashboard'))

const routeFallback = (
  <div className="min-h-screen bg-[#F7F5F0] flex items-center justify-center">
    <div className="w-8 h-8 border-2 border-[#1B4D3E] border-t-transparent rounded-full animate-spin" />
  </div>
)

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={routeFallback}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/auth/check-inbox" element={<CheckInbox />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/activate" element={<Activate />} />
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </Suspense>
      <InstallBanner />
    </BrowserRouter>
  )
}
