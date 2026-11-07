// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import { serve_portrait } from '../../server/portrait.ts'

test('character-tab sharing previews the clicked character without changing selection and can reopen', async ({
  page,
}) => {
  await page.route('**/api/portrait?**', async (route) => {
    const response = await serve_portrait(new Request(route.request().url()))
    await route.fulfill({
      status: response.status,
      contentType: 'image/png',
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await page.goto('/e2e/fixtures/agent_setup.html')
  const tabs = page.locator('[data-character-tabs] [data-character-tab]')
  await expect(tabs).toHaveCount(2)
  const first_source = await tabs.nth(0).locator('img').getAttribute('src')
  const second_source = await tabs.nth(1).locator('img').getAttribute('src')
  expect(second_source).not.toBe(first_source)
  await tabs.nth(1).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Share portrait', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Share portrait', exact: true })
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(tabs.nth(0)).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByRole('img', { name: 'Character portrait' })).toHaveAttribute('src', second_source!)
  await expect(dialog.getByRole('link', { name: 'Download PNG' })).toHaveAttribute('href', second_source!)
  await expect(dialog.getByRole('textbox', { name: 'Copy image link' })).toHaveValue(
    new URL(second_source!, page.url()).href
  )
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await tabs.nth(0).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Share portrait', exact: true }).click()
  await expect(dialog.getByRole('img', { name: 'Character portrait' })).toHaveAttribute('src', first_source!)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})
