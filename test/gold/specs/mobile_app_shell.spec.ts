// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { devices, expect, test, type Page } from '@playwright/test'

const BASE_URL = `http://localhost:${Number(process.env.GOLD_PORT ?? 5490)}`

test.use({
  ...devices['iPhone 13 landscape'],
  viewport: { width: 844, height: 390 },
  screen: { width: 844, height: 390 },
})

async function boot_marketplace(page: Page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === BASE_URL && url.pathname.startsWith('/v1/'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue()
    return route.abort()
  })
  await page.goto('/marketplace', { waitUntil: 'domcontentloaded' })
  await page.evaluate(async () => {
    const [{ use_auth }, { use_marketplace_chain }] = await Promise.all([
      import('/src/auth/index.ts'),
      import('/src/stores/marketplace_chain.ts'),
    ])
    use_marketplace_chain.setState({
      listings: [],
      templates_item: [],
      loading: false,
      loaded_once: true,
      load: async () => {},
    })
    use_auth.setState({
      address: `0x${'1'.repeat(64)}`,
      is_loading: false,
      sui_balance_mist: 1_000_000_000n,
      refresh_sui_balance: async () => {},
    })
  })
}

test('mobile companion shell keeps all nav pages reachable, omits dead profile destination, and stacks Marketplace chrome', async ({
  page,
}) => {
  await boot_marketplace(page)

  // The bottom bar is retired: navigation is a collapsed glass handle that unfolds the
  // section stack as an absolute overlay on tap, and every destination is a REAL labelled tile (the old
  // sr-only icon bar is gone). leaderboard + simulator (T55 coming-soon, disabled everywhere) stay hidden
  // on mobile → 8 reachable destinations, not the full 10-item NAV_ITEMS list.
  const handle = page.locator('[data-mobile-switcher-handle]')
  await expect(handle).toBeVisible()
  await handle.click()
  const switcher_stack = page.locator('[data-mobile-switcher-stack]')
  await expect(switcher_stack).toBeVisible()
  await expect(switcher_stack.locator('[data-nav]')).toHaveCount(8)
  await expect(switcher_stack.locator('[data-nav="profile"]')).toHaveCount(0)
  await expect(switcher_stack.locator('[data-nav="marketplace"]')).toHaveAttribute('aria-current', 'page')
  // an outside tap collapses the stack — it never persists as chrome
  await page.locator('[data-mobile-switcher-scrim]').click()
  await expect(page.locator('[data-mobile-switcher-stack]')).toHaveCount(0)

  const wallet_row = page.locator('[data-mobile-wallet-bar] > div > div').first()
  await expect(wallet_row).toBeVisible()
  await expect(wallet_row).toHaveCSS('flex-wrap', 'nowrap')

  const header = page.locator('[data-mobile-page-header]')
  await expect(header).toHaveClass(/app-page-header--compact/)
  await expect(page.locator('[data-page-subtitle]')).toBeHidden()
  await expect(page.locator('.app-page-status')).toBeHidden()

  const tabs = page.locator('[data-mobile-page-tabs]')
  await expect(tabs).toHaveClass(/app-page-tabs--compact/)
  await expect(tabs).toHaveCSS('overflow-x', 'auto')
  // Device-pixel sub-pixel rounding can report the intended 36px row as 36.5px.
  expect((await tabs.boundingBox())?.height).toBeLessThanOrEqual(37)

  const stack = page.locator('[data-mobile-stack="chips"]')
  await expect(stack).toHaveClass(/app-mobile-stack--active/)
  await expect(stack).toHaveCSS('flex-direction', 'column')

  // Mobile is LANDSCAPE-ONLY: rotating to portrait raises the rotate gate on EVERY route —
  // here the Marketplace meta page, not just the game canvas. This proves the app-wide gate mount (app.tsx
  // AppBody) fires off the world route.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('[data-mobile-orientation-overlay="portrait"]')).toBeVisible()

  // Back in landscape, the dead /profile destination still redirects home (the mastery/profile page is gone).
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/profile', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(`${BASE_URL}/`)
})
