// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('Enter starts the first demo and does not bypass returning-player sign-in', async ({ page }) => {
  await page.route('**/play-demo', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<main>Demo destination</main>' })
  )
  await page.goto('/e2e/fixtures/main_menu.html')
  await expect(page.getByRole('link', { name: /Press Enter|Tap to start/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/play-demo$/)
  await page.evaluate(() => localStorage.setItem('aresrpg.demo.played', '1'))
  await page.goto('/e2e/fixtures/main_menu.html')
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/main_menu\.html$/)
})
