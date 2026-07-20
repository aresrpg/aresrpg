// Collision resolution unit tests (ENG-8 acceptance: step-up, wall slide, corner, jump apex,
// no-tunnel at sprint). Pure — a synthetic block world via a `solid(x,y,z)` closure, no renderer.

import { describe, it, expect, spyOn } from 'bun:test'

import { CHARACTER_COLLIDER_HEIGHT, CHARACTER_RADIUS } from '../config/world_config.js'

import {
  resolve_movement,
  box_overlaps_solid,
  ground_height_below,
  eject_from_solid,
  AUTO_STEP_HEIGHT,
} from './collision.js'

/** A flat floor: every cell with y < floor_top is solid. @param {number} floor_top */
const flat_floor = (floor_top) => (/** @type {number} */ _x, /** @type {number} */ y, /** @type {number} */ _z) =>
  y < floor_top

/**
 * Set-backed block world: solid iff "x,y,z" is in the set. @param {Iterable<[number,number,number]>} cells
 */
const block_world = (cells) => {
  const set = new Set([...cells].map(([x, y, z]) => `${x},${y},${z}`))
  return (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) =>
    set.has(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`)
}

describe('box_overlaps_solid', () => {
  it('is false when the body stands ON the floor (feet at the floor top face)', () => {
    const solid = flat_floor(0) // cells y<0 solid; floor top face at y=0
    expect(box_overlaps_solid(solid, 0.5, 0, 0.5, CHARACTER_RADIUS, CHARACTER_COLLIDER_HEIGHT)).toBe(false)
  })
  it('is true when the body sinks into the floor', () => {
    const solid = flat_floor(0)
    expect(box_overlaps_solid(solid, 0.5, -0.5, 0.5, CHARACTER_RADIUS, CHARACTER_COLLIDER_HEIGHT)).toBe(true)
  })
})

describe('resolve_movement — ground + gravity', () => {
  it('lands on the floor and reports on_ground, zeroing downward velocity', () => {
    const solid = flat_floor(0)
    // start just above the floor, falling fast enough to reach it this frame (0.1 m gap, 0.33 m fall)
    const res = resolve_movement(solid, [0.5, 0.1, 0.5], [0, -20, 0], 1 / 60)
    expect(res.on_ground).toBe(true)
    expect(res.velocity[1]).toBe(0)
    // resting essentially on the floor top (within a skin width either side of y=0)
    expect(Math.abs(res.position[1])).toBeLessThan(0.01)
  })
  it('reads on_ground while resting even at zero vertical velocity', () => {
    const solid = flat_floor(0)
    const res = resolve_movement(solid, [0.5, 0, 0.5], [0, 0, 0], 1 / 60)
    expect(res.on_ground).toBe(true)
  })
  it('is airborne when high above the floor', () => {
    const solid = flat_floor(0)
    const res = resolve_movement(solid, [0.5, 10, 0.5], [0, -20, 0], 1 / 60)
    expect(res.on_ground).toBe(false)
  })
})

describe('resolve_movement — walls + slide', () => {
  it('stops at a wall and zeroes the into-wall velocity component', () => {
    // wall plane at x>=1 (all y we care about), floor below y=0. Start flush (right face at 1.0).
    const solid = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ _z) =>
      y < 0 || Math.floor(x) >= 1
    const res = resolve_movement(solid, [0.6, 0, 0.5], [10, 0, 0], 1 / 60)
    expect(res.velocity[0]).toBe(0)
    // feet-centre right face (x+r) must not cross more than a skin-width into the wall cell at x=1
    expect(res.position[0] + CHARACTER_RADIUS).toBeLessThanOrEqual(1 + 1e-2)
  })

  it('slides along a wall: blocked X keeps full Z motion (corner-free glide)', () => {
    const solid = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ _z) =>
      y < 0 || Math.floor(x) >= 1
    // push diagonally into the +X wall while moving +Z, starting flush against the wall
    const res = resolve_movement(solid, [0.6, 0, 0.5], [10, 0, 10], 1 / 60)
    expect(res.velocity[0]).toBe(0) // X killed by wall
    expect(res.velocity[2]).toBe(10) // Z preserved → slides
    expect(res.position[2]).toBeGreaterThan(0.5)
  })
})

describe('resolve_movement — auto step-up', () => {
  it('climbs a 1-block terrace smoothly (rises ~1 block, keeps advancing)', () => {
    // floor y<0 everywhere; a raised terrace: cell (1, 0, *) solid so its top is at y=1. Start the
    // body FLUSH against the lip (feet-centre 0.6 → right face 1.0) so a normal walk delta hits it.
    const solid = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ _z) => {
      if (y < 0) return true
      if (Math.floor(x) >= 1 && y === 0) return true // 1-tall step lip at x>=1
      return false
    }
    const res = resolve_movement(solid, [0.6, 0, 0.5], [6, 0, 0], 1 / 60)
    expect(res.stepped).toBe(true)
    expect(res.position[1]).toBeGreaterThan(0.9) // lifted onto the step top (~y=1)
    expect(res.position[1]).toBeLessThan(AUTO_STEP_HEIGHT + 0.1)
    expect(res.position[0]).toBeGreaterThan(0.6) // advanced past the lip
  })

  it('does NOT climb a 2-block wall — blocked, no step', () => {
    // wall two blocks tall at x>=1: cells (x,0) and (x,1) solid. Start flush (right face at 1.0).
    const solid = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ _z) => {
      if (y < 0) return true
      if (Math.floor(x) >= 1 && (y === 0 || y === 1)) return true
      return false
    }
    const res = resolve_movement(solid, [0.6, 0, 0.5], [6, 0, 0], 1 / 60)
    expect(res.stepped).toBe(false)
    expect(res.velocity[0]).toBe(0)
    expect(res.position[0] + CHARACTER_RADIUS).toBeLessThanOrEqual(1 + 1e-2)
    expect(res.position[1]).toBeLessThan(0.1) // stayed on the low floor
  })
})

describe('resolve_movement — jump apex + ceiling', () => {
  it('bonks a ceiling while rising and zeroes upward velocity', () => {
    // floor y<0, ceiling at y>=3. Start feet at 1.0 (head 2.9 for the 1.9 collider, just clear) rising
    // fast so the head bonks cell y=3 this frame (12 m/s × 1/60 ≈ 0.2 m of rise, head 2.9 → would reach ~3.1).
    const solid = (/** @type {number} */ _x, /** @type {number} */ y, /** @type {number} */ _z) => y < 0 || y >= 3
    const res = resolve_movement(solid, [0.5, 1.0, 0.5], [0, 12, 0], 1 / 60)
    expect(res.hit_ceiling).toBe(true)
    expect(res.velocity[1]).toBe(0)
    expect(res.position[1] + CHARACTER_COLLIDER_HEIGHT).toBeLessThanOrEqual(3 + 1e-2)
  })

  it('at jump apex (v≈0, airborne) reports neither ground nor ceiling', () => {
    const solid = flat_floor(0)
    const res = resolve_movement(solid, [0.5, 5, 0.5], [0, 0.0, 0], 1 / 60)
    expect(res.on_ground).toBe(false)
    expect(res.hit_ceiling).toBe(false)
  })
})

describe('resolve_movement — no tunneling at sprint speed', () => {
  it('a huge single-frame delta cannot pass through a 1-block-thin wall', () => {
    // thin wall: only the plane of cells at x==5 is solid (one block thick), floor below y=0
    const solid = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ _z) =>
      y < 0 || Math.floor(x) === 5
    // sprint 40 m/s across a 0.25s hitch = 10 m in one call, straight at the wall from x=0.5
    const res = resolve_movement(solid, [0.5, 0, 0.5], [40, 0, 0], 0.25)
    // must be stopped on the near side of the wall (right face ≤ 5 within a skin width), never
    // teleported past it (the far face is 6 — a tunneled body would land at ~10).
    expect(res.position[0] + CHARACTER_RADIUS).toBeLessThanOrEqual(5 + 1e-2)
    expect(res.velocity[0]).toBe(0)
  })
})

describe('ground_height_below', () => {
  it('finds the top face of the block under the feet', () => {
    const solid = block_world([
      [3, 10, 4],
      [3, 9, 4],
    ])
    // scanning down from y=15 at (3.5, *, 4.5) → top of the y=10 block is y=11
    expect(ground_height_below(solid, 3.5, 15, 4.5)).toBe(11)
  })
  it('returns null when nothing is below within range', () => {
    const solid = block_world([])
    expect(ground_height_below(solid, 0, 20, 0, 8)).toBeNull()
  })
})

describe('eject_from_solid (STUCK-IN-BLOCK auto-eject)', () => {
  it('leaves an already-clear position untouched (same reference back)', () => {
    const solid = flat_floor(0) // cells y<0 solid; standing on the top face at y=0 is clear
    const pos = /** @type {[number,number,number]} */ ([0.5, 0, 0.5])
    expect(eject_from_solid(solid, pos)).toBe(pos)
  })

  it('ejects a buried body UP the column to the first clear feet-y (nearest air)', () => {
    const solid = flat_floor(5) // 5-deep slab: cells y<5 solid, air at/above y=5
    // feet at y=2 → capsule y∈[2,3.9], fully buried; nearest clear feet-y is the slab top (5).
    const out = eject_from_solid(solid, [0.5, 2, 0.5])
    expect(out).toEqual([0.5, 5, 0.5])
    expect(box_overlaps_solid(solid, out[0], out[1], out[2], CHARACTER_RADIUS, CHARACTER_COLLIDER_HEIGHT)).toBe(false)
  })

  it('ejects LATERALLY when the whole column is blocked to the cap', () => {
    // an infinite vertical solid at every x-cell ≤ 0 (all y) — the player column can never clear UP.
    const solid = (/** @type {number} */ x, /** @type {number} */ _y, /** @type {number} */ _z) => Math.floor(x) <= 0
    const out = eject_from_solid(solid, [0.5, 5, 0.5])
    // only +x clears (−x and ±z stay in the x≤0 slab) → the nearest clear column is x-cell 1 (feet 1.5).
    expect(out).toEqual([1.5, 5, 0.5])
    expect(box_overlaps_solid(solid, out[0], out[1], out[2], CHARACTER_RADIUS, CHARACTER_COLLIDER_HEIGHT)).toBe(false)
  })

  it('gives up (returns the input, ONE warning) when no air exists within the caps — never loops', () => {
    const solid = () => true // fully solid — no escape up or laterally
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    const pos = /** @type {[number,number,number]} */ ([0.5, 5, 0.5])
    const out = eject_from_solid(solid, pos)
    expect(out).toBe(pos) // unchanged, left in place (the honest give-up)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
