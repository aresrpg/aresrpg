// ENG-13 UNDERWATER IMMERSION (target: "underwater should feel blue and distorded on the camera") —
// 2026-07-03. When the camera EYE is inside a water voxel the frame gets (a) a blue-green depth-graded
// fog toward a deep-water colour, (b) a vertical brightness gradient (cyan looking UP toward the
// surface, navy looking DOWN), (c) a subtle darken with camera depth below the surface, and (d) a
// gentle time-driven UV wobble on the scene sample — the classic underwater refraction.
//
// ARCHITECTURE (post_stack integration): this is NOT an `output_effect` (those wrap the FINAL display-
// space frame AFTER AgX). The brief mandates the blue fog compose in LINEAR HDR, BEFORE bloom, so it
// blooms naturally — so post_stack weaves this pass INTO build_output between froxels/godrays and the
// bloom block. Two woven hooks, both uniform-driven so the pipeline stays a SINGLE graph (no recompile
// on the submerge/surface flip — low just runs with amp/tint at their gated values):
//   • warp_uv(uv)  → the (optionally) wobbled uv the SCENE COLOUR is sampled at. Identity when the
//                    warp is off (u_active·u_warp_amp = 0 collapses the mix to uv), so dry frames are
//                    byte-identical bar one dependent texture read.
//   • apply(col, frag_dist, ray_dir) → the blue immersion composited over the (cloud/fog/godray) HDR
//                    colour. Reads the SCENE DEPTH-derived `frag_dist` (the same handle the froxels /
//                    motion-blur reconstruct from) for the exponential depth fog, and `ray_dir.y` for
//                    the up/down gradient. Multiplied by `u_active` so it vanishes cleanly when dry.
//
// DETECTION lives on the CPU (engine.js frame loop, which owns the resident chunk store): one bounded
// upward column walk per frame from the eye cell resolves the water column's SURFACE plane, feeding
// the pure hysteresis fn below. The pass never samples blocks itself — it just consumes the state.
//
// TIER GATE: low = tint/fog only, NO warp (amp forced to 0). Every other tier gets the full effect.
// Below-low has no atmosphere at all (renderer degrades), so this module isn't constructed there.

import { exp, float, mix, sin, cos, uniform, vec2, vec3 } from 'three/tsl'
// Note: `warp_uv` receives the node build's `uv()` as a param (post_stack passes it), so `uv` itself
// is not imported here — the caller owns the uv node so this module never binds the wrong one.

import { TIER_ORDER } from '../../core/quality/tiers.js'
import { WATER_BODY_COLOR } from '../water_material.js'

/**
 * UNDERWATER tuning knobs — exported so the acceptance spec + live-tuning from the console
 * (renderer exposes the handle's uniforms on `window.__underwater`). Colours are LINEAR (the pass runs
 * pre-AgX). Distances are in blocks/metres (1 voxel = 1 m).
 */
export const UNDERWATER = Object.freeze({
  /** Hysteresis half-band (blocks): submerge when the eye is this far BELOW the surface plane, surface
   *  when this far ABOVE it. A dead-band across the waterline kills the per-frame flicker as the eye
   *  grazes y == surface (target: "clean waterline crossing, no flicker"). */
  hysteresis_m: 0.1,
  /** Deep-water fog target colour (linear). Reuses water_material's WATER_BODY_COLOR family for
   *  coherence with what the surface itself tends toward — the frame fogs to the SAME dark teal-blue
   *  the water body reads as from above, so crossing the surface is continuous in hue. */
  fog_color: WATER_BODY_COLOR,
  /** Brighter cyan the fog leans toward when looking UP (sun through the surface). */
  up_color: [0.09, 0.3, 0.42],
  /** Darker navy the fog leans toward when looking DOWN (toward the unlit bed). */
  down_color: [0.01, 0.05, 0.11],
  /** Fog visibility (blocks) — the view depth at which the scene is ~63% fogged (exp(-d/vis)). ~15
   *  blocks: readable murk, not pea soup. The brief's 12-18 band. */
  visibility_m: 15,
  /** How strongly the up/down view-ray gradient re-tints the fog target (0 = flat body colour, 1 =
   *  full up_color↔down_color swing). Keyed on ray_dir.y ∈ [-1,1]. */
  vertical_gradient: 0.85,
  /** Depth (blocks below the surface) at which the extra depth-darkening reaches its floor. */
  darken_depth_m: 22,
  /** The darkening FLOOR — the frame never dims below this fraction however deep you go (brief: ~0.5).
   *  Deeper ⇒ dimmer, clamped here so the bed stays legible. */
  darken_floor: 0.5,
  /** Distortion UV amplitude in NDC (screen fraction). ~0.005 = the classic gentle refraction wobble
   *  at 1440p (brief: 0.004-0.006). Zeroed on low. */
  warp_amp: 0.005,
  /** Two-axis warp spatial frequencies (uv cycles across the frame) — different per axis so the wobble
   *  doesn't read as a single sloshing plane. */
  warp_freq: [11.0, 9.0],
  /** Two-axis warp temporal speeds (rad/s-ish) — SLOW (brief: 0.6-1.0) so it undulates, not shimmers. */
  warp_speed: [0.7, 0.9],
})

/**
 * Resolve the water-column SURFACE plane over an eye position (PURE — takes a `block_at` accessor, so
 * it unit-tests against a fake and never touches the ring directly). Walks UP from the eye cell while
 * the cell is water and returns the world-y of the TOP face of the highest contiguous water cell (=
 * the first air/non-water cell's floor). Returns null when the eye cell itself isn't water — there's
 * no column over the eye, so we're not submerged.
 *
 * Bounded by `max_scan` cells so a pathological deep column (or a bug) can't spin the frame; water
 * columns are shallow (tens of cells), and the cap only matters if you're genuinely that deep, in
 * which case the surface is far above and the exact value past the cap is irrelevant to hysteresis.
 *
 * @param {(x: number, y: number, z: number) => number} block_at world-voxel id accessor (0 = air/unloaded)
 * @param {number} x eye world-x
 * @param {number} eye_y eye world-y
 * @param {number} z eye world-z
 * @param {number} water_id the water block id (block_registry 'water')
 * @param {number} [max_scan] max cells to walk upward (default 128)
 * @returns {number|null} surface plane world-y, or null if the eye is not inside water
 */
export function water_surface_plane(block_at, x, eye_y, z, water_id, max_scan = 128) {
  const eye_cell = Math.floor(eye_y)
  if (block_at(x, eye_cell, z) !== water_id) return null // not in water → no column
  // Walk up until the cell is no longer water; the surface is that cell's FLOOR (= last water top).
  let cy = eye_cell
  for (let i = 0; i < max_scan; i += 1) {
    if (block_at(x, cy + 1, z) !== water_id) return cy + 1 // top face of the highest water cell
    cy += 1
  }
  return cy + 1 // hit the scan cap — treat the cap top as the surface (far above; hysteresis trivially in)
}

/**
 * PURE hysteresis for the submerged flag — unit-tested (underwater.test.js). No flicker at the
 * waterline: once submerged you stay submerged until the eye rises `hysteresis_m` ABOVE the surface,
 * and vice-versa; between the two thresholds the previous state holds.
 *
 * `surface_y` is the world-y of the water column's surface PLANE (top face of the highest contiguous
 * water cell over the eye). When there is NO water over/at the eye, pass `surface_y = null` (or any
 * value with `has_water=false`) and the fn returns not-submerged regardless of the previous state — a
 * hard exit, because leaving the water column entirely (e.g. flying out sideways) must never latch.
 *
 * @param {number} eye_y camera eye world-y
 * @param {number|null} surface_y water surface plane world-y over the eye, or null if no water there
 * @param {boolean} was_submerged previous frame's submerged flag (the hysteresis memory)
 * @param {number} [half_band] hysteresis half-band in blocks (default UNDERWATER.hysteresis_m)
 * @returns {{ submerged: boolean, depth: number }} submerged flag + depth below the surface in blocks
 *   (0 when not submerged / no water).
 */
export function compute_underwater_state(eye_y, surface_y, was_submerged, half_band = UNDERWATER.hysteresis_m) {
  if (surface_y == null || !Number.isFinite(surface_y)) return { submerged: false, depth: 0 }
  const below = surface_y - eye_y // >0 when the eye is under the surface plane
  let submerged
  if (below >= half_band)
    submerged = true // clearly under → in
  else if (below <= -half_band)
    submerged = false // clearly above → out
  else submerged = was_submerged // dead-band → hold (kills waterline flicker)
  return { submerged, depth: submerged ? Math.max(0, below) : 0 }
}

/**
 * @param {import('../../core/quality/tiers.js').TierName} tier
 * @returns {boolean} whether the distortion WARP runs at this tier (everything above low).
 */
export function warp_enabled_for_tier(tier) {
  return TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf('low')
}

/**
 * @typedef {object} UnderwaterPass the post_stack woven-hook handle.
 * @property {(uv_node: *) => *} warp_uv wraps the scene-sample uv with the (gated) time-driven wobble;
 *   identity when inactive. Pass the node build's `uv()`.
 * @property {(col: *, frag_dist: *, ray_dir: *) => *} apply composites the blue immersion over the HDR
 *   colour (call BEFORE bloom). `frag_dist` = per-pixel scene distance (blocks); `ray_dir` = the
 *   normalized world view ray (its `.y` drives the up/down gradient).
 * @property {(state: { submerged: boolean, depth: number, dt: number }) => void} update per-frame CPU
 *   push of the hysteresis result + a clock tick. Drives u_active / u_depth / u_time.
 * @property {*} active `uniform(float)` 0|1 — live submerged flag (also the acceptance A/B off switch).
 * @property {*} time `uniform(float)` — the warp clock (seconds).
 * @property {*} depth `uniform(float)` — current eye depth below the surface (blocks); drives darken.
 * @property {*} warp_amp `uniform(float)` — live warp amplitude knob (0 on low).
 * @property {() => boolean} just_exited true for the ONE `update()` call in which the eye crossed
 *   below→above (submerged 1→0) — the ENG-13.5 lens-water trigger's edge (target: droplets on EXIT only,
 *   never on entry). Reuses the existing `active` hysteresis state, never re-derives water height.
 *   Recomputed every `update()` call (poll it once per frame, right after this pass's own CPU push —
 *   post_stack.js does, immediately after renderer.js's update_underwater forwards this frame's state).
 */

/**
 * Builds the underwater immersion pass (pure node-graph construction; nothing renders until the
 * pipeline does). Wire the returned handle into `create_post_stack({ ..., underwater })`.
 * @param {object} opts
 * @param {import('../../core/quality/tiers.js').TierName} opts.tier quality tier (gates the warp).
 * @returns {UnderwaterPass}
 */
export function create_underwater_pass({ tier }) {
  const u_active = uniform(0) // 0 dry, 1 submerged — CPU-driven each frame
  const u_time = uniform(0)
  const u_depth = uniform(0)
  // Warp amplitude is a live uniform gated to 0 on low (tint-only tier) so the SINGLE graph serves
  // every tier — no per-tier recompile, live A/B still possible, and low pays only the (already
  // conditional) mix that collapses to identity at amp 0.
  const u_warp_amp = uniform(warp_enabled_for_tier(tier) ? UNDERWATER.warp_amp : 0)

  const fog_color = vec3(...UNDERWATER.fog_color)
  const up_color = vec3(...UNDERWATER.up_color)
  const down_color = vec3(...UNDERWATER.down_color)
  const f = vec2(...UNDERWATER.warp_freq)
  const s = vec2(...UNDERWATER.warp_speed)

  /** @type {UnderwaterPass['warp_uv']} */
  const warp_uv = (uv_node) => {
    // Classic refraction warp: uv += vec2(sin(uv.y·f1 + t·s1), cos(uv.x·f2 + t·s2)) · amp. Gated by
    // u_active·u_warp_amp so it's exactly zero (⇒ identity mix) when dry or on low — the graph flips
    // by uniform, never by recompile.
    const amp = u_active.mul(u_warp_amp)
    const wob = vec2(sin(uv_node.y.mul(f.x).add(u_time.mul(s.x))), cos(uv_node.x.mul(f.y).add(u_time.mul(s.y)))).mul(
      amp
    )
    return uv_node.add(wob)
  }

  /** @type {UnderwaterPass['apply']} */
  const apply = (col, frag_dist, ray_dir) => {
    // (b) VERTICAL GRADIENT — lean the fog target from navy (down) to cyan (up) by the view ray's y
    // (∈[-1,1] → [0,1]). At vertical_gradient 0 this collapses to the flat body colour.
    const up_t = ray_dir.y.mul(0.5).add(0.5).clamp(0, 1)
    const grad = mix(down_color, up_color, up_t)
    const target = mix(fog_color, grad, float(UNDERWATER.vertical_gradient))

    // (a) DEPTH-GRADED FOG — exponential in view depth toward `target`. exp(-dist/vis): near surfaces
    // read through, far ones dissolve into the water colour by ~visibility_m blocks.
    const fog = float(1).sub(exp(frag_dist.div(float(UNDERWATER.visibility_m)).negate()))
    let out = mix(col, target, fog)

    // (c) DEPTH DARKEN — the whole frame dims with the EYE's depth below the surface, floored so the bed
    // stays legible. Linear ramp 0→darken_depth_m mapped to 1→darken_floor.
    const darken = float(1).sub(
      u_depth
        .div(float(UNDERWATER.darken_depth_m))
        .clamp(0, 1)
        .mul(1 - UNDERWATER.darken_floor)
    )
    out = out.mul(darken)

    // Blend the whole immersion in/out by the submerged flag — dry ⇒ u_active 0 ⇒ col unchanged.
    return mix(col, out, u_active)
  }

  // ENG-13.5 lens-water trigger: latched by update() below, polled via just_exited(). Starts false — a
  // camera that boots already submerged is an ENTRY (or a no-op), never a false exit.
  let exited_this_call = false

  /** @type {UnderwaterPass['update']} */
  const update = ({ submerged, depth, dt }) => {
    // The exit edge: WAS submerged (this pass's own active flag, about to be overwritten below) and now
    // isn't. Computed BEFORE the reassignment so it reads the state from the frame just ending.
    exited_this_call = u_active.value === 1 && !submerged
    u_active.value = submerged ? 1 : 0
    u_depth.value = depth
    // Advance the warp clock only while submerged (and always finite) — a dry camera doesn't accumulate
    // phase, so re-entry starts from a settled wobble rather than a huge t.
    if (submerged && Number.isFinite(dt)) u_time.value += dt
  }

  return {
    warp_uv,
    apply,
    update,
    active: u_active,
    time: u_time,
    depth: u_depth,
    warp_amp: u_warp_amp,
    just_exited: () => exited_this_call,
  }
}
