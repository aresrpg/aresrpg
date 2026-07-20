// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DEGENERATE-RENDER FLOOR — unit calibration of the pure verdict in bench/degenerate_render.js.
// Failure class (proven live): the naga-127 silent-compile-death — the fragment pipeline stops
// drawing (blank / flat / single-color canvas) while collision and every data oracle stay green.
// The floor must exit NONZERO on that degenerate trio and 0 on every legitimate scene class.
// Fixtures are deterministic (seeded LCG) so the thresholds are calibrated against stable inputs;
// real-capture calibration (headed Metal frames) is recorded in the lane report, not here.

import { describe, expect, test } from 'bun:test'

import { RENDER_FLOOR, degenerate_render_verdict } from './degenerate_render.js'

const lcg = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 2 ** 32)

/** @param {number} width @param {number} height @param {(x: number, y: number) => [number, number, number, number]} texel */
function rgba_buffer(width, height, texel) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = texel(x, y)
      const i = (y * width + x) * 4
      pixels[i] = r
      pixels[i + 1] = g
      pixels[i + 2] = b
      pixels[i + 3] = a
    }
  }
  return pixels
}

const SIZE = { width: 128, height: 96 }

// ── The degenerate trio ───────────────────────────────────────────────────────────────────────────
// Never-presented canvas: every texel transparent.
const blank = () => rgba_buffer(SIZE.width, SIZE.height, () => [0, 0, 0, 0])
// Clear-color-only frame (the naga-death look): one opaque navy everywhere.
const solid = () => rgba_buffer(SIZE.width, SIZE.height, () => [30, 42, 58, 255])
// Flat + sensor jitter: one color with deterministic ±2 LSB noise — still no scene.
const near_flat = () => {
  const rand = lcg(7)
  return rgba_buffer(SIZE.width, SIZE.height, () => {
    const jitter = () => Math.round((rand() - 0.5) * 4)
    return [30 + jitter(), 42 + jitter(), 58 + jitter(), 255]
  })
}

// ── Legitimate classes ────────────────────────────────────────────────────────────────────────────
// Pure noise: not a scene, but not the degenerate class either — maximal diversity must pass.
const noise = () => {
  const rand = lcg(1312)
  return rgba_buffer(SIZE.width, SIZE.height, () => [rand() * 256, rand() * 256, rand() * 256, 255])
}
// Moonlit night sky — the corpus-calibrated hard case (sun/after_night.png fingerprint: dominant
// 0.964, entropy 0.34, edge 0.0052): as color-collapsed as a dead frame, saved ONLY by structure
// (moon rim + stars). Near-black everywhere, one bright moon disk, ~50 star specks.
const night_sky = () => {
  const rand = lcg(9)
  const stars = Array.from({ length: 50 }, () => [Math.floor(rand() * SIZE.width), Math.floor(rand() * SIZE.height)])
  return rgba_buffer(SIZE.width, SIZE.height, (x, y) => {
    if (Math.hypot(x - 90, y - 30) < 10) return [230, 230, 220, 255] // moon disk
    if (stars.some(([sx, sy]) => sx === x && sy === y)) return [180, 185, 200, 255]
    return [5, 8, 14, 255]
  })
}

// Synthetic scene: sky gradient over tiled two-tone voxel ground with AO seams and a dark trunk —
// the minimal shape of a real terrain frame (gradient + texture + silhouette edges).
const scene_like = () => {
  const rand = lcg(42)
  const horizon = Math.floor(SIZE.height * 0.4)
  return rgba_buffer(SIZE.width, SIZE.height, (x, y) => {
    if (y < horizon) {
      const t = y / horizon
      return [135 + t * 55, 168 + t * 42, 200 + t * 35, 255]
    }
    if (x >= 96 && x < 102 && y < horizon + 30) return [45, 35, 25, 255] // tree trunk silhouette
    const tile = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0
    const seam = x % 8 === 0 || y % 8 === 0 // AO-dark voxel seams
    const [r, g, b] = tile ? [110, 90, 60] : [90, 120, 55]
    const shade = (seam ? 0.6 : 1) * (1 + (rand() - 0.5) * 0.2)
    return [r * shade, g * shade, b * shade, 255]
  })
}

describe('degenerate_render_verdict — the floor', () => {
  test('RED CLASS: blank (never-presented) buffer exits nonzero with the blank flag', () => {
    const verdict = degenerate_render_verdict(blank(), SIZE)
    expect(verdict.code).not.toBe(0)
    expect(verdict.flags).toContain('blank')
  })

  test('RED CLASS: solid single-color buffer exits nonzero as flat_color', () => {
    const verdict = degenerate_render_verdict(solid(), SIZE)
    expect(verdict.code).not.toBe(0)
    expect(verdict.flags).toContain('flat_color')
    expect(verdict.metrics.edge_density).toBe(0)
  })

  test('RED CLASS: near-flat (±2 LSB jitter) buffer still exits nonzero', () => {
    const verdict = degenerate_render_verdict(near_flat(), SIZE)
    expect(verdict.code).not.toBe(0)
  })

  test('PASS CLASS: pure-noise buffer passes (diversity floor is a floor, not a taste bar)', () => {
    const verdict = degenerate_render_verdict(noise(), SIZE)
    expect(verdict.code).toBe(0)
    expect(verdict.flags).toEqual([])
  })

  test('PASS CLASS: synthetic scene-like buffer passes with headroom on every metric', () => {
    const { code, flags, metrics } = degenerate_render_verdict(scene_like(), SIZE)
    expect(code).toBe(0)
    expect(flags).toEqual([])
    // Headroom (≥2× each threshold) so drift in a legit scene never grazes the floor.
    expect(metrics.entropy_bits).toBeGreaterThan(RENDER_FLOOR.min_entropy_bits * 2)
    expect(metrics.contrast_p95_p5).toBeGreaterThan(RENDER_FLOOR.min_contrast * 2)
    expect(metrics.edge_density).toBeGreaterThan(RENDER_FLOOR.min_edge_density * 2)
  })

  test('PASS CLASS: moonlit night sky — color-collapsed like a dead frame, saved by structure', () => {
    const { code, flags, metrics } = degenerate_render_verdict(night_sky(), SIZE)
    expect(code).toBe(0)
    expect(flags).toEqual([])
    // The regression lock: this fixture MUST sit inside flat_color's color-collapse zone (so only
    // the structure exemption saves it) with ≥2× edge headroom — mirroring the real night corpus.
    expect(metrics.dominant_share).toBeGreaterThan(RENDER_FLOOR.max_dominant_share)
    expect(metrics.entropy_bits).toBeLessThan(RENDER_FLOOR.min_entropy_bits)
    expect(metrics.edge_density).toBeGreaterThan(RENDER_FLOOR.min_edge_density * 2)
  })

  test('metrics order sanely: scene diversity strictly above the degenerate trio', () => {
    const scene = degenerate_render_verdict(scene_like(), SIZE).metrics
    const dead = degenerate_render_verdict(solid(), SIZE).metrics
    expect(scene.entropy_bits).toBeGreaterThan(dead.entropy_bits)
    expect(scene.dominant_share).toBeLessThan(dead.dominant_share)
  })

  test('pure: identical verdict on identical input, input never mutated', () => {
    const pixels = scene_like()
    const before = Uint8ClampedArray.from(pixels)
    const first = degenerate_render_verdict(pixels, SIZE)
    const second = degenerate_render_verdict(pixels, SIZE)
    expect(second).toEqual(first)
    expect(Uint8ClampedArray.from(pixels)).toEqual(before)
  })

  test('refuses a pixel buffer shorter than width×height×4', () => {
    expect(() => degenerate_render_verdict(new Uint8ClampedArray(16), SIZE)).toThrow()
  })
})
