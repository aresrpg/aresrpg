// S-17 ACCEPTANCE — the two-client determinism gate.
//
// "same (seed, anchor, template) inputs on two engine instances → identical board masks, mob placements,
// Y-oracle answers." Every world-binding oracle is a PURE function of its inputs, so "two instances" is
// two independent invocations: identical inputs MUST yield deeply identical outputs, and a changed input
// (anchor / seed / template) MUST change the output (otherwise the world would be a constant, not derived).
// This file drives all three named oracles + the world-from-template + cosmetic-precedence seams that way.

import { test, expect, describe } from 'bun:test'

import { DEFAULT_WORLD_GEN_CONFIG } from '../config/world_gen_config.js'
import { WORLD_CONFIGS } from '../config/worlds/index.js'

import { ground_height } from './ground_height.js'
import { board_spec_for_anchor } from './board_anchor.js'
import { mob_group_placement } from './world_mobs.js'
import { world_from_template } from './world_template.js'
import { resolve_headgear } from './cosmetics.js'

const cfg = DEFAULT_WORLD_GEN_CONFIG
const ANCHORS = Array.from({ length: 24 }, (_, i) => [((i * 613) % 4000) - 2000, ((i * 379) % 4000) - 2000])
const WS = 3735928559 // 0xDEADBEEF — a fixed CHAIN u64 world seed for the board-from-anchor derivation

// The sealed board mask encoding (board.js CELL_*, kept as literals so this stays three-free):
// 0 floor / 1 obstacle / 2 hole / 3 void. Mirrors tactical/index.js compose_mask — the exact bytes the
// board renders, so byte-identity here == identical rendered boards.
const CELL_FLOOR = 0
const CELL_OBSTACLE = 1
const CELL_HOLE = 2
const CELL_VOID = 3
function mask_of(spec) {
  const { grid_w: w, grid_h: h, obstacles, holes, voids } = spec
  const mask = new Uint8Array(w * h).fill(CELL_FLOOR)
  for (const c of obstacles) mask[c.x + c.y * w] = CELL_OBSTACLE
  for (const c of holes) mask[c.x + c.y * w] = CELL_HOLE
  for (const c of voids) mask[c.x + c.y * w] = CELL_VOID
  return mask
}

describe('S-17 two-client determinism — identical inputs → identical world', () => {
  test('Y-oracle: same (config, x, z) → identical height on two instances', () => {
    for (const [x, z] of ANCHORS) {
      const a = ground_height(cfg, x, z)
      const b = ground_height(cfg, x, z)
      expect(a).toBe(b)
      expect(Number.isInteger(a)).toBe(true)
    }
  })

  test('board mask: same (seed, anchor) → byte-identical mask on two instances', () => {
    for (const [x, z] of ANCHORS) {
      const m1 = mask_of(board_spec_for_anchor(cfg, WS, x, z).spec)
      const m2 = mask_of(board_spec_for_anchor(cfg, WS, x, z).spec)
      expect([...m1]).toEqual([...m2])
    }
  })

  test('mob placements: same (seed, anchor, size) → identical layout on two instances', () => {
    for (const [x, z] of ANCHORS) {
      const size = (Math.abs(x + z) % 6) + 1
      const a = mob_group_placement(cfg, x, z, size, { group_seed: 0xabcd1234 })
      const b = mob_group_placement(cfg, x, z, size, { group_seed: 0xabcd1234 })
      expect(a).toEqual(b)
      expect(a.length).toBe(size)
      // each member grounded by the SAME Y-oracle → cross-oracle consistency.
      for (const m of a) expect(m.y).toBe(ground_height(cfg, m.x, m.z))
    }
  })

  test('world-from-template: same template → deeply identical engine inputs on two instances', () => {
    const template = {
      seed: 987654321n,
      biome: 'everest',
      bounds_x: 500000,
      bounds_z: 500000,
      zone_size: 512,
      spawn_zone_x: 1000,
      spawn_zone_z: 1000,
    }
    expect(world_from_template(template)).toEqual(world_from_template(template))
  })

  test('cosmetic precedence: pure over the slot handles (hat > helmet > hair)', () => {
    expect(resolve_headgear({ hat: 'H', helmet: 'K', hair: 'R' })).toEqual(
      resolve_headgear({ hat: 'H', helmet: 'K', hair: 'R' })
    )
  })
})

describe('S-17 determinism — a changed input changes the world (not a constant)', () => {
  test('board mask varies across anchors (the world is derived, not fixed)', () => {
    const masks = new Set(ANCHORS.map(([x, z]) => mask_of(board_spec_for_anchor(cfg, WS, x, z).spec).join(',')))
    expect(masks.size).toBeGreaterThan(ANCHORS.length / 2)
  })

  test('a different world seed → a different board + a different mob layout at the same anchor', () => {
    const other = Object.values(WORLD_CONFIGS).find((c) => c && c.seed !== cfg.seed)
    // board_spec now takes the CHAIN u64 world seed explicitly → two different u64s must yield different boards.
    expect(board_spec_for_anchor(cfg, WS, 0, 0).seed).not.toBe(board_spec_for_anchor(cfg, WS + 1, 0, 0).seed)
    // group_seed defaults to hash_anchor(world seed, anchor), so the mob layout shifts with the world config seed.
    const a = mob_group_placement(cfg, 0, 0, 6)
    const b = mob_group_placement(other, 0, 0, 6)
    expect(a).not.toEqual(b)
  })

  test('a 1-block anchor move → a different mob layout', () => {
    const a = mob_group_placement(cfg, 500, 500, 6)
    const b = mob_group_placement(cfg, 501, 500, 6)
    expect(a).not.toEqual(b)
  })
})
