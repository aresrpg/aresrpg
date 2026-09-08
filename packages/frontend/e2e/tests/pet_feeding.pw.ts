// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFile } from 'node:fs/promises'

import { expect, test, type Page } from '@playwright/test'
import { parse } from 'yaml'

import type {} from '../fixtures/inventory.tsx'

const open_feeding = async (page: Page) => {
  await page.goto('/e2e/fixtures/inventory.html')
  await page.getByTitle('Siluri', { exact: true }).click({ button: 'right' })
  await page.getByRole('button', { name: 'Feed', exact: true }).click()
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
  const food_cell = await modal.locator('[data-feed-foods] button').boundingBox()
  expect(food_cell!.width).toBe(56)
  await page.screenshot({ path: 'test-results/pet-feeding-selection.png' })
  await confirm.click()
  await expect(modal.getByRole('button', { name: 'Feeding…', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => window.feed_requests.length)).toBe(1)
  await page.evaluate(() => window.reject_feed())
  await expect(modal.getByRole('alert')).toContainText('Feeding rejected')
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
  await page.screenshot({ path: 'test-results/pet-feeding-hearts.png' })
  await expect(modal.locator('[data-pet-feeding]')).toHaveAttribute('data-phase', 'done')
  await expect(modal.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '31')
  const played = await page.evaluate(() => window.played_audio)
  expect(played.some((src) => src.endsWith('/sound_effect/cast_air.ogg'))).toBe(true)
  expect(played.some((src) => src.endsWith('/sound_effect/cast_heal.ogg'))).toBe(true)
  expect(await page.evaluate(() => window.feed_requests.length)).toBe(1)
  await modal.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.locator('[data-item-stats]')).toContainText('+41')
})

test('reduced motion reaches the result without throwing or shaking', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const modal = await open_feeding(page)
  await modal.locator('[data-feed-foods] button').click()
  await modal.getByRole('button', { name: 'Confirm feeding', exact: true }).click()
  await page.evaluate(() => window.resolve_feed())
  await expect(modal.locator('[data-pet-feeding]')).toHaveAttribute('data-phase', 'done')
  await expect(modal.locator('.pet-feed-pet')).toHaveCSS('animation-name', 'none')
})

test('food selection and confirmation remain visible in all six locales', async ({ page }) => {
  for (const locale of ['en', 'fr', 'de', 'es', 'ja', 'uk']) {
    const source = await readFile(new URL(`../../src/i18n/locales/${locale}.yaml`, import.meta.url), 'utf8')
    const copy = (parse(source) as { characters_page: Record<string, string> }).characters_page
    await page.goto(`/e2e/fixtures/inventory.html?locale=${locale}`)
    await page.getByTitle('Siluri', { exact: true }).click({ button: 'right' })
    await page.getByRole('button', { name: copy.menu_feed, exact: true }).click()
    const modal = page.getByRole('dialog', { name: copy.feed_title, exact: true })
    await modal.locator('[data-feed-foods] button').click()
    const confirm = modal.getByRole('button', { name: copy.feed_confirm, exact: true })
    await expect(confirm).toBeEnabled()
    expect(
      await confirm.evaluate((element) => element.getBoundingClientRect().bottom <= window.innerHeight),
      locale
    ).toBe(true)
    expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth), locale).toBe(true)
  }
})
