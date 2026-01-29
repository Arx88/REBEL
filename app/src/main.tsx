import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

console.log("[v0] main.tsx loading...")

const rootEl = document.getElementById('root')
console.log("[v0] Root element:", rootEl)

if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  console.log("[v0] App rendered successfully")
} else {
  console.error("[v0] Root element not found!")
}
