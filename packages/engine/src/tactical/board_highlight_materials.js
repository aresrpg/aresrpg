// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Tactical highlight GPU/material construction. Semantic channel config lives in board_highlight_style;
// pure mask constants/oracles live in board_highlight_shapes. This module owns their exact TSL mirrors.

import { CanvasTexture, Color, ConeGeometry, DoubleSide } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { Fn, float, max, mix, smoothstep, uniform, uv, vec3, vec4 } from 'three/tsl'

import {
  CORNER_RADIUS,
  EDGE_SOFTNESS,
  ENTITY_ANCHOR_EDGE_OPACITY,
  ENTITY_ANCHOR_EDGE_WIDTH,
  ENTITY_ANCHOR_FILL_OPACITY,
  GRADIENT_REACH,
  RIM_BRIGHT,
  edges_of_mask,
  rounded_rect_gradient,
} from './board_highlight_shapes.js'
import { TRAP_BASE_COLOR, TRAP_COLOR, resolve_highlight_style } from './board_highlight_style.js'

/**
 * The one material path for fight-board overlays. This matches the engine's materialization-floor and
 * mana-barrier idiom: MeshBasicNodeMaterial supplies authored color directly, while fog and tone mapping are
 * explicitly excluded so scene lighting/day-night cannot alter the semantic paint.
 * @param {any} [parameters]
 */
export function make_unlit_overlay_material(parameters) {
  const mat = new MeshBasicNodeMaterial(parameters)
  mat.toneMapped = false
  mat.fog = false
  return mat
}

/**
 * Build one unlit gradient/rounded material for a semantic channel. [#164] `edges` is the TSL mirror of
 * merged_rect_gradient (board_highlight_shapes.js): four STATIC per-material booleans (baked as
 * constants at graph-build time, not a runtime uniform — a merge-aware channel pre-builds up to 16
 * variants, one per neighbor-mask combination, see board_highlights.js's mat_of) marking which UV-space
 * sides of THIS tile touch a same-channel neighbor. `select()` still has to pick per-FRAGMENT which of
 * a side's two static flags (u0 vs u1, v0 vs v1) applies, since that depends on which half of the tile
 * (u/v ≷ 0.5) the fragment is in — omitted (default `{}`) reproduces the original single-tile shader
 * exactly (every flag folds to 0), so every non-merging channel is byte-identical to before this change.
 * `shared_u_fade` lets a merge-aware channel's 16 material variants ramp ONE fade envelope together
 * instead of each owning its own (the channel fade tick only ever drives one uniform per channel).
 * @param {{ color: number, opacity: number, border?: boolean, unlit_gain?: number,
 *   center_dim?: number, center_alpha?: number }} spec
 * @param {{ u0?: boolean, u1?: boolean, v0?: boolean, v1?: boolean }} [edges]
 * @param {*} [shared_u_fade]
 */
export function make_gradient_tile_material(spec, edges = {}, shared_u_fade = null) {
  const mat = make_unlit_overlay_material()
  mat.transparent = true
  mat.depthWrite = false
  mat.side = DoubleSide
  // A UI overlay: immune to scene lighting/day-night. Unlit (MeshBasicNodeMaterial), fog-exempt (three
  // mixes scene.fogNode into ANY material whose .fog is true, so at night the dark aerial fog would drain
  // the color), and tone-map-exempt. The engine's shared whole-scene AgX post still applies.
  const u_fade = shared_u_fade ?? uniform(1)
  const { unlit_gain, center_dim, center_alpha } = resolve_highlight_style(spec)
  const base = new Color(spec.color)
  const base_rgb = vec3(base.r, base.g, base.b)
  const rim_rgb = unlit_gain === 1 ? base_rgb : base_rgb.mul(float(unlit_gain))
  const { u0 = false, u1 = false, v0 = false, v1 = false } = edges

  mat.colorNode = /** @type {any} */ (
    Fn(() => {
      const p = uv()
      const su = p.x.sub(0.5) // signed — sign picks which static edge flag applies per-fragment
      const sv = p.y.sub(0.5)
      const u_merged = su.greaterThanEqual(float(0)).select(float(u1 ? 1 : 0), float(u0 ? 1 : 0))
      const v_merged = sv.greaterThanEqual(float(0)).select(float(v1 ? 1 : 0), float(v0 ? 1 : 0))
      const px = float(1).sub(u_merged).mul(su.abs()) // merged side ⇒ 0 (no edge/corner contribution)
      const py = float(1).sub(v_merged).mul(sv.abs())
      const half = float(0.5)
      const qx = px.sub(half.sub(CORNER_RADIUS))
      const qy = py.sub(half.sub(CORNER_RADIUS))
      const ox = max(qx, float(0))
      const oy = max(qy, float(0))
      const d = ox.mul(ox).add(oy.mul(oy)).sqrt().sub(CORNER_RADIUS)
      const coverage = smoothstep(float(0), float(-EDGE_SOFTNESS), d)
      const rim_t = max(px, py).div(half)
      const edge_band = smoothstep(float(1 - GRADIENT_REACH), float(1), rim_t)
      const grad = RIM_BRIGHT ? edge_band : float(1).sub(edge_band)
      const is_border = spec.border === true
      const rgb = is_border ? rim_rgb : rim_rgb.mul(mix(float(center_dim), float(1), grad))
      const alpha_profile = is_border ? grad : mix(float(center_alpha), float(1), grad)
      const alpha = float(spec.opacity).mul(alpha_profile).mul(coverage).mul(u_fade)
      return vec4(/** @type {any} */ (rgb), alpha)
    })()
  )
  return { mat, u_fade }
}

/**
 * [#164] Build a MERGE-AWARE channel's material system: ONE shared fade uniform (the channel fade tick
 * drives exactly one envelope, never per-variant) + a lazy cache of ≤16 material variants (one per
 * neighbor mask 0..15), built on first use via make_gradient_tile_material(spec, edges, shared u_fade).
 * `mat` is a disposal-only duck-typed stand-in (board_highlights.js's channel dispose just calls
 * `ch.mat.dispose()`) — there is no single "the" material for a merge-aware channel, only the cache.
 * @param {*} spec
 * @returns {{ mat_of: (mask: number) => import('three/webgpu').MeshBasicNodeMaterial, u_fade: *, mat: { dispose(): void } }}
 */
export function make_merge_aware_channel(spec) {
  const u_fade = uniform(1)
  const cache = new Map()
  const mat_of = (/** @type {number} */ mask) => {
    let entry = cache.get(mask)
    if (!entry) {
      entry = make_gradient_tile_material(spec, edges_of_mask(mask), u_fade)
      cache.set(mask, entry)
    }
    return entry.mat
  }
  return {
    mat_of,
    u_fade,
    mat: {
      dispose() {
        for (const { mat } of cache.values()) mat.dispose()
      },
    },
  }
}

/** Build one team-colored, unlit entity-anchor material. */
export function make_entity_anchor_material(/** @type {number} */ color_int) {
  const mat = make_unlit_overlay_material()
  mat.transparent = true
  mat.depthWrite = false
  mat.side = DoubleSide
  const base = new Color(color_int)
  mat.color = base
  const rgb = vec3(base.r, base.g, base.b)
  mat.colorNode = /** @type {any} */ (
    Fn(() => {
      const p = uv()
      const px = p.x.sub(0.5).abs()
      const py = p.y.sub(0.5).abs()
      const half = float(0.5)
      const qx = px.sub(half.sub(CORNER_RADIUS))
      const qy = py.sub(half.sub(CORNER_RADIUS))
      const ox = max(qx, float(0))
      const oy = max(qy, float(0))
      const d = ox.mul(ox).add(oy.mul(oy)).sqrt().sub(CORNER_RADIUS)
      const fill = smoothstep(float(0), float(-EDGE_SOFTNESS), d).mul(ENTITY_ANCHOR_FILL_OPACITY)
      const edge = float(1)
        .sub(smoothstep(float(0), float(ENTITY_ANCHOR_EDGE_WIDTH), d.abs()))
        .mul(ENTITY_ANCHOR_EDGE_OPACITY)
      return vec4(rgb, max(fill, edge))
    })()
  )
  return mat
}

/** Build the selection-diamond frame material. */
export function make_outline_material(
  /** @type {{ color: number, opacity: number }} */ spec,
  /** @type {CanvasTexture | null} */ tex
) {
  const mat = make_unlit_overlay_material()
  mat.transparent = true
  mat.depthWrite = false
  mat.side = DoubleSide
  mat.color = new Color(spec.color)
  mat.opacity = spec.opacity
  if (tex) mat.map = tex
  return mat
}

/** Draw the hollow selection-diamond texture; null under headless tests. */
export function make_diamond_texture() {
  if (typeof document === 'undefined') return null
  const s = 128
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
  const m = s * 0.12
  const mid = s / 2
  ctx.beginPath()
  ctx.moveTo(mid, m)
  ctx.lineTo(s - m, mid)
  ctx.lineTo(mid, s - m)
  ctx.lineTo(m, mid)
  ctx.closePath()
  ctx.lineJoin = 'round'
  ctx.lineWidth = s * 0.08
  ctx.strokeStyle = 'rgba(255,255,255,1)'
  ctx.shadowColor = 'rgba(120,180,255,0.9)'
  ctx.shadowBlur = s * 0.06
  ctx.stroke()
  const t = new CanvasTexture(c)
  t.needsUpdate = true
  return t
}

// [#1043] the BASE is the DARK half of the marker; the identity gold rides the spike above it.
export const TRAP_BLOB_COLOR = TRAP_BASE_COLOR
export const TRAP_BLOB_OPACITY = 0.95

// SPIKE accent dims (× cell_size — the shared cone geometry is sized when board_highlights builds it).
export const TRAP_SPIKE_RADIUS = 0.12
export const TRAP_SPIKE_HEIGHT = 0.42
export const TRAP_SPIKE_COLOR = TRAP_COLOR
const TRAP_SPIKE_SEGMENTS = 6

/** Pure coverage oracle for the trap BASE — it is the shared cell-bounded rounded-rect tile (a dark
 *  highlight, NOT the old organic soft-shadow island), so its coverage IS the wash
 *  mask. Kept as the trap's shape SSOT for the headless shape tests. */
export function trap_blob_alpha(/** @type {number} */ u, /** @type {number} */ v) {
  return rounded_rect_gradient(u, v).coverage
}

/** Build the trap BASE: a cell-bounded DARK highlight in the shared gradient-tile-wash idiom (#1043). Flat
 *  through the middle — center_dim 1 / center_alpha 0.95 — because a dark cell only reads as "punched out of
 *  the paving" if it is solid; the gradient's soft center is what let the old gold fill dissolve into the
 *  sand. Unlit, so noon and midnight get the same hazard. */
export function make_trap_blob_material() {
  return make_gradient_tile_material({
    color: TRAP_BLOB_COLOR,
    opacity: TRAP_BLOB_OPACITY,
    center_dim: 1,
    center_alpha: 0.95,
  }).mat
}

/** Build the shared upright SPIKE geometry (a small cone) — base seated on the tile plane (translated up
 *  by height/2), apex rising from the cell center. @param {number} radius @param {number} height */
export function make_trap_spike_geometry(/** @type {number} */ radius, /** @type {number} */ height) {
  const geo = new ConeGeometry(radius, height, TRAP_SPIKE_SEGMENTS)
  geo.translate(0, height / 2, 0)
  return geo
}

/** Build the semantic-gold unlit SPIKE material — a night-immune UI overlay (fog + tone-map exempt), like
 *  the rest of the highlight family. */
export function make_trap_spike_material() {
  const mat = make_unlit_overlay_material()
  mat.transparent = true
  mat.depthWrite = false
  mat.side = DoubleSide
  mat.color = new Color(TRAP_SPIKE_COLOR)
  return mat
}
