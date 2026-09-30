// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFile } from 'node:fs/promises'

import { expect, test, type Page } from '@playwright/test'
import { parse } from 'yaml'

import type {} from '../fixtures/inventory.tsx'

const open_feeding = async (page: Page) => {
  await page.goto('/e2e/fixtures/inventory.html')
  await page.getByRole('button', { name: 'Siluri', exact: true }).click({ button: 'right' })
  await page.getByRole('menu').getByRole('button', { name: 'Feed', exact: true }).click()
  return page.getByRole('dialog', { name: 'Feed pet', exact: true })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.played_audio = []
    HTMLMediaElement.prototype.play = new Proxy(HTMLMediaElement.prototype.play, {
      apply: (_target, player: HTMLMediaElement) => {
        window.played_audio.push(player.src)
        return Promise.resolve()
      },
    })
  })
})

test('food selection waits for confirm and rejection preserves the choice without celebration', async ({ page }) => {
  const modal = await open_feeding(page)
  const confirm = modal.getByRole('button', { name: 'Confirm feeding', exact: true })
  await expect(confirm).toBeDisabled()
  await modal.locator('[data-feed-foods] button').click()
  expect(await page.evaluate(() => window.feed_requests.length)).toBe(0)
  await expect(confirm).toBeEnabled()
  const food_cell = modal.locator('[data-feed-foods] button')
  // The modal enters at scale(0.95); measure its final footprint after that transition.
  await expect.poll(async () => (await food_cell.boundingBox())?.width).toBe(56)
  await confirm.click()
  await expect(modal.getByRole('button', { name: 'Feeding…', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => window.feed_requests.length)).toBe(1)
  await page.evaluate(() => window.reject_feed())
  await expect(modal.getByRole('alert')).toContainText('The request was cancelled.')
  await expect(modal.locator('[data-pet-feeding]')).toHaveAttribute('data-phase', 'selecting')
  await expect(modal.locator('[data-feed-foods] button')).toHaveAttribute('aria-pressed', 'true')
  await expect(modal.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30')
  await expect(modal.locator('[data-pet-hearts]')).toHaveCount(0)
})

test('a receipt throws the selected food, reacts with hearts and sounds, and refreshes the actual pet stats', async ({
  page,
}) => {
  const modal = await open_feeding(page)
  await modal.locator('[data-feed-foods] button').click()
  await modal.getByRole('button', { name: 'Confirm feeding', exact: true }).click()
  await page.evaluate(() => window.resolve_feed())
  await expect(modal.locator('[data-pet-feeding]')).toHaveAttribute('data-phase', 'throwing')
  await expect(modal.locator('[data-feeding-food]')).toHaveAttribute('data-feeding-food', 'gilded_pet_food')
  await expect(modal.locator('[data-pet-hearts] svg')).toHaveCount(5)
  await expect(modal.locator('.pet-feed-pet')).toHaveCSS('animation-name', 'pet-feed-chomp')
  await page.waitForTimeout(350)
  await expect(modal.locator('[data-pet-feeding]')).toHaveAttribute('data-phase', 'done')
  await expect(modal.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '31')
  const played = await page.evaluate(() => window.played_audio)
  expect(played.some((src) => src.endsWith('/sound_effect/cast_air.ogg'))).toBe(true)
  expect(played.some((src) => src.endsWith('/sound_effect/cast_heal.ogg'))).toBe(true)
  expect(await page.evaluate(() => window.feed_requests.length)).toBe(1)
  await modal.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.locator('[data-item-stats]')).toContainText('+41')
})
