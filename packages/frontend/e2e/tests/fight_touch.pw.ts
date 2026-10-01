// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test, type Page } from '@playwright/test'

test.use({ hasTouch: true })
const tap_board = async (page: Page): Promise<void> => {
  await page.touchscreen.tap(70, 300)
}

test('touch previews placement, cancel emits nothing and confirm submits once', async ({ page }) => {
  await page.goto('/e2e/fixtures/fight_placement_race.html')
  await expect(page.getByLabel('Participants', { exact: true })).toHaveText('2')
  await tap_board(page)
  const confirmation = page.locator('[data-touch-fight-confirm]')
  await expect(confirmation).toBeVisible()
  await expect(page.locator('body')).toHaveAttribute('data-placement_calls', '0')
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  await expect(page.locator('body')).toHaveAttribute('data-placement_calls', '0')
  await tap_board(page)
  await confirmation.getByRole('button', { name: 'Confirm action', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-placement_calls', '1')
  await expect(confirmation).toHaveCount(0)
})

test('another canvas and a dragged finger never select the board; a new checkpoint cancels review', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/fight_placement_race.html')
  await expect(page.getByLabel('Participants', { exact: true })).toHaveText('2')
  await page.locator('[data-other-canvas]').tap()
  await expect(page.locator('[data-touch-fight-confirm]')).toHaveCount(0)
  const canvas = page.locator('canvas').first()
  await canvas.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 3, clientX: 70, clientY: 300 })
  await canvas.dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 3, clientX: 100, clientY: 300 })
  await canvas.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 3, clientX: 70, clientY: 300 })
  await expect(page.locator('[data-touch-fight-confirm]')).toHaveCount(0)
  await tap_board(page)
  await expect(page.locator('[data-touch-fight-confirm]')).toBeVisible()
  await page.getByRole('button', { name: 'Join without placement', exact: true }).click()
  await expect(page.getByLabel('Participants', { exact: true })).toHaveText('3')
  await expect(page.locator('[data-touch-fight-confirm]')).toHaveCount(0)
  await expect(page.locator('body')).toHaveAttribute('data-placement_calls', '0')
})

test('a pinch never previews or submits a board action', async ({ page }) => {
  await page.goto('/e2e/fixtures/fight_placement_race.html')
  await expect(page.getByLabel('Participants', { exact: true })).toHaveText('2')
  const canvas = page.locator('canvas').first()
  await canvas.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 70, clientY: 300 })
  await canvas.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 120, clientY: 300 })
  await canvas.dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 2, clientX: 160, clientY: 300 })
  await canvas.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 2, clientX: 160, clientY: 300 })
  await canvas.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 1, clientX: 70, clientY: 300 })
  await expect(page.locator('[data-touch-fight-confirm]')).toHaveCount(0)
  await expect(page.locator('body')).toHaveAttribute('data-placement_calls', '0')
})

test('targeting dismisses spell details without clearing the selected spell', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 640 })
  await page.goto('/e2e/fixtures/mobile_fight.html')
  const spell = page.locator('.aui-combat-spells button.fight-hud__spell:not(:disabled)').nth(1)
  await spell.tap()
  await expect(spell).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.getByRole('tooltip').tap()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.getByLabel('Fight board', { exact: true }).tap({ position: { x: 40, y: 80 } })
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await expect(spell).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Confirm action', exact: true }).tap()
  await expect(page.getByLabel('Confirmed actions')).toHaveText('1')
  await spell.tap()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.getByLabel('Fight board', { exact: true }).tap({ position: { x: 40, y: 80 } })
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  // The canvas does not take focus; tapping the same focused spell must still reopen its card.
  await spell.tap()
  await expect(page.getByRole('tooltip')).toBeVisible()
})

for (const pointer_type of ['touch', 'mouse']) {
  test(`outside ${pointer_type} input dismisses details while focus stays on the spell`, async ({ page }) => {
    await page.goto('/e2e/fixtures/mobile_fight.html')
    const spell = page.locator('.aui-combat-spells button.fight-hud__spell:not(:disabled)').nth(1)
    await spell.tap()
    await expect(page.getByRole('tooltip')).toBeVisible()
    await page.getByLabel('Fight board', { exact: true }).dispatchEvent('pointerdown', {
      pointerType: pointer_type,
      pointerId: 9,
      clientX: 40,
      clientY: 80,
      button: 0,
    })
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await expect(spell).toHaveAttribute('aria-pressed', 'true')
  })
}

test('a compatibility click after a board tap cannot bypass confirmation', async ({ page }) => {
  await page.goto('/e2e/fixtures/fight_placement_race.html')
  await expect(page.getByLabel('Participants', { exact: true })).toHaveText('2')
  await tap_board(page)
  await expect(page.locator('[data-touch-fight-confirm]')).toBeVisible()
  await page.locator('canvas').first().dispatchEvent('click', { button: 0, detail: 1, clientX: 70, clientY: 300 })
  await expect(page.locator('body')).toHaveAttribute('data-placement_calls', '0')
})

test('a click passing through to a newly shown checkmark cannot confirm', async ({ page }) => {
  await page.goto('/e2e/fixtures/fight_placement_race.html')
  await expect(page.getByLabel('Participants', { exact: true })).toHaveText('2')
  await tap_board(page)
  const confirm = page.getByRole('button', { name: 'Confirm action', exact: true })
  await expect(confirm).toBeVisible()
  await confirm.dispatchEvent('click', { button: 0, detail: 1 })
  await expect(page.locator('body')).toHaveAttribute('data-placement_calls', '0')
  await expect(confirm).toBeVisible()
  await confirm.tap()
  await expect(page.locator('body')).toHaveAttribute('data-placement_calls', '1')
})

test('a spell target hides its tooltip and requires a fresh checkmark press before spending AP', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 640 })
  await page.goto('/e2e/fixtures/fight_placement_race.html?spell')
  const ap = page.getByLabel('Action points', { exact: true })
  await expect(ap).toHaveText('6')
  const spell = page.getByRole('button', { name: 'Power, level 1, 6 AP', exact: true })
  await spell.tap()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await tap_board(page)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  const confirm = page.getByRole('button', { name: 'Confirm action', exact: true })
  await expect(confirm).toBeVisible()
  await expect(ap).toHaveText('6')
  await confirm.dispatchEvent('click', { button: 0, detail: 1 })
  await expect(ap).toHaveText('6')
  await confirm.tap()
  await expect(ap).not.toHaveText('6')
})
