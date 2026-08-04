import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { getStoredTheme, applyTheme } from '@shared/theme.js'

// Applied before the first render so a stored Light/Dark choice never
// flashes the system default first.
applyTheme(getStoredTheme())

// The browser's own scroll restoration fights a client-rendered app: on a
// hard refresh it snaps straight back to wherever the page was scrolled
// before reloading, before React has laid anything out yet. Most visible
// on Journal's parallax (mobile/Journal.jsx) — a restored mid-page scrollY
// reads as an already-high scroll fraction against that page's small,
// still-settling scroll range, so the columns jump to their full offset
// (and the heading above them stays scrolled out of view) before the user
// has touched anything. 'manual' leaves every load at the top instead,
// same as any other fresh page view.
if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual'
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
