// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

import { LOCALES } from '../../src/i18n/locale.ts'
import { open_responsive_preview } from '../support/responsive_preview.ts'

for (const [locale, settings] of [
  ['zh', '设置'],
  ['ru', 'Настройки'],
  ['vi', 'Cài đặt'],
  ['ko', '설정'],
  ['pt', 'Configurações'],
]) {
  test(`${locale} loads its translated settings and shared world chat`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await open_responsive_preview(page, `/e2e/fixtures/responsive_preview.html?page=settings&locale=${locale}`)
    await expect(page.locator('[data-app-sidebar]')).toContainText(settings!)
    await expect(page.locator('html')).toHaveAttribute('lang', locale!)
    await open_responsive_preview(page, `/e2e/fixtures/responsive_preview.html?page=world&locale=${locale}`)
    await expect(page.locator('.chat__resize')).toBeVisible()
    await expect(page.locator('.chat__resize')).not.toHaveAttribute('aria-label', 'Resize chat')
    expect(errors).toEqual([])
  })
}

for (const { code } of LOCALES) {
  test(`${code} gathering columns contain translated headers at every layout width`, async ({ page }) => {
    for (const width of [1920, 1280, 640]) {
      await page.setViewportSize({ width, height: 900 })
      await open_responsive_preview(page, `/e2e/fixtures/responsive_preview.html?page=jobs&locale=${code}`)
      const header = page.locator('.jobs__table-head')
      await expect(header).toBeVisible()
      await expect(async () => {
        const overflow = await header.evaluate((element) => {
          const cells = Array.from(element.children)
          return cells.flatMap((cell, index) => {
            const box = cell.getBoundingClientRect()
            const next = cells[index + 1]?.getBoundingClientRect()
            const range = document.createRange()
            range.selectNodeContents(cell)
            const text = range.getBoundingClientRect()
            return text.left < box.left - 1 || text.right > box.right + 1 || (next && box.right > next.left + 1)
              ? [cell.textContent]
              : []
          })
        })
        expect(overflow, `${code} at ${width}px`).toEqual([])
      }).toPass()
      if (code === 'pt')
        await page.locator('.jobs__table').screenshot({ path: `test-results/portuguese-gathering-${width}.png` })
    }
  })
}
