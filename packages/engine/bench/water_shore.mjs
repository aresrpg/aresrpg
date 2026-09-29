// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Run against bun run dev: bun packages/engine/bench/water_shore.mjs
// --raised reproduces the thin-sheet regression without changing working-tree code.
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const results = []
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 320 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.route('**/water-shore-probe', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><style>html,body{margin:0}canvas{display:block;width:100vw;height:100vh}</style><canvas></canvas><script type="module">
import {create_engine,compile_world_recipe,BIOME_SLOTS,create_terrain_planner} from '/@fs${root}packages/engine/src/index.ts';
import {create_chunk_manager} from '/src/game/core/chunks.ts';
const world=compile_world_recipe({seed:'water-shore-regression',sea_level:${process.argv.includes('--raised') ? '60.04' : '60'},liquid:'water',portal:false,atmosphere:'clear',materials:{sand:{color:'#d5bc7f',preset:'sand'},water:{color:'#2e609e',preset:'water'}},biome_slots:Object.fromEntries(BIOME_SLOTS.map(slot=>[slot,'bed'])),biomes:[{name:'bed',landscape:[{x:0,y:60,land:{surface:'sand',subsurface:'sand',filler:'sand'}},{x:1,y:60}]}]});
const engine=create_engine({canvas:document.querySelector('canvas'),world,quality:'high',render_distance:2});
const planner=create_terrain_planner(world.recipe);
const chunks=create_chunk_manager({engine,initial_quality:'high',initial_render_distance:2,plan_layers:planner.plan});
chunks.set_focus(0,0);engine.set_clouds_visible(false);engine.set_time_of_day(.32);engine.set_audio_volume(0);
engine.set_camera([0,66,0],[0,60,10],{fov:45});
window.quality=q=>{engine.set_quality(q,2);chunks.set_quality(q,2)};
window.camera=()=>engine.set_camera([7,67,4],[0,60,12],{fov:55});
engine.start(()=>{chunks.tick();const q=chunks.stats();window.ready=q.resident>0&&q.planning===0&&q.queued+q.in_flight+q.evicting===0&&engine.render_state().settled;});
</script></html>`,
    })
  )
  await page.goto('http://127.0.0.1:5173/water-shore-probe')
  await page.waitForFunction(() => window.ready, {}, { timeout: 120000 })
  const capture = async () => {
    const bytes = await page.screenshot()
    return page.evaluate(
      async (bytes) => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
        const canvas = document.createElement('canvas')
        canvas.width = 480
        canvas.height = 320
        const context = canvas.getContext('2d')
        context.drawImage(bitmap, 0, 0)
        bitmap.close()
        return [...context.getImageData(140, 180, 200, 100).data]
      },
      [...bytes]
    )
  }
  for (const quality of ['high', 'medium', 'low', 'high']) {
    await page.evaluate((quality) => window.quality(quality), quality)
    await page.waitForFunction(() => window.ready, {}, { timeout: 120000 })
    await page.waitForTimeout(500)
    const before = await capture()
    await page.waitForTimeout(1200)
    const after = await capture()
    const delta = before.reduce((sum, value, index) => sum + Math.abs(value - after[index]), 0) / before.length
    results.push({ quality, dry_shelf_delta: delta })
    assert.ok(delta < 0.1, `Sea-level sand animates like water on ${quality}: ${delta}`)
    await page.evaluate(() => window.camera())
  }
  assert.deepEqual(errors, [])
} finally {
  console.log(JSON.stringify(results, null, 2))
  await browser.close()
}
