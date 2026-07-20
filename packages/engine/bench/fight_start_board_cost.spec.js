// FIGHT-START board-build CPU cost probe (freeze trace). Times build_board_geometry
// (slab bake + slab geo + materials + fill loop) at realistic fight-board sizes to decide whether the
// fight-start hitch is the CPU board construction (amortizable) or elsewhere (GPU pipeline compiles).
// Headless: build_board_geometry is pure THREE object construction (DataTexture pixel fill, no GL).
import { test, expect } from 'bun:test'

import { build_board_geometry } from '../src/tactical/board.js'
import {
  bake_board_surface,
  bake_board_surface_gen,
  build_slab_geometry,
  SURFACE_BAND_ROWS,
} from '../src/tactical/board_surface.js'

/** Full rectangular mask (all walkable) with a scatter of obstacles/holes — worst-case fill work. */
function make_mask(w, h) {
  const mask = new Uint8Array(w * h)
  for (let i = 0; i < mask.length; i += 1) {
    if (i % 17 === 0)
      mask[i] = 1 // obstacle
    else if (i % 29 === 0)
      mask[i] = 2 // hole
    else mask[i] = 0
  }
  return mask
}

function time_build(w, h, iters = 20) {
  const origin = { x: 0, y: 64, z: 0 }
  const mask = make_mask(w, h)
  // warm once (JIT + first alloc), then time the steady state
  build_board_geometry({ origin, width: w, height: h, mask, cell_size: 1.33 }).dispose()
  const samples = []
  for (let n = 0; n < iters; n += 1) {
    const t0 = performance.now()
    const g = build_board_geometry({ origin, width: w, height: h, mask, cell_size: 1.33 })
    samples.push(performance.now() - t0)
    g.dispose()
  }
  samples.sort((a, b) => a - b)
  return { median: samples[samples.length >> 1], max: samples[samples.length - 1], min: samples[0] }
}

/** Median wall-ms of `fn` over `iters`, one warm-up first. */
function med(fn, iters = 20) {
  fn()
  const s = []
  for (let n = 0; n < iters; n += 1) {
    const t0 = performance.now()
    const r = fn()
    s.push(performance.now() - t0)
    r?.dispose?.()
  }
  s.sort((a, b) => a - b)
  return s[s.length >> 1]
}

test('board build CPU cost at realistic fight sizes', () => {
  for (const [w, h] of [
    [11, 11],
    [13, 13],
    [15, 15],
    [20, 19],
  ]) {
    const r = time_build(w, h)
    console.log(`[board-build] ${w}x${h} (${w * h} cells): median=${r.median.toFixed(2)}ms max=${r.max.toFixed(2)}ms`)
  }
  expect(true).toBe(true)
})

test('AMORTIZATION: sliced bake caps per-frame cost + is byte-identical', () => {
  for (const [w, h] of [
    [13, 13],
    [15, 15],
    [20, 19],
  ]) {
    const mask = make_mask(w, h)
    // BEFORE — the monolithic synchronous bake (one frame swallows the whole thing).
    const before = med(() => bake_board_surface({ mask, width: w, height: h }))
    // AFTER — drive the generator in ≤7ms frame slices (mirrors board.build()'s pump budget) and record
    // the WORST single-frame cost + how many frames the fill spreads over.
    const FRAME_BUDGET = 7
    const gen = bake_board_surface_gen({ mask, width: w, height: h }, SURFACE_BAND_ROWS)
    gen.next() // the blank texture handle (mount frame — negligible)
    let worst_frame = 0
    let frames = 0
    for (;;) {
      const t0 = performance.now()
      let done = false
      do {
        done = Boolean(gen.next().done)
      } while (!done && performance.now() - t0 < FRAME_BUDGET)
      worst_frame = Math.max(worst_frame, performance.now() - t0)
      frames += 1
      if (done) break
    }
    // byte-identity: a fully-drained sliced bake must equal the synchronous bake, texel-for-texel.
    const sync_tex = bake_board_surface({ mask, width: w, height: h })
    const g2 = bake_board_surface_gen({ mask, width: w, height: h }, SURFACE_BAND_ROWS)
    const sliced_tex = g2.next().value
    while (!g2.next().done) {
      /* drain the generator to completion before the byte-identity compare below */
    }
    const a = sync_tex.image.data
    const b = sliced_tex.image.data
    let identical = a.length === b.length
    for (let i = 0; identical && i < a.length; i += 1) if (a[i] !== b[i]) identical = false
    console.log(
      `[amortize] ${w}x${h}: before=${before.toFixed(1)}ms(1 frame) → after worst_frame=${worst_frame.toFixed(1)}ms over ${frames} frames | byte_identical=${identical}`
    )
    expect(identical).toBe(true)
    expect(worst_frame).toBeLessThan(before) // the worst sliced frame must beat the monolithic hitch
  }
})

test('board build PHASE breakdown', () => {
  const origin = { x: 0, y: 64, z: 0 }
  for (const [w, h] of [
    [13, 13],
    [15, 15],
    [20, 19],
  ]) {
    const mask = make_mask(w, h)
    const relief_at = () => 0
    const bake = med(() => bake_board_surface({ mask, width: w, height: h }))
    const slab = med(() =>
      build_slab_geometry({ mask, width: w, height: h, cell_size: 1.33, origin, relief_at, thickness: 0.3 })
    )
    const full = med(() => build_board_geometry({ origin, width: w, height: h, mask, cell_size: 1.33 }))
    console.log(
      `[phase] ${w}x${h}: bake_surface=${bake.toFixed(2)}ms slab_geo=${slab.toFixed(2)}ms rest=${(full - bake - slab).toFixed(2)}ms full=${full.toFixed(2)}ms`
    )
  }
  expect(true).toBe(true)
})
