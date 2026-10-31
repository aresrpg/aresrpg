// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import { visit, calls, fixture } from '../fixtures/tournament_driver.ts'

test('team creation closes only after its confirmed result and does not close a new form', async ({ page }) => {
  await visit(page, '?pending')
  const create = page.locator('.tourney-teams').getByRole('button', { name: 'Create team', exact: true })
  await create.click()
  const dialog = page.getByRole('dialog', { name: 'Create team', exact: true })
  await dialog.getByLabel('Team name', { exact: true }).fill('Yamato')
  await dialog.getByRole('button', { name: 'Create team', exact: true }).click()
  await expect(dialog.getByText('Waiting for transaction confirmation…')).toBeVisible()
  expect(await calls(page)).toHaveLength(1)
  await fixture(page, 'complete')
  await expect(dialog).toBeHidden()
  await create.click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Team name', { exact: true })).toHaveValue('')
})

test('paid registration shows a concise price while submitting the exact fee', async ({ page }) => {
  await visit(page, '?scenario=paid')
  await page.getByRole('button', { name: 'Take seat', exact: true }).first().click()
  const review = page.getByRole('dialog', { name: 'Take seat', exact: true })
  await expect(review.getByText('Entry fee per character: 0.12 SUI', { exact: true })).toBeVisible()
  await expect(review.getByText('Non-refundable, including withdrawal or cancellation.', { exact: false })).toHaveCount(
    0
  )
  expect(await calls(page)).toEqual([])
  await review.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect
    .poll(() => calls(page))
    .toMatchObject([{ kind: 'join', args: { character_id: 'hero', entry_fee_mist: '123456789' } }])
})

test('the admin fee defaults to zero and preserves all nine SUI decimals in review', async ({ page }) => {
  await visit(page, '?admin')
  await page.getByRole('button', { name: 'Create tournament', exact: true }).click()
  const input = page.getByLabel('Entry fee per character (SUI)', { exact: true })
  await expect(input).toHaveValue('0')
  await page.getByLabel('Name', { exact: true }).fill('Paid cup')
  await page.getByLabel('Scheduled start', { exact: true }).fill('2027-01-01T12:00')
  await input.fill('0.1234567891')
  const create = page.locator('.tourney-create-summary').getByRole('button', { name: 'Create tournament', exact: true })
  await expect(create).toBeDisabled()
  await input.fill('0.123456789')
  const level = page.getByLabel('Maximum registration level', { exact: true })
  await expect(level).toHaveValue('')
  await level.fill('0')
  await expect(create).toBeDisabled()
  await level.fill('201')
  await expect(create).toBeDisabled()
  await level.fill('50')
  await create.click()
  const review = page.getByRole('dialog', { name: 'Confirm · Create tournament', exact: true })
  await expect(review.getByText('Max lvl. 50', { exact: true })).toBeVisible()
  await expect(review.getByText('Entry fee per character: 0.123456789 SUI', { exact: true })).toBeVisible()
  expect(await calls(page)).toEqual([])
})

test('over-level characters cannot submit a registration', async ({ page }) => {
  await visit(page, '?scenario=level_limited')
  await expect(page.locator('.tourney-masthead h2').getByText('Max lvl. 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Take seat', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open seat', exact: true }).first()).toBeDisabled()
  await expect(page.locator('.tourney-dock').getByRole('status')).toHaveText(
    'The maximum level for this tournament is 1.'
  )
  await page
    .getByRole('region', { name: 'Teams', exact: true })
    .getByRole('button', { name: 'Create team', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Create team', exact: true })
  await expect(dialog.getByRole('alert')).toHaveText('The maximum level for this tournament is 1.')
  await expect(dialog.getByRole('button', { name: 'Create team', exact: true })).toHaveCount(0)
  expect(await calls(page)).toEqual([])
})

test('level guidance stays visible and free team creation has no price or policy wall', async ({ page }) => {
  await visit(page)
  await fixture(page, 'update', { version: '8', max_level: 20 })
  const badge = page.locator('.tourney-masthead h2 .tourney-level-badge')
  await expect(badge).toHaveText('Max lvl. 20')
  await expect(
    page.locator('.tourney-identity').getByText('The level limit applies at registration. You can level up afterward.')
  ).toBeVisible()
  await expect(page.locator('.tourney-entry-fee')).toHaveCount(0)
  await page.locator('.tourney-teams').getByRole('button', { name: 'Create team', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create team', exact: true })
  await expect(dialog.getByLabel('Team name', { exact: true })).toBeVisible()
  await expect(dialog.locator('.tourney-entry-fee')).toHaveCount(0)
  await expect(dialog.getByText('Named characters reserve seats.', { exact: false })).toHaveCount(0)
  await expect(dialog.getByText('Only complete teams enter the tournament.', { exact: false })).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('compact-team-creation.png') })
})

test('the registered HUD waits until ten minutes before start to request staying online', async ({ page }) => {
  await visit(page, '?hud&scenario=registered')
  await fixture(page, 'update', { version: '8', start_before_ms: 5500000 })
  const label = page.locator('.tourney-hud-card .tourney-hud-footer b')
  await expect(label).toHaveText('Registered')
  await fixture(page, 'clock', 4900000)
  await expect(label).toHaveText('Registered · stay online')
})
