// SEARCH-PRESS JUICE — the ON-PRESS border-flash pulse: a subtle flashing-border effect layered onto what used to be just a button sound. Pure presentation:
// DiscoveryPrompts.jsx's [F] on_trigger calls trigger_search_flash() the INSTANT the press lands (optimistic
// — before the kiosk resolve/tx ever await), so the acknowledgement never waits on chain truth. This just
// renders a thin gold vignette over the game viewport that pulses once per press.
//
// A `key={flash}` remount forces a FRESH DOM node on every press (even back-to-back — the ZoneRevealBanner
// precedent), which restarts the one-shot CSS animation without any JS timer/cleanup bookkeeping. flash===0
// (pre-first-press) renders one idle, fully-transparent node — zero visual cost. Reduced-motion swaps to a
// flatter single pulse in CSS (game-world-hud.css `@media (prefers-reduced-motion: reduce)`) — no JS branch
// needed here, matching the .gw-reveal pattern.

import { useSyncExternalStore } from 'react'

import { search_flash_store } from '../../../core/toast.js'

/** @returns {import('react').ReactElement} */
export function ZoneSearchFlash() {
  const flash = useSyncExternalStore(search_flash_store.subscribe, search_flash_store.get)
  return <div key={flash} className="gw-search-flash" aria-hidden="true" />
}
