import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

async function bootstrap(): Promise<void> {
  // Visual-check mode: running in a plain browser without the preload bridge.
  if (import.meta.env.DEV && !('meet' in window)) {
    const { installDevMock } = await import('./ui/devMock')
    installDevMock()
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void bootstrap()
