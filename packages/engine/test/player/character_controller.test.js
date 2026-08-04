// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENG-24 / D160 — the public character-controller facade contract. The underlying physics
// (step_controller) has its own suite (controller.test.js); here we pin the FACADE semantics the dapp
// builds against: fixed-step determinism from any tick cadence, input merging, transform shape,
// teleport, spawn-scan promotion. Pure — a mock block oracle, no GPU.

import { test, expect, describe } from 'bun:test'

import { SENSHI_MALE_GLB_AVAILABLE } from '../../src/test_helpers/glb_fixture.js'

// MISSING-ARTIFACT (#117): character_controller.js unconditionally re-exports create_character_avatar
// from character_avatar.js (D193 "ONE home"), which static-imports the absent-by-design senshi_male.glb —
// see test_helpers/glb_fixture.js. Guarded dynamic import; none of this file's functions touch avatars,
// but the module can't load without the asset.
const { create_character_controller, find_open_spawn, ground_surface_y } = SENSHI_MALE_GLB_AVAILABLE
  ? await import('../../src/player/character_controller.js')
  : {}

/** Flat world: solid grass (id 3) at y ≤ 100, air above. */
const flat = (/** @type {number} */ _x, /** @type {number} */ y, /** @type {number} */ _z) => (y <= 100 ? 3 : 0)

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('create_character_controller — the D160 embed contract', () => {
  test('spawns standing, idle, on the given position', () => {
    const c = create_character_controller({ sample_block: flat, position: [0.5, 101, 0.5] })
    for (let i = 0; i < 30; i += 1) c.tick(1 / 60)
    const t = c.get_transform()
    expect(t.on_ground).toBe(true)
    expect(t.anim).toBe('IDLE')
    expect(t.position[1]).toBeCloseTo(101, 1)
  })

  test('forward input moves the character; speed + anim reflect the gait', () => {
    const c = create_character_controller({ sample_block: flat, position: [0.5, 101, 0.5], yaw: 0 })
    c.set_input({ forward: 1 })
    for (let i = 0; i < 120; i += 1) c.tick(1 / 60)
    const t = c.get_transform()
    const moved = Math.hypot(t.position[0] - 0.5, t.position[2] - 0.5)
    expect(moved).toBeGreaterThan(2) // actually travelled
    expect(t.speed).toBeGreaterThan(0.5)
    expect(['WALK', 'RUN']).toContain(t.anim)
  })

  test('FIXED-STEP determinism: many tiny ticks ≡ few large ticks (same total time)', () => {
    const a = create_character_controller({ sample_block: flat, position: [0.5, 101, 0.5], yaw: 0 })
    const b = create_character_controller({ sample_block: flat, position: [0.5, 101, 0.5], yaw: 0 })
    a.set_input({ forward: 1 })
    b.set_input({ forward: 1 })
    for (let i = 0; i < 240; i += 1) a.tick(1 / 240) // 1 s in 240 slices
    for (let i = 0; i < 12; i += 1) b.tick(1 / 12) //   1 s in 12 slices
    const ta = a.get_transform()
    const tb = b.get_transform()
    expect(ta.position[0]).toBeCloseTo(tb.position[0], 5)
    expect(ta.position[2]).toBeCloseTo(tb.position[2], 5)
  })

  test('a background-tab burst (huge dt) is clamped — never a physics explosion', () => {
    const c = create_character_controller({ sample_block: flat, position: [0.5, 101, 0.5], yaw: 0 })
    c.set_input({ forward: 1 })
    c.tick(10) // 10 s in one tick — must clamp to MAX_STEPS, not run 600 steps
    const t = c.get_transform()
    const moved = Math.hypot(t.position[0] - 0.5, t.position[2] - 0.5)
    expect(moved).toBeLessThan(3) // ≤ 8 fixed steps' worth of travel
  })

  test('teleport hard-places with zeroed velocity and no spawn-yank', () => {
    const c = create_character_controller({ sample_block: flat, position: [0.5, 101, 0.5] })
    c.teleport([50.5, 101, 50.5])
    for (let i = 0; i < 30; i += 1) c.tick(1 / 60)
    const t = c.get_transform()
    expect(Math.round(t.position[0])).toBe(51) // stays where placed (x≈50.5)
    expect(t.position[0]).toBeCloseTo(50.5, 1)
    expect(t.on_ground).toBe(true)
  })

  test('walking off a ledge falls; landing restores on_ground', () => {
    // Solid only for x < 5 — a cliff edge at x = 5, floor far below at y ≤ 20.
    const cliff = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ _z) =>
      y <= 20 || (y <= 100 && x < 5) ? 3 : 0
    const c = create_character_controller({ sample_block: cliff, position: [2.5, 101, 0.5], yaw: 0 })
    // face +x (controller axes are camera-yaw relative; yaw 0 forward = ? — drive by trying: move
    // forward and, if x doesn't grow, strafe instead; the contract under test is fall/land, not axes)
    c.set_input({ forward: 1 })
    for (let i = 0; i < 60; i += 1) c.tick(1 / 60)
    let t = c.get_transform()
    if (t.position[0] < 5) {
      c.set_input({ forward: 0, strafe: 1 })
      for (let i = 0; i < 60; i += 1) c.tick(1 / 60)
      t = c.get_transform()
    }
    // by now it crossed the edge on one axis or the other — let it fall
    for (let i = 0; i < 240; i += 1) c.tick(1 / 60)
    t = c.get_transform()
    expect(t.position[1]).toBeLessThan(60) // fell well below the plateau
    expect(t.on_ground).toBe(true) // and landed
  })

  test('dispose makes every mutator a no-op', () => {
    const c = create_character_controller({ sample_block: flat, position: [0.5, 101, 0.5] })
    c.dispose()
    c.set_input({ forward: 1 })
    c.tick(1)
    expect(c.get_transform().position[0]).toBeCloseTo(0.5, 6)
  })
})

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('double jump (2026-07-13) — the mid-air second bounce', () => {
  const step = (/** @type {any} */ c, /** @type {number} */ n) => {
    for (let i = 0; i < n; i += 1) c.tick(1 / 60)
  }
  // A fresh jump key-DOWN edge: release first (clears _jump_was_down), then press — so the edge-trigger fires
  // (a HELD key never re-fires). Two ticks = release edge, then press edge.
  const press_jump = (/** @type {any} */ c) => {
    c.set_input({ jump: false })
    c.tick(1 / 60)
    c.set_input({ jump: true })
    c.tick(1 / 60)
  }

  test('ground jump → ONE air-jump mid-air (vy re-spikes, air_jumped cue fires) → no triple jump → landing refills', () => {
    const c = create_character_controller({ sample_block: flat, position: [0.5, 101, 0.5] })
    step(c, 30) // settle on the ground
    expect(c.get_transform().on_ground).toBe(true)

    // 1) GROUND JUMP — a press off the ground launches up; it is NOT an air-jump.
    press_jump(c)
    let t = c.get_transform()
    expect(t.on_ground).toBe(false)
    expect(t.velocity[1]).toBeGreaterThan(0) // rising
    expect(t.air_jumped).toBe(false)

    // coast past the apex so the body is FALLING — the air-jump must bounce a descending body cleanly.
    step(c, 20)
    const [, vy_falling] = c.get_transform().velocity
    expect(vy_falling).toBeLessThan(0) // past apex, descending

    // 2) AIR JUMP — a second press mid-air re-spikes vy positive (the bounce) and flags air_jumped for one frame.
    c.set_input({ jump: false })
    c.tick(1 / 60)
    c.set_input({ jump: true })
    c.tick(1 / 60)
    t = c.get_transform()
    expect(t.on_ground).toBe(false)
    expect(t.air_jumped).toBe(true) // the one-shot VFX cue fired
    expect(t.velocity[1]).toBeGreaterThan(0) // vy jumped positive again — a real second impulse
    expect(t.velocity[1]).toBeGreaterThan(vy_falling)

    // the cue is one-shot — the very next tick clears it (held key never re-fires).
    c.tick(1 / 60)
    expect(c.get_transform().air_jumped).toBe(false)

    // 3) NO TRIPLE JUMP — a third mid-air press does nothing: no cue, no upward re-launch (gravity still owns vy).
    const [, vy_pre_third] = c.get_transform().velocity
    c.set_input({ jump: false })
    c.tick(1 / 60)
    c.set_input({ jump: true })
    c.tick(1 / 60)
    t = c.get_transform()
    expect(t.air_jumped).toBe(false)
    expect(t.velocity[1]).toBeLessThan(vy_pre_third) // never re-launched

    // 4) LAND → the charge refills; a fresh ground jump AND a fresh air-jump both work again.
    c.set_input({ jump: false })
    step(c, 300) // fall back down and land
    expect(c.get_transform().on_ground).toBe(true)
    press_jump(c)
    expect(c.get_transform().on_ground).toBe(false)
    step(c, 20)
    const [, vy2] = c.get_transform().velocity
    c.set_input({ jump: false })
    c.tick(1 / 60)
    c.set_input({ jump: true })
    c.tick(1 / 60)
    t = c.get_transform()
    expect(t.air_jumped).toBe(true) // the air-jump charge refilled on landing
    expect(t.velocity[1]).toBeGreaterThan(vy2)
  })

  test('chained OPTIMALLY the double jump clears a 4-block wall (target bar: total apex ≥ 4.05 blocks)', () => {
    // 1 voxel block ≈ 1 m; feet settle at y≈101, so apex-above-takeoff in blocks = peak_y − takeoff. Owner bar
    // (2026-07-13): ground jump + air jump fired at the ground apex must reach ≥ 4.05 blocks (clears a 4-tall wall).
    const c = create_character_controller({ sample_block: flat, position: [0.5, 101, 0.5] })
    step(c, 40)
    const [, takeoff] = c.get_transform().position

    // ground jump, then HOLD up (no release-cut → the base jump reaches its full apex).
    c.set_input({ jump: true })
    c.tick(1 / 60)
    let peak = takeoff
    let [, prev_vy] = c.get_transform().velocity
    let air_fired = false
    for (let i = 0; i < 400; i += 1) {
      const s = c.get_transform()
      peak = Math.max(peak, s.position[1])
      if (!air_fired && prev_vy > 0 && s.velocity[1] <= 0) {
        // the ground APEX — fire the air-jump here (optimal chain): release + press for a clean key-DOWN edge.
        c.set_input({ jump: false })
        c.tick(1 / 60)
        c.set_input({ jump: true })
        c.tick(1 / 60)
        air_fired = true
        ;[, prev_vy] = c.get_transform().velocity
        continue
      }
      ;[, prev_vy] = s.velocity
      c.set_input({ jump: true }) // hold both rises to full apex
      c.tick(1 / 60)
      if (air_fired && c.get_transform().on_ground) break
    }
    peak = Math.max(peak, c.get_transform().position[1])
    expect(air_fired).toBe(true)
    expect(peak - takeoff).toBeGreaterThanOrEqual(4.05) // clears the 4-block wall (top face at +4.0) with margin
  })
})

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)(
  'stuck-in-block auto-eject (BACKLOG STUCK-IN-BLOCK — never leave the camera inside geometry)',
  () => {
    // A 5-deep solid slab: grass (id 3) at y < 5, air above. Feet-y < 5 buries the 1.9-tall capsule.
    const slab = (/** @type {number} */ _x, /** @type {number} */ y, /** @type {number} */ _z) => (y < 5 ? 3 : 0)

    test('SPAWN inside a solid voxel ejects UP to the nearest air cell (not left buried)', () => {
      // feet at y=2 → capsule spans y∈[2, 3.9], fully inside the slab (buried, camera in geometry).
      const c = create_character_controller({ sample_block: slab, position: [0.5, 2, 0.5] })
      const t = c.get_transform() // prev == the ejected spawn at construction (acc=0) — read directly
      expect(t.position[1]).toBeCloseTo(5, 5) // ejected onto the slab top face (feet y=5, capsule 5..6.9 clear)
      expect(t.position[0]).toBeCloseTo(0.5, 5) // same column (searched up first)
      expect(t.position[2]).toBeCloseTo(0.5, 5)
    })

    test('TELEPORT into a solid voxel ejects up to air (the adoption path — join/rollback/snapshot)', () => {
      const c = create_character_controller({ sample_block: slab, position: [0.5, 8, 0.5] }) // spawn clear
      c.teleport([0.5, 1, 0.5]) // adopt a buried position
      c.tick(1 / 60) // one fixed step syncs prev to the ejected pose (a=0 read returns it, gravity-free)
      const t = c.get_transform()
      expect(t.position[1]).toBeCloseTo(5, 5) // ejected up, not left at the buried y=1
      expect(t.position[0]).toBeCloseTo(0.5, 5)
    })

    test('a CLEAR teleport is untouched — no spurious eject when the capsule is already in air', () => {
      const c = create_character_controller({ sample_block: slab, position: [0.5, 8, 0.5] })
      c.teleport([10.5, 8, 10.5]) // open air
      c.tick(1 / 60)
      const t = c.get_transform()
      expect(t.position[0]).toBeCloseTo(10.5, 5) // exactly where placed (no lateral nudge)
      expect(t.position[1]).toBeCloseTo(8, 5)
      expect(t.position[2]).toBeCloseTo(10.5, 5)
    })

    test('teleport({ eject: false }) keeps the raw buried position — creative-fly moves through solids', () => {
      const c = create_character_controller({ sample_block: slab, position: [0.5, 8, 0.5] })
      c.teleport([0.5, 1, 0.5], { eject: false }) // fly bypass: the per-frame teleport must NOT eject
      c.tick(1 / 60)
      const t = c.get_transform()
      expect(t.position[1]).toBeLessThan(2) // stayed at the raw buried y≈1 (NOT ejected to the slab top)
    })
  }
)

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('spawn scan promotion (the one-home surface)', () => {
  test('ground_surface_y skips canopy and lands on ground', () => {
    // grass at y ≤ 80, a tree: log column at y 81..84, leaves 85..87 — the scan must return 80, not 87.
    const world = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
      if (y <= 80) return 3
      if (x === 0 && z === 0) {
        if (y <= 84) return 6
        if (y <= 87) return 7
      }
      return 0
    }
    expect(ground_surface_y(world, 0, 0)).toBe(null) // no headroom above ground under the trunk
    expect(ground_surface_y(world, 3, 3)).toBe(80) // open column → the grass top
  })

  test('find_open_spawn spirals off a treed column onto open flat ground', () => {
    const world = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
      if (y <= 80) return 3
      if (Math.abs(x) <= 1 && Math.abs(z) <= 1 && y <= 87) return y <= 84 ? 6 : 7
      return 0
    }
    const s = find_open_spawn(world, 0, 0, 10)
    expect(s).not.toBeNull()
    const [sx, sy, sz] = /** @type {[number,number,number]} */ (s)
    expect(sy).toBe(81) // feet on the grass top face
    expect(Math.max(Math.abs(sx), Math.abs(sz))).toBeGreaterThan(1) // relocated off the tree
  })
})
