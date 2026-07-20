import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 5188)
const BASE_URL = `http://localhost:${PORT}`
const OUT = resolve(process.cwd(), '../../docs/tmp_lane_N_shots')
const ADDRESS = `0x${'1'.repeat(64)}`
const CHARACTER_ID = `0x${'2'.repeat(64)}`

mkdirSync(OUT, { recursive: true })

const mobile_context = (browser: Browser, width: number, height: number): Promise<BrowserContext> =>
  browser.newContext({
    baseURL: BASE_URL,
    viewport: { width, height },
    screen: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    colorScheme: 'dark',
  })

async function prepare_page(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('ares_language', 'en')
    ;(window as any).__ARES_MOBILE_HUD_CAPTURE = true
    ;(window as any).__ARES_COMPASS_SYNTH = {
      world_id: 'lane-n-world',
      zone_ttl_ms: 300_000,
      zone: { zx: 0, zy: 0, discovered: false },
      zones: [{ zx: 0, zy: 0, discovered: false }],
      spawns: [
        { kind: 'mob', spawn_id: 'mob-a', x: 24, z: 10, size: 3 },
        { kind: 'resource', spawn_id: 'ore-a', x: 8, z: 26, job: 2, tier: 1 },
      ],
    }
  })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === BASE_URL) {
      if (url.pathname.startsWith('/v1/'))
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      return route.continue()
    }
    return route.abort()
  })
}

async function show_spectate_world(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(async () => {
    const { use_auth } = await import('/src/auth/index.ts')
    use_auth.setState({ address: null, is_loading: false })
  })
  await page.waitForTimeout(100)
  await page.evaluate(async () => {
    const { use_spectate_gate } = await import('/src/stores/spectate_gate.ts')
    use_spectate_gate.getState().set_chosen(true)
  })
  await expect(page.locator('canvas.roam-canvas').first()).toBeVisible({ timeout: 90_000 })
}

async function show_mobile_hud(page: Page) {
  await page.evaluate(
    async ({ address }) => {
      const { use_auth } = await import('/src/auth/index.ts')
      use_auth.setState({ address, is_loading: false })
    },
    { address: ADDRESS }
  )
  await expect(page.locator('.gw-hud--mobile')).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(300)
  await page.evaluate(
    async ({ character_id }) => {
      const { context } = await import('/src/game/core/game.js')
      const { publish_world_binding } = await import('/src/world-shell/session_gate.js')
      const { use_prompt_stack } = await import('/src/world-shell/prompt_stack.js')
      const character = {
        id: character_id,
        _type: 'lane_n::character::Character',
        name: 'Astra',
        classe: 'senshi',
        experience: 58_000,
        vitality: 24,
        gear_vitality: 6,
        current_hp: 82,
        hp_updated_ms: Date.now(),
      }
      context.dispatch('action/sui_data', { loaded: true, characters: [character] })
      context.dispatch('action/select_character', character_id)
      publish_world_binding(character_id, null)
      context.dispatch('action/player_pose', { x: 16, y: 72, z: 16, yaw: 0.4, fps: 60 })
      context.dispatch('action/npc_prompt', { npc_id: 'dungeon-master', label: 'Dungeon Master' })
      use_prompt_stack.getState().register_prompt({
        id: 'search',
        key: 'F',
        label: 'SEARCH THE ZONE',
        mobile_label: 'SEARCH THE ZONE',
        priority: 80,
        on_trigger: () => {},
      })
    },
    { character_id: CHARACTER_ID }
  )
  await expect(page.locator('.gw-selfplate')).toContainText('Astra')
  await expect(page.locator('.gw-compass__mobile-zone')).toContainText('Zone 0·0')
  await expect(page.locator('[data-mobile-interact="search"]')).toBeVisible()
  await expect(page.locator('.touch-controls__btn--jump')).toBeVisible()
  await page.waitForTimeout(600)
}

test('Lane N mobile HUD owner proof', async ({ browser }) => {
  const landscape = await mobile_context(browser, 844, 390)
  const landscape_page = await landscape.newPage()
  await prepare_page(landscape_page)
  await show_spectate_world(landscape_page)
  await show_mobile_hud(landscape_page)

  await expect(landscape_page.locator('[data-mobile-orientation-overlay]')).toHaveCount(0)
  await landscape_page.screenshot({ path: resolve(OUT, 'world_hud_idle_844x390@2x.png'), animations: 'disabled' })

  await landscape_page.locator('.mobile-hud-button--menu').click()
  await expect(landscape_page.locator('[data-mobile-drawer="menu"]')).toBeVisible()
  await landscape_page.screenshot({ path: resolve(OUT, 'menu_sheet_open_844x390@2x.png'), animations: 'disabled' })
  await landscape.close()

  const portrait = await mobile_context(browser, 390, 844)
  const portrait_page = await portrait.newPage()
  await prepare_page(portrait_page)
  await portrait_page.goto('/', { waitUntil: 'domcontentloaded' })
  await portrait_page.evaluate(
    async ({ address }) => {
      const { use_auth } = await import('/src/auth/index.ts')
      use_auth.setState({ address, is_loading: false })
    },
    { address: ADDRESS }
  )
  await expect(portrait_page.locator('[data-mobile-orientation-overlay="portrait"]')).toBeVisible({
    timeout: 30_000,
  })
  await portrait_page.screenshot({
    path: resolve(OUT, 'portrait_rotate_overlay_390x844@2x.png'),
    animations: 'disabled',
  })
  await portrait.close()
})
