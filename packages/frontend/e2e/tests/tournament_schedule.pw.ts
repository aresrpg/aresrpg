// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import { visit, calls, fixture } from '../fixtures/tournament_driver.ts'

test('any player can crank a scheduled tournament, with no automatic start', async ({ page }) => {
  await visit(page, '?scenario=public_start')
  expect(await calls(page)).toEqual([])
  await expect(page.locator('.tourney-event-progress time')).toHaveCount(0)
  await page.getByRole('button', { name: 'Start the tournament', exact: true }).click()
  await expect.poll(() => calls(page)).toEqual([{ kind: 'start', args: { id: 'cup' } }])
})

test('admins cannot start before the scheduled time', async ({ page }) => {
  await visit(page, '?scenario=admin_start')
  await fixture(page, 'update', { start_before_ms: 9_000_000_000_000 })
  await page.getByRole('button', { name: 'Manage tournament', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Start tournament', exact: true })).toBeDisabled()
  expect(await calls(page)).toEqual([])
})
