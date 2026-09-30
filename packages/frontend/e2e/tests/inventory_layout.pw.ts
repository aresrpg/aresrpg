// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('a full resource inventory preserves square cells and scrolls to the last row', async ({ page }) => {
  await page.goto('/e2e/fixtures/inventory.html?crowded')
  await page.locator('.chr-bagtab').nth(2).click()
  const grid = page.locator('.chr-equip__grid')
  const cells = grid.locator('button')
  expect(await cells.count()).toBeGreaterThan(60)
  const layout = await cells.evaluateAll((elements) => {
    const boxes = elements.map((element) => element.getBoundingClientRect())
    return boxes.every((box, index) => {
      const previous = boxes.slice(0, index).findLast((other) => Math.abs(other.x - box.x) < 1)
      return box.width >= 44 && Math.abs(box.width - box.height) < 1 && (!previous || box.top >= previous.bottom)
    })
  })
  expect(layout).toBe(true)
  await expect.poll(() => grid.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await cells.last().scrollIntoViewIfNeeded()
  await expect(cells.last()).toBeInViewport()
  expect(await grid.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
})
