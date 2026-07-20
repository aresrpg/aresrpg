// D33 shipped-default verification (throwaway probe, not a committed gate). Boots the demo at the
// SHIPPED LOAD_RADIUS_CHUNKS (no ?load_radius override), on a settled tree, and asserts the render is
// clean: zero WebGPU errors during a settled window + a short fly, a non-black frame, and captures the
// spawn-overlook screenshot as d33_after.png at the CORRECT overlook pose (the sweep's d33_after was
// left mid-fly because the automated pick rejected all radii on HMR-induced pipeline noise). This is the
// firsthand proof the shipped default is healthy once sibling HMR churn stopped.

import { test, expect } from '@playwright/test'

import { MASTER_SEED } from '../src/config/world_config.js'

import { attach_gpu_error_watcher, RESULTS_DIR } from './harness.js'

const OVERLOOK = /** @type {[number,number,number]} */ ([70, 175, 70])
const OVERLOOK_YAW = Math.PI / 4
const OVERLOOK_PITCH = -0.5

/** @param {import('@playwright/test').Page} page */
function seize_and_park(page) {
  return page.evaluate(
    ({ position, yaw, pitch }) => {
      const engine = /** @type {any} */ (window).__engine
      if (!(/** @type {any} */ (window).__cam)) {
        const real_pos = engine.set_camera_position.bind(engine)
        const real_orient = engine.set_camera_orientation.bind(engine)
        engine.set_camera_position = () => {}
        engine.set_camera_orientation = () => {}
        ;/** @type {any} */ (window).__cam = { real_pos, real_orient }
      }
      const cam = /** @type {any} */ (window).__cam
      cam.real_pos(position)
      cam.real_orient(yaw, pitch)
    },
    { position: OVERLOOK, yaw: OVERLOOK_YAW, pitch: OVERLOOK_PITCH }
  )
}

/** @param {import('@playwright/test').Page} page */
function wait_drain(page) {
  return page.evaluate(async () => {
    const engine = /** @type {any} */ (window).__engine
    const start = performance.now()
    let stable = 0
    while (performance.now() - start < 30000) {
      await new Promise((r) => requestAnimationFrame(r))
      if (Number(engine?.get_stats?.().chunk_queue_depth ?? 0) === 0) {
        if (++stable >= 12) break
      } else stable = 0
    }
    return performance.now() - start
  })
}

test('D33 verify — shipped default renders clean + overlook shot', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 720 })

  // Warm-up to absorb Vite reopt BEFORE the measured load. Two throwaway loads + long settles eat the
  // dependency-reoptimization full-reload that would otherwise destroy the execution context mid-probe
  // (the documented Vite gotcha — see cube_planes.spec.js). Both goto's tolerate a reopt navigation.
  for (let i = 0; i < 2; i += 1) {
    await page.goto('http://localhost:5199/demo/', { waitUntil: 'networkidle' }).catch(() => {})
    await page.waitForTimeout(3500)
  }

  // Boot the SHIPPED default (no load_radius param). Attach the watcher AFTER navigation + boot settle
  // so a device teardown from the nav itself isn't counted — we measure errors during steady render.
  await page.goto(`http://localhost:5199/demo/?seed=${MASTER_SEED}&tier=high`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#gate[data-hidden="true"]', { state: 'attached', timeout: 20_000 })
  // A reopt reload can still fire right after boot; give it a settle beat and re-park if the context
  // survived (seize/park are idempotent). If a navigation destroyed the context, re-establish the pose.
  await page.waitForTimeout(2500)
  await seize_and_park(page).catch(async () => {
    await page.waitForSelector('#gate[data-hidden="true"]', { state: 'attached', timeout: 20_000 })
    await seize_and_park(page)
  })
  await wait_drain(page)
  await page.waitForTimeout(1000)

  // NOW start watching — steady state, world drained, no HMR expected.
  const watcher = attach_gpu_error_watcher(page)

  // Confirm the shipped radius is what we expect (7) and the fog wall tracks it.
  const info = await page.evaluate(async () => {
    const { LOAD_RADIUS_CHUNKS, CHUNK_SIZE } = await import('/src/config/world_config.js')
    const scene = /** @type {any} */ (window).__ares_scene__
    const stats = /** @type {any} */ (window).__engine?.get_stats?.() ?? {}
    return {
      radius: LOAD_RADIUS_CHUNKS,
      loaded_edge_m: LOAD_RADIUS_CHUNKS * CHUNK_SIZE,
      fog_far: scene?.fog?.far ?? null,
      fog_near: scene?.fog?.near ?? null,
      quads: stats.quad_count ?? 0,
      draws: stats.draw_calls ?? 0,
    }
  })
  console.log(
    `[D33 verify] shipped radius ${info.radius} (edge ${info.loaded_edge_m}m) fog near ${info.fog_near} far ${info.fog_far} | quads ${info.quads} draws ${info.draws}`
  )

  // Settled window: watch for GPU errors over 3 s parked + a 4 s in-place stress (drain uploads etc.).
  await page.waitForTimeout(3000)

  // Overlook screenshot at the CORRECT pose (this is the real d33_after companion to d33_before/r5).
  await page.locator('#canvas').screenshot({ path: `${RESULTS_DIR}/d33_after.png` })

  // Short fly to shake out any pipeline recompile that only fires on new-chunk uploads (the true render
  // path stress) — still steady-state relative to HMR, so any error here is a real one.
  await page.evaluate(
    ({ from, yaw, pitch }) => {
      const cam = /** @type {any} */ (window).__cam
      cam.real_orient(yaw, pitch)
      const to = [from[0] - 200 * Math.sin(yaw), from[1], from[2] - 200 * Math.cos(yaw)]
      return new Promise((resolve) => {
        const start = performance.now()
        const step = () => {
          const t = Math.min(1, (performance.now() - start) / 5000)
          cam.real_pos([from[0] + (to[0] - from[0]) * t, from[1], from[2] + (to[2] - from[2]) * t])
          if (t < 1) requestAnimationFrame(step)
          else resolve(undefined)
        }
        requestAnimationFrame(step)
      })
    },
    { from: OVERLOOK, yaw: OVERLOOK_YAW, pitch: OVERLOOK_PITCH }
  )
  await wait_drain(page)

  const { errors } = watcher
  console.log(`[D33 verify] GPU errors during settled render + fly: ${errors.length}`)
  if (errors.length > 0) console.log(errors.slice(0, 4).join('\n---\n'))

  expect(Number(info.quads), 'no quads rendered — dead world').toBeGreaterThan(1000)
  expect(info.radius, 'shipped LOAD_RADIUS_CHUNKS should be 6 (the largest gate-passing D33 radius)').toBe(6)
  expect(info.fog_far, 'fog far should track the r6 ceiling ((6−1.5)·32 = 144 m)').toBeGreaterThan(130)
  expect(errors, `GPU errors on a settled clean load:\n${errors.slice(0, 4).join('\n')}`).toHaveLength(0)
})
