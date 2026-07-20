// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// S-AMBIENCE — the environment ambience DIRECTOR's pure core (render/ambience.js). The GPU mount + engine
// wiring are DEFAULT ON (?ambience=0 escapes — the TORMENTOR arc-shell defect is fixed, see the file
// header) and proven by the standalone probe; here we unit-test the PURE policy: the config table, the
// emitter selector (underwater override + canopy gate), the upward canopy occupancy probe, the no-pop
// crossfade ramp, and the submerge burst envelope.

import { test, expect, describe } from 'bun:test'

import { PARTICLE_KINDS } from './particles.js'
import {
  AMBIENCE_TABLE,
  BURST_PEAK,
  BURST_SECONDS,
  DEFAULT_AMBIENCE,
  UNDERWATER_AMBIENCE,
  canopy_above,
  create_ambience,
  crossfade_step,
  resolve_ambience,
  resolve_emitter,
  submerge_burst_env,
} from './ambience.js'

/** A scene test double that just records mounted meshes (create_ambience.dispose calls `.remove`, so
 *  that's stubbed too) — no real renderer/GPU needed, mirrors the house fake_renderer idiom (clouds.test.js). */
const fake_scene = () => {
  const added = []
  return { added, add: (m) => added.push(m), remove: () => {} }
}
/** `.bake()` only ever calls `renderer.computeAsync(kernel)` — resolve it immediately, like clouds.test.js. */
const fake_renderer = () => ({ computeAsync: async () => {} })
/** `ensure()` starts baking with a fire-and-forget `.bake(renderer).then(() => { slot.baked = true })` —
 *  a macrotask tick unconditionally drains that whole microtask chain (computeAsync's own await + the
 *  .then), regardless of exactly how many promise hops three's mock/real renderer needs. */
const flush_async = () => new Promise((resolve) => setTimeout(resolve, 0))
/** weather_particle_count big enough that `particle_count_for` clamps to PARTICLE_MAX (6000) — every
 *  ambience kind (bubble density 0.7 ⇒ count 4200) gets a real, non-stubbed mesh. */
const RICH_TIER = 300_000

const is_kind = (/** @type {string} */ k) => k === 'ambient' || Boolean(PARTICLE_KINDS[k])

describe('AMBIENCE_TABLE — config integrity', () => {
  test('every row (and its open_kind) names a real PARTICLE_KINDS kind, density subtle (0,1]', () => {
    const rows = [DEFAULT_AMBIENCE, UNDERWATER_AMBIENCE, ...Object.values(AMBIENCE_TABLE)]
    for (const spec of rows) {
      expect(is_kind(spec.kind), `kind "${spec.kind}"`).toBe(true)
      expect(spec.density, `${spec.kind} density`).toBeGreaterThan(0)
      expect(spec.density, `${spec.kind} density subtle ≤ 1`).toBeLessThanOrEqual(1)
      if (spec.canopy_gate) expect(is_kind(spec.open_kind ?? 'mote'), `open_kind "${spec.open_kind}"`).toBe(true)
    }
  })

  test('the wishlist is covered — snow in cold, leaves in forest, sand desert, embers scorched', () => {
    expect(AMBIENCE_TABLE.taiga.kind).toBe('snow')
    expect(AMBIENCE_TABLE.alpine.kind).toBe('snow')
    expect(AMBIENCE_TABLE.dense_forest.canopy_gate).toBe(true)
    expect(AMBIENCE_TABLE.dense_forest.kind).toBe('leaf')
    expect(AMBIENCE_TABLE.desert.kind).toBe('sand')
    expect(AMBIENCE_TABLE.scorched_badlands.kind).toBe('ember')
    expect(UNDERWATER_AMBIENCE.kind).toBe('bubble')
  })
})

describe('resolve_ambience — biome → spec', () => {
  test('a known biome returns its authored row', () => {
    expect(resolve_ambience('desert')).toBe(AMBIENCE_TABLE.desert)
  })
  test('an unknown / undefined biome falls back to the sparse dust default', () => {
    expect(resolve_ambience('nonesuch')).toBe(DEFAULT_AMBIENCE)
    expect(resolve_ambience(undefined)).toBe(DEFAULT_AMBIENCE)
  })
})

describe('resolve_emitter — the live kind decision', () => {
  test('underwater OVERRIDES the biome — bubbles even inside a forest', () => {
    const e = resolve_emitter(AMBIENCE_TABLE.dense_forest, { covered: true, submerged: true })
    expect(e.kind).toBe('bubble')
    expect(e.density).toBe(UNDERWATER_AMBIENCE.density)
  })
  test('a canopy-gated forest plays LEAVES when covered, DUST/pollen in the open', () => {
    expect(resolve_emitter(AMBIENCE_TABLE.temperate_forest, { covered: true }).kind).toBe('leaf')
    expect(resolve_emitter(AMBIENCE_TABLE.temperate_forest, { covered: false }).kind).toBe('mote')
    // tropical opens to pollen, not dust.
    expect(resolve_emitter(AMBIENCE_TABLE.tropical, { covered: false }).kind).toBe('pollen')
  })
  test('a non-gated spec plays its kind regardless of canopy', () => {
    expect(resolve_emitter(AMBIENCE_TABLE.taiga, { covered: false }).kind).toBe('snow')
    expect(resolve_emitter(AMBIENCE_TABLE.taiga, { covered: true }).kind).toBe('snow')
  })
  test('open_density defaults to a sparser 0.6× when unset', () => {
    const spec = { kind: 'leaf', density: 0.5, canopy_gate: true, open_kind: 'mote' }
    expect(resolve_emitter(spec, { covered: false }).density).toBeCloseTo(0.3, 6)
  })
})

describe('canopy_above — upward occupancy probe', () => {
  const solid_at = (/** @type {number} */ ys) => (/** @type {number} */ _x, /** @type {number} */ y) =>
    ys.includes?.(y) ? 1 : 0
  test('open sky (all air) is NOT covered', () => {
    expect(canopy_above(() => 0, 0, 40, 0)).toBe(false)
  })
  test('a solid cell in the overhead band IS covered', () => {
    expect(canopy_above(solid_at([45]), 0, 40, 0)).toBe(true) // 40+5 within [42, 62)
  })
  test('a cell just above the head (inside the start-skip band) is IGNORED', () => {
    expect(canopy_above(solid_at([41]), 0, 40, 0, 22, 2)).toBe(false) // 41 < base 42
  })
  test('a cell above the scan cap is NOT reached (bounded — never spins the frame)', () => {
    let calls = 0
    const probe = (/** @type {number} */ _x, /** @type {number} */ y) => {
      calls += 1
      return y >= 100 ? 1 : 0
    }
    expect(canopy_above(probe, 0, 40, 0, 22, 2)).toBe(false)
    expect(calls).toBeLessThanOrEqual(22)
  })
})

describe('crossfade_step — no-pop opacity ramp', () => {
  test('ramps toward the target, clamped to [0,1], reaching it in ~seconds', () => {
    let o = 0
    for (let i = 0; i < 100 && o < 1; i += 1) o = crossfade_step(o, 1, 0.1, 3) // 3 s fade
    expect(o).toBeCloseTo(1, 6)
  })
  test('a half-second of a 3 s fade advances ~1/6 (no snap)', () => {
    expect(crossfade_step(0, 1, 0.5, 3)).toBeCloseTo(0.5 / 3, 6)
  })
  test('never overshoots and clamps a >1 target', () => {
    expect(crossfade_step(0.9, 5, 1, 3)).toBeLessThanOrEqual(1)
    expect(crossfade_step(0.5, -2, 1, 3)).toBeGreaterThanOrEqual(0)
  })
  test('dt 0 (or no time) snaps to the clamped target', () => {
    expect(crossfade_step(0.2, 0.8, 0, 3)).toBe(0.8)
  })
})

describe('submerge_burst_env — bubble burst on entry', () => {
  test('peaks at entry (t = dur) and settles to 1 at t = 0, always ≥ 1', () => {
    expect(submerge_burst_env(BURST_SECONDS)).toBeCloseTo(BURST_PEAK, 6)
    expect(submerge_burst_env(0)).toBe(1)
    for (let t = 0; t <= BURST_SECONDS; t += 0.1) expect(submerge_burst_env(t)).toBeGreaterThanOrEqual(1)
  })
  test('decays monotonically as the timer runs down', () => {
    expect(submerge_burst_env(BURST_SECONDS)).toBeGreaterThan(submerge_burst_env(BURST_SECONDS / 2))
    expect(submerge_burst_env(BURST_SECONDS / 2)).toBeGreaterThan(submerge_burst_env(0))
  })
})

// ── create_ambience — the INTEGRATION path (director state → mesh.visible) ─────────────────────────
// The tests above only ever exercised the pure helpers in isolation — never `create_ambience` itself, so
// the ambience.js:285 visibility gate (`slot.baked && slot.cur > 0.001`) had ZERO coverage. That gap is
// exactly what let a proof sweep mis-diagnose this director as the bubble-visibility bug (see the
// 2026-07-12 correction note at the top of ambience.js — the real defect is the underwater fog post-pass,
// one layer up). These tests close the gap: they prove the director's own submerged→visible contract.
describe('create_ambience — submerged → bubble slot bakes, ramps, and goes visible (proof-sweep regression)', () => {
  test('a submerged tick sequence flips the bubble mesh visible within a handful of steps', async () => {
    const scene = fake_scene()
    const renderer = fake_renderer()
    const director = create_ambience({
      scene,
      renderer,
      weather_particle_count: RICH_TIER,
      sample_biome: () => 0,
      block_at: () => 0,
    })

    // tick 1: submerged edge — ensure() mounts the bubble slot + fires the fire-and-forget bake().
    director.tick(0.1, { x: 0, y: 0, z: 0 }, { submerged: true })
    let bubble = director.debug_slots().find((s) => s.kind === 'bubble')
    expect(bubble, 'the bubble slot is created on the very first submerged tick').toBeTruthy()
    expect(bubble.mesh, 'a real (non-stub) mesh — RICH_TIER density > 0').toBe(true)
    expect(bubble.visible, 'not baked yet — the gate must NOT open on an unseeded field').toBe(false)

    await flush_async() // let the bake().then(() => { slot.baked = true }) chain settle

    let steps = 0
    for (; steps < 10 && !bubble.visible; steps += 1) {
      director.tick(0.1, { x: 0, y: 0, z: 0 }, { submerged: true })
      bubble = director.debug_slots().find((s) => s.kind === 'bubble')
    }

    expect(bubble.baked, 'baked half of the gate').toBe(true)
    expect(bubble.cur, 'cur half of the gate').toBeGreaterThan(0.001)
    expect(bubble.visible, 'ambience.js:285 gate — OPEN').toBe(true)
    expect(steps, 'ramps well within a handful of frames (crossfade_seconds=3, dt=0.1)').toBeLessThan(10)
    expect(
      scene.added.some((m) => m.count === bubble.count),
      'the visible mesh really is scene-mounted'
    ).toBe(true)
  })

  test('surfacing crossfades the bubble slot back OUT (cur → 0, mesh hides) without destroying it', async () => {
    const scene = fake_scene()
    const renderer = fake_renderer()
    const director = create_ambience({
      scene,
      renderer,
      weather_particle_count: RICH_TIER,
      sample_biome: () => 0,
      block_at: () => 0,
    })
    director.tick(0.1, { x: 0, y: 0, z: 0 }, { submerged: true })
    await flush_async()
    for (let i = 0; i < 10; i += 1) director.tick(0.1, { x: 0, y: 0, z: 0 }, { submerged: true })
    expect(director.debug_slots().find((s) => s.kind === 'bubble').visible).toBe(true)

    for (let i = 0; i < 60; i += 1) director.tick(0.1, { x: 0, y: 0, z: 0 }, { submerged: false })
    const bubble = director.debug_slots().find((s) => s.kind === 'bubble')
    expect(bubble.cur, 'crossfaded back to ~0 (no pop)').toBeLessThan(0.001)
    expect(bubble.visible, 'hidden again once cur settles').toBe(false)
    expect(bubble.baked, 'the pooled field survives — never rebuilt/re-baked on a revisit').toBe(true)
  })

  test('a dry (never-submerged) director never mounts a bubble slot at all', () => {
    const scene = fake_scene()
    const director = create_ambience({
      scene,
      renderer: fake_renderer(),
      weather_particle_count: RICH_TIER,
      sample_biome: () => 0,
      block_at: () => 0,
    })
    director.tick(0.1, { x: 0, y: 0, z: 0 }, { submerged: false })
    expect(director.debug_slots().some((s) => s.kind === 'bubble')).toBe(false)
  })
})
