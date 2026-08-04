// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Seam 6 gate — the chain world template maps onto engine inputs (gen recipe + barrier bounds) correctly,
// reconciling the u64 seed + u32 (0-based) coords, without mutating the shared biome registry.

import { test, expect, describe } from 'bun:test'

import { DEFAULT_WORLD_GEN_CONFIG } from '../../src/config/world_gen_config.js'
import { WORLD_CONFIGS } from '../../src/config/worlds/index.js'
import { world_from_template, DEFAULT_SPAWN_ZONE_BLOCKS } from '../../src/binding/world_template.js'
import { DEFAULT_ZONE_SIZE_BLOCKS, DEFAULT_WORLD_SIZE_BLOCKS } from '../../src/binding/zone_view.js'

describe('binding/world_from_template — defaults + robustness', () => {
  test('nullish template → the default world with SPEC defaults', () => {
    const w = world_from_template(null)
    expect(w.world_config.seed).toBe(DEFAULT_WORLD_GEN_CONFIG.seed)
    expect(w.world_bounds).toEqual({
      min_x: 0,
      min_z: 0,
      max_x: DEFAULT_WORLD_SIZE_BLOCKS,
      max_z: DEFAULT_WORLD_SIZE_BLOCKS,
    })
    expect(w.world_config.zones.size_blocks).toBe(DEFAULT_ZONE_SIZE_BLOCKS)
    expect(w.spawn_zone).toEqual({ width: DEFAULT_SPAWN_ZONE_BLOCKS, depth: DEFAULT_SPAWN_ZONE_BLOCKS })
  })

  test('empty object degrades to the same defaults', () => {
    expect(world_from_template({})).toEqual(world_from_template(null))
  })
})

describe('binding/world_from_template — chain shape reconciliation', () => {
  test('u64 seed (bigint / number / string) → the engine STRING seed', () => {
    expect(world_from_template({ seed: 12345n }).world_config.seed).toBe('12345')
    expect(world_from_template({ seed: 12345 }).world_config.seed).toBe('12345')
    expect(world_from_template({ seed: '12345' }).world_config.seed).toBe('12345')
  })

  test('world_bounds are 0-based (u32 coords), not origin-centred', () => {
    const w = world_from_template({ bounds_x: 1000, bounds_z: 2000 })
    expect(w.world_bounds).toEqual({ min_x: 0, min_z: 0, max_x: 1000, max_z: 2000 })
  })

  test('the zone grid folds into world_config.zones (so zone_state_view reads the template)', () => {
    const w = world_from_template({ bounds_x: 4096, bounds_z: 4096, zone_size: 256 })
    expect(w.world_config.zones.size_blocks).toBe(256)
    expect(w.world_config.zones.world_bounds).toEqual(w.world_bounds)
  })

  test('bounds/zone/spawn accept RPC-widened numerics and floor + guard against 0', () => {
    const w = world_from_template({ bounds_x: '800', bounds_z: 800n, zone_size: 0, spawn_zone_x: 500.9 })
    expect(w.world_bounds.max_x).toBe(800)
    expect(w.world_bounds.max_z).toBe(800)
    expect(w.world_config.zones.size_blocks).toBe(1) // 0 guarded up to a valid minimum
    expect(w.spawn_zone.width).toBe(500)
  })

  test('required_level is surfaced as passthrough metadata', () => {
    expect(world_from_template({ required_level: 40 }).required_level).toBe(40)
    expect(world_from_template({}).required_level).toBe(0)
  })
})

describe('binding/world_from_template — biome resolution + immutability', () => {
  test('a known biome resolves that recipe (seed applied on top)', () => {
    const [name] = Object.keys(WORLD_CONFIGS)
    const w = world_from_template({ biome: name, seed: 7 })
    expect(w.biome).toBe(name)
    expect(w.world_config.name).toBe(WORLD_CONFIGS[name].name)
    expect(w.world_config.seed).toBe('7') // the template seed wins over the recipe's own
  })

  test('an unknown biome falls back to the default world (never throws)', () => {
    const w = world_from_template({ biome: 'no_such_biome' })
    expect(w.world_config.seed).toBe(DEFAULT_WORLD_GEN_CONFIG.seed)
  })

  test('never mutates the shared registry recipe (fresh object; base seed untouched)', () => {
    const [name] = Object.keys(WORLD_CONFIGS)
    const before = WORLD_CONFIGS[name].seed
    const w = world_from_template({ biome: name, seed: 999 })
    expect(w.world_config).not.toBe(WORLD_CONFIGS[name]) // a clone, not the shared object
    expect(WORLD_CONFIGS[name].seed).toBe(before) // the registry recipe is unchanged
  })
})
