import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Landing from './pages/Landing'
import Auth from './pages/Auth'
import CheckInbox from './pages/CheckInbox'
import AuthCallback from './pages/AuthCallback'
import Setup from './pages/Setup'
import Activate from './pages/Activate'
import Dashboard from './pages/Dashboard'
import InstallBanner from './components/InstallBanner'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/auth/check-inbox" element={<CheckInbox />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/activate" element={<Activate />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
      <InstallBanner />
    </BrowserRouter>
  )
}
