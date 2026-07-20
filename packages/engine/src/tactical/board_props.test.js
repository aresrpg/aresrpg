// [D252] obstacle prop archetypes — determinism + geometry invariants (three core runs under bun).
//
// Locks: the archetype/rotation picks are pure over the cell hash (a same-args rebuild reproduces the
// prop), each archetype emits real non-empty voxel geometry with finite attributes + valid indices,
// the three archetypes are distinct, and every prop stays INSIDE its cell (D167 — no spill onto
// neighbours). These are the guarantees board.js relies on when it merges props into board_obstacle.

import { test, expect, describe } from 'bun:test'
import { Color } from 'three'

import { ARCHETYPES, emit_prop, make_prop_arrays, pick_archetype, pick_rotation, NOMINAL_CELL } from './board_props.js'

const TINT = new Color(0x484450)

/** Emit one prop and return its arrays. @param {number} arch @param {number} rot */
function one(arch, rot, { wx = 100, wz = 200, base = 40, cell = NOMINAL_CELL } = {}) {
  const a = make_prop_arrays()
  emit_prop(a, arch, rot, wx, wz, base, cell, TINT)
  return a
}

describe('pick_archetype — deterministic three-way split', () => {
  test('maps [0,1) hash to 0|1|2 and is stable', () => {
    expect(pick_archetype(0)).toBe(0)
    expect(pick_archetype(0.33)).toBe(0)
    expect(pick_archetype(0.34)).toBe(1)
    expect(pick_archetype(0.67)).toBe(2)
    expect(pick_archetype(0.999)).toBe(2)
    expect(pick_archetype(0.5)).toBe(pick_archetype(0.5)) // pure
  })
})

describe('pick_rotation — deterministic 0..3', () => {
  test('always in range and pure', () => {
    for (const h of [0, 0.1, 0.37, 0.5, 0.73, 0.99]) {
      const r = pick_rotation(h)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(3)
      expect(Number.isInteger(r)).toBe(true)
      expect(pick_rotation(h)).toBe(r) // pure
    }
  })
})

describe('emit_prop — real, finite, in-cell voxel geometry', () => {
  test('each archetype emits non-empty geometry with finite attrs + valid indices', () => {
    for (let arch = 0; arch < ARCHETYPES.length; arch += 1) {
      const a = one(arch, 0)
      expect(a.positions.length).toBeGreaterThan(0)
      expect(a.positions.length).toBe(a.normals.length)
      expect(a.positions.length).toBe(a.colors.length)
      expect(a.positions.every(Number.isFinite)).toBe(true)
      expect(a.normals.every(Number.isFinite)).toBe(true)
      // colours are valid channel values in [0,1]
      expect(a.colors.every((v) => v >= 0 && v <= 1)).toBe(true)
      // every index points at a real vertex
      const vcount = a.positions.length / 3
      expect(a.indices.length % 3).toBe(0)
      expect(Math.max(...a.indices)).toBeLessThan(vcount)
      // 6 faces/box × 2 tris × 3 = 36 indices per voxel
      expect(a.indices.length).toBe(ARCHETYPES[arch].length * 36)
    }
  })

  test('the three archetypes are distinct (different voxel counts / silhouettes)', () => {
    const counts = ARCHETYPES.map((_, i) => one(i, 0).positions.length)
    expect(new Set(counts).size).toBeGreaterThan(1) // not all identical
  })

  test('a prop stays INSIDE its cell footprint (D167 — no spill onto neighbours)', () => {
    const wx = 100,
      wz = 200,
      cell = NOMINAL_CELL
    const bound = 0.6 * cell // authored footprints keep within ±0.58; give a hair of slack
    for (let arch = 0; arch < ARCHETYPES.length; arch += 1)
      for (let rot = 0; rot < 4; rot += 1) {
        const a = one(arch, rot, { wx, wz, cell })
        for (let v = 0; v < a.positions.length; v += 3) {
          expect(Math.abs(a.positions[v] - wx)).toBeLessThanOrEqual(bound)
          expect(Math.abs(a.positions[v + 2] - wz)).toBeLessThanOrEqual(bound)
        }
      }
  })

  test('rotation changes the geometry but not the vertex count (same prop, turned)', () => {
    const r0 = one(1, 0)
    const r1 = one(1, 1)
    expect(r1.positions.length).toBe(r0.positions.length)
    // at least some vertex moved (a 90° turn is not the identity for an asymmetric prop)
    const moved = r0.positions.some((p, i) => Math.abs(p - r1.positions[i]) > 1e-6)
    expect(moved).toBe(true)
  })

  test('props rest ON the base plane (lowest vertex ≈ base_y, never below)', () => {
    const base = 40
    for (let arch = 0; arch < ARCHETYPES.length; arch += 1) {
      const a = one(arch, 0, { base })
      let min_y = Infinity
      for (let v = 1; v < a.positions.length; v += 3) min_y = Math.min(min_y, a.positions[v])
      expect(min_y).toBeGreaterThanOrEqual(base - 1e-6)
      expect(min_y).toBeLessThan(base + 0.05) // some voxel starts at the base
    }
  })
})
