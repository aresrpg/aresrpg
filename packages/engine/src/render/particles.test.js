// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure-math tests for the NG2-ATMO ambient particles. Pins the MATH the TSL positionNode mirrors:
// (1) every particle, at every time, lands INSIDE the camera-following box (no escapees),
// (2) motion wraps seamlessly (fractional drift ⇒ bounded, continuous re-entry),
// (3) the field is WORLD-ANCHORED — the box follows the camera but motes keep their world position (parallax),
// (4) tier count derives from `weather_particle_count`, is monotone up the ladder, capped, 0 on potato,
// (5) leaves fall (net downward drift) while motes hang (near-zero vertical drift).
// GPU seeding/draw is the wiring wave's concern; the JS `particle_seed` mirrors the kernel's statistics.

import { test, expect, describe } from 'bun:test'

import { QUALITY_TIERS, TIER_ORDER } from '../core/quality/tiers.js'

import {
  GUST,
  GUST_MAX,
  GUST_MIN,
  LEAF_FRACTION,
  PARTICLE_BOX_XZ,
  PARTICLE_KINDS,
  PARTICLE_MAX,
  SPRITE_ALPHA_EPS,
  advance_gust,
  gust_at,
  mote_position,
  particle_bounds,
  particle_count_for,
  particle_seed,
  particle_size,
  sprite_falloff,
} from './particles.js'

/** @param {number} v @param {number} lo @param {number} hi */
const inb = (v, lo, hi) => v >= lo - 1e-6 && v <= hi + 1e-6

describe('particle_count_for — tier gating', () => {
  test('LOW budget (0) → 0 particles', () => {
    expect(particle_count_for(0)).toBe(0)
  })

  test('monotone non-decreasing across the tier ladder', () => {
    let prev = -1
    for (const t of TIER_ORDER) {
      const n = particle_count_for(QUALITY_TIERS[t].weather_particle_count)
      expect(n).toBeGreaterThanOrEqual(prev)
      prev = n
    }
  })

  test('capped at PARTICLE_MAX even for an absurd budget', () => {
    expect(particle_count_for(1e9)).toBe(PARTICLE_MAX)
  })

  test('a mid budget yields a modest positive ambient count', () => {
    const n = particle_count_for(QUALITY_TIERS.high.weather_particle_count) // 300k
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThanOrEqual(PARTICLE_MAX)
  })
})

describe('particle_bounds — camera-following box', () => {
  test('box is centered on the camera in XZ with the fixed half-extent', () => {
    const b = particle_bounds([100, 30, -50])
    expect(b.max[0] - b.min[0]).toBeCloseTo(2 * PARTICLE_BOX_XZ, 6)
    expect(b.max[2] - b.min[2]).toBeCloseTo(2 * PARTICLE_BOX_XZ, 6)
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(100, 6)
    expect((b.min[2] + b.max[2]) / 2).toBeCloseTo(-50, 6)
  })

  test('Y band sits mostly below the camera (near-ground motes)', () => {
    const b = particle_bounds([0, 50, 0])
    expect(b.min[1]).toBeLessThan(50)
    expect(b.max[1]).toBeGreaterThan(50) // a little above eye level
    expect(50 - b.min[1]).toBeGreaterThan(b.max[1] - 50) // more span below than above
  })
})

describe('mote_position — in-bounds, wrapping, camera-following', () => {
  const cam = /** @type {[number,number,number]} */ ([12, 40, -8])

  test('every particle stays inside the box for a grid of (index, time)', () => {
    for (let i = 0; i < 200; i += 7) {
      const seed = particle_seed(i)
      for (let t = 0; t < 60; t += 3.3) {
        const p = mote_position(i, cam, t, seed)
        const b = particle_bounds(cam)
        expect(inb(p[0], b.min[0], b.max[0])).toBe(true)
        expect(inb(p[1], b.min[1], b.max[1])).toBe(true)
        expect(inb(p[2], b.min[2], b.max[2])).toBe(true)
      }
    }
  })

  test('positions are finite everywhere (no NaN from the wrap/trig math)', () => {
    for (let i = 0; i < 50; i++) {
      const seed = particle_seed(i, 999)
      const p = mote_position(i, cam, i * 1.7, seed)
      for (const c of p) expect(Number.isFinite(c)).toBe(true)
    }
  })

  test('the field is WORLD-ANCHORED (parallax) — a strafe does NOT translate motes like a screen sticker', () => {
    // The OLD field shifted every mote by exactly the camera delta ⇒ a constant screen offset (particles
    // reading as screen-space sprites, not in 3D space). The FIX world-anchors them: a mote keeps its world position as
    // the box slides over it, and the wrap re-centres it by a FULL box span — so its world position is
    // invariant MODULO the span (near motes then sweep the view faster than far ones = depth parallax).
    const seed = particle_seed(3)
    const t = 4.2
    const span_xz = 2 * PARTICLE_BOX_XZ
    // distance to the nearest whole-span multiple: 0 ⇒ world position preserved (the old field gave the raw cam delta).
    const to_span = (/** @type {number} */ d) => {
      const m = ((d % span_xz) + span_xz) % span_xz
      return Math.min(m, span_xz - m)
    }
    for (const [c0, c1] of /** @type {[[number,number,number],[number,number,number]][]} */ ([
      [
        [0, 40, 0],
        [10, 40, 0],
      ],
      [
        [0, 40, 0],
        [100, 40, 25],
      ],
      [
        [-30, 40, 17],
        [3, 40, -9],
      ],
    ])) {
      const p0 = mote_position(3, c0, t, seed)
      const p1 = mote_position(3, c1, t, seed)
      expect(to_span(p1[0] - p0[0]), 'world X invariant mod the box span (not shifted by the cam delta)').toBeCloseTo(
        0,
        5
      )
      expect(to_span(p1[2] - p0[2]), 'world Z invariant mod the box span').toBeCloseTo(0, 5)
    }
    // and the sticker is truly gone: a 10 m strafe must NOT move the mote ~10 m (the old field's signature).
    const q0 = mote_position(3, [0, 40, 0], t, seed)
    const q1 = mote_position(3, [10, 40, 0], t, seed)
    expect(Math.abs(q1[0] - q0[0]), 'a 10 m strafe does not translate the mote like a screen sticker').not.toBeCloseTo(
      10,
      1
    )
  })

  test('leaves fall (net downward over time) while motes hang (near-stationary in Y)', () => {
    // find one leaf seed and one mote seed deterministically.
    let leaf = -1
    let mote = -1
    for (let i = 0; i < 500 && (leaf < 0 || mote < 0); i++) {
      const s = particle_seed(i)
      if (s.kind < LEAF_FRACTION && leaf < 0) leaf = i
      if (s.kind >= LEAF_FRACTION && mote < 0) mote = i
    }
    expect(leaf).toBeGreaterThanOrEqual(0)
    expect(mote).toBeGreaterThanOrEqual(0)

    // Average vertical velocity over a short window (before any wrap dominates): leaves clearly sink,
    // motes barely move. Sample many short steps and average the signed dy to wash out wrap jumps.
    const avg_dy = (/** @type {number} */ i) => {
      const s = particle_seed(i)
      let sum = 0
      let cnt = 0
      for (let t = 0; t < 2; t += 0.05) {
        const [, a] = mote_position(i, cam, t, s)
        const [, b] = mote_position(i, cam, t + 0.05, s)
        const d = b - a
        if (Math.abs(d) < 5) {
          sum += d
          cnt++
        } // ignore the single wrap discontinuity
      }
      return sum / Math.max(cnt, 1)
    }
    expect(avg_dy(leaf)).toBeLessThan(0) // leaves sink
    expect(Math.abs(avg_dy(mote))).toBeLessThan(Math.abs(avg_dy(leaf))) // motes hang (much slower)
  })
})

describe('particle_size / seeding', () => {
  test('leaves are larger than motes', () => {
    expect(particle_size(0.1)).toBeGreaterThan(particle_size(0.9)) // 0.1 < LEAF_FRACTION ⇒ leaf
  })

  test('seed params are in their expected ranges', () => {
    for (let i = 0; i < 100; i++) {
      const s = particle_seed(i)
      for (const o of s.off) expect(inb(o, 0, 1)).toBe(true)
      expect(inb(s.phase, 0, Math.PI * 2)).toBe(true)
      expect(inb(s.speed, 0, 1)).toBe(true)
      expect(inb(s.kind, 0, 1)).toBe(true)
    }
  })

  test('a salt forks the field (different seeds for the same index)', () => {
    const a = particle_seed(5, 0)
    const b = particle_seed(5, 1)
    expect(a.off[0]).not.toBeCloseTo(b.off[0], 6)
  })
})

// ── B7: shared wind gust (P7 wind-field tie) ─────────────────────────────────────────────────────
describe('gust_at / advance_gust — the shared wind gust', () => {
  test('bounded in [GUST_MIN, GUST_MAX] for a wide range of t', () => {
    for (let t = 0; t < 500; t += 0.37) {
      const g = gust_at(t)
      expect(g).toBeGreaterThanOrEqual(GUST_MIN - 1e-9)
      expect(g).toBeLessThanOrEqual(GUST_MAX + 1e-9)
    }
  })

  test('continuous — a small step makes a small change (slow breathing, no pop)', () => {
    let prev = gust_at(0)
    for (let t = 0.05; t < 90; t += 0.05) {
      const g = gust_at(t)
      expect(Math.abs(g - prev)).toBeLessThan(0.02)
      prev = g
    }
  })

  test('mean sits near 1.0 over a long window (×GUST is neutral at rest)', () => {
    let sum = 0
    let n = 0
    for (let t = 0; t < 4000; t += 0.5) {
      sum += gust_at(t)
      n += 1
    }
    const mean = sum / n
    expect(mean).toBeGreaterThan(0.9)
    expect(mean).toBeLessThan(1.2)
  })

  test('advance_gust writes GUST.value in range and ignores negative dt', () => {
    advance_gust(-10) // ignored (no time advance)
    expect(GUST.value).toBeGreaterThanOrEqual(GUST_MIN - 1e-9)
    expect(GUST.value).toBeLessThanOrEqual(GUST_MAX + 1e-9)
    for (let k = 0; k < 50; k += 1) advance_gust(0.1)
    expect(GUST.value).toBeGreaterThanOrEqual(GUST_MIN - 1e-9)
    expect(GUST.value).toBeLessThanOrEqual(GUST_MAX + 1e-9)
  })
})

// ── B7: biome particle kinds ─────────────────────────────────────────────────────────────────────
describe('PARTICLE_KINDS — biome ambient kinds', () => {
  const cam = /** @type {[number,number,number]} */ ([10, 40, -5])

  test('every kind colour channel ≤ 1.0 (no-bloom law) and size > 0', () => {
    for (const [name, kp] of Object.entries(PARTICLE_KINDS)) {
      for (const c of kp.color) expect(c, `${name} colour channel ≤ 1`).toBeLessThanOrEqual(1.0)
      expect(kp.size, `${name} size > 0`).toBeGreaterThan(0)
    }
  })

  test('named kinds keep every particle inside the camera-following box', () => {
    const b = particle_bounds(cam)
    for (const kind of Object.keys(PARTICLE_KINDS)) {
      for (let i = 0; i < 60; i += 7) {
        const seed = particle_seed(i)
        for (let t = 0; t < 40; t += 4.1) {
          const p = mote_position(i, cam, t, seed, { kind })
          expect(inb(p[0], b.min[0], b.max[0]), `${kind} x`).toBe(true)
          expect(inb(p[1], b.min[1], b.max[1]), `${kind} y`).toBe(true)
          expect(inb(p[2], b.min[2], b.max[2]), `${kind} z`).toBe(true)
        }
      }
    }
  })

  test('embers RISE, snow sinks slower than leaves, fireflies hang', () => {
    // average signed dy over many short steps (drop the single per-particle wrap discontinuity).
    const avg_dy = (/** @type {string} */ kind) => {
      let sum = 0
      let n = 0
      for (let i = 0; i < 40; i += 1) {
        const s = particle_seed(i)
        for (let t = 0; t < 3; t += 0.1) {
          const [, a] = mote_position(i, [0, 40, 0], t, s, { kind })
          const [, b] = mote_position(i, [0, 40, 0], t + 0.1, s, { kind })
          const d = b - a
          if (Math.abs(d) < 5) {
            sum += d
            n += 1
          }
        }
      }
      return sum / Math.max(n, 1)
    }
    const ember = avg_dy('ember')
    const snow = avg_dy('snow')
    const leaf = avg_dy('leaf')
    const firefly = avg_dy('firefly')
    expect(ember, 'embers float up').toBeGreaterThan(0)
    expect(snow, 'snow sinks').toBeLessThan(0)
    expect(Math.abs(snow), 'snow falls slower than leaves').toBeLessThan(Math.abs(leaf))
    expect(Math.abs(firefly), 'fireflies hang (near-stationary in Y)').toBeLessThan(Math.abs(leaf))
  })

  test('bubble RISES toward the surface; sand is a wind-drifted wisp (sway ≫ snow)', () => {
    // S-AMBIENCE kinds: bubble (underwater) rises like an ember; sand sweeps a wider horizontal path than
    // snow (its whole read is the wind drift near the ground). Same wrap-drop convention as the tests above.
    const avg_dy = (/** @type {string} */ kind) => {
      let sum = 0
      let n = 0
      for (let i = 0; i < 40; i += 1) {
        const s = particle_seed(i)
        for (let t = 0; t < 3; t += 0.1) {
          const [, a] = mote_position(i, [0, 40, 0], t, s, { kind })
          const [, b] = mote_position(i, [0, 40, 0], t + 0.1, s, { kind })
          const d = b - a
          if (Math.abs(d) < 5) {
            sum += d
            n += 1
          }
        }
      }
      return sum / Math.max(n, 1)
    }
    const path_x = (/** @type {string} */ kind) => {
      const seed = particle_seed(9)
      let L = 0
      let [prev] = mote_position(9, [0, 40, 0], 0, seed, { kind })
      for (let t = 0.05; t < 8; t += 0.05) {
        const [x] = mote_position(9, [0, 40, 0], t, seed, { kind })
        const dx = Math.abs(x - prev)
        if (dx < 5) L += dx
        prev = x
      }
      return L
    }
    expect(avg_dy('bubble'), 'bubbles float up').toBeGreaterThan(0)
    expect(path_x('sand'), 'sand sways wider than snow (wind-drifted wisp)').toBeGreaterThan(path_x('snow'))
  })

  test('the shared gust widens horizontal sway (path length grows with gust)', () => {
    // Horizontal (x) path length over a window is pure sway ⇒ scales with sway_amp = kind.sway_amp × gust.
    // fract-wrap jumps are dropped (|dx| ≥ 5 excluded). A stronger gust ⇒ a longer swept path.
    const path = (/** @type {number} */ gust) => {
      const seed = particle_seed(9)
      let L = 0
      let [prev] = mote_position(9, [0, 40, 0], 0, seed, { kind: 'pollen', gust })
      for (let t = 0.05; t < 8; t += 0.05) {
        const [x] = mote_position(9, [0, 40, 0], t, seed, { kind: 'pollen', gust })
        const dx = Math.abs(x - prev)
        if (dx < 5) L += dx
        prev = x
      }
      return L
    }
    expect(path(GUST_MAX), 'a strong gust sweeps a longer horizontal path than a weak one').toBeGreaterThan(
      path(GUST_MIN)
    )
  })

  test('an unknown kind is IGNORED by the pure motion (falls back to the ambient field)', () => {
    // mote_position is defensive: an unknown kind resolves to null ⇒ ambient path (create_particles throws).
    const seed = particle_seed(3)
    const p = mote_position(3, cam, 2.5, seed, { kind: 'nonesuch' })
    for (const c of p) expect(Number.isFinite(c)).toBe(true)
  })
})

// ── S-AMBIENCE: round-sprite radial falloff (THE TORMENTOR fix) ───────────────────────────────────
// sprite_falloff is the pure shape contract the material's colorNode mirrors op-for-op: a soft ROUND dust
// dot (opaque centre, transparent corners) — so no hard-edged translucent squares accumulate into
// concentric arc-shells or a huge low-res circle. The GPU render is proven by the gauntlet bench.
describe('sprite_falloff — round soft-sprite alpha (kills the square read)', () => {
  test('opaque at the quad centre, fully transparent at the corners', () => {
    expect(sprite_falloff(0.5, 0.5)).toBeCloseTo(1, 6) // centre = full alpha
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ])
      expect(sprite_falloff(u, v), `corner (${u},${v}) is cropped`).toBeLessThan(SPRITE_ALPHA_EPS) // corners vanish
  })

  test('every UV alpha is in [0,1] and the corner crop beats the discard epsilon (no square rim)', () => {
    for (let u = 0; u <= 1.0001; u += 0.1) {
      for (let v = 0; v <= 1.0001; v += 0.1) {
        const a = sprite_falloff(u, v)
        expect(a).toBeGreaterThanOrEqual(0)
        expect(a).toBeLessThanOrEqual(1)
      }
    }
    // the inscribed-circle edge (radius 0.5 ⇒ mid-edge of the quad) already sits at ~0 — corners are further out.
    expect(sprite_falloff(1, 0.5)).toBeLessThan(SPRITE_ALPHA_EPS)
    expect(sprite_falloff(0.5, 0)).toBeLessThan(SPRITE_ALPHA_EPS)
  })

  test('monotonically non-increasing outward from the centre (a smooth dot, no interior ring)', () => {
    let prev = sprite_falloff(0.5, 0.5)
    // walk radially out along +u from the centre; alpha must never rise (a rise = a rim/ring artifact).
    for (let r = 0; r <= 0.5; r += 0.02) {
      const a = sprite_falloff(0.5 + r, 0.5)
      expect(a).toBeLessThanOrEqual(prev + 1e-9)
      prev = a
    }
  })
})
