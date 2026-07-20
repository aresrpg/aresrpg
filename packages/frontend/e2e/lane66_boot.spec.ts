// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

const APP_URL = '/lane66-harness?debug=1&biome=rainforest'
const CHARACTER_ID = 'lane66-character'
const WORLD_ID = 'lane66-world'

test('Lane 66: resident feet column grounds and unlocks before focus_ready', async ({ page }) => {
  test.setTimeout(120_000)
  const trace: string[] = []
  page.on('console', (message) => {
    const line = message.text()
    if (/\[(boot-trace|TTP)\]/.test(line)) {
      trace.push(line)
      console.log(line)
    }
  })

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await cdp.send('Emulation.setHardwareConcurrencyOverride', { hardwareConcurrency: 2 })
  await page.route('**/lane66-harness?*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<style>html,body,#host{width:100%;height:100%;margin:0;overflow:hidden}</style><div id="host"></div>',
    })
  )
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
  const has_webgpu = await page.evaluate(() => 'gpu' in navigator)
  expect(has_webgpu, 'the timing proof needs the real streaming WebGPU engine').toBe(true)

  await page.evaluate(
    async ({ character_id, world_id }) => {
      // Fully generated rainforest terrain at (8,0) has open ground y=130 but resident AIR at the old
      // provisional probe y=137. It deterministically reproduces the exact-y D188 wedge.
      localStorage.setItem(
        `ares:last_position:v1:${character_id}`,
        JSON.stringify({ x: 8.5, z: 0.5, world_id, ts: Date.now() })
      )
      const { publish_world_binding } = await import('/src/world-shell/session_gate.js')
      publish_world_binding(character_id, world_id)
      const { mount_voxel_scene } = await import('/src/game/embed_voxel.js')
      const host = document.getElementById('host')
      if (!host) throw new Error('Lane 66 harness host missing')
      ;(window as any).__lane66_scene = mount_voxel_scene(
        host,
        { id: character_id, name: 'Lane 66', class: 'senshi', male: true, level: 1 },
        { tier: 'low', spectate: false }
      )
    },
    { character_id: CHARACTER_ID, world_id: WORLD_ID }
  )

  await page.waitForFunction(() => !!(window as any).__voxel_ctl, null, { timeout: 30_000 })
  await expect
    .poll(() => trace.find((line) => line.includes('physics+movement live')), { timeout: 60_000 })
    .toBeTruthy()
  await expect
    .poll(() => trace.find((line) => line.includes('focus_ready (world visible)')), { timeout: 60_000 })
    .toBeTruthy()

  const unlock_line = trace.find((line) => line.includes('physics+movement live')) ?? ''
  const focus_line = trace.find((line) => line.includes('focus_ready (world visible)')) ?? ''
  const unlock_ms = Number(unlock_line.match(/TIME-TO-PLAY (\d+)ms/)?.[1])
  const focus_ms = Number(focus_line.match(/world visible\) \+(\d+)ms/)?.[1])
  const unlock_resident = Number(unlock_line.match(/resident=(\d+) chunks/)?.[1])
  expect(unlock_line).toContain('focus_ready=false')
  expect(unlock_resident).toBeLessThan(25 * 12)
  expect(unlock_ms).toBeLessThan(focus_ms)

  await expect
    .poll(() => page.evaluate(() => !!(window as any).__voxel_ctl?.get_transform?.().on_ground), { timeout: 5_000 })
    .toBe(true)
  const before = await page.evaluate(() => (window as any).__voxel_ctl.get_transform().position as number[])
  expect(before[1]).toBeLessThan(137)
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(800)
  await page.keyboard.up('KeyW')
  const after = await page.evaluate(() => (window as any).__voxel_ctl.get_transform().position as number[])
  expect(Math.hypot(after[0] - before[0], after[2] - before[2])).toBeGreaterThan(0.1)

  await page.evaluate(() => (window as any).__lane66_scene?.destroy?.())
})
