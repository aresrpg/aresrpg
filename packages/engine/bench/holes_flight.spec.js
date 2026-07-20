// HOLE FLIGHT GATE (split out of the old 876-line streaming.spec.js under the B2 LoC law — the
// streaming/perf scenario stays in streaming.spec.js; this file owns the no-holes gate). A permanent
// gate that would have caught every "sky-hole along the terrace contours" defect found: fly LOW
// over stepped terrain and, per frame, count sky-colored pixels BELOW the terrain horizon with real
// terrain ABOVE them in the same column — the hole signature (a true geometry gap OR a riser shaded so
// close to the sky the world "impersonates" it).
//
// The pixel→world classifier (classify_holes) and all its constants live in _shared.js so the split
// gates share ONE copy; this file adds only the FLIGHT ORCHESTRATION (leg planning + per-frame
// sampling) and the gate assertions. Two structural guarantees (QA):
//   • WATER + PER-RAY FOG MASK — pure blue-dominance can't tell legitimate water/haze from a sky-hole,
//     so every blue candidate is VOXEL-RAYMARCHED against the actual generated world and each solid
//     hit is fog-weighted by the fog factor the renderer ACTUALLY applied at that hit's depth
//     (smoothstep(fog.near, fog.far, viewZ), fog read LIVE off the scene). A far canyon wall hazed to
//     sky-blue passes; a NEAR frontal riser rendered sky-blue fails. See _shared.js classify_holes.
//   • STEEP LEG — the defect's home terrain is high-relief contour steps, so a second leg flies a
//     PROGRAMMATICALLY-FOUND steep waterless region (gradient scan over world_surface_y at runtime,
//     never hardcoded coordinates) — the gate survives future world forks (GEN_VERSION bumps).
// The bar per leg: residual non-water/non-fog blue ≤ HOLE_AA_EPSILON (measured on the CURRENT world,
// see below). A MUTATION PROOF at the end injects a sky rect over real near-frontal terrain and asserts
// the same gate fires — so a green run can never be a dead/insensitive classifier.

import { test, expect } from '@playwright/test'

import { MASTER_SEED, SEA_LEVEL } from '../src/config/world_config.js'
// world_surface_y is PURE integer math (§3.7) — imported into the spec (Node side) to plan the hole
// gate's flight legs against the LIVE world: dynamic altitudes + a programmatic steep-relief scan,
// so the gate survives world forks (GEN_VERSION bumps) without hand-retuning coordinates.
import { world_surface_y } from '../src/gen/world_gen.js'

import {
  goto_demo,
  probe_gpu_adapter,
  capture_canvas_screenshot,
  attach_gpu_error_watcher,
  DEMO_ORIGIN,
} from './harness.js'
import {
  HOLE_BLUE_OVER_RED,
  HOLE_BLUE_OVER_GREEN,
  HOLE_MIN_BRIGHTNESS,
  HOLE_HORIZON_MARGIN_PX,
  HOLE_RAY_MAX_M,
  HOLE_RAY_STEP_M,
  HOLE_MIN_FRONTAL,
  FOG_DR_DISPLAY,
  FOG_DG_DISPLAY,
  HOLE_FOG_CHROMA_EPS,
  FROXEL_NEAR_HAZE,
  FROXEL_NEAR_START_M,
  FROXEL_NEAR_FULL_M,
  FROXEL_NEAR_FADE_START_M,
  FROXEL_NEAR_FADE_END_M,
  seize_camera,
  park_camera,
  settle_stream,
  classify_holes,
  open_recorded_page,
} from './_shared.js'

const HOLE_ALTITUDE_ABOVE_SURFACE = 8 // fly at (max path surface)+8 m so terrace risers fill the frame
const HOLE_PITCH = -0.15 // look slightly down at the stepped terrain ahead (radians)
const HOLE_FLY_METERS = 150 // horizontal flight distance per leg
const HOLE_FRAME_SAMPLES = 12 // sampled frames per leg
const HOLE_FOV = 70 // renderer.js PerspectiveCamera default; never overridden (engine.js/renderer.js)
// AA EPSILON — per-frame allowance for the residual (frontal near-solid blue NOT masked as water /
// per-ray-fog / graze). Set from MEASUREMENT on the CURRENT world, never a round guess. With the
// streaming-settle + frontal guard + per-ray fog weighting, a fully-drained 2-leg run (24 frames =
// HOLE_FRAME_SAMPLES×2, headed Metal, seed "aresrpg", GEN_VERSION 3 canyons) measures the per-frame
// residual as pure silhouette / foliage-billboard anti-aliasing. Rule: epsilon = ⌈worst-frame frontal
// residual over both legs × 3 safety⌉ padded up to the next multiple of 8. The v2 world measured worst
// 4 → 16; the v3 canyon world is re-measured EACH RUN and the per-frame counts are written to
// holes_flight_gate.json so the bound stays honest as the world forks. 16 keeps ~4× headroom over the
// worst AA frame yet stays ~625× BELOW the pre-fix cyan-riser/geometry-slit defect (>10,000 blue
// px/frame on this same classifier) — enormous margin over a real regression, never flapping on AA.
const HOLE_AA_EPSILON = 16

// Video safety net: whatever finish() the running test set, call it in afterEach so the .webm is saved
// + renamed even if the test throws mid-flight (idempotent — a no-op if the happy path already ran).
/** @type {null | (() => Promise<string>)} */
let finalize_video = null
test.afterEach(async () => {
  await finalize_video?.()
  finalize_video = null
})

/**
 * Programmatic steep-relief finder (Node side, pure world_surface_y math): coarse lattice scan for
 * the highest-gradient WATERLESS cell within ±1600 m of spawn, then a flight leg across the slope
 * (along the gradient direction) with every path sample above sea level. Never hardcodes coords, so
 * the gate keeps stressing real relief across world forks.
 * @returns {{ from: [number, number, number], to: [number, number, number], yaw: number, alt: number, grad: number, center: [number, number] }}
 */
function find_steep_leg() {
  /** @type {{x: number, z: number, grad: number}[]} */
  const cells = []
  for (let gx = -50; gx <= 50; gx += 2) {
    for (let gz = -50; gz <= 50; gz += 2) {
      const x = gx * 32
      const z = gz * 32
      const h = world_surface_y(x, z)
      const hx = world_surface_y(x + 8, z)
      const hz = world_surface_y(x, z + 8)
      const hd = world_surface_y(x + 8, z + 8)
      const min_h = Math.min(h, hx, hz, hd)
      if (min_h <= SEA_LEVEL + 2) continue // waterless cells only (a submerged leg would mask itself)
      cells.push({ x, z, grad: Math.max(Math.abs(hx - h), Math.abs(hz - h), Math.abs(hd - h)) })
    }
  }
  cells.sort((a, b) => b.grad - a.grad)

  for (const cell of cells) {
    // Gradient direction at the cell → fly ACROSS the contours (up/down the slope).
    const gxv = world_surface_y(cell.x + 8, cell.z) - world_surface_y(cell.x - 8, cell.z)
    const gzv = world_surface_y(cell.x, cell.z + 8) - world_surface_y(cell.x, cell.z - 8)
    const len = Math.hypot(gxv, gzv) || 1
    const dx = gxv / len
    const dz = gzv / len
    const half = HOLE_FLY_METERS / 2
    // Path samples: reject the leg if ANY sample dips near sea level (water would enter the frame
    // floor), and record the max surface for the altitude.
    let max_h = -Infinity
    let wet = false
    for (let t = -half; t <= half; t += 8) {
      const h = world_surface_y(Math.floor(cell.x + dx * t), Math.floor(cell.z + dz * t))
      if (h <= SEA_LEVEL + 2) {
        wet = true
        break
      }
      if (h > max_h) max_h = h
    }
    if (wet) continue
    const from = /** @type {[number, number, number]} */ ([cell.x - dx * half, 0, cell.z - dz * half])
    const to = /** @type {[number, number, number]} */ ([cell.x + dx * half, 0, cell.z + dz * half])
    // Demo fly-camera convention: forward = (-sin(yaw), 0, -cos(yaw)) → yaw = atan2(-dx, -dz).
    const yaw = Math.atan2(-dx, -dz)
    const alt = max_h + HOLE_ALTITUDE_ABOVE_SURFACE
    from[1] = alt
    to[1] = alt
    return { from, to, yaw, alt, grad: cell.grad, center: [cell.x, cell.z] }
  }
  throw new Error('find_steep_leg: no waterless steep cell found — world gen changed radically?')
}

/**
 * Max surface height along a straight path (Node side) — used to pin each leg's altitude to the
 * LIVE world (surface+8) instead of a hardcoded height that goes stale on a world fork.
 * @param {[number, number, number]} from
 * @param {[number, number, number]} to
 * @returns {number}
 */
function path_max_surface(from, to) {
  let max_h = -Infinity
  for (let t = 0; t <= 1; t += 0.05) {
    const h = world_surface_y(Math.floor(from[0] + (to[0] - from[0]) * t), Math.floor(from[2] + (to[2] - from[2]) * t))
    if (h > max_h) max_h = h
  }
  return max_h
}

/**
 * Runs one hole-gate flight leg: stepped waypoints (pose re-asserted every sample; per-waypoint stream
 * settle so an unloaded chunk's real sky is never miscounted), water/fog/graze-masked classification
 * per frame. Returns the per-frame records.
 * @param {import('@playwright/test').Page} page
 * @param {{ from: [number,number,number], to: [number,number,number], yaw: number, label: string }} leg
 * @param {any} hole_cfg classifier config (see _shared.js classify_holes)
 * @returns {Promise<Array<{ frame: number, holes: number, water_masked: number, fog_masked: number, graze_masked: number, candidates: number, sky: any }>>}
 */
async function run_hole_leg(page, { from, to, yaw, label }, hole_cfg) {
  /** @type {Array<{ frame: number, holes: number, water_masked: number, fog_masked: number, graze_masked: number, candidates: number, sky: any }>} */
  const per_frame = []
  for (let f = 0; f < HOLE_FRAME_SAMPLES; f += 1) {
    const t = f / (HOLE_FRAME_SAMPLES - 1)
    const pos = /** @type {[number, number, number]} */ ([
      from[0] + (to[0] - from[0]) * t,
      from[1],
      from[2] + (to[2] - from[2]) * t,
    ])
    await park_camera(page, pos, yaw, HOLE_PITCH)
    // Settle to a FULLY-streamed frame (min 900 ms so the ring enqueues the ~14 m step before the quiet
    // check can exit — the fix for the phantom-hole race; bounded 12 s). This gate targets persistent
    // shading/geometry regressions, never transient stream lag, so every sampled frame must be complete.
    await settle_stream(page, { min_ms: 900, deadline_ms: 12_000 })
    await park_camera(page, pos, yaw, HOLE_PITCH) // re-assert after the wait
    await page.waitForTimeout(400) // let the final uploads present
    const c = await classify_holes(page, hole_cfg, { position: pos, yaw, pitch: HOLE_PITCH, fov: HOLE_FOV })
    per_frame.push({
      frame: f,
      holes: c.holes,
      water_masked: c.water_masked,
      fog_masked: c.fog_masked,
      graze_masked: c.graze_masked,
      candidates: c.candidates,
      sky: c.sky,
    })
    console.log(
      `[flight-gate ${label}] frame ${f}: holes ${c.holes} | graze ${c.graze_masked} | water ${c.water_masked} | fog ${c.fog_masked} | candidates ${c.candidates}`
    )
  }
  return per_frame
}

test('flight gate: no sky-holes along terrace contours (water + per-ray-fog masked, spawn + steep legs)', async ({
  browser,
}) => {
  test.setTimeout(360_000)
  const { page, finish } = await open_recorded_page(browser, 'holes_flight')
  finalize_video = () => finish('flight_gate')
  const watcher = attach_gpu_error_watcher(page)

  // Warm-up loads absorb Vite's dep re-optimization full reload (the per-waypoint evaluate loop dies
  // if that reload lands mid-test) — load, settle long, load again, settle.
  await page.goto(`${DEMO_ORIGIN}/demo/`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(4000)
  await page.goto(`${DEMO_ORIGIN}/demo/`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2000)
  await goto_demo(page, { seed: MASTER_SEED })
  const adapter = await probe_gpu_adapter(page)
  expect(adapter.ok, adapter.reason).toBe(true)
  await seize_camera(page)

  // Near-ring radius (blocks) = where the far shell takes over from near voxels — a constant
  // (load_radius × chunk). Beyond it the classifier masks hits as far-shell/horizon (see near-ring scope
  // in _shared.js). Read once (stable after boot); 0 ⇒ classifier falls back to fog.near.
  const near_ring_m = await page
    .evaluate(() => {
      try {
        return /** @type {any} */ (window).__engine?.get_stats?.()?.near_ring_m ?? 0
      } catch {
        return 0
      }
    })
    .catch(() => 0)

  const hole_cfg = {
    bor: HOLE_BLUE_OVER_RED,
    bog: HOLE_BLUE_OVER_GREEN,
    minB: HOLE_MIN_BRIGHTNESS,
    horizon_margin: HOLE_HORIZON_MARGIN_PX,
    fog_dr: FOG_DR_DISPLAY,
    fog_dg: FOG_DG_DISPLAY,
    chroma_eps: HOLE_FOG_CHROMA_EPS,
    near_ring_m,
    // Froxel near-haze veil params (mirror ATMO_CONFIG.froxel) — the per-ray fog test adds this volumetric
    // veil to THREE.Fog so hazed near-mid terrain isn't flagged now that fog far sits at the far-shell radius.
    froxel_haze: FROXEL_NEAR_HAZE,
    froxel_start: FROXEL_NEAR_START_M,
    froxel_full: FROXEL_NEAR_FULL_M,
    froxel_fade_start: FROXEL_NEAR_FADE_START_M,
    froxel_fade_end: FROXEL_NEAR_FADE_END_M,
    ray_max: HOLE_RAY_MAX_M,
    ray_step: HOLE_RAY_STEP_M,
    min_frontal: HOLE_MIN_FRONTAL,
  }

  // Read the LIVE fog the classifier will use (parameterized, never hardcoded — a sibling wave is
  // moving fog far via the ring's fog_far_ceiling). Logged into the gate JSON for the record.
  const live_fog = await page.evaluate(() => {
    const f = /** @type {any} */ (window).__ares_scene__?.fog
    return { near: f?.near ?? null, far: f?.far ?? null }
  })

  // ── LEG 1: spawn terraces (into the grass hills, +x+z — away from the shore biome). Altitude is
  // pinned to the LIVE world (max path surface + 8), never a hardcoded height.
  const YAW1 = (5 * Math.PI) / 4
  const from1 = /** @type {[number, number, number]} */ ([70, 0, 70])
  const to1 = /** @type {[number, number, number]} */ ([
    from1[0] - HOLE_FLY_METERS * Math.sin(YAW1),
    0,
    from1[2] - HOLE_FLY_METERS * Math.cos(YAW1),
  ])
  const alt1 = path_max_surface(from1, to1) + HOLE_ALTITUDE_ABOVE_SURFACE
  from1[1] = alt1
  to1[1] = alt1
  await park_camera(page, from1, YAW1, HOLE_PITCH)
  await page.waitForTimeout(3000) // initial near-ring fill
  const leg1 = await run_hole_leg(page, { from: from1, to: to1, yaw: YAW1, label: 'leg1-spawn' }, hole_cfg)

  // ── LEG 2: programmatic steep relief (highest-gradient waterless cell; see find_steep_leg).
  const steep = find_steep_leg()
  await park_camera(page, steep.from, steep.yaw, HOLE_PITCH)
  // Fresh region ~1 km out: give the ring a long first fill (min 4 s) before sampling begins — same
  // elapsed-AND-quiet guard as the per-frame settle, so a stale-low queue can't exit before the jump's
  // chunks are even enqueued.
  await settle_stream(page, { min_ms: 4_000, deadline_ms: 30_000 })
  const leg2 = await run_hole_leg(
    page,
    { from: steep.from, to: steep.to, yaw: steep.yaw, label: 'leg2-steep' },
    hole_cfg
  )

  const worst1 = leg1.reduce((m, s) => Math.max(m, s.holes), 0)
  const worst2 = leg2.reduce((m, s) => Math.max(m, s.holes), 0)
  const water1 = leg1.reduce((m, s) => m + s.water_masked, 0)
  const water2 = leg2.reduce((m, s) => m + s.water_masked, 0)
  const fog1 = leg1.reduce((m, s) => m + s.fog_masked, 0)
  const fog2 = leg2.reduce((m, s) => m + s.fog_masked, 0)
  const graze1 = leg1.reduce((m, s) => m + s.graze_masked, 0)
  const graze2 = leg2.reduce((m, s) => m + s.graze_masked, 0)

  // ── MUTATION PROOF — the fixed gate MUST still catch a REAL hole. Re-classify the WORST-candidate
  // frame of leg 2 with a bright SKY rect painted over the lower-centre band (where the frame is filled
  // by near frontal terrain), simulating a transparent / missing chunk. The voxel oracle is untouched,
  // so the painted sky now sits over real near frontal terrain → the classifier MUST report it as a
  // large number of holes (≫ epsilon). Deviation = that mutated hole count, recorded in the gate JSON.
  // Sky blue (120,150,215): blue-dominance b−r 95 / b−g 65 — far beyond any per-ray fog allowance
  // (FOG_DR/DG × f + chroma_eps ≤ 48), so it can never be masked as haze. Uses the leg-2 MIDPOINT pose
  // (mid-slope → terrain fills the frame most densely, so the painted band reliably overlays near
  // frontal solid), re-parked + re-settled so the underlying frame is fully streamed.
  const mut_center = /** @type {[number, number, number]} */ ([
    (steep.from[0] + steep.to[0]) / 2,
    steep.from[1],
    (steep.from[2] + steep.to[2]) / 2,
  ])
  const mut_pose = { position: mut_center, yaw: steep.yaw, pitch: HOLE_PITCH, fov: HOLE_FOV }
  await park_camera(page, mut_center, steep.yaw, HOLE_PITCH)
  await settle_stream(page, { min_ms: 900, deadline_ms: 12_000 })
  await park_camera(page, mut_center, steep.yaw, HOLE_PITCH)
  await page.waitForTimeout(400)
  const dims = await page.evaluate(() => {
    const c = /** @type {HTMLCanvasElement} */ (document.querySelector('#canvas'))
    return { w: c?.clientWidth ?? 1280, h: c?.clientHeight ?? 720 }
  })
  // Paint band: horizontal centre-to-lower strip, inside the classifier's x window (0.28–0.98 w).
  const paint = {
    x0: Math.floor(dims.w * 0.4),
    y0: Math.floor(dims.h * 0.55),
    x1: Math.floor(dims.w * 0.85),
    y1: Math.floor(dims.h * 0.8),
    r: 120,
    g: 150,
    b: 215,
  }
  const clean = await classify_holes(page, hole_cfg, mut_pose)
  const mutated = await classify_holes(page, hole_cfg, mut_pose, paint)
  const mutation_deviation = mutated.holes - clean.holes
  console.log(
    `[flight-gate MUTATION] clean holes ${clean.holes} → painted-sky holes ${mutated.holes} (Δ ${mutation_deviation}) at steep pose ${steep.center}`
  )

  const shot = await capture_canvas_screenshot(page, 'holes_flight_gate_last')

  // Persist per-frame counts for the reviewer (artifacts in /tmp only).
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir('/tmp/aresrpg-engine-artifacts', { recursive: true })
  // Dispose the engine (stop the frame loop + terminate gen workers) BEFORE finish() closes the
  // recording context — a render firing after the context tears down would fault. finish() then closes
  // the context (finalizing + saving the .webm) and returns the renamed path.
  await page.evaluate(() => /** @type {any} */ (window).__engine?.dispose?.()).catch(() => {})
  const video_path = await finish('flight_gate')
  const gate_json = {
    seed: MASTER_SEED,
    pitch: HOLE_PITCH,
    fly_meters: HOLE_FLY_METERS,
    aa_epsilon: HOLE_AA_EPSILON,
    min_frontal: HOLE_MIN_FRONTAL,
    // Fog model actually used by the per-ray classifier this run (read LIVE off the scene) + the
    // displayed fog-chroma the per-ray test compares against — never hardcoded, records the world fork.
    fog_model: {
      near: live_fog.near,
      far: live_fog.far,
      fog_dr_display: FOG_DR_DISPLAY,
      fog_dg_display: FOG_DG_DISPLAY,
      chroma_eps: HOLE_FOG_CHROMA_EPS,
      froxel: {
        near_haze: FROXEL_NEAR_HAZE,
        start_m: FROXEL_NEAR_START_M,
        full_m: FROXEL_NEAR_FULL_M,
        fade_start_m: FROXEL_NEAR_FADE_START_M,
        fade_end_m: FROXEL_NEAR_FADE_END_M,
      },
    },
    mutation_proof: {
      pose_center: mut_center,
      clean_holes: clean.holes,
      painted_sky_holes: mutated.holes,
      deviation: mutation_deviation,
      paint,
    },
    leg1_spawn: {
      altitude_y: alt1,
      worst_holes: worst1,
      water_masked_total: water1,
      fog_masked_total: fog1,
      graze_masked_total: graze1,
      per_frame: leg1,
    },
    leg2_steep: {
      center: steep.center,
      gradient: steep.grad,
      altitude_y: steep.alt,
      yaw: Number(steep.yaw.toFixed(3)),
      worst_holes: worst2,
      water_masked_total: water2,
      fog_masked_total: fog2,
      graze_masked_total: graze2,
      per_frame: leg2,
    },
    last_shot: shot.path,
    video: video_path,
  }
  await writeFile('/tmp/aresrpg-engine-artifacts/holes_flight_gate.json', JSON.stringify(gate_json, null, 2), 'utf8')
  console.log(
    `[flight-gate] leg1-spawn worst residual ${worst1} (graze ${graze1}, water ${water1}, fog ${fog1}) | leg2-steep@${steep.center} grad ${steep.grad} worst residual ${worst2} (graze ${graze2}, water ${water2}, fog ${fog2}) | epsilon ${HOLE_AA_EPSILON} | fog near ${live_fog.near} far ${live_fog.far} | mutation Δ ${mutation_deviation} | video ${video_path}`
  )

  test.info().annotations.push({ type: 'holes-flight-gate', description: shot.path })
  test.info().annotations.push({ type: 'holes-flight-video', description: video_path })
  expect(
    worst1,
    `sky-holes on the SPAWN leg: worst masked residual ${worst1} px/frame > AA epsilon ${HOLE_AA_EPSILON} — ` +
      `non-water/non-fog sky is leaking through the terrain silhouette; see ${shot.path} and holes_flight_gate.json.`
  ).toBeLessThanOrEqual(HOLE_AA_EPSILON)
  expect(
    worst2,
    `sky-holes on the STEEP leg (center ${steep.center}, gradient ${steep.grad}/8m): worst masked residual ` +
      `${worst2} px/frame > AA epsilon ${HOLE_AA_EPSILON}; see holes_flight_gate.json.`
  ).toBeLessThanOrEqual(HOLE_AA_EPSILON)
  // MUTATION PROOF assertion: a real injected sky-hole must be caught with huge margin (≫ epsilon), else
  // the gate is dead/insensitive and its green legs are meaningless.
  expect(
    mutation_deviation,
    `MUTATION PROOF FAILED: painting a sky rect over near frontal terrain added only ${mutation_deviation} holes ` +
      `(clean ${clean.holes} → mutated ${mutated.holes}); the fixed classifier no longer catches a real hole.`
  ).toBeGreaterThan(HOLE_AA_EPSILON * 4)
  expect(watcher.errors, `flight gate raised WebGPU errors:\n${watcher.errors.join('\n')}`).toEqual([])
})
