// MOBILE MODE — the ONE home for "is this a touch/mobile session" (drives a fully
// tailored mobile experience — controller + HUD). Every mobile-conditional surface imports THIS flag;
// duplicating the media queries elsewhere is a defect (single source of truth).
//
// Coarse pointer = the primary signal (real touch devices). Either a narrow width OR a phone-short
// landscape height keeps the same handset in mobile mode across orientation changes. Live-updates on
// change (fold a phone, plug a mouse) via the listener registry.

// Exported so CSS-gated mobile-only surfaces (version_badge.tsx) build their @media rules from THESE
// strings — the flag's CSS form stays this module's, never a second copy.
export const COARSE = '(pointer: coarse)'
export const NARROW = '(max-width: 900px)'
export const PHONE_SHORT = '(max-height: 600px)'

const supports_match_media = typeof window !== 'undefined' && typeof window.matchMedia === 'function'

export function mobile_signals_are_active(coarse, narrow, phone_short) {
  return coarse && (narrow || phone_short)
}

export function is_mobile() {
  if (!supports_match_media) return false
  return mobile_signals_are_active(
    window.matchMedia(COARSE).matches,
    window.matchMedia(NARROW).matches,
    window.matchMedia(PHONE_SHORT).matches
  )
}

/** Subscribe to mobile-mode changes. Returns an unsubscribe fn. */
export function on_mobile_change(listener) {
  if (!supports_match_media) return () => {}
  const queries = [window.matchMedia(COARSE), window.matchMedia(NARROW), window.matchMedia(PHONE_SHORT)]
  const notify = () => listener(is_mobile())
  queries.forEach((q) => q.addEventListener('change', notify))
  return () => queries.forEach((q) => q.removeEventListener('change', notify))
}
