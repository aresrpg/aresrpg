// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

import { mobile_signals_are_active } from '../../core/mobile_mode.js'
import { MobileDrawerFrame } from './MobileDrawerFrame.jsx'
import { MobileLayoutBoundary } from './MobileLayoutBoundary.jsx'
import { MobileRotateOverlay } from './MobileOrientationGate.jsx'
import {
  fight_layer_class,
  mobile_shell_visibility,
  mobile_swipe_dismisses,
  next_mobile_drawer,
  request_mobile_landscape,
  world_hud_class,
} from './mobile_layout.js'

const mobile_layout = await import('./mobile_layout.js')
const bind_mobile_viewport = mobile_layout.bind_mobile_viewport ?? (() => () => {})
const app_mobile_classes =
  mobile_layout.app_mobile_classes ??
  (() => ({
    nav: 'fixed bottom-0 left-0 right-0 flex items-stretch overflow-x-auto',
    nav_item: 'flex-none w-[76px] min-h-14 flex flex-col items-center justify-center gap-1 py-2',
    nav_label: 'text-xs tracking-[0.08em] uppercase truncate max-w-full px-1',
    page_header: 'flex flex-col items-center px-4 pt-3 pb-1',
    page_tabs: 'px-6 py-3',
    stack: 'flex flex-1 min-h-0 overflow-hidden',
  }))
const long_press_drift_exceeded =
  mobile_layout.long_press_drift_exceeded ??
  (() => {
    throw new Error('long_press_drift_exceeded not implemented (MOBFIX defect #4)')
  })

const { NAV_ITEMS, visible_nav_items } = await import('../../../constants/navigation.ts')

const read_fixture = (relative_path) => readFileSync(new URL(relative_path, import.meta.url), 'utf8')

describe('mobile HUD drawer state', () => {
  test('only one drawer is named at a time and tapping the active launcher closes it', () => {
    expect(next_mobile_drawer(null, 'chat')).toBe('chat')
    expect(next_mobile_drawer('chat', 'friends')).toBe('friends')
    expect(next_mobile_drawer('friends', 'friends')).toBeNull()
  })

  test('a deliberate downward swipe dismisses while short or upward motion does not', () => {
    expect(mobile_swipe_dismisses(100, 148)).toBe(true)
    expect(mobile_swipe_dismisses(100, 147)).toBe(false)
    expect(mobile_swipe_dismisses(148, 100)).toBe(false)
    expect(mobile_swipe_dismisses(null, 100)).toBe(false)
  })

  test('the sheet fixture exposes dialog state and deliberate touch targets', () => {
    const html = renderToStaticMarkup(
      <MobileDrawerFrame
        drawer="chat"
        title="Chat"
        close_label="Close"
        back_label="Back"
        on_close={() => {}}
        on_back={() => {}}
      >
        content
      </MobileDrawerFrame>
    )
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('data-mobile-drawer="chat"')
    const css = read_fixture('./mobile-hud.css')
    expect(css).toMatch(/\.mobile-hud-drawer__handle\s*\{[\s\S]*?min-height:\s*24px/)
    expect(css).toMatch(/\.mobile-hud-drawer__back,[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px/)
  })
})

describe('mobile landscape entry', () => {
  test('a phone stays mobile when landscape width exceeds the portrait bound', () => {
    expect(mobile_signals_are_active(true, true, false)).toBe(true)
    expect(mobile_signals_are_active(true, false, true)).toBe(true)
    expect(mobile_signals_are_active(true, false, false)).toBe(false)
    expect(mobile_signals_are_active(false, true, true)).toBe(false)
  })

  test('requests fullscreen before locking landscape', async () => {
    const calls = []
    const document_ref = {
      fullscreenElement: null,
      documentElement: {
        requestFullscreen: async (options) => calls.push(`fullscreen:${options.navigationUI}`),
      },
    }
    const screen_ref = { orientation: { lock: async (mode) => calls.push(`lock:${mode}`) } }

    expect(await request_mobile_landscape(document_ref, screen_ref)).toEqual({ fullscreen: true, locked: true })
    expect(calls).toEqual(['fullscreen:hide', 'lock:landscape'])
  })

  test('unsupported or rejected APIs leave the fallback available without throwing', async () => {
    const document_ref = {
      fullscreenElement: null,
      documentElement: { requestFullscreen: async () => Promise.reject(new Error('denied')) },
    }
    const screen_ref = { orientation: { lock: async () => Promise.reject(new Error('unsupported')) } }
    expect(await request_mobile_landscape(document_ref, screen_ref)).toEqual({ fullscreen: false, locked: false })
  })

  test('portrait blocker is a labelled modal over the viewport', () => {
    const html = renderToStaticMarkup(<MobileRotateOverlay title="Rotate your device" detail="Use landscape." />)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('tabindex="-1"')
    expect(html).toContain('data-mobile-orientation-overlay="portrait"')
    expect(html).toContain('Rotate your device')
  })
})

describe('shared mobile-mode render branches', () => {
  test('false returns the legacy desktop child and exact legacy class strings', () => {
    const html = renderToStaticMarkup(
      <MobileLayoutBoundary
        mobile={false}
        desktop_view={<div className={world_hud_class(false, true)}>desktop</div>}
        mobile_view={<div className={world_hud_class(true, true)}>mobile</div>}
      />
    )
    expect(html).toBe('<div class="gw-hud gw-hud--fight">desktop</div>')
    expect(fight_layer_class(false)).toBe('hud-root gw-tab gw-fight-layer')
  })

  test('true selects only the mobile child and modifier classes', () => {
    const html = renderToStaticMarkup(
      <MobileLayoutBoundary
        mobile={true}
        desktop_view={<div>desktop</div>}
        mobile_view={<div className={world_hud_class(true, false)}>mobile</div>}
      />
    )
    expect(html).toBe('<div class="gw-hud gw-hud--mobile">mobile</div>')
    expect(fight_layer_class(true)).toBe('hud-root gw-tab gw-fight-layer gw-fight-layer--mobile')
  })

  test('the live game is full-bleed while meta pages float the glass sheet + wallet pod', () => {
    expect(mobile_shell_visibility(true, '/')).toEqual({
      in_game: true,
      show_wallet: false,
    })
    expect(mobile_shell_visibility(true, '/characters')).toEqual({
      in_game: false,
      show_wallet: true,
    })
    expect(mobile_shell_visibility(false, '/characters').show_wallet).toBe(false)
  })

  test('the mobile page switcher is a collapsed handle that reuses the shared nav filter', () => {
    const switcher = read_fixture('../../../components/mobile_switcher.tsx')
    expect(switcher).toContain('data-mobile-switcher-handle')
    expect(switcher).toContain('data-mobile-switcher-stack')
    expect(switcher).toContain('visible_nav_items(NAV_ITEMS, { mobile: true })')
    // Icon-only tiles (a compact cluster, not labeled pills); each still carries the
    // destination's translated name as its accessible label + hover title — never sr-only.
    expect(switcher).toContain('t(item.label)')
    expect(switcher).toContain('aria-label={label}')
    expect(switcher).toContain('title={label}')
  })

  test('mobile page chrome exposes compact header and scrollable tab classes', () => {
    const classes = app_mobile_classes(true)
    expect(classes.page_header).toContain('app-page-header--compact')
    expect(classes.page_tabs).toContain('app-page-tabs--compact')
    expect(classes.page_tabs).toContain('overflow-x-auto')
  })

  test('mobile marketplace uses the shared stacked-content class', () => {
    const classes = app_mobile_classes(true)
    expect(classes.stack).toContain('app-mobile-stack--active')
    expect(classes.stack).toContain('flex-col')
    expect(read_fixture('../../../pages/marketplace.tsx')).toContain('classes.stack')
  })

  test('companion compact styles stay scoped to the shared flag and retire page-local mobile hooks', () => {
    const app = read_fixture('../../../app.tsx')
    const switcher = read_fixture('../../../components/mobile_switcher.tsx')
    const marketplace = read_fixture('../../../components/marketplace/browse_panel.tsx')
    const encyclopedia = read_fixture('../../../pages/encyclopedia/index.tsx')
    const css = read_fixture('../../../mobile_app_shell.css')

    expect(app).toContain('app_mobile_classes(mobile)')
    expect(app).toContain('<MobileSwitcher />')
    expect(switcher).toContain('data-mobile-switcher-handle')
    expect(`${marketplace}\n${encyclopedia}`).toContain('use_mobile_mode()')
    expect(`${marketplace}\n${encyclopedia}`).not.toContain('use_is_mobile')
    expect(css).toContain('.mobile-glass-sheet')
    expect(css).toContain('.mobile-switcher-handle')
    // The expanded switcher is a COMPACT 2-column cluster (only as tall as its items), never
    // the full-height scrolling column of labeled pills.
    expect(css).toContain('grid-template-columns: repeat(2, 44px)')
    expect(css).not.toContain('max-height: calc(100dvh')
    expect(css).toContain('.app-mobile-stack--active')
    expect(css).toContain('.app-mobile-chip-row--active')
    expect(css).not.toMatch(/@media\s*\(/)
  })

  test('the characters roster row is lean — design ruling 2026-07-18: avatar + name + level/class, no HP/AP/MP chips', () => {
    const drawer = read_fixture('./CharactersDrawer.jsx')
    const drawer_css = read_fixture('./characters-drawer.css')
    // The HP/AP/MP vitals chips (and their now-dead SDK computation) are GONE from the roster — that data
    // lives in the STATS detail tab, its single home. They took half the 390px landscape screen.
    expect(drawer).not.toContain('chrd-chip')
    expect(drawer).not.toContain('chrx-row__vitals')
    expect(drawer).not.toContain('get_total_stat')
    expect(drawer_css).not.toContain('.chrx-row__vitals')
    expect(drawer_css).not.toContain('.chrd-chip')
    // The mobile characters page flattens the equipment card-in-card and shrinks the bag cells for 390px.
    expect(drawer_css).toContain('repeat(auto-fill, 42px)')
    expect(drawer_css).toMatch(/\.chrd-body--equipment\s*\{\s*border:\s*0/)
  })
})

// MOBFIX defect #1 (BLOCKER, full-app mobile audit): 390px portrait rendered all 11 nav items at the
// desktop-derived 48px column width (11*48=528px) — airdrop/kolizeum/settings clipped off the right
// edge, reachable only by scrolling a bar with zero affordance. leaderboard + simulator are BOTH
// `disabled: true` coming-soon placeholders (T55) on every surface today — hiding them on mobile loses
// no reachability (they were never clickable there either); with the removed profile destination gone,
// the live set drops 10 -> 8, which fits a 390px bar.
describe('mobile switcher — every enabled destination is reachable (MOBFIX defect #1 lineage)', () => {
  test('mobile hides the disabled coming-soon meta-tabs so only reachable destinations take a slot', () => {
    const ids = visible_nav_items(NAV_ITEMS, { mobile: true }).map((i) => i.id)
    expect(ids).not.toContain('leaderboard')
    expect(ids).not.toContain('simulator')
    expect(ids).not.toContain('admin')
    expect(ids).not.toContain('profile')
    expect(ids).toHaveLength(8)
  })

  test('desktop keeps the coming-soon meta-tabs visible — the sidebar shows them disabled-with-tooltip unchanged', () => {
    const ids = visible_nav_items(NAV_ITEMS, { mobile: false }).map((i) => i.id)
    expect(ids).toContain('leaderboard')
    expect(ids).toContain('simulator')
  })

  test('the switcher stack lists exactly the 8 enabled destinations for a player', () => {
    const enabled_count = NAV_ITEMS.filter((i) => !i.disabled).length
    expect(enabled_count).toBe(8)
  })

  test('nit #5 desktop half: the sidebar disabled-tooltip affordance for coming-soon tabs is already shipped', () => {
    const sidebar = read_fixture('../../../components/sidebar.tsx')
    expect(sidebar).toContain("title={t('nav.coming_soon')}")
  })
})

// MOBFIX defect #4 (full-app mobile audit, simulator page): "RIGHT-CLICK TO CLEAR" is meaningless on
// touch. The paperdoll slot gets a long-press-to-clear equivalent; per the drag-click gate law a real
// human's press drifts a few px, so the gesture must tolerate small drift and only cancel on a real drag.
describe('long-press gesture tolerance (MOBFIX defect #4 — touch equivalent for "right-click to clear")', () => {
  test('small drift during a hold stays a long-press; a real drag past the tolerance cancels it', () => {
    expect(long_press_drift_exceeded({ x: 100, y: 100 }, { x: 103, y: 100 })).toBe(false)
    expect(long_press_drift_exceeded({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(false)
    expect(long_press_drift_exceeded({ x: 100, y: 100 }, { x: 100, y: 107 })).toBe(true)
    expect(long_press_drift_exceeded(null, { x: 100, y: 100 })).toBe(false)
  })
})

describe('viewport and mobile-style isolation', () => {
  test('viewport-fit and all four global safe-area variables exist exactly once', () => {
    const html = read_fixture('../../../../index.html')
    const global_css = read_fixture('../../../index.css')
    expect(html.match(/viewport-fit=cover/g)).toHaveLength(1)
    for (const edge of ['top', 'right', 'bottom', 'left']) {
      expect(global_css.match(new RegExp(`--safe-${edge}:\\s*env\\(safe-area-inset-${edge}`, 'g'))).toHaveLength(1)
    }
  })

  // Regression guard (mobile): the fight-end result card overflows the viewport with CONTINUE below the
  // fold, blocking the click. The card must cap to the viewport height budget, scroll internally,
  // and pin CONTINUE as a sticky footer; the party/enemy rows must shrink off their desktop-height rule.
  test('the fight-end result card scrolls within the viewport budget with CONTINUE pinned + compact rows', () => {
    const css = read_fixture('./result.css')
    const card_rule = css.match(/html\.ares-mobile-hud \.result--fe\s*\{([^}]*)\}/)?.[1] ?? ''
    const cta_rule = css.match(/html\.ares-mobile-hud \.result--fe \.cta\s*\{([^}]*)\}/)?.[1] ?? ''
    const row_rule = css.match(/html\.ares-mobile-hud \.fe-row\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(card_rule).toMatch(/max-height:\s*calc\([\s\S]*100dvh[\s\S]*var\(--safe-top\)[\s\S]*var\(--safe-bottom\)/)
    expect(card_rule).toMatch(/overflow-y:\s*auto/)
    expect(cta_rule).toMatch(/position:\s*sticky/)
    expect(cta_rule).toMatch(/bottom:\s*0/)
    // compact: the mobile row grid/padding/glyph must all shrink below the desktop `.fe-row` rule
    // (grid-template-columns: 22px 1fr 88px auto; padding: 8px 12px; .fe-row__glyph: 22x22).
    expect(row_rule).toMatch(/grid-template-columns:\s*\d+px 1fr \d+px auto/)
    const [, glyph_col] = row_rule.match(/grid-template-columns:\s*(\d+)px/) ?? []
    expect(Number(glyph_col)).toBeLessThan(22)
    expect(row_rule).toMatch(/padding:\s*\dpx \dpx/) // single-digit px on both axes < desktop's 8px/12px
  })

  // #208: the app-wide toast layer intentionally shares the minimap's exact flush corner on every viewport.
  // Its bounded width still prevents overflow, while the old mobile safe-area offsets must not move it away
  // from top:0/right:0.
  test('the app-wide toast stack remains an absolute flush minimap overlay on mobile', async () => {
    const { TOAST_CONTAINER_CLASS } = await import('../../../toast')
    const app = read_fixture('../../../app.tsx')
    const toasts_fn = app.match(/function Toasts\(\)[\s\S]*?\n\}/)?.[0] ?? ''

    expect(TOAST_CONTAINER_CLASS).toContain('absolute')
    expect(TOAST_CONTAINER_CLASS).toContain('top-0')
    expect(TOAST_CONTAINER_CLASS).toContain('right-0')
    expect(TOAST_CONTAINER_CLASS).not.toContain('max-lg:top-')
    expect(TOAST_CONTAINER_CLASS).not.toContain('max-lg:right-')
    expect(toasts_fn).toContain('className={TOAST_CONTAINER_CLASS}')
    // text still wraps instead of overflowing the bounded overlay
    expect(toasts_fn).toMatch(/whitespace-pre-wrap break-words/)
  })

  // Regression guard (mobile, v1.12.26 regression): the toast rendered full width — the IN-GAME event-toast
  // surface (GameWorldHud.jsx's local Toasts()/.gw-toast, NOT app.tsx's app-wide Toasts fixed above). The
  // prior lane (MPOLISH) confirmed gw-toast was already safe-area-correct but never capped its WIDTH or
  // wrapped its text: `.gw-toast` is itself a flex ROW (dot + text span) inside `.gw-toasts`' flex COLUMN —
  // without `min-width:0` on both, a long title+message's min-content width overflows past max-width
  // instead of wrapping, reading as "full width" regardless of the max-width value set.
  test('the in-game event toast caps to the safe viewport width, wraps text, and stays centered on mobile', () => {
    const hud_css = read_fixture('./mobile-hud.css')
    const toast_rule = hud_css.match(/\.gw-hud--mobile \.gw-toast\s*\{([^}]*)\}/)?.[1] ?? ''
    const span_rule =
      hud_css.match(/\.gw-hud--mobile \.gw-toast > span:not\(\.gw-toast__dot\)\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(toast_rule).toMatch(/min-width:\s*0/)
    expect(toast_rule).toMatch(
      /max-width:\s*calc\(100vw\s*-\s*max\(6px,\s*var\(--safe-left\)\)\s*-\s*max\(6px,\s*var\(--safe-right\)\)\)/
    )
    expect(toast_rule).toMatch(/overflow-wrap:\s*break-word/)
    expect(toast_rule).toMatch(/word-break:\s*break-word/)
    expect(toast_rule).toMatch(/text-align:\s*center/)
    // the unclassed text span is the OTHER flex item sharing the row with .gw-toast__dot — it also needs
    // min-width:0, or the row's own min-content size still overflows the parent's max-width.
    expect(span_rule).toMatch(/min-width:\s*0/)
  })

  test('layout CSS consumes safe areas without duplicating the mobile media queries', () => {
    const hud_css = read_fixture('./mobile-hud.css')
    const orientation_css = read_fixture('./mobile-orientation.css')
    const fight_css = read_fixture('./mobile-fight-hud.css')
    const css = `${hud_css}\n${orientation_css}\n${fight_css}`
    for (const edge of ['top', 'right', 'bottom', 'left']) expect(css).toContain(`var(--safe-${edge})`)
    expect(css).not.toMatch(/@media\s*\([^)]*(?:max-width|pointer\s*:\s*coarse)/)
    expect(hud_css).not.toMatch(/(?:^|\n)\.(?:gw-selfplate|gw-chat|gw-compass-wrap|mm)(?:\s|\{|\.)/)
    expect(fight_css).not.toMatch(/(?:^|\n)\.(?:hud-|fight-readout)/)
  })

  test('only the mobile install manifest requests fullscreen landscape', () => {
    const vite = read_fixture('../../../../vite.config.ts')
    const html = read_fixture('../../../../index.html')
    const mobile_manifest = JSON.parse(read_fixture('../../../../public/manifest-mobile.webmanifest'))
    expect(vite).toContain("display: 'standalone'")
    expect(vite).not.toContain("orientation: 'landscape'")
    expect(mobile_manifest.display).toBe('fullscreen')
    expect(mobile_manifest.orientation).toBe('landscape')
    expect(html).toContain("mobile_manifest.href = '/manifest-mobile.webmanifest'")
    expect(html).toContain('(pointer: coarse) and (max-height: 600px)')
    expect(read_fixture('./mobile-hud.css')).not.toMatch(/(?:^|\n)\.gw-hud\s/)
  })

  test('app and HUD bindings consume the shared flag instead of a second query hook', () => {
    const app = read_fixture('../../../app.tsx')
    const host = read_fixture('../../../GameWorldHost.tsx')
    const binding = read_fixture('./mobile_layout.js')
    expect(app).toContain('use_mobile_mode()')
    expect(host).toContain('use_mobile_mode()')
    expect(`${app}\n${host}`).not.toContain('use_is_mobile')
    expect(binding).toContain("import { is_mobile, on_mobile_change } from '../../core/mobile_mode.js'")
  })
})

// Regression guard (iPhone 17): the game is letterboxed inside the display's safe
// area — black margins frame it; the canvas stops at the notch / home-indicator insets instead of painting
// under them. ROOT CAUSE: the width fix (BORDER2) switched WIDTH to the layout viewport (innerWidth ==
// 100lvw) but HEIGHT still sized from visualViewport.height, which iOS Safari shrinks by the safe-area insets
// under viewport-fit=cover exactly as it does width — a vertical letterbox the (VERBORDER-proven inert) bleed
// math never reclaimed. FIX (one-home, deletion-first): the canvas is edge-to-edge BY CONSTRUCTION —
// position:fixed + 100lvw x 100dvh under viewport-fit=cover paints under the island natively; the whole
// measure-and-bleed apparatus (bind_mobile_viewport, --game-viewport-*, the [data-game-world-viewport]
// clawback rule) is gone. The HUD chrome keeps its own per-component --safe-* insets so buttons stay clear.
describe('iPhone canvas is edge-to-edge full-bleed (no visualViewport measurement)', () => {
  test('the canvas layer sizes from the layout/dynamic viewport, never the safe-excluded visualViewport', () => {
    const host = read_fixture('../../../GameWorldHost.tsx')
    const viewport_css = read_fixture('../../canvas-viewport.css')
    const binding = read_fixture('./mobile_layout.js')

    // The mobile canvas frame is the full physical viewport under viewport-fit=cover — 100lvw x 100dvh,
    // pinned top-left, with NO per-frame JS-measured override shadowing it.
    expect(host).toContain("width: '100lvw'")
    expect(host).toContain("height: '100dvh'")
    expect(host).not.toContain('--game-viewport-')
    expect(host).not.toContain('bind_mobile_viewport')
    expect(host).not.toContain('data-game-world-viewport')

    // The measure-and-bleed apparatus is DELETED (one-home law): no visualViewport read anywhere, no
    // clawback rule keyed off a data attribute.
    expect(binding).not.toContain('visualViewport')
    expect(binding).not.toContain('bind_mobile_viewport')
    expect(viewport_css).not.toContain('visualViewport')
    expect(viewport_css).not.toContain('data-game-world-viewport')
    expect(viewport_css).not.toContain('mobile-safe-bleed')

    // The dynamic-viewport (URL-bar-aware) height chain remains the page-height source of truth.
    expect(viewport_css).toMatch(/height:\s*100dvh/)
  })

  test('the HUD chrome still respects the safe-area insets while the canvas bleeds under them', () => {
    const fight_css = read_fixture('./mobile-fight-hud.css')
    // The fight chrome pins to max(gap, safe-inset) so READY/FORFEIT + initiative stay clear of the island.
    expect(fight_css).toMatch(/left:\s*max\(8px,\s*var\(--safe-left\)\)/)
    expect(fight_css).toMatch(/right:\s*max\(8px,\s*var\(--safe-right\)\)/)
    expect(fight_css).toMatch(/bottom:\s*max\(8px,\s*var\(--safe-bottom\)\)/)
  })
})

describe('minimal HUD viewport fixtures', () => {
  const clamp = (low, value, high) => Math.min(high, Math.max(low, value))

  test('portrait is blocked instead of laying game chrome into 390px', () => {
    const orientation_css = read_fixture('./mobile-orientation.css')
    expect(orientation_css).toContain('position: fixed')
    expect(orientation_css).toContain('inset: 0')
    expect(orientation_css).not.toContain('rotate(90deg) translate')
  })

  test('844x390 landscape leaves the center and thumb lanes clear', () => {
    const width = 844
    const compass_width = Math.min(width * 0.42, 340)
    const compass_left = (width - compass_width) / 2
    const compass_right = compass_left + compass_width
    const fab_right = 8 + 44
    const minimap_left = width - 6 - clamp(64, width * 0.09, 72)
    const plate_right = width / 2 + Math.min(width * 0.29, 220) / 2
    const prompt_right = width / 2 + (width * 0.42) / 2
    const gameplay_left = width - 8 - 46

    expect(compass_left).toBeGreaterThan(fab_right)
    expect(compass_right).toBeLessThan(minimap_left)
    expect(plate_right).toBeLessThan(gameplay_left)
    expect(prompt_right).toBeLessThan(gameplay_left)
    expect(compass_width).toBeLessThan(width / 2)
  })

  test('mobile nameplate and prompt anchors stay outside the bottom-left joystick zone', () => {
    const width = 844
    const joystick_right = Math.min(width * 0.52, 340)
    const nameplate_anchor = width / 2
    const prompt_anchor = width / 2
    const hud_css = read_fixture('./mobile-hud.css')
    const nameplate_rule = hud_css.match(/\.gw-hud--mobile \.gw-selfplate\s*\{([^}]*)\}/)?.[1] ?? ''
    const prompt_rule = hud_css.match(/\.gw-hud--mobile \.gw-prompt-stack\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(nameplate_anchor).toBeGreaterThan(joystick_right)
    expect(prompt_anchor).toBeGreaterThan(joystick_right)
    expect(nameplate_rule).toMatch(/left:\s*50%/)
    expect(nameplate_rule).toMatch(/transform:\s*translateX\(-50%\)/)
    expect(prompt_rule).toMatch(/left:\s*50%/)
    expect(prompt_rule).toMatch(/transform:\s*translateX\(-50%\)/)
    expect(prompt_rule).toMatch(/align-items:\s*center/)
    expect(hud_css).toMatch(/@keyframes mobile-selfplate-hit[\s\S]*?transform:\s*translateX\(-50%\)/)
  })

  test('the minimal rounded constants and one-FAB contract remain bound to shipped files', () => {
    const hud_css = read_fixture('./mobile-hud.css')
    const hud = read_fixture('./MobileHud.jsx')
    const compass = read_fixture('./world/CompassStrip.jsx')
    expect(hud_css).toContain('--mobile-radius: 14px')
    expect(hud_css).toContain('width: min(42vw, 340px)')
    expect(hud_css).toContain('width: clamp(64px, 9vw, 72px)')
    expect(hud.match(/<MobileMenuFab/g)).toHaveLength(1)
    expect(hud).not.toContain('mobile-hud-launchers')
    expect(hud_css).toContain('.mobile-hud-actions--fight')
    expect(hud_css).toContain('right: max(8px, var(--safe-right))')
    expect(compass).toContain('gw-compass__mobile-zone')
    expect(compass).not.toContain('gw-compass__mobile-pill')
  })
})

describe('mobile fight HUD compaction', () => {
  const fight_css = read_fixture('./mobile-fight-hud.css')
  const css_rule = (selector) =>
    fight_css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''

  test('initiative cards collapse into compact chips and the placement prompt stays on one line', () => {
    const turn = css_rule('.gw-fight-layer--mobile .hud-turn')
    const portrait = css_rule('.gw-fight-layer--mobile .hud-turn__portrait')
    const placement = css_rule('.gw-fight-layer--mobile .hud-placement')

    expect(turn).toMatch(/width:\s*104px/)
    expect(turn).toMatch(/min-width:\s*104px/)
    expect(portrait).toMatch(/width:\s*26px/)
    expect(portrait).toMatch(/height:\s*26px/)
    expect(placement).toMatch(/flex-direction:\s*row/)
    expect(placement).toMatch(/white-space:\s*nowrap/)
  })

  test('spell sockets are a smaller single-row strip and vitals use the same compact scale', () => {
    const sockets = css_rule('.gw-fight-layer--mobile .hud-socketgrid')
    const hp_gem = css_rule('.gw-fight-layer--mobile .hud-gem-bezel')
    const stat_gem = css_rule('.gw-fight-layer--mobile .hud-gem2--stat')

    expect(sockets).toMatch(/--sock:\s*36px/)
    expect(sockets).toMatch(/grid-template-columns:\s*repeat\(10,\s*var\(--sock\)\)/)
    expect(hp_gem).toMatch(/--gsz:\s*44px/)
    expect(stat_gem).toMatch(/--gsz:\s*22px/)
  })

  test('READY and FORFEIT remain inside the 844px safe-right edge', () => {
    const viewport_width = 844
    const safe_right = 8
    const controls_width = 104
    const controls_left = viewport_width - safe_right - controls_width
    const controls_right = controls_left + controls_width
    const bottom = css_rule('.gw-fight-layer--mobile .hud-bottom')
    const button = css_rule('.gw-fight-layer--mobile .hud-fightctl .hud-fightctl__btn')
    const countdown = css_rule('.gw-fight-layer--mobile .hud-fightctl__countdown')

    expect(bottom).toMatch(/width:\s*104px/)
    expect(button).toMatch(/box-sizing:\s*border-box/)
    expect(countdown).toMatch(/max-width:\s*100%/)
    expect(countdown).toMatch(/white-space:\s*normal/)
    expect(controls_right).toBeLessThanOrEqual(viewport_width - safe_right)
  })
})
