// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #12 — STUCK-IN-BLOCK AUTO-EJECT (the engine-side collision resolution). On spawn and on ANY position
// adoption (sync / rollback / teleport), a capsule buried in solid voxels must be ejected to the nearest air
// column — never left with the camera inside geometry. character_controller wires this into both its spawn
// scan and teleport() (opts.eject default on), but the controller suite skips headless (its module statically
// imports the absent-by-design senshi_male.glb). eject_from_solid is PURE math — no asset, no GPU — so its
// contract is pinned DIRECTLY here, giving #12 real headless coverage where the facade tests cannot run.

import { describe, expect, test } from 'bun:test'

import { CHARACTER_COLLIDER_HEIGHT, CHARACTER_RADIUS } from '../config/world_config.js'

import { box_overlaps_solid, eject_from_solid } from './collision.js'

const R = CHARACTER_RADIUS
const H = CHARACTER_COLLIDER_HEIGHT
const buried = (solid, [x, y, z]) => box_overlaps_solid(solid, x, y, z, R, H)

// A 5-deep solid slab (grass): solid at y < 5, air above. A feet-y < 5 buries the ~1.9-tall capsule.
const slab = (_x, y, _z) => y < 5
// A full-height wall on x < 1: the same column is solid at every height, so the un-bury must go lateral.
const wall = (x, _y, _z) => x < 1

describe('#12 stuck-in-block auto-eject — eject_from_solid to the nearest air column', () => {
  test('a CLEAR position is returned untouched (the overwhelmingly common non-buried adoption)', () => {
    const p = [0.5, 8, 0.5]
    expect(buried(slab, p)).toBe(false)
    expect(eject_from_solid(slab, p)).toBe(p) // same reference — one overlap test, no work
  })

  test('a BURIED capsule ejects UP the same column to the first air (feet on the slab top)', () => {
    const buried_pos = [0.5, 2, 0.5] // capsule spans y∈[2, 3.9], fully inside the slab
    expect(buried(slab, buried_pos)).toBe(true)
    const out = eject_from_solid(slab, buried_pos)
    expect(out[1]).toBeCloseTo(5, 5) // lifted to the slab top face (feet y=5, capsule 5..6.9 clear)
    expect(out[0]).toBeCloseTo(0.5, 5) // nearest AIR COLUMN = the same column, searched up first
    expect(out[2]).toBeCloseTo(0.5, 5)
    expect(buried(slab, out)).toBe(false) // and it is genuinely clear
  })

  test('when the whole column is solid, it ejects LATERALLY to a clear column', () => {
    const buried_pos = [0.5, 8, 0.5] // inside the full-height wall (x < 1)
    expect(buried(wall, buried_pos)).toBe(true)
    const out = eject_from_solid(wall, buried_pos)
    expect(buried(wall, out)).toBe(false) // landed in air
    expect(out[0]).not.toBeCloseTo(0.5, 5) // moved out of the column (no clear cell straight up)
  })
})
