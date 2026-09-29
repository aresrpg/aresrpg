// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('the actual demo fight lifecycle plays the fight-over file at its authored volume', async ({ page }) => {
  await page.goto('/e2e/fixtures/fight_over_audio.html')
  await page.getByRole('button', { name: 'Finish demo fight', exact: true }).click()
  await expect(page.locator('#result')).toHaveText('fight over')
  const fight_sounds = () =>
    page
      .locator('#audio-events')
      .textContent()
      .then((value) =>
        (JSON.parse(value ?? '[]') as { source: string; volume: number }[]).filter(
          ({ source }) => source === '/sound_effect/fight_over.ogg'
        )
      )
  await expect.poll(fight_sounds).toEqual([{ source: '/sound_effect/fight_over.ogg', volume: 0.6 }])
  await page.getByRole('button', { name: 'Close result', exact: true }).click()
  expect(await fight_sounds()).toHaveLength(1)
})
