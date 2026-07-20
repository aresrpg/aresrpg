// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CSSProperties } from 'react'

import { COARSE, NARROW, PHONE_SHORT } from './game/core/mobile_mode.js'

// D260 VERSION BADGE (07-16, live iPhone fight session): shows the version in the small top-right corner so
// a player can confirm which build they're on. Scope cut 07-18: the version-over-canvas badge is only for
// mobile, on desktop it's the sidebar." The badge stays mounted unconditionally (app.tsx, outside the
// router — survives every route AND a router/AppBody crash) but its VISIBILITY is CSS-gated:
//
//   • hidden by default (desktop never sees the canvas overlay — the desktop Layout sidebar's own
//     bottom-center v{__APP_VERSION__} tag, components/sidebar.tsx, is the sole desktop home per the
//     07-17 directive; desktop surfaces without that sidebar — the logged-out spectate landing,
//     a crashed Layout — deliberately show NO version, per the 07-18 ruling);
//   • shown exactly under the house mobile signals — the @media blocks are composed from mobile_mode.js's
//     OWN query strings (coarse pointer AND (narrow width OR phone-short landscape height)), the single
//     source of truth for "is this a mobile session", so the CSS gate can never drift from is_mobile();
//   • still suppressed by a mounted desktop sidebar via :has() (higher specificity, declared last) —
//     belt-and-suspenders for any viewport where the mobile signals and the desktop Layout coexist
//     (e.g. a touch laptop in a short window).
//
// Kept as its OWN module (not inlined in app.tsx) so it stays bun-test importable — app.tsx's own import
// graph pulls in Vite-only virtual modules (`virtual:item_catalog`) bun:test can't resolve.
//
// Offset 50px below the safe-area top line: mobile fight mode moves the HUD burger
// (game/screens/hud/MobileHud.jsx's `.mobile-hud-actions--fight`) into this exact corner (44px tall + 6px
// gap) — the badge sits just clear of it. pointer-events:none (never eats a tap or blocks the burger under
// it); z-40 sits above the canvas/HUD/join-veil (z-11/12/30, GameWorldHost.tsx) and below toasts (z-50) and
// the mobile burger/drawer chrome (z-90/180, mobile-hud.css).
export const VERSION_BADGE_STYLE: CSSProperties = {
  position: 'fixed',
  top: 'calc(max(6px, var(--safe-top, 0px)) + 50px)',
  right: 'max(8px, var(--safe-right, 0px))',
  zIndex: 40,
  pointerEvents: 'none',
  fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
  fontSize: 9,
  letterSpacing: '0.08em',
  color: 'var(--color-gold, #c8963c)',
  opacity: 0.4,
  userSelect: 'none',
}

export const VERSION_BADGE_SIDEBAR_RULE = 'body:has([data-app-sidebar]) [data-version-badge]{display:none}'

// Order + specificity carry the law: hidden everywhere → revealed only where the mobile signals match →
// a mounted sidebar re-hides regardless (its :has() selector outweighs the bare attribute selector).
export const VERSION_BADGE_RULES = [
  '[data-version-badge]{display:none}',
  `@media ${COARSE} and ${NARROW}{[data-version-badge]{display:block}}`,
  `@media ${COARSE} and ${PHONE_SHORT}{[data-version-badge]{display:block}}`,
  VERSION_BADGE_SIDEBAR_RULE,
].join('')

export function VersionBadge({ version }: { version: string }) {
  return (
    <div data-version-badge="" aria-hidden="true" style={VERSION_BADGE_STYLE}>
      <style>{VERSION_BADGE_RULES}</style>v{version}
    </div>
  )
}
