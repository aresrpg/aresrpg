// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'
import { parse } from 'yaml'

test('crush rune details stay above the native result dialog', async ({ page }) => {
  await page.goto('/e2e/fixtures/inventory.html?view=crush')
  const dialog = page.getByRole('dialog', { name: 'Crush result', exact: true })
  await dialog.locator('.chr-cell').hover()
  const tooltip = dialog.locator('.item-snapshot-tooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toContainText('Rune Ba Vi')
  await expect(tooltip.locator('[data-rune-effect]')).toContainText('+3')
  await expect
    .poll(() =>
      tooltip.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return element.contains(
          document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
        )
      })
    )
    .toBe(true)
  await page.screenshot({ path: 'test-results/crush-rune-tooltip.png' })
})

test('the selected forge rune displays its effect and stack quantity', async ({ page }) => {
  await page.goto('/e2e/fixtures/inventory.html?view=forge')
  await page.getByRole('button', { name: /^Runes/ }).click()
  await page.getByTitle('Rune Ba Vi', { exact: true }).click()
  const slot = page.locator('.chr-forge__slot.is-filled')
  await expect(slot).toContainText('+3 Vitality')
  await expect(slot).toContainText('×2')
  await page.screenshot({ path: 'test-results/forge-rune-effect.png' })
})

test('forge rune effects use the current stat translation in all six locales', async ({ page }) => {
  for (const locale of ['en', 'fr', 'de', 'es', 'ja', 'uk']) {
    const copy = parse(await readFile(new URL(`../../src/i18n/locales/${locale}.yaml`, import.meta.url), 'utf8'))
    await page.goto(`/e2e/fixtures/inventory.html?view=forge&locale=${locale}`)
    await page
      .locator('.chr-forge__panel')
      .last()
      .getByRole('button', { name: new RegExp(`^${copy.characters_page.tab_runes}`) })
      .click()
    await page.getByTitle('Rune Ba Vi', { exact: true }).click()
    await expect(page.locator('.chr-forge__slot [data-rune-effect]')).toHaveText(
      `+3 ${copy.simulator_page.stat_vitality}`
    )
  }
})
