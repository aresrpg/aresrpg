import { useEffect } from 'react'

// The HUD chrome is authored at this REFERENCE viewport (the demo capture size); the global UI-scale
// maps any real viewport onto it so the whole px-heavy overlay fits identically on a 1280x720 laptop
// and on a 4K display. All four are deliberately tunable in one place.
//   BASE_W/BASE_H — the reference the layout was designed for (scale 1.0 lands here).
//   MIN/MAX       — clamp so a tiny screen never shrinks the HUD into illegibility, and a huge screen
//                   only grows it so far. With these, 1280x720 -> ~0.8 and a big display -> up to 1.15.
const BASE_W = 1600
const BASE_H = 900
const MIN = 0.62
const MAX = 1.15

/**
 * Clamp `n` into the inclusive range [lo, hi].
 * @param {number} n @param {number} lo @param {number} hi @returns {number}
 */
const clamp = (n, lo, hi) => Math.max(lo, Math.min(n, hi))

/**
 * Drive ONE global `--ui-scale` custom property off the viewport so the entire HUD fits any screen via a
 * single `transform: scale(var(--ui-scale))` on the HUD root (hud.css). The scale is the SMALLER of the
 * width/height ratios against the reference viewport (so the chrome fits on BOTH axes), clamped to
 * [MIN, MAX]: a small screen scales DOWN (everything fits, no scroll-hunting), a big screen scales UP to
 * MAX. The property is set on :root so the (separately-mounted) HUD overlay reads it with no prop
 * drilling. Re-runs on mount + every resize. The 3D canvas is a sibling node (never under the scaled
 * root), so the scene + the fight-board raycast are unaffected by this.
 * @returns {void}
 */
export const use_ui_scale = () => {
  useEffect(() => {
    const apply = () => {
      const scale = clamp(
        Math.min(window.innerWidth / BASE_W, window.innerHeight / BASE_H),
        MIN,
        MAX,
      )
      document.documentElement.style.setProperty('--ui-scale', String(scale))
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [])
}
