// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('an occupied placement rollback keeps the joining character and hovered fight UI alive', async ({ page }) => {
  const crashes: string[] = []
  page.on('pageerror', (error) => crashes.push(error.message))
  await page.goto('/e2e/fixtures/fight_placement_race.html')
  await page.getByRole('button', { name: 'Place and join', exact: true }).click()
  const participants = page.getByLabel('Participants', { exact: true })
  await expect(participants).toHaveText('3')
  await page
    .locator('canvas')
    .first()
    .hover({ position: { x: 70, y: 300 } })
  // Trigger the failed response while the pointer remains over the newly joined fighter.
  await page
    .getByRole('button', { name: 'Reject placement', exact: true })
    .evaluate((button) => (button as HTMLButtonElement).click())
  await expect(page.getByRole('button', { name: 'Ready all', exact: true })).toBeEnabled()
  await expect(participants).toHaveText('3')
  expect(crashes).toEqual([])
})

test('real fight models and audio finish preparation', async ({ page }) => {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(message.text())
  })
  await page.goto('/e2e/fixtures/fight_placement_race.html?real_resources')
  // This integration budget covers cold model loading, DSP synthesis and audio decoding.
  // The attribute reports the pending phase if preparation does not finish.
  await expect(page.locator('body')).toHaveAttribute('data-preparation', 'ready', { timeout: 30_000 })
  await expect(page.locator('[data-world-loading]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Ready', exact: true })).toBeEnabled()
  expect(failures).toEqual([])
})
