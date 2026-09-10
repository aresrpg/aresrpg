// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('fight rows show access and refuse external groups without a duplicate selector', async ({ page }) => {
  await page.goto('/e2e/fixtures/dungeon_lobby.html')
  await expect(page.getByRole('button', { name: 'Public', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Group only', exact: true })).toHaveCount(0)
  for (const [name, access, joinable] of [
    ['Public players', 'Public', true],
    ['Our party', 'Group only', true],
    ['External party', 'Group only', false],
  ] as const) {
    const row = page.locator('article').filter({ hasText: name })
    await expect(row).toContainText(access)
    if (joinable) await expect(row.getByRole('button')).toBeEnabled()
    else await expect(row.getByRole('button')).toBeDisabled()
  }
  await page.screenshot({ path: 'test-results/dungeon-lobby-access.png' })
})

for (const [query, group, expected] of [
  ['', false, 0],
  ['', true, 1],
  ['?solo', true, 0],
] as const) {
  test(`dungeon creation uses navbar access: ${query || 'party'}, ${group ? 'group' : 'public'}`, async ({ page }) => {
    await page.goto(`/e2e/fixtures/dungeon_lobby.html${query}`)
    if (group) await page.getByRole('button', { name: 'Set navbar group preference' }).click()
    await page.getByRole('button', { name: 'Start new fight', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.dungeon_starts)).toEqual([expected])
  })
}
