// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

const GOLD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST_PATH = path.join(GOLD, '.gold-deployment.json')
const manifest = fs.existsSync(MANIFEST_PATH) ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) : null

type GoldWallet = { address: string; privkey: string }

async function anchor_boot(page: Page, wallet: GoldWallet) {
  await page.addInitScript(
    (payload: { key: string; ids: any }) => {
      ;(window as any).__ARES_DEV_KEY = payload.key
      ;(window as any).__ARES_LOCALNET_IDS = payload.ids
    },
    { key: wallet.privkey, ids: manifest.ids.aresrpg }
  )
  await page.goto('/characters?dev')
}

test.describe('multi-character accounts — gold localnet', () => {
  test.skip(!manifest, 'no .gold-deployment.json — run `node test/gold/up_gold.mjs` first')

  test('same-wallet roster hot-selects independent character IDs', async ({ page }) => {
    const wallet = manifest.wallets[0] as GoldWallet
    const owned_ids = manifest.characters.filter((row: any) => row.wallet === 0).map((row: any) => row.character_id)
    await anchor_boot(page, wallet)
    await expect
      .poll(() => page.evaluate(() => !!(window as any).__ARES_ENGINE?.get_state().sui?.loaded), { timeout: 45_000 })
      .toBe(true)

    const rows = page.locator('.chsw-row')
    await expect(rows).toHaveCount(2)
    await rows.nth(1).click()
    await expect(rows.nth(1)).toHaveClass(/is-active/)
    const selected = await page.evaluate(() => (window as any).__ARES_ENGINE.get_state().selected_character_id)
    expect(owned_ids).toContain(selected)
  })
})
