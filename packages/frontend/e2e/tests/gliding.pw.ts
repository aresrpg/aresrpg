// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'

import { expect, test } from '@playwright/test'

import profiles from '../../../../seed/content/pet_wings.json' with { type: 'json' }

test('every pet wing style renders on WebGPU, folds, and honors the quality budget', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/e2e/fixtures/glide.html')
  await page.waitForFunction(() => window.glide_probe?.snapshot().ready)
  for (const pet of Object.keys(profiles)) {
    await page.evaluate((pet) => window.glide_probe.choose(pet), pet)
    await expect.poll(async () => page.evaluate(() => window.glide_probe.snapshot().ready)).toBe(true)
    await expect.poll(async () => page.evaluate(() => window.glide_probe.snapshot().wings)).toBe(2)
    await page.waitForTimeout(180)
    await page.screenshot({ path: test.info().outputPath(`wings-${pet}.png`) })
  }
  await page.evaluate(() => {
    window.glide_probe.quality('low')
    window.glide_probe.night(true)
  })
  await expect.poll(async () => page.evaluate(() => window.glide_probe.snapshot().trails)).toBe(4)
  await page.evaluate(() => window.glide_probe.deploy(false))
  await expect.poll(async () => page.evaluate(() => window.glide_probe.snapshot().wings)).toBe(0)
  await page.evaluate(() => window.glide_probe.deploy(true))
  await expect.poll(async () => page.evaluate(() => window.glide_probe.snapshot().wings)).toBe(2)
  expect(errors).toEqual([])
})

test('desktop and touch clients see each other glide, release and dismount through the server', async ({ browser }) => {
  const repo = resolve(import.meta.dirname, '../../../..')
  const relay = spawn('bun', ['packages/server/test/glide_relay.ts'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] })
  const errors: string[] = []
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1280, height: 800 } }),
    browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }),
  ])
  try {
    const [data] = await once(relay.stdout!, 'data')
    const port = /GLIDE_RELAY_PORT=(\d+)/.exec(String(data))?.[1]
    if (!port) throw new Error(`Glide relay did not start: ${String(data)}`)
    const pages = await Promise.all(
      contexts.map(async (context, index) => {
        const page = await context.newPage()
        page.on('pageerror', (error) => errors.push(error.message))
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text())
        })
        const id = index === 0 ? '0xabc' : '0xdef'
        await page.goto(
          `http://127.0.0.1:5180/e2e/fixtures/glide.html?relay=ws://127.0.0.1:${port}&id=${id}${index === 1 ? '&touch' : ''}`
        )
        await page.waitForFunction(() => window.glide_world_probe?.snapshot().ready)
        await page.evaluate(() => window.glide_world_probe.lift())
        return page
      })
    )
    const desktop = pages[0]!
    const touch = pages[1]!
    await desktop.keyboard.down('Space')
    await desktop.keyboard.down('KeyW')
    const button = await touch.locator('.mobile-jump').boundingBox()
    if (!button) throw new Error('Touch jump control is missing')
    const device = await contexts[1]!.newCDPSession(touch)
    await device.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: button.x + button.width / 2, y: button.y + button.height / 2 }],
    })
    await touch.evaluate(() => window.glide_world_probe.move({ forward: 1, strafe: 0 }))
    for (const page of pages) {
      await expect.poll(async () => page.evaluate(() => window.glide_world_probe.snapshot().pose?.gliding)).toBe(true)
      await expect
        .poll(async () =>
          page.evaluate(() => window.glide_world_probe.snapshot().remote.some((pet) => pet.gliding && pet.loaded))
        )
        .toBe(true)
    }
    await desktop.screenshot({ path: test.info().outputPath('gliding-together.png') })
    const before_turn = await desktop.evaluate(() => window.glide_world_probe.snapshot().pose!)
    await desktop.keyboard.up('KeyW')
    await desktop.keyboard.down('KeyA')
    await desktop.waitForTimeout(300)
    const turning = await desktop.evaluate(() => window.glide_world_probe.snapshot().pose!)
    expect(turning.x).toBeLessThan(before_turn.x - 0.1)
    expect(turning.z).toBeLessThan(before_turn.z - 0.1)
    await desktop.screenshot({ path: test.info().outputPath('steering-bank.png') })
    await desktop.keyboard.up('Space')
    await expect
      .poll(async () => touch.evaluate(() => window.glide_world_probe.snapshot().remote[0]?.gliding))
      .toBe(false)
    await touch.evaluate(() => window.glide_world_probe.ride(false))
    await expect
      .poll(async () => desktop.evaluate(() => window.glide_world_probe.snapshot().remote[0]?.gliding))
      .toBe(false)
    await device.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    expect(errors).toEqual([])
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
    relay.kill('SIGTERM')
    await once(relay, 'exit')
  }
})
