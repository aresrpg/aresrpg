// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// UNDERWATER IMMERSION (ported from deprecated/engine underwater.js). Light that reaches the
// camera through water is absorbed chromatically (red dies first), picks up the water's own
// in-scattered colour — cyan looking UP toward the surface, navy looking DOWN — and the frame
// dims with the eye's depth; a submerged eye also gets the classic time-driven refraction
// wobble. It composes in linear HDR before tone mapping, so the blue keeps its depth range.
//
// The tint is PER-PIXEL: it keys on how far each view ray runs below the sea plane, so a
// waterline view tints exactly its submerged half and a dry frame is untouched arithmetically.
// Only the screen warp and the droplet exit edge need the CPU's whole-eye state (the hysteresis
// fn below, which kills waterline flicker); low quality drops the warp (amp forced 0).

import { cos, exp, float, max, min, mix, sin, uniform, vec2, vec3 } from 'three/tsl'
import type { Node } from 'three/webgpu'

import type { EngineQuality } from './types.ts'
import type { LiquidPalette } from './liquid_palette.ts'

/** Tuning knobs — the legacy owner-graded calibration, verbatim. Colours are LINEAR (the pass
 * runs pre-AgX); distances in blocks (1 voxel = 1 m). */
export const UNDERWATER = Object.freeze({
  /** Hysteresis half-band (blocks): submerge this far below the surface plane, surface this far
   * above it — a dead-band across the waterline kills per-frame flicker. */
  hysteresis_m: 0.1,
  /** In-scatter visibility (blocks) — view depth at which the water's own colour is ~63% of
   * what a surface returns. */
  visibility_m: 7,
  /** Per-channel absorption (1/blocks) over the LIGHT PATH (eye depth + view depth): red dies
   * first, blue survives. This — not a darken — is what makes depth read as blue: the frame's
   * auto-exposure grade restores any value we remove, but it cannot restore a hue (owner
   * 2026-08-15: "real blue depth"). */
  absorption: [0.3, 0.1, 0.045],
  /** Strength of the up/down view-ray re-tint of the fog target. */
  vertical_gradient: 0.85,
  /** Depth (blocks below the surface) at which the depth-darkening reaches its floor. */
  darken_depth_m: 22,
  /** The darkening floor — the frame never dims below this fraction, so the bed stays legible. */
  darken_floor: 0.5,
  /** Distortion UV amplitude (screen fraction) — the gentle refraction wobble. Zeroed on low. */
  warp_amp: 0.005,
  /** Two-axis warp spatial frequencies — different per axis so the wobble never reads as one
   * sloshing plane. */
  warp_freq: [11.0, 9.0],
  /** Two-axis warp temporal speeds — slow, so it undulates rather than shimmers. */
  warp_speed: [0.7, 0.9],
})

/** PURE hysteresis for the eye's submerged flag: once submerged you stay until the eye rises
 * `half_band` above the surface, and vice-versa; the dead-band holds the previous state.
 * `surface_y = null` (no water over the eye) is a hard exit — leaving the water column
 * sideways must never latch. */
export const is_submerged = (
  eye_y: number,
  surface_y: number | null,
  was_submerged: boolean,
  half_band = UNDERWATER.hysteresis_m
): boolean => {
  if (surface_y == null || !Number.isFinite(surface_y)) return false
  const below = surface_y - eye_y
  return below >= half_band ? true : below <= -half_band ? false : was_submerged
}

/** The scene camera as post-pass nodes — see `create_scene_view` in frame_renderer.ts for why
 * the ambient camera accessors cannot be used inside a post graph. */
export type SceneView = Readonly<{ ray: Node<'vec3'>; eye_y: Node<'float'> }>

export type UnderwaterPass = Readonly<{
  /** Wraps the scene-sample uv with the gated time-driven wobble; identity when dry. */
  warp_uv: (uv_node: Node<'vec2'>) => Node<'vec2'>
  /** Composites the immersion over the HDR colour before display mapping. `frag_dist` = per-pixel
   * scene distance (blocks); `view` = the SCENE camera's eye height and per-pixel world ray —
   * together they say how much water this pixel's light crossed. Pixels with no water in front
   * of them come out unchanged. */
  apply: (col: Node<'vec3'>, frag_dist: Node<'float'>, view: SceneView) => Node<'vec3'>
  /** Per-frame CPU push of the eye's hysteresis state + a clock tick. Only the screen warp and
   * the droplet exit edge need it — the tint is per-pixel and needs no flag. */
  update: (state: Readonly<{ submerged: boolean; dt: number }>) => void
  /** True for the one update() call in which the eye crossed below→above — the lens-water
   * droplet trigger's edge (droplets on EXIT only, never on entry). */
  just_exited: () => boolean
}>

export const create_underwater_pass = ({
  quality,
  water_gate,
  water_level,
  palette,
}: Readonly<{
  quality: EngineQuality
  water_gate: Node<'float'>
  water_level: Node<'float'>
  palette: LiquidPalette
}>): UnderwaterPass => {
  const u_active = uniform(0)
  const u_time = uniform(0)
  // Live uniform gated to 0 on low (tint-only tier) — the single graph serves every tier.
  const u_warp_amp = uniform(quality === 'low' ? 0 : UNDERWATER.warp_amp)

  const fog_color = vec3(...palette.body)
  const up_color = vec3(...palette.up)
  const down_color = vec3(...palette.down)
  const f = vec2(...UNDERWATER.warp_freq)
  const s = vec2(...UNDERWATER.warp_speed)

  const warp_uv: UnderwaterPass['warp_uv'] = (uv_node) => {
    // uv += vec2(sin(uv.y·f1 + t·s1), cos(uv.x·f2 + t·s2)) · amp; amp is exactly 0 when dry or
    // on low, so the graph flips by uniform, never by recompile.
    const amp = u_active.mul(u_warp_amp)
    const wob = vec2(sin(uv_node.y.mul(f.x).add(u_time.mul(s.x))), cos(uv_node.x.mul(f.y).add(u_time.mul(s.y)))).mul(
      amp
    )
    return uv_node.add(wob) as unknown as Node<'vec2'>
  }

  const apply: UnderwaterPass['apply'] = (col, frag_dist, { ray: ray_dir, eye_y }) => {
    // Vertical gradient: lean the fog target from navy (down) to cyan (up) by the view ray's y.
    const up_t = ray_dir.y.mul(0.5).add(0.5).clamp(0, 1)
    const grad = mix(down_color, up_color, up_t)
    const target = mix(fog_color, grad, float(UNDERWATER.vertical_gradient))
    // PER-PIXEL WATER PATH — the immersion is not a whole-frame flag: this pixel's view ray
    // runs from the eye to its fragment, and the part of that segment BELOW the sea plane is
    // the water it crossed. Standing at the waterline therefore tints exactly the submerged
    // half of the frame, and wading in fades the tint up continuously (owner 2026-08-15: "I
    // see half underwater before the effect kicks in"). Terrain below the sea plane is water
    // by construction in this generator, so the plane alone answers "is there water here".
    const frag_y = eye_y.add(ray_dir.y.mul(frag_dist))
    const submerged_fraction = water_level
      .sub(min(eye_y, frag_y))
      .div(max(eye_y.sub(frag_y).abs(), float(1e-4)))
      .clamp(0, 1)
    const through_water = frag_dist.mul(submerged_fraction)
    // Add the vertical column ABOVE the fragment: the light that lit it came down through the
    // water first, so a deep bed is dim and blue even when the eye is a metre away.
    const path = through_water.add(max(water_level.sub(frag_y), float(0))).mul(water_gate)
    const absorb = vec3(
      exp(path.mul(-UNDERWATER.absorption[0]!)),
      exp(path.mul(-UNDERWATER.absorption[1]!)),
      exp(path.mul(-UNDERWATER.absorption[2]!))
    )
    const inscatter = float(1).sub(exp(path.div(float(UNDERWATER.visibility_m)).negate()))
    // Depth darken: the frame dims with the EYE's depth, floored so the bed stays legible.
    const eye_depth = max(water_level.sub(eye_y), float(0)).mul(water_gate)
    const darken = float(1).sub(
      eye_depth
        .div(float(UNDERWATER.darken_depth_m))
        .clamp(0, 1)
        .mul(1 - UNDERWATER.darken_floor)
    )
    return col.mul(absorb).add(target.mul(inscatter)).mul(darken) as unknown as Node<'vec3'>
  }

  // Lens-water trigger: latched by update(), polled via just_exited(). Starts false — a camera
  // that boots already submerged is an entry, never a false exit.
  let exited_this_call = false
  let active = false

  const update: UnderwaterPass['update'] = ({ submerged, dt }) => {
    exited_this_call = active && !submerged
    active = submerged
    u_active.value = submerged ? 1 : 0
    // Advance the warp clock only while submerged — re-entry starts from a settled wobble.
    if (submerged && Number.isFinite(dt)) u_time.value += dt
  }

  return Object.freeze({ warp_uv, apply, update, just_exited: () => exited_this_call })
}
