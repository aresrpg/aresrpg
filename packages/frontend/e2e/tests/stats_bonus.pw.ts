// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 667, height: 375 },
]) {
  test(`stats separate gear from base and staged allocation at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/e2e/fixtures/stats_bonus.html')
    const strength = page.locator('[data-stat="strength"] .aui-attribute-value')
    await expect(strength).toHaveText('100 (+857)')
    await expect(page.locator('[data-stat="wisdom"] .aui-attribute-value')).toHaveText('30 (-8)')
    await expect(page.locator('[data-stat="agility"] .aui-attribute-value')).toHaveText('0')
    await page.getByRole('button', { name: 'Add a point to Strength', exact: true }).click()
    await expect(strength).toHaveText('101 (+857)')
    await expect(page.locator('[data-stat="strength"] .aui-attribute-title')).toContainText('2 pts')
    const overflow = await page.locator('.aui-attribute-row').evaluateAll((rows) =>
      rows
        .filter((row) => row.scrollWidth > row.clientWidth || row.scrollHeight > row.clientHeight)
        .map((row) => ({
          stat: row.getAttribute('data-stat'),
          width: row.clientWidth,
          scroll_width: row.scrollWidth,
          height: row.clientHeight,
          scroll_height: row.scrollHeight,
          columns: getComputedStyle(row).gridTemplateColumns,
          values: getComputedStyle(row.querySelector('.aui-attribute-value')!).gridTemplateColumns,
        }))
    )
    expect(overflow).toEqual([])
    const groups =
      viewport.width > 700
        ? [['vitality', 'wisdom', 'strength', 'intelligence', 'chance', 'agility']]
        : [
            ['vitality', 'wisdom', 'strength'],
            ['intelligence', 'chance', 'agility'],
          ]
    for (const stats of groups) {
      const edges = await page.evaluate(
        (names) =>
          names.map((stat) => {
            const value = document.querySelector(`[data-stat="${stat}"] .aui-attribute-value`)!
            const range = document.createRange()
            range.selectNodeContents(value.firstChild!)
            return range.getBoundingClientRect().right
          }),
        stats
      )
      expect(Math.max(...edges) - Math.min(...edges)).toBeLessThanOrEqual(1)
    }
    await page.screenshot({ path: `test-results/stats-bonus-${viewport.width}.png` })
  })
}
