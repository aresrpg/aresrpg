// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RENDER-HOLE REGRESSION (live bug 2026-07-12, ~world 268,127,-214, water/beach: "character stands
// mid-air on invisible terrain — collision exists but the blocks don't render; a chunk-shaped region shows
// the water plane/void where ground should be"). Root diagnosis: NOT a gen/mesh defect (proven below) —
// the render-side quad pool (pool_renderer.js) overflows because GEN_VERSION 8 flipped procedural trees on
// by default, ~quadrupling solid geometry (2.7 → 10 solid slots/col) past the pool's ~5.8 solid-slots/col
// budget; the over-capacity chunk's solid upload is dropped (write_chunk → false) yet the ring still marks
// the column rendered and never retries → a permanent silent hole (the liquid slot fits, so water draws
// where ground was dropped). See the deterministic evidence + the render-lane pool-sizing fix in the report.
//
// This suite locks in the two invariants the investigation established, deterministic + no browser:
//   1. SUSPECT-A GUARD (green): a water-adjacent SOLID-GROUND chunk meshes to NON-EMPTY geometry — the
//      hydrology river-clamp / liquid face-culling never erases a solid surface. If a future gen/mesh change
//      ever culls a water-adjacent solid chunk to an empty mesh (the ORIGINAL suspect), this fails loudly.
//   2. SEAM INVARIANT (test.todo until the render lane resizes the solid pool): a RESIDENT (collidable)
//      chunk's solid mesh must fit the render pool, else it is dropped ⇒ collision without a render mesh —
//      exactly this bug. Documented here with the measured numbers so it becomes a one-flip active gate the
//      moment SLOTS_PER_COLUMN.solid is raised to cover the proc-tree world.

import { test, expect, describe, afterAll } from 'bun:test'
import { Scene } from 'three'

import { CHUNK_SIZE, CHUNKS_PER_COLUMN } from '../../src/config/world_config.js'
import { get_block_by_id } from '../../src/config/block_registry.js'
import { generate_world_chunk, world_surface_y, set_gen_config } from '../../src/gen/world_gen.js'
import { build_neighbor_halos } from '../../src/chunks/store.js'
import {
  partition_quads,
  SLOT_QUADS,
  SLOTS_PER_COLUMN,
  create_terrain_renderer,
} from '../../src/render/pool_renderer.js'
import { WORLD_CONFIGS } from '../../src/config/worlds/index.js'
import { DEFAULT_WORLD_GEN_CONFIG } from '../../src/config/world_gen_config.js'
import { mesh_chunk } from '../../src/mesh/mesher.js'

/** @typedef {import('../../src/chunks/format.js').ChunkRecord} ChunkRecord */
/** @typedef {ReturnType<typeof create_terrain_renderer> & { pool_stats: () => Record<string, unknown> & { pending_retries: number } }} TestTerrainRenderer */

/** Generate a 3×3 column stack around (cx,cz) so neighbor halos resolve real (non-air) neighbors, then
 * return a get_record(cx,cy,cz) over the generated set. Mirrors the live streaming mesh path.
 * @param {number} cx0
 * @param {number} cz0
 * @returns {(x: number, y: number, z: number) => ChunkRecord | undefined}
 */
function build_neighborhood(cx0, cz0) {
  /** @type {Map<string, ChunkRecord>} */
  const records = new Map()
  /** @type {(x: number, y: number, z: number) => string} */
  const key = (x, y, z) => `${x},${y},${z}`
  for (let dx = -1; dx <= 1; dx += 1)
    for (let dz = -1; dz <= 1; dz += 1)
      for (let cy = 0; cy < CHUNKS_PER_COLUMN; cy += 1)
        records.set(key(cx0 + dx, cy, cz0 + dz), generate_world_chunk(cx0 + dx, cy, cz0 + dz))
  return (x, y, z) => records.get(key(x, y, z))
}

/** @param {ChunkRecord} chunk */
function solid_count(chunk) {
  let n = 0
  for (let i = 0; i < chunk.ids.length; i += 1) {
    const id = chunk.ids[i]
    if (id !== 0 && get_block_by_id(id)?.class === 'solid') n += 1
  }
  return n
}

// Restore the module's default world after mutating it via set_gen_config (global gen state).
afterAll(() => set_gen_config(DEFAULT_WORLD_GEN_CONFIG))

describe('render-hole regression: water-adjacent solid ground meshes non-empty (suspect A)', () => {
  // Everglades is a fully water world (surface ~122-129 everywhere — a swamp), so its surface columns are
  // the exact "solid ground next to water" case that was reported. For each column we mesh the chunk that
  // actually holds the topmost solid (the block the player stands ON) and assert it renders solid geometry.
  set_gen_config(WORLD_CONFIGS.everglades)

  for (const [cx, cz] of [
    [8, -7],
    [7, -6],
    [9, -8],
  ]) {
    test(`everglades surface column (${cx},${cz}) — the walkable ground chunk meshes non-empty solid`, () => {
      const surface = world_surface_y(cx * CHUNK_SIZE + 16, cz * CHUNK_SIZE + 16)
      const cy = Math.floor((surface - 1) / CHUNK_SIZE) // chunk holding the topmost solid block
      const get_record = build_neighborhood(cx, cz)
      const chunk = /** @type {ChunkRecord} */ (get_record(cx, cy, cz))
      expect(solid_count(chunk)).toBeGreaterThan(0) // this IS ground (collision) — the repro stood on it
      const { quad_buffer, quad_count } = mesh_chunk(chunk, build_neighbor_halos(get_record, cx, cy, cz))
      // The bug's ORIGINAL suspect was an empty mesh for a solid chunk. Prove it never happens: the walkable
      // surface always emits geometry, and its SOLID class in particular is non-empty (what the pool drops).
      expect(quad_count).toBeGreaterThan(0)
      expect(partition_quads(quad_buffer, quad_count).solid.length).toBeGreaterThan(0)
    })
  }
})

// SEAM INVARIANT (the real root's gate). A resident chunk is COLLIDABLE the instant it is stored (ring_manager
// block_id_at reads the store), but only RENDERS once its solid quads fit a pool slot. When solid demand
// exceeds the pool budget (SLOTS_PER_COLUMN.solid ≈ 5.8 @ 2048 quads/slot), pool_renderer.write_chunk drops
// the solid upload — collision WITHOUT a render mesh = this bug. MEASURED per-column solid slots (169-col
// sample around 8,-7): proctrees OFF avg 2.7 / p95 4 (FITS 5.8 — the pre-regression world the pool was sized
// for) vs proctrees ON (GEN_VERSION 8 default) avg 10.0 / p95 15 (1.7× OVER ⇒ ~40% of solid dropped).
// ACTIVATE this gate (remove .todo) once the render lane raises SLOTS_PER_COLUMN.solid to cover the proc-tree
// world (pool_renderer.js:218) — then it deterministically guards against a future demand/pool mismatch.
// [ACTIVATED 2026-07-12] SEAM INVARIANT — the DEFAULT (proc-tree) world's per-column SOLID slot demand must
// fit the pool budget (SLOTS_PER_COLUMN.solid), else pool_renderer.write_chunk drops the upload and a resident
// (collidable) chunk renders no solid mesh = the reported hole (water plane drawing through it). Deterministic
// gate over the SAME dense forest locus (~8,-7) the regression was measured at. A chunk's solid bucket occupies
// ceil(quads / SLOT_QUADS.solid) slots (a big-tree chunk splits a 2nd, never drops — SLOT_QUADS comment); the
// column sum is its slot demand. Fails loudly if the pool is lowered under proc-tree demand OR trees densify.
test('seam invariant: DEFAULT-world p95 slots/col fits the render pool for ALL FIVE classes (proc-trees on)', () => {
  // Pin the DEFAULT proc-tree world explicitly — the everglades describe above mutated the global gen config
  // at collection time, and THIS gate must measure the GEN v9 default (the regression world). afterAll restores.
  // [2026-07-12 design lock] Extended from solid-only to EVERY class: the v8 fix resized solid but the
  // canopy is CUTOUT-class — cutout ran 2.3× its budget on every forest column (the "cutout pool full"
  // storm), and foliage/liquid had the same latent gap. Fins ON (live MEDIUM/HIGH meshing).
  set_gen_config(DEFAULT_WORLD_GEN_CONFIG)
  const R = 3 // inner 7×7 columns measured; a 1-ring halo margin (9×9) is generated so neighbor culling is real
  const CX = 8
  const CZ = -7
  /** @type {Map<string, ChunkRecord>} */
  const store = new Map()
  /** @type {(x: number, y: number, z: number) => string} */
  const rkey = (x, y, z) => `${x},${y},${z}`
  for (let dx = -R - 1; dx <= R + 1; dx += 1)
    for (let dz = -R - 1; dz <= R + 1; dz += 1)
      for (let cy = 0; cy < CHUNKS_PER_COLUMN; cy += 1)
        store.set(rkey(CX + dx, cy, CZ + dz), generate_world_chunk(CX + dx, cy, CZ + dz))
  /** @type {(x: number, y: number, z: number) => ChunkRecord | undefined} */
  const get_record = (x, y, z) => store.get(rkey(x, y, z))

  // [LEAVES-2X Rung 2] `canopy` is the opaque leaf-cube dual-emit shell (its own early-Z pool) — it carries
  // ~3675 q/forest-chunk, so the gate MUST cover it too or the pool-budget snag hides here (exactly the
  // over-budget-cutout class of storm that was hit). SLOTS_PER_COLUMN.canopy=13 was measured; this pins it.
  const CLASSES = /** @type {const} */ (['solid', 'foliage', 'cutout', 'canopy', 'liquid'])
  /** @type {Record<string, number[]>} */
  const slots_per_col = Object.fromEntries(CLASSES.map((c) => [c, []]))
  for (let dx = -R; dx <= R; dx += 1)
    for (let dz = -R; dz <= R; dz += 1) {
      const col = { solid: 0, foliage: 0, cutout: 0, canopy: 0, liquid: 0 }
      for (let cy = 0; cy < CHUNKS_PER_COLUMN; cy += 1) {
        const chunk = /** @type {ChunkRecord} */ (get_record(CX + dx, cy, CZ + dz))
        const { quad_buffer, quad_count } = mesh_chunk(
          chunk,
          build_neighbor_halos(get_record, CX + dx, cy, CZ + dz),
          true // fins ON — the live MEDIUM/HIGH mesh shape (fins add foliage/cutout quads)
        )
        if (quad_count === 0) continue
        const parts = partition_quads(quad_buffer, quad_count)
        for (const cls of CLASSES) {
          const quads = parts[cls].length / 2
          if (quads > 0) col[cls] += Math.ceil(quads / SLOT_QUADS[cls])
        }
      }
      for (const cls of CLASSES) slots_per_col[cls].push(col[cls])
    }
  for (const cls of CLASSES) {
    const sorted = [...slots_per_col[cls]].sort((a, b) => a - b)
    const p95 = sorted[Math.floor(sorted.length * 0.95)]
    // The pool budget MUST cover the p95 per-column demand of EVERY class — else write_chunk drops strand
    // chunks (recoverable now, but a permanently-over-budget class = a real log/retry pressure).
    expect(p95).toBeLessThanOrEqual(SLOTS_PER_COLUMN[cls])
  }
  const solid_avg = slots_per_col.solid.reduce((a, x) => a + x, 0) / slots_per_col.solid.length
  // Sanity: this locus IS the dense proc-tree forest the regression was measured on (guards an empty sample).
  expect(solid_avg).toBeGreaterThan(4)
  // Real 81-column generation + 49-column five-class mesh survey: 74.24s idle / 141.89s train-loaded.
}, 300000)

// ── DROP-PATH FAIL-LOUD + RECOVERY (the deeper robustness root-fix, pool_renderer.js) ────────────────
// The SEAM INVARIANT above keeps the pool sized so exhaustion never happens; THIS suite proves that even IF
// a bucket is dropped (a future world out-densifies the budget), it is NEVER a silent permanent hole: the
// failed upload is re-enqueued and retried the moment a slot frees, and — if it truly never fits — abandoned
// LOUDLY after a bounded number of retries (console.error + a permanent_drops counter), never infinitely.
// Uses a deliberately TINY pool (1 solid slot) via the pool_config override so overflow is one extra chunk.
describe('drop-path fail-loud: write_chunk→false is retried & recovered, never a silent permanent hole', () => {
  /** One grass-top solid quad (face 2, block 3) → routes to the SOLID pool (matches quad_buffer.js wire format). */
  function solid_quad_buffer() {
    const x = 0,
      y = 0,
      z = 0,
      w = 32,
      h = 32,
      face = 2,
      block = 3
    const a =
      ((x & 63) |
        ((y & 63) << 6) |
        ((z & 63) << 12) |
        (((w - 1) & 31) << 18) |
        (((h - 1) & 31) << 23) |
        ((face & 7) << 28)) >>>
      0
    const b = ((block & 0xfff) | (15 << 12) | (0xff << 20)) >>> 0
    return new Uint32Array([a, b])
  }
  /** A 1-slot-per-class pool so a single extra solid chunk overflows the solid pool (write_chunk→false). */
  const TINY_POOL = {
    solid: { slot_quads: 2048, max_slots: 1 },
    foliage: { slot_quads: 8192, max_slots: 1 },
    cutout: { slot_quads: 2048, max_slots: 1 },
    canopy: { slot_quads: 2048, max_slots: 1 }, // [LEAVES-2X Rung 2] the renderer iterates all 5 classes
    liquid: { slot_quads: 512, max_slots: 1 },
  }
  /** @param {(bytes: number) => void} [on_chunk_uploaded] */
  const make = (on_chunk_uploaded) =>
    /** @type {TestTerrainRenderer} */ (
      create_terrain_renderer({
        renderer: null,
        scene: new Scene(),
        camera: null,
        pool_config: TINY_POOL,
        on_chunk_uploaded,
      })
    )

  // Each case builds a real five-class GPU pool + 357-layer atlas. Measured file-solo at 4.0-7.5s/case
  // and with the frontend suite loading the host at 5.3-8.4s/case; the contract is recovery, not latency.

  test('overflow is dropped, re-enqueued (both chunks resident), then RECOVERED on the next frame drain', () => {
    /** @type {number[]} */
    const uploaded_bytes = []
    const terrain = make((bytes) => uploaded_bytes.push(bytes))
    terrain.upload_chunk([0, 0, 0], solid_quad_buffer(), 1) // fills the 1 solid slot
    expect(terrain.get_stats().dropped_uploads).toBe(0)
    expect(uploaded_bytes).toEqual([8])

    terrain.upload_chunk([1, 0, 0], solid_quad_buffer(), 1) // overflow → dropped, NOT silently lost
    let stats = terrain.get_stats()
    expect(stats.dropped_uploads).toBeGreaterThan(0)
    expect(stats.permanent_drops).toBe(0) // retryable — not a permanent hole
    expect(terrain.pool_stats().pending_retries).toBe(1) // stranded bucket is queued for retry
    expect(stats.chunk_count).toBe(2) // BOTH resident (collidable); [1,0,0]'s missing solid mesh is the (recoverable) hole
    expect(stats.draw_calls).toBe(1) // only [0,0,0] renders so far
    expect(uploaded_bytes).toEqual([8]) // a rejected write is not attributed as an upload

    terrain.remove_chunk([0, 0, 0]) // free the slot — the retry is BUDGETED to the frame drain, not this call
    expect(terrain.pool_stats().pending_retries).toBe(1) // still pending (storm control: no per-free flush)
    terrain.update() // the per-frame drain retries and fills the hole
    stats = terrain.get_stats()
    expect(terrain.pool_stats().pending_retries).toBe(0) // recovered
    expect(stats.permanent_drops).toBe(0)
    expect(stats.draw_calls).toBe(1) // the recovered chunk now occupies the freed slot (renders — no hole)
    expect(uploaded_bytes).toEqual([8, 8]) // deferred recovery is attributed where the write succeeds
  }, 30000)

  test('recovery carries remaining writes when its wall-clock slice is spent', () => {
    const pool_config = { ...TINY_POOL, solid: { slot_quads: 2048, max_slots: 3 } }
    /** @type {number[]} */
    const uploaded_bytes = []
    const terrain = /** @type {TestTerrainRenderer} */ (
      create_terrain_renderer({
        renderer: null,
        scene: new Scene(),
        camera: null,
        pool_config,
        retry_time_budget_ms: -1, // deterministically expires after the always-admitted first recovery
        on_chunk_uploaded: (bytes) => uploaded_bytes.push(bytes),
      })
    )
    for (let cx = 0; cx < 3; cx += 1) terrain.upload_chunk([cx, 0, 0], solid_quad_buffer(), 1)
    for (let cx = 3; cx < 6; cx += 1) terrain.upload_chunk([cx, 0, 0], solid_quad_buffer(), 1)
    expect(terrain.pool_stats?.().pending_retries).toBe(3)
    expect(uploaded_bytes).toHaveLength(3)
    for (let cx = 0; cx < 3; cx += 1) terrain.remove_chunk([cx, 0, 0])

    terrain.update()
    expect(terrain.pool_stats?.().pending_retries).toBe(2)
    expect(uploaded_bytes).toHaveLength(4)
    terrain.update()
    expect(terrain.pool_stats?.().pending_retries).toBe(1)
    terrain.update()
    expect(terrain.pool_stats?.().pending_retries).toBe(0)
    expect(uploaded_bytes).toHaveLength(6)
    terrain.dispose()
  }, 30000)

  test('a fresh successful re-upload of the same key supersedes its pending retry', () => {
    const terrain = make()
    terrain.upload_chunk([0, 0, 0], solid_quad_buffer(), 1)
    terrain.upload_chunk([1, 0, 0], solid_quad_buffer(), 1) // dropped → pending
    expect(terrain.pool_stats().pending_retries).toBe(1)
    terrain.remove_chunk([0, 0, 0]) // free the slot
    terrain.upload_chunk([1, 0, 0], solid_quad_buffer(), 1) // fresh upload succeeds → supersedes the pending retry
    expect(terrain.pool_stats().pending_retries).toBe(0)
    expect(terrain.get_stats().permanent_drops).toBe(0)
  }, 30000)

  test('removing a stranded (never-rendered) key clears its pending retry — no ghost recovery', () => {
    const terrain = make()
    terrain.upload_chunk([0, 0, 0], solid_quad_buffer(), 1)
    terrain.upload_chunk([1, 0, 0], solid_quad_buffer(), 1) // stranded → pending
    expect(terrain.pool_stats().pending_retries).toBe(1)
    terrain.remove_chunk([1, 0, 0]) // the ring evicts the stranded chunk before a slot ever freed
    // its slot for [0,0,0] frees nothing for [1,0,0], and [1,0,0] must NOT resurrect from a stale pending entry
    expect(terrain.pool_stats().pending_retries).toBe(0)
    expect(terrain.get_stats().chunk_count).toBe(1) // only [0,0,0] remains
  }, 30000)

  test('STORM CONTROL: permanent over-demand logs once per class + one undersized verdict, never thrashes', () => {
    // [2026-07-12 design lock] The first retry design logged per chunk per strand and flushed on every
    // slot-free, freezing the game when a pool was PERMANENTLY over demand. The contract now: one strand
    // error per CLASS, budgeted once-per-frame drains, NO retry cap (the bucket outwaits the pressure —
    // leaving the dense area recovers it), and ONE loud UNDERSIZED verdict after sustained zero recovery.
    /** @type {string[]} */
    const errors = []
    const orig_error = console.error
    console.error = (/** @type {any[]} */ ...a) => errors.push(a.join(' '))
    try {
      const terrain = make()
      terrain.upload_chunk([0, 0, 0], solid_quad_buffer(), 1) // permanently holds the only slot
      terrain.upload_chunk([1, 0, 0], solid_quad_buffer(), 1) // stranded (slot never frees)
      terrain.upload_chunk([3, 0, 0], solid_quad_buffer(), 1) // second stranded chunk, SAME class
      expect(errors.filter((e) => /solid pool full/.test(e)).length).toBe(1) // deduped: once per class, not per chunk

      // Sustained pressure: churn a filler for >UNDERSIZED_AFTER_FLUSHES (120) frames; [1,0,0]/[3,0,0]
      // stay pending the whole time (write always fails), with zero spam and zero permanent drops.
      for (let i = 0; i < 130; i += 1) {
        terrain.upload_chunk([2, 0, 0], solid_quad_buffer(), 1) // fails → pending (same class, no new log)
        terrain.remove_chunk([2, 0, 0]) // frees nothing for solid (it never got a slot) but latches a drain
        terrain.update() // the budgeted per-frame drain
      }
      const stats = terrain.get_stats()
      expect(stats.permanent_drops).toBe(0) // NO thrash-drop: stranded ≠ abandoned
      expect(terrain.pool_stats().pending_retries).toBe(2) // both stranded buckets still waiting (recoverable)
      expect(errors.filter((e) => /solid pool full/.test(e)).length).toBe(1) // still exactly one strand log
      const undersized = errors.filter((e) => /UNDERSIZED/.test(e))
      expect(undersized.length).toBe(1) // the one-shot degrade verdict
      expect(undersized[0]).toMatch(/SLOTS_PER_COLUMN\.solid/)

      // Pressure lifts: the hole recovers — no permanent loss ever happened.
      terrain.remove_chunk([0, 0, 0])
      terrain.update()
      expect(terrain.pool_stats().pending_retries).toBe(1) // one bucket recovered into the freed slot
      expect(terrain.get_stats().permanent_drops).toBe(0)
    } finally {
      console.error = orig_error
    }
  }, 30000)
})
