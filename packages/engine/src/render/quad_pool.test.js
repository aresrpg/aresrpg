// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Unit tests for the NG-MEGA quad pool (src/render/quad_pool.js) — the slot allocator, firstInstance
// addressing, multi-slot split, partial-upload ranges, and occupancy stats. All CPU-side (no GPU): the
// pool builds typed-array attributes + a geometry; the WebGPURenderer only materializes GPU buffers on
// render, which these tests never do. The invariants pinned here are exactly what the vertex stage
// relies on (firstInstance = slot·S, instanceIndex = firstInstance+local ⇒ global quad index).

import { test, expect, describe } from 'bun:test'

import { create_quad_pool } from './quad_pool.js'

const STRIDE = 4 // indirect args per slot: [vertexCount, instanceCount, firstVertex, firstInstance]

/** @typedef {ReturnType<typeof create_quad_pool>} QuadPool */

/** Reads slot k's indirect args out of the attribute array. @param {QuadPool} pool @param {number} k */
function args(pool, k) {
  const a = /** @type {Uint32Array} */ (pool.indirect_attr.array)
  return {
    vertex_count: a[k * STRIDE],
    instance_count: a[k * STRIDE + 1],
    first_vertex: a[k * STRIDE + 2],
    first_instance: a[k * STRIDE + 3],
  }
}

/** Reads slot k's meta [ox, oy, oz, count]. @param {QuadPool} pool @param {number} k */
function meta(pool, k) {
  const m = /** @type {Float32Array} */ (pool.meta_attr.array)
  return [m[k * 4], m[k * 4 + 1], m[k * 4 + 2], m[k * 4 + 3]]
}

/** Builds a quad buffer of `n` distinct quads (word_a = i+1, word_b = i+1000) so we can assert exact
 *  placement in the pool. @param {number} n */
function quads(n) {
  const buf = new Uint32Array(n * 2)
  for (let i = 0; i < n; i += 1) {
    buf[i * 2] = i + 1
    buf[i * 2 + 1] = i + 1000
  }
  return buf
}

describe('quad_pool construction', () => {
  test('pre-stamps every slot with static indirect fields (firstInstance = slot·S)', () => {
    const S = 4
    const pool = create_quad_pool({ slot_quads: S, max_slots: 8 })
    expect(pool.pool_attr.array.length).toBe(8 * S * 2)
    expect(pool.meta_attr.array.length).toBe(8 * 4)
    expect(pool.indirect_attr.array.length).toBe(8 * STRIDE)
    for (let k = 0; k < 8; k += 1) {
      expect(args(pool, k)).toEqual({ vertex_count: 6, instance_count: 0, first_vertex: 0, first_instance: k * S })
    }
    // empty pool ⇒ empty indirect draw list
    expect(pool.geometry.indirectOffset).toEqual([])
  })

  test('rejects a non-power-of-two slot size', () => {
    expect(() => create_quad_pool({ slot_quads: 3, max_slots: 4 })).toThrow(/power of two/)
  })
})

describe('write_chunk — single slot', () => {
  test('places quads at slot base, sets meta origin + count, sets indirect instanceCount', () => {
    const S = 8
    const pool = create_quad_pool({ slot_quads: S, max_slots: 4 })
    const ok = pool.write_chunk('a', quads(5), 5, [32, 64, 96])
    expect(ok).toBe(true)
    // First free slot handed out is 0 (free-list pops low indices first).
    expect(meta(pool, 0)).toEqual([32, 64, 96, 5])
    expect(args(pool, 0)).toEqual({ vertex_count: 6, instance_count: 5, first_vertex: 0, first_instance: 0 })
    // Quad data landed at pool[0..10) (slot 0 base = 0), first quad word_a=1, word_b=1000.
    expect(pool.pool_attr.array[0]).toBe(1)
    expect(pool.pool_attr.array[1]).toBe(1000)
    expect(pool.pool_attr.array[8]).toBe(5) // 5th quad word_a
    // Only slot 0's u32 range was flagged for GPU upload (partial write, not the whole 64-quad pool).
    expect(pool.pool_attr.updateRanges).toEqual([{ start: 0, count: 10 }])
    // Draw list has exactly slot 0 (byte offset 0).
    expect(pool.geometry.indirectOffset).toEqual([0])
    expect(pool.stats()).toEqual({ slots: 1, quads: 5, capacity_quads: 32, utilization: 5 / 8 })
  })

  test('second chunk lands in slot 1 at global base S with firstInstance = S', () => {
    const S = 8
    const pool = create_quad_pool({ slot_quads: S, max_slots: 4 })
    pool.write_chunk('a', quads(3), 3, [0, 0, 0])
    pool.write_chunk('b', quads(4), 4, [32, 0, 0])
    expect(args(pool, 1).first_instance).toBe(S) // slot 1 → firstInstance 8
    expect(args(pool, 1).instance_count).toBe(4)
    // slot 1's quads start at pool index slot·S·2 = 16.
    expect(pool.pool_attr.array[16]).toBe(1)
    expect(pool.geometry.indirectOffset).toEqual([0, 1 * STRIDE * 4]) // byte offsets 0, 16
    expect(pool.stats().slots).toBe(2)
  })
})

describe('write_chunk — multi-slot (count > S)', () => {
  test('splits into ⌈count/S⌉ independent slots, each with its own firstInstance + sub-range', () => {
    const S = 4
    const pool = create_quad_pool({ slot_quads: S, max_slots: 8 })
    // 10 quads with S=4 ⇒ 3 slots: [4, 4, 2].
    const ok = pool.write_chunk('big', quads(10), 10, [64, 0, 128])
    expect(ok).toBe(true)
    expect(args(pool, 0).instance_count).toBe(4)
    expect(args(pool, 1).instance_count).toBe(4)
    expect(args(pool, 2).instance_count).toBe(2)
    // All three slots carry the SAME chunk origin (the VS recovers it from any global quad index).
    expect(meta(pool, 0)).toEqual([64, 0, 128, 4])
    expect(meta(pool, 1)).toEqual([64, 0, 128, 4])
    expect(meta(pool, 2)).toEqual([64, 0, 128, 2])
    // firstInstance = slot·S ⇒ 0, 4, 8: the three ranges tile [0,10) of the chunk's quads.
    expect(args(pool, 0).first_instance).toBe(0)
    expect(args(pool, 1).first_instance).toBe(4)
    expect(args(pool, 2).first_instance).toBe(8)
    // Slot 1 holds the chunk's quads [4,8): first is word_a = 5, at pool index 1·S·2 = 8.
    expect(pool.pool_attr.array[8]).toBe(5)
    // Slot 2 holds quads [8,10): first is word_a = 9, at pool index 2·S·2 = 16.
    expect(pool.pool_attr.array[16]).toBe(9)
    expect(pool.stats()).toEqual({ slots: 3, quads: 10, capacity_quads: 32, utilization: 10 / 12 })
  })
})

describe('remove_chunk', () => {
  test('zeroes instanceCount + meta and returns slots to the free list for reuse', () => {
    const S = 8
    const pool = create_quad_pool({ slot_quads: S, max_slots: 4 })
    pool.write_chunk('a', quads(3), 3, [0, 0, 0]) // slot 0
    pool.write_chunk('b', quads(4), 4, [32, 0, 0]) // slot 1
    pool.remove_chunk('a')
    expect(args(pool, 0).instance_count).toBe(0) // slot 0 no longer drawn
    expect(meta(pool, 0)[3]).toBe(0) // marked free for the cull
    expect(pool.geometry.indirectOffset).toEqual([1 * STRIDE * 4]) // only slot 1 remains
    expect(pool.stats()).toEqual({ slots: 1, quads: 4, capacity_quads: 32, utilization: 4 / 8 })
    // The freed slot 0 is reused by the next chunk.
    pool.write_chunk('c', quads(2), 2, [64, 0, 0])
    expect(meta(pool, 0)).toEqual([64, 0, 0, 2])
    expect(args(pool, 0).instance_count).toBe(2)
  })

  test('remove of an unknown key is a no-op', () => {
    const pool = create_quad_pool({ slot_quads: 4, max_slots: 4 })
    expect(() => pool.remove_chunk('nope')).not.toThrow()
  })
})

describe('replace + capacity', () => {
  test('re-writing a resident key replaces it in place (frees old slots first)', () => {
    const S = 4
    const pool = create_quad_pool({ slot_quads: S, max_slots: 4 })
    pool.write_chunk('a', quads(2), 2, [0, 0, 0])
    pool.write_chunk('a', quads(6), 6, [32, 32, 32]) // now 2 slots
    expect(pool.stats().slots).toBe(2)
    expect(meta(pool, 0)[3]).toBe(4)
    expect(meta(pool, 1)[3]).toBe(2)
    expect(meta(pool, 0).slice(0, 3)).toEqual([32, 32, 32])
  })

  test('returns false when the pool cannot fit the chunk (no crash, caller skips)', () => {
    const S = 4
    const pool = create_quad_pool({ slot_quads: S, max_slots: 2 })
    expect(pool.write_chunk('a', quads(3), 3, [0, 0, 0])).toBe(true) // 1 slot
    expect(pool.write_chunk('big', quads(9), 9, [0, 0, 0])).toBe(false) // needs 3 slots, only 1 free
    // The failed write left the pool consistent (still just chunk 'a').
    expect(pool.stats().slots).toBe(1)
  })

  test('empty / zero-quad chunk writes nothing but succeeds', () => {
    const pool = create_quad_pool({ slot_quads: 4, max_slots: 4 })
    expect(pool.write_chunk('empty', new Uint32Array(0), 0, [0, 0, 0])).toBe(true)
    expect(pool.stats().slots).toBe(0)
  })
})
