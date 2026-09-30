// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

import { LOCALES } from '../../src/i18n/locale.ts'
import { open_responsive_preview } from '../support/responsive_preview.ts'

for (const height of [360]) {
  test(`language window keeps all choices reachable at ${height}px`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height })
    await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=settings')
    const card = page.locator('.aui-settings')
    const trigger = card.locator('.language-trigger')
    const dropdown = page.locator('.aui-language')
    await trigger.scrollIntoViewIfNeeded()
    const before = (await card.boundingBox())!
    await trigger.click()
    await expect(dropdown).toBeVisible()
    expect((await card.boundingBox())!.height).toBe(before.height)
    const box = (await dropdown.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(height)
    for (const { native } of LOCALES) {
      const choice = dropdown.locator('.aui-language-grid button').filter({ hasText: native })
      await choice.scrollIntoViewIfNeeded()
      await expect(choice).toBeInViewport()
    }
    await page.keyboard.press('Escape')
    await expect(dropdown).not.toBeVisible()
    await expect(trigger).toBeFocused()
    await trigger.click()
    await dropdown.getByRole('button', { name: /한국어/ }).click()
    await expect(dropdown).not.toBeVisible()
    await expect(trigger).toContainText('한국어')
    await trigger.click()
    await dropdown.getByRole('button', { name: /Close|닫기/ }).click()
    await expect(dropdown).not.toBeVisible()
  })
}
