// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FLAGSHIP VFX — PACK APPEARANCE LAYER III (phase B2, the FINAL exactness lane): the last REAL BinbunVFX_Vol2
// .gdshader fragments transcribed op-for-op to TSL, extending vfx_pack_shaders.js/2.js past their LoC line. Owner
// mandate 2026-07-12 ("cut EVERY non-Godot effect"): every generic FBM `spark`/cross-pack `star4` borrow the audit
// flagged is replaced by the scene's OWN shader, verified node→shader off disk (scratchpad layermap parser, not the
// audit prose — the ground truth CORRECTED the audit: impact Spikes=impact_core, Flashes/Sparks=impact_slash).
//
//   • StylizedHitFX  → impact_slash (the Flashes streak — every impact/big scene), spiral_dust (the impact_03/05
//     spiral corona GPUParticles3D).
//   • ElementalMagic → area_glow (the water-area Glow_01/Glow_02 vertical energy curtain — the missing bloom layer
//     that rides beside the already-ported area_ground; trap/glyph/eruption/elem-area).
//   • DarkMagic      → dark_ring (the void-area Ring), dark_lift (the void-area rising Lift columns), dark_glow
//     (the void-projectile head Glow), dark_flares (the void-projectile Flares wisps).
//
// METHOD (identical to phase A/B): each function transcribes ONE `.gdshader` `fragment()` onto the camera-facing
// billboard quad — UV 0..1, PACK_NOISE = the pack's NoiseTexture2D, `age` = Godot TIME, `seed` = the per-particle
// COLOR.r roll (INSTANCE_ID phase / hue), `grow` = the per-life 0→1 the Godot COLOR.a / grow_factor / grow_amount
// drove. The vertex() mesh displacement has no billboard analogue, so the fragment IS the port surface; the
// default-uniform terms that the scenes leave at 0/off (edge_hardness on most, stepped_animation, proximity_fade)
// drop out — the DEFAULT scene look is preserved exactly. Returns { rgb, alpha } honouring each pack's OWN colour
// model mix(secondary, primary, value) × emission (rgb pre-multiplied by emission). SHALLOW graphs (small named
// consts, no deep single expression) so the WGSL clears the naga 127-nesting cliff (engine_lessons.md). PACK_NOISE
// is imported lazily (used only inside functions) so the file1↔file3 cycle is safe (same shape as file1↔file2).

import { atan, float, mix, smoothstep, texture, uv, vec2 } from 'three/tsl'

import { PACK_NOISE } from './vfx_pack_shaders.js'

/** @typedef {{ age:*, seed:*, grow:*, pri:*, sec:*, emission:* }} PackCtx */

const TAU = 6.2831853
const PI = 3.1415927

/** Godot overlay() blend on two 0..1 nodes (base·blend vs screen, split at 0.5). @param {*} base @param {*} blend */
function overlay(base, blend) {
  const lo = base.mul(blend).mul(2)
  const hi = float(1).sub(base.oneMinus().mul(blend.oneMinus()).mul(2))
  return base.greaterThanEqual(0.5).select(hi, lo)
}

/** A periodic seamless noise sample at `p` (PACK_NOISE is RepeatWrapping). @param {*} p vec2 node */
const nz = (p) => texture(PACK_NOISE, p).r

/** Billboard CURTAIN envelope: the Godot Glow/Lift are SHAPED meshes (tapered planes); on a flat quad the full-quad
 *  alpha reads as a HARD RECTANGLE (pixel-QA'd against the pack all.png — the area licks are soft tongues, never
 *  boxes). A vertical HUMP (peak ~0.3–0.7, fading to 0 at BOTH ends so neither the ground edge nor the tip is a hard
 *  line) × an L/R fade (→ a soft tongue). The shader's own base-bright profile then rides inside this hump. @param {*} uvp */
const curtain_env = (uvp) =>
  smoothstep(0.5, 0.26, uvp.x.sub(0.5).abs())
    .mul(smoothstep(0.0, 0.3, uvp.y))
    .mul(smoothstep(1.0, 0.72, uvp.y))

// ── STYLIZED HIT (the impact/big_impact drift — audit #5) ───────────────────────────────────────────────

/** impact_slash.gdshader — the impact FLASHES streak (Flashes_01/02 in every impact/big scene; layermap-verified,
 *  NOT the four_point_star the audit mis-named): a pinched vertical noise slash that grows a bright wave up the
 *  quad. Scene params pinch 0.4, noise_scale (0.8,0.2), edge_hardness 0.5, alpha_as_factor (⇒ factor = the per-life
 *  grow). `seed` stands in for the Godot INSTANCE_ID/PI per-particle phase. @param {PackCtx} c */
function impact_slash({ grow, seed, pri, sec, emission }) {
  const uvp = uv()
  const factor = grow
  const scaled = uvp.oneMinus().sub(vec2(0.5, 0)).mul(vec2(2, 1)) // (1 − UV − (0.5,0)) · (2,1)
  const gradient = uvp.y.oneMinus().pow(0.5).mul(2)
  const r = scaled.length().div(float(0.6).add(gradient.mul(0.4))) // r /= (1−pinch) + gradient·pinch, pinch 0.4
  const nuv = uvp.add(vec2(0, factor)).add(seed).mul(vec2(0.8, 0.2)) // + (0,factor) + id_offset(seed); noise_scale
  const shape = r.sub(nz(nuv).mul(0.5)).mul(2)
  const wave_offset = factor.mul(4).sub(1)
  let value = shape.mul(2).sub(wave_offset).abs().oneMinus() // 1 − |shape·2 − wave_offset|
  const mask = shape.mul(shape).mul(shape).oneMinus().clamp(0, 1).mul(gradient) // clamp(1 − shape³) · gradient
  value = value.mul(mask).mul(factor.max(0.0001).pow(0.1)).mul(uvp.y.mul(8).min(1))
  value = smoothstep(0.095, 0.6, value) // edge_hardness 0.5: l_edge mix(0,0.19,.5)=.095, r_edge mix(1,0.2,.5)=.6
  return { rgb: mix(sec, pri, value).mul(emission), alpha: value.clamp(0, 1) }
}

/** spiral_dust.gdshader — the impact SPIRAL corona (the impact_03/05 GPUParticles3D dust): angular spiral streaks
 *  carved by polar-scrolled noise, radius-banded by the grow front. Scene params streak_count 2, streak_twist 7,
 *  streak_scroll 0.2, noise_twist 2, noise_scroll 0.2, edge_hardness 0 ⇒ smoothstep(0,1). `seed` = the id phase. @param {PackCtx} c */
function spiral_dust({ age, grow, seed, pri, sec, emission }) {
  const cuv = uv().mul(2).sub(1)
  const angle = atan(cuv.x, cuv.y)
  const radius = cuv.length().clamp(0, 1)
  const nuv = vec2(angle.add(radius.mul(2)).mul(1 / TAU), radius.sub(age.mul(0.2))) // noise_twist 2, noise_scroll 0.2
  let spiral = angle.add(seed.mul(TAU)).add(radius.mul(7)).sub(age.mul(0.2)).sin().abs() // streak_count·0.5=1, twist 7
  spiral = spiral.mul(spiral) // pow(spiral, streak_exponent 2)
  let m = spiral.oneMinus() // 1 − spiral
  m = radius.add(m.mul(0.05)) // radius + (1−spiral)·0.05
  const mask = m.mul(2).sub(grow.mul(3)).abs().oneMinus().max(0).mul(m.oneMinus()).sqrt().clamp(0, 1)
  let noise = nz(nuv).mul(mask).mul(spiral)
  noise = smoothstep(0, 1, noise.pow(4).mul(10))
  return { rgb: mix(sec, pri, noise).mul(emission), alpha: noise.sqrt().mul(grow).clamp(0, 1) }
}

// ── ELEMENTAL MAGIC (the missing area bloom — audit #9) ──────────────────────────────────────────────────

/** area_glow.gdshader — the ElementalMagic area GLOW curtain (Glow_01/Glow_02, the bloom layer beside area_ground):
 *  two overlaid wave-carved energy bands BRIGHT AT THE BASE dissipating up, a 3-colour tertiary→secondary→primary
 *  composite. Scene params noise_scale (2,1), noise_scroll (0.1,0.3), color_curve 1, edge_hardness 0. tertiary =
 *  sec·0.4 (the phase-B 3-colour idiom). billboard-enveloped (curtain_env) so the SHAPED-mesh alpha isn't a box. @param {PackCtx} c */
function area_glow({ age, grow, pri, sec, emission }) {
  const uvp = uv()
  const tert = sec.mul(0.4)
  const wave_x = uvp.x
    .add(age.mul(0.1))
    .mul(PI * 12)
    .sin()
    .mul(0.5)
    .add(0.5)
  const nuv = uvp.mul(vec2(2, 1)).add(vec2(age.mul(0.1), age.mul(0.3))) // noise_scale (2,1), noise_scroll (0.1,0.3)
  const noise = overlay(nz(nuv), nz(nuv.mul(2)))
  const gradient = uvp.y.oneMinus().mul(2).sub(grow.oneMinus()) // (1−UV.y)·2: BRIGHT AT THE BASE, dissipating up (ground glow)
  const nm1 = gradient.sub(wave_x.mul(0.1)).mul(2).sub(1)
  const nw1 = nm1.mul(8).add(age.mul(20)).sin().mul(0.5).add(0.5)
  const value1 = smoothstep(0.2, 1, overlay(nm1, noise.sub(nw1.mul(wave_x).mul(0.5)).max(0)))
  const nm2 = gradient.sub(wave_x.mul(0.1)).mul(2).sub(0.6)
  const nw2 = nm2.mul(8).add(age.mul(20)).sin().mul(0.5).add(0.5)
  const value2 = smoothstep(0.2, 1, overlay(nm2, noise.sub(nw2.mul(wave_x).mul(0.5)).max(0)))
  const alpha = value1.max(value2).max(gradient.max(0).pow(3)).clamp(0, 1).mul(curtain_env(uvp)) // envelope: no rectangle
  const base = mix(mix(tert, sec, value2), mix(sec, pri, value1), value1) // mix(layer2, layer1, value1)
  return { rgb: base.mul(emission), alpha }
}

// ── DARK MAGIC (the void-area + void-projectile accessory layers — audit sec3) ───────────────────────────

/** dark_ring.gdshader — the void-area RING (a thin polar annulus at r 0.5 carved by angular noise). blend_add.
 *  Scene noise_scroll (0,0.2), edge_position 0.05, edge_hardness 0. @param {PackCtx} c */
function dark_ring({ age, pri, sec, emission }) {
  const cuv = uv().mul(2).sub(1)
  const radius = cuv.length()
  const angle = atan(cuv.x, cuv.y)
  const noise = nz(vec2(angle.mul(1 / TAU), radius.mul(0.5)).sub(vec2(0, age.mul(0.2))))
  const mask = radius.mul(2).sub(1).abs().min(1).oneMinus().pow(8) // pow(1 − min(|r·2−1|,1), 8): the thin ring
  const value = overlay(mask, noise).sub(0.05).max(0).clamp(0, 1)
  return { rgb: mix(sec, pri, value).mul(emission), alpha: value }
}

/** dark_lift.gdshader — the void-area rising LIFT columns (a vertical wave-wobbled noise tongue BRIGHT AT THE BASE,
 *  pow(y,4)). blend_add, billboard-enveloped (curtain_env, no box). Scene wave_frequency 5, wave_strength 0.5, noise_scroll (0,0.2). @param {PackCtx} c */
function dark_lift({ age, pri, sec, emission }) {
  const uvp = uv()
  const y = uvp.y.oneMinus().mul(2) // (1−UV.y)·2: BRIGHT AT THE BASE (the ring), rising licks dissipating UP (pack all.png)
  const wave = y
    .mul(TAU * 2.5)
    .sub(age)
    .sin()
    .mul(y.oneMinus()) // wave_frequency/2 = 2.5
  const nuv = uvp.add(vec2(wave.mul(0.05), 0)).add(vec2(0, age.mul(0.2))) // wave·0.1·wave_strength(0.5); scroll
  let shape = nz(nuv).mul(y).add(y.pow(4)).clamp(0, 1.5).div(1.5)
  shape = shape.sub(0.05).max(0).pow(2).clamp(0, 1)
  return { rgb: mix(sec, pri, shape).mul(emission), alpha: shape.mul(curtain_env(uvp)) } // envelope: soft tongue, no box
}

/** dark_projectile_glow.gdshader — the void-projectile head GLOW: a UV.y taper (pow(1−UV.y,2) smoothstepped),
 *  primary-only. blend_add, billboard-enveloped (curtain_env → a soft glow blob, not a box). The seat behind the head. @param {PackCtx} c */
function dark_glow({ pri, emission }) {
  const uvp = uv()
  const value = smoothstep(0.3, 0.6, uvp.y.oneMinus().pow(2)).mul(curtain_env(uvp)) // envelope: a soft glow blob, not a box
  return { rgb: pri.mul(emission), alpha: value.clamp(0, 1) }
}

/** dark_projectile_flares.gdshader — the void-projectile FLARES wisps: two-frequency wave-wobbled noise licks
 *  tapering up UV.y (overlay(noise·(1−UV.y)², 1−UV.y)). blend_add. Scene noise_scroll (0.2,0.4), wave_frequency 5. @param {PackCtx} c */
function dark_flares({ age, pri, sec, emission }) {
  const uvp = uv()
  const wave = uvp.y
    .mul(10)
    .sub(age.mul(2))
    .sin()
    .add(uvp.y.mul(18).sub(age.mul(2)).sin()) // freq·2=10, (freq/5·9)·2=18
  const nuv = vec2(uvp.x.add(wave.mul(0.1)), uvp.y).sub(vec2(age.mul(0.2), age.mul(0.4))) // x += wave·0.2·wave_str(0.5)
  let value = overlay(nz(nuv).mul(uvp.y.oneMinus().pow(2)), uvp.y.oneMinus())
  value = smoothstep(0.2, 0.6, value).sub(0.05).max(0)
  return { rgb: mix(sec, pri, value).mul(emission), alpha: value.clamp(0, 1) }
}

// ── DISPATCH ──────────────────────────────────────────────────────────────────────────────────────────

/** @type {Record<string, (c: PackCtx) => { rgb:*, alpha:* }>} */
const PACK3 = {
  impact_slash,
  spiral_dust,
  area_glow,
  dark_ring,
  dark_lift,
  dark_glow,
  dark_flares,
}

/** The phase-B2 billboard appearance names — merged into PACK_BILLBOARD by vfx_pack_shaders.js. */
export const PACK3_BILLBOARD = new Set(Object.keys(PACK3))

/**
 * Phase-B2 billboard appearance → { rgb, alpha }. The engine (via vfx_pack_shaders.billboard_pack) routes any
 * emitter whose appearance is in PACK3_BILLBOARD here. @param {string} kind @param {PackCtx} ctx
 * @returns {{ rgb:*, alpha:* }}
 */
export function billboard_pack3(kind, ctx) {
  return PACK3[kind](ctx)
}
