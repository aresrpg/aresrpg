// Seam 5 gate — the wayfinding view is pure, grids the world correctly, and produces HUD-ready pips +
// zone-overlay states from pushed data.

import { test, expect, describe } from 'bun:test'

import { DEFAULT_WORLD_GEN_CONFIG } from '../config/world_gen_config.js'

import { zone_state_view, DEFAULT_ZONE_SIZE_BLOCKS } from './zone_view.js'

const cfg = DEFAULT_WORLD_GEN_CONFIG
const S = DEFAULT_ZONE_SIZE_BLOCKS // 512

/** two live spawns inside zone (0,0), one in zone (1,0). */
const ZONES_DATA = {
  zones: [
    {
      gx: 0,
      gz: 0,
      state: 'fresh',
      spawns: [
        { id: 'r1', kind: 'resource', template_id: 'iron', x: 100, z: 0 }, // due east of origin
        { id: 'm1', kind: 'mob_group', template_id: 'wolf', x: 0, z: 200 }, // due north
      ],
    },
    { gx: 1, gz: 0, state: 'looted', spawns: [{ id: 'r2', kind: 'resource', x: S + 50, z: 10 }] },
  ],
}

describe('binding/zone_state_view — grid + current zone', () => {
  test('current zone id/grid/bounds from player position', () => {
    const v = zone_state_view(cfg, [50, 60], ZONES_DATA)
    expect(v.zone_size).toBe(S)
    expect(v.current.gx).toBe(0)
    expect(v.current.gz).toBe(0)
    expect(v.current.id).toBe('0:0')
    expect(v.current.bounds).toEqual({ min_x: 0, min_z: 0, max_x: S, max_z: S })
    expect(v.current.state).toBe('fresh')
  })

  test('negative coordinates floor to negative grid cells', () => {
    const v = zone_state_view(cfg, [-1, -1], ZONES_DATA)
    expect(v.current.gx).toBe(-1)
    expect(v.current.gz).toBe(-1)
    expect(v.current.bounds).toEqual({ min_x: -S, min_z: -S, max_x: 0, max_z: 0 })
  })

  test('pure — same inputs → deeply identical view', () => {
    expect(zone_state_view(cfg, [50, 60], ZONES_DATA)).toEqual(zone_state_view(cfg, [50, 60], ZONES_DATA))
  })
})

describe('binding/zone_state_view — compass pips (current zone only)', () => {
  test('pips carry direction + distance for the current zone spawns only', () => {
    const v = zone_state_view(cfg, [0, 0], ZONES_DATA)
    expect(v.pips.length).toBe(2) // the two spawns in zone (0,0); the (1,0) spawn is excluded
    const iron = v.pips.find((p) => p.id === 'r1')
    expect(iron.distance).toBeCloseTo(100, 5)
    expect(iron.bearing).toBeCloseTo(Math.PI / 2, 5) // due east
    expect(iron.dir[0]).toBeCloseTo(1, 5)
    expect(iron.dir[1]).toBeCloseTo(0, 5)
    const wolf = v.pips.find((p) => p.id === 'm1')
    expect(wolf.bearing).toBeCloseTo(0, 5) // due north (+z)
    expect(wolf.distance).toBeCloseTo(200, 5)
  })

  test("standing in a different zone yields that zone's pips (or none if undiscovered)", () => {
    const in_10 = zone_state_view(cfg, [S + 5, 5], ZONES_DATA)
    expect(in_10.current.id).toBe('1:0')
    expect(in_10.pips.map((p) => p.id)).toEqual(['r2'])
    const empty = zone_state_view(cfg, [10 * S, 10 * S], ZONES_DATA)
    expect(empty.pips).toEqual([])
    expect(empty.current.state).toBe('undiscovered')
  })
})

describe('binding/zone_state_view — map overlay', () => {
  test('every pushed zone becomes an overlay cell with bounds + state + spawn_count', () => {
    const v = zone_state_view(cfg, [0, 0], ZONES_DATA)
    const z00 = v.zones.find((z) => z.id === '0:0')
    expect(z00.state).toBe('fresh')
    expect(z00.spawn_count).toBe(2)
    expect(z00.current).toBe(true)
    expect(z00.bounds).toEqual({ min_x: 0, min_z: 0, max_x: S, max_z: S })
    const z10 = v.zones.find((z) => z.id === '1:0')
    expect(z10.state).toBe('looted')
    expect(z10.current).toBe(false)
  })

  test('an undiscovered current zone is still present in the overlay', () => {
    const v = zone_state_view(cfg, [50 * S, 50 * S], ZONES_DATA)
    const cur = v.zones.find((z) => z.current)
    expect(cur.id).toBe('50:50')
    expect(cur.state).toBe('undiscovered')
    expect(cur.spawn_count).toBe(0)
  })
})

describe('binding/zone_state_view — robustness + config overrides', () => {
  test('missing/empty zones_data degrades cleanly', () => {
    const v = zone_state_view(cfg, [10, 10], null)
    expect(v.pips).toEqual([])
    expect(v.zones.length).toBe(1) // just the current cell
    expect(v.current.state).toBe('undiscovered')
    expect(v.world_bounds.max_x).toBeGreaterThan(0)
  })

  test('world_config.zones overrides win over data + defaults', () => {
    const custom = {
      ...cfg,
      zones: { size_blocks: 256, world_bounds: { min_x: 0, min_z: 0, max_x: 1000, max_z: 1000 } },
    }
    const v = zone_state_view(custom, [300, 0], { zone_size: 512 })
    expect(v.zone_size).toBe(256) // config wins over the data's 512
    expect(v.current.gx).toBe(1) // 300 / 256 → 1
    expect(v.world_bounds).toEqual({ min_x: 0, min_z: 0, max_x: 1000, max_z: 1000 })
  })
})
