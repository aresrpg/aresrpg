// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Ring manager unit tests (§3.2 M1 streaming). Drives create_ring_manager with a FAKE gen pool
// (deferred, inspectable — so we can assert the in-flight budget before resolving) and a FAKE
// terrain renderer (counts upload/remove calls, no GPU). Meshing runs for real on real ChunkRecords
// (mesh_chunk is pure), so the all-air fast path and byte budgeting are exercised end to end.
//
// Covered: nearest-first priority order + deterministic tie-break, unload beyond radius+margin,
// in-flight gen budget cap, and the all-air fast path (0 quads → no upload, still counted loaded).

import { test, expect, describe } from 'bun:test'

import { create_chunk_record, local_index, set_occupancy_bit } from '../../src/chunks/format.js'
import { get_block_by_name } from '../../src/config/block_registry.js'
import { coord_key } from '../../src/chunks/store.js'
import { MSG_GEN_REQUEST, MSG_MESH_REQUEST } from '../../src/workers/rpc.js'
import { CHUNK_SIZE } from '../../src/config/world_config.js'
import { generate_world_chunk } from '../../src/gen/world_gen.js'
import { mesh_chunk } from '../../src/mesh/mesher.js'
import { deserialize_mesh_job } from '../../src/mesh/mesh_halo.js'
import { create_ring_manager, world_to_chunk_coord } from '../../src/core/ring_manager.js'

const STONE = /** @type {number} */ (get_block_by_name('stone')?.id)

/**
 * A fake gen pool: records submit order, holds each job's resolver so a test can control exactly
 * when (and whether) a chunk "finishes generating". `resolve_all` drains everything with the
 * factory-built record for each coord. Mirrors WorkerPool's submit/cancel/queue_depth/dispose shape.
 * @param {(cx: number, cy: number, cz: number) => import('../../src/chunks/format.js').ChunkRecord} record_for
 */
function create_fake_pool(record_for) {
  /** @type {Array<{ cx: number, cy: number, cz: number, resolve: (r: unknown) => void, reject: (e: Error) => void }>} */
  const jobs = []
  /** @type {Array<[number, number, number]>} */
  const submitted = []
  return {
    submitted,
    jobs,
    /** @type {import('../../src/workers/pool.js').WorkerPool['submit']} */
    submit(type, payload) {
      expect(type).toBe(MSG_GEN_REQUEST)
      const { cx, cy, cz } = /** @type {{cx:number,cy:number,cz:number}} */ (payload)
      submitted.push([cx, cy, cz])
      return new Promise((resolve, reject) => jobs.push({ cx, cy, cz, resolve, reject }))
    },
    cancel() {},
    queue_depth() {
      return jobs.length
    },
    dispose() {},
    /** Resolves every pending job with its factory record, oldest first. */
    resolve_all() {
      const pending = jobs.splice(0, jobs.length)
      for (const job of pending) job.resolve(record_for(job.cx, job.cy, job.cz))
    },
  }
}

/**
 * A fake mesh worker pool: holds each MSG_MESH_REQUEST so a test controls when it "returns", then runs
 * the REAL worker path (deserialize_mesh_job → mesh_chunk) to produce a faithful result — so the async
 * dispatch + integration + stale-drop machinery is exercised end to end, off a real serialized payload.
 */
function create_fake_mesh_pool() {
  /** @type {Array<{ payload: any, resolve: (r: unknown) => void, reject: (e: Error) => void }>} */
  const jobs = []
  return {
    jobs,
    /** @type {import('../../src/workers/pool.js').WorkerPool['submit']} */
    submit(type, payload) {
      expect(type).toBe(MSG_MESH_REQUEST)
      return new Promise((resolve, reject) => jobs.push({ payload, resolve, reject }))
    },
    cancel() {},
    queue_depth() {
      return jobs.length
    },
    dispose() {},
    /** Resolves every pending mesh job by running the worker pipeline on its serialized payload. */
    resolve_all() {
      const pending = jobs.splice(0, jobs.length)
      for (const job of pending) {
        const { chunk, halos, render_fins } = deserialize_mesh_job(job.payload)
        const { quad_buffer, quad_count } = mesh_chunk(chunk, halos, render_fins)
        job.resolve({ cx: job.payload.cx, cy: job.payload.cy, cz: job.payload.cz, quad_buffer, quad_count })
      }
    },
  }
}

/** A counting fake terrain renderer — no GPU. Tracks uploaded/removed chunk keys. */
function create_fake_renderer() {
  /** @type {Set<string>} */
  const uploaded = new Set()
  /** @type {string[]} */
  const upload_order = []
  /** @type {string[]} */
  const removed = []
  return {
    uploaded,
    upload_order,
    removed,
    /** @type {import('../../src/render/pool_renderer.js').TerrainRenderer['upload_chunk']} */
    upload_chunk([cx, cy, cz]) {
      const key = coord_key(cx, cy, cz)
      uploaded.add(key)
      upload_order.push(key)
    },
    /** @type {import('../../src/render/pool_renderer.js').TerrainRenderer['remove_chunk']} */
    remove_chunk([cx, cy, cz]) {
      const key = coord_key(cx, cy, cz)
      uploaded.delete(key)
      removed.push(key)
    },
    update() {},
    get_stats() {
      return { draw_calls: 0, quads: 0, liquid_quads: 0, sector_count: 0, chunk_count: uploaded.size }
    },
    // W11 + shadow-scope: ring_manager never calls these (they're the render lane's shadow-cache +
    // teardown surface); stubbed so the fake still satisfies the TerrainRenderer type after it grew.
    upload_epoch: () => 0,
    shadow_epoch: () => 0,
    set_shadow_box() {},
    dispose() {},
  }
}

/** All-air record (zeroed) → mesh_chunk yields 0 quads. @param {number} cx @param {number} cy @param {number} cz */
function air_record(cx, cy, cz) {
  return create_chunk_record(cx, cy, cz)
}

/** A record with one solid stone block at local (1,1,1) → mesh_chunk yields >0 quads.
 * @param {number} cx @param {number} cy @param {number} cz */
function solid_record(cx, cy, cz) {
  const chunk = create_chunk_record(cx, cy, cz)
  const [x, y, z] = [1, 1, 1]
  chunk.ids[local_index(x, y, z)] = STONE
  set_occupancy_bit(chunk, 0, y * CHUNK_SIZE + z, x, true)
  set_occupancy_bit(chunk, 1, x * CHUNK_SIZE + z, y, true)
  set_occupancy_bit(chunk, 2, x * CHUNK_SIZE + y, z, true)
  return chunk
}

describe('ring_manager', () => {
  test('world_to_chunk_coord floors toward -inf (correct for negatives)', () => {
    expect(world_to_chunk_coord([0, 0, 0])).toEqual([0, 0, 0])
    expect(world_to_chunk_coord([31, 63, 32])).toEqual([0, 1, 1])
    expect(world_to_chunk_coord([-1, -1, -33])).toEqual([-1, -1, -2])
  })

  test('gen requests go out nearest-first with a deterministic tie-break', () => {
    const pool = create_fake_pool(solid_record)
    const renderer = create_fake_renderer()
    const ring = create_ring_manager({
      pool,
      terrain_renderer: renderer,
      load_radius: 2,
      vertical_chunks: 1, // single layer keeps ranking purely horizontal for a clean assertion
      max_gen_in_flight: 999, // unbounded so the FULL ring is requested in one update
      now: () => 0,
    })

    ring.update([0, 0, 0])

    // Center first; then the 4 axis neighbors at dist²=1 in tie-break order (cy,cx,cz → since cy is
    // constant, cx then cz): (-1,0),(0,-1),(0,1),(1,0) mapped to [cx,0,cz].
    const first5 = pool.submitted.slice(0, 5).map(([cx, , cz]) => [cx, cz])
    expect(first5).toEqual([
      [0, 0],
      [-1, 0],
      [0, -1],
      [0, 1],
      [1, 0],
    ])
    // Every requested distance² is monotonically non-decreasing (nearest-first invariant).
    const d2 = pool.submitted.map(([cx, , cz]) => cx * cx + cz * cz)
    for (let i = 1; i < d2.length; i += 1) expect(d2[i]).toBeGreaterThanOrEqual(d2[i - 1])
    // radius 2, 1 layer → (2*2+1)² = 25 chunks total.
    expect(pool.submitted.length).toBe(25)
  })

  test('[D259] with a FORWARD facing, the under-player column still loads FIRST (spiral, not forward half-plane)', () => {
    const pool = create_fake_pool(solid_record)
    const ring = create_ring_manager({
      pool,
      terrain_renderer: create_fake_renderer(),
      load_radius: 3,
      vertical_chunks: 1,
      max_gen_in_flight: 999,
      now: () => 0,
    })
    // facing +x with the DEFAULT bias — the exact owner scenario (spawn looking forward). The old
    // block²-vs-chunk² unit bug loaded the whole +x half-plane before the feet; the bounded tiebreak fix
    // keeps the under-player column (0,0,0) strictly first and the order nearest-first (spiral).
    ring.update([0, 0, 0], [1, 0, 0])
    const [[cx0, , cz0]] = pool.submitted
    expect([cx0, cz0]).toEqual([0, 0]) // the player's OWN chunk first — never a forward ring
    const d2 = pool.submitted.map(([cx, , cz]) => cx * cx + cz * cz)
    for (let i = 1; i < d2.length; i += 1) expect(d2[i]).toBeGreaterThanOrEqual(d2[i - 1]) // spiral holds
  })

  test('exports loaded radius + fog-far ceiling in blocks/meters for the render lane', () => {
    const ring = create_ring_manager({
      pool: create_fake_pool(solid_record),
      terrain_renderer: create_fake_renderer(),
      load_radius: 5,
      now: () => 0,
    })
    expect(ring.loaded_radius_blocks()).toBe(5 * CHUNK_SIZE) // 160 m
    expect(ring.fog_far_ceiling_m()).toBe((5 - 1.5) * CHUNK_SIZE) // 112 m — fog must stay ≤ this
  })

  test('ring hysteresis: no new gen requests on a steady frame (no boundary cross)', () => {
    const pool = create_fake_pool(solid_record)
    const ring = create_ring_manager({
      pool,
      terrain_renderer: create_fake_renderer(),
      load_radius: 2,
      vertical_chunks: 1,
      max_gen_in_flight: 4,
      now: () => 0,
    })

    ring.update([0, 0, 0]) // boundary cross (first) → requests up to the budget
    const after_first = pool.submitted.length
    expect(after_first).toBe(4)

    // Same camera chunk again (no boundary cross) with jobs still in flight → must NOT re-scan the
    // ring or submit more (hysteresis). Budget is full anyway, but the point is: no per-frame churn.
    ring.update([0, 0, 0])
    expect(pool.submitted.length).toBe(after_first)
  })

  test('never exceeds max_gen_in_flight concurrent jobs', () => {
    const pool = create_fake_pool(solid_record)
    const renderer = create_fake_renderer()
    const ring = create_ring_manager({
      pool,
      terrain_renderer: renderer,
      load_radius: 5, // 121-chunk footprint, far more than the budget
      vertical_chunks: 1,
      max_gen_in_flight: 4,
      now: () => 0,
    })

    ring.update([0, 0, 0])
    expect(pool.jobs.length).toBe(4) // exactly the budget in flight, not the whole ring
    expect(ring.queue_depth()).toBe(4)

    // A steady re-update while jobs are still outstanding must NOT over-submit.
    ring.update([0, 0, 0])
    expect(pool.jobs.length).toBe(4)

    // Resolve the batch; meshing runs; slots free → the next update tops back up to the budget.
    pool.resolve_all()
    return Promise.resolve().then(() => {
      ring.update([0, 0, 0])
      expect(pool.jobs.length).toBe(4)
    })
  })

  test('all-air chunk fast path: resolved + counted loaded, but never uploaded', async () => {
    const pool = create_fake_pool(air_record)
    const renderer = create_fake_renderer()
    /** @type {number} */
    let loaded = 0
    const ring = create_ring_manager({
      pool,
      terrain_renderer: renderer,
      load_radius: 1,
      vertical_chunks: 1,
      max_gen_in_flight: 999,
      mesh_budget_ms: 999,
      mesh_pacing_steps: [[0, 999]], // flat high ladder: mesh the whole ready set in one update (no pacing)
      now: () => 0,
      on_chunk_loaded: () => (loaded += 1),
    })

    ring.update([0, 0, 0]) // 3×3 = 9 gen jobs
    expect(pool.submitted.length).toBe(9)

    pool.resolve_all()
    await Promise.resolve() // let the gen .then() handlers run → chunks land in mesh_ready

    ring.update([0, 0, 0]) // meshes the 9 all-air chunks
    ring.drain_uploads(1024 * 1024)

    expect(loaded).toBe(9) // every chunk resolved as "loaded" for an honest HUD count
    expect(renderer.uploaded.size).toBe(0) // ...but zero uploads (0 quads each — fast path)
    expect(ring.queue_depth()).toBe(0) // nothing left pending
  })

  test('solid chunks upload, nearest-first, then unload beyond radius+margin', async () => {
    const pool = create_fake_pool(solid_record)
    const renderer = create_fake_renderer()
    const ring = create_ring_manager({
      pool,
      terrain_renderer: renderer,
      load_radius: 1,
      unload_margin: 0, // tight so a 1-chunk camera move evicts the trailing edge immediately
      vertical_chunks: 1,
      max_gen_in_flight: 999,
      mesh_budget_ms: 999,
      mesh_pacing_steps: [[0, 999]], // flat high ladder: mesh the whole ready set in one update (no pacing)
      now: () => 0,
    })

    ring.update([0, 0, 0])
    pool.resolve_all()
    await Promise.resolve()
    ring.update([0, 0, 0])
    ring.drain_uploads(1024 * 1024)

    expect(renderer.uploaded.size).toBe(9) // full 3×3 uploaded
    // Nearest-first upload: the center chunk uploads before any dist²=2 corner.
    expect(renderer.upload_order[0]).toBe(coord_key(0, 0, 0))
    expect(renderer.upload_order.indexOf(coord_key(0, 0, 0))).toBeLessThan(
      renderer.upload_order.indexOf(coord_key(1, 0, 1))
    )

    // Move the camera +2 chunks in x. With radius 1 + margin 0, the old column at cx=-1 is now
    // Chebyshev distance 3 > 1 → evicted; new column at cx=3 streams in.
    ring.update([2, 0, 0])
    expect(renderer.removed).toContain(coord_key(-1, 0, 0))
    expect(renderer.removed).toContain(coord_key(-1, 0, 1))
    expect(renderer.removed).toContain(coord_key(-1, 0, -1))
    expect(renderer.uploaded.has(coord_key(-1, 0, 0))).toBe(false)
  })

  test('drain_uploads honors the per-frame byte budget (nearest first)', async () => {
    const pool = create_fake_pool(solid_record)
    const renderer = create_fake_renderer()
    const ring = create_ring_manager({
      pool,
      terrain_renderer: renderer,
      load_radius: 2,
      vertical_chunks: 1,
      max_gen_in_flight: 999,
      mesh_budget_ms: 999,
      mesh_pacing_steps: [[0, 999]], // flat high ladder: mesh the whole ready set in one update (no pacing)
      now: () => 0,
    })

    ring.update([0, 0, 0])
    pool.resolve_all()
    await Promise.resolve()
    ring.update([0, 0, 0]) // 25 chunks meshed + enqueued

    // A single solid_record chunk meshes to a handful of quads; each quad = 8 bytes. A tiny budget
    // uploads at least one (the queue always drains ≥1 to avoid starving) but far fewer than all 25.
    const before = renderer.uploaded.size
    expect(before).toBe(0)
    ring.drain_uploads(8) // ~one small chunk's worth
    expect(renderer.uploaded.size).toBeGreaterThanOrEqual(1)
    expect(renderer.uploaded.size).toBeLessThan(25)
    // The first uploaded chunk under the budget is the nearest (center).
    expect(renderer.upload_order[0]).toBe(coord_key(0, 0, 0))

    // Draining with a generous budget flushes the rest.
    ring.drain_uploads(1024 * 1024)
    expect(renderer.uploaded.size).toBe(25)
  })

  // Integration smoke: the REAL world generator through the full gen→mesh→upload pipeline (fake
  // uploader, no GPU). Proves halos build against resident neighbors and surface chunks produce
  // real geometry — the actual streaming path, not synthetic records.
  test('real world_gen flows end to end: surface chunks upload non-empty geometry', async () => {
    const pool = create_fake_pool(generate_world_chunk)
    const renderer = create_fake_renderer()
    const ring = create_ring_manager({
      pool,
      terrain_renderer: renderer,
      load_radius: 2,
      vertical_chunks: 6, // cy 0..5 covers the default-seed surface band (~y113-156)
      max_gen_in_flight: 999,
      mesh_budget_ms: 999,
      mesh_pacing_steps: [[0, 999]], // flat high ladder: mesh the whole ready set in one update (no pacing)
      now: () => 0,
    })

    // Spawn near origin (surface ~y134 → chunk cy 4). Stream the whole footprint in one pass.
    ring.update(world_to_chunk_coord([16, 134, 16]))
    expect(pool.submitted.length).toBe((2 * 2 + 1) ** 2 * 6) // 5×5 columns × 6 layers = 150

    pool.resolve_all()
    await Promise.resolve()
    ring.update(world_to_chunk_coord([16, 134, 16]))
    ring.drain_uploads(64 * 1024 * 1024) // flush everything

    // The surface layer must produce real, uploaded geometry (not all-air-skipped). Air chunks
    // above the surface are correctly skipped, so uploaded < total — but well above zero.
    expect(renderer.uploaded.size).toBeGreaterThan(10)
    expect(renderer.uploaded.size).toBeLessThan(150)
    expect(ring.resident_count()).toBe(150) // every generated chunk is store-resident
    expect(ring.queue_depth()).toBe(0)
  }, 10_000) // e2e gens 150 real DEFAULT chunks: measured ~2.5s isolated / up to ~7.4s under full-suite load
  // (2026-07-07: accumulated FIVE-WORLDS gen stages — glacial crag/trough/cirque + schematic grounding).
  // 10s headroom over the default 5s so a loaded runner doesn't false-red; per-chunk gen ≈ 3.9ms (not a regression).

  // ADAPTIVE MESH PACING (2026-07-03): the meshes/frame ceiling scales with the pending backlog. With a
  // small explicit ladder we prove: a deep ready-queue meshes MANY per update, and a per-frame count is
  // bounded by the ladder step (not the whole queue).
  test('adaptive mesh pacing: meshes/frame scales with pending backlog, bounded by the ladder step', async () => {
    const pool = create_fake_pool(solid_record)
    const renderer = create_fake_renderer()
    const ring = create_ring_manager({
      pool,
      terrain_renderer: renderer,
      load_radius: 3, // 49-chunk footprint (1 layer) — plenty of ready backlog
      vertical_chunks: 1,
      max_gen_in_flight: 999, // request the whole ring up front
      mesh_budget_ms: 999, // frozen clock never trips the deadline → the ladder count is the only cap
      // Ladder: <20 pending ⇒ 2/frame, ≥20 ⇒ 5/frame. The full 49-chunk backlog is ≥20 ⇒ first update
      // meshes exactly 5 (the top step), not all 49.
      mesh_pacing_steps: [
        [0, 2],
        [20, 5],
      ],
      frame_governor_ms: 0, // isolate the ladder: no frame-time throttle (tests don't feed a frame time)
      now: () => 0,
    })

    ring.update([0, 0, 0])
    pool.resolve_all()
    await Promise.resolve() // gen .then() → all 49 land in mesh_ready

    ring.update([0, 0, 0]) // deep backlog (≥20) ⇒ top step ⇒ mesh exactly 5
    ring.drain_uploads(1024 * 1024)
    expect(renderer.uploaded.size).toBe(5)

    // Keep pumping: the backlog stays ≥20 for the next few frames (44 → 39 → …), so each update also
    // meshes 5, until it falls below 20 and drops to 2/frame. Two more updates ⇒ +10 (15 total).
    ring.update([0, 0, 0])
    ring.update([0, 0, 0])
    ring.drain_uploads(1024 * 1024)
    expect(renderer.uploaded.size).toBe(15)
  })

  // FRAME GOVERNOR — ENG-14 ROOT-CAUSE FIX (2026-07-04, owner 5K/ULTRA "the LOD takes a minute to
  // fill"). The governor must throttle streaming to the floor ONLY during the bounded boot pipeline-
  // compile window; a long frame PAST that window is GPU-fill-bound (NOT streaming work) and must NOT
  // throttle — else on a heavy-fill rig every frame throttles and the disc drains at 1 mesh/frame. This
  // pins both halves so a regression to the old "throttle on any long frame forever" trips immediately.
  test('frame governor: long frame throttles IN the boot window, but NOT past it (ENG-14 fill-bound fix)', async () => {
    const pool = create_fake_pool(solid_record)
    const renderer = create_fake_renderer()
    let clock = 0
    const ring = create_ring_manager({
      pool,
      terrain_renderer: renderer,
      load_radius: 6, // deep ready backlog (169 chunks, 1 layer) — never dries across the pumped frames
      vertical_chunks: 1,
      max_gen_in_flight: 999,
      // ALL wall-clock budgets huge → never trip a deadline, so the mesh COUNT (ladder vs floor) is the
      // ONLY cap and the throttle behavior is what the assertions read (isolate the governor from the
      // three-level slice, incl. the ENG-14 GPU-bound slice which would otherwise cap the long frame).
      mesh_budget_ms: 999,
      mesh_budget_relaxed_ms: 999,
      mesh_budget_gpu_bound_ms: 999,
      // floor step = 1/frame; deep-backlog step = 20/frame. A THROTTLED frame meshes 1; an
      // UN-throttled deep-backlog frame meshes 20 — a clean, unambiguous behavioral split.
      mesh_pacing_steps: [
        [0, 1],
        [10, 20],
      ],
      frame_governor_ms: 22, // the real closed-loop governor (NOT disabled) — this is what we're testing
      now: () => clock,
    })

    // Fill the ready queue (first update = boot frame-0, recent_frame_ms omitted ⇒ throttled by design).
    ring.update([0, 0, 0])
    pool.resolve_all()
    await Promise.resolve() // all 49 land in mesh_ready

    // t≈100ms (INSIDE the 4s boot window): feed a LONG frame (66ms > 22ms governor). During boot a long
    // frame is the pipeline-compile transient ⇒ THROTTLE ⇒ mesh only the floor (1).
    clock = 100
    ring.update([0, 0, 0], undefined, 66)
    ring.drain_uploads(1024 * 1024)
    expect(renderer.uploaded.size).toBe(1) // throttled to the floor inside the boot window

    // t≈6000ms (PAST the 4s boot window): the throttle HOLD (2 frames) set by the in-window long frame
    // must first expire — pump two cheap frames past the window to clear it (their exact mesh counts are
    // irrelevant, we only care that `throttled` has decayed to false). Then feed the SAME long 66ms
    // frame: past the window it can only be GPU fill (all variants long compiled) ⇒ NOT throttled ⇒ the
    // full deep-backlog step (20), NOT the floor (1). THIS is the fix — the old code throttled here too.
    clock = 6000
    ring.update([0, 0, 0], undefined, 8) // clear hold (frame 1)
    ring.update([0, 0, 0], undefined, 8) // clear hold (frame 2) — throttled now false
    ring.drain_uploads(1024 * 1024)
    const before = renderer.uploaded.size
    ring.update([0, 0, 0], undefined, 66) // LONG frame past the window ⇒ fill-bound ⇒ NOT throttled
    ring.drain_uploads(1024 * 1024)
    expect(renderer.uploaded.size - before).toBe(20) // full step, not the floor — the ENG-14 fill-bound fix
  })

  // FORWARD-BIAS PRIORITY (2026-07-03): equidistant chunks ahead of the camera facing resolve before
  // ones to the side/behind, so the visible area detailises first. A large bias makes the ordering
  // deterministic for the assertion.
  test('forward-bias: a chunk ahead of the camera facing uploads before an equidistant side chunk', async () => {
    const pool = create_fake_pool(solid_record)
    const renderer = create_fake_renderer()
    const ring = create_ring_manager({
      pool,
      terrain_renderer: renderer,
      load_radius: 1,
      vertical_chunks: 1,
      max_gen_in_flight: 999,
      mesh_budget_ms: 999,
      mesh_pacing_steps: [[0, 999]],
      forward_bias_chunks2: 0.9, // [D259] bounded intra-ring tiebreak — forward wins WITHIN a ring, never across
      now: () => 0,
    })

    // Facing +x (unit). The forward chunk (+1,0,0) and the side chunk (0,0,+1) are BOTH dist²=1 from
    // the camera column — with the forward bias, (+1,0,0) must upload before (0,0,+1).
    ring.update([0, 0, 0], [1, 0, 0])
    pool.resolve_all()
    await Promise.resolve()
    ring.update([0, 0, 0], [1, 0, 0])
    ring.drain_uploads(1024 * 1024)

    // The forward chunk (dot>0 with facing) gets the full bias pull; the side (dot=0) and rear (dot<0)
    // chunks get NONE (only forward columns are pulled), so they keep pure nearest-first — the forward
    // chunk must beat BOTH of its equidistant neighbours.
    const ahead = renderer.upload_order.indexOf(coord_key(1, 0, 0))
    const side = renderer.upload_order.indexOf(coord_key(0, 0, 1))
    const behind = renderer.upload_order.indexOf(coord_key(-1, 0, 0))
    expect(ahead).toBeGreaterThanOrEqual(0)
    expect(ahead).toBeLessThan(side) // ahead beats an equidistant side chunk
    expect(ahead).toBeLessThan(behind) // ...and the equidistant rear chunk
  })

  // OFF-THREAD MESH PATH (mesh worker pool wired): meshing dispatches to the pool and integrates
  // asynchronously. Proves dispatch → in-flight accounting → integrate → upload, and the stale-result drop.
  test('mesh_pool: chunks dispatch off-thread, integrate on resolve, then upload', async () => {
    const pool = create_fake_pool(solid_record)
    const mesh_pool = create_fake_mesh_pool()
    const renderer = create_fake_renderer()
    const ring = create_ring_manager({
      pool,
      mesh_pool,
      terrain_renderer: renderer,
      load_radius: 1,
      vertical_chunks: 1,
      max_gen_in_flight: 999,
      max_mesh_in_flight: 999,
      mesh_budget_ms: 999,
      mesh_pacing_steps: [[0, 999]],
      now: () => 0,
    })

    ring.update([0, 0, 0])
    pool.resolve_all()
    await Promise.resolve() // gen .then() → 9 chunks land in mesh_ready

    ring.update([0, 0, 0]) // DISPATCHES 9 mesh jobs to the pool (does NOT mesh inline)
    expect(mesh_pool.jobs.length).toBe(9)
    expect(renderer.uploaded.size).toBe(0) // nothing meshed on this thread → nothing to upload yet
    expect(ring.queue_depth()).toBe(9) // 9 meshes in flight counted in queue_depth (boot-done waits)

    mesh_pool.resolve_all()
    await Promise.resolve() // mesh .then() → replies wait in the frame-drained integration queue
    ring.update([0, 0, 0]) // integrates the queued replies (fake clock never spends the slice)
    ring.drain_uploads(1024 * 1024)

    expect(renderer.uploaded.size).toBe(9) // all 9 uploaded after the off-thread results landed
    expect(renderer.upload_order[0]).toBe(coord_key(0, 0, 0)) // nearest-first preserved
    expect(ring.queue_depth()).toBe(0) // fully drained
  })

  test('mesh_pool: a chunk unloaded mid-flight has its result DROPPED (stale-drop)', async () => {
    const pool = create_fake_pool(solid_record)
    const mesh_pool = create_fake_mesh_pool()
    const renderer = create_fake_renderer()
    const ring = create_ring_manager({
      pool,
      mesh_pool,
      terrain_renderer: renderer,
      load_radius: 1,
      unload_margin: 0,
      vertical_chunks: 1,
      max_gen_in_flight: 999,
      max_mesh_in_flight: 999,
      mesh_budget_ms: 999,
      mesh_pacing_steps: [[0, 999]],
      now: () => 0,
    })

    ring.update([0, 0, 0])
    pool.resolve_all()
    await Promise.resolve()
    ring.update([0, 0, 0]) // 9 meshes dispatched, in flight
    expect(mesh_pool.jobs.length).toBe(9)

    // Fly far away BEFORE the meshes return: every in-flight chunk unloads (phase 'meshing' → epoch
    // forgotten). Their now-stale results must NOT upload geometry for evicted chunks.
    ring.update([100, 0, 0])
    expect(renderer.removed).toContain(coord_key(0, 0, 0))

    mesh_pool.resolve_all() // the stale results come back
    await Promise.resolve()
    ring.drain_uploads(1024 * 1024)

    expect(renderer.uploaded.has(coord_key(0, 0, 0))).toBe(false) // dropped, not uploaded
    // in-flight count returned to 0 (settled jobs decremented even though dropped), so queue_depth is
    // only the NEW ring's pending gen — never a stuck phantom mesh.
  })

  test('mesh_pool: all-air chunks integrate as loaded with zero uploads (off-thread fast path)', async () => {
    const pool = create_fake_pool(air_record)
    const mesh_pool = create_fake_mesh_pool()
    const renderer = create_fake_renderer()
    let loaded = 0
    const ring = create_ring_manager({
      pool,
      mesh_pool,
      terrain_renderer: renderer,
      load_radius: 1,
      vertical_chunks: 1,
      max_gen_in_flight: 999,
      max_mesh_in_flight: 999,
      mesh_budget_ms: 999,
      mesh_pacing_steps: [[0, 999]],
      now: () => 0,
      on_chunk_loaded: () => (loaded += 1),
    })

    ring.update([0, 0, 0])
    pool.resolve_all()
    await Promise.resolve()
    ring.update([0, 0, 0]) // dispatch 9 all-air meshes
    mesh_pool.resolve_all()
    await Promise.resolve()
    ring.update([0, 0, 0]) // frame-drained reply integration; all-air still skips upload
    ring.drain_uploads(1024 * 1024)

    expect(loaded).toBe(9) // every chunk counted loaded (honest HUD)
    expect(renderer.uploaded.size).toBe(0) // ...but 0 quads each ⇒ no upload
    expect(ring.queue_depth()).toBe(0)
  })

  // FIRST-LOAD analytic-ground seam: block_id_or_null must distinguish RESIDENT-AIR (0, real) from
  // UNSTREAMED (null, so the engine substitutes analytic ground), while block_id_at stays 0-for-both
  // (frozen contract). rendered_column_count feeds the reveal front.
  test('block_id_or_null: resident (incl. air) vs unstreamed; rendered_column_count tracks drawn columns', async () => {
    const pool = create_fake_pool(solid_record)
    const renderer = create_fake_renderer()
    const ring = create_ring_manager({
      pool,
      terrain_renderer: renderer,
      load_radius: 1,
      vertical_chunks: 1,
      max_gen_in_flight: 999,
      mesh_budget_ms: 999,
      mesh_pacing_steps: [[0, 999]],
      now: () => 0,
    })

    // Nothing streamed yet: null (analytic-fallback territory), block_id_at 0, zero drawn columns.
    expect(ring.block_id_or_null(1, 1, 1)).toBeNull()
    expect(ring.block_id_at(1, 1, 1)).toBe(0)
    expect(ring.rendered_column_count()).toBe(0)

    ring.update([0, 0, 0])
    pool.resolve_all()
    await Promise.resolve()
    ring.update([0, 0, 0])
    ring.drain_uploads(64 * 1024 * 1024)

    // Resident chunk (0,0,0): the solid block reads its id; a resident AIR cell reads 0 (NOT null).
    expect(ring.block_id_or_null(1, 1, 1)).toBe(STONE)
    expect(ring.block_id_or_null(5, 5, 5)).toBe(0)
    expect(ring.block_id_at(1, 1, 1)).toBe(STONE)

    // A far column never streamed ⇒ null (block_id_at stays 0 — the frozen resident-only contract).
    expect(ring.block_id_or_null(1000, 1, 1000)).toBeNull()
    expect(ring.block_id_at(1000, 1, 1000)).toBe(0)

    // Out of world height ⇒ 0 on BOTH (definitively air — never an analytic fallback).
    expect(ring.block_id_or_null(1, -1, 1)).toBe(0)
    expect(ring.block_id_or_null(1, 100000, 1)).toBe(0)

    // The 3×3 solid columns all uploaded geometry ⇒ 9 drawn columns.
    expect(ring.rendered_column_count()).toBe(9)
  })

  test('chunk_resident opens only the requested vertical layer, before the 5x5 focus ring', async () => {
    const pool = create_fake_pool(air_record)
    const ring = create_ring_manager({
      pool,
      terrain_renderer: create_fake_renderer(),
      load_radius: 2,
      vertical_chunks: 2,
      max_gen_in_flight: 999,
      now: () => 0,
    })

    ring.update([0, 0, 0])
    expect(ring.chunk_resident(0.5, 1, 0.5)).toBe(false)
    const center = pool.jobs.filter(({ cx, cz }) => cx === 0 && cz === 0)
    expect(center).toHaveLength(2)

    center[0].resolve(air_record(center[0].cx, center[0].cy, center[0].cz))
    await Promise.resolve()
    expect(ring.chunk_resident(0.5, center[0].cy * 32 + 1, 0.5)).toBe(true)
    expect(ring.chunk_resident(0.5, center[1].cy * 32 + 1, 0.5)).toBe(false)

    center[1].resolve(air_record(center[1].cx, center[1].cy, center[1].cz))
    await Promise.resolve()
    expect(ring.chunk_resident(0.5, center[1].cy * 32 + 1, 0.5)).toBe(true)
    expect(ring.chunk_resident(32.5, center[1].cy * 32 + 1, 0.5)).toBe(false)
    expect(ring.resident_count()).toBe(2) // unlock at 1 column; focus_ready would require 25 * 2 = 50
  })
})
