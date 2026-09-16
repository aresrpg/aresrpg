// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('equipped weapon uses its item art over the yellow attack slot; bare hands keep the fallback', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/responsive_preview.html?page=fight&weapon=rootsplitter')
  const slot = page.locator('.preview-fight .fight-hud__spell').first()
  const icon = slot.locator('img[data-item-type="rootsplitter"]')
  await expect(icon).toBeVisible()
  await expect.poll(() => icon.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await expect(icon).toHaveCSS('object-fit', 'contain')
  await expect(icon).toHaveCSS('background-image', /radial-gradient/)
  await expect(slot).toHaveAccessibleName(/Weapon attack/)
  await page.goto('/e2e/fixtures/responsive_preview.html?page=fight')
  await expect(slot.locator('img[data-item-type]')).toHaveCount(0)
  await expect(slot.locator('svg')).toBeVisible()
  await expect(slot).toHaveAccessibleName(/Bare hands/)
})
