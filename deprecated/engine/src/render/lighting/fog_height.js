// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// [2026-07-05 FROXEL REBUILD — PLAN A] Camera-following HEIGHT FIELD for the froxel fog's sun occlusion.
//
// ANCESTRY RULING (architect): froxels.js was ported from a demo whose sun coupling was a SMOOTH 2D
// heightfield; the reported static arcs were born when our binary, low-res, camera-boxed, progressively-
// filled voxel-sun DDA volume was injected into that sampler architecture. The open-air fog sun term is
// therefore returned to a heightfield occlusion — smooth in EVERY dimension, so there are no shells for
// the froxel depth slices to alias into arcs, no 10 s fill-in, no recenter jumps: arcs impossible BY
// INPUT, not by damping. The `sample_height(xz)` hook already exists in create_froxels (it defaulted to
// FLAT SEA LEVEL — unwired since the port); this module is the real height source behind it.
//
// MECHANISM — a camera-tracked 128² r16float DataTexture over a 2048 m footprint (16 m/texel; the gen's
// `world_surface_y` is itself a smooth ≤20-blocks/column probe, and the LINEAR filter interpolates), CPU
// -filled from an injected `height_at(x,z)` (the same gen source the far shell draws), re-baked when the
// camera strays REBAKE_M from the bake centre. The footprint machinery deliberately MIRRORS clouds.js's
// shadow footprint (the lessons are paid for): the re-bake fills a SCRATCH buffer a few rows per frame
// (no frame spike), the previous footprint is kept and CROSSFADED toward the fresh one over BLEND_S (no
// pop), and the sample FADES TO THE FOOTPRINT MEAN at the edge — never to a hard constant — so the edge
// can't print a ring into the fog (the cloud-edge "clear-sky halo" bug, not recreated here).
//
// Pure helpers (texel_center_world / edge_fade_t / needs_rebake) are GPU-free for `bun test`.

import { ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, RedFormat, Vector2 } from 'three'
import { float, mix, smoothstep, texture, uniform } from 'three/tsl'

/** texels per footprint side. 128² = 16 384 height probes per bake (amortized). */
export const HEIGHT_TEX_SIZE = 128
/** world footprint span (m) → 16 m/texel; froxel samples reach 480 m, comfortably interior. */
export const HEIGHT_SPAN_M = 2048
/** re-bake hysteresis (m) — the camera stays ≥ 768 m from the footprint edge between bakes. */
export const HEIGHT_REBAKE_M = 256
/** crossfade duration (s) old→new footprint after a re-bake completes (clouds.js u_shadow_blend twin). */
export const HEIGHT_BLEND_S = 0.5
/** fraction of the half-span over which the sample fades to the footprint MEAN at the edge. */
export const HEIGHT_EDGE_BAND = 0.2
/** CPU fill budget: rows stamped per update() while a re-bake is in flight. Measured (Studio, bun):
 *  world_surface_y ≈ 1.5 µs/probe ⇒ 4×128 probes ≈ 0.77 ms/frame for 32 frames (~0.27 s at 120 fps) per
 *  re-bake — bounded main-thread cost, and the 256 m hysteresis means a 12 m/s flight re-bakes every ~21 s. */
export const HEIGHT_ROWS_PER_FRAME = 4

/**
 * World-space centre of texel (i,j) for a footprint centred at (cx,cz). Pure (tests + fill share it).
 * @param {number} i texel column @param {number} j texel row @param {number} cx footprint centre x (m)
 * @param {number} cz footprint centre z (m) @param {number} [size] @param {number} [span]
 * @returns {[number, number]} world [x,z]
 */
export function texel_center_world(i, j, cx, cz, size = HEIGHT_TEX_SIZE, span = HEIGHT_SPAN_M) {
  const texel = span / size
  return [cx - span / 2 + (i + 0.5) * texel, cz - span / 2 + (j + 0.5) * texel]
}

/**
 * Edge-fade factor for a footprint uv: 1 deep inside, smoothstepping to 0 at the border (where the
 * sample must hand off to the footprint MEAN — never a hard default). Pure twin of the TSL expression.
 * @param {number} u @param {number} v uv in [0,1] (outside ⇒ 0) @param {number} [band]
 * @returns {number} [0,1]
 */
export function edge_fade_t(u, v, band = HEIGHT_EDGE_BAND) {
  const b = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v))
  const t = Math.min(1, Math.max(0, b / band))
  return t * t * (3 - 2 * t)
}

/**
 * Re-bake hysteresis: true when the camera has strayed ≥ `rebake_m` from the bake centre on either axis.
 * @param {number} px @param {number} pz camera xz @param {number} cx @param {number} cz bake centre
 * @param {number} [rebake_m] @returns {boolean}
 */
export function needs_rebake(px, pz, cx, cz, rebake_m = HEIGHT_REBAKE_M) {
  return Math.abs(px - cx) >= rebake_m || Math.abs(pz - cz) >= rebake_m
}

/**
 * @typedef {object} FogHeightOptions
 * @property {(x:number, z:number)=>number} height_at CPU ground-height probe (world m) — world_surface_y.
 * @property {number} [size] texels/side, default {@link HEIGHT_TEX_SIZE}.
 * @property {number} [span_m] footprint span, default {@link HEIGHT_SPAN_M}.
 * @property {number} [rebake_m] hysteresis, default {@link HEIGHT_REBAKE_M}.
 * @property {number} [blend_s] crossfade seconds, default {@link HEIGHT_BLEND_S}.
 * @property {number} [rows_per_frame] fill budget, default {@link HEIGHT_ROWS_PER_FRAME}.
 * @property {[number, number]} [center0] initial footprint centre xz (default [0,0]).
 */

/**
 * Build the camera-following fog height field: two r16float DataTextures (current + previous footprint),
 * the TSL `sample_height_at(xz)` node (edge-faded to the mean, crossfaded across re-bakes), and the
 * per-frame `update(camera, dt)` (hysteresis + amortized refill + blend advance). CPU-only (no renderer
 * handle needed — three uploads on `needsUpdate`).
 * @param {FogHeightOptions} opts
 */
export function create_fog_height(opts) {
  const { height_at } = opts
  const size = opts.size ?? HEIGHT_TEX_SIZE
  const span_m = opts.span_m ?? HEIGHT_SPAN_M
  const rebake_m = opts.rebake_m ?? HEIGHT_REBAKE_M
  const blend_s = opts.blend_s ?? HEIGHT_BLEND_S
  const rows_per_frame = opts.rows_per_frame ?? HEIGHT_ROWS_PER_FRAME
  const [c0x, c0z] = opts.center0 ?? [0, 0]

  /** @param {Uint16Array} data */
  const mk_tex = (data) => {
    const t = new DataTexture(data, size, size, RedFormat, HalfFloatType)
    t.minFilter = LinearFilter
    t.magFilter = LinearFilter
    t.wrapS = ClampToEdgeWrapping
    t.wrapT = ClampToEdgeWrapping
    t.generateMipmaps = false
    t.needsUpdate = true
    return t
  }
  const cur_data = new Uint16Array(size * size)
  const prev_data = new Uint16Array(size * size)
  const cur_tex = mk_tex(cur_data)
  const prev_tex = mk_tex(prev_data)

  const u_center_cur = uniform(new Vector2(c0x, c0z))
  const u_center_prev = uniform(new Vector2(c0x, c0z))
  const u_mean_cur = uniform(0)
  const u_mean_prev = uniform(0)
  const u_blend = uniform(1) // 1 = fully on the current footprint

  /** synchronous full fill of `out` for a footprint centred at (cx,cz); returns the mean height. */
  const fill_full = (/** @type {Uint16Array} */ out, /** @type {number} */ cx, /** @type {number} */ cz) => {
    let sum = 0
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const [wx, wz] = texel_center_world(i, j, cx, cz, size, span_m)
        const h = height_at(wx, wz)
        sum += h
        out[j * size + i] = DataUtils.toHalfFloat(h)
      }
    }
    return sum / (size * size)
  }

  // FIRST BAKE — synchronous (boot-time; ~16k cheap probes). Both footprints start identical.
  u_mean_cur.value = fill_full(cur_data, c0x, c0z)
  prev_data.set(cur_data)
  u_mean_prev.value = u_mean_cur.value
  let bake_cx = c0x
  let bake_cz = c0z

  // AMORTIZED RE-BAKE state (voxel_sun's scratch pattern): fill a scratch a few rows per frame; the LIVE
  // textures keep rendering until the fill completes, then prev←cur, cur←scratch, crossfade restarts.
  const scratch = new Uint16Array(size * size)
  let pending = /** @type {{ cx:number, cz:number, row:number, sum:number } | null} */ (null)

  /** TSL: sample ONE footprint — edge-faded toward its mean so the border can never print a ring. */
  const sample_one = (/** @type {*} */ xz, /** @type {*} */ tex, /** @type {*} */ center, /** @type {*} */ mean) => {
    const uv = xz.sub(center).div(span_m).add(0.5)
    const border = uv.x.min(uv.x.oneMinus()).min(uv.y.min(uv.y.oneMinus()))
    const t = smoothstep(float(0), float(HEIGHT_EDGE_BAND), border)
    return mix(mean, texture(tex, uv).r, t)
  }

  /**
   * TSL ground-height node at a world xz — the `sample_height` hook for create_froxels. Crossfades the
   * previous footprint toward the current one so a re-bake dissolves instead of popping.
   * @param {*} xz vec2 world-xz node @returns {*} float height node (m)
   */
  const sample_height_at = (xz) =>
    mix(
      sample_one(xz, prev_tex, u_center_prev, u_mean_prev),
      sample_one(xz, cur_tex, u_center_cur, u_mean_cur),
      u_blend
    )

  /**
   * Per-frame: advance the crossfade, start/step the amortized re-bake when the camera strays.
   * @param {{ position: { x:number, z:number } }} camera @param {number} dt seconds
   */
  const update = (camera, dt) => {
    if (u_blend.value < 1) u_blend.value = Math.min(1, u_blend.value + dt / blend_s)
    if (pending === null && needs_rebake(camera.position.x, camera.position.z, bake_cx, bake_cz, rebake_m)) {
      pending = { cx: camera.position.x, cz: camera.position.z, row: 0, sum: 0 }
    }
    if (pending !== null) {
      const end = Math.min(pending.row + rows_per_frame, size)
      for (; pending.row < end; pending.row++) {
        for (let i = 0; i < size; i++) {
          const [wx, wz] = texel_center_world(i, pending.row, pending.cx, pending.cz, size, span_m)
          const h = height_at(wx, wz)
          pending.sum += h
          scratch[pending.row * size + i] = DataUtils.toHalfFloat(h)
        }
      }
      if (pending.row >= size) {
        // freeze the CURRENT footprint into PREV (the crossfade source), adopt the fresh bake as CUR.
        prev_data.set(cur_data)
        u_center_prev.value.copy(u_center_cur.value)
        u_mean_prev.value = u_mean_cur.value
        prev_tex.needsUpdate = true
        cur_data.set(scratch)
        u_center_cur.value.set(pending.cx, pending.cz)
        u_mean_cur.value = pending.sum / (size * size)
        cur_tex.needsUpdate = true
        bake_cx = pending.cx
        bake_cz = pending.cz
        u_blend.value = 0
        pending = null
      }
    }
  }

  return {
    sample_height_at,
    update,
    // introspection for tests/tuning
    cur_tex,
    prev_tex,
    u_blend,
    u_center_cur,
    u_mean_cur,
    size,
    span_m,
    /** current bake centre (test hook). @returns {[number, number]} */
    bake_center: () => /** @type {[number, number]} */ ([bake_cx, bake_cz]),
    /** whether an amortized re-bake is in flight (test hook). */
    is_baking: () => pending !== null,
  }
}
