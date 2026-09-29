// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Run against bun run dev: bun packages/engine/bench/canopy_forest.mjs [clusters|voxels]
// Fixed sun/camera/terrain-only views, warm-up, repeated samples and a GPU completion fence.
// Timing remains machine/load dependent; screenshots make each measured view reviewable.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import { chromium } from '@playwright/test'

import { install_probe } from '../../frontend/e2e/support/browser_probe.ts'

const shape = process.argv[2] ?? 'clusters'
if (!['clusters', 'voxels'].includes(shape)) throw new Error('Choose clusters or voxels')
const root = fileURLToPath(new URL('../../../', import.meta.url))
const directory = resolve(root, 'output/foliage-review')
await mkdir(directory, { recursive: true })
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--disable-frame-rate-limit', '--disable-gpu-vsync'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.addInitScript(install_probe)
  await page.route('**/canopy-profile', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><style>html,body{margin:0}canvas{width:100vw;height:100vh;display:block}</style><canvas></canvas><script type="module">
 import {create_engine,compile_runtime_world_recipe,create_terrain_planner,sample_world_column} from '/@fs${root}packages/engine/src/index.ts';
 import {create_chunk_manager} from '/src/game/core/chunks.ts';
 import worlds from '/@fs${root}seed/content/worlds.json';
 const focus=[-1024,-128];const world=compile_runtime_world_recipe({...worlds[0].terrain,portal:false,canopy:'${shape === 'voxels' ? 'voxels' : 'clusters'}'});
 const floor=sample_world_column(world,...focus).surface_y;
 const engine=create_engine({canvas:document.querySelector('canvas'),world,quality:'high',render_distance:3,initial_focus:focus});
 const planner=create_terrain_planner(world.recipe);const chunks=create_chunk_manager({engine,initial_quality:'high',initial_render_distance:3,plan_layers:planner.plan});chunks.set_focus(...focus);engine.set_time_of_day(.31);engine.set_clouds_visible(false);
 const pose=(index)=>{const [x,z]=focus;const views=[[[x+90,floor+50,z+90],[x,floor+12,z]],[[x+4,floor+2,z+5],[x+24,floor+4,z-20]],[[x-70,floor+18,z+60],[x,floor+12,z]]];engine.set_camera(...views[index],{fov:65})};pose(0);
 engine.start(()=>{chunks.tick();const c=chunks.stats();window.ready=engine.render_state().settled&&c.resident>0&&c.queued+c.in_flight+c.planning+c.evicting===0});
 window.pose=pose;
 window.measure=async(frames=360)=>{engine.stop();await window.workload_gpu_done();let count=0;const samples=[];let previous=performance.now();const started=previous;await new Promise(resolve=>engine.start(()=>{chunks.tick();const now=performance.now();samples.push(now-previous);previous=now;if(++count===frames){engine.stop();resolve()}}));await window.workload_gpu_done();const duration=performance.now()-started;samples.sort((a,b)=>a-b);return{completed_frame_ms:duration/frames,p95_callback_ms:samples[Math.ceil(samples.length*.95)-1],frames}};
 window.addEventListener('pagehide',()=>{chunks.dispose();planner.dispose();engine.dispose()},{once:true});
 window.stats=()=>({engine:engine.status(),render:engine.render_state(),chunks:chunks.stats(),gpu:window.workload_resources(),adapter:window.workload_adapter});
 </script></html>`,
    })
  )
  await page.goto('http://127.0.0.1:5173/canopy-profile')
  await page.waitForFunction(() => window.ready, {}, { timeout: 90000 })
  const results = []
  for (let pose = 0; pose < 3; pose++) {
    await page.evaluate((i) => window.pose(i), pose)
    await page.evaluate(() => window.measure(120))
    const runs = []
    for (let r = 0; r < 3; r++) runs.push(await page.evaluate(() => window.measure()))
    await page.screenshot({ path: resolve(directory, shape + '-' + pose + '.png') })
    results.push({ pose, runs })
    console.log(shape, pose, JSON.stringify(runs))
  }
  const result = { shape, errors, results, state: await page.evaluate(() => window.stats()) }
  await writeFile(resolve(directory, shape + '.json'), JSON.stringify(result, null, 2))
  console.log('DONE', shape, JSON.stringify({ errors, state: result.state }))
  assert.deepEqual(errors, [])
  assert.equal(result.state.engine.state, 'ready')
} finally {
  await browser.close()
}
