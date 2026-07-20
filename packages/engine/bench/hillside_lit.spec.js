// PROOF spec (light_engine BFS, brief §6): capture the previously-black terraced hillside now
// sun-graded. Bare headed launch (no custom GPU args), hard-navigate the demo so the world
// regenerates from scratch with the new skylight flood, monkeypatch the `__engine` camera setters
// to PIN a fixed oblique pose looking across a coastal hillside near spawn (the demo's rAF loop
// pushes `state` every frame, so pinning the setters is the only way to hold a pose under
// automation where pointer-lock is blocked), let the ring stream drain, then screenshot the canvas.
//
// Not a pass/fail gate on light values (the probe tallies in the report do that headlessly and
// deterministically) — this is the visual artifact: the hillside reads graded, not banded-black.
// Writes bench/results/hillside_lit.png; the run copies it to /tmp/aresrpg-engine-artifacts/.

import { mkdir, copyFile } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { MASTER_SEED } from '../src/config/world_config.js'

import { goto_demo, probe_gpu_adapter, capture_canvas_screenshot } from './harness.js'

const ARTIFACTS = '/tmp/aresrpg-engine-artifacts'

// Oblique vantage over a coastal hillside near spawn (surface ≈ y142-148 rising +x from a shoreline
// at z≈-15). Camera sits south-west and above the low end, looking north-east and slightly down so
// the terraced risers (the cells that used to encode black) fill the frame side-on.
const CAM_POS = /** @type {[number, number, number]} */ ([-4, 168, 4])
const CAM_YAW = -Math.PI / 4 // face +x/+z (toward the rising hillside)
const CAM_PITCH = -0.55 // tilt down onto the slope

test('proof: terraced hillside renders sun-graded (not banded-black) after the skylight BFS', async ({ page }) => {
  await mkdir(ARTIFACTS, { recursive: true })

  // Hard navigation regenerates the world with the new light engine (no stale cache).
  await goto_demo(page, { seed: MASTER_SEED })
  const adapter = await probe_gpu_adapter(page)
  expect(adapter.ok, adapter.reason).toBe(true)

  // Pin the pose: replace the engine's camera setters so the demo's per-frame `state` push can't
  // drag the camera back to its default overview — then apply our pose once through the originals.
  await page.evaluate(
    ({ pos, yaw, pitch }) => {
      const engine = /** @type {any} */ (window).__engine
      const set_pos = engine.set_camera_position.bind(engine)
      const set_orient = engine.set_camera_orientation.bind(engine)
      set_pos(pos)
      set_orient(yaw, pitch)
      engine.set_camera_position = () => {} // ignore the rAF loop's pushes
      engine.set_camera_orientation = () => {}
    },
    { pos: CAM_POS, yaw: CAM_YAW, pitch: CAM_PITCH }
  )

  // Let the ring stream the world in around the pinned camera, then settle.
  await page
    .waitForFunction(() => /** @type {any} */ (window.__engine?.get_stats?.().chunk_queue_depth ?? 1) === 0, {
      timeout: 20000,
    })
    .catch(() => {})
  await page.waitForTimeout(3000)

  const shot = await capture_canvas_screenshot(page, 'hillside_lit')
  await copyFile(shot.path, `${ARTIFACTS}/hillside_lit.png`)
  test.info().annotations.push({ type: 'proof-screenshot', description: `${ARTIFACTS}/hillside_lit.png` })

  // Sanity: the frame is real lit terrain (not blank, not all-sky). Variance well above a blank
  // canvas; and the graded hillside means a spread of luminance (risers darker than tops), so mean
  // sits in the mid-range rather than pinned bright or black.
  expect(shot.variance, `canvas looks blank (variance ${shot.variance.toFixed(2)}) — see ${shot.path}`).toBeGreaterThan(
    4
  )
  console.log(
    `[hillside proof] screenshot ${ARTIFACTS}/hillside_lit.png  variance=${shot.variance.toFixed(2)} mean=${shot.mean.toFixed(1)}`
  )
})
