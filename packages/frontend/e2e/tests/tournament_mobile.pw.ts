// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test, type Locator } from '@playwright/test'

import { visit, fixture } from '../fixtures/tournament_driver.ts'

test.use({ hasTouch: true })

const touch_target = async (button: Locator): Promise<void> => {
  await button.scrollIntoViewIfNeeded()
  const box = (await button.boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(44)
  expect(box.height).toBeGreaterThanOrEqual(44)
  await button.tap({ trial: true })
}

for (const width of [667, 844]) {
  test(`dense bracket Watch buttons receive taps at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 375 })
    await visit(page, '?scenario=dense')
    const round = page.locator('.tourney-round').first()
    const card = round.locator('.tourney-match').first()
    const round_box = (await round.boundingBox())!
    const card_box = (await card.boundingBox())!
    expect(card_box.x + card_box.width).toBeLessThanOrEqual(round_box.x + round_box.width)
    await page.getByRole('button', { name: 'Watch', exact: true }).first().tap()
    expect(await fixture(page, 'state')).toMatchObject({ page: 'world' })
  })

  test(`tournament details and dismissal retain touch targets at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 375 })
    await visit(page, '?scenario=registered')
    await expect(page.locator('.tourney-panel')).toBeVisible()
    const window = page.getByRole('dialog', { name: 'Kolizeum', exact: true })
    await touch_target(window.getByRole('button', { name: 'Close', exact: true }))
    await touch_target(page.locator('.tourney-pool-summary'))
    const leave = page.getByRole('button', { name: 'Remove Nox from the team', exact: true })
    await touch_target(leave)
    await leave.tap()
    const review = page.getByRole('dialog', { name: 'Leave', exact: true })
    await touch_target(review.getByRole('button', { name: 'Confirm', exact: true }))
    await touch_target(review.locator('.aui-window-header').getByRole('button', { name: 'Cancel', exact: true }))
    await review.locator('.tourney-dialog-actions').getByRole('button', { name: 'Cancel', exact: true }).tap()
    await expect(review).toHaveCount(0)

    await visit(page, '?scenario=finished')
    const reward = page.locator('.tourney-reward').first()
    await touch_target(reward)
    await reward.tap()
    const detail = page.locator('dialog[open]').last()
    await touch_target(detail.getByRole('button', { name: 'Cancel', exact: true }))
    await detail.getByRole('button', { name: 'Cancel', exact: true }).tap()
    await touch_target(page.getByRole('button', { name: 'Claim coins', exact: true }).first())
    await touch_target(
      page.locator('.tourney-personal-item').getByRole('button', { name: 'Claim', exact: true }).first()
    )
  })

  test(`mobile results shortcut reopens the podium at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 375 })
    await visit(page, '?hud&scenario=finished')
    await fixture(page, 'claimed')
    const results = page.getByRole('button', { name: 'View Autumn Championship tournament results', exact: true })
    await touch_target(results)
    await results.tap()
    await expect(page.locator('.tourney-podium')).toBeVisible()
    expect(await fixture(page, 'state')).toMatchObject({ pathname: '/kolizeum/tournament/cup/podium' })
  })

  test(`organizer actions and reviews remain tappable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 375 })
    await visit(page, '?scenario=admin_start')
    await page.getByRole('button', { name: 'Manage tournament', exact: true }).tap()
    const editor = page.getByRole('dialog', { name: 'Manage tournament', exact: true })
    await touch_target(editor.getByRole('button', { name: 'Close', exact: true }))
    for (const name of ['Start tournament', 'Cancel tournament']) {
      const action = editor.getByRole('button', { name, exact: true })
      await touch_target(action)
      await action.tap()
      const review = page.getByRole('dialog', { name: `Confirm · ${name}`, exact: true })
      await touch_target(review.getByRole('button', { name: 'Confirm', exact: true }))
      await review.locator('.tourney-dialog-actions').getByRole('button', { name: 'Cancel', exact: true }).tap()
      await expect(review).toHaveCount(0)
    }
  })
}
