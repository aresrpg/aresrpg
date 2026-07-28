// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('shop cosmetic PREVIEW plays and pauses its worn render', async ({ page }) => {
  await page.goto('/shop?dev', { waitUntil: 'domcontentloaded' })

  // Keep this interaction proof keyless and independent of RPC/chain state: inject one real-catalog alias
  // through the same Zustand stores the routed shop page consumes, then let the actual card render it.
  await page.evaluate(async () => {
    const [{ use_items_shop_chain }, { use_auth }] = await Promise.all([
      import('/src/stores/items_shop_chain.ts'),
      import('/src/auth/index.ts'),
    ])
    use_items_shop_chain.setState({
      sales: [
        {
          id: 'preview_sale',
          template_id: 'preview_template',
          price_mist: '1000000000',
          supply: 10,
          minted: 0,
          infinite: false,
          treasury: '0x0',
          template: {
            name: 'Bara Hood',
            item_type: 'bara_hood',
            category: 'HAT',
            display: { name: 'Bara Hood', description: 'preview fixture' },
          },
        },
      ],
      loaded_once: true,
      loading: false,
      load: async () => {},
    })
    use_auth.setState({
      address: `0x${'1'.repeat(64)}`,
      is_loading: false,
      refresh_sui_balance: async () => {},
    })
  })

  const card = page.locator('article.vitrine').filter({ hasText: 'Bara Hood' })
  const preview = card.locator('button.preview-btn')
  const video = card.locator('video.case-video')
  await expect(preview).toBeVisible()
  await expect(preview).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => video.evaluate((node) => (node as HTMLVideoElement).paused)).toBe(true)

  await preview.click()

  await expect(preview).toHaveAttribute('aria-pressed', 'true')
  await expect(preview).toContainText('Playing')
  await expect.poll(() => video.evaluate((node) => (node as HTMLVideoElement).paused)).toBe(false)
  await expect.poll(() => video.evaluate((node) => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1)

  await preview.click()

  await expect(preview).toHaveAttribute('aria-pressed', 'false')
  await expect(preview).toContainText('Preview')
  await expect.poll(() => video.evaluate((node) => (node as HTMLVideoElement).paused)).toBe(true)
})
