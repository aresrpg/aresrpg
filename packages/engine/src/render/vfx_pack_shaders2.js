// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FLAGSHIP VFX — PACK APPEARANCE LAYER II (phase B): faithful TSL ports of the REMAINING BinbunVFX_Vol2
// .gdshader files, extending vfx_pack_shaders.js past its LoC line. Phase A ported Flame / StylizedHit /
// DarkMagic; THIS file ports the rest, per the ruled element↔pack mapping:
//   • ElementalMagicFX → water/earth/ice/nature — projectile_core (flowing wave orb), projectile_tail
//     (comet wake), projectile_streaks (spiral), projectile_particles (mote), cast_flare (windup),
//     area_ground (the polar magic-circle ground zone → earth eruption base + glyph decals).
//   • ElectricFX      → air — electric_particle (the jagged triangle-wave lightning arc), ground_impact
//     (the radial electric crackle burst).
//   • BattleFX        → neutral (attack_particles arcane mote) + weapon (slash crescent arc).
//   • ExplosionFX     → the BIG beats — explosion_sphere (noise fireball body), explosion_smoke (billow).
//     (explosion_rings' UV.y-band shape needs a torus mesh — a camera-facing billboard uses the radial `ring`/
//     `elem_area` ground shapes instead, so that one .gdshader has no faithful billboard port.)
//   • StatusFX        → the aura LOOPs — aura_particle (the swirling aura mote), ice_particle (the crystal
//     SNOWFLAKE), bubble_particle (the poison/water bubble), heal_particle (the holy CROSS — the heal slot).
//
// METHOD (identical to phase A's fire_particle): each function transcribes ONE .gdshader `fragment()`
// op-for-op onto the camera-facing billboard quad — UV 0..1, PACK_NOISE = the pack's NoiseTexture2D,
// `age` = Godot TIME, `seed` = the particle's COLOR.r random (per-instance decorrelation / hue phase),
// `grow` = the per-life 0→1 the Godot `grow_amount`/COLOR.a drove. The source shaders' vertex() mesh
// displacement has no billboard analogue, so the fragment IS the port surface. The default-uniform terms
// (edge_hardness/edge_position/stepped/proximity_fade all default 0/off in the scenes) drop out — the
// DEFAULT scene look is preserved exactly. Returns { rgb, alpha } honouring each pack's OWN colour model
// (mix over primary/secondary/tertiary) — never a generic FBM. rgb is pre-multiplied by emission.
//
// COLOUR: the engine supplies pri≡color, sec≡color_end, emission (brightness knob). A 3-colour pack shader
// derives tertiary = sec×0.4 (the pack's darker "deep" edge). SHALLOW graphs (the naga 127-nesting cliff,
// engine_lessons.md): small named consts, no deep single expression, so the WGSL compiles well under the
// ceiling. PACK_NOISE is imported lazily (used only inside functions) so the file1↔file2 cycle is safe.

import { NoColorSpace, TextureLoader } from 'three'
import { atan, float, mix, smoothstep, texture, uv, vec2, vec3 } from 'three/tsl'

import LEAF_URL from '../../assets/leaf.png?url' // the pack's StatusFX/icons/leaf.png (the ONE texture-backed symbol)

import { PACK_NOISE } from './vfx_pack_shaders.js'

/** Lazy leaf texture (the nature symbol's texture_particle icon). Created on FIRST USE (browser-only — a
 *  material build), never at module load, so this file stays headless-safe (`?url` resolves to a bare string
 *  under bun/tsc, and TextureLoader is never constructed there). @type {import('three').Texture | null} */
let _leaf_tex = null
function leaf_texture() {
  if (!_leaf_tex) {
    _leaf_tex = new TextureLoader().load(LEAF_URL)
    _leaf_tex.colorSpace = NoColorSpace // sample the raw R/A mask channels (not sRGB-decoded)
  }
  return _leaf_tex
}

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

/** SphereMesh→billboard SILHOUETTE mask (raw UV textures render with a STRAIGHT BORDER, not meant to be
 *  used that way). The ElementalMagic projectile core/tail/streaks + cast flare each run on a SphereMesh in the
 *  pack (round by construction: vfx_fire_projectile_01.tscn Flames/Tail/Streaks = SphereMesh), so their .gdshader
 *  has NO radial cutoff — the silhouette IS the sphere. Ported onto a FLAT camera-facing quad, the raw UV.y-gradient
 *  fills the quad to its hard left/right/bottom edges ⇒ a rectangle. This restores the round silhouette — the exact
 *  same fix explo_ball / explo_core / explo_smoke already carry ("the source runs on a SphereMesh; on a billboard
 *  quad, carve a soft radial mask so the noise reads as a round ball, not a square patch"). The QuadMesh-authored
 *  Sparks (projectile_particles → elem_mote) already ships its own `max(1−length(UV·2−1),0)`, so it is untouched.
 *  @param {number} soft the radius where the feather starts (0..1); 1 at centre → 0 at the quad edge. */
function bb_mask(soft = 0.7) {
  return uv().sub(0.5).length().mul(2).smoothstep(1.02, soft) // smoothstep(1.02, soft, d): 1 for d≤soft, 0 by the edge
}

/** TEARDROP silhouette for the vertical flame LICK (elem_orb head — the projectile_core shape is bottom-weighted, a
 *  rising lick, so a CENTRED radial mask would gut its bright base). Kills only the hard LEFT/RIGHT quad edges (the
 *  visible "straight border") via a horizontal vignette + rounds the extreme bottom/top, preserving the base→tip
 *  flow the sphere UV carries. */
function bb_lick() {
  const xf = uv().x.mul(2).sub(1).abs() // 0 at the centre column → 1 at the L/R edge
  return xf
    .smoothstep(1.02, 0.34) // central column full, feathered to 0 at the sides
    .mul(uv().y.smoothstep(0.0, 0.12)) // round the extreme bottom edge
    .mul(uv().y.smoothstep(1.0, 0.86)) // round the extreme top edge
}

// ── ELEMENTAL MAGIC (water / earth / ice / nature) ────────────────────────────────────────────────────

/** ElementalMagic projectile_core.gdshader `wave()` — two counter-scrolling sawtooth bands with a sine
 *  twist, folded to a tent (min of front/back ramps): the flowing energy that streams along the orb.
 *  @param {*} uvp @param {*} offset per-pixel phase (the noise) @param {*} age */
function elem_wave(uvp, offset, age) {
  const detail = 3.0
  const twist = 2.0
  const scale = 2.0
  const woffset = 0.6
  const x_wave = uvp.x
    .mul(TAU * detail)
    .add(uvp.y.mul(TAU * twist))
    .sin()
    .mul(0.2)
  const tiled = uvp.y.mul(2).sub(age).mul(scale).add(offset.mul(0.6)).add(x_wave).fract()
  const front = tiled.div(woffset)
  const back = tiled.oneMinus().div(1 - woffset)
  return front.min(back)
}

/** projectile_core.gdshader fragment — the WATER/ICE bolt HEAD: a flowing wave body tapering along UV.y
 *  (tail→tip), tertiary(deep)→secondary→primary gradient, WHITE-hot where the grow front peaks. @param {PackCtx} c */
function elem_orb({ age, grow, pri, sec, emission }) {
  const uvp = uv()
  const noise = nz(uvp.add(vec2(age.mul(0.5), 0))).oneMinus()
  const w = elem_wave(uvp, noise, age)
  const fade_pre = uvp.y.oneMinus().add(w.mul(0.1)).sub(0.4).max(0)
  const e0 = grow.oneMinus()
  // Godot edge1 = 0.5 + 0.5·(1−grow) ⇒ gap = 0.5·grow; floor the gap at 0.02 so the smoothstep never
  // degenerates to smoothstep(1,1,·) = 0/0 at grow→0 (a NaN the frame would otherwise carry).
  const e1 = e0.add(grow.mul(0.5).max(0.02))
  const fade = smoothstep(e0, e1, fade_pre)
  const deep = sec.mul(0.4)
  const tail_color = mix(deep, sec, w.clamp(0, 1))
  const color = mix(tail_color, pri, fade.pow(4)) // color_curve = 4
  return { rgb: color.mul(emission), alpha: fade.mul(bb_lick()).clamp(0, 1) } // SphereMesh silhouette (was a hard quad)
}

/** projectile_tail.gdshader fragment — the comet WAKE ribbon: scrolling noise minus a UV.y taper, secondary→
 *  primary. A flowing trailing wisp. @param {PackCtx} c */
function elem_tail({ age, seed, grow, pri, sec, emission }) {
  const uvp = uv()
  const noise = nz(uvp.add(vec2(age.mul(0.1), age.mul(0.5))).add(seed))
  const tail_len = 0.7
  const value0 = noise
    .sub(uvp.y.oneMinus().mul(1 + (1 - tail_len)))
    .mul(grow)
    .max(0)
  const value = smoothstep(0.0, 0.5, value0)
  return { rgb: mix(sec, pri, value).mul(emission), alpha: value.mul(bb_mask(0.62)) } // SphereMesh silhouette (was a hard quad)
}

/** projectile_streaks.gdshader fragment — thin spiralling energy STREAKS (a wobble sine minus a UV.y ramp).
 *  @param {PackCtx} c */
function elem_streak({ age, seed, grow, pri, emission }) {
  const uvp = uv()
  // wobble(UV): the source adds noise·spiral_noise, but spiral_noise defaults 0 in the scenes ⇒ plain wobble.
  const wob = uvp.y
    .mul(20)
    .add(
      uvp.x
        .mul(TAU * 3)
        .sub(age.mul(20))
        .add(seed.mul(TAU))
    )
    .sin()
    .mul(0.5)
    .add(0.5)
  const gradient = uvp.y.div(0.5).pow(0.1)
  const spiral0 = wob.sub(gradient).max(0).mul(grow)
  return { rgb: pri.mul(emission), alpha: smoothstep(0.0, 0.1, spiral0).mul(bb_mask(0.6)) } // SphereMesh silhouette (was a hard quad)
}

/** projectile_particles.gdshader fragment — the noise-carved radial MOTE (overlay(radial, noise) stepped),
 *  secondary→tertiary by the per-particle roll. @param {PackCtx} c */
function elem_mote({ seed, pri, sec, emission }) {
  const uvp = uv()
  const noise = nz(uvp.mul(0.12).add(seed.div(TAU)))
  const gradient = uvp.mul(2).sub(1).length().oneMinus().max(0)
  const value = smoothstep(0.6, 0.8, overlay(gradient, noise))
  const deep = sec.mul(0.4)
  const color = mix(sec, deep, seed) // mix(secondary, tertiary, COLOR.r)
  return { rgb: mix(color, pri, value).mul(emission), alpha: value }
}

/** cast_flare.gdshader fragment — the WINDUP gather flare: noise × a rising sine wave × a vertical-band cos
 *  mask + a bright top glow. The gathering-energy charge burst. @param {PackCtx} c */
function elem_flare({ age, grow, pri, sec, emission }) {
  const uvp = uv()
  const noise = nz(uvp.add(vec2(age.mul(0.1), age.mul(0.3))))
  const fade_gradient = uvp.y.mul(4).sub(3).max(0)
  const wv = fade_gradient.add(grow.sub(0.5).mul(2)).mul(PI).sin().mul(fade_gradient).max(0)
  const value = smoothstep(0.2, 0.8, noise.mul(wv))
  const mask = uvp.x
    .mul(TAU * 4)
    .cos()
    .mul(0.5)
    .add(0.5)
  const shaped = value.mul(mask)
  const glow = uvp.y
    .sub(0.8)
    .div(0.2)
    .max(0)
    .pow(2)
    .mul(
      grow
        .mul(PI * 1.5)
        .sin()
        .max(0)
    )
  const color = mix(sec, pri, shaped).add(pri.mul(glow.mul(20).min(1)))
  return { rgb: color.mul(emission), alpha: shaped.add(glow).mul(bb_mask(0.55)).min(1) } // SphereMesh silhouette (was a hard quad)
}

/** area_ground.gdshader fragment — the POLAR magic-circle GROUND zone: a radial gradient carved by polar-
 *  scrolled noise, secondary→primary. The earth eruption footprint + the GLYPH ground decal base. @param {PackCtx} c */
function elem_area({ age, grow, pri, sec, emission }) {
  const uvp = uv()
  const dir = uvp.sub(0.5)
  const radius = dir.length().mul(2)
  const angle = atan(dir.y, dir.x)
    .mul(1 / TAU)
    .mul(2)
  const gradient0 = radius.oneMinus().max(0).mul(grow).pow(6).max(0) // gradient_texture ≈ radial falloff^6
  const noise = nz(vec2(radius, angle).sub(vec2(age.mul(0.2), 0)))
  const gradient = mix(overlay(gradient0, noise), gradient0, 0.5)
  const color = mix(sec, pri, gradient) // color_curve = 1 (default) ⇒ no pow
  return { rgb: color.mul(emission), alpha: gradient.clamp(0, 1) }
}

// ── ELECTRIC (air lightning) ──────────────────────────────────────────────────────────────────────────

/** Godot sample_wave — the triangle wave that jags the lightning path. @param {*} y @param {number} freq @param {*} off */
function tri_wave(y, freq, off) {
  return y.mul(freq).add(off).fract().mul(2).sub(1).abs().sub(0.5)
}

/** electric_particle.gdshader — the jagged LIGHTNING ARC: the vertex triangle-wave path expressed in the
 *  fragment as |u − path(v)|, a WHITE-hot core in a coloured glow, fading at both ends. Air's bolt/charge.
 *  @param {PackCtx} c */
function zap({ age, seed, pri, sec, emission }) {
  const uvp = uv()
  const y2 = uvp.y.mul(2)
  const motion = age.mul(0.1)
  const w1 = tri_wave(y2, 1.5, motion.add(seed))
  const w2 = tri_wave(y2, 1.5, float(PI).add(motion).sub(seed))
  const path = w1.add(w2).mul(0.5).mul(0.6).add(0.5) // jagged centre-line, amplitude ~0.3 across the quad
  const dist = uvp.x.sub(path).abs()
  const core = smoothstep(0.13, 0.0, dist)
  const glow = smoothstep(0.34, 0.0, dist).mul(0.55)
  const value = core.max(glow)
  const ends = uvp.y.mul(4).min(1).mul(uvp.y.oneMinus().mul(4).min(1)).max(0) // taper top+bottom
  const col = mix(sec, pri, core)
  return { rgb: col.mul(emission), alpha: value.mul(ends).clamp(0, 1) }
}

/** ground_impact.gdshader fragment — the radial ELECTRIC CRACKLE: polar sine ripples forming a jagged ring
 *  at the `grow` radius, secondary→primary. Air's impact / ground zap. @param {PackCtx} c */
function zap_burst({ seed, grow, pri, sec, emission }) {
  const cuv = uv().mul(2).sub(1)
  const radius = cuv.length()
  const angle = atan(cuv.x, cuv.y)
  const r = seed
  const w1 = angle.mul(4).add(radius).add(r.mul(PI)).sin().mul(0.5).add(0.5).mul(2)
  const w2 = angle.mul(7.04).sub(radius).sin().mul(0.5).add(0.5).mul(1.5)
  const w3 = angle.mul(12.57).add(radius).sin().mul(0.5).add(0.5)
  const wave = w1.add(w2).add(w3)
  const factor = grow.oneMinus().max(0.05)
  const value0 = radius.add(wave.mul(0.1)).sub(grow).div(factor).abs().oneMinus().max(0)
  const value = smoothstep(0.2, 1.0, value0).mul(radius.oneMinus().max(0))
  return { rgb: mix(sec, pri, value).mul(emission), alpha: value.clamp(0, 1) }
}

// ── BATTLE (neutral arcane · weapon slash) ─────────────────────────────────────────────────────────────

/** attack_particles.gdshader fragment — the arcane NEUTRAL mote: max(noise − radius), tertiary→secondary→
 *  primary. A clean noise-carved energy blob. @param {PackCtx} c */
function arcane_mote({ age, seed, pri, sec, emission }) {
  const uvp = uv()
  const radius = uvp.mul(2).sub(1).length()
  const noise = nz(
    uvp
      .mul(0.5)
      .add(seed)
      .add(vec2(age.mul(0.5), 0))
  )
  const value = noise.sub(radius).max(0).clamp(0, 1) // max(noise − radius, 0): the arcane blob carve
  const deep = sec.mul(0.4)
  const color = mix(deep, pri, value) // tertiary(deep) edge → primary core (the BattleFX arcane gradient)
  return { rgb: color.mul(emission), alpha: value }
}

/** slash.gdshader fragment — the weapon SLASH crescent: a directional pow(UV.x,6) blade inside a circle mask
 *  + a pulse wave + noise, secondary→primary over tertiary. @param {PackCtx} c */
function slash_arc({ age, pri, sec, emission }) {
  const uvp = uv()
  const radius = uvp.mul(2).sub(1).length()
  const circle = smoothstep(1.02, 0.98, radius) // step(radius,1.0) ≈ inside-circle mask (AA'd)
  const slash0 = circle.mul(uvp.x.pow(6).sub(radius.oneMinus().mul(0.5))).clamp(0, 1)
  const slash = smoothstep(0.0, 0.6, slash0)
  const wave = radius.mul(TAU).add(age.mul(TAU)).sin()
  const wpulse = wave.mul(circle).mul(uvp.x.mul(2).sub(1.2).max(0)).abs()
  const noise = nz(uvp.add(vec2(age, 0)))
  // Godot step(UV.x, 0.5) = (UV.x ≤ 0.5 ? 1 : 0) — a hard half-plane, NOT smoothstep(0.5,0.5) (that is 0/0 → NaN).
  const half = uvp.x.lessThanEqual(0.5).select(float(1), float(0))
  const nmask = circle.max(half)
  const nmask2 = nmask.sub(uvp.y.mul(2).sub(1).abs().pow(4)).mul(uvp.x).max(0).pow(0.6)
  const value = noise.sub(nmask2.oneMinus()).add(slash).add(wpulse).clamp(0, 1)
  const deep = sec.mul(0.4)
  const color = mix(sec, pri, value).max(deep)
  // edge_hardness 0.8 (vfx_blank_slash sets it — NOT the 0 the header assumed): alpha = clamp((value − edge_position
  // 0.05) / (1 − 0.8)) = ×5 → a RAZOR crescent silhouette. The port omitted it, reading soft/cloudy at burst scale.
  const alpha = value.sub(0.05).max(0).div(0.2).clamp(0, 1)
  return { rgb: color.mul(emission), alpha }
}

// ── EXPLOSION (the BIG beats) ─────────────────────────────────────────────────────────────────────────

/** explosion_sphere.gdshader fragment — the fireball BODY: twisted scrolling noise, secondary→primary.
 *  A rolling molten-lava ball. @param {PackCtx} c */
function explo_ball({ age, seed, pri, sec, emission }) {
  const uvp = uv()
  const twist = 0.5
  const nuv = uvp.add(vec2(age.mul(-0.2), age.mul(0.2))).add(seed)
  const nuv2 = vec2(nuv.x.add(nuv.y.mul(twist)), nuv.y)
  const value = nz(nuv2)
  // the source runs on a SphereMesh (round by construction); on a billboard quad, carve a soft radial mask so
  // the molten noise reads as a round ball, not a square patch.
  const mask = uvp.sub(0.5).length().mul(2).oneMinus().max(0)
  const shaped = value.mul(mask).add(mask.pow(3).mul(0.4)).clamp(0, 1)
  const color = mix(sec, pri, shaped)
  return { rgb: color.mul(emission), alpha: smoothstep(0.34, 0.44, shaped) } // crisp cutout ≈ the pack's ALPHA_SCISSOR (was 0.22,0.6 — soft)
}

/** explosion_smoke.gdshader fragment — the billowing SMOKE: 1−noise carved + stepped, tertiary→primary.
 *  A dark rolling cloud framing the fire. @param {PackCtx} c */
function explo_smoke({ age, seed, grow, pri, sec, emission }) {
  const uvp = uv()
  const noise = nz(uvp.add(seed).add(vec2(0, age.mul(0.2))))
  const decay = grow.mul(0.6) // (1-COLOR.a) proxy: dissipates as the puff ages
  const nval0 = noise.oneMinus().sub(decay.mul(2).clamp(0, 1)).max(0)
  const nval = smoothstep(0.0, 0.5, nval0)
  const deep = sec.mul(0.4)
  const color = mix(deep, pri, nval)
  // radial mask (billboard analogue of the source SphereMesh) so the puff reads round + edges soften.
  const mask = uvp.sub(0.5).length().mul(2).oneMinus().max(0)
  const alpha = noise.add(1).sub(decay.mul(2)).mul(mask.smoothstep(0, 0.35)).clamp(0, 1)
  return { rgb: color.mul(nval).mul(emission), alpha }
}

// ── EXPLOSION LAYERS — the REST of the real ExplosionFX scene (Core/Impact1-2/Shrapnel/Bits/BitsTrail/Rings),
// verified node→shader against vfx_{ground,air,burst,nuke}_explosion_*.tscn (layermap census). Every explosion
// scene is Core(explosion_core)+Smoke(explosion_smoke)+Rings(explosion_rings)+Impact1/2(explosion_impact)+
// Shrapnel(explosion_trails)+Bits(explosion_bits)+BitsTrail(smoke_trail)+OmniLight — NO four_point_star, NO
// explosion_sphere in the base scenes — cut EVERY non-Godot effect. `grow`≡(1−COLOR.a) decay. ──

/** explosion_core.gdshader — the white-hot detonation HEART: scrolling noise, ALBEDO=primary×(emission), alpha =
 *  clamp((noise+1) − 2·(1−COLOR.a)). The source displaces a SphereMesh; on a billboard a radial mask rounds it. @param {PackCtx} c */
function explo_core({ age, grow, pri, emission }) {
  const uvp = uv()
  const noise = nz(uvp.mul(2).add(vec2(0, age.mul(0.2)))) // UV·2 + TIME·noise_scroll(0,0.2)
  const mask = uvp.sub(0.5).length().mul(2).oneMinus().max(0)
  const alpha = noise
    .add(1)
    .sub(grow.mul(2))
    .clamp(0, 1)
    .mul(smoothstep(0, 0.35, mask))
  return { rgb: pri.mul(emission), alpha }
}

/** explosion_impact.gdshader — the flat expanding shock DISC: a band at `grow` radius jagged by `streak_amount`=7
 *  angular arms, carved by noise. Source runs on a flat cylinder (UV.y = the tube); the billboard maps UV.y→radius
 *  so the band reads as a radial ring (same reinterpretation as explo_ball's sphere mask). @param {PackCtx} c */
function explo_impact({ age, grow, pri, emission }) {
  const cuv = uv().mul(2).sub(1)
  const radius = cuv.length()
  const angle = atan(cuv.x, cuv.y)
  const noise = nz(
    uv()
      .mul(2)
      .add(vec2(0, age.mul(0.2)))
  )
  const wave = angle.mul(7).sin() // streak_amount 7, angular on the billboard
  const y = radius.mul(4).sub(1) // UV.y·4−1 → radial band
  const band = y.sub(grow.oneMinus().sub(0.25)).add(wave.mul(0.25).mul(grow)).abs().oneMinus()
  const shape = band.sub(0.75).mul(4) // (band−0.75)/0.25
  const value = shape.sub(noise.negate().add(2).mul(grow.mul(grow).mul(0.8).add(0.2)))
  return { rgb: pri.mul(emission), alpha: value.max(0).clamp(0, 1) }
}

/** explosion_bits.gdshader — the chunky rock BITS: ALBEDO = mix(secondary, primary, COLOR.a)·emission (bright→dark
 *  over life). Source shape is the bit MESH; the billboard supplies a small crisp round mask. @param {PackCtx} c */
function explo_bits({ grow, pri, sec, emission }) {
  const mask = uv().sub(0.5).length().mul(2).oneMinus().max(0)
  const alpha = smoothstep(0.35, 0.6, mask)
  const color = mix(sec, pri, grow.oneMinus()) // mix(sec,pri,COLOR.a); COLOR.a ≈ 1−grow
  return { rgb: color.mul(emission), alpha }
}

/** explosion_trails.gdshader — the fast SHRAPNEL streak (Godot particle_trails ribbon): overlay(1−UV.y, noise) −
 *  decay, secondary→primary by smoothstep(value). No trail geometry on a billboard, so the fragment IS the streak. @param {PackCtx} c */
function explo_trails({ grow, pri, sec, emission }) {
  const uvp = uv()
  const noise = nz(uvp)
  const value = overlay(uvp.y.mul(2).oneMinus(), noise) // overlay(1 − UV.y·2, noise)
  const alpha = value.sub(grow).max(0) // − decay(1−COLOR.a)
  const glow = smoothstep(0, 1, value)
  return { rgb: mix(sec, pri, glow).mul(emission), alpha: alpha.clamp(0, 1) }
}

/** explosion_rings.gdshader — the expanding shock RING: mask = 1−|UV.y·4−1| (the torus tube), value = mask −
 *  (1−noise) − decay, FRONT_FACING→primary. Torus UV.y→radius on the billboard (the honest reinterpretation of the
 *  one layer the audit flagged as torus-only). @param {PackCtx} c */
function explo_rings({ age, grow, pri, emission }) {
  const uvp = uv()
  const radius = uvp.mul(2).sub(1).length()
  const mask = radius.mul(4).sub(1).abs().oneMinus() // torus tube band → radial annulus
  const noise = nz(vec2(radius.mul(2), radius).add(vec2(0, age.mul(0.2))))
  const value = mask.sub(noise.oneMinus()).sub(grow).max(0)
  return { rgb: pri.mul(emission), alpha: value.clamp(0, 1) } // FRONT_FACING billboard → primary
}

/** smoke_trail.gdshader — the dark smoke WISP shed behind the bits: noise − (1−COLOR.a) − radius⁴, ALBEDO =
 *  tertiary (the pack's dark grey; the engine passes it as `secondary` = color_end). @param {PackCtx} c */
function smoke_trail({ seed, grow, sec, emission }) {
  const uvp = uv()
  const radius = uvp.mul(2).sub(1).length()
  const noise = nz(uvp.mul(0.5).add(seed))
  const value = noise.sub(grow).sub(radius.pow(4)) // noise − (1−COLOR.a) − pow(radius,4)
  return { rgb: sec.mul(emission), alpha: value.clamp(0, 1) }
}

// ── STATUS (the aura LOOPs + heal) ─────────────────────────────────────────────────────────────────────

/** aura_particle.gdshader fragment — the swirling AURA mote: pow(max(noise − r, 0), curve), a wavy vertical
 *  noise scroll, tertiary→primary. The core status/title-aura loop mote. @param {PackCtx} c */
function aura_mote({ age, seed, pri, sec, emission }) {
  const uvp = uv()
  const r = uvp.mul(2).sub(1).length()
  const wave = uvp.y
    .mul(20)
    .add(age.mul(6))
    .sin()
    .mul(0.1 * 0.2)
  const nuv = uvp
    .add(seed)
    .mul(0.5)
    .add(vec2(wave, 0))
    .add(vec2(0, age.mul(0.1)))
  const noise = nz(nuv)
  const value = noise.sub(r).max(0).pow(2)
  const deep = sec.mul(0.4)
  const color = mix(deep, pri, value.clamp(0, 1)).mul(seed.mul(0.5).add(0.5))
  return { rgb: color.mul(emission), alpha: value.clamp(0, 1) }
}

/** ice_particle.gdshader fragment — the crystal SNOWFLAKE: radial branches sin(r·π·(3+rand))^10 + angular
 *  streaks cos(angle·(5+rand)) + a hot centre, stepped to a crisp flake. secondary→primary. @param {PackCtx} c */
function ice_flake({ seed, pri, sec, emission }) {
  const cuv = uv().mul(2).sub(1)
  const r = cuv.length()
  const angle = atan(cuv.x, cuv.y)
  const rand1 = seed.mul(5).floor()
  const circle = r.oneMinus().max(0)
  const branches = r.mul(PI).mul(rand1.add(3)).sin().mul(0.5).add(0.5).pow(10).mul(circle)
  const streaks = angle.mul(seed.mul(3).floor().add(5)).cos().add(r.oneMinus().max(0).pow(4).mul(4))
  const flake0 = streaks.add(branches.mul(3))
  const flake = smoothstep(0.98, 1.02, flake0) // step(1.0, …) AA'd
  const color = mix(sec, pri, uv().y.oneMinus()) // secondary→primary up UV.y (the source ramp)
  return { rgb: color.mul(emission), alpha: flake.clamp(0, 1) }
}

/** bubble_particle.gdshader fragment — the poison/water BUBBLE: a warped rim ring + a shine highlight,
 *  secondary→primary. @param {PackCtx} c */
function bubble({ age, seed, pri, sec, emission }) {
  const uvp = uv()
  const cuv = uvp.sub(0.5)
  const angle = atan(cuv.x, cuv.y)
  const rand1 = seed.mul(4).floor()
  const wave = angle
    .add(age)
    .mul(rand1.add(3))
    .cos()
    .add(angle.sub(age).mul(rand1.add(3)).sin())
  const r = uvp.mul(2).sub(1).length()
  const shaped_r = r.add(wave.mul(0.03).mul(r))
  const inside = smoothstep(0.82, 0.78, shaped_r) // step(shaped_r, 0.8) AA'd
  const shape0 = float(0.2).add(shaped_r.pow(4).div(0.8).mul(0.8)).mul(inside)
  const shine0 = uvp.mul(2).sub(0.7).length().add(0.8).oneMinus().max(0)
  const shine = shine0.pow(0.5).mul(inside)
  const shape = shape0.add(shine).clamp(0, 1)
  const color = mix(sec, pri, shape).mul(seed.mul(0.5).add(0.5))
  return { rgb: color.mul(emission), alpha: shape }
}

/** heal_particle.gdshader fragment — the holy CROSS (a hollow plus/square-frame outline), secondary→primary
 *  up UV.y. THE HEAL slot appearance. @param {PackCtx} c */
function heal_cross({ pri, sec, emission }) {
  const cuv = uv().mul(2).sub(1)
  const shape0 = cuv.x.abs().oneMinus().max(cuv.y.abs().oneMinus())
  const shape = smoothstep(0.68, 0.72, shape0) // step(0.7, …) AA'd → a square-frame cross
  const color = mix(sec, pri, uv().y.oneMinus())
  return { rgb: color.mul(emission), alpha: shape.clamp(0, 1) }
}

/** noise_particle.gdshader fragment — the generic status MOTE: a radial-masked scrolling-noise blob,
 *  secondary→primary by the noise. THE common Particles symbol (flame/dark/divine/green/shard/gem/magic/void).
 *  noise = texture((UV+seed)·0.3·(3,1) + TIME·(0.1,0.4)); shape = (1−|UV·2−1|)·noise, smoothstep(0.2,0.8). @param {PackCtx} c */
function noise_mote({ age, seed, pri, sec, emission }) {
  const uvp = uv()
  const nuv = uvp
    .add(seed)
    .mul(vec2(0.9, 0.3)) // 0.3 · noise_scale(3,1)
    .add(vec2(age.mul(0.1), age.mul(0.4))) // TIME · noise_scroll(0.1,0.4)
  const noise = nz(nuv)
  const radial = uvp.mul(2).sub(1).length().oneMinus() // 1 − length(UV·2−1)
  const shape = smoothstep(0.2, 0.8, radial.mul(noise))
  const color = mix(sec, pri, noise)
  return { rgb: color.mul(emission), alpha: shape.clamp(0, 1) }
}

/** sleep_particle.gdshader fragment — the SLEEP glyph: a diagonal band + horizontal band (the drowsy 'Z'-ish
 *  mark) that draws in over life, secondary→primary up UV.y. THE sleep slot. shape = max(|cy|, 1−|cx+cy|) −
 *  (1−grow), step(0.5). `grow` ≡ the Godot COLOR.a (per-life alpha). @param {PackCtx} c */
function sleep_z({ grow, pri, sec, emission }) {
  const cuv = uv().mul(2).sub(1)
  const diagonal = cuv.x.add(cuv.y).abs().oneMinus() // 1 − |cx + cy|
  const shape0 = cuv.y.abs().max(diagonal).sub(grow.oneMinus()) // − (1 − COLOR.a)
  const shape = smoothstep(0.48, 0.52, shape0) // step(0.5, …) AA'd
  const color = mix(sec, pri, uv().y.oneMinus())
  return { rgb: color.mul(emission), alpha: shape.clamp(0, 1) }
}

/** texture_particle.gdshader fragment — the LEAF symbol (nature): samples the pack's leaf.png `.ra` (R → the
 *  secondary→primary colour mix, A → the alpha) with the shader's edge_position 0.2 cutoff. The ONE
 *  texture-backed pack symbol (the rest are procedural). The per-particle hue_variation (a subtle ±0.05 hue
 *  jitter) is omitted — the SHAPE + COLOUR are the faithful essence. @param {PackCtx} c */
function leaf({ pri, sec, emission }) {
  const t = texture(leaf_texture(), uv())
  const alpha = t.a.sub(0.2).clamp(0, 1) // ALPHA = clamp(A − edge_position(0.2), 0, 1); edge_hardness 0 → /1
  const color = mix(sec, pri, t.r) // mix(secondary_color, primary_color, icon.x = R)
  return { rgb: color.mul(emission), alpha }
}

// ── DISPATCH ──────────────────────────────────────────────────────────────────────────────────────────

/** @type {Record<string, (c: PackCtx) => { rgb:*, alpha:* }>} */
const PACK2 = {
  elem_orb,
  elem_tail,
  elem_streak,
  elem_mote,
  elem_flare,
  elem_area,
  zap,
  zap_burst,
  arcane_mote,
  slash_arc,
  explo_ball,
  explo_smoke,
  explo_core,
  explo_impact,
  explo_bits,
  explo_trails,
  explo_rings,
  smoke_trail,
  aura_mote,
  ice_flake,
  bubble,
  heal_cross,
  noise_mote,
  sleep_z,
  leaf,
}

/** The phase-B billboard appearance names — merged into PACK_BILLBOARD by vfx_pack_shaders.js. */
export const PACK2_BILLBOARD = new Set(Object.keys(PACK2))

/**
 * Phase-B billboard appearance → { rgb, alpha }. The engine (via vfx_pack_shaders.billboard_pack) routes
 * any emitter whose appearance is in PACK2_BILLBOARD here. @param {string} kind @param {PackCtx} ctx
 * @returns {{ rgb:*, alpha:* }}
 */
export function billboard_pack2(kind, ctx) {
  return PACK2[kind](ctx)
}
