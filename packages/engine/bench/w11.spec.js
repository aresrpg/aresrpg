// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// W11 measurement spec — before/after for the five render-lane tasks (shadow-follow, shadow-cache,
// fog/pop-in pairing, per-chunk upload cost, riser readability) + the dispose teardown is unit-tested
// in src/render/pool_renderer.test.js. HEADED Chromium on the Studio's Metal GPU (the source of
// truth, per §7). Reuses bench/harness.js helpers; drives the camera directly (seize + monkeypatch
// the demo's per-frame pose push, the hard-won automation gotcha).
//
// This spec captures the AFTER state (current build) and, for the perf tasks, A/Bs at runtime:
//   • T2 shadow-cache: flip `sun.shadow.autoUpdate` true(before)/false(after) via window.__ares_scene__
//     and compare frame-time p50/p99 across an identical window — no source revert needed. Measured
//     both combined (with streaming noise) and at drained steady state (the clean signal).
//   • T4 upload cost: measure get_stats().frame_ms_p99 during a 200 m fly. Root-caused, not just
//     timed — see the t4 note below + the report (material-sharing impossible + prewarm ineffective,
//     both verified against installed three source and by A/B measurement, so prewarm was removed).
// T5 (riser readability) is a two-build A/B captured OUT of band (screenshots taken with/without the
// AO-floor edit) — this spec only takes the terrace shot for the record (name via RISER_SHOT env).
//
// All numbers are appended into /tmp/aresrpg-engine-artifacts/w11_report.json.

import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { MASTER_SEED } from '../src/config/world_config.js'

import {
  goto_demo,
  probe_gpu_adapter,
  capture_canvas_screenshot,
  attach_gpu_error_watcher,
  RESULTS_DIR,
} from './harness.js'

const FLY_ALTITUDE = 150
const FLY_PITCH = -0.35 // look down enough that terraces + their cast shadows fill the frame
const YAW = Math.PI / 4

/** @param {import('@playwright/test').Page} page */
function get_stats(page) {
  return page.evaluate(() => /** @type {any} */ (window).__engine?.get_stats?.() ?? {})
}

/** Seize the camera from the demo's per-frame push (idempotent). @param {import('@playwright/test').Page} page */
function seize_camera(page) {
  return page.evaluate(() => {
    const engine = /** @type {any} */ (window).__engine
    if (!engine || /** @type {any} */ (window).__cam) return
    const real_pos = engine.set_camera_position.bind(engine)
    const real_orient = engine.set_camera_orientation.bind(engine)
    engine.set_camera_position = () => {}
    engine.set_camera_orientation = () => {}
    ;/** @type {any} */ (window).__cam = { real_pos, real_orient }
  })
}

/** @param {import('@playwright/test').Page} page @param {[number,number,number]} position @param {number} yaw @param {number} pitch */
function park_camera(page, position, yaw, pitch) {
  return page.evaluate(
    ({ position, yaw, pitch }) => {
      const cam = /** @type {any} */ (window).__cam
      cam.real_pos(position)
      cam.real_orient(yaw, pitch)
    },
    { position, yaw, pitch }
  )
}

/** Linear fly from→to over duration_ms, holding yaw/pitch, pushing the REAL setter each frame.
 * @param {import('@playwright/test').Page} page
 * @param {{from:[number,number,number],to:[number,number,number],yaw:number,pitch:number,duration_ms:number}} plan */
function fly_camera(page, plan) {
  return page.evaluate(({ from, to, yaw, pitch, duration_ms }) => {
    const cam = /** @type {any} */ (window).__cam
    cam.real_orient(yaw, pitch)
    return new Promise((resolve) => {
      const start = performance.now()
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / duration_ms)
        cam.real_pos([
          from[0] + (to[0] - from[0]) * t,
          from[1] + (to[1] - from[1]) * t,
          from[2] + (to[2] - from[2]) * t,
        ])
        if (t < 1) requestAnimationFrame(step)
        else resolve(undefined)
      }
      requestAnimationFrame(step)
    })
  }, plan)
}

/** Capture raw rAF deltas for a wall-clock window. @param {import('@playwright/test').Page} page @param {number} duration_ms */
function capture_frames_during(page, duration_ms) {
  return page.evaluate(async (ms) => {
    /** @type {number[]} */
    const deltas = []
    let previous = await new Promise((r) => requestAnimationFrame(r))
    const end = performance.now() + ms
    while (performance.now() < end) {
      const now = await new Promise((r) => requestAnimationFrame(r))
      deltas.push(/** @type {number} */ (now) - /** @type {number} */ (previous))
      previous = now
    }
    return deltas
  }, duration_ms)
}

/** @param {number[]} values @param {number} p in [0,100] */
function percentile(values, p) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

/** Force the sun's shadow.autoUpdate on/off at runtime (the T2 A/B knob). Returns whether a
 * DirectionalLight with a shadow was found. @param {import('@playwright/test').Page} page @param {boolean} value */
function set_shadow_autoupdate(page, value) {
  return page.evaluate((v) => {
    const scene = /** @type {any} */ (window).__ares_scene__
    if (!scene) return false
    let found = false
    scene.traverse((/** @type {any} */ o) => {
      if (o.isDirectionalLight && o.shadow) {
        o.shadow.autoUpdate = v
        o.shadow.needsUpdate = true // one refresh so the arm starts from a rendered map
        found = true
      }
    })
    return found
  }, value)
}

/** Append a keyed section into w11_report.json (merge, don't clobber prior sections). @param {string} key @param {any} value */
async function report(key, value) {
  await mkdir(RESULTS_DIR, { recursive: true })
  const path = `${RESULTS_DIR}/w11_report.json`
  /** @type {Record<string, any>} */
  let doc = {}
  try {
    doc = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    doc = {}
  }
  doc[key] = value
  doc.updated_iso = new Date().toISOString()
  await writeFile(path, JSON.stringify(doc, null, 2), 'utf8')
}

test('W11 — shadow follow + fog/pop-in + perf A/B, screenshots + numbers', async ({ page }) => {
  test.setTimeout(120_000)
  const watcher = attach_gpu_error_watcher(page)

  // Warm-up load to absorb Vite's dependency re-optimization full-reload (streaming.spec.js note).
  await page.goto('http://localhost:5199/demo/', { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2500)

  await goto_demo(page, { seed: MASTER_SEED })
  const adapter = await probe_gpu_adapter(page)
  expect(adapter.ok, adapter.reason).toBe(true)
  await report('adapter', adapter.info)

  // Let the world stream in around spawn, then seize the camera.
  await page.waitForTimeout(1500)
  await seize_camera(page)

  const SPAWN = /** @type {[number,number,number]} */ ([70, FLY_ALTITUDE, 70])
  await park_camera(page, SPAWN, YAW, FLY_PITCH)
  await page.waitForTimeout(2500) // let the near ring finish

  // ── T2 SHADOW-CACHE A/B ────────────────────────────────────────────────────────────────────────
  // Parked (static camera, static terrain) is the caching sweet spot: with autoUpdate OFF the shadow
  // map renders 0 times/frame; with it ON it re-renders every frame. Measure rAF p50/p99 for each.
  const found = await set_shadow_autoupdate(page, true) // BEFORE: re-render every frame
  expect(found, 'no DirectionalLight+shadow found via __ares_scene__ — T2 knob unavailable').toBe(true)
  await page.waitForTimeout(300)
  const before_deltas = await capture_frames_during(page, 3000)

  await set_shadow_autoupdate(page, false) // AFTER: cached (only re-renders on change)
  await page.waitForTimeout(300)
  const after_deltas = await capture_frames_during(page, 3000)

  const t2 = {
    before_autoupdate_true: {
      p50: percentile(before_deltas, 50),
      p99: percentile(before_deltas, 99),
      frames: before_deltas.length,
    },
    after_autoupdate_false: {
      p50: percentile(after_deltas, 50),
      p99: percentile(after_deltas, 99),
      frames: after_deltas.length,
    },
  }
  await report('t2_shadow_cache', t2)
  console.log(
    `[W11 T2] shadow-cache parked: before(autoUpdate ON) p50 ${t2.before_autoupdate_true.p50.toFixed(2)} p99 ${t2.before_autoupdate_true.p99.toFixed(2)} | after(OFF) p50 ${t2.after_autoupdate_false.p50.toFixed(2)} p99 ${t2.after_autoupdate_false.p99.toFixed(2)}`
  )

  // ── T3 FOG CEILING ───────────────────────────────────────────────────────────────────────────
  const fog = await page.evaluate(() => {
    const scene = /** @type {any} */ (window).__ares_scene__
    return scene?.fog ? { near: scene.fog.near, far: scene.fog.far } : null
  })
  await report('t3_fog', fog)
  // Fog far must stay ≤ the streamed-extent ceiling (fog_far_ceiling_m = (load_radius−1.5)·CHUNK), or
  // chunks are born in front of the fog wall (pop-in). Derived LIVE from the shipped LOAD_RADIUS_CHUNKS
  // rather than a hardcoded constant so this survives a D33-style view-distance bump (was pinned to 112
  // at the old r5; now tracks whatever radius world_config ships — same "read live" rule streaming.spec
  // already follows for the fog onset).
  const ceiling = await page.evaluate(async () => {
    const { LOAD_RADIUS_CHUNKS, CHUNK_SIZE } = await import('/src/config/world_config.js')
    return (LOAD_RADIUS_CHUNKS - 1.5) * CHUNK_SIZE
  })
  expect(fog, 'no fog on scene').not.toBeNull()
  expect(fog?.far, `fog far ${fog?.far} exceeds the ${ceiling} m streamed-extent ceiling → pop-in`).toBeLessThanOrEqual(
    ceiling + 0.5
  )
  console.log(`[W11 T3] fog near ${fog?.near?.toFixed(1)} far ${fog?.far?.toFixed(1)} (ceiling ${ceiling})`)

  // ── T1 SHADOW FOLLOW + T4 UPLOAD p99 (during a 200 m fly) ──────────────────────────────────────
  await set_shadow_autoupdate(page, false) // ensure the shipped (cached-but-following) mode is active
  const dest = /** @type {[number,number,number]} */ ([
    SPAWN[0] - 200 * Math.sin(YAW),
    FLY_ALTITUDE,
    SPAWN[2] - 200 * Math.cos(YAW),
  ])
  const fly_done = fly_camera(page, { from: SPAWN, to: dest, yaw: YAW, pitch: FLY_PITCH, duration_ms: 8000 })
  const fly_deltas = await capture_frames_during(page, 8000)
  await fly_done
  await page.waitForTimeout(500)
  const after_fly_stats = await get_stats(page)

  const t4 = {
    fly_rAF_p50: percentile(fly_deltas, 50),
    fly_rAF_p75: percentile(fly_deltas, 75),
    fly_rAF_p99: percentile(fly_deltas, 99),
    get_stats_p99: Number(after_fly_stats.frame_ms_p99 ?? 0),
    quads: Number(after_fly_stats.quad_count ?? 0),
    draw_calls: Number(after_fly_stats.draw_calls ?? 0),
    frames: fly_deltas.length,
    note: 'p99 tail here is streaming (mesh+upload+GC of the chunk backlog after outrunning the ring), NOT shadows (proven ~0 cost, see t2_shadow_cache_drained) and NOT shader compile (three shares the WGSL program cache across identical-material chunks — verified in source). Per-chunk material pre-warm was built + A/B-measured and showed no reliable win on Metal, so it was removed (see report t4_finding).',
  }
  await report('t4_upload_flight', t4)
  console.log(
    `[W11 T4] 200m fly: rAF p50 ${t4.fly_rAF_p50.toFixed(2)} p75 ${t4.fly_rAF_p75.toFixed(2)} p99 ${t4.fly_rAF_p99.toFixed(2)} | get_stats p99 ${t4.get_stats_p99.toFixed(2)} | quads ${t4.quads}`
  )

  // T1 proof shot: after flying ~200 m from origin (well outside the OLD static ±140 m box), the
  // terrain still casts/receives shadows because the box now follows the camera. Screenshot for the
  // record; the pre-edit reference is /tmp/aresrpg-engine-artifacts/streaming_fly.png.
  await park_camera(page, dest, YAW, FLY_PITCH)
  await page.waitForTimeout(400)
  const shadow_shot = await capture_canvas_screenshot(page, 'shadow_follow')
  await report('t1_shadow_follow_shot', { path: shadow_shot.path, variance: shadow_shot.variance })
  expect(shadow_shot.variance, 'blank canvas after 200m fly').toBeGreaterThan(4)

  // T3 proof shot: chunks are born behind the fog wall — the far edge fades to haze, no hard naked
  // pop-in edge. Same far pose.
  const popin_shot = await capture_canvas_screenshot(page, 'popin_fixed_fly')
  await report('t3_popin_shot', { path: popin_shot.path, variance: popin_shot.variance })
  expect(popin_shot.variance, 'blank canvas for pop-in shot').toBeGreaterThan(4)

  expect(watcher.errors, `W11 fly raised WebGPU errors:\n${watcher.errors.join('\n')}`).toEqual([])

  await page.evaluate(() => /** @type {any} */ (window).__engine?.dispose?.()).catch(() => {})
  await page.goto('about:blank').catch(() => {})
  await page.waitForTimeout(1500)
})

// DIAGNOSTIC: T2 shadow-cache at TRUE steady state (queue fully drained, camera parked). This is the
// scenario caching targets — no streaming noise. A/B frame-time with the sun's shadow.autoUpdate
// ON (before: full-scene shadow re-render every frame) vs OFF (after: 0 re-renders). Isolates the
// shadow render cost from the streaming p99 tail that dominated the combined test above.
test('W11 T2 diagnostic — shadow-cache at drained steady state', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('http://localhost:5199/demo/', { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2000)
  await goto_demo(page, { seed: MASTER_SEED })
  const adapter = await probe_gpu_adapter(page)
  expect(adapter.ok, adapter.reason).toBe(true)
  await seize_camera(page)
  const POSE = /** @type {[number,number,number]} */ ([70, FLY_ALTITUDE, 70])
  await park_camera(page, POSE, YAW, FLY_PITCH)

  // Wait for the stream queue to drain (steady state) — poll get_stats until queue depth ~0 or 25s.
  const drained = await page.evaluate(async () => {
    const engine = /** @type {any} */ (window).__engine
    const deadline = performance.now() + 25000
    let depth = Infinity
    while (performance.now() < deadline) {
      depth = engine?.get_stats?.().chunk_queue_depth ?? 0
      if (depth <= 1) break
      await new Promise((r) => setTimeout(r, 250))
    }
    return depth
  })
  await park_camera(page, POSE, YAW, FLY_PITCH)
  await page.waitForTimeout(500)

  const before = await set_shadow_autoupdate(page, true)
  expect(before).toBe(true)
  await page.waitForTimeout(300)
  const before_deltas = await capture_frames_during(page, 4000)
  await set_shadow_autoupdate(page, false)
  await page.waitForTimeout(300)
  const after_deltas = await capture_frames_during(page, 4000)

  const diag = {
    queue_depth_at_measure: drained,
    before_autoupdate_true: {
      p50: percentile(before_deltas, 50),
      p95: percentile(before_deltas, 95),
      p99: percentile(before_deltas, 99),
      frames: before_deltas.length,
    },
    after_autoupdate_false: {
      p50: percentile(after_deltas, 50),
      p95: percentile(after_deltas, 95),
      p99: percentile(after_deltas, 99),
      frames: after_deltas.length,
    },
  }
  await report('t2_shadow_cache_drained', diag)
  console.log(
    `[W11 T2 drained q=${drained}] before(ON) p50 ${diag.before_autoupdate_true.p50.toFixed(2)} p95 ${diag.before_autoupdate_true.p95.toFixed(2)} p99 ${diag.before_autoupdate_true.p99.toFixed(2)} | after(OFF) p50 ${diag.after_autoupdate_false.p50.toFixed(2)} p95 ${diag.after_autoupdate_false.p95.toFixed(2)} p99 ${diag.after_autoupdate_false.p99.toFixed(2)}`
  )

  await page.evaluate(() => /** @type {any} */ (window).__engine?.dispose?.()).catch(() => {})
  await page.goto('about:blank').catch(() => {})
  await page.waitForTimeout(1500)
})

// Standalone: capture the EXACT terrace-step pose (stepped grass, low sun side) for the T5
// riser-readability A/B. This test is run twice by the operator — once with the AO-floor edit
// (after) and once with it reverted (before) — writing riser_readability_after.png /
// riser_readability_before.png. The screenshot name is chosen by the RISER_SHOT env var.
test('W11 T5 — terrace-step riser readability screenshot', async ({ page }) => {
  test.setTimeout(90_000)
  const name = process.env.RISER_SHOT || 'riser_readability_after'
  await page.goto('http://localhost:5199/demo/', { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2000)
  await goto_demo(page, { seed: MASTER_SEED })
  const adapter = await probe_gpu_adapter(page)
  expect(adapter.ok, adapter.reason).toBe(true)
  await page.waitForTimeout(2500) // stream in
  await seize_camera(page)

  // Terrace-step pose: low on the surface, looking along the low-sun (−z-ish) side at a stepped
  // grass slope so risers fill the frame. Sun is at +x/+z/high, so face the shadowed risers.
  const POSE = /** @type {[number,number,number]} */ ([120, 150, 120])
  await park_camera(page, POSE, Math.PI * 1.15, -0.28)
  await page.waitForTimeout(2500) // let the ring around this pose finish
  const shot = await capture_canvas_screenshot(page, name)
  console.log(`[W11 T5] terrace shot "${name}" → ${shot.path} (variance ${shot.variance.toFixed(1)})`)
  expect(shot.variance, 'blank terrace shot').toBeGreaterThan(4)

  await page.evaluate(() => /** @type {any} */ (window).__engine?.dispose?.()).catch(() => {})
  await page.goto('about:blank').catch(() => {})
  await page.waitForTimeout(1000)
})
