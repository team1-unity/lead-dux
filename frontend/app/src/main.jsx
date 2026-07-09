import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { getStoredTheme, applyTheme } from '@shared/theme.js'

// Applied before the first render so a stored Light/Dark choice never
// flashes the system default first.
applyTheme(getStoredTheme())

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
