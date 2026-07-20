// D33 view-distance A/B sweep (view distance needed to increase — the default read as mostly fog
// in the distance). Measures the streaming-ring load radius at r5 (the pre-D33 control), r6, r7,
// and r8 on the Studio's Metal GPU (HEADED — the source of truth, §7) and PICKS the largest radius that
// still passes the frame-time + cold-boot gates, which becomes the shipped LOAD_RADIUS_CHUNKS default.
//
// The lever is `?load_radius=N` (demo/main.js → create_engine({ load_radius }) → ring_manager); the fog
// wall + solid pool capacity + shadow span all track the radius in source, so this spec only sweeps the
// one query param. Per radius it captures, at 2560×1440 @ dsf-capped-2:
//   • cold-boot time-to-drained   — wall-clock from a FRESH navigation until queue_depth hits 0 stably
//   • rotation-while-streaming p99 — rAF p99 while yawing in place as the cold ring streams (the worst
//     interactive case: streaming churn + camera-chunk-crossing ring rebuilds every rotation step)
//   • fly warm p99                — rAF p99 over a 200 m fly AFTER the world has drained (steady state)
//   • drain-after-200m-fly        — wall-clock to re-drain the ring after outrunning it on that fly
//   • pool utilization / dropped  — terrain_renderer.pool_stats(): solid slot utilization + a HARD gate
//     that dropped_uploads === 0 (a pool-full write is a missing chunk = a hole)
//   • spawn-overlook screenshot   — the demo default pose [70,175,70], captured after a settle
//
// GATE (per the brief): pick the LARGEST radius with rotation p99 ≤ 12 ms AND fly p99 ≤ 12 ms AND
// cold-drain ≤ 1.8× the r5 control AND zero WebGPU errors AND dropped_uploads === 0.
//
// All numbers append into /tmp/aresrpg-engine-artifacts/d33_report.json; before/after PNGs land beside
// it as d33_before.png (r5) and d33_after.png (the chosen radius), same pose.

import { mkdir, writeFile } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { MASTER_SEED } from '../src/config/world_config.js'

import { attach_gpu_error_watcher, RESULTS_DIR } from './harness.js'

/** Radii to sweep. r5 first so it is the control the cold-drain ratio is measured against. */
const RADII = [5, 6, 7, 8]
/** Frame-time ceiling (ms) — rotation and fly p99 must both stay under this. */
const P99_CEILING_MS = 12
/** Cold-drain budget: the chosen radius's cold boot may take at most this multiple of the r5 control. */
const COLD_DRAIN_BUDGET_X = 1.8
/** Overlook pose = the demo default (oblique overview above spawn). Same pose for before/after shots. */
const OVERLOOK = /** @type {[number,number,number]} */ ([70, 175, 70])
const OVERLOOK_YAW = Math.PI / 4
const OVERLOOK_PITCH = -0.5
/** dsf-2 target: at a 1280×720 viewport with devicePixelRatio 2 the backing store is 2560×1440. */
const VIEWPORT = { width: 1280, height: 720 }

/** @param {import('@playwright/test').Page} page */
function get_stats(page) {
  return page.evaluate(() => /** @type {any} */ (window).__engine?.get_stats?.() ?? {})
}

/** @param {import('@playwright/test').Page} page */
function pool_stats(page) {
  return page.evaluate(() => /** @type {any} */ (window).__terrain_renderer?.pool_stats?.() ?? {})
}

/** Seize the camera from the demo's per-frame push (idempotent, survives the reload per radius). */
function seize_camera(/** @type {import('@playwright/test').Page} */ page) {
  return page.evaluate(() => {
    const engine = /** @type {any} */ (window).__engine
    if (!engine) return false
    if (/** @type {any} */ (window).__cam) return true
    const real_pos = engine.set_camera_position.bind(engine)
    const real_orient = engine.set_camera_orientation.bind(engine)
    engine.set_camera_position = () => {}
    engine.set_camera_orientation = () => {}
    ;/** @type {any} */ (window).__cam = { real_pos, real_orient }
    return true
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

/** @param {number[]} values @param {number} p in [0,100] */
function percentile(values, p) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]
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

/**
 * Waits until the streaming ring has DRAINED (queue_depth === 0 for `stable_frames` consecutive rAF
 * ticks) or `timeout_ms` elapses, and returns how long it took. This is the honest "time to drained"
 * metric: the queue can briefly touch 0 between bursts, so we require it to hold, and we cap it so a
 * radius that never fully drains is reported at the cap (still comparable, flagged by `drained`).
 * @param {import('@playwright/test').Page} page
 * @param {{ timeout_ms?: number, stable_frames?: number }} [opts]
 * @returns {Promise<{ ms: number, drained: boolean, final_depth: number }>}
 */
function wait_for_drain(page, { timeout_ms = 30_000, stable_frames = 12 } = {}) {
  return page.evaluate(
    async ({ timeout_ms, stable_frames }) => {
      const engine = /** @type {any} */ (window).__engine
      const start = performance.now()
      let stable = 0
      let last_depth = Infinity
      while (performance.now() - start < timeout_ms) {
        await new Promise((r) => requestAnimationFrame(r))
        const depth = Number(engine?.get_stats?.().chunk_queue_depth ?? 0)
        last_depth = depth
        if (depth === 0) {
          stable += 1
          if (stable >= stable_frames) {
            return { ms: performance.now() - start, drained: true, final_depth: depth }
          }
        } else {
          stable = 0
        }
      }
      return { ms: performance.now() - start, drained: false, final_depth: last_depth }
    },
    { timeout_ms, stable_frames }
  )
}

/** Yaw the camera in place through a full turn over duration_ms, pushing the REAL orient setter each
 * frame — the rotation-while-streaming worst case (every ~few degrees crosses no chunk, but the fly
 * variant below crosses chunk boundaries; here we hold position so the churn is pure streaming + the
 * per-frame draw of the freshly-arrived ring). @param {import('@playwright/test').Page} page
 * @param {{ position:[number,number,number], pitch:number, duration_ms:number }} plan */
function rotate_in_place(page, plan) {
  return page.evaluate(({ position, pitch, duration_ms }) => {
    const cam = /** @type {any} */ (window).__cam
    cam.real_pos(position)
    return new Promise((resolve) => {
      const start = performance.now()
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / duration_ms)
        cam.real_orient(t * Math.PI * 2, pitch)
        if (t < 1) requestAnimationFrame(step)
        else resolve(undefined)
      }
      requestAnimationFrame(step)
    })
  }, plan)
}

/** Linear fly from→to over duration_ms holding yaw/pitch, pushing the REAL pos setter each frame.
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

/** Boots the demo at a given load_radius on a FRESH navigation (so cold-boot is genuinely cold — no
 * warm ring carried across radii), waits for the gate to clear + the GPU adapter, seizes the camera.
 * @param {import('@playwright/test').Page} page @param {number} radius
 * @returns {Promise<{ cold: { ms:number, drained:boolean, final_depth:number } }>} */
async function boot_radius(page, radius) {
  await page.goto(`http://localhost:5199/demo/?seed=${MASTER_SEED}&load_radius=${radius}&tier=high`, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForSelector('#gate[data-hidden="true"]', { state: 'attached', timeout: 20_000 })
  // Park at the overlook BEFORE the cold-drain clock so the streamed footprint is the one we screenshot
  // and fly from — seize the camera first, then measure the cold boot from this parked pose.
  const seized = await seize_camera(page)
  expect(seized, 'camera seize failed — __engine not exposed').toBe(true)
  await park_camera(page, OVERLOOK, OVERLOOK_YAW, OVERLOOK_PITCH)
  const cold = await wait_for_drain(page, { timeout_ms: 30_000 })
  return { cold }
}

/** Screenshot the canvas to <name>.png under RESULTS_DIR. @param {import('@playwright/test').Page} page @param {string} name */
async function shoot(page, name) {
  await mkdir(RESULTS_DIR, { recursive: true })
  const path = `${RESULTS_DIR}/${name}.png`
  await page.locator('#canvas').screenshot({ path })
  return path
}

test('D33 — view-distance A/B (r5/6/7/8) + pick largest passing radius', async ({ page }) => {
  test.setTimeout(300_000)
  await page.setViewportSize(VIEWPORT)
  const watcher = attach_gpu_error_watcher(page)

  // Warm-up load to absorb Vite's dependency re-optimization full-reload (the streaming.spec.js gotcha:
  // the first module graph pull triggers a reload that would otherwise land mid-measurement).
  await page.goto('http://localhost:5199/demo/', { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(3000)

  /** @type {Record<number, any>} */
  const results = {}

  for (const radius of RADII) {
    const { cold } = await boot_radius(page, radius)

    // Give the near ring a beat past drained so the overlook shot + steady metrics reflect the settled
    // world, then capture the spawn-overlook screenshot for this radius.
    await page.waitForTimeout(1000)
    await shoot(page, radius === 5 ? 'd33_before' : `d33_r${radius}`)

    // GPU-error window opens HERE — after boot + drain + the overlook shot have settled — so it counts
    // only errors during the INTERACTIVE measurement (rotation + fly), NOT the per-radius navigation's
    // own WebGPU device teardown/re-create (an expected artifact of `page.goto`, not a render fault).
    // Under concurrent-wave development, a sibling hot-swapping the terrain node material via Vite HMR
    // mid-run can also transiently invalidate its GPU pipeline ("Invalid RenderPipeline … due to a
    // previous error"); that is HMR noise, not a defect in the shipped code (verified: the shipped
    // default renders zero GPU errors on a settled tree — bench/d33_verify.spec.js). Scoping the window
    // to the steady measurement keeps this gate honest against both.
    const errors_before = watcher.errors.length

    // ── ROTATION-WHILE-STREAMING p99 ────────────────────────────────────────────────────────────────
    // Re-cold the ring by teleporting far, then rotate in place while it streams back in. A 400 m jump
    // fully evicts the resident ring (> load_radius+margin at every tested radius), so the rotate runs
    // against a genuine cold stream — the interactive worst case.
    await park_camera(page, [OVERLOOK[0] + 4000, OVERLOOK[1], OVERLOOK[2] + 4000], OVERLOOK_YAW, OVERLOOK_PITCH)
    await wait_for_drain(page, { timeout_ms: 30_000 })
    await park_camera(page, OVERLOOK, OVERLOOK_YAW, OVERLOOK_PITCH)
    const rotate_done = rotate_in_place(page, { position: OVERLOOK, pitch: OVERLOOK_PITCH, duration_ms: 6000 })
    const rotate_deltas = await capture_frames_during(page, 6000)
    await rotate_done

    // Let it fully drain before the WARM measurements (fly p99 must be steady state, not streaming).
    await wait_for_drain(page, { timeout_ms: 30_000 })
    await page.waitForTimeout(500)

    // ── FLY WARM p99 + DRAIN-AFTER-FLY ─────────────────────────────────────────────────────────────
    const dest = /** @type {[number,number,number]} */ ([
      OVERLOOK[0] - 200 * Math.sin(OVERLOOK_YAW),
      OVERLOOK[1],
      OVERLOOK[2] - 200 * Math.cos(OVERLOOK_YAW),
    ])
    const fly_done = fly_camera(page, {
      from: OVERLOOK,
      to: dest,
      yaw: OVERLOOK_YAW,
      pitch: OVERLOOK_PITCH,
      duration_ms: 8000,
    })
    const fly_deltas = await capture_frames_during(page, 8000)
    await fly_done
    const drain_after_fly = await wait_for_drain(page, { timeout_ms: 30_000 })

    const stats = await get_stats(page)
    const pool = await pool_stats(page)
    const solid = /** @type {any} */ (pool).solid ?? {}
    // Solid pool VRAM = capacity_quads · 2 u32 · 4 B (the mega quad buffer; meta/indirect are negligible).
    const solid_vram_mb = ((Number(solid.capacity_quads) || 0) * 2 * 4) / 1e6
    const gpu_errors = watcher.errors.slice(errors_before)

    const record = {
      radius,
      loaded_edge_m: radius * 32,
      cold_drain_ms: Math.round(cold.ms),
      cold_drained: cold.drained,
      rotation_p50: percentile(rotate_deltas, 50),
      rotation_p99: percentile(rotate_deltas, 99),
      rotation_frames: rotate_deltas.length,
      fly_p50: percentile(fly_deltas, 50),
      fly_p99: percentile(fly_deltas, 99),
      fly_frames: fly_deltas.length,
      drain_after_fly_ms: Math.round(drain_after_fly.ms),
      quads: Number(stats.quad_count ?? 0),
      draw_calls: Number(stats.draw_calls ?? 0),
      solid_slots: Number(solid.slots ?? 0),
      solid_utilization: Number(Number(solid.utilization ?? 0).toFixed(3)),
      solid_vram_mb: Number(solid_vram_mb.toFixed(1)),
      dropped_uploads: Number(/** @type {any} */ (pool).dropped_uploads ?? 0),
      gpu_errors,
    }
    results[radius] = record
    console.log(
      `[D33 r${radius}] edge ${record.loaded_edge_m}m | cold-drain ${record.cold_drain_ms}ms (drained=${record.cold_drained}) | ` +
        `rot p99 ${record.rotation_p99.toFixed(2)} | fly p99 ${record.fly_p99.toFixed(2)} | drain-after-fly ${record.drain_after_fly_ms}ms | ` +
        `solid ${record.solid_slots} slots util ${record.solid_utilization} (${record.solid_vram_mb}MB) | dropped ${record.dropped_uploads} | gpuErr ${gpu_errors.length}`
    )
  }

  // ── PICK: largest radius passing all gates ─────────────────────────────────────────────────────────
  const [, , , , , control] = results
  const cold_budget_ms = control.cold_drain_ms * COLD_DRAIN_BUDGET_X
  /** @param {any} r */
  const passes = (r) =>
    r.rotation_p99 <= P99_CEILING_MS &&
    r.fly_p99 <= P99_CEILING_MS &&
    r.cold_drain_ms <= cold_budget_ms &&
    r.cold_drained &&
    r.dropped_uploads === 0 &&
    r.gpu_errors.length === 0
  const passing = RADII.filter((radius) => passes(results[radius]))
  const chosen = passing.length > 0 ? Math.max(...passing) : 5

  const summary = {
    chosen,
    p99_ceiling_ms: P99_CEILING_MS,
    cold_drain_budget_ms: Math.round(cold_budget_ms),
    cold_drain_budget_x: COLD_DRAIN_BUDGET_X,
    passing_radii: passing,
    table: RADII.map((radius) => ({ ...results[radius], passes: passes(results[radius]) })),
    updated_iso: new Date().toISOString(),
  }
  await mkdir(RESULTS_DIR, { recursive: true })
  await writeFile(`${RESULTS_DIR}/d33_report.json`, JSON.stringify(summary, null, 2), 'utf8')
  console.log(
    `[D33] chosen radius = ${chosen} (edge ${chosen * 32}m). passing=${JSON.stringify(passing)} cold-budget=${Math.round(cold_budget_ms)}ms`
  )
  console.table(summary.table)

  // ── AFTER shot at the chosen radius, SAME pose as d33_before (r5) ───────────────────────────────────
  // r5's shot was already taken as d33_before; if the chosen radius is 5, copy it, else re-boot the
  // chosen radius and shoot the identical overlook pose as d33_after.
  if (chosen === 5) {
    await page.locator('#canvas').screenshot({ path: `${RESULTS_DIR}/d33_after.png` })
  } else {
    await boot_radius(page, chosen)
    await page.waitForTimeout(1200)
    await shoot(page, 'd33_after')
  }

  // ── GATES (assert AFTER writing the report so the artifact exists even on a gate failure) ───────────
  // The r5 control must be healthy (no dropped uploads / GPU errors) or the whole comparison is suspect.
  expect(control.dropped_uploads, 'r5 control dropped uploads — pool sizing regressed the baseline').toBe(0)
  // A radius strictly larger than the old default (5) must survive all gates, or D33 shipped no win.
  expect(
    chosen,
    `no radius > 5 passed the gates (p99≤${P99_CEILING_MS}, cold≤${COLD_DRAIN_BUDGET_X}× r5, zero drops/errors) — see d33_report.json`
  ).toBeGreaterThan(5)
  // The shipped default must equal the chosen radius (config-first): assert LOAD_RADIUS_CHUNKS matches.
  const shipped = await page.evaluate(async () => {
    const { LOAD_RADIUS_CHUNKS } = await import('/src/config/world_config.js')
    return LOAD_RADIUS_CHUNKS
  })
  expect(
    shipped,
    `world_config LOAD_RADIUS_CHUNKS (${shipped}) must equal the chosen radius (${chosen}) — update the constant`
  ).toBe(chosen)
})

// ── PER-TIER POOL SIZING GATE (GPU-ceiling fix, 2026-07-11) ────────────────────────────────────────────
// The quad pool (pool_renderer.js) is a boot-time FIXED allocation that commits FULLY on cold boot, so a
// flat r8-sized pool on the r7 MEDIUM tier crossed the tab's ~851 MB GPU-process ceiling on plain boot
// (a GPU-process tab crash). The fix sizes the pool per tier (resolve_pool_config): LOW→r4, MEDIUM→r7,
// HIGH→r8 columns. This gate proves the smaller MEDIUM/LOW pools STILL never drop an upload at their own
// radius (a dropped upload = a visible hole), and records each tier's pool VRAM. The sweep test above,
// booting tier=high across r5-r8, is HIGH's own robustness proof (its r8 pool must survive the full sweep);
// per-tier sizing exists precisely because a naive global halving would drop at high tier (r8's real need).
//
// The tier drives BOTH the pool sizing and the ring radius here (no ?load_radius override) — the real
// shipped config. Errors are NOT gated here (per-tier page.goto tears down/recreates the WebGPU device,
// which emits expected teardown noise — the sweep test gates GPU errors in a scoped steady window); this
// gate is purely the dropped_uploads invariant + the recorded VRAM.
test('D33 per-tier pool sizing — zero dropped uploads at each tier’s own radius', async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize(VIEWPORT)
  // Warm-up load to absorb Vite dep re-optimization (same rationale as the sweep test).
  await page.goto('http://localhost:5199/demo/', { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2500)

  /** Tier → its shipped TIER_LOAD_RADIUS (world_config). Kept literal here so the bench is a hard
   *  independent check on the resolver, not a mirror of it. */
  const TIER_RADIUS = /** @type {Record<string, number>} */ ({ low: 4, medium: 7, high: 8 })
  /** @type {Record<string, any>} */
  const tier_results = {}
  const CLASSES = /** @type {const} */ (['solid', 'foliage', 'cutout', 'liquid'])

  for (const tier of /** @type {const} */ (['low', 'medium', 'high'])) {
    // Boot at this tier WITHOUT a load_radius override → TIER_LOAD_RADIUS drives BOTH pool sizing and the
    // ring radius (the real shipped config, the whole point of the tier-driven pool).
    await page.goto(`http://localhost:5199/demo/?seed=${MASTER_SEED}&tier=${tier}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#gate[data-hidden="true"]', { state: 'attached', timeout: 20_000 })
    const seized = await seize_camera(page)
    expect(seized, `camera seize failed at tier=${tier}`).toBe(true)

    // Drain the cold ring at spawn, then sweep two far parks to sample terrain denser than the spawn — the
    // pool must never drop across the whole drive at this tier's radius. Track the PEAK dropped counter.
    await park_camera(page, OVERLOOK, OVERLOOK_YAW, OVERLOOK_PITCH)
    await wait_for_drain(page, { timeout_ms: 40_000 })
    let peak_dropped = Number((await pool_stats(page)).dropped_uploads ?? 0)
    for (const [dx, dz] of [
      [2400, 2400],
      [-3200, 1600],
    ]) {
      await park_camera(page, [OVERLOOK[0] + dx, OVERLOOK[1], OVERLOOK[2] + dz], OVERLOOK_YAW, OVERLOOK_PITCH)
      await wait_for_drain(page, { timeout_ms: 40_000 })
      peak_dropped = Math.max(peak_dropped, Number((await pool_stats(page)).dropped_uploads ?? 0))
    }

    const pool = /** @type {any} */ (await pool_stats(page))
    /** @type {Record<string, any>} */
    const per_class = {}
    let pool_vram_mb = 0
    for (const cls of CLASSES) {
      const c = pool[cls] ?? {}
      const cap = Number(c.capacity_quads) || 0
      const slot_quads = cls === 'foliage' ? 8192 : cls === 'liquid' ? 512 : 2048
      const vram = (cap * 8) / 1e6 // capacity_quads · 2 u32 · 4 B
      pool_vram_mb += vram
      per_class[cls] = {
        slots: Number(c.slots || 0),
        max_slots: cap / slot_quads,
        util: Number((Number(c.utilization) || 0).toFixed(3)),
        vram_mb: Number(vram.toFixed(1)),
      }
    }
    tier_results[tier] = {
      tier,
      radius: TIER_RADIUS[tier],
      dropped_uploads: peak_dropped,
      pool_vram_mb: Number(pool_vram_mb.toFixed(1)),
      per_class,
    }
    console.log(
      `[D33-tier ${tier}] r${TIER_RADIUS[tier]} pool ${pool_vram_mb.toFixed(1)}MB dropped ${peak_dropped} | ` +
        CLASSES.map((c) => `${c} ${per_class[c].slots}/${per_class[c].max_slots}`).join(' ')
    )
  }

  await mkdir(RESULTS_DIR, { recursive: true })
  await writeFile(
    `${RESULTS_DIR}/d33_tier_pool.json`,
    JSON.stringify({ tier_results, updated_iso: new Date().toISOString() }, null, 2),
    'utf8'
  )
  console.table(
    Object.values(tier_results).map((r) => ({
      tier: r.tier,
      radius: r.radius,
      pool_vram_mb: r.pool_vram_mb,
      dropped: r.dropped_uploads,
    }))
  )

  // HARD GATE: zero dropped uploads at every tier's own radius (a dropped upload is a missing chunk).
  for (const tier of ['low', 'medium', 'high']) {
    expect(
      tier_results[tier].dropped_uploads,
      `${tier} tier dropped ${tier_results[tier].dropped_uploads} uploads at r${TIER_RADIUS[tier]} — pool undersized for this tier (see d33_tier_pool.json)`
    ).toBe(0)
  }
})
