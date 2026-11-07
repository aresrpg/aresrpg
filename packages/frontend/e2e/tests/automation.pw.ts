// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

for (const mobile of [false, true]) {
  test(`completed quests leave only Connect Your Agent, without manual automation (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 844, height: 390 })
    await page.goto(`/e2e/fixtures/ui_world_hud.html?hud-layout${mobile ? '&mobile' : ''}`)
    await expect(page.locator('[data-agent-setup-button]')).toBeVisible()
    await expect(page.locator('[data-automation-panel]')).toHaveCount(0)
    await expect(page.locator('.journey-tracker')).toHaveCount(0)
    await page.locator('[data-agent-setup-button]').click()
    await expect(page.locator('[data-agent-setup]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-automation-panel]')).toHaveCount(0)
  })
}
