// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

const SOUND_KEY = 'aresrpg.landing.music_enabled'
const game_chunk = /\/assets\/game_entry-[^/]+\.js$/
test.use({ serviceWorkers: 'block', launchOptions: { args: ['--autoplay-policy=document-user-activation-required'] } })

for (const width of [1280, 390]) {
  test(`landing music handles gestures, persisted mute and game handoff at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(() => {
      let gesture_received = false
      const unlock = (event: Event): void => {
        if (event.isTrusted) gesture_received = true
      }
      document.addEventListener('pointerdown', unlock)
      document.addEventListener('keydown', unlock)
      const { play } = HTMLMediaElement.prototype
      HTMLMediaElement.prototype.play = function () {
        if (!gesture_received) return Promise.reject(new DOMException('Gesture required', 'NotAllowedError'))
        return play.call(this)
      }
    })
    await page.goto('/')
    await expect(page.locator('.landing')).toHaveAttribute('data-motion', /.+/)
    const sound = page.locator('[data-landing-sound]')
    const player = page.locator('.landing audio')
    await expect(sound).toHaveAccessibleName('Mute music')
    await expect(player).toHaveJSProperty('paused', true)
    const box = await sound.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.height).toBeGreaterThanOrEqual(44)
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    const dock = await page.locator('.kares-dock').boundingBox()
    expect(dock!.height).toBeGreaterThanOrEqual(44)
    expect(dock!.x + dock!.width).toBeLessThanOrEqual(width)
    if (width >= 900) {
      expect(Math.abs(dock!.y + dock!.height / 2 - box!.y - box!.height / 2)).toBeLessThan(1)
      const link = await page.locator('.topnav a').first().boundingBox()
      expect(Math.abs(dock!.y + dock!.height / 2 - link!.y - link!.height / 2)).toBeLessThan(1)
    } else {
      expect(dock!.y + dock!.height).toBeLessThan(box!.y)
    }
    await page.locator('.hero h1').click()
    await expect(player).toHaveJSProperty('paused', false)
    await expect.poll(() => player.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0)
    await expect(player).toHaveJSProperty('loop', true)
    await expect(player).toHaveJSProperty('volume', 0.35)
    await sound.click()
    await expect(sound).toHaveAccessibleName('Enable music')
    await expect(player).toHaveJSProperty('paused', true)
    expect(await page.evaluate((key) => localStorage.getItem(key), SOUND_KEY)).toBe('false')
    await page.reload()
    await expect(page.locator('.landing')).toHaveAttribute('data-motion', /.+/)
    await expect(sound).toHaveAttribute('aria-pressed', 'false')
    await page.locator('.hero h1').click()
    await expect(player).toHaveJSProperty('paused', true)
    await sound.focus()
    await page.keyboard.press('Enter')
    await expect(player).toHaveJSProperty('paused', false)
    await expect(sound).toHaveAttribute('aria-pressed', 'true')
    await page.screenshot({ path: `test-results/landing-music-${width}.png` })
    await page.evaluate(() => Reflect.set(window, 'landing_player', document.querySelector('.landing audio')))
    const gate = Promise.withResolvers<void>()
    await page.route(game_chunk, async (route) => {
      await gate.promise
      await route.fulfill({
        contentType: 'application/javascript',
        body: 'export const boot_game = () => document.getElementById("root").replaceChildren(document.createTextNode("Game ready"))',
      })
    })
    await page.getByRole('button', { name: 'Play', exact: true }).first().click()
    try {
      await expect(page.locator('[data-boot-loading]')).toBeVisible()
      await expect(page.locator('.landing')).toHaveCount(0)
      expect(
        await page.evaluate(() => {
          const audio = Reflect.get(window, 'landing_player') as HTMLAudioElement
          return { paused: audio.paused, source: audio.getAttribute('src') }
        })
      ).toEqual({ paused: true, source: null })
    } finally {
      gate.resolve()
    }
    await expect(page.locator('#root')).toHaveText('Game ready')
    expect(errors).toEqual([])
  })
}

test('landing music honors master volume and survives unavailable preference storage', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('aresrpg.settings', JSON.stringify({ master_volume: 0.4 }))
  })
  await page.goto('/')
  await expect
    .poll(() => page.locator('.landing audio').evaluate((element: HTMLAudioElement) => element.volume))
    .toBeCloseTo(0.14)
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage disabled', 'SecurityError')
    }
  })
  await page.locator('[data-landing-sound]').click()
  await expect(page.locator('[data-landing-sound]')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.landing audio')).toHaveJSProperty('paused', true)
})
