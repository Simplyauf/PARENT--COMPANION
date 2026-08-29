import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// A tab left open across a deploy has a lazy-loaded route chunk (e.g.
// CheckInbox-*.js) whose filename no longer exists once a newer build
// replaces it — the dynamic import 404s and the user is stuck on a broken
// screen with no idea why. Reload once to pick up the current build; guard
// with sessionStorage so a genuinely broken deploy doesn't reload forever.
window.addEventListener('vite:preloadError', () => {
  const key = 'maemate_reloaded_after_preload_error'
  if (sessionStorage.getItem(key)) return
  sessionStorage.setItem(key, '1')
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
