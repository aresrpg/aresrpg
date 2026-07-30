// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RIG BUDGET + DISPOSAL — proof for the P0 world-entry OOM: the mob-density dial went
// 3-8 → 12-24 groups/zone with NO concurrent-rig cap, so a dense neighbourhood (or a small admin zone_size)
// resident hundreds of SkeletonUtils clones — mounted in a single on-entry burst — and OOM'd the tab. Two
// pure, headless proofs (no three render, no engine, no DOM):
//   • select_rig_budget — the ceiling: nearest-first placement, farthest-first eviction, INCREMENTAL per-call
//     cap (anti-burst), and swap hysteresis (boundary jitter never thrashes).
//   • dispose_member — the teardown FREES: mixer stopped + uncached, each per-clone skeleton disposed (boneTexture
//     is per-clone, ours to free), root removed REMOVE-ONLY, ref nulled — no leak across spawn/despawn cycles.

import { describe, expect, it, mock } from 'bun:test'

import { SENSHI_MALE_GLB_AVAILABLE } from '../test_helpers/glb_fixture.js'

// MISSING-ARTIFACT (#117): spawn_rigs.js imports @aresrpg/engine3/player, whose character_controller.js
// unconditionally re-exports create_character_avatar — a static import of the absent-by-design
// senshi_male.glb — see test_helpers/glb_fixture.js.
const { select_rig_budget, create_rig_layer } = SENSHI_MALE_GLB_AVAILABLE ? await import('./spawn_rigs.js') : {}

// {key, d2} rows — d2 is the SQUARED player distance (the arbiter never square-roots).
const row = (/** @type {string} */ key, /** @type {number} */ d2) => ({ key, d2 })

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('select_rig_budget — the concurrent-rig ceiling', () => {
  it('under budget: places every candidate NEAREST-FIRST, evicts nothing', () => {
    const { evict, place } = select_rig_budget({
      placed: [],
      candidates: [row('far', 900), row('near', 100), row('mid', 400)],
      budget: 32,
      swap_margin_sq: 144,
    })
    expect([...evict]).toEqual([])
    expect(place).toEqual(['near', 'mid', 'far']) // sorted by d2 ascending
  })

  it('INCREMENTAL cap: never mounts more than place_limit per call (the anti-burst gate)', () => {
    // 200 in-range candidates on world entry — the exact burst that OOM'd. Only 4 mount this frame.
    const candidates = Array.from({ length: 200 }, (_, i) => row(`c${i}`, (i + 1) * 10))
    const { place } = select_rig_budget({ placed: [], candidates, budget: 32, swap_margin_sq: 144, place_limit: 4 })
    expect(place.length).toBe(4)
    expect(place).toEqual(['c0', 'c1', 'c2', 'c3']) // the 4 NEAREST, not an arbitrary 4
  })

  it('over budget: evicts the FARTHEST residents down to the cap', () => {
    const placed = [row('a', 100), row('b', 200), row('c', 300), row('d', 400)]
    const { evict, place } = select_rig_budget({ placed, candidates: [], budget: 2, swap_margin_sq: 144 })
    expect([...evict].sort()).toEqual(['c', 'd']) // the two farthest go
    expect(place).toEqual([])
  })

  it('FULL budget + hysteresis: a candidate only NEARER-BY-MARGIN displaces the farthest resident', () => {
    // budget 2, both slots resident at d2 = {400 (far), 100 (near)}. margin_sq = 100 (10 blocks).
    const placed = [row('near', 100), row('far', 400)]
    // candidate at 350 is nearer than 400 but NOT by the margin (350 + 100 = 450 ≥ 400) → NO swap (no thrash).
    const held = select_rig_budget({ placed, candidates: [row('c', 350)], budget: 2, swap_margin_sq: 100 })
    expect([...held.evict]).toEqual([])
    expect(held.place).toEqual([])
    // candidate at 250 IS nearer by the margin (250 + 100 = 350 < 400) → displaces 'far'.
    const swapped = select_rig_budget({ placed, candidates: [row('c', 250)], budget: 2, swap_margin_sq: 100 })
    expect([...swapped.evict]).toEqual(['far'])
    expect(swapped.place).toEqual(['c'])
  })

  it('budget 0: evicts all residents, places nothing (suspend case)', () => {
    const { evict, place } = select_rig_budget({
      placed: [row('a', 1), row('b', 2)],
      candidates: [row('c', 3)],
      budget: 0,
      swap_margin_sq: 144,
    })
    expect([...evict].sort()).toEqual(['a', 'b'])
    expect(place).toEqual([])
  })
})

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('dispose_member — teardown FREES the per-clone rig (no leak across cycles)', () => {
  const make_layer = () => {
    const removed = /** @type {any[]} */ ([])
    const engine = { add_to_scene() {}, remove_from_scene: (/** @type {any} */ o) => removed.push(o) }
    const layer = create_rig_layer({
      engine,
      sample: () => 0,
      resolve_template: () => null,
      is_disposed: () => false,
    })
    return { layer, removed }
  }

  // A fake factory-built rig: the factory disposer owns its skeleton/material state; the layer owns mixer + mount.
  const make_rig = () => {
    const skeleton = { dispose: mock(() => {}) }
    const root = {}
    const mixer = { stopAllAction: mock(() => {}), uncacheRoot: mock(() => {}) }
    const dispose = mock(() => skeleton.dispose())
    return { root, mixer, skeleton, dispose }
  }

  it('stops + uncaches the mixer, invokes the factory disposer, removes the root, and nulls the ref', () => {
    const { layer, removed } = make_layer()
    const { root, mixer, skeleton, dispose } = make_rig()
    const mem = { rig: { root, mixer, dispose } }

    layer.dispose_member(mem)

    expect(mixer.stopAllAction).toHaveBeenCalledTimes(1)
    expect(mixer.uncacheRoot).toHaveBeenCalledTimes(1)
    expect(mixer.uncacheRoot).toHaveBeenCalledWith(root) // uncache THIS root's bindings
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(skeleton.dispose).toHaveBeenCalledTimes(1)
    expect(removed).toEqual([root]) // removed from the scene exactly once, geometry/material untouched (shared)
    expect(mem.rig).toBeNull() // no dangling reference → GC-eligible
  })

  it('is a no-op on a member whose rig never loaded (the mid-load teardown race)', () => {
    const { layer, removed } = make_layer()
    const mem = { rig: null }
    expect(() => layer.dispose_member(mem)).not.toThrow()
    expect(removed).toEqual([])
    expect(mem.rig).toBeNull()
  })

  it('is idempotent — a double dispose never throws or double-removes', () => {
    const { layer, removed } = make_layer()
    const { root, mixer, dispose } = make_rig()
    const mem = { rig: { root, mixer, dispose } }
    layer.dispose_member(mem)
    layer.dispose_member(mem)
    expect(removed).toEqual([root]) // only the first call removed it
    expect(mem.rig).toBeNull()
  })
})
