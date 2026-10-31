// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import { visit, calls } from '../fixtures/tournament_driver.ts'

test('paid registration reviews the exact per-character fee and its cancellation policy', async ({ page }) => {
  await visit(page, '?scenario=paid')
  await page.getByRole('button', { name: 'Take seat', exact: true }).first().click()
  const review = page.getByRole('dialog', { name: 'Take seat', exact: true })
  await expect(review.getByText('Entry fee per character: 0.123456789 SUI', { exact: true })).toBeVisible()
  await expect(
    review.getByText('Non-refundable, including withdrawal or cancellation.', { exact: false })
  ).toBeVisible()
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
  await expect(review.getByText('Maximum level at registration: 50', { exact: true })).toBeVisible()
  await expect(review.getByText('Entry fee per character: 0.123456789 SUI', { exact: true })).toBeVisible()
  expect(await calls(page)).toEqual([])
})

test('over-level characters cannot submit a registration', async ({ page }) => {
  await visit(page, '?scenario=level_limited')
  await expect(page.getByText('Maximum level at registration: 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Take seat', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open seat', exact: true }).first()).toBeDisabled()
  await expect(page.locator('.tourney-dock').getByRole('status')).toHaveText(
    'This character exceeds the registration level limit.'
  )
  await page
    .getByRole('region', { name: 'Teams', exact: true })
    .getByRole('button', { name: 'Create team', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Create team', exact: true })
  await expect(dialog.getByRole('alert')).toHaveText('This character exceeds the registration level limit.')
  await expect(dialog.getByRole('button', { name: 'Create team', exact: true })).toHaveCount(0)
  expect(await calls(page)).toEqual([])
})
