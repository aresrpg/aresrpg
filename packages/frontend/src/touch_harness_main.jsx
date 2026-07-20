// THROWAWAY M-04 verification harness — NOT part of the app, NOT imported by main.tsx, NOT built into prod
// (a separate Vite HTML entry: touch-harness.html). Renders the REAL <TouchControls/> (the pure prop-driven
// component + the shipped touch-controls.css skin) over a dark game-ish backdrop so the CONVENTIONAL mobile
// joystick skin (translucent dark base + light nub) + the right-hand button cluster can be screenshotted in
// portrait and landscape. No chain, no WS, no auth. A Playwright touch drag on the stick zone spawns the base
// so the skin is visible. Delete this file + touch-harness.html once M-04 is signed off.
import './boot_shim'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
import './i18n'
import { TouchControls } from './game/touch/TouchControls.jsx'

// A muted scene-ish backdrop (the game's radial bg) so the TRANSLUCENT skin reads honestly — the base is
// dark-translucent, the nub light-translucent; both must be legible against a real-world-ish gradient.
function Harness() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'radial-gradient(ellipse at 50% 30%, #2a2f3a 0%, #141420 55%, #0a0a0f 100%)',
      }}
    >
      <div
        style={{
          position: 'fixed',
          top: 12,
          left: 12,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 10,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'rgba(232,228,220,0.5)',
        }}
      >
        M-04 · touch-controls skin (real component)
      </div>
      <TouchControls on_move={() => {}} on_jump={() => {}} on_mount_toggle={() => {}} on_menu_toggle={() => {}} />
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Harness />
  </StrictMode>
)
