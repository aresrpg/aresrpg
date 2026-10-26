// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import { visit, calls, fixture } from '../fixtures/tournament_driver.ts'

test('busy character creation explains recovery from both launchers and rechecks an open form', async ({ page }) => {
  await visit(page)
  await fixture(page, 'character', { custody: 'fight' })
  for (const selector of ['.tourney-teams', '.tourney-dock']) {
    const launch = page.locator(selector).getByRole('button', { name: 'Create team', exact: true })
    await expect(launch).toBeEnabled()
    await launch.click()
    const dialog = page.getByRole('dialog', { name: 'Create team', exact: true })
    await expect(dialog.getByRole('alert')).toHaveText(
      'Finish your fight and collect its rewards before creating a team.'
    )
    await expect(dialog.getByRole('button', { name: 'Create team', exact: true })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  }
  expect(await calls(page)).toEqual([])
  await fixture(page, 'character', { custody: 'kiosk' })
  await page.locator('.tourney-teams').getByRole('button', { name: 'Create team', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create team', exact: true })
  await dialog.getByLabel('Team name', { exact: true }).fill('Night Watch')
  await fixture(page, 'character', { custody: 'fight' })
  await expect(dialog.getByRole('alert')).toHaveText(
    'Finish your fight and collect its rewards before creating a team.'
  )
  expect(await calls(page)).toEqual([])
  await fixture(page, 'character', { custody: 'kiosk' })
  await expect(dialog.getByLabel('Team name', { exact: true })).toHaveValue('Night Watch')
  await dialog.getByRole('button', { name: 'Create team', exact: true }).click()
  await expect.poll(() => calls(page)).toHaveLength(1)
})

test('team labels cannot create HTML or rewrite the character named in a join review', async ({ page }) => {
  await visit(page)
  const name = '<img src=x onerror=alert(1)> $&'
  const team = {
    revision: '3',
    allowed: [],
    place: 0,
    seats: [{ character: 'other', owner: 'other', sui_claimed: false, token_claimed: false, items_claimed: '0' }],
  }
  await fixture(page, 'update', {
    teams: [{ ...team, name }],
  })
  await fixture(page, 'character', { name: '{{team}}' })
  await expect(page.locator('.tourney-team-heading h4')).toHaveText(name)
  await expect(page.locator('.tourney-team-heading img')).toHaveCount(0)
  await page.getByRole('button', { name: 'Take seat', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Take seat', exact: true })
  await expect(dialog.getByText(`Register {{team}} with ${name}?`, { exact: true })).toBeVisible()
  expect(await calls(page)).toEqual([])
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect
    .poll(() => calls(page))
    .toEqual([
      {
        kind: 'join',
        args: { tournament: 'cup', team: 0, revision: '3', character_id: 'hero', custody: { kiosk: 'kiosk' } },
      },
    ])
  await fixture(page, 'update', {
    teams: [{ ...team, name: 'Owls\u202e\n' }],
  })
  await expect(page.locator('.tourney-team-heading h4')).toHaveText('Owls��')
  await expect(page.locator('.tourney-team-heading bdi')).toHaveCSS('unicode-bidi', 'isolate')
})

test('empty teams disappear without changing live team indices or consuming reusable capacity', async ({ page }) => {
  await visit(page)
  const empty = { name: 'Departed team', revision: '4', allowed: [], seats: [], place: 0 }
  const live = {
    ...empty,
    name: 'Still here',
    revision: '6',
    seats: [{ character: 'other', owner: 'other', sui_claimed: false, token_claimed: false, items_claimed: '0' }],
  }
  await fixture(page, 'update', { teams: [empty, live] })
  await expect(page.locator('.tourney-team')).toHaveCount(1)
  await expect(page.getByText('Departed team', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Take seat', exact: true }).first().click()
  await page
    .getByRole('dialog', { name: 'Take seat', exact: true })
    .getByRole('button', { name: 'Confirm', exact: true })
    .click()
  await expect
    .poll(() => calls(page))
    .toEqual([
      {
        kind: 'join',
        args: { tournament: 'cup', team: 1, revision: '6', character_id: 'hero', custody: { kiosk: 'kiosk' } },
      },
    ])
  await fixture(page, 'update', { teams: Array.from({ length: 64 }, () => empty) })
  await expect(page.locator('.tourney-team')).toHaveCount(0)
  await expect(page.getByText('No teams yet. Create one or find teammates.', { exact: true })).toBeVisible()
  await expect(page.locator('.tourney-teams').getByRole('button', { name: 'Create team', exact: true })).toBeEnabled()
})
