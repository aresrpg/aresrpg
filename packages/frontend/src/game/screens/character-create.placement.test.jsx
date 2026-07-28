// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  WorldCharacterCreateSurface,
  world_slot_content,
} from './hud/world/WorldCharacterCreate.jsx'

const read_fixture = (relative_path) => readFileSync(new URL(relative_path, import.meta.url), 'utf8')

const slot = (overrides = {}) =>
  world_slot_content({
    pathname: '/',
    loaded: true,
    load_error: null,
    character_count: 0,
    ...overrides,
  })

describe('confirmed-empty world-slot placement', () => {
  test('no character renders the creator in the world slot; a populated roster leaves the world unchanged', () => {
    expect(slot()).toBe('create')
    expect(renderToStaticMarkup(<WorldCharacterCreateSurface mode={slot()} />)).toContain(
      'data-world-slot="character-create"'
    )

    expect(slot({ character_count: 1 })).toBe('world')
    expect(renderToStaticMarkup(<WorldCharacterCreateSurface mode={slot({ character_count: 1 })} />)).toBe('')
  })

  test('the post-create 0 → 1 roster transition gives the slot straight back to the world', () => {
    const sequence = [0, 1].map((character_count) => slot({ character_count }))
    expect(sequence).toEqual(['create', 'world'])
  })

  test('loading and read errors never masquerade as confirmed-empty creation', () => {
    expect(slot({ loaded: false })).toBe('loading')
    expect(slot({ loaded: false, load_error: new Error('read failed') })).toBe('error')
    const error_html = renderToStaticMarkup(<WorldCharacterCreateSurface mode="error" />)
    expect(error_html).toContain('data-world-slot="roster-error"')
    expect(error_html).not.toContain('data-world-slot="character-create"')
  })

  test('zero characters never redirects or mounts create on marketplace / encyclopedia tabs', () => {
    expect(slot({ pathname: '/marketplace' })).toBe('inactive')
    expect(slot({ pathname: '/encyclopedia/classes' })).toBe('inactive')
    expect(renderToStaticMarkup(<WorldCharacterCreateSurface mode="inactive" />)).toBe('')

    const app = read_fixture('../../app.tsx')
    expect(app).toContain('<Route path="/marketplace" element={<MarketplacePage />} />')
    expect(app).toContain("const EncyclopediaPage = lazy(() =>")
    expect(app).toContain('path="/encyclopedia/*"')
    expect(app).toContain('<EncyclopediaPage />')
  })
})

describe('real host and container wiring', () => {
  test('GameWorldHost mounts create beside the HUD inside the same bounded world frame', () => {
    const host = read_fixture('../../GameWorldHost.tsx')
    expect(host).toContain(`{cpu_enabled ? (
              <Profiler id="game-world-hud" onRender={cpu_profiler_on_render}>
                <GameWorldHud />
              </Profiler>
            ) : (
              <GameWorldHud />
            )}
            <WorldCharacterCreate pathname={location.pathname} />`)
    expect(host).toContain('{active && in_app && (')
  })

  test('only the first-character variant is inline and mobile MENU remains above it', () => {
    const css = read_fixture('./character-create.css')
    const mobile_css = read_fixture('./hud/mobile-hud.css')
    const inline_rule = css.match(/\.cc\.cc--inline\s*\{([^}]*)\}/)?.[1] ?? ''
    const host_rule = css.match(/\.world-character-create\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(inline_rule).toContain('position: absolute')
    expect(inline_rule).toContain('inset: 0')
    expect(inline_rule).not.toContain('position: fixed')
    expect(host_rule).toContain('z-index: 80')
    expect(mobile_css).toMatch(/\.mobile-hud-actions\s*\{[^}]*z-index:\s*90/s)
    expect(css).toMatch(/\.cc__panel\s*\{[^}]*overflow:\s*auto/s)
    expect(css).toContain('calc(72px + var(--safe-top))')
    expect(css).toContain('calc(88px + var(--safe-bottom))')
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*\.cc__body\s*\{\s*flex-direction:\s*column/)
  })

  test('the replaced full-screen first-character hosts and selectors are deleted', () => {
    expect(existsSync(new URL('./hud/world/ExpeditionCreate.jsx', import.meta.url))).toBe(false)
    expect(existsSync(new URL('./hud/world/CharacterMenu.jsx', import.meta.url))).toBe(false)
    const hud = read_fixture('./hud/world/GameWorldHud.jsx')
    const hud_css = read_fixture('./hud/world/game-world-hud.css')
    expect(hud).not.toContain('ExpeditionCreate')
    expect(hud).not.toContain('CharacterMenu')
    expect(hud_css).not.toContain('.gw-charcreate')
    expect(hud_css).not.toContain('.gw-create-host')
  })
})

describe('characters-page create — embedded frame, never the fullscreen overlay sibling', () => {
  test('CreateHost routes the PAGE variant to the inline (bounded) placement, never the default fullscreen overlay', () => {
    // Fixes: the create character page reached from the characters page rendered fullscreen. CreateHost (shared by
    // both the in-world drawer's narrow "new character" AND the wide companion /characters page) called
    // character_create() with no `placement`, silently defaulting to 'overlay' — the SAME full-viewport
    // `position: fixed; inset: 0; z-index: 1000` modal the onboarding flow deliberately does NOT use for its
    // own bounded host (see '.cc.cc--inline' above). The page variant must route to 'inline' like onboarding
    // does; the narrow in-world drawer keeps 'overlay' (no room to embed the 1040px panel there).
    const drawer = read_fixture('./hud/CharactersDrawer.jsx')
    expect(drawer).toContain(
      'function CreateHost({ character_count, claimed_free, price_sui, on_close, variant }) {'
    )
    expect(drawer).toContain("placement: variant === 'page' ? 'inline' : 'overlay',")
  })

  test('the create-host CSS carries no dead selector (a leftover ghost of a prior un-merged sibling)', () => {
    const css = read_fixture('./hud/characters-drawer.css')
    expect(css).not.toContain('.chr-create-host .fog')
  })
})

test('zero-character chrome keeps the rendered desktop wallet address and navigation outside the world slot', () => {
  const app = read_fixture('../../app.tsx')
  const sidebar = read_fixture('../../components/sidebar.tsx')
  const wallet = read_fixture('../../components/wallet_bar.tsx')
  const mobile_hud = read_fixture('./hud/MobileHud.jsx')
  expect(app).toContain('<Sidebar />')
  expect(sidebar).toContain('<WalletBar />')
  expect(sidebar).toContain('data-nav={item.id}')
  expect(wallet).toContain('{truncate_address(address)}')
  expect(wallet).toContain('aria-label="Copy address"')
  expect(mobile_hud).toContain('navigate(item.id)')
})

describe('landscape-fit (#740) — short-viewport phones fit with zero scroll', () => {
  test('a dedicated short-height landscape query keeps .cc__body a ROW (the max-width:900 block alone stacks it into a column, which is the bug: a 932px-wide landscape phone never crosses that width threshold, so height is the only reliable signal)', () => {
    const css = read_fixture('./character-create.css')
    const landscape_block = css.match(/@media \(max-height: 500px\) and \(orientation: landscape\) \{([\s\S]*)\n\}\n\n\/\* D212/)?.[1] ?? ''
    expect(landscape_block, 'the short-viewport landscape query exists').not.toBe('')
    expect(landscape_block).toMatch(/\.cc__body\s*\{\s*flex-direction:\s*row/)
    // the inline (confirmed-empty onboarding) host clears the mobile HUD's menu FAB (mobile-hud-actions,
    // z-index 90 — .world-character-create is z-index 80, see the test above) with real top padding, not
    // a guess; the overlay variant (already z-index 1000, above the FAB) keeps the smaller uniform padding.
    expect(landscape_block).toMatch(/\.cc\.cc--inline\s*\{[^}]*padding:\s*calc\(max\(6px, var\(--safe-top\)\) \+ 50px\)/)
  })

  test('the Cancel/Create foot row wraps instead of overflowing horizontally at narrow widths (#740: it ran ~172px past a 390px viewport)', () => {
    const css = read_fixture('./character-create.css')
    const foot_rule = css.match(/\.cc__foot\s*\{([^}]*)\}/)?.[1] ?? ''
    const namebox_rule = css.match(/\.cc__namebox\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(foot_rule).toContain('flex-wrap: wrap')
    expect(namebox_rule).toContain('min-width: 0')
  })
})
