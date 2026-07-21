// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FLAGSHIP VFX — the PACK APPEARANCE LAYER: faithful TSL ports of the actual BinbunVFX_Vol2 .gdshader files
// (licensed asset pack, vfx/extracted/**). This is the "look" layer the runtime (vfx_preset_engine.js) mounts:
// vfx_preset_engine owns MOTION (analytic ballistics, seeding, the instanced billboard mount + the sphere-hero
// mount); THIS file owns every per-pixel SHAPE + COLOUR. Split so each stays ≤600 LoC and all "does it look like
// the pack" logic has ONE home.
//
// WHY THIS EXISTS: the packs ship ZERO particle textures — the look is 100%
// hand-authored spatial shaders on primitives (quads + SphereMesh). Prior ports substituted a generic FBM +
// generic disc/star, which read as "not the pack". These are the REAL shader fragments transcribed
// op-for-op to TSL: four_point_star / streaks / flare / impact_core / impact_sphere / glow (StylizedHitFX),
// fire_particle (FlameFX), void_ball / void_core / void_particles / void_aura / area_dark / dark_projectile_trail (DarkMagicFX).
//
// COLOUR MODEL (the pack idiom, ≠ the engine's life-mix): every pack shader computes a per-pixel `value` from UV
// (+ scrolling seamless noise), then `mix(secondary, primary, value) * emission`, `ALPHA = value`. So the colour
// gradient is WITHIN the quad (bright core → coloured edge), not over life. The engine passes { pri, sec, emission }
// (from the emitter's tinted color/color_end) and this returns the finished { rgb, alpha }.
//
// BLENDING: the pack shaders are `blend_add`/`blend_mix`, all `unshaded`. The engine mounts them toneMapped=false
// (AgX-survival law, board_vfx/title_aura) and opts additive per-emitter; the bright core is carried in the colour,
// the void CORE darkens via NORMAL blend (a black fresnel sphere — a real hole).

import { DataTexture, LinearFilter, RGBAFormat, RepeatWrapping } from 'three'
import {
  atan,
  float,
  mix,
  normalLocal,
  normalView,
  positionLocal,
  positionViewDirection,
  smoothstep,
  texture,
  uv,
  vec2,
  vec3,
} from 'three/tsl'

import { PACK2_BILLBOARD, billboard_pack2 } from './vfx_pack_shaders_expansion.js'
import { PACK3_BILLBOARD, billboard_pack3 } from './vfx_pack_shaders_gapfill.js'

/** @typedef {import('./vfx_preset_engine.js').VfxEmitter} VfxEmitter */

// ── SEAMLESS FRACTAL NOISE (the Godot NoiseTexture2D/FastNoiseLite source every pack shader samples). A periodic
// 3-octave value-FBM lattice ⇒ RepeatWrapping tiles seamlessly (each octave frequency divides the period P), so a
// scrolling sample never seams. Procedural ⇒ nothing ships as an asset. Shared by flame + every pack appearance.
/** @param {number} size */
function make_pack_noise(size = 128) {
  const P = 8
  const data = new Uint8Array(size * size * 4)
  const hash = (/** @type {number} */ x, /** @type {number} */ y) => {
    const xi = ((x % P) + P) % P
    const yi = ((y % P) + P) % P
    let h = (Math.imul(xi + 1, 374761393) ^ Math.imul(yi + 1, 668265263)) >>> 0
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
  const sm = (/** @type {number} */ t) => t * t * (3 - 2 * t)
  const lerp = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ t) => a + (b - a) * t
  const vnoise = (/** @type {number} */ x, /** @type {number} */ y) => {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = sm(x - x0)
    const fy = sm(y - y0)
    return lerp(lerp(hash(x0, y0), hash(x0 + 1, y0), fx), lerp(hash(x0, y0 + 1), hash(x0 + 1, y0 + 1), fx), fy)
  }
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const u = (i / size) * P
      const v = (j / size) * P
      let f = 0
      let amp = 0.5
      let freq = 1
      for (let o = 0; o < 3; o += 1) {
        f += amp * vnoise(u * freq, v * freq)
        amp *= 0.5
        freq *= 2
      }
      const b = Math.max(0, Math.min(255, Math.round(f * 255)))
      const p = (j * size + i) * 4
      data[p] = b
      data[p + 1] = b
      data[p + 2] = b
      data[p + 3] = 255
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat)
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  tex.needsUpdate = true
  return tex
}
export const PACK_NOISE = make_pack_noise()

const TAU = 6.2831853

// ── GENERIC APPEARANCES (kept for the not-yet-pack-ported element slots — water/air/earth/heal fallbacks). These
// are the original engine looks moved here so the whole "appearance" layer lives in ONE file. flame_field = the
// noise-carved fiery billboard; appearance_alpha = the crisp graphic disc/ring/star. ───────────────────────────

/** FLAME / SPARK field — a scrolling-noise billboard carved by a radial mask (a live flame tongue, not a soft
 *  disc). Returns { alpha, heat }: alpha = the silhouette; heat = core-hot→edge-cool for the colour ramp. (The
 *  generic 'smoke' branch was retired with phase B — ExplosionFX's explo_smoke is the only smoke on any preset.)
 *  @param {string} kind @param {{ age:*, seed:* }} ctx */
export function flame_field(kind, { age, seed }) {
  const uvp = uv()
  if (kind === 'spark') {
    const d = uvp.sub(0.5).length()
    const n1 = texture(PACK_NOISE, uvp.mul(2.7).add(vec2(seed, seed.sub(age.mul(1.6))))).r
    const n2 = texture(PACK_NOISE, uvp.mul(4.6).add(vec2(seed.mul(2.1), age.mul(-2.3)))).r
    const n = n1.mul(n2).mul(2.4).clamp(0, 1)
    const edge = d.add(n.oneMinus().mul(0.32))
    return { alpha: smoothstep(0.62, 0.4, edge).clamp(0, 1), heat: null }
  }
  const mask = uvp.sub(0.5).length().mul(2).oneMinus().max(0)
  const scroll = vec2(seed.mul(2.7), seed.add(age.mul(1.6)).negate())
  const nuv = vec2(uvp.x.sub(0.5).mul(3.0).add(0.5), uvp.y.mul(1.05)).add(scroll)
  const n = texture(PACK_NOISE, nuv).r
  const heat = n.mul(1.45).mul(mask).add(mask.pow(4.5).mul(0.4))
  const alpha = smoothstep(0.44, 0.56, heat).mul(mask.smoothstep(0, 0.1)) // crisper edge (was 0.32,0.72 — too soft vs the pack)
  return { alpha, heat }
}

/** The crisp graphic disc/ring/star (soft-glow, shockwave ring, sharp sparkle). @param {string} kind */
export function appearance_alpha(kind) {
  const p = uv().sub(0.5)
  const d = p.length()
  if (kind === 'ring') return smoothstep(0.5, 0.4, d).mul(smoothstep(0.26, 0.38, d))
  if (kind === 'star') {
    const fall = smoothstep(0.5, 0.03, d)
    const hsp = smoothstep(0.032, 0.0, p.y.abs())
    const vsp = smoothstep(0.032, 0.0, p.x.abs())
    const d1 = p.x.add(p.y).abs().mul(0.7071)
    const d2 = p.x.sub(p.y).abs().mul(0.7071)
    const diag = smoothstep(0.024, 0.0, d1)
      .max(smoothstep(0.024, 0.0, d2))
      .mul(0.5)
    const core = smoothstep(0.12, 0.0, d)
    return hsp.max(vsp).max(diag).mul(fall).max(core).clamp(0, 1)
  }
  const g = smoothstep(0.5, 0.0, d)
  return g.mul(g)
}

// ── PACK BILLBOARD APPEARANCES (the REAL shaders). Each returns a per-pixel `value` (0..1 shape intensity) and its
// `alpha`. The engine turns `value` into `mix(sec, pri, value) * emission`. `seed` = the particle's colour_roll (a
// per-particle phase so neighbours decorrelate); `age` = the shared preset clock (Godot TIME). ────────────────────

/** StylizedHitFX four_point_star.gdshader — a sharp 4-point superellipse sparkle: value = pow(|u|,k)+pow(|v|,k)
 *  thresholded (bright along the axes + centre pip). k=0.6 = the actual scene star_shape (8/12 hit+strike scenes;
 *  the shader's 2.0 DEFAULT is unused everywhere and renders a plain CIRCLE, not a star — the port's old bug). @param {number} shape */
function star4(shape = 0.6, smooth = 0.1) {
  const uvc = uv().mul(2).sub(1).abs()
  const v = uvc.x.pow(shape).add(uvc.y.pow(shape)).clamp(0, 2)
  // Godot smoothstep(0.95, 0.95-smooth, v): bright where v is SMALL (centre + along the axes), zero past 0.95.
  return smoothstep(0.95, 0.95 - smooth, v)
}

/** StylizedHitFX streaks.gdshader — two counter-rotating angular sine bands (overlay-blended) inside a radial
 *  mask: the swirling energy corona / spiral dust. angle=atan(x,y). @param {*} age @param {number} c1 @param {number} c2 */
function streaks(age, c1 = 5.0, c2 = 11.0) {
  const cuv = uv().sub(0.5)
  const angle = atan(cuv.x, cuv.y)
  const radius = cuv.length().mul(2)
  const s1 = angle.mul(c1).add(age).sin()
  const s2 = angle.mul(c2).sub(age).sin()
  const v0 = overlay(s1, s2)
  const mask = radius.oneMinus().max(0)
  let v = v0.sub(radius.oneMinus().mul(0.4))
  v = v
    .mul(float(1).sub(radius.sub(v.mul(0.5))))
    .mul(mask)
    .min(mask)
  v = smoothstep(0.1, 1.0, v)
  const fade = radius.sub(0.1).div(0.3).clamp(0, 1).pow(4)
  return v.mul(fade)
}

/** StylizedHitFX flare.gdshader (minus the flare_texture, substituted by a radial core pow(1-r)): sharp radial
 *  spikes from a hot centre — the pack "flare" burst. @param {*} age @param {number} amount */
function flare(age, amount = 4.0) {
  const cuv = uv().sub(0.5)
  const angle = atan(cuv.x, cuv.y)
  const radius = cuv.length().mul(2)
  const core = radius.oneMinus().max(0).pow(2.4).mul(0.9) // flare_texture substitute (hot centre falloff)
  const spikes = angle.mul(amount).add(age.mul(0.4)).cos().mul(0.5).add(0.5).pow(16)
  const variance = angle.mul(12).sin().mul(0.5).add(0.5)
  const v = overlay(core, spikes.mul(variance)).max(core.mul(0.6))
  return smoothstep(0.05, 0.5, v.mul(radius.oneMinus().max(0)))
}

/** StylizedHitFX impact_core.gdshader — an expanding swirl shockwave: a wavy annulus whose radius pulses by
 *  angle, growing with `grow`. @param {*} age @param {*} grow 0..1 grow factor @param {number} streak */
function impact_core(age, grow, streak = 7.0) {
  const cuv = uv().mul(2).sub(1)
  const angle = atan(cuv.x, cuv.y)
  let radius = cuv.length()
  const factor = grow.mul(4).sub(1)
  const offset = angle
    .mul(streak * 0.5)
    .add(age)
    .sin()
    .abs()
    .mul(radius)
  radius = radius.add(offset.mul(0.5))
  const v = radius.mul(2).sub(factor).abs().oneMinus().mul(radius.oneMinus().max(0).pow(0.1).max(0))
  return smoothstep(0.25, 0.9, v)
}

/** FlameFX fire_particle.gdshader — the licking flame, ported to the REAL pack 2-hue COLOUR model (audit #4, the B2
 *  fix): colour = mix(primary, secondary, COLOR.r) · emission · (1 − COLOR.r), where COLOR.r ≡ the per-particle
 *  `seed` roll (Godot color_initial_ramp 0..1). Low-roll particles burn bright PRIMARY; high-roll take the SECONDARY
 *  2nd hue and dim toward black — the pack's authored 2-hue read (basic fire = a gold body with magenta-red deep
 *  licks, sec (0.686,0,0.18) G=0), NOT the prior from-scratch single-hue LUM pick + invented white-hot core (both
 *  DELETED — they had no source). This 2-hue model is what unlocks flame_variant's real per-tint 2nd hue. SHAPE:
 *  a radial mask × scrolling seamless noise + a solid hot core (flame_density 0.5 ⇒ pow(mask,4)), crisp edge
 *  smoothstep (edge_hardness 0.9, edge_position 0.2 ⇒ r_edge 0.279). The source triplanar world-space sample
 *  collapses to the UV plane on a camera-facing billboard (abs(NORMAL.x)→0); noise_scroll.y = 1 (fast upward lick),
 *  wobble_amount 0 on basic fire (the scroll carries the motion). Returns { value, rgb }: value = the silhouette
 *  alpha (the engine's alpha_curve carries the COLOR.a⁸ life-fade); rgb pre-multiplied by emission.
 *  @param {{ age:*, seed:*, pri:*, sec:*, emission:* }} ctx */
function fire_particle({ age, seed, pri, sec, emission }) {
  const uvp = uv()
  const mask = uvp.sub(0.5).length().mul(2).oneMinus().max(0) // 1 − length(UV·2−1)
  const nuv = vec2(uvp.x.sub(0.5).mul(2).add(0.5).add(seed), uvp.y.sub(age)) // world-xy plane, per-particle phase; scroll.y 1
  const noise = texture(PACK_NOISE, nuv).r
  const value0 = noise.mul(mask).add(mask.pow(4)).clamp(0, 1) // noise·mask + pow(mask,(1−density)·8=4) hot core
  const value = smoothstep(0.2, 0.279, value0) // edge_position 0.2, edge_hardness 0.9 ⇒ crisp cutout
  const color = mix(pri, sec, seed).mul(emission).mul(seed.oneMinus()) // mix(pri,sec,COLOR.r)·emission·(1−COLOR.r)
  return { value, rgb: color }
}

/** DarkMagicFX void_particles.gdshader — the imploding void MOTES (the `Particles` node of vfx_ball_void_01.tscn):
 *  scrolling noise − a radial fade, + a pow(value,2) boost. Fixed vs the drift: noise_scale 0.3 (was 0.6 = 2× too
 *  dense — audit #10), a wave x-wobble, raw clamp (the source has no smoothstep). @param {{ age:*, seed:* }} ctx */
function void_particle({ age, seed }) {
  const uvp = uv()
  const radius = uvp.mul(2).sub(1).length()
  const wave = uvp.y
    .mul(5)
    .sub(age.mul(2))
    .sin()
    .add(uvp.y.mul(9).sub(age.mul(2)).sin()) // sin(UV.y·5−T·2)+sin(UV.y·9−T·2)
  const base = uvp.mul(0.3).add(seed).add(age.mul(0.1)) // UV·0.3 + COLOR.r + noise_scroll(0.2)·0.5·TIME
  const noise = texture(PACK_NOISE, vec2(base.x.add(wave.mul(0.05)), base.y)).r // noise_uv.x += wave·0.1·wave_strength(0.5)
  let v = noise.sub(radius) // noise − radius (COLOR.a life-fade lives in the emitter's alpha_curve, not double-counted)
  v = v.add(v.max(0).pow(2)).sub(0.05).max(0) // += pow(value,2); − edge_position(0.05)
  return v.clamp(0, 1) // ALPHA = clamp(value); billboard_pack does mix(secondary, primary, value)·emission
}

/** DarkMagicFX void_aura.gdshader — the void ORB CORONA (the `Aura` MeshInstance of vfx_ball_void_01.tscn, NOT the
 *  cross-pack StylizedHitFX `streaks` the port wrongly substituted): concentric radial standing-waves + angular
 *  streaks carved by polar-scrolled noise, radial-falloff boosted, masked by sqrt(1−r), overlay-sharpened.
 *  blend_add; ALBEDO = mix(sec,pri,value)·2·emission (audit #1). @param {{ age:*, pri:*, sec:*, emission:* }} ctx */
function void_aura({ age, pri, sec, emission }) {
  const cuv = uv().mul(2).sub(1)
  const radius = cuv.length()
  const angle = atan(cuv.x, cuv.y)
  const wave = radius
    .mul(5)
    .sub(age.mul(2))
    .sin()
    .add(radius.mul(9).sub(age.mul(2)).sin())
  const streaks = angle.mul(5).add(age).sin().mul(0.5).add(0.5)
  const nx = radius.mul(0.5).add(age.mul(0.2)) // noise_uv = vec2(r·0.5, angle/TAU) + noise_scroll.yx·TIME
  const ny = angle
    .mul(1 / TAU)
    .add(age.mul(0.2))
    .add(wave.mul(0.05)) // .y += wave·0.1·wave_strength(0.5)
  const noise = texture(PACK_NOISE, vec2(nx, ny)).r
  let v = noise.add(radius.oneMinus().max(0).pow(4).mul(1.5)) // + pow(1−r,4)·1.5
  v = v.mul(radius.oneMinus().max(0).sqrt()).sub(streaks.mul(0.2)) // ·sqrt(1−r) − streaks·0.2
  v = smoothstep(0, 1, v)
  // Godot overlay(value, value²) on 0..1 inputs — NOT the file's −1..1 sine-band overlay (that floors alpha to 0.5
  // at value=0, filling the whole quad → the corona rendered as a hard square). overlay(0,0)=0 ⇒ edges mask to 0.
  const vsq = v.mul(v)
  v = v.greaterThanEqual(0.5).select(float(1).sub(v.oneMinus().mul(vsq.oneMinus()).mul(2)), v.mul(vsq).mul(2))
  v = v.sub(0.05).max(0) // − edge_position(0.05)
  return { rgb: mix(sec, pri, v).mul(emission).mul(2), alpha: v.clamp(0, 1) }
}

/** DarkMagicFX area_dark.gdshader — the DARK ground POOL (blend_mix, ALBEDO=vec3(0)): a rippling shadow zone,
 *  polar-scrolled noise + radial-falloff − angular streaks, masked by sqrt(1−r). Replaces the fabricated `portal`
 *  (audit #1 — the invented "bright annulus" had ZERO DarkMagic source). On the engine's NORMAL-blend billboard a
 *  black rgb × alpha DARKENS the ground — the shader's blend_mix darken, op-for-op. @param {{ age:* }} ctx */
function area_dark({ age }) {
  const cuv = uv().mul(2).sub(1)
  const radius = cuv.length()
  const angle = atan(cuv.x, cuv.y)
  const wave = radius
    .mul(5)
    .sub(age.mul(2))
    .sin()
    .add(radius.mul(9).sub(age.mul(2)).sin())
  const streaks = angle.mul(5).add(age).sin().mul(0.5).add(0.5)
  const nx = angle.mul(1 / TAU).sub(age.mul(0.2)) // noise_uv = vec2(angle/TAU, r·0.5) − noise_scroll·TIME
  const ny = radius.mul(0.5).sub(age.mul(0.2)).add(wave.mul(0.05))
  const noise = texture(PACK_NOISE, vec2(nx, ny)).r
  let v = noise.add(radius.oneMinus().max(0).pow(4).mul(2)) // + pow(1−r,4)·2
  v = v.mul(radius.oneMinus().max(0).sqrt()).sub(streaks.mul(0.2))
  v = smoothstep(0, 1, v).sub(0.05).max(0)
  return { rgb: vec3(0, 0, 0), alpha: v.clamp(0, 1) }
}

/** DarkMagicFX dark_projectile_trail.gdshader — a stretched additive wake ribbon: scrolling noise minus a
 *  centre-line + view mask (a comet tail). @param {{ age:*, seed:* }} ctx */
function trail_blade({ age, seed }) {
  const uvp = uv()
  const mask = uvp.y.mul(2).pow(0.5).mul(2).sub(1).abs()
  const nuv = vec2(uvp.x, uvp.y.mul(2))
    .sub(vec2(0, age.mul(0.4)))
    .add(seed)
  const noise = texture(PACK_NOISE, nuv).r
  const v = noise.sub(mask).max(0)
  return smoothstep(0.0, 0.5, v)
}

/** Godot overlay() blend (used by streaks/flare/impact_core). base,blend are −1..1 sine bands here. */
function overlay(base, blend) {
  const b = base.mul(0.5).add(0.5)
  const s = blend.mul(0.5).add(0.5)
  const lo = b.mul(s).mul(2)
  const hi = float(1).sub(b.oneMinus().mul(s.oneMinus()).mul(2))
  return b.greaterThanEqual(0.5).select(hi, lo)
}

/** Which appearances use the PACK per-pixel colour model (mix(sec,pri,value)*emission) vs the engine life-mix.
 *  The phase-B pack ports (ElementalMagic/Electric/Battle/Explosion/Status — vfx_pack_shaders_expansion.js) are folded
 *  in so the engine routes them here too; each returns its own finished { rgb, alpha } via billboard_pack2. */
export const PACK_BILLBOARD = new Set([
  'star4',
  'streaks',
  'flare',
  'impact_core',
  'fire',
  'void_particle',
  'void_aura',
  'area_dark',
  'trail_blade',
])
for (const k of PACK2_BILLBOARD) PACK_BILLBOARD.add(k)
for (const k of PACK3_BILLBOARD) PACK_BILLBOARD.add(k)
/** Which appearances mount a SPHERE hero mesh (real normals: displacement + fresnel) instead of a billboard.
 *  `aura_shell` is the StatusFX aura_sphere body glow — mounted on a tall ellipsoid (build_sphere_hero). */
export const PACK_SPHERE = new Set(['void_ball', 'void_core', 'sphere_glow', 'sphere_impact', 'aura_shell'])

/**
 * Billboard pack appearance → { rgb, alpha }. The engine calls this for any emitter whose appearance is in
 * PACK_BILLBOARD; it supplies the colour nodes (pri/sec from the emitter's tinted color/color_end, emission).
 * @param {string} kind @param {{ age:*, seed:*, grow:*, pri:*, sec:*, emission:* }} ctx
 * @returns {{ rgb:*, alpha:* }}
 */
export function billboard_pack(kind, { age, seed, grow, pri, sec, emission }) {
  // Phase-B/B2 pack ports own their full colour model — each returns finished { rgb, alpha }, so delegate before
  // the phase-A per-pixel-value path below. (B2 = the last StylizedHit/ElementalMagic/DarkMagic accessory shaders.)
  if (PACK3_BILLBOARD.has(kind)) return billboard_pack3(kind, { age, seed, grow, pri, sec, emission })
  if (PACK2_BILLBOARD.has(kind)) return billboard_pack2(kind, { age, seed, grow, pri, sec, emission })
  if (kind === 'fire') {
    const { value, rgb } = fire_particle({ age, seed, pri, sec, emission })
    return { rgb, alpha: value }
  }
  // void_aura (orb corona) + area_dark (ground pool) own their full colour model (mix·2·emission / black darken).
  if (kind === 'void_aura') return void_aura({ age, pri, sec, emission })
  if (kind === 'area_dark') return area_dark({ age })
  let value
  if (kind === 'star4') value = star4()
  else if (kind === 'streaks') value = streaks(age)
  else if (kind === 'flare') value = flare(age)
  else if (kind === 'impact_core') value = impact_core(age, grow)
  else if (kind === 'void_particle') value = void_particle({ age, seed })
  else value = trail_blade({ age, seed }) // 'trail_blade'
  const rgb = mix(sec, pri, value).mul(emission)
  return { rgb, alpha: value }
}

// ── SPHERE HERO APPEARANCES (real geometry: vertex displacement along the normal + true fresnel N·V). These make
// the DarkMagic void ORB read as 3D dark energy — genuinely different from a
// flat sprite. The engine mounts a SphereMesh + MeshBasicNodeMaterial and calls sphere_pack for the nodes. ───────

/** View-space fresnel N·V (0 at the rim → 1 facing the camera). */
function fresnel() {
  return positionViewDirection.dot(normalView).clamp(0, 1)
}

/**
 * Sphere pack appearance → { displace, rgb, alpha }. `displace` is a local-space offset (along the normal) added
 * to positionLocal by the engine's sphere-hero vertex node; rgb/alpha are the fragment. `age` = TIME.
 * @param {string} kind @param {{ age:*, pri:*, sec:*, emission:*, amount:number }} ctx
 * @returns {{ displace:*, rgb:*, alpha:* }}
 */
export function sphere_pack(kind, { age, pri, sec, emission, amount = 0.5 }) {
  const uvp = uv()
  const fr = fresnel()

  if (kind === 'aura_shell') {
    // aura_sphere.gdshader — the StatusFX aura CAPSULE (ONLY the 6 statuses whose .tscn ships a SphereMesh:
    // flame/water/dark/divine/green/shard). NOT the body glow (that is the on-model status_overlay following the
    // humanoid silhouette — see vfx_model_overlay). This is the translucent additive COLUMN you SEE in the pack
    // preview (all.png: the water/poison bubble-shell around the body). Mounted on the tall ellipsoid [0.8,1.7,0.8]
    // (the .tscn SphereMesh r0.8×h3.4), rendered BEHIND the motes. Ported op-for-op from aura_sphere.gdshader:
    //   wave = sin(UV.y·40 − TIME); v = sample_value(UV + (wave·0.1·waviness, 0));  waviness 0.2
    //   sample_value: noise((uv.x − uv.y·twist, uv.y)·scale + TIME·scroll) · mask, smoothstep(0.5,0.8);
    //     twist 1, scale (3,1), scroll (0.1,0.4); mask = pow((1 − |uv.y·2−1| − 0.5)/0.5, 0.2) = pow(1−2a, 0.2) torso band.
    const wave = uvp.y.mul(40).sub(age).sin()
    const sx = uvp.x.add(wave.mul(0.1 * 0.2)) // + wave·0.1·waviness(0.2)
    const nuv = vec2(sx.sub(uvp.y), uvp.y)
      .mul(vec2(3, 1))
      .add(vec2(age.mul(0.1), age.mul(0.4))) // twist 1 · scale (3,1) · scroll (0.1,0.4)
    const noise = texture(PACK_NOISE, nuv).r
    const a = uvp.y.mul(2).sub(1).abs() // 0 at equator → 1 at the poles
    const mask = a.mul(2).oneMinus().max(0).pow(0.2) // pow((1−|uv.y·2−1|−0.5)/0.5, 0.2) = torso band (mid 50%)
    const value = smoothstep(0.5, 0.8, noise.mul(mask))
    return { displace: vec3(0, 0, 0), rgb: mix(sec, pri, value).mul(emission), alpha: value }
  }

  if (kind === 'void_core') {
    // void_core.gdshader — a BLACK fresnel sphere: ALBEDO 0, ALPHA = fresnel. The void HOLE (NORMAL blend darkens).
    const wob = uvp.x
      .mul(6.2832)
      .sub(age.mul(4))
      .sin()
      .mul(uvp.y.mul(6.2832).add(age.mul(4)).sin())
    const mask = uvp.y.mul(3.1416).sin().pow(0.5)
    const displace = normalLocal.mul(wob.mul(0.1).mul(amount).mul(mask))
    return { displace, rgb: vec3(0, 0, 0), alpha: fr }
  }

  if (kind === 'sphere_glow') {
    // glow.gdshader — a centre-hot additive halo sphere: fresnel^8, mix(sec,pri,fresnel). No displacement.
    const f8 = fr.pow(8).clamp(0, 1)
    return { displace: vec3(0, 0, 0), rgb: mix(sec, pri, f8).mul(emission), alpha: f8 }
  }

  // void_ball.gdshader / impact_sphere.gdshader — a DISPLACED noise sphere. void_ball: fresnel + noise^8 drives the
  // colour, alpha = fresnel (a glowing energy orb). impact_sphere: noise carves the silhouette (a rough hot ball).
  const scroll = vec2(age.sin(), age.cos()).mul(0.2)
  const noise = texture(PACK_NOISE, uvp.add(scroll)).r
  const mask = uvp.y.mul(3.1416).sin()
  const wob = uvp.x
    .mul(6.2832)
    .sub(age.mul(4))
    .sin()
    .mul(uvp.y.mul(6.2832).add(age.mul(4)).sin())
    .mul(uvp.x.mul(12.566).sub(age).sin())
  const displace = normalLocal.mul(wob.mul(0.5).mul(amount).mul(uvp.y.mul(3.1416).sin().pow(0.5)))

  if (kind === 'sphere_impact') {
    const disp2 = normalLocal.mul(noise.mul(amount).add(amount))
    const v = noise.clamp(0, 1)
    const vv = smoothstep(0.2, 0.8, v)
    return { displace: disp2, rgb: mix(sec, pri, vv).mul(emission), alpha: vv }
  }

  // void_ball
  const value = fr.add(noise.pow(8).mul(4).mul(mask))
  return { displace, rgb: mix(sec, pri, value.clamp(0, 1)).mul(emission), alpha: fr }
}
