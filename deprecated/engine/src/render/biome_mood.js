// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// B5 BIOME MOOD CROSSFADER (ENGINE_AAA_PLAN §2 P2 / §6, behind ?mood=1). A CPU driver that samples the
// camera's biome and LERPS the ALREADY-LIVE atmosphere uniforms toward that biome's mood preset over
// ~4 s — per-biome AAA identity (fog / grade / cloud / particle mood) at ~zero GPU cost. NO new shader,
// NO new pass, NO new varying. The whole payload is a handful of uniform writes per frame.
//
// INVARIANTS (restated from the brief — this file obeys them structurally):
//  • flag-off = ZERO behavioural delta. The driver is CREATED only under ?mood=1 (engine.js gate); with
//    the flag off nothing here runs and the shipped ATMO_CONFIG stands byte-identical (frozen-MEDIUM law).
//  • writes ONLY through EXISTING atmosphere uniforms/setters (grade.set / near_haze / fog_sea /
//    clouds.coverage / clouds.density / particles.opacity). It NEVER edits atmosphere.js or clouds.js
//    internals (standing teardown-fix rule): uniforms/setters only.
//  • presets live INSIDE validate_atmo_config's accepted ranges. `resolve_dials` is the SINGLE HOME for
//    the safety clamps (whiteout band, cloud-coverage bounds, contrast≥1, ±20% grade-delta law); the
//    unit test runs validate_atmo_config on every preset (and crossfade midpoints) through it.
//  • grade SATURATION is left to time-of-day. `atmosphere.on_time_of_day` owns the D173 night
//    desaturation (its single home); mood drives only grade CONTRAST + VIBRANCE — which tod never
//    touches — so the two never fight and night desaturation survives with mood on.
//  • no white-halo values: near_haze is capped strictly under the whiteout band, cloud coverage in
//    [0.05,0.95]; the brightest/darkest presets are screenshot-gated by the acceptance capture.
//
// The mood presets are DELTAS (multipliers, 1 = neutral) around the shipped CONQUEST atmosphere, so a
// world with no authored row — and the default/grassland biome — reads exactly as today (§6 parity).

import { get_biome_by_id } from '../config/biome_registry.js'

/** Crossfade duration in seconds (the ~4 s the plan specs). */
export const CROSSFADE_SECONDS = 4
/** Biome re-sample cadence — the driver probes the camera column at most this often (cheap pure query). */
export const SAMPLE_INTERVAL_SECONDS = 1

/**
 * A biome mood, expressed as MULTIPLIERS on the shipped ATMO_CONFIG (1 = neutral / delta-zero). Grade
 * muls are held to ±20% (the global grade is only nudged, never replaced); fog/cloud/particle
 * muls range wider but are clamped into validate_atmo_config's caps by `resolve_dials`.
 * @typedef {object} MoodPreset
 * @property {number} contrast     ×grade.contrast (low-freq plane separation)
 * @property {number} vibrance     ×grade.vibrance (muted-chroma lift)
 * @property {number} haze         ×froxel.near_haze (aerial fog density)
 * @property {number} fog_sea      ×froxel.fog_sea_density (valley mist; 0 = off — deserts)
 * @property {number} cloud_cover  ×cloud.coverage
 * @property {number} cloud_density ×cloud.density
 * @property {number} particles    ×particles.opacity (ambient fade; visible only when a kind is on)
 * @property {string} [particle_kind] B7: the biome's ambient particle KIND (render/particles.js
 *   PARTICLE_KINDS — 'firefly'|'pollen'|'ember'|'snow'|'leaf'|'ambient'). A DISCRETE per-biome selector,
 *   NOT a crossfade dial (you don't blend fireflies into pollen) — the wiring wave reads it at biome
 *   change and calls `create_particles({kind})`; `resolve_dials`/`lerp_mood` never touch it (additive).
 *   OPTIONAL: authored presets always set it, but a lerp_mood crossfade MIDPOINT legitimately omits it
 *   (a transient dial-state between two biomes has no single kind).
 * @property {number} [particle_density] B7: ×ambient particle COUNT for this biome's kind (dense fireflies
 *   vs sparse desert dust). Data for the wiring wave's count budget; not an atmosphere dial. Optional for
 *   the same reason as particle_kind.
 */

/** Identity mood — the shipped look, delta-zero. Fallback for any biome without an authored row. The
 *  particle default is the neutral 'ambient' mixed field (dust + leaves) at unit density. */
export const NEUTRAL_MOOD = Object.freeze({
  contrast: 1,
  vibrance: 1,
  haze: 1,
  fog_sea: 1,
  cloud_cover: 1,
  cloud_density: 1,
  particles: 1,
  particle_kind: 'ambient',
  particle_density: 1,
})

/** @param {Partial<MoodPreset>} p @returns {MoodPreset} a preset with NEUTRAL for any unstated dial. */
const mood = (p) => Object.freeze({ ...NEUTRAL_MOOD, ...p })

/**
 * Per-biome mood table (§6). Keyed by BIOME_REGISTRY name. Authored from each biome's identity within
 * the safe ranges above. grassland — the biome the CONQUEST grade was tuned on — is the NEUTRAL anchor,
 * so standing in the default world with ?mood=1 reads exactly as the shipped atmosphere.
 * @type {Record<string, MoodPreset>}
 */
export const MOOD_PRESETS = Object.freeze({
  // temperate baseline — the tuned look. Dials kept delta-zero (the parity anchor: resolve_dials ==
  // NEUTRAL), + the meadow's noon POLLEN drift (a discrete particle selector, not an atmosphere dial).
  grassland: mood({ particle_kind: 'pollen' }),
  ocean: mood({ haze: 1.15, fog_sea: 0.8, cloud_cover: 1.05 }),
  beach: mood({ contrast: 1.02, vibrance: 1.1, haze: 0.8, fog_sea: 0.5, cloud_cover: 0.9, particles: 0.8 }),
  river: mood({ vibrance: 1.05, haze: 1.1, particles: 1.1 }),
  // woodland — moodier, hazier, more overcast the denser it gets; leaf-fall drifts under the canopy.
  temperate_forest: mood({
    contrast: 1.05,
    vibrance: 1.05,
    haze: 1.2,
    cloud_cover: 1.1,
    cloud_density: 1.05,
    particles: 1.2,
    particle_kind: 'leaf',
  }),
  dense_forest: mood({
    contrast: 1.12,
    vibrance: 0.98,
    haze: 1.6,
    fog_sea: 1.2,
    cloud_cover: 1.2,
    cloud_density: 1.1,
    particles: 1.5,
    particle_kind: 'leaf',
    particle_density: 1.2,
  }),
  // swamp — THE misty biome: valley mist on, heavy haze, overcast, murky low contrast, night FIREFLIES.
  swamp: mood({
    contrast: 0.9,
    vibrance: 0.92,
    haze: 2.6,
    fog_sea: 2.5,
    cloud_cover: 1.35,
    cloud_density: 1.15,
    particles: 1.8,
    particle_kind: 'firefly',
    particle_density: 1.4,
  }),
  // taiga — the awe/cathedral biome: crisp cold clear air, firm contrast (plane separation for scale).
  taiga: mood({ contrast: 1.15, vibrance: 1.02, haze: 0.75, fog_sea: 0.6, cloud_cover: 1.05, particles: 1.1 }),
  // arctic / glacier — high-key white: flatter contrast, thick overcast, drifting SNOW.
  arctic: mood({
    contrast: 0.9,
    vibrance: 0.95,
    haze: 1.3,
    fog_sea: 1.4,
    cloud_cover: 1.4,
    cloud_density: 1.15,
    particles: 1.5,
    particle_kind: 'snow',
    particle_density: 1.4,
  }),
  glacier: mood({
    contrast: 0.92,
    vibrance: 0.95,
    haze: 1.2,
    fog_sea: 1.3,
    cloud_cover: 1.4,
    cloud_density: 1.15,
    particles: 1.4,
    particle_kind: 'snow',
    particle_density: 1.4,
  }),
  // desert — bone-dry crisp: NO valley mist, thin haze, sparse cloud, harsh contrast, sparse dust motes.
  desert: mood({
    contrast: 1.18,
    vibrance: 1.15,
    haze: 0.5,
    fog_sea: 0,
    cloud_cover: 0.5,
    cloud_density: 0.9,
    particles: 0.6,
    particle_density: 0.6,
  }),
  // scorched — smouldering: heat haze, harsh contrast, floating EMBERS.
  scorched_badlands: mood({
    contrast: 1.2,
    vibrance: 1.1,
    haze: 1.8,
    fog_sea: 0.3,
    cloud_cover: 0.7,
    cloud_density: 0.95,
    particles: 1.6,
    particle_kind: 'ember',
    particle_density: 1.2,
  }),
  // tropical — lush, humid, saturated, overcast, blooming POLLEN.
  tropical: mood({
    contrast: 1.06,
    vibrance: 1.18,
    haze: 1.4,
    fog_sea: 1.1,
    cloud_cover: 1.3,
    cloud_density: 1.1,
    particles: 1.3,
    particle_kind: 'pollen',
    particle_density: 1.2,
  }),
  // alpine — thin clear high-altitude air, firm contrast.
  alpine: mood({ contrast: 1.16, vibrance: 1.05, haze: 0.7, fog_sea: 0.8, cloud_cover: 1.1, particles: 1.1 }),
  // esoteric trio — magical / dark / drowned moods (glowing motes / volcanic embers / drowned fireflies).
  crystal_hollows: mood({
    contrast: 1.1,
    vibrance: 1.12,
    haze: 1.5,
    fog_sea: 1.3,
    cloud_cover: 1.1,
    cloud_density: 1.05,
    particles: 1.7,
    particle_kind: 'firefly',
    particle_density: 1.3,
  }),
  obsidian_spires: mood({
    contrast: 1.2,
    vibrance: 0.95,
    haze: 1.6,
    fog_sea: 0.8,
    cloud_cover: 0.8,
    particles: 1.5,
    particle_kind: 'ember',
    particle_density: 1.1,
  }),
  void_marsh: mood({
    contrast: 0.88,
    vibrance: 0.9,
    haze: 2.8,
    fog_sea: 2.8,
    cloud_cover: 1.4,
    cloud_density: 1.2,
    particles: 1.9,
    particle_kind: 'firefly',
    particle_density: 1.5,
  }),
})

/** @param {number} x @param {number} lo @param {number} hi @returns {number} clamp. */
const clampf = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x)
/** @param {number} t @returns {number} Hermite smoothstep on [0,1] (the crossfade ease — no-pop C¹). */
const smooth01 = (t) => {
  const u = t < 0 ? 0 : t > 1 ? 1 : t
  return u * u * (3 - 2 * u)
}
/** ±20% grade-delta law: the frozen grade is only nudged. @param {number} m @returns {number} */
const grade_mul = (m) => clampf(m, 0.8, 1.2)

/**
 * The dominant biome id → its mood preset (name lookup), NEUTRAL for unauthored / unknown ids.
 * @param {number} biome_id
 * @returns {MoodPreset}
 */
export function mood_for_biome(biome_id) {
  const def = get_biome_by_id(biome_id)
  return (def && MOOD_PRESETS[def.name]) || NEUTRAL_MOOD
}

/**
 * Pure component-wise lerp of two mood presets. @param {MoodPreset} a @param {MoodPreset} b
 * @param {number} t [0,1] @returns {MoodPreset}
 */
export function lerp_mood(a, b, t) {
  const l = (/** @type {number} */ x, /** @type {number} */ y) => x + (y - x) * t
  return {
    contrast: l(a.contrast, b.contrast),
    vibrance: l(a.vibrance, b.vibrance),
    haze: l(a.haze, b.haze),
    fog_sea: l(a.fog_sea, b.fog_sea),
    cloud_cover: l(a.cloud_cover, b.cloud_cover),
    cloud_density: l(a.cloud_density, b.cloud_density),
    particles: l(a.particles, b.particles),
  }
}

/**
 * @typedef {object} MoodDials the ABSOLUTE, validate-safe atmosphere values a mood resolves to.
 * @property {number} contrast @property {number} vibrance @property {number} near_haze
 * @property {number} fog_sea @property {number} cloud_coverage @property {number} cloud_density
 * @property {number} particle_opacity
 */

/**
 * Resolve a mood (multipliers) against a base atmosphere config → ABSOLUTE, VALIDATE-SAFE dial values.
 * THE SINGLE HOME for the safety clamps, so the live driver writes and the validate test can never
 * drift: near_haze is capped under the whiteout band (near_haze·band ≤ 0.7 ⇒ <0.004), contrast ≥ 1
 * (validate floor), cloud coverage ∈ [0.05,0.95] (⊂ [0,1]), density > 0, grade muls held to ±20%.
 * @param {import('./atmosphere.js').AtmosphereConfig} base
 * @param {MoodPreset} m
 * @returns {MoodDials}
 */
export function resolve_dials(base, m) {
  const g = base.grade
  const f = base.froxel
  const c = base.cloud
  const p = base.particles
  return {
    contrast: clampf(g.contrast * grade_mul(m.contrast), 1.0, 1.6),
    vibrance: clampf(g.vibrance * grade_mul(m.vibrance), 0, 0.5),
    near_haze: clampf(f.near_haze * Math.max(0, m.haze), 0, 0.0038),
    fog_sea: Math.max(0, f.fog_sea_density * m.fog_sea),
    cloud_coverage: clampf(c.coverage * m.cloud_cover, 0.05, 0.95),
    cloud_density: Math.max(0.05, c.density * m.cloud_density),
    particle_opacity: clampf(p.opacity * m.particles, 0, 1),
  }
}

/**
 * Build a full AtmosphereConfig clone with a mood applied — the input to validate_atmo_config (proof
 * bar: validate green per preset). Only the seven mood-driven dials move; everything else is the base.
 * @param {import('./atmosphere.js').AtmosphereConfig} base
 * @param {MoodPreset} m
 * @returns {import('./atmosphere.js').AtmosphereConfig}
 */
export function mood_to_atmo_config(base, m) {
  const d = resolve_dials(base, m)
  return {
    cloud: { ...base.cloud, coverage: d.cloud_coverage, density: d.cloud_density },
    froxel: { ...base.froxel, near_haze: d.near_haze, fog_sea_density: d.fog_sea },
    godrays: { ...base.godrays },
    bloom: { ...base.bloom },
    particles: { ...base.particles },
    grade: { ...base.grade, contrast: d.contrast, vibrance: d.vibrance },
  }
}

/**
 * The live atmosphere handle the driver writes through (the subset of atmosphere.js's return it needs).
 * @typedef {object} MoodAtmo
 * @property {import('./atmosphere.js').AtmosphereConfig} config the shipped/base config (mood is a delta on it)
 * @property {{ set:(cfg:{contrast?:number,vibrance?:number})=>void }} grade the grade node
 * @property {{ value:number }} near_haze froxel aerial-fog σ
 * @property {{ value:number }} fog_sea froxel valley-mist strength
 * @property {{ coverage:{value:number}, density:{value:number} }} clouds cloud deck
 * @property {{ opacity:{value:number} }} particles ambient particle layer
 */

/**
 * @typedef {object} MoodDriver
 * @property {(dt_seconds:number, cam_x:number, cam_z:number)=>void} tick advance sampling + crossfade,
 *   then write the current mood through the atmosphere uniforms. Additive engine tick hook.
 * @property {()=>{ biome:number, blend:number, mood:MoodPreset, dials:MoodDials }} current live state
 *   (for the acceptance capture — reads the interpolated mood + resolved dials).
 * @property {()=>void} dispose no-op (owns no GPU resources; the caller drops the ref).
 */

/**
 * Create the biome-mood driver. Instantiated ONLY under ?mood=1 (engine.js) — its mere absence is the
 * flag-off parity guarantee. On the first tick it snaps to the camera's biome (no boot pop); thereafter
 * it re-samples ≤1/s and crossfades current→target over `crossfade_seconds` with a smoothstep ease
 * (retargets from the live interpolated state, so a border straddle never pops). LOW tier snaps (§7.3).
 * @param {object} opts
 * @param {MoodAtmo} opts.atmo the live atmosphere handle (atmosphere.js return)
 * @param {(x:number, z:number)=>number} opts.sample_biome pure camera-column biome-id probe
 * @param {string} [opts.tier] quality tier ('low' snaps the crossfade per the degrade order)
 * @param {number} [opts.crossfade_seconds]
 * @returns {MoodDriver}
 */
export function create_mood_driver({ atmo, sample_biome, tier = 'high', crossfade_seconds = CROSSFADE_SECONDS }) {
  const base = atmo.config
  const snap = tier === 'low' // §7.3 LOW degrade: mood crossfade snaps (no lerp)
  /** @type {MoodPreset} */ let from = NEUTRAL_MOOD
  /** @type {MoodPreset} */ let to = NEUTRAL_MOOD
  /** @type {MoodPreset} */ let cur = NEUTRAL_MOOD
  let blend = 1 // 1 = settled at `to`
  let since_sample = SAMPLE_INTERVAL_SECONDS // force a probe on the very first tick
  let current_biome = -1
  let initialized = false

  /** Write the current mood through the live atmosphere uniforms. @param {MoodPreset} m */
  const write = (m) => {
    const d = resolve_dials(base, m)
    // grade: contrast + vibrance ONLY — saturation stays tod-owned (D173 night desaturation, one home).
    atmo.grade.set({ contrast: d.contrast, vibrance: d.vibrance })
    atmo.near_haze.value = d.near_haze
    atmo.fog_sea.value = d.fog_sea
    atmo.clouds.coverage.value = d.cloud_coverage
    atmo.clouds.density.value = d.cloud_density
    atmo.particles.opacity.value = d.particle_opacity
  }

  /** Begin (or snap) a crossfade toward a newly-sampled biome. @param {number} id */
  const retarget = (id) => {
    if (id === current_biome) return
    current_biome = id
    from = cur // fade FROM the live interpolated state → no pop mid-straddle
    to = mood_for_biome(id)
    blend = snap ? 1 : 0
    if (snap) cur = to
  }

  /** @param {number} dt @param {number} cam_x @param {number} cam_z */
  const tick = (dt, cam_x, cam_z) => {
    if (!(dt >= 0)) dt = 0
    since_sample += dt
    if (!initialized || since_sample >= SAMPLE_INTERVAL_SECONDS) {
      since_sample = 0
      const id = sample_biome(cam_x, cam_z)
      if (!initialized) {
        initialized = true
        current_biome = id
        from = to = cur = mood_for_biome(id) // snap to the spawn biome — no boot crossfade
      } else {
        retarget(id)
      }
    }
    if (blend < 1) {
      blend = Math.min(1, blend + dt / crossfade_seconds)
      cur = lerp_mood(from, to, smooth01(blend))
    }
    write(cur)
  }

  return {
    tick,
    current: () => ({ biome: current_biome, blend, mood: cur, dials: resolve_dials(base, cur) }),
    dispose: () => {},
  }
}
