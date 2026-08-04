// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// NG-LOD phase-B far-streamer schedule tests. Covers the SCHEDULING contract (no three, no GPU, no
// worker) with a fake far_field + a SYNCHRONOUS-resolving submit_build stub: (1) GAPLESS COVERAGE —
// once the coarse (L4) roots are built the DH keep set covers EVERY footprint (parent-substitution), so
// there is never an empty band; (2) UPLOAD THROTTLE — at most max_uploads_per_frame finished builds land
// per frame (the fly-p99 guard); (3) IN-FLIGHT CEILING — dispatch stops at max_in_flight; (4)
// COARSEST-FIRST — the first sections to LAND are the highest LOD level (coverage roots first); (5)
// PRUNE — moving the camera far away drops sections no longer wanted; (6) BOOTSTRAP — a cold start still
// dispatches (the ideal-target predicate breaks the deadlock); (7) MS BUDGET — the upload drain lands only a
// per-frame WALL-CLOCK slice's worth (steady vs the larger boot slice), carrying the rest to the next frame
// (driven by an injected fake clock + a per-upload cost, since the geometry build is variable-cost).
//
// Dispatch → upload is 2-PHASE: a build resolves into a `ready` queue (as a microtask), and the NEXT
// update() drains ≤ max_uploads_per_frame of it — so single-frame assertions account for that lag.
//
// Builds are ASYNC (worker in production), so the stub resolves via Promise; the driver flushes
// microtasks after each update so resolved uploads land before the next frame's assertions.

import { test, expect, describe } from 'bun:test'

import {
  create_far_streamer,
  section_is_trailing,
  PRUNE_TRAIL_MARGIN_M,
  FAR_UPLOAD_BUDGET_MS,
  FAR_UPLOAD_BUDGET_BOOT_MS,
} from '../../src/lod/far_streamer.js'
import { CORNERS_PER_EDGE } from '../../src/lod/far_mesher.js'
import { section_span_meters } from '../../src/lod/quadtree.js'

/** A minimal SMOOTH FarMesh (flat ground corner grid at y=100), NO world generator — keeps the
 *  scheduler tests fast + deterministic. @param {number} level @param {number} sx @param {number} sz
 *  @returns {import('../../src/lod/far_mesher.js').FarMesh} */
function stub_mesh(level, sx, sz) {
  const C = CORNERS_PER_EDGE
  const corner_h = new Float32Array(C * C).fill(100)
  const corner_c = new Uint8Array(C * C * 3).fill(120)
  const corner_n = new Float32Array(C * C * 3)
  for (let k = 0; k < C * C; k += 1) corner_n[k * 3 + 1] = 1
  const corner_mask = new Uint8Array(C * C).fill(1)
  const block_size = 1 << level
  return {
    kind: 'smooth',
    level,
    lod_scale: level & 0x3,
    origin_x: sx * 32 * block_size,
    origin_z: sz * 32 * block_size,
    block_size,
    ground: { corner_h, corner_c, corner_n, corner_mask, min_height: 100 },
    sky: null,
  }
}

/** Resolves synchronously (a settled Promise) so a microtask flush lands it.
 *  @param {number} level @param {number} sx @param {number} sz
 *  @returns {Promise<import('../../src/lod/far_mesher.js').FarMesh>} */
function stub_submit_build(level, sx, sz) {
  return Promise.resolve(stub_mesh(level, sx, sz))
}

/**
 * A fake far_field that records residency without any three.js — bytes tracked as a fixed 1000/section.
 * @returns {import('../../src/render/far_field.js').FarField & { ids: () => string[] }}
 */
function make_fake_far_field() {
  /** @type {Set<string>} */
  const live = new Set()
  return {
    upload_section(id) {
      live.add(id)
    },
    remove_section(id) {
      live.delete(id)
    },
    retire_section(id) {
      // Cross-fade retire in production; for the schedule tests it drops from residency immediately
      // (section_count()/bytes() must reflect the keep-set drop this frame — the fade lives in the real
      // far_field's dying list, invisible to the streamer's accounting).
      live.delete(id)
    },
    has(id) {
      return live.has(id)
    },
    section_count() {
      return live.size
    },
    bytes() {
      return live.size * 1000
    },
    set_sun_direction() {},
    set_resident_mask() {},
    tick() {},
    _mask_value_at() {
      return -1
    },
    _debug_ids() {
      return [...live] // TEMP DEBUG member the FarField typedef now requires (2026-07-04 far-pop lens)
    },
    dispose() {
      live.clear()
    },
    ids() {
      return [...live]
    },
  }
}

/** Flush pending microtasks so settled submit_build promises resolve + upload before the next assert. */
async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

/** Drives update() with an idle near ring until the target has fully built (or a frame cap), flushing
 *  microtasks each frame so async builds land. Records the ORDER sections first appear.
 *  @param {import('../../src/lod/far_streamer.js').FarStreamer} streamer
 *  @param {ReturnType<typeof make_fake_far_field>} far_field
 *  @param {[number,number]} camera_xz @param {number} near_radius_m @param {number} [cap] */
async function drain_idle(streamer, far_field, camera_xz, near_radius_m, cap = 4000) {
  /** @type {string[]} */
  const order = []
  let frames = 0
  while (streamer.pending_count() > 0 || streamer.section_count() === 0) {
    streamer.update({ camera_xz, near_radius_m })
    await flush()
    for (const id of far_field.ids()) if (!order.includes(id)) order.push(id)
    frames += 1
    if (frames > cap) break
  }
  return { order, frames }
}

const SPAWN = /** @type {[number, number]} */ ([70, 70])
const NEAR = 224

describe('section_is_trailing (coverage-safe prune predicate)', () => {
  const FAR = 2048
  // A section at the camera is inside the far disc → NOT trailing (must cross-fade, never hard-remove).
  test('a section under the camera is not trailing', () => {
    expect(section_is_trailing('4,0,0', 10, 10, FAR)).toBe(false)
  })
  // A section whose footprint sits just inside far_radius is still covering → not trailing.
  test('a section within far_radius is not trailing', () => {
    // L2 span 128 m; place its far edge ~ (FAR - 200) m from the camera along +x.
    const span = section_span_meters(2)
    const sx = Math.floor((FAR - 200) / span)
    expect(section_is_trailing(`2,${sx},0`, 0, 0, FAR)).toBe(false)
  })
  // A section whose NEAREST point is beyond far_radius + margin → a true trailing exit (hard-remove ok).
  test('a section fully beyond far_radius + margin is trailing', () => {
    const span = section_span_meters(4)
    // Nearest point must exceed FAR + PRUNE_TRAIL_MARGIN_M. Place origin well past that.
    const sx = Math.ceil((FAR + PRUNE_TRAIL_MARGIN_M + span) / span)
    expect(section_is_trailing(`4,${sx},0`, 0, 0, FAR)).toBe(true)
  })
  // Just OUTSIDE far_radius but INSIDE the trailing margin → NOT trailing yet (stays covering, cross-fades
  // if dropped) — the margin is the hysteresis that stops a boundary section from hard-vanishing.
  test('a section just past far_radius but within the margin is not yet trailing', () => {
    const span = section_span_meters(1)
    // Nearest point ~ FAR + margin/2 (inside the margin band).
    const nearest_target = FAR + PRUNE_TRAIL_MARGIN_M / 2
    const sx = Math.floor(nearest_target / span)
    expect(section_is_trailing(`1,${sx},0`, 0, 0, FAR)).toBe(false)
  })
})

describe('far_streamer schedule', () => {
  test('upload throttle: at most max_uploads_per_frame land per frame', async () => {
    const far_field = make_fake_far_field()
    const streamer = create_far_streamer({
      far_field,
      submit_build: stub_submit_build,
      far_radius_m: 2048,
      max_dispatch_per_frame: 20, // dispatch a burst
      max_uploads_per_frame: 2, // but only 2 may UPLOAD per frame
      max_in_flight: 100,
    })
    // Frame 1: dispatches a burst; the sync-resolved builds land in `ready` as microtasks AFTER this
    // frame's drain ran, so nothing is uploaded yet.
    streamer.update({ camera_xz: SPAWN, near_radius_m: NEAR })
    await flush()
    expect(far_field.section_count()).toBe(0)
    // Each subsequent frame drains exactly 2 from the ready queue.
    streamer.update({ camera_xz: SPAWN, near_radius_m: NEAR })
    await flush()
    expect(far_field.section_count()).toBe(2)
    streamer.update({ camera_xz: SPAWN, near_radius_m: NEAR })
    await flush()
    expect(far_field.section_count()).toBe(4)
  })

  test('in-flight ceiling: never more than max_in_flight builds outstanding', async () => {
    const far_field = make_fake_far_field()
    /** @type {(() => void)[]} */
    const resolvers = []
    // A build that NEVER resolves until we say so — lets us observe the in-flight ceiling: dispatch
    // stops at the ceiling while builds are parked.
    const parked_build = () => new Promise((res) => resolvers.push(() => res(stub_mesh(4, 0, 0))))
    const streamer = create_far_streamer({
      far_field,
      submit_build: parked_build,
      far_radius_m: 2048,
      max_in_flight: 4,
      max_dispatch_per_frame: 100,
      max_uploads_per_frame: 100,
      // Pin the BOOT-BURST caps to the same ceiling so this test observes the in-flight ceiling itself
      // (the burst only RAISES the ceiling; here we hold it at 4 to assert the mechanism).
      boot_max_in_flight: 4,
      boot_max_dispatch_per_frame: 100,
    })
    // Several idle frames — with nothing resolving, dispatch must stop at the 4-in-flight ceiling.
    for (let i = 0; i < 5; i += 1) {
      streamer.update({ camera_xz: SPAWN, near_radius_m: NEAR })
      await flush()
    }
    expect(resolvers.length).toBe(4) // dispatched exactly the ceiling, then stopped
    expect(far_field.section_count()).toBe(0) // nothing resolved yet
    // Resolve them; they queue. The NEXT update() drains the uploads (drain runs inside update).
    resolvers.forEach((r) => r())
    await flush()
    streamer.update({ camera_xz: SPAWN, near_radius_m: NEAR })
    await flush()
    expect(far_field.section_count()).toBe(4)
  })

  test('boot burst: raises dispatch for the first frames, then trickles to the steady cap', async () => {
    const far_field = make_fake_far_field()
    /** @type {((v: import('../../src/lod/far_mesher.js').FarMesh) => void)[]} */
    const resolvers = []
    // Parked builds never resolve → in-flight stays populated so we can COUNT how many were dispatched.
    const parked_build = () => new Promise((res) => resolvers.push(res))
    const streamer = create_far_streamer({
      far_field,
      submit_build: parked_build,
      far_radius_m: 2048,
      max_dispatch_per_frame: 2, // steady trickle
      max_in_flight: 100, // not the bottleneck here
      boot_burst_frames: 1, // burst only the FIRST frame
      boot_max_dispatch_per_frame: 10,
      boot_max_in_flight: 100,
    })
    // Frame 1 — burst ARMED: dispatches the boot cap (10), not the steady 2.
    streamer.update({ camera_xz: SPAWN, near_radius_m: NEAR })
    await flush()
    expect(resolvers.length).toBe(10)
    // Frame 2 — burst EXPIRED (1 frame): only the steady 2 more dispatch (10 → 12).
    streamer.update({ camera_xz: SPAWN, near_radius_m: NEAR })
    await flush()
    expect(resolvers.length).toBe(12)
  })

  // A fake far_field whose upload_section spends a FIXED `cost` ms of a shared fake clock per upload — the
  // variable-cost geometry build the ms budget governs. Returns { far_field, now, uploads_count }.
  function make_clocked_far_field(cost) {
    const base = make_fake_far_field()
    const clock = { t: 0 }
    const far_field = {
      ...base,
      upload_section(/** @type {string} */ id, /** @type {*} */ mesh) {
        clock.t += cost // this section's build "spends" `cost` ms of the frame's far slice
        base.upload_section(id, mesh)
      },
    }
    return { far_field, now: () => clock.t }
  }

  test('ms budget (steady): the drain lands ceil(FAR_UPLOAD_BUDGET_MS / cost) sections/frame, carrying the rest', async () => {
    const COST = 1 // fake ms per upload
    const { far_field, now } = make_clocked_far_field(COST)
    const streamer = create_far_streamer({
      far_field,
      submit_build: stub_submit_build,
      now,
      far_radius_m: 2048,
      // Flood `ready` so the ms SLICE — not the dispatch cap — bounds uploads.
      max_dispatch_per_frame: 300,
      max_in_flight: 800,
      boot_burst_frames: 0, // no boot burst → the STEADY slice governs every frame
    })
    const per_frame = Math.ceil(FAR_UPLOAD_BUDGET_MS / COST)
    // Frame 1: dispatch a big burst; sync builds resolve into `ready` as microtasks AFTER this frame's
    // (empty) drain — nothing uploads yet (2-phase).
    streamer.update({ camera_xz: SPAWN, near_radius_m: NEAR })
    await flush()
    expect(far_field.section_count()).toBe(0)
    // Each subsequent frame drains exactly one steady slice's worth (always ≥1), carrying the rest.
    streamer.update({ camera_xz: SPAWN, near_radius_m: NEAR })
    await flush()
    expect(far_field.section_count()).toBe(per_frame)
    streamer.update({ camera_xz: SPAWN, near_radius_m: NEAR })
    await flush()
    expect(far_field.section_count()).toBe(per_frame * 2)
  })

  test('ms budget (boot burst): the cold shell draws the larger FAR_UPLOAD_BUDGET_BOOT_MS slice', async () => {
    const COST = 1
    const { far_field, now } = make_clocked_far_field(COST)
    const streamer = create_far_streamer({
      far_field,
      submit_build: stub_submit_build,
      now,
      far_radius_m: 2048,
      max_dispatch_per_frame: 300,
      max_in_flight: 800,
      boot_max_dispatch_per_frame: 300,
      boot_max_in_flight: 800,
      boot_burst_frames: 10, // burst still armed on the drain frame below (shell stays cold until it lands)
    })
    const boot_per_frame = Math.ceil(FAR_UPLOAD_BUDGET_BOOT_MS / COST)
    streamer.update({ camera_xz: SPAWN, near_radius_m: NEAR }) // frame 1: dispatch only (2-phase)
    await flush()
    expect(far_field.section_count()).toBe(0)
    streamer.update({ camera_xz: SPAWN, near_radius_m: NEAR }) // frame 2: cold → BOOT slice
    await flush()
    expect(far_field.section_count()).toBe(boot_per_frame)
    // The boot slice lands strictly MORE per frame than the steady slice would (the "instant load" intent).
    expect(boot_per_frame).toBeGreaterThan(Math.ceil(FAR_UPLOAD_BUDGET_MS / COST))
  })

  test('move threshold: sub-hysteresis camera drift after full build causes ZERO section churn (stable shell while moving)', async () => {
    // [ENG-21 LOD-TRIM stability, design ruling 2026-07-07: polygons must stop constantly updating while moving] Once the shell
    // is fully built, drifting the camera LESS than SELECT_HYSTERESIS_M must not re-select/prune/re-upload
    // — the shell holds steady instead of re-tessellating every frame. We count far_field mutations across
    // a 1 m/frame drift totalling < the threshold and assert NOTHING moved.
    let uploads = 0
    let removes = 0
    let retires = 0
    const base = make_fake_far_field()
    const far_field = {
      ...base,
      upload_section: (/** @type {string} */ id, /** @type {*} */ m) => {
        uploads += 1
        base.upload_section(id, m)
      },
      remove_section: (/** @type {string} */ id) => {
        removes += 1
        base.remove_section(id)
      },
      retire_section: (/** @type {string} */ id) => {
        retires += 1
        base.retire_section(id)
      },
    }
    const streamer = create_far_streamer({ far_field, submit_build: stub_submit_build, far_radius_m: 1024 })
    await drain_idle(streamer, far_field, SPAWN, NEAR)
    // SETTLE to a TRUE steady state before sampling the baseline: drain_idle exits when the build target is
    // built, but a residual `ready` item (e.g. a coverage root still awaiting its per-frame upload slice)
    // can land a frame later, nudge built.size, and fire a reselect/retire cascade. Run static frames until
    // no mutation occurs — otherwise that one-time settle would be misattributed to the sub-hysteresis drift.
    let settle_prev = -1
    for (let i = 0; i < 120 && uploads + removes + retires !== settle_prev; i += 1) {
      settle_prev = uploads + removes + retires
      streamer.update({ camera_xz: SPAWN, near_radius_m: NEAR })
      await flush()
    }
    const [ups0, rms0, rts0] = [uploads, removes, retires]
    // Drift 1 m/frame for 12 frames (12 m total < SELECT_HYSTERESIS_M = 16) — under the threshold, no
    // reselection fires (built set already stable), so no section is uploaded, removed, or retired.
    for (let i = 1; i <= 12; i += 1) {
      streamer.update({ camera_xz: [SPAWN[0] + i, SPAWN[1]], near_radius_m: NEAR })
      await flush()
    }
    expect(uploads).toBe(ups0) // nothing new built/uploaded
    expect(removes).toBe(rms0) // nothing hard-removed
    expect(retires).toBe(rts0) // nothing retired — the near shell never re-tessellated under the drift
  })

  test('prune: moving the camera far away drops sections no longer in the target', async () => {
    const far_field = make_fake_far_field()
    const streamer = create_far_streamer({ far_field, submit_build: stub_submit_build, far_radius_m: 2048 })
    await drain_idle(streamer, far_field, SPAWN, NEAR)
    const before = streamer.section_count()
    expect(before).toBeGreaterThan(100)
    streamer.update({ camera_xz: [80_000, 80_000], near_radius_m: NEAR })
    await flush()
    expect(streamer.section_count()).toBeLessThan(before)
  })

  test('refinement switch leaves gapless coarse coverage without dispatching finer levels', async () => {
    const far_field = make_fake_far_field()
    const streamer = create_far_streamer({
      far_field,
      submit_build: stub_submit_build,
      far_radius_m: 1024,
      refine_lod: false,
      max_uploads_per_frame: 100,
    })
    await drain_idle(streamer, far_field, SPAWN, NEAR)
    expect(far_field.ids().length).toBeGreaterThan(0)
    expect(far_field.ids().every((id) => id.startsWith('4,'))).toBe(true)
  })

  test('promotion hook fires only when a finer section lands over coarse coverage', async () => {
    let promotions = 0
    const far_field = make_fake_far_field()
    const streamer = create_far_streamer({
      far_field,
      submit_build: stub_submit_build,
      far_radius_m: 1024,
      max_uploads_per_frame: 100,
      on_lod_promotion: () => {
        promotions += 1
      },
    })
    await drain_idle(streamer, far_field, SPAWN, NEAR)
    expect(promotions).toBeGreaterThan(0)
  })

  test('bytes() reflects residency and dispose() stops scheduling', async () => {
    const far_field = make_fake_far_field()
    const streamer = create_far_streamer({ far_field, submit_build: stub_submit_build, far_radius_m: 1024 })
    await drain_idle(streamer, far_field, SPAWN, NEAR)
    expect(streamer.bytes()).toBe(streamer.section_count() * 1000)
    streamer.dispose()
    const count = streamer.section_count()
    streamer.update({ camera_xz: SPAWN, near_radius_m: NEAR })
    await flush()
    expect(streamer.section_count()).toBe(count)
  })
})
