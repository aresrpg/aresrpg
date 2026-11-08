// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

for (const width of [390, 1280]) {
  test(`character menu follows its longest label at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/e2e/fixtures/agent_setup.html')
    const tab = page.locator('[data-character-tabs] [data-character-tab]').first()
    const menu = page.getByRole('menu')
    for (const repeat of [0, 1]) {
      if (!(await tab.isVisible())) await page.getByRole('button', { name: 'Characters', exact: true }).click()
      await tab.click({ button: 'right' })
      await expect(menu).toBeVisible()
      const sizes = await menu.evaluate((element) => {
        const style = getComputedStyle(element)
        const labels = Array.from(element.querySelectorAll('[role="menuitem"]'), (row) => {
          const range = document.createRange()
          range.selectNodeContents(row)
          const row_style = getComputedStyle(row)
          return (
            range.getBoundingClientRect().width + parseFloat(row_style.paddingLeft) + parseFloat(row_style.paddingRight)
          )
        })
        return {
          actual: element.getBoundingClientRect().width,
          expected: Math.max(...labels) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth),
        }
      })
      expect(Math.abs(sizes.actual - sizes.expected)).toBeLessThanOrEqual(1)
      if (repeat === 0) {
        await page.keyboard.press('Escape')
        await expect(menu).toHaveCount(0)
      }
    }
    // The same open menu must stay usable when its viewport shrinks below its natural height.
    await page.setViewportSize({ width: 320, height: 160 })
    await expect
      .poll(async () => {
        const bounds = await menu.boundingBox()
        return (
          !!bounds &&
          bounds.x >= 8 &&
          bounds.y >= 8 &&
          bounds.x + bounds.width <= 312 &&
          bounds.y + bounds.height <= 152
        )
      })
      .toBe(true)
    const overflow = await menu.evaluate((element) => ({ scroll: element.scrollHeight, visible: element.clientHeight }))
    expect(overflow.scroll).toBeGreaterThan(overflow.visible)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  })
}
