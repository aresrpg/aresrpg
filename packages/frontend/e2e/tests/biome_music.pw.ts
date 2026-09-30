// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('a selected checkpoint keeps the music subscription stable across renders', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  // The real player runtime mounts BiomeMusic even when music is disabled.
  // This fixture selects a character with a valid world checkpoint before mounting.
  await page.goto('/e2e/fixtures/mobile.html')
  await expect
    .poll(async () => (errors.length ? errors : await page.locator('[data-world-frame] canvas').count()))
    .toBe(1)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.locator('[data-world-frame] canvas')).toBeAttached()
  expect(errors).toEqual([])
})
