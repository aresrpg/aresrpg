// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FLAGSHIP VFX — the PRESET LIBRARY: 44 fight effects ported from the Godot BinbunVFX_Vol2 ExplosionFX (16)
// + StylizedHitFX (28) packs. Each preset is a plain data object (VfxPreset) consumed by vfx_preset_engine's
// `create_vfx_preset`. The PORT is transcribing each .tscn's GPUParticles3D emitters into `emitters` rows —
// counts / lifetimes / emission shapes / velocity+gravity / over-life curves / colours read off the scene —
// NOT inventing. Scenes within a family share a parameterized BUILDER (explosion_preset / hit_preset); the
// per-scene numbers (colour, counts, sizes) are the spec passed in, so all 44 names exist and stay faithful.
//
// Colour law: bright emissive channels kept ≤ 1.0 for SUSTAINED emitters (no-bloom / white-halo class); the
// brief bright "flash" is the short-lived CORE emitter (≤ FLASH_MS). The Godot HDR `emission 4.0` is folded
// into slightly-hot base colours — never a bloom-threshold breach (asserted by the engine unit test).

import { SPELL_PRESETS } from './vfx_presets_spell.js'
import { WORLD_PRESETS } from './vfx_presets_world.js'
import { strike_preset } from './vfx_presets_burst.js'
import { MELEE_PRESETS } from './vfx_presets_melee.js'
import { IMPACT_PRESETS } from './vfx_presets_impact.js'
import { DARK_PRESETS } from './vfx_presets_dark.js'
import { AIR_PRESETS } from './vfx_presets_air.js'
import { ELEM_VARIANT_PRESETS } from './vfx_presets_elemental.js'
import { FLAME_VARIANT_PRESETS } from './vfx_presets_flame.js'
import { LOCOMOTION_PRESETS } from './vfx_presets_locomotion.js'

/** @typedef {import('./vfx_preset_engine.js').VfxPreset} VfxPreset */
/** @typedef {import('./vfx_preset_engine.js').VfxEmitter} VfxEmitter */

// ── EXPLOSION family (VFXExplosionBB, ported 1:1 from ExplosionFX/effects/{ground,air,burst,nuke}/*.tscn):
// an OmniLight PULSE + Core fireball + Smoke billow + expanding Rings + flat ground Impact discs + Shrapnel.
// The .tscn ParticleProcessMaterial numbers (amount / velocity / damping / gravity / scale+alpha curves) are the
// spec — transcribed, not guessed. `light` = the scene's OmniLight vfx_light_energy (10 ground, 20 nuke, 0 = none)
// realised as a bright white-hot bloom quad on the pack's energy curve (the flat port had NO light — the #1 gap).
/**
 * @param {object} s
 * @param {string} s.name @param {number} s.duration
 * @param {[number,number,number]} s.hot near-white flash-core colour @param {[number,number,number]} s.fire body flame colour
 * @param {[number,number,number]} s.smoke smoke colour @param {number} [s.smoke_n] @param {number} [s.fire_n] @param {number} [s.shrap_n]
 * @param {boolean} [s.ground] flat ground shock discs @param {number} [s.scale] overall size mult @param {number} [s.smoke_rise]
 * @param {number} [s.light] OmniLight bloom energy factor (0..2 — 1≈energy10, 2≈nuke energy20; 0 = no light)
 * @returns {VfxPreset}
 */
export function explosion_preset(s) {
  const g = s.scale ?? 1
  const smoke_n = s.smoke_n ?? 34
  const fire_n = s.fire_n ?? 22 // fewer, so the fireball frames the bright core instead of a uniform orange fill
  const shrap_n = s.shrap_n ?? 16 // pack ground Shrapnel = 16
  const light = s.light ?? 1
  /** @type {VfxEmitter[]} */
  const emitters = [
    // LIGHT BLOOM — the pack OmniLight3D (vfx_light_energy 10/20) pulsing 0→1→0 (mult_times [0,0.05,0.5]): a big
    // white-hot flash that the AgX+bloom pass amplifies. WHITE core so it blooms bright under every element tint.
    {
      name: 'light',
      count: 1,
      lifetime: 0.42,
      explosiveness: 1,
      shape: 'point',
      offset: [0, 0.6 * g, 0],
      size: [4.6 * g * (0.7 + 0.3 * light), 4.6 * g * (0.7 + 0.3 * light)],
      size_curve: [0.4, 1.2, 1],
      alpha_curve: [0.35, 1, 0], // fast attack (the light energy spike) then decay to 0
      appearance: 'explo_core', // ExplosionFX explosion_core — the OmniLight-bloom flash (real pack shader, not generic glow)
      color: HOT,
      color_end: s.hot,
      emission: 2.6,
      opacity: Math.min(1, 0.7 + 0.3 * light),
    },
    // CORE — the pack Core (a bright white-hot glow ball, scale 0.8→1.4 grow): the detonation heart.
    {
      name: 'core',
      count: 1,
      lifetime: 0.5,
      explosiveness: 1,
      shape: 'point',
      offset: [0, 0.5 * g, 0],
      size: [2.4 * g, 2.4 * g],
      size_curve: [0.8, 1.4],
      alpha_curve: [1, 0],
      appearance: 'explo_core', // ExplosionFX explosion_core — the noise-carved white-hot detonation heart (real pack shader)
      color: HOT,
      color_end: s.hot,
      emission: 4,
    },
    // (the invented four_point_star 'flash' burst is DELETED — it appears in ZERO explosion scenes; the real
    //  detonation flash is explosion_core + the OmniLight, above. Constraint: cut EVERY non-Godot effect.)
    // FIREBALL — a radial ball of bright flame bursting outward, settling on drag, fading by ~0.7s.
    {
      name: 'fireball',
      count: fire_n,
      lifetime: 0.7,
      explosiveness: 1,
      shape: 'sphere',
      radius: 0.5 * g,
      offset: [0, 0.5 * g, 0],
      speed: [3 * g, 9 * g],
      gravity: [0, 1.5 * g, 0],
      drag: 3.2,
      size: [1 * g, 2.1 * g],
      size_curve: [0.55, 1, 0.7],
      alpha_curve: [0.95, 0.8, 0],
      appearance: 'explo_ball', // ExplosionFX explosion_sphere — the twisted molten-noise fireball body
      color: s.hot,
      color_end: s.fire,
      opacity: 0.6,
    },
    // SMOKE — pack Smoke (spread 60, rises gravity +2, damping 4): darker + dimmer so it FRAMES the bright core
    // (fire edge → dark smoke) instead of washing the whole detonation into a uniform tan haze.
    {
      name: 'smoke',
      count: smoke_n,
      lifetime: 1.8,
      explosiveness: 1,
      shape: 'sphere',
      radius: 0.9 * g,
      offset: [0, 0.7 * g, 0],
      speed: [2 * g, 4.2 * g],
      gravity: [0, (s.smoke_rise ?? 2.6) * g, 0],
      drag: 4,
      size: [1.2 * g, 2.5 * g],
      size_curve: [0.6, 1, 0.6],
      alpha_curve: [0.5, 0.4, 0],
      appearance: 'explo_smoke', // ExplosionFX explosion_smoke — the billowing framing cloud
      color: s.fire,
      color_end: s.smoke,
      opacity: 0.32,
    },
    // RINGS — the pack Rings (2-4 expanding cylinder shock annuli, alpha 0.5→1→0.5): the bright shockwave.
    {
      name: 'ring',
      count: 2,
      lifetime: 0.9,
      explosiveness: 0.8,
      shape: 'point',
      offset: [0, 0.5 * g, 0],
      size: [3.2 * g, 3.2 * g],
      size_curve: [0.5, 2.4],
      alpha_curve: [0.4, 0.95, 0],
      appearance: 'explo_rings', // ExplosionFX explosion_rings — the expanding shock ring (torus tube → radial band)
      blend: 'additive', // pack render_mode `blend_add` (vfx/extracted/**/explosion_rings.gdshader) — restores the punch (NORMAL washed it into a flat orange disc)
      color: s.fire, // pack primary (1,0.373,0.110)
      emission: 4, // pack shader_parameter/emission 4.0 (vfx_ground_explosion_01.tscn:273) — the flash the OmniLight-bloom `light` emitter above stands in for
    },
    // SHRAPNEL — pack Shrapnel (amount 16-64, velocity 15-30, spread 75-90, gravity -10, HARD damping 20-40 → a
    // punchy short streak that decelerates fast): fast embers arcing up + out then falling.
    {
      name: 'shrapnel',
      count: shrap_n,
      lifetime: 1,
      explosiveness: 1,
      shape: 'cone',
      offset: [0, 0.5 * g, 0],
      direction: [0, 1, 0],
      spread: 82,
      speed: [15 * g, 30 * g],
      gravity: [0, -10 * g, 0],
      drag: 7, // the pack's 20-40 damping folded to a visible-length exp streak
      size: [0.28 * g, 0.55 * g],
      size_curve: [1, 0.4],
      alpha_curve: [1, 0.9, 0],
      appearance: 'explo_trails', // ExplosionFX explosion_trails — the fast shrapnel streak ribbon (real pack shader)
      blend: 'additive', // pack render_mode `particle_trails, blend_add` (explosion_trails.gdshader) — bright streaks add over the scene, not muddy it
      color: s.fire,
      color_end: s.smoke,
      emission: 4, // pack emission 4.0 (vfx_ground_explosion_01.tscn:331)
    },
    // BITS — the pack Bits (explosion_bits): chunky rock chunks arcing up (amount 4, velocity 7-12), bright→dark.
    {
      name: 'bits',
      count: 4,
      lifetime: 1,
      explosiveness: 1,
      shape: 'cone',
      offset: [0, 0.5 * g, 0],
      direction: [0, 1, 0],
      spread: 55,
      speed: [7 * g, 12 * g],
      gravity: [0, -9 * g, 0],
      drag: 1.5,
      size: [0.5 * g, 0.9 * g],
      size_curve: [1, 0.7],
      alpha_curve: [1, 0.9, 0],
      appearance: 'explo_bits', // ExplosionFX explosion_bits — the rock chunks (mix(sec,pri,COLOR.a) bright→dark)
      color: s.fire,
      color_end: s.smoke,
      emission: 2.2,
    },
    // BITS TRAIL — the pack BitsTrail (smoke_trail): dark smoke wisps shed off the bits (tertiary grey), short-lived.
    {
      name: 'bits_trail',
      count: 20,
      lifetime: 0.6,
      explosiveness: 0.3,
      shape: 'sphere',
      radius: 0.4 * g,
      offset: [0, 0.6 * g, 0],
      speed: [1 * g, 2.5 * g],
      gravity: [0, 1 * g, 0],
      size: [0.6 * g, 1.2 * g],
      size_curve: [0.7, 1, 0.6],
      alpha_curve: [0.7, 0.4, 0],
      appearance: 'smoke_trail', // ExplosionFX smoke_trail — the dark bit-wisps (ALBEDO = tertiary ≈ color_end)
      color: s.fire,
      color_end: s.smoke,
      emission: 1.4,
      opacity: 0.5,
    },
  ]
  if (s.ground) {
    // GROUND IMPACT DISCS — the pack Impact1/Impact2 flat cylinders (scale ~5, thin), hugging the floor: a big
    // shock disc that snaps out + a slower scorch ring underneath.
    emitters.push({
      name: 'ground_disc',
      count: 1,
      lifetime: 0.9,
      explosiveness: 1,
      shape: 'point',
      offset: [0, 0.05 * g, 0],
      size: [4.4 * g, 4.4 * g],
      size_curve: [0.4, 2.6],
      alpha_curve: [0.9, 0.4, 0],
      appearance: 'explo_impact', // ExplosionFX explosion_impact — the flat streaky shock disc (Impact1, real pack shader)
      blend: 'additive', // pack render_mode `unshaded, blend_add` (explosion_impact.gdshader) — a crisp additive ground flash, not a solid orange plate
      color: s.fire,
      emission: 4, // pack emission 4.0 (Impact1, vfx_ground_explosion_01.tscn)
    })
    emitters.push({
      name: 'scorch',
      count: 1,
      lifetime: 1.4,
      explosiveness: 1,
      shape: 'point',
      offset: [0, 0.04 * g, 0],
      size: [3.4 * g, 3.4 * g],
      size_curve: [0.6, 1.6],
      alpha_curve: [0.6, 0.3, 0],
      appearance: 'explo_impact', // ExplosionFX explosion_impact — the slower under-scorch disc (Impact2, real pack shader)
      blend: 'additive', // pack `blend_add` (Impact2). Emission 3 (a documented hair under Impact1's 4) so the two stacked additive ground discs never form a static hotspot — the under-scorch reads as the dimmer seat.
      color: s.fire,
      emission: 3,
    })
  }
  return { name: s.name, duration: s.duration, flash: { color: s.hot, ms: 250 }, emitters }
}

// ── HIT family (VFXImpactBB, ported 1:1 from StylizedHitFX/effects/{hit,impact,big_impact,strike}/*.tscn):
// an OmniLight PULSE (energy 4, coloured the element/tint — mult_times [0.05,0.3]) + a bright ImpactSphere ball +
// a 4-point Spikes star that GROWS (scale 1→1.6) + a STAGGERED Flashes streak wave (emit_start≈0.15, the pack's
// signature second beat) + fast Sparks + a shockwave ring. `heavy` (big_impact) scales up the flashes + adds a
// soft billow; `sparks` (impact) drops the sparks under gravity. Numbers are the .tscn spec, not guesses.
/**
 * @param {object} s
 * @param {string} s.name @param {number} s.duration
 * @param {[number,number,number]} s.hot flash-core @param {[number,number,number]} s.tint gold/element body
 * @param {number} [s.scale] @param {boolean} [s.heavy] big-impact spray+billow @param {boolean} [s.sparks] gravity debris
 * @param {number} [s.spray_n] @param {number} [s.light] OmniLight bloom factor (0 = cold hit, no flash; default 1)
 * @returns {VfxPreset}
 */
export function hit_preset(s) {
  const g = s.scale ?? 1
  const light = s.light ?? 1
  /** @type {VfxEmitter[]} */
  const emitters = [
    // HALO — glow.gdshader on a SphereMesh: the pack OmniLight coloured bloom (centre-hot fresnel, mix(sec,pri,N·V^8)).
    // The DOMINANT element glow so a fire hit reads red / an ice hit blue at a glance, seating the white core.
    {
      name: 'halo',
      lifetime: 0.4,
      count: 1,
      geometry: 'sphere',
      appearance: 'sphere_glow',
      size: [2.7 * g, 2.7 * g],
      size_curve: [0.5, 1, 0.9],
      alpha_curve: [0.4, 1, 0],
      color: s.tint, // a COLOURED element bloom (the pack OmniLight is tinted) — the white is the tight core below
      color_end: s.tint,
      emission: 2.0 * Math.max(0.5, light),
      opacity: 0.85,
    },
    // CORE — impact_sphere.gdshader on a SphereMesh: a TIGHT white-hot DISPLACED ball (the pack ImpactSphere).
    // Emission > the 2.05 bloom threshold (lead ruling 2026-07-11): the white core SHOULD bloom in-engine = the punch.
    {
      name: 'core',
      lifetime: 0.34,
      count: 1,
      geometry: 'sphere',
      appearance: 'sphere_impact',
      size: [0.62 * g, 0.62 * g],
      size_curve: [1, 0.5],
      alpha_curve: [1, 0.9, 0],
      displace: 0.3,
      color: HOT,
      color_end: s.hot,
      emission: 2.4,
    },
    // FLARE — flare.gdshader: sharp radial spikes reaching WELL BEYOND the core (the pack's signature "flare" burst).
    {
      name: 'flare',
      count: 1,
      lifetime: 0.42,
      explosiveness: 1,
      shape: 'point',
      size: [5.4 * g, 7.6 * g],
      size_curve: [0.5, 1, 1.3],
      alpha_curve: [1, 0.6, 0],
      appearance: 'flare',
      color: HOT,
      color_end: s.tint,
      emission: 3,
      spin: 0.2,
    },
    // SPIKES — impact_core.gdshader: the expanding wavy swirl streaks (layermap ground truth: the Spikes node is
    // impact_core, streak_amount 9/5 — NOT four_point_star, which the audit mis-named; four_point_star lives only in
    // the plain-HIT HitCore). A sharp growing radial burst (the crisp pack Spikes). Constraint: cut EVERY non-Godot effect.
    {
      name: 'spikes',
      count: 2,
      lifetime: 0.4,
      explosiveness: 1,
      shape: 'point',
      size: [3 * g, 4.4 * g],
      size_curve: [0.6, 1, 1.5],
      alpha_curve: [1, 0.7, 0],
      appearance: 'impact_core', // StylizedHitFX impact_core.gdshader (was cross-pack star4 — audit #5)
      color: HOT,
      color_end: s.tint,
      emission: 2.4,
      spin: 0.25,
    },
    // FLASHES — impact_slash.gdshader: the pack Flashes_01/02 STAGGERED second-beat streak wave (emit_start≈0.15 →
    // `delay`, layermap-verified as impact_slash in every impact/big scene): pinched noise slashes flung radially.
    {
      name: 'flashes',
      count: s.spray_n ?? 14,
      lifetime: 0.5,
      explosiveness: 0.9,
      delay: 0.15,
      shape: 'sphere',
      radius: 0.2 * g,
      spread: 180,
      speed: [2.5 * g, 4.5 * g],
      drag: 4,
      size: [0.9 * g, 1.8 * g],
      size_curve: [0.5, 1.1, 0.6],
      alpha_curve: [0, 1, 0.7],
      appearance: 'impact_slash', // StylizedHitFX impact_slash.gdshader (was cross-pack star4 — audit #5)
      color: HOT,
      color_end: s.tint,
      emission: 2.2,
    },
    // SPARKS — the pack Sparks: fast radial slash-bits (velocity 10-20, damping 10), dropping under gravity on an
    // impact. Ground truth Sparks=glow; routed to impact_slash (the flung StylizedHitFX slash vocabulary) to kill the
    // generic FBM `spark` — not authored from the pack — while staying inside the Hit pack's own shader set.
    {
      name: 'sparks',
      count: s.sparks ? 12 : 6,
      lifetime: 0.34,
      explosiveness: 1,
      shape: 'sphere',
      radius: 0.15 * g,
      spread: 180,
      speed: [10 * g, 20 * g],
      gravity: s.sparks ? [0, -10 * g, 0] : [0, 0, 0],
      drag: 10,
      size: [0.4 * g, 0.9 * g],
      size_curve: [1, 0],
      alpha_curve: [1, 0],
      appearance: 'impact_slash', // StylizedHitFX impact_slash.gdshader (was the generic FBM 'spark')
      color: HOT,
      color_end: s.tint,
    },
    // SHOCK — impact_core.gdshader: an expanding wavy swirl shockwave (the pack shock ring, not a flat disc).
    {
      name: 'shock',
      count: 1,
      lifetime: 0.5,
      explosiveness: 1,
      shape: 'point',
      size: [3.4 * g, 3.4 * g],
      size_curve: [0.6, 1.9],
      alpha_curve: [0.85, 0.3, 0],
      appearance: 'impact_core',
      color: s.hot,
      color_end: s.tint,
      emission: 2.2,
    },
  ]
  if (s.sparks || s.heavy) {
    // SPIRAL DUST — the impact_03/05 GPUParticles3D spiral corona (spiral_dust.gdshader): a slow swirling dust ring
    // that lingers past the flash (pack lifetime 1.2, scale→2.5, amount 3). Only the impact/big beats carry it
    // (plain hit stays the lean glow+streaks beat). The last StylizedHitFX shader the audit flagged unported (#5).
    emitters.push({
      name: 'spiral',
      count: 3,
      lifetime: 1.0,
      explosiveness: 0.9,
      shape: 'point',
      size: [3.6 * g, 5.4 * g],
      size_curve: [0.3, 1, 1.4],
      alpha_curve: [0, 0.7, 0.4, 0],
      appearance: 'spiral_dust', // StylizedHitFX spiral_dust.gdshader (audit #5 — was never ported)
      color: HOT,
      color_end: s.tint,
      emission: 2,
      spin: 0.15,
    })
  }
  if (s.heavy) {
    // BIG FLARE — the big_impact larger, later radial spray (Flashes_01, emit_start 0.3 → delay).
    emitters.push({
      name: 'big_flare',
      count: 1,
      lifetime: 0.85,
      explosiveness: 1,
      delay: 0.28,
      shape: 'point',
      size: [5.6 * g, 8 * g],
      size_curve: [0.3, 1, 0.7],
      alpha_curve: [0, 1, 0],
      appearance: 'flare',
      color: HOT,
      color_end: s.tint,
      emission: 2.6,
      spin: 0.15,
    })
    // BILLOW — the big_impact soft element swell (glow.gdshader sphere blooming behind the flash).
    emitters.push({
      name: 'billow',
      lifetime: 0.6,
      delay: 0.05,
      count: 1,
      geometry: 'sphere',
      appearance: 'sphere_glow',
      size: [4 * g, 4 * g],
      size_curve: [0.5, 1],
      alpha_curve: [0, 0.7, 0],
      color: s.tint,
      color_end: s.tint,
      emission: 2,
      opacity: 0.6,
    })
  }
  return { name: s.name, duration: s.duration, flash: { color: s.hot, ms: 200 }, emitters }
}

// ── PALETTES. Godot fire = primary 1,0.37,0.11 · secondary 0.98,0.12,0 (folded to ≤1 hot); a WARMER variant
// for the _02/_04 scenes (Godot primary 1,0.36,0.31). Hits are white-cored with an ELEMENT ACCENT in the
// secondary — gold / ice / red / magenta, the four accents the .tscn scenes actually author (EXTRACT secondary).
const rgb = (/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b) =>
  /** @type {[number,number,number]} */ ([r, g, b])
const FIRE = { hot: rgb(1, 0.72, 0.4), fire: rgb(1, 0.37, 0.11), smoke: rgb(0.16, 0.14, 0.13) }
const FIRE_WARM = { hot: rgb(1, 0.74, 0.5), fire: rgb(1, 0.42, 0.28), smoke: rgb(0.18, 0.14, 0.12) }
const HOT = rgb(1, 1, 1)
// The four hit accents transcribed EXACTLY from the .tscn OmniLight light_color / Spikes secondary (EXTRACT
// secondary) — saturated to the pack's authored values (the port previously read paler than source): the
// port had desaturated approximations. gold=impact_01 · ice=impact_03 · red=impact_05 · mag=impact_07.
const ACCENT = {
  gold: rgb(1, 0.8, 0.4),
  ice: rgb(0.334, 0.847, 1),
  red: rgb(1, 0.382, 0.369),
  mag: rgb(0.964, 0.287, 0.842),
}

// ── THE 44 PORTED PRESETS (scene-faithful names). Explosions share explosion_preset (ground scenes add the
// flat shock disc; nuke scales up + lasts 4 s); hits share hit_preset (impact adds gravity sparks, big_impact
// adds the flash spray, strike is the lean slash). Per-scene: duration (Godot anim length), fire shade, and
// the hit accent — read from the .tscn via EXTRACT.json.
/** explosion scenes: [name, ground, {dur, warm, scale, smoke_n, shrap_n}] */
const EXPLO =
  /** @type {[string, 0|1, { dur:number, warm?:1, scale?:number, smoke_n?:number, shrap_n?:number }][]} */ ([
    ['air_explosion_00', 0, { dur: 2.6 }],
    ['air_explosion_01', 0, { dur: 2.6 }],
    ['air_explosion_02', 0, { dur: 2.6, warm: 1 }],
    ['air_explosion_03', 0, { dur: 3 }],
    ['air_explosion_04', 0, { dur: 3, warm: 1 }],
    ['burst_explosion_01', 0, { dur: 2.6 }],
    ['burst_explosion_02', 0, { dur: 2.6, warm: 1 }],
    ['burst_explosion_03', 0, { dur: 3 }],
    ['burst_explosion_04', 0, { dur: 3, warm: 1 }],
    ['ground_explosion_00', 1, { dur: 2.6 }],
    ['ground_explosion_01', 1, { dur: 2.6 }],
    ['ground_explosion_02', 1, { dur: 2.6, warm: 1 }],
    ['ground_explosion_03', 1, { dur: 3 }],
    ['ground_explosion_04', 1, { dur: 3, warm: 1 }],
    ['nuke_explosion_01', 1, { dur: 4, scale: 2.2, smoke_n: 52, shrap_n: 40 }],
    ['nuke_explosion_02', 1, { dur: 4, scale: 2.2, smoke_n: 52, shrap_n: 40, warm: 1 }],
  ])
/** hit scenes: [name, kind, accent, duration] */
const HITS = /** @type {[string, 'hit'|'impact'|'big'|'strike', keyof typeof ACCENT, number][]} */ ([
  ['hit_01', 'hit', 'gold', 1.0],
  ['hit_02', 'hit', 'gold', 1.0],
  ['hit_03', 'hit', 'ice', 1.0],
  ['hit_04', 'hit', 'ice', 1.0],
  ['hit_05', 'hit', 'red', 1.0],
  ['hit_06', 'hit', 'red', 1.0],
  ['hit_07', 'hit', 'mag', 1.0],
  ['hit_08', 'hit', 'mag', 1.0],
  ['impact_01', 'impact', 'gold', 1.3],
  ['impact_02', 'impact', 'gold', 1.3],
  ['impact_03', 'impact', 'ice', 1.3],
  ['impact_04', 'impact', 'ice', 1.3],
  ['impact_05', 'impact', 'red', 1.3],
  ['impact_06', 'impact', 'red', 1.3],
  ['impact_07', 'impact', 'mag', 1.3],
  ['impact_08', 'impact', 'mag', 1.3],
  ['big_impact_01', 'big', 'gold', 1.5],
  ['big_impact_02', 'big', 'gold', 1.5],
  ['big_impact_03', 'big', 'ice', 1.5],
  ['big_impact_04', 'big', 'ice', 1.5],
  ['big_impact_05', 'big', 'red', 1.5],
  ['big_impact_06', 'big', 'red', 1.5],
  ['big_impact_07', 'big', 'mag', 1.5],
  ['big_impact_08', 'big', 'mag', 1.5],
  ['strike_01', 'strike', 'gold', 1.1],
  ['strike_02', 'strike', 'ice', 1.1],
  ['strike_03', 'strike', 'red', 1.1],
  ['strike_04', 'strike', 'mag', 1.1],
])

export const PRESETS = /** @type {Record<string, VfxPreset>} */ ({})
for (const [name, ground, o] of EXPLO) {
  const pal = o.warm ? FIRE_WARM : FIRE
  PRESETS[name] = explosion_preset({
    name,
    duration: o.dur,
    hot: pal.hot,
    fire: pal.fire,
    smoke: pal.smoke,
    ground: !!ground,
    scale: o.scale,
    smoke_n: o.smoke_n,
    shrap_n: o.shrap_n,
    light: name.startsWith('nuke') ? 2 : 1, // nuke OmniLight energy 20 vs 10 → a bigger bloom
  })
}
for (const [name, kind, accent, dur] of HITS) {
  if (kind === 'strike') {
    // strike = the LEAN StylizedHitFX beat (streaks + four_point_star + light bloom) — NOT the 7-emitter hit_preset (audit #2).
    PRESETS[name] = strike_preset({ name, duration: dur, accent: ACCENT[accent] })
    continue
  }
  PRESETS[name] = hit_preset({
    name,
    duration: dur,
    hot: HOT,
    tint: ACCENT[accent],
    heavy: kind === 'big',
    sparks: kind === 'impact',
    light: accent === 'ice' ? 0.35 : 1, // the ice/water .tscn OmniLights are energy 0 — a cool hit barely flashes
  })
}

// ── PHASE-2 SPELL-CHAIN FAMILIES (vfx_presets_spell.js): charge (windup/caster-cell) · bolt (moving projectile) ·
// remnant/status LOOPs · earth-eruption / death-soul / weapon-slash bursts. Merged here so PRESETS/get_preset stay
// the ONE lookup surface the renderer + demos read; every fight layer now resolves to a 3D preset (zero sheets).
Object.assign(PRESETS, SPELL_PRESETS)
// ── WORLD/AMBIENCE PROPS (vfx_presets_world.js): the FlameFX bonfire/candle LOOP fixtures (world_bonfire_<tint>,
// world_candle_<tint>_0N) mounted in the dungeon rooms (cave_scene) + overworld (world_props). Same ONE lookup.
Object.assign(PRESETS, WORLD_PRESETS)
// ── MELEE + IMPACT lanes (landed): BattleFX claw/swing/slash_elem bursts (vfx_presets_melee.js) + BattleFX
// shield-ward · DarkMagic vortex · ElectricFX air-impact (vfx_presets_impact.js). Same ONE lookup surface.
Object.assign(PRESETS, MELEE_PRESETS)
Object.assign(PRESETS, IMPACT_PRESETS)
// ── b_spell lanes (landed): DarkMagic orb/bolt/zone (vfx_presets_dark.js) · ElectricFX air orb/zap/impact
// (vfx_presets_air.js) · ElementalMagic fire/nature/electric variants (vfx_presets_elemental.js) · FlameFX
// colour-variants (vfx_presets_flame.js). All resolve their looks through billboard_pack (this family's dispatch).
Object.assign(PRESETS, DARK_PRESETS, AIR_PRESETS, ELEM_VARIANT_PRESETS, FLAME_VARIANT_PRESETS)
// ── LOCOMOTION one-shots (vfx_presets_locomotion.js): the double-jump `dust_puff` bounce kick + future movement
// puffs. Same ONE lookup surface + one-shot runtime; the app plays it via PRESETS.dust_puff (embed_voxel_player).
Object.assign(PRESETS, LOCOMOTION_PRESETS)

// _debug — the low-instance-count REGRESSION GUARD the bench (vfx_presets.spec.js) keeps firing: 3 count-1 emitters
// at KNOWN positions (centre/left/right) probing the storage-buffer read path a raw instancedBufferAttribute
// misbinds at count 1/2. REAL pack looks now (fire / arcane_mote / impact_core — was the generic FBM flame/ring). Not a fight.
const dbg = (
  /** @type {string} */ name,
  /** @type {number} */ x,
  /** @type {NonNullable<VfxEmitter['appearance']>} */ look,
  /** @type {[number,number,number]} */ color,
  size = 2
) =>
  /** @type {VfxEmitter} */ ({
    name, count: 1, lifetime: 3, shape: 'point', offset: [x, 1, 0],
    size: [size, size], size_curve: [1, 0.9], alpha_curve: [1, 0], appearance: look, color,
  }) // prettier-ignore
PRESETS._debug = /** @type {VfxPreset} */ ({
  name: '_debug',
  duration: 3,
  emitters: [dbg('c', 0, 'fire', [1, 1, 1]), dbg('l', -3, 'arcane_mote', [1, 0.3, 0.3]), dbg('r', 3, 'impact_core', [0.3, 0.6, 1], 2.4)], // prettier-ignore
})

/** @param {string} name @returns {VfxPreset|undefined} */
export const get_preset = (name) => PRESETS[name]
/** @returns {string[]} */
export const list_presets = () => Object.keys(PRESETS)
