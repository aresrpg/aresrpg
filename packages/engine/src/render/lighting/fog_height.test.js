// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// [2026-07-05 FROXEL REBUILD — PLAN A] fog_height pure/CPU tests: texel↔world mapping, the edge fade
// contract (fades to MEAN at the border — the cloud-edge halo lesson), re-bake hysteresis, and the
// amortized re-bake state machine (scratch fill → atomic swap → crossfade restart). GPU-free.
import { describe, expect, test } from 'bun:test'
import { DataUtils } from 'three'

import {
  HEIGHT_EDGE_BAND,
  HEIGHT_REBAKE_M,
  HEIGHT_SPAN_M,
  HEIGHT_TEX_SIZE,
  create_fog_height,
  edge_fade_t,
  needs_rebake,
  texel_center_world,
} from './fog_height.js'

describe('texel_center_world', () => {
  test('corner + centre texels land at the right world positions', () => {
    const texel = HEIGHT_SPAN_M / HEIGHT_TEX_SIZE
    const [x0, z0] = texel_center_world(0, 0, 0, 0)
    expect(x0).toBeCloseTo(-HEIGHT_SPAN_M / 2 + texel / 2, 9)
    expect(z0).toBeCloseTo(-HEIGHT_SPAN_M / 2 + texel / 2, 9)
    const mid = HEIGHT_TEX_SIZE / 2
    const [xm, zm] = texel_center_world(mid, mid, 100, -50)
    expect(xm).toBeCloseTo(100 + texel / 2, 9)
    expect(zm).toBeCloseTo(-50 + texel / 2, 9)
  })
})

describe('edge_fade_t', () => {
  test('1 deep inside, 0 at/outside the border, smooth in the band', () => {
    expect(edge_fade_t(0.5, 0.5)).toBe(1)
    expect(edge_fade_t(0, 0.5)).toBe(0)
    expect(edge_fade_t(0.5, 1)).toBe(0)
    expect(edge_fade_t(-0.1, 0.5)).toBe(0) // outside → mean handoff
    const half = edge_fade_t(HEIGHT_EDGE_BAND / 2, 0.5)
    expect(half).toBeGreaterThan(0)
    expect(half).toBeLessThan(1)
  })
})

describe('needs_rebake', () => {
  test('fires on either axis at the hysteresis, not inside it', () => {
    expect(needs_rebake(0, 0, 0, 0)).toBe(false)
    expect(needs_rebake(HEIGHT_REBAKE_M - 1, 0, 0, 0)).toBe(false)
    expect(needs_rebake(HEIGHT_REBAKE_M, 0, 0, 0)).toBe(true)
    expect(needs_rebake(0, -HEIGHT_REBAKE_M, 0, 0)).toBe(true)
  })
})

describe('create_fog_height — bake state machine', () => {
  // tiny footprint so the test is instant: 8×8 texels over 64 m, rebake at 16 m, 2 rows/frame.
  const opts = { size: 8, span_m: 64, rebake_m: 16, blend_s: 0.5, rows_per_frame: 2 }

  test('first bake is synchronous and mean matches the height source', () => {
    const fh = create_fog_height({ ...opts, height_at: () => 140 })
    expect(fh.is_baking()).toBe(false)
    expect(fh.u_mean_cur.value).toBeCloseTo(140, 3)
    // texture data holds the half-float encoding of the source height
    expect(DataUtils.fromHalfFloat(/** @type {Uint16Array} */ (fh.cur_tex.image.data)[0])).toBeCloseTo(140, 0)
  })

  test('re-bake: hysteresis starts an AMORTIZED fill, swap adopts the new centre + restarts the crossfade', () => {
    let h = 100
    const fh = create_fog_height({ ...opts, height_at: () => h })
    h = 200 // the world "changes" (new area heights) after the first bake
    const cam = { position: { x: 20, z: 0 } } // beyond the 16 m hysteresis
    fh.update(cam, 0.016)
    expect(fh.is_baking()).toBe(true)
    expect(fh.bake_center()).toEqual([0, 0]) // live centre unchanged while the fill is in flight
    // 8 rows at 2 rows/frame → 3 more updates to complete (first update already stamped 2 rows)
    for (let i = 0; i < 3; i++) fh.update(cam, 0.016)
    expect(fh.is_baking()).toBe(false)
    expect(fh.bake_center()).toEqual([20, 0])
    expect(fh.u_mean_cur.value).toBeCloseTo(200, 2) // fresh footprint sees the new heights
    expect(fh.u_blend.value).toBeLessThan(1) // crossfade restarted
    // blend advances back to 1 with dt
    for (let i = 0; i < 40; i++) fh.update(cam, 0.016)
    expect(fh.u_blend.value).toBe(1)
  })

  test('no re-bake inside the hysteresis', () => {
    const fh = create_fog_height({ ...opts, height_at: () => 1 })
    fh.update({ position: { x: 10, z: 10 } }, 0.016)
    expect(fh.is_baking()).toBe(false)
  })
})
