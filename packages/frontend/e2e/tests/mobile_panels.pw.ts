// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test.use({ hasTouch: true, isMobile: true, viewport: { width: 667, height: 300 } })

test('stats keep numbers and allocation controls separate in a short mobile window', async ({ page }, info) => {
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Stats', exact: true }).click()
  const rows = page.locator('.aui-attribute-row')
  await expect(rows).toHaveCount(6)
  await page.screenshot({ path: info.outputPath('stats.png') })
  const overlap = await rows.evaluateAll((rows) =>
    rows.map((row) => {
      const value = row.querySelector('.aui-attribute-value')!.getBoundingClientRect()
      const actions = row.querySelector('.aui-attribute-actions')!.getBoundingClientRect()
      const bounds = row.getBoundingClientRect()
      return {
        overlap: value.bottom - actions.top,
        overflow: Math.max(value.right - bounds.right, value.bottom - bounds.bottom),
      }
    })
  )
  expect(overlap.every(({ overlap, overflow }) => overlap <= 1 && overflow <= 1)).toBe(true)
  await rows.last().scrollIntoViewIfNeeded()
  const add = rows.last().getByRole('button').last()
  await expect(add).toBeInViewport()
})

test('a long Dropped by list scrolls inside its item window and reaches its last source', async ({ page }, info) => {
  await page.goto('/e2e/fixtures/item_inspection.html')
  const window = page.getByRole('dialog', { name: 'Water', exact: true })
  const sheet = window.locator('.item-sheet-container')
  const drops = window.locator('[data-item-drops] .aui-item-source-row')
  await expect(drops).toHaveCount(7)
  await page.screenshot({ path: info.outputPath('drops.png') })
  expect(await sheet.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  const box = (await sheet.boundingBox())!
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + 50, y: box.y + box.height - 12 }],
  })
  for (let step = 1; step <= 6; step++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: box.x + 50, y: box.y + box.height - 12 - ((box.height - 24) * step) / 6 }],
    })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(() => sheet.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await drops.last().scrollIntoViewIfNeeded()
  const bounds = (await sheet.boundingBox())!
  const last = (await drops.last().boundingBox())!
  expect(last.y + last.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1)
  await expect(window.getByRole('button', { name: 'Close', exact: true })).toBeInViewport()
})
