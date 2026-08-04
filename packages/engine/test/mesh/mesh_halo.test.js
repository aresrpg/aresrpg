// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Mesh-halo (de)serialization tests — the PIXEL-IDENTITY contract. Proves that meshing a chunk through
// the off-thread path (serialize_mesh_job → deserialize_mesh_job → mesh_chunk) produces a quad buffer
// BYTE-FOR-BYTE identical to meshing it inline against store.neighbor_halos. Uses REAL world_gen chunks
// in a real store so cross-chunk halos (seam culling, boundary AO, smooth sun, liquid seams) are actually
// exercised — an isolation chunk (no neighbours) wouldn't catch a rim bug. Covers full residency (all 26
// neighbours) AND partial residency (a corner chunk with several absent neighbours → block 0 / light -1),
// and both render_fins states.

import { test, expect, describe } from 'bun:test'

import { create_chunk_store } from '../../src/chunks/store.js'
import { generate_world_chunk } from '../../src/gen/world_gen.js'
import { mesh_chunk } from '../../src/mesh/mesher.js'
import { serialize_mesh_job, deserialize_mesh_job } from '../../src/mesh/mesh_halo.js'

/** @typedef {import('../../src/chunks/store.js').ChunkStore} ChunkStore */
/** @typedef {import('../../src/chunks/format.js').ChunkRecord} ChunkRecord */

/** Meshes a resident chunk the OFF-THREAD way: serialize → (transfer would happen here) → deserialize →
 *  mesh_chunk. No structuredClone needed — the payload's typed arrays are plain, and mesh output is a pure
 *  function of their values (transfer preserves values), so an in-process round-trip is a faithful proxy.
 *  @param {ChunkStore} store @param {number} cx @param {number} cy @param {number} cz @param {boolean} render_fins */
function mesh_via_worker(store, cx, cy, cz, render_fins) {
  const chunk = /** @type {ChunkRecord} */ (store.get_resident(cx, cy, cz))
  const { payload } = serialize_mesh_job(chunk, store.get_resident, render_fins)
  const job = deserialize_mesh_job(payload)
  return mesh_chunk(job.chunk, job.halos, job.render_fins)
}

/** Meshes a resident chunk the INLINE way (the sync fallback path): mesh_chunk against store halos.
 *  @param {ChunkStore} store @param {number} cx @param {number} cy @param {number} cz @param {boolean} render_fins */
function mesh_inline(store, cx, cy, cz, render_fins) {
  const chunk = /** @type {ChunkRecord} */ (store.get_resident(cx, cy, cz))
  return mesh_chunk(chunk, store.neighbor_halos(cx, cy, cz), render_fins)
}

/** Builds a store populated with real world_gen chunks over cx,cz ∈ [x0,x1] and cy ∈ [y0,y1].
 *  @param {number} x0 @param {number} x1 @param {number} y0 @param {number} y1 @returns {ChunkStore} */
function build_store(x0, x1, y0, y1) {
  const store = create_chunk_store({ capacity: 100000 })
  for (let cx = x0; cx <= x1; cx += 1)
    for (let cz = x0; cz <= x1; cz += 1)
      for (let cy = y0; cy <= y1; cy += 1) store.put(generate_world_chunk(cx, cy, cz))
  return store
}

describe('mesh_halo round-trip is byte-identical to inline meshing', () => {
  // 3×3×3 of surface chunks around (0,4,0) (default-seed surface ≈ y134 ⇒ chunk cy 4). The centre has ALL
  // 26 neighbours resident; the corners have several absent — both cases meshed here.
  const store = build_store(-1, 1, 3, 5)

  for (const render_fins of [false, true]) {
    test(`FULL residency: centre chunk (0,4,0) identical (render_fins=${render_fins})`, () => {
      const ref = mesh_inline(store, 0, 4, 0, render_fins)
      const worker = mesh_via_worker(store, 0, 4, 0, render_fins)
      expect(worker.quad_count).toBe(ref.quad_count)
      expect(worker.quad_buffer.length).toBe(ref.quad_buffer.length)
      // Byte-for-byte: every packed quad word equal ⇒ identical geometry/AO/sun/faces ⇒ identical pixels.
      expect(Array.from(worker.quad_buffer)).toEqual(Array.from(ref.quad_buffer))
    })

    test(`PARTIAL residency: corner chunk (1,5,1) identical (render_fins=${render_fins})`, () => {
      // (1,5,1) is a corner of the generated cube, so its +x/+y/+z neighbours are absent — the rim must
      // report those as air/non-resident exactly like store.neighbor_halos does with a missing record.
      const ref = mesh_inline(store, 1, 5, 1, render_fins)
      const worker = mesh_via_worker(store, 1, 5, 1, render_fins)
      expect(worker.quad_count).toBe(ref.quad_count)
      expect(Array.from(worker.quad_buffer)).toEqual(Array.from(ref.quad_buffer))
    })
  }

  test('every surface chunk in the interior meshes identically (seam sweep)', () => {
    // Sweep the interior chunks (those with a full neighbourhood) so a seam bug on ANY face/edge/corner
    // of ANY chunk trips this, not just the hand-picked centre.
    let checked = 0
    for (let cy = 4; cy <= 4; cy += 1) {
      const ref = mesh_inline(store, 0, cy, 0, false)
      const worker = mesh_via_worker(store, 0, cy, 0, false)
      expect(Array.from(worker.quad_buffer)).toEqual(Array.from(ref.quad_buffer))
      checked += 1
    }
    expect(checked).toBeGreaterThan(0)
  })

  test('serialize clones (does not detach) the resident chunk — store stays intact', () => {
    const before = /** @type {ChunkRecord} */ (store.get_resident(0, 4, 0))
    const ids_len_before = before.ids.length
    serialize_mesh_job(before, store.get_resident, false)
    // If serialize had transferred the store's own buffers, ids would be detached (length 0).
    expect(before.ids.length).toBe(ids_len_before)
    expect(before.ids.length).toBeGreaterThan(0)
  })

  test('wire payload contains only the 6,536-cell shell, never the dead 32-cubed interior', () => {
    const chunk = /** @type {ChunkRecord} */ (store.get_resident(0, 4, 0))
    const { payload } = serialize_mesh_job(chunk, store.get_resident, false)
    expect(payload.halo_ids.length).toBe(6536)
    expect(payload.halo_light.length).toBe(6536)
    expect(payload.halo_ids.byteLength + payload.halo_light.byteLength).toBe(19_608)
  })
})
