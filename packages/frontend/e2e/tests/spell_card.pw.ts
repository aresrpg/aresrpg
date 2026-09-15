// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

for (const locale of ['en', 'fr']) {
  test(`spell cards retain inline critical badges without duplicate effects in ${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 })
    await page.goto(`/e2e/fixtures/spell_card.html?locale=${locale}`)
    const effects = page.locator('[data-spell-effects]')
    const rows = effects.locator('[data-spell-effect-row]')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('9')
    await expect(rows.nth(0).locator('[data-spell-critical-badge]')).toHaveCount(0)
    await expect(rows.nth(1).locator('[data-spell-critical-badge]')).toHaveText(
      locale === 'fr' ? 'Critique uniquement' : 'Critical only'
    )
    await expect(effects.locator('.fxl')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('spell-card.png'), animations: 'disabled' })
  })
}
