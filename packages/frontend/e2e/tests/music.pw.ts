// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

import type {} from '../fixtures/music.tsx'

test('music keeps the same player and playback across pages while settings still control it', async ({ page }) => {
  await page.addInitScript(() => {
    window.music_events = []
    window.music_players = []
    HTMLMediaElement.prototype.play = new Proxy(HTMLMediaElement.prototype.play, {
      apply: (_target, player: HTMLMediaElement) => {
        if (!window.music_players.includes(player)) window.music_players.push(player)
        Object.defineProperty(player, 'paused', { configurable: true, value: false })
        window.music_events.push('play')
        return Promise.resolve()
      },
    })
    HTMLMediaElement.prototype.pause = new Proxy(HTMLMediaElement.prototype.pause, {
      apply: (_target, player: HTMLMediaElement) => {
        Object.defineProperty(player, 'paused', { configurable: true, value: true })
        window.music_events.push('pause')
      },
    })
    HTMLMediaElement.prototype.load = new Proxy(HTMLMediaElement.prototype.load, {
      apply: () => window.music_events.push('load'),
    })
  })
  await page.goto('/e2e/fixtures/music.html')
  await expect.poll(() => page.evaluate(() => window.music_players.length)).toBe(1)
  const initial = await page.evaluate(() => ({
    events: [...window.music_events],
    source: window.music_players[0]!.src,
  }))
  for (const destination of [
    'characters',
    'encyclopedia',
    'marketplace',
    'leaderboard',
    'mastery',
    'kares',
    'airdrop',
    'kolizeum',
    'settings',
    'world',
  ]) {
    await page.getByRole('button', { name: destination, exact: true }).click()
    await expect(page.locator('[data-current-page]')).toHaveAttribute('data-current-page', destination)
    expect(await page.evaluate(() => ({ events: window.music_events, source: window.music_players[0]!.src }))).toEqual(
      initial
    )
    expect(await page.evaluate(() => window.music_players[0]!.paused)).toBe(false)
  }
  await page.getByRole('button', { name: 'Disable music', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.music_players[0]!.paused)).toBe(true)
  await page.getByRole('button', { name: 'Enable music', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.music_players[0]!.paused)).toBe(false)
  await page.getByRole('button', { name: 'Mute volume', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.music_players[0]!.volume)).toBe(0)
  expect(await page.evaluate(() => window.music_players.length)).toBe(1)
})
