// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

import { FOOTSTEP_AUDIO_ASSETS } from '../../src/game/audio/footstep_recordings.ts'

test.use({ hasTouch: true })

test('ordinary demo buttons play once, including keyboard and portal activation', async ({ page }) => {
  const events = () =>
    page
      .locator('#audio-events')
      .textContent()
      .then((text) => JSON.parse(text ?? '[]') as string[])
  await page.goto('/e2e/fixtures/interface_audio.html')
  await page.getByRole('button', { name: 'Ordinary button', exact: true }).click()
  await expect.poll(events).toEqual(['/sound_effect/button_confirm.ogg'])
  await expect(page.locator('#clicks')).toHaveText('1')
  await page.getByRole('button', { name: 'Portal button', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect.poll(events).toHaveLength(2)
  await page.getByRole('button', { name: 'Portal button', exact: true }).tap()
  await expect.poll(events).toHaveLength(3)
  await page.getByRole('button', { name: 'Change setting', exact: true }).click()
  await expect
    .poll(events)
    .toEqual([
      '/sound_effect/button_confirm.ogg',
      '/sound_effect/button_confirm.ogg',
      '/sound_effect/button_confirm.ogg',
      '/sound_effect/settings_changed.ogg',
    ])
  await page.getByRole('button', { name: 'Disabled button', exact: true }).click({ force: true })
  await page.getByRole('button', { name: 'Disabled button', exact: true }).dispatchEvent('click')
  await page.getByRole('button', { name: 'Ordinary button', exact: true }).dispatchEvent('click')
  await page.getByRole('button', { name: 'Mute', exact: true }).click()
  await page.getByRole('button', { name: 'Ordinary button', exact: true }).click()
  await expect(page.locator('#clicks')).toHaveText('5')
  expect(await events()).toHaveLength(4)
})

test('button feedback is not multiplied by observer restart and stops on disposal', async ({ page }) => {
  const events = () =>
    page
      .locator('#audio-events')
      .textContent()
      .then((text) => JSON.parse(text ?? '[]') as string[])
  await page.goto('/e2e/fixtures/interface_audio.html')
  await page.getByRole('button', { name: 'Restart observers', exact: true }).click()
  await page.getByRole('button', { name: 'Ordinary button', exact: true }).click()
  await expect.poll(events).toEqual(['/sound_effect/button_confirm.ogg'])
  await page.getByRole('button', { name: 'Dispose observers', exact: true }).click()
  await page.getByRole('button', { name: 'Ordinary button', exact: true }).click()
  await expect(page.locator('#clicks')).toHaveText('2')
  expect(await events()).toHaveLength(1)
})

test('all terrain presets play real decoded footstep recordings', async ({ page }) => {
  const requests = new Set<string>()
  page.on('response', (response) => {
    if (response.url().includes('/sound_effect/step-') && response.status() === 200) requests.add(response.url())
  })
  await page.goto('/e2e/fixtures/interface_audio.html')
  const materials = ['stone', 'earth', 'grass', 'frozen_grass', 'wood', 'foliage', 'sand', 'snow', 'ice', 'water']
  for (const [index, material] of materials.entries()) {
    await page.getByRole('button', { name: `Step ${material}`, exact: true }).click()
    await expect
      .poll(() =>
        page
          .locator('#footstep-events')
          .textContent()
          .then((text) => JSON.parse(text ?? '[]') as { duration: number; peak: number }[])
      )
      .toHaveLength(index + 1)
  }
  const durations = JSON.parse((await page.locator('#footstep-events').textContent()) ?? '[]') as {
    duration: number
    peak: number
  }[]
  expect(durations.every(({ duration, peak }) => duration > 0 && peak > 0.59 && peak < 0.61)).toBeTruthy()
  expect(requests.size).toBe(Object.keys(FOOTSTEP_AUDIO_ASSETS).length)
})

test('running on grass never stacks multiple full footstep tails', async ({ page }) => {
  await page.goto('/e2e/fixtures/interface_audio.html')
  await page.getByRole('button', { name: 'Run grass', exact: true }).click()
  await expect(page.locator('#run-state')).toHaveText('done')
  const events = JSON.parse((await page.locator('#footstep-events').textContent()) ?? '[]') as unknown[]
  expect(events).toHaveLength(8)
  // Only the new strike and the previous strike's 12 ms fade may coexist.
  expect(Number(await page.locator('#footstep-overlap').textContent())).toBeLessThanOrEqual(2)
})
