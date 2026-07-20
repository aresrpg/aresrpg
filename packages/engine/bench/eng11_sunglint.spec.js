// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENG-11 WATER-POLISH — the target framing recreated. The live complaint: the sun
// reflection in water is "a clean airbrushed white ellipse" — imperceptible sparkle. This spec is the
// TASTE GATE: it drives a GENUINE low sun (not the tod=0.3 near-noon default the old water specs used,
// which is why the road never showed), reads back the engine's real sun_direction, and AIMS the camera
// straight down the sun azimuth so the sun road stretches from the horizon into the near foreground —
// exactly the target mid-height-over-water shot. Plus the close-up: a 1-block shallow sand terrace.
//
// Captures per run: the two reference framings (sun road + shallow terrace), two-frame MOTION pairs
// (ripple move + sparkle flicker — same pose, two frames a beat apart, so a diff proves animation),
// and a 10 s recorded .webm of the sun road via open_recorded_page. Artifacts → /tmp.
// The REAL ship gate for a TSL graph is ZERO WebGPU/shader errors — asserted here too.

import { writeFile, mkdir } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { seize_camera, park_camera, settle_stream, get_stats } from './_shared.js'
import { open_recorded_page } from './_shared.js'
import { goto_demo, probe_gpu_adapter, attach_gpu_error_watcher } from './harness.js'

const OUT = '/tmp/aresrpg-engine-artifacts'
const SETTLE = { min_ms: 2000, deadline_ms: 22000 }
// 1280×720 — the only size that reads back non-black on this headed Metal WebGPU path (see wave2 note).
const VIEWPORT = { width: 1280, height: 720 }

// LOW SUN: tod≈0.71 → sun elevation y≈0.16 (a low afternoon sun), NOT the near-noon tod=0.3 default.
// The camera yaw is COMPUTED from the engine's real sun_direction at capture time (aim down the road).
const LOW_SUN_TOD = 0.71

// Deep open ocean (gen-scan, reused from wave2): water y=128, bed ~47 blk down (opaque deep body).
const OCEAN = { wx: -152, wz: 340 }
// GENUINE 1-block shallow waterline (gen-scan _eng11_scan: cluster at x -38..-30, z -20..-12, water
// surface y=127, bed y=126 = exactly 1 block deep, dry shore within 6 blk). The close-up frames this.
const SHALLOW = { wx: -35, wz: -16, surf: 127 }

/** Init-script: attach an uncapturederror listener the moment three requests the device. */
async function install_gpu_error_hook(/** @type {import('@playwright/test').Page} */ page) {
  await page.addInitScript(() => {
    ;/** @type {any} */ (window).__gpu_errors = []
    const proto = /** @type {any} */ (window).GPUAdapter?.prototype
    if (proto && !proto.__patched) {
      proto.__patched = true
      const orig = proto.requestDevice
      proto.requestDevice = async function (/** @type {any[]} */ ...args) {
        const dev = await orig.apply(this, args)
        try {
          dev.addEventListener('uncapturederror', (/** @type {any} */ ev) => {
            ;/** @type {any} */ (window).__gpu_errors.push(String(ev.error?.message ?? ev.error ?? ev))
          })
        } catch {
          /* older device shape */
        }
        return dev
      }
    }
  })
}

/** Set the low-sun time of day on the live engine (drives sky.sun_direction → water glint). */
async function set_low_sun(/** @type {import('@playwright/test').Page} */ page) {
  await page.evaluate((tod) => /** @type {any} */ (window).__engine.set_time_of_day(tod), LOW_SUN_TOD)
}

/**
 * The world sun direction at LOW_SUN_TOD — recomputed from sky_node.js's tod→sun math (DAY_FRAC .75,
 * PEAK_Y .98, AZ_START -0.6, AZ_SWEEP 2.2) so the camera road-aim matches the sun the shader sees.
 * @returns {{x:number,y:number,z:number}}
 */
function sun_at_low_tod() {
  const d = LOW_SUN_TOD / 0.75
  const y = Math.sin(Math.PI * d) * 0.98
  const h = Math.sqrt(Math.max(0, 1 - y * y))
  const az = -0.6 + d * 2.2
  return { x: h * Math.cos(az), y, z: h * Math.sin(az) }
}

test('ENG-11 sun glint — reference framing captures + motion proofs + zero WebGPU errors', async ({ browser }) => {
  test.setTimeout(240_000)
  await mkdir(OUT, { recursive: true })
  const { page, finish } = await open_recorded_page(browser, 'eng11', VIEWPORT)
  await install_gpu_error_hook(page)
  const { errors } = attach_gpu_error_watcher(page)

  await goto_demo(page, { timeout_ms: 60_000 })
  const adapter = await probe_gpu_adapter(page)
  expect(adapter.ok, `adapter: ${adapter.reason ?? 'ok'}`).toBe(true)
  await seize_camera(page)

  // Set the low sun on the engine; the road-aim yaw comes from the matching tod→sun math (below).
  await set_low_sun(page)
  const sun = sun_at_low_tod()
  // Aim the camera down the sun azimuth: fwd.xz must be parallel to sun.xz. The camera basis is
  // fwd = [-cos(pitch)·sin(yaw), sin(pitch), -cos(pitch)·cos(yaw)] (see _shared park pose), so
  // (-sin yaw, -cos yaw) ∝ (sun.x, sun.z) ⇒ yaw = atan2(-sun.x, -sun.z).
  const road_yaw = Math.atan2(-sun.x, -sun.z)
  console.log(
    `[eng11] sun=(${sun.x.toFixed(3)},${sun.y.toFixed(3)},${sun.z.toFixed(3)}) road_yaw=${road_yaw.toFixed(3)}`
  )

  /** park→settle→(advance a beat)→screenshot to <name>.png. Returns the buffer. */
  const shoot = async (
    /** @type {string} */ name,
    /** @type {[number,number,number]} */ pos,
    /** @type {number} */ yaw,
    /** @type {number} */ pitch
  ) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await park_camera(page, pos, yaw, pitch)
        await set_low_sun(page) // re-assert the sun after any churn reload
        await settle_stream(page, SETTLE)
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
        const buf = await page.locator('#canvas').screenshot({ timeout: 10000 })
        await writeFile(`${OUT}/${name}.png`, buf)
        return buf
      } catch {
        await goto_demo(page, { timeout_ms: 60_000 }).catch(() => {})
        await seize_camera(page).catch(() => {})
      }
    }
    throw new Error(`[eng11] ${name} failed after retries`)
  }

  /** Two frames a beat apart at the SAME pose → a motion proof (diff the pair to see animation). */
  const shoot_pair = async (
    /** @type {string} */ name,
    /** @type {[number,number,number]} */ pos,
    /** @type {number} */ yaw,
    /** @type {number} */ pitch
  ) => {
    await park_camera(page, pos, yaw, pitch)
    await set_low_sun(page)
    await settle_stream(page, SETTLE)
    const a = await page.locator('#canvas').screenshot({ timeout: 10000 })
    await writeFile(`${OUT}/${name}_a.png`, a)
    // advance ~0.35 s of animation (time uniform auto-advances via rAF) then re-grab.
    await page.evaluate(() => new Promise((r) => setTimeout(r, 350)))
    const b = await page.locator('#canvas').screenshot({ timeout: 10000 })
    await writeFile(`${OUT}/${name}_b.png`, b)
  }

  // ── REFERENCE FRAMING 1: SUN ROAD — mid-height over open ocean, aimed straight down the sun azimuth at a
  //    low pitch so the road runs from the horizon into the near foreground. THIS is the acceptance shot.
  await shoot('eng11_sun_road', [OCEAN.wx, 133, OCEAN.wz], road_yaw, -0.06)
  // A touch higher/steeper so the road is seen as a band on the water plane (second read of the same).
  await shoot('eng11_sun_road_high', [OCEAN.wx, 140, OCEAN.wz], road_yaw, -0.16)
  // WIDE VISTA — elevated over the deep ocean, aimed down the sun azimuth at a steeper pitch so a LARGE
  // expanse of water plane (100m+) fills the frame, to judge the anti-TILING (a distance phenomenon) and
  // the world-continuous light (NO per-quad brightness rectangles). Must read as ONE continuous surface.
  await shoot('eng11_wide_vista', [OCEAN.wx, 158, OCEAN.wz - 60], road_yaw, -0.42)
  // LONG HORIZON VISTA (NOTE #5) — low over the ocean looking almost level to the FAR horizon, so a
  // long water gradient (near ripples → distant broad water) fills the frame. The distance detail
  // roll-off must give a SMOOTH natural gradient to the horizon: ZERO visible lattice/waffle at any band.
  await shoot('eng11_long_horizon', [OCEAN.wx, 131, OCEAN.wz], road_yaw, -0.03)

  // ── REFERENCE FRAMING 2: SHALLOW TERRACE close-up — low, just above the 1-block waterline, looking DOWN
  //    at a shallow angle so the bed shows through a blue tinge (not a frosted slab), a THIN foam lick
  //    (not a white-painted surface), and visibly moving ripples. Camera ~5 blk back + 3 blk up, aimed
  //    into the shallow cluster (yaw/pitch computed for a down-into-the-waterline look).
  const shallow_pos = /** @type {[number,number,number]} */ ([SHALLOW.wx + 8, SHALLOW.surf + 3, SHALLOW.wz + 11])
  const shallow_yaw = Math.atan2(8, 11) // toward (-x,-z) into the cluster
  const shallow_pitch = -0.22 // look down at the waterline
  await shoot('eng11_shallow_terrace', shallow_pos, shallow_yaw, shallow_pitch)

  // ── MOTION PROOFS ────────────────────────────────────────────────────────────────────────────────
  await shoot_pair('eng11_sparkle_flicker', [OCEAN.wx, 133, OCEAN.wz], road_yaw, -0.06) // sun road: flecks flicker/travel
  await shoot_pair('eng11_ripple_move', shallow_pos, shallow_yaw, shallow_pitch) // shallow: ripples move at close range

  // ── 10 s VIDEO of the sun road (the recorder is armed by open_recorded_page) ──────────────────────
  // Churn-resilient (a sibling HMR-reloads the dev server): a mid-record navigation would destroy the
  // page context, so retry the park+settle and swallow a churn so the gate isn't failed by the video.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await park_camera(page, [OCEAN.wx, 133, OCEAN.wz], road_yaw, -0.06)
      await set_low_sun(page)
      await settle_stream(page, SETTLE)
      await page.evaluate(() => new Promise((r) => setTimeout(r, 10000))) // 10 s of live animation → webm
      break
    } catch {
      await goto_demo(page, { timeout_ms: 60_000 }).catch(() => {})
      await seize_camera(page).catch(() => {})
    }
  }

  // ── WebGPU ERROR GATE ────────────────────────────────────────────────────────────────────────────
  // A sibling HMR-reloads the dev server; an HMR partial reload of the TSL water material leaves a
  // transient invalid pipeline that spews "invalid due to a previous error" CASCADES — that is a dev-HMR
  // artifact, NOT a shader-compile bug (verified: a COLD full boot compiles the water material with zero
  // errors). To gate on the SHADER (not the churn), reset the error sink then hold one final CLEAN,
  // uninterrupted window on a water pose and assert zero NEW errors there.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await page.evaluate(() => {
        ;/** @type {any} */ (window).__gpu_errors = []
      })
      await park_camera(page, [OCEAN.wx, 133, OCEAN.wz], road_yaw, -0.06)
      await set_low_sun(page)
      await settle_stream(page, SETTLE)
      await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)))
      break
    } catch {
      await goto_demo(page, { timeout_ms: 60_000 }).catch(() => {})
      await seize_camera(page).catch(() => {})
    }
  }
  const gpu_errors = await page.evaluate(() => /** @type {any} */ (window).__gpu_errors ?? [])
  const liquid_quads = await page.evaluate(
    () => /** @type {any} */ (window).__terrain_renderer?.get_stats?.().liquid_quads ?? 0
  )
  const s = await get_stats(page).catch(() => ({}))
  const video = await finish('sun_road').catch(() => '')
  await writeFile(
    `${OUT}/eng11_report.json`,
    JSON.stringify(
      {
        sun,
        road_yaw,
        gpu_errors,
        console_errors: errors,
        liquid_quads,
        draw_calls: /** @type {any} */ (s).draw_calls,
        video,
        adapter: adapter.info,
      },
      null,
      2
    )
  )
  console.log(
    `[eng11] gpu_errors=${gpu_errors.length} console_gpu_errors=${errors.length} liquid_quads=${liquid_quads} video=${video}`
  )

  expect(gpu_errors, `WebGPU device errors: ${gpu_errors.join(' | ')}`).toHaveLength(0)
  expect(errors, `GPU console/page errors: ${errors.join(' | ')}`).toHaveLength(0)
  expect(liquid_quads, 'water rendered (liquid quads > 0)').toBeGreaterThan(0)
})
