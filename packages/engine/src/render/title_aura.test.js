// TR-5 — veteran-title aura LAYOUT unit tests (the pure ring placement the flame shader rides on). The
// TSL flame material + camera billboard are GPU/screenshot-verified (own-port + qa frame-grade); here we
// prove the deterministic, bottom-anchored wisp layout: count, feet-anchoring, value ranges, decorrelation.
import { test, expect } from 'bun:test'

import { CHARACTER_HEIGHT } from '../config/world_config.js'

import { aura_quad_layout } from './title_aura.js'

test('aura_quad_layout: yields the requested count', () => {
  expect(aura_quad_layout(5, CHARACTER_HEIGHT)).toHaveLength(5)
  expect(aura_quad_layout(3, CHARACTER_HEIGHT)).toHaveLength(3)
})

test('aura_quad_layout: deterministic (same input → identical output)', () => {
  expect(aura_quad_layout(5, CHARACTER_HEIGHT)).toEqual(aura_quad_layout(5, CHARACTER_HEIGHT))
})

test('aura_quad_layout: wisps ring the body within a sane silhouette + depth spread', () => {
  for (const q of aura_quad_layout(5, CHARACTER_HEIGHT)) {
    expect(Math.abs(q.x)).toBeLessThanOrEqual(0.5 + 1e-6) // within SPREAD_X of centre
    expect(Math.abs(q.z)).toBeLessThanOrEqual(0.22 + 1e-6) // within JITTER_Z depth
    expect(Math.abs(q.yaw)).toBeLessThanOrEqual(0.32 + 1e-6) // within the FAN_YAW fan
  }
})

test('aura_quad_layout: heights scale ~1.2-1.6× the avatar (ref), widths sane', () => {
  for (const q of aura_quad_layout(5, CHARACTER_HEIGHT)) {
    expect(q.h).toBeGreaterThanOrEqual(CHARACTER_HEIGHT * 1.2 - 1e-6)
    expect(q.h).toBeLessThanOrEqual(CHARACTER_HEIGHT * 1.65 + 1e-6)
    expect(q.w).toBeGreaterThan(0.5)
    expect(q.w).toBeLessThan(1.0)
    expect(q.seed).toBeGreaterThanOrEqual(0)
    expect(q.seed).toBeLessThan(1)
  }
})

test('aura_quad_layout: seeds are decorrelated (wisps do not share one noise phase)', () => {
  const seeds = aura_quad_layout(5, CHARACTER_HEIGHT).map((q) => q.seed)
  expect(new Set(seeds.map((s) => s.toFixed(4))).size).toBe(seeds.length)
})
