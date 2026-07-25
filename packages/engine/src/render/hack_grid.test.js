// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// HACK MODE (docs/design/hack_mode_spec.md §1.3 + §2) — the flat presentation oracle + its scene mount.
// The oracle is the DEEP seam: in hack mode engine.sample_block / sample_block_analytic /
// is_column_resident answer THIS instead of the streamed voxel world, so every consumer (controller,
// physics gate, boot veil, entity grounding, board seating, rescue nets) inherits one constant plane.
// These tests pin the constants the QA contract (§3) is written against.
import { test, expect } from 'bun:test'
import { Scene } from 'three'

import { set_gen_config, world_surface_y } from '../gen/world_gen.js'
import { DEFAULT_WORLD_GEN_CONFIG } from '../config/world_gen_config.js'
import { WORLD_HEIGHT } from '../config/world_config.js'

import { HACK_GROUND_Y, create_hack_oracle, create_hack_presentation } from './hack_grid.js'

/** The scene's mounted meshes, narrowed to the fields these tests read. @param {Scene} scene */
const mounted = (scene) =>
  /** @type {{ position: { x: number, y: number, z: number }, material: { fog: boolean } }[]} */ (
    /** @type {unknown} */ (scene.children)
  )

/** Columns spread across the fence — the oracle must answer identically at every one of them. */
const COLUMNS = /** @type {[number, number][]} */ ([
  [0, 0],
  [1, 1],
  [-733, 412],
  [12_004, -8_119],
])

test('HACK_GROUND_Y is the feet plane (spec §1.3) — WORLD_SPAWN y', () => {
  expect(HACK_GROUND_Y).toBe(138)
})

test('sample_block is a constant plane: solid below HACK_GROUND_Y, air above, air outside the world box', () => {
  const p = create_hack_oracle()
  for (const [x, z] of COLUMNS) {
    expect(p.sample_block(x, 0, z)).toBeGreaterThan(0)
    expect(p.sample_block(x, 137, z)).toBeGreaterThan(0)
    expect(p.sample_block(x, 137.9, z)).toBeGreaterThan(0) // floor(y) decides
    expect(p.sample_block(x, HACK_GROUND_Y, z)).toBe(0)
    expect(p.sample_block(x, 200, z)).toBe(0)
    expect(p.sample_block(x, -1, z)).toBe(0)
    expect(p.sample_block(x, WORLD_HEIGHT, z)).toBe(0)
  }
})

test('is_column_resident is always true — no streaming wait can exist (QA contract §3.3)', () => {
  const p = create_hack_oracle()
  for (const [x, z] of COLUMNS) expect(p.is_column_resident(x, z)).toBe(true)
})

test('the mounted presentation answers the SAME oracle (one home — the engine arms it before the mount)', () => {
  const scene = new Scene()
  const mounted_p = create_hack_presentation({ scene })
  const bare = create_hack_oracle()
  expect(mounted_p.sample_block(4, 137, -9)).toBe(bare.sample_block(4, 137, -9))
  expect(mounted_p.is_column_resident(4, -9)).toBe(bare.is_column_resident(4, -9))
  expect(mounted_p.ground_at(4, -9)).toBe(bare.ground_at(4, -9))
  mounted_p.dispose()
})

test('ground_at is flat where the voxel world is not (the swap this lane exists for)', () => {
  set_gen_config(DEFAULT_WORLD_GEN_CONFIG)
  // the terrain oracle these three api methods answer with today: a DIFFERENT height per column.
  const terrain = COLUMNS.map(([x, z]) => world_surface_y(x, z))
  expect(new Set(terrain).size).toBeGreaterThan(1)
  // the hack oracle: ONE height, everywhere — the top solid block (feet rest at HACK_GROUND_Y).
  const p = create_hack_oracle()
  const hack = COLUMNS.map(([x, z]) => p.ground_at(x, z))
  expect(new Set(hack)).toEqual(new Set([HACK_GROUND_Y - 1]))
})

test('mounts exactly one unlit fog-immune mesh on the plane, and dispose leaves the scene empty', () => {
  const scene = new Scene()
  const p = create_hack_presentation({ scene })
  expect(scene.children.length).toBe(1)
  const [mesh] = mounted(scene)
  expect(mesh.position.y).toBe(HACK_GROUND_Y)
  // §1.4: hack materials opt OUT of the shared scene fog (a hack-owned fog_scale would be clobbered
  // by every dungeon exit) and never take part in lighting (house law: overlays are unlit).
  const { material } = mesh
  expect(material.fog).toBe(false)
  expect(p.sky_node).toBeTruthy()
  p.dispose()
  expect(scene.children.length).toBe(0)
})

test('tick re-centres the plane on the camera, snapped to the major lattice (lines never swim)', () => {
  const scene = new Scene()
  const p = create_hack_presentation({ scene })
  const [mesh] = mounted(scene)
  for (const [x, z] of /** @type {[number, number][]} */ ([
    [0, 0],
    [101.3, -57.9],
    [-4_321.5, 998.25],
  ])) {
    p.tick(0.016, { x, z })
    expect(mesh.position.y).toBe(HACK_GROUND_Y)
    for (const [centre, camera] of [
      [mesh.position.x, x],
      [mesh.position.z, z],
    ]) {
      expect(Math.abs(centre % 8)).toBe(0) // a MAJOR multiple ⇒ local lattice ≡ world lattice
      expect(Math.abs(centre - camera)).toBeLessThanOrEqual(8)
    }
  }
  p.dispose()
})
