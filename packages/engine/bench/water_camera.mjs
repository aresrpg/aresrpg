// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Run against bun run dev: bun packages/engine/bench/water_camera.mjs
// A zero-length world-space bed normal at x/z=16384 used to poison bloom with NaNs.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
await mkdir('test-results/water-camera', { recursive: true })
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.route('**/water-camera-probe', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: `<html><style>html,body{margin:0}canvas{display:block;width:100vw;height:100vh}</style><canvas></canvas><script type="module">
 import {create_engine,compile_world_recipe,BIOME_SLOTS,create_terrain_planner} from '/@fs${root}packages/engine/src/index.ts';
 import {create_chunk_manager} from '/src/game/core/chunks.ts';
 const world=compile_world_recipe({seed:'water-camera-regression',sea_level:60,liquid:'water',portal:false,atmosphere:'clear',materials:{sand:{color:'#d5bc7f',preset:'sand'},water:{color:'#2e609e',preset:'water'}},biome_slots:Object.fromEntries(BIOME_SLOTS.map(s=>[s,'bed'])),biomes:[{name:'bed',landscape:[{x:0,y:59,land:{surface:'sand',subsurface:'sand',filler:'sand'}},{x:1,y:59}]}]});
 const engine=create_engine({canvas:document.querySelector('canvas'),world,quality:'high',render_distance:2});const planner=create_terrain_planner(world.recipe);const chunks=create_chunk_manager({engine,initial_quality:'high',initial_render_distance:2,plan_layers:planner.plan});chunks.set_focus(0,0);engine.set_clouds_visible(false);engine.set_time_of_day(.32);engine.set_camera([0,64,-10],[0,60,10],{fov:70});window.engine=engine;window.chunks=chunks;
 engine.start(()=>{chunks.tick();const q=chunks.stats();window.ready=q.resident>0&&q.planning===0&&q.queued+q.in_flight+q.evicting===0&&engine.render_state().settled});
 </script></html>`,
    })
  )
  await page.goto('http://127.0.0.1:5173/water-camera-probe')
  await page.waitForFunction(() => window.ready, {}, { timeout: 90000 })
  const measurements = []
  const poses = [63, 61, 60.2, 60.01, 60.001, 60, 59.999, 59.8, 64].flatMap((height) =>
    [-20, -0.01, 1].map((aim) => ({ height, aim }))
  )
  for (const origin of [0, 16384]) {
    await page.evaluate((o) => window.chunks.set_focus(o, o), origin)
    for (const { height, aim } of poses) {
      await page.evaluate(
        ({ origin, height, aim }) =>
          window.engine.set_camera([origin, height, origin], [origin + 10, height + aim, origin + 10], { fov: 70 }),
        { origin, height, aim }
      )
      await page.waitForTimeout(60)
      const shot = await page.screenshot()
      const black = await page.evaluate(
        async (bytes) => {
          const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
          const c = document.createElement('canvas')
          c.width = 640
          c.height = 480
          const ctx = c.getContext('2d')
          ctx.drawImage(bitmap, 0, 0)
          bitmap.close()
          const p = ctx.getImageData(0, 0, 640, 480).data
          let n = 0
          for (let i = 0; i < p.length; i += 4) if (p[i] < 3 && p[i + 1] < 3 && p[i + 2] < 3) n++
          return n / (640 * 480)
        },
        [...shot]
      )
      measurements.push({ origin, height, aim, black })
      if (black > 0.02) {
        await page.screenshot({ path: 'test-results/water-camera/failure.png' })
        console.log('REPRO', JSON.stringify(measurements.at(-1)))
      }
    }
  }
  const worst = measurements.toSorted((a, b) => b.black - a.black).slice(0, 8)
  console.log(JSON.stringify({ errors, worst }))
  assert.deepEqual(errors, [])
  assert.ok(worst[0].black < 0.02, 'Water normal must remain finite across camera angles and large world coordinates')
} finally {
  await browser.close()
}
