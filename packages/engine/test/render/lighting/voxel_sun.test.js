// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENG-10 voxel_sun pure-helper tests (GPU-free): the occupancy build + world→cell mapping that feed
// the DDA sun-visibility march. Locks the solidity rule (leaves/solids occlude; air/liquid do not),
// the 2×2×2 voxel→cell stamping, and the out-of-volume bounds guard.
import { describe, expect, test } from 'bun:test'

import { create_chunk_record, local_index } from '../../../src/chunks/format.js'
import { get_block_by_name } from '../../../src/config/block_registry.js'
import { CHUNK_SIZE } from '../../../src/config/world_config.js'
import { build_occupancy, is_solid_occluder, world_to_cell, CELL_M } from '../../../src/render/lighting/voxel_sun.js'

const STONE = /** @type {number} */ (get_block_by_name('stone')?.id)
const WATER = /** @type {number} */ (get_block_by_name('water')?.id)
const LEAVES = /** @type {number} */ (get_block_by_name('leaves')?.id)

describe('is_solid_occluder', () => {
  test('solids (stone, LEAVES) occlude; air/liquid do not', () => {
    expect(is_solid_occluder(STONE)).toBe(true)
    expect(is_solid_occluder(LEAVES)).toBe(true) // canopy MUST occlude — the whole point of shafts
    expect(is_solid_occluder(WATER)).toBe(false)
    expect(is_solid_occluder(0)).toBe(false) // air
  })
})

describe('world_to_cell', () => {
  test('floors world→cell against the snapped origin at cell_m', () => {
    expect(world_to_cell(0, 0, 0, [0, 0, 0], 2)).toEqual([0, 0, 0])
    expect(world_to_cell(3, 5, 1, [0, 0, 0], 2)).toEqual([1, 2, 0]) // 3/2→1, 5/2→2, 1/2→0
    expect(world_to_cell(-1, -1, -1, [0, 0, 0], 2)).toEqual([-1, -1, -1]) // negative floors down
    expect(world_to_cell(10, 10, 10, [8, 8, 8], 2)).toEqual([1, 1, 1]) // origin offset
  })
})

describe('build_occupancy', () => {
  const dims = /** @type {[number,number,number]} */ ([16, 16, 16]) // 32 m cube of 2 m cells
  const origin = /** @type {[number,number,number]} */ ([0, 0, 0]) // chunk (0,0,0) fills the volume exactly
  const idx = (/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ cz) =>
    (cy * dims[2] + cz) * dims[0] + cx // must match voxel_sun's (cy*dz+cz)*dx+cx layout

  test('a solid voxel stamps exactly its covering 2 m cell; air leaves it empty', () => {
    const chunk = create_chunk_record(0, 0, 0)
    chunk.ids[local_index(4, 6, 8)] = STONE // world (4,6,8) → cell (2,3,4)
    const occ = build_occupancy([chunk], origin, dims, CELL_M, is_solid_occluder)
    expect(occ[idx(2, 3, 4)]).toBe(255)
    // a neighbouring cell with no solid voxel stays empty
    expect(occ[idx(0, 0, 0)]).toBe(0)
    expect(occ.reduce((a, b) => a + (b > 0 ? 1 : 0), 0)).toBe(1) // exactly one cell set
  })

  test('liquid + foliage voxels never occlude (only class solid)', () => {
    const chunk = create_chunk_record(0, 0, 0)
    chunk.ids[local_index(0, 0, 0)] = WATER
    const occ = build_occupancy([chunk], origin, dims, CELL_M, is_solid_occluder)
    expect(occ.every((v) => v === 0)).toBe(true)
  })

  test('any solid in a 2×2×2 block marks the whole cell (OR reduction)', () => {
    const chunk = create_chunk_record(0, 0, 0)
    // cell (0,0,0) covers voxels x,y,z ∈ {0,1}. Set just the far corner (1,1,1).
    chunk.ids[local_index(1, 1, 1)] = STONE
    const occ = build_occupancy([chunk], origin, dims, CELL_M, is_solid_occluder)
    expect(occ[idx(0, 0, 0)]).toBe(255)
  })

  test('voxels outside the volume are bounds-guarded (no OOB write)', () => {
    // A chunk far from the origin: none of its voxels fall in the [0,32)³ volume → all empty, no throw.
    const far = create_chunk_record(10, 10, 10) // world base (320,320,320)
    far.ids[local_index(0, 0, 0)] = STONE
    const occ = build_occupancy([far], origin, dims, CELL_M, is_solid_occluder)
    expect(occ.every((v) => v === 0)).toBe(true)
    expect(occ.length).toBe(dims[0] * dims[1] * dims[2])
  })
})
