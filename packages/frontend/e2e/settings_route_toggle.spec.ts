import { writeFileSync, mkdirSync } from 'node:fs'

import { test, expect, type Page } from '@playwright/test'

// SETTINGS ROUTE + TOGGLE PERSISTENCE proof (sponsor-first lane, design ruling 2026-07-11). Drives the REAL app with the
// dev-key native wallet (no Google/Enoki popup) and proves the settings wiring end-to-end:
//   1. the Settings entry renders in the SIDEBAR nav (NAV_ITEMS + i18n label wired),
//   2. clicking it routes to /settings and mounts the built SettingsPage (app.tsx route wired),
//   3. the sponsored-gameplay toggle defaults ON (opt-out) and flips OFF → localStorage '0',
//   4. the OFF state SURVIVES a full reload (persistence — the tx choke reads this synchronously).
// Any `[tx] route:` console line seen during the run is captured (the sponsor-first / self-pay trace).

const SNAP_DIR = process.env.SNAP_DIR ?? '/tmp/settings_proof'
mkdirSync(SNAP_DIR, { recursive: true })
// WebGL shell — screenshots can be slow; never let a snap flake the proof.
const snap = async (page: Page, name: string) =>
  writeFileSync(`${SNAP_DIR}/${name}.png`, await page.screenshot({ timeout: 60_000, animations: 'disabled' }))

const DEV_KEY = process.env.VITE_DEV_KEY ?? ''
const PREF_KEY = 'aresrpg.sponsored_gameplay_enabled'
const read_pref = (page: Page) => page.evaluate((k) => window.localStorage.getItem(k), PREF_KEY)

test('settings reachable via sidebar; sponsored-gameplay toggle flips + persists across reload', async ({ page }) => {
  test.setTimeout(300_000)
  expect(DEV_KEY, 'VITE_DEV_KEY must be set for the authenticated proof').not.toBe('')

  const routes: string[] = []
  page.on('console', (m) => {
    const t = m.text()
    if (t.includes('[tx] route:')) routes.push(t)
  })

  await page.addInitScript((k: string) => {
    ;(window as unknown as { __ARES_DEV_KEY?: string }).__ARES_DEV_KEY = k
  }, DEV_KEY)
  await page.goto('/?dev', { waitUntil: 'domcontentloaded' })

  // (1) authenticated shell renders → the Settings sidebar entry proves the NAV_ITEMS + i18n wiring
  const nav_settings = page.locator('.nav-item', { hasText: 'Settings' })
  await expect(nav_settings, 'Settings appears in the sidebar nav').toBeVisible({ timeout: 120_000 })
  await snap(page, '1_sidebar_settings')

  // (2) click it → the /settings route mounts the built SettingsPage
  await nav_settings.click()
  await expect(page, 'clicking the nav item routes to /settings').toHaveURL(/\/settings$/, { timeout: 15_000 })
  const toggle = page.locator('button[role="switch"]')
  await expect(toggle, 'the sponsored-gameplay toggle renders').toBeVisible({ timeout: 15_000 })
  await snap(page, '2_settings_page')

  // (3) default ON (opt-out), then flip OFF → aria + localStorage
  await expect(toggle, 'default is ON (sponsored gameplay opt-out)').toHaveAttribute('aria-checked', 'true')
  await toggle.click()
  await expect(toggle, 'flips OFF').toHaveAttribute('aria-checked', 'false')
  expect(await read_pref(page), 'pref persisted to localStorage as 0').toBe('0')
  await snap(page, '3_toggled_off')

  // (4) reload → OFF survives (dev-login sticky via sessionStorage; pref via localStorage)
  await page.reload({ waitUntil: 'domcontentloaded' })
  const toggle2 = page.locator('button[role="switch"]')
  await expect(toggle2, 'toggle present after reload').toBeVisible({ timeout: 120_000 })
  await expect(toggle2, 'OFF state survived the reload').toHaveAttribute('aria-checked', 'false')
  expect(await read_pref(page), 'localStorage still 0 after reload').toBe('0')
  await snap(page, '4_persisted_after_reload')

  // restore the default so the shared dev wallet keeps today's behavior
  await toggle2.click()
  await expect(toggle2).toHaveAttribute('aria-checked', 'true')
  expect(await read_pref(page)).toBe('1')

  console.log('[proof] snapshots:', SNAP_DIR)
  console.log('[proof] [tx] route traces seen during run:', JSON.stringify(routes))
})
