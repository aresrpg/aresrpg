// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

for (const activity of ['fight', 'seated', 'gather', 'rooted', 'ambush']) {
  test(`stats and spell edits stay disabled during ${activity}`, async ({ page }) => {
    await page.goto(`/e2e/fixtures/character_progression.html?state=${activity}`)
    await expect(page.getByRole('button', { name: 'Add a point to Strength', exact: true })).toBeDisabled()
    await expect(page.locator('.sb__btn-compact')).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled()
    await expect(page.locator('[data-calls]')).toHaveText('0')
    await page.getByRole('button', { name: 'Become idle' }).click()
    await expect(page.getByRole('button', { name: 'Add a point to Strength', exact: true })).toBeEnabled()
    await expect(page.locator('.sb__btn-compact')).toBeEnabled()
  })
}

test('stats and spells remain editable between dungeon rooms', async ({ page }) => {
  await page.goto('/e2e/fixtures/character_progression.html?state=dungeon')
  await page.getByRole('button', { name: 'Add a point to Strength', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.locator('[data-calls]')).toHaveText('1')
  await page.locator('.sb__btn-compact').click()
  await expect(page.locator('[data-calls]')).toHaveText('2')
})
test('a staged allocation cannot submit after fight entry, but remains editable after returning', async ({ page }) => {
  await page.goto('/e2e/fixtures/character_progression.html')
  await page.getByRole('button', { name: 'Add a point to Strength', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Enter fight' }).click()
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled()
  await expect(page.locator('[data-calls]')).toHaveText('0')
  await page.getByRole('button', { name: 'Become idle' }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.locator('[data-calls]')).toHaveText('1')
  await page.locator('.sb__btn-compact').click()
  await expect(page.locator('[data-calls]')).toHaveText('2')
})

for (const target of ['stats', 'spell']) {
  test(`${target} submission rechecks activity after the click`, async ({ page }) => {
    await page.goto('/e2e/fixtures/character_progression.html')
    if (target === 'stats') await page.getByRole('button', { name: 'Add a point to Strength', exact: true }).click()
    await page.getByRole('button', { name: 'Fight on next click' }).click()
    const submit =
      target === 'stats' ? page.getByRole('button', { name: 'Confirm', exact: true }) : page.locator('.sb__btn-compact')
    await submit.click()
    await expect(submit).toBeDisabled()
    await expect(page.locator('[data-calls]')).toHaveText('0')
  })
}
