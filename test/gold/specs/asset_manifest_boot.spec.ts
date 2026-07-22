// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test, type Route } from '@playwright/test'

const GOLD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FRONTEND = path.resolve(GOLD, '..', '..', 'packages', 'frontend')
const MANIFEST = JSON.parse(fs.readFileSync(path.join(FRONTEND, 'public', 'asset_manifest.json'), 'utf8'))
const SEED_MANIFEST = JSON.parse(
  fs.readFileSync(path.resolve(FRONTEND, '..', 'move', 'scripts', 'out', 'seed_manifest.json'), 'utf8')
)
const MOB_ID = SEED_MANIFEST.mobs.alley_bunny.id
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

test('IMAGE MANIFEST BOOT · routes do not mount until image resolution is configured', async ({ page }) => {
  let held_manifest: Route | null = null
  let signal_manifest: (() => void) | null = null
  const manifest_requested = new Promise<void>((resolve) => {
    signal_manifest = resolve
  })

  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/asset_manifest.json') {
      held_manifest = route
      signal_manifest?.()
      return
    }
    if (url.pathname.startsWith('/v1/')) {
      const body =
        url.pathname === '/v1/encyclopedia'
          ? {
              items: [],
              mobs: [
                {
                  template_id: MOB_ID,
                  name: 'Alley Bunny',
                  min_level: 1,
                  max_level: 2,
                  base_hp: 12,
                  element: 3,
                  drops: [],
                },
              ],
              worlds: [],
              recipes: [],
            }
          : url.pathname === '/v1/rare-links'
            ? { rare_links: [] }
            : url.pathname === '/v1/characters'
              ? { characters: [] }
              : {}
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    }
    if (request.resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue()
    return route.abort()
  })

  const navigation = page.goto('/encyclopedia/bestiary', { waitUntil: 'domcontentloaded' })
  await manifest_requested
  await page.waitForTimeout(100)
  await expect(page.locator('#root')).toBeEmpty()

  await held_manifest!.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(MANIFEST),
  })
  await navigation
  await page.evaluate(async () => {
    const { use_auth } = await import('/src/auth/index.ts')
    use_auth.setState({
      address: `0x${'1'.repeat(64)}`,
      is_loading: false,
      sui_balance_mist: 1_000_000_000n,
      refresh_sui_balance: async () => {},
    })
  })

  const mob_image = page.locator(`img[src*="/${MANIFEST.classes.mob_icon.quilt}/hy_bunny.png"]`)
  await expect(mob_image).toBeVisible()
  await expect.poll(() => mob_image.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
})
