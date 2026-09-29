// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The fixed west-facing view excludes the sun/moon reflection lobes at the tested phases.
// Run against `bun run dev`: bun packages/engine/bench/water_lighting.mjs
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const results = []
try {
  for (const [quality, frozen, planar] of [
    ['low', false, false],
    ['medium', false, false],
    ['high', false, false],
    ['high', true, false],
    ['low', false, true],
    ['medium', false, true],
    ['high', true, true],
  ]) {
    const page = await browser.newPage({ viewport: { width: 480, height: 320 } }),
      errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.route('**/water-lighting-probe', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<html><style>html,body{margin:0}canvas{display:block;width:100vw;height:100vh}</style><canvas></canvas><script type="module">
import {create_engine,compile_world_recipe,BIOME_SLOTS,create_terrain_planner} from '/@fs${root}packages/engine/src/index.ts';
import {create_chunk_manager} from '/src/game/core/chunks.ts';
const world=compile_world_recipe({seed:'water-lighting-regression',sea_level:60,liquid:'water',portal:false,atmosphere:'clear',${frozen ? "water_surface:'frozen_shore'," : ''}${planar ? "water_reflection:'planar'," : ''}materials:{stone:{color:'#59625f',preset:'stone'},water:{color:'#268bb8',preset:'water'}},biome_slots:Object.fromEntries(BIOME_SLOTS.map(slot=>[slot,'bed'])),biomes:[{name:'bed',landscape:[{x:0,y:59,land:{surface:'stone',subsurface:'stone',filler:'stone'}},{x:1,y:59}]}]});
const engine=create_engine({canvas:document.querySelector('canvas'),world,quality:'${quality}',render_distance:2});
const planner=create_terrain_planner(world.recipe);
const chunks=create_chunk_manager({engine,initial_quality:'${quality}',initial_render_distance:2,plan_layers:planner.plan});
chunks.set_focus(0,0);engine.set_clouds_visible(false);engine.set_time_of_day(.32);engine.set_camera([5,63,0],[-5,60,0],{fov:45});
window.night=()=>engine.set_time_of_day(.9);
engine.start(()=>{chunks.tick();const q=chunks.stats();window.ready=q.resident>0&&q.planning===0&&q.queued+q.in_flight+q.evicting===0&&engine.render_state().settled;});
</script></html>`,
      })
    )
    await page.goto('http://127.0.0.1:5173/water-lighting-probe')
    await page.waitForFunction(() => window.ready, {}, { timeout: 120000 })
    const luminance = async () => {
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
          const pixels = context.getImageData(160, 130, 160, 80).data
          let total = 0
          for (let i = 0; i < pixels.length; i += 4)
            total += pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722
          return total / (pixels.length / 4)
        },
        [...bytes]
      )
    }
    const day = await luminance()
    await page.evaluate(() => window.night())
    await page.waitForTimeout(500)
    const night = await luminance(),
      ratio = night / day
    results.push({ quality, frozen, planar, day, night, ratio })
    assert.deepEqual(errors, [])
    assert.ok(day > 30, 'Probe must render visible water, not a black canvas')
    assert.ok(
      ratio < 0.7,
      `${quality} ${frozen ? 'ice' : 'water'} remains too bright at night (${ratio.toFixed(3)} of daylight)`
    )
    await page.close()
  }
} finally {
  console.log(JSON.stringify(results, null, 2))
  await browser.close()
}
