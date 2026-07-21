// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { COARSE, NARROW, PHONE_SHORT, mobile_signals_are_active } from './game/core/mobile_mode.js'
import { VERSION_BADGE_RULES, VERSION_BADGE_SIDEBAR_RULE, VERSION_BADGE_STYLE, VersionBadge } from './version_badge'
import { TOAST_CONTAINER_CLASS, toast_glass_class } from './toast'

const read_fixture = (relative_path: string) => readFileSync(new URL(relative_path, import.meta.url), 'utf8')

// OWNER (07-16, live iPhone fight session): "show the version in small top right to make sure I'm on the
// right version" — then 07-18: "the version over canvas is only for mobile, on desktop it's the sidebar."
// The sidebar's v{__APP_VERSION__} tag (components/sidebar.tsx) is the SOLE desktop home; the fixed badge
// stays mounted unconditionally (crash/route survival) but is CSS-gated to the house mobile signals.
//
// app.tsx itself is NOT imported here: its transitive graph pulls in Vite-only virtual modules
// (`virtual:item_catalog`) that bun:test cannot resolve — the badge lives in its own module (version_badge.tsx)
// specifically so it stays testable; app.tsx's own wiring is asserted via a raw source-text read below.
describe('version badge', () => {
  test('renders v-prefixed text, muted gold, non-interactive, clear of the canvas and the mobile fight burger', () => {
    expect(renderToStaticMarkup(<VersionBadge version="9.9.9" />)).toContain('v9.9.9')
    expect(VERSION_BADGE_STYLE.position).toBe('fixed')
    expect(VERSION_BADGE_STYLE.pointerEvents).toBe('none')
    expect(VERSION_BADGE_STYLE.opacity).toBe(0.4)
    expect(VERSION_BADGE_STYLE.fontSize).toBe(9)
    // above the canvas (z-11) / HUD overlay (z-12) / join veil (z-30); below toasts (z-50) and the mobile
    // burger/drawer chrome (z-90 / z-180) — see GameWorldHost.tsx frame zIndex + mobile-hud.css.
    expect(Number(VERSION_BADGE_STYLE.zIndex)).toBeGreaterThan(30)
    expect(Number(VERSION_BADGE_STYLE.zIndex)).toBeLessThan(90)
    // MobileHud.jsx's `.mobile-hud-actions--fight` burger sits top:max(6px,--safe-top), 44px tall + 6px gap.
    expect(String(VERSION_BADGE_STYLE.top)).toContain('50px')
    expect(String(VERSION_BADGE_STYLE.top)).toContain('--safe-top')
    expect(String(VERSION_BADGE_STYLE.right)).toContain('--safe-right')
  })

  test('overlay is MOBILE-ONLY: hidden by default, revealed exactly under the mobile_mode signals', () => {
    // OWNER (07-18): "I should not see that on desktop, the version over canvas is only for mobile, on
    // desktop it's the sidebar." The badge ships its own CSS gate: display:none base, then @media reveal
    // blocks composed from mobile_mode.js's OWN query strings — so for every (coarse, narrow, phone_short)
    // combination, CSS visibility must equal is_mobile()'s pure law. Evaluated here as a full truth table.
    const markup = renderToStaticMarkup(<VersionBadge version="9.9.9" />)
    expect(markup).toContain(VERSION_BADGE_RULES)
    expect(VERSION_BADGE_RULES.startsWith('[data-version-badge]{display:none}')).toBe(true)
    const reveal_blocks = [
      ...VERSION_BADGE_RULES.matchAll(/@media ([^{]+)\{\[data-version-badge\]\{display:block\}\}/g),
    ].map((m) => m[1].trim())
    expect(reveal_blocks.length).toBeGreaterThan(0)
    for (const coarse of [false, true])
      for (const narrow of [false, true])
        for (const phone_short of [false, true]) {
          const active = { [COARSE]: coarse, [NARROW]: narrow, [PHONE_SHORT]: phone_short }
          const css_shows = reveal_blocks.some((block) =>
            block.split(' and ').every((query) => active[query.trim()] === true)
          )
          expect({ coarse, narrow, phone_short, css_shows }).toEqual({
            coarse,
            narrow,
            phone_short,
            css_shows: mobile_signals_are_active(coarse, narrow, phone_short),
          })
        }
  })

  test('desktop yields to the sidebar: badge self-hides while the sidebar renders its own bottom-CENTER tag', () => {
    // OWNER (07-17, live desktop QA): "on desktop, put the version bottom center of the sidebar." The fixed
    // badge ships the :has() suppression rule itself (one home for its visibility logic), declared LAST and
    // with higher specificity than the @media reveals — a mounted sidebar wins even on a touch-laptop
    // viewport where the mobile signals match.
    const markup = renderToStaticMarkup(<VersionBadge version="9.9.9" />)
    expect(VERSION_BADGE_SIDEBAR_RULE).toBe('body:has([data-app-sidebar]) [data-version-badge]{display:none}')
    expect(markup).toContain(VERSION_BADGE_SIDEBAR_RULE)
    expect(VERSION_BADGE_RULES.endsWith(VERSION_BADGE_SIDEBAR_RULE)).toBe(true)
    const sidebar = read_fixture('./components/sidebar.tsx')
    expect(sidebar).toContain('data-app-sidebar=""')
    // D260 (2026-07-17): the version tag's own element (nested inside the mt-auto bottom-of-navbar group,
    // which also holds the world-camera hints) is bottom-pinned AND horizontally centered.
    expect(sidebar).toContain('<div className="mt-auto">')
    const tag_classes = sidebar.match(/className="[^"]*text-center[^"]*"\s*>\s*v\{__APP_VERSION__\}/)?.[0] ?? ''
    expect(tag_classes).toContain('text-center')
    expect(sidebar).toContain('v{__APP_VERSION__}')
    // Bug fix (v1.12.37 report): the tag renders in the house GOLD accent, mirroring version_badge.tsx's
    // own "muted gold" treatment — it must never regress back to the plain muted-grey label color.
    expect(tag_classes).toContain('text-gold')
    expect(tag_classes).not.toContain('text-muted')
  })

  test('mounted exactly once, unconditionally, outside the router/error-boundary — survives every route and crash', () => {
    const app = read_fixture('./app.tsx')
    const app_fn = app.match(/export function App\(\)[\s\S]*?\n\}/)?.[0] ?? ''
    expect(app).toContain("import { VersionBadge } from './version_badge'")
    expect(app_fn).toContain('<VersionBadge version={__APP_VERSION__} />')
    // Must be a SIBLING of <BrowserRouter>, not a descendant — otherwise a router/AppBody crash hides it too.
    expect(app_fn.indexOf('<VersionBadge')).toBeGreaterThan(-1)
    expect(app_fn.indexOf('<VersionBadge')).toBeLessThan(app_fn.indexOf('<BrowserRouter>'))
  })
})

// #237: the app toast layer overlays the minimap corner without inheriting the minimap's flush-to-viewport rule.
// Position and card styling live in toast.ts so the contract stays testable without app.tsx's Vite graph.
describe('toast minimap overlay', () => {
  test('is inset from the top-right viewport edge while retaining a bounded width', () => {
    expect(TOAST_CONTAINER_CLASS).not.toContain('max-w-none')
    expect(TOAST_CONTAINER_CLASS).toContain('max-w-[min(24rem,calc(100vw-1rem))]')
    expect(TOAST_CONTAINER_CLASS).toContain('absolute')
    expect(TOAST_CONTAINER_CLASS).toContain('top-2')
    expect(TOAST_CONTAINER_CLASS).toContain('right-2')
    expect(TOAST_CONTAINER_CLASS).not.toContain('top-0')
    expect(TOAST_CONTAINER_CLASS).not.toContain('right-0')
    expect(TOAST_CONTAINER_CLASS).not.toContain('fixed')
  })

  test('uses sibling-card padding, translucent near-black glass, a white/10 hairline, blur, and sharp corners', () => {
    expect(toast_glass_class).toContain('p-3')
    expect(toast_glass_class).toContain('bg-black/70')
    expect(toast_glass_class).toContain('backdrop-blur-md')
    expect(toast_glass_class).toContain('border-white/10')
    expect(toast_glass_class).toContain('rounded-none')
  })

  test('app.tsx consumes the shared position and glass homes', () => {
    const app = read_fixture('./app.tsx')
    expect(app).toContain("import { use_toast, TOAST_CONTAINER_CLASS, toast_glass_class } from './toast'")
    expect(app).toContain('<div className={TOAST_CONTAINER_CLASS}>')
    expect(app).toContain('className={`${toast_glass_class}')
  })
})
