// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FLAGSHIP VFX — the ELEMENTAL-MAGIC variant b_spell family: ElementalMagicFX's OWN fire / nature / electric
// cast+projectile+area scenes, reclaimed as element-flavoured spell variants (today fire/air borrow FlameFX/
// ElectricFX entirely — this puts the paid ElementalMagic variants on screen). Wave-A coverage lane
// (docs/VFX_FULL_UTILIZATION_PLAN.md §L5 / scripts/vfx_scene_consumers.json b_spell — the LOWEST shader-cost lane,
// pure reuse of the already-ported ElementalMagic look): 18 scenes (3 elements × cast/projectile/area × 2).
//   • elem_variant_<el>_cast — the gathering WINDUP flare (cast_flare)
//   • elem_variant_<el>_bolt — the flowing projectile ORB + wake (projectile_core/tail/streaks/particles)
//   • elem_variant_<el>_area — the polar magic-circle ground ZONE (area_ground) for AoE/glyph spells
//
// PORT METHOD: the three ElementalMagic tints are transcribed EXACT from each scene's root primary/secondary/
// tertiary — fire (1,0.8,0.2 / 1,0.4,0.102 / 0.6,0.102,0.051) · nature yellow-green (0.745,0.835,0 /
// 0.173,0.741,0 / 0.259,0.294,0) · electric GOLD-lightning (1,0.919,0.788 / 1,0.729,0.157 / 0.616,0.412,0 — NOT
// the blue ElectricFX; this is ElementalMagic's own amber arc). color = primary, color_end = secondary; the
// tertiary edge is auto-derived (deep = sec×0.4) by the ported elem_* shaders (the established phase-B idiom).
//
// APPEARANCE REUSE (fence: shader files are another lane's — READ-only, ZERO new shaders per the L5 plan): every
// look is ALREADY ported op-for-op in phase B — elem_flare (cast_flare), elem_orb (projectile_core), elem_tail
// (projectile_tail), elem_streak (projectile_streaks), elem_mote (projectile_particles), elem_area (area_ground).
// AREA_GLOW (audit #9, B2): the additive area_glow bloom layer (the water-area Glow_01/Glow_02 rising energy veil,
// 0 hits before B2) is NOW ported (vfx_pack_shaders_gapfill `area_glow`, node→shader verified) and layered on the zone —
// no longer skipped. The ported area_ground magic-circle + this glow curtain are the full ground read.

/** @typedef {import('./vfx_preset_types.js').VfxPreset} VfxPreset */
/** @typedef {import('./vfx_preset_types.js').VfxEmitter} VfxEmitter */

const rgb = (/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b) =>
  /** @type {[number,number,number]} */ ([r, g, b])
const clamp1 = (/** @type {[number,number,number]} */ c) =>
  /** @type {[number,number,number]} */ ([Math.min(1, c[0]), Math.min(1, c[1]), Math.min(1, c[2])])

// ── THREE ELEMENTAL TINTS (exact scene primary/secondary). `hot` = a bright near-primary core for the flare/head.
const ELEM = /** @type {Record<string, { pri:[number,number,number], sec:[number,number,number] }>} */ ({
  fire: { pri: rgb(1, 0.8, 0.2), sec: rgb(1, 0.4, 0.102) },
  nature: { pri: rgb(0.745, 0.835, 0), sec: rgb(0.173, 0.741, 0) },
  electric: { pri: rgb(1, 0.919, 0.788), sec: rgb(1, 0.729, 0.157) },
})

// ── CAST (elem_variant_<el>_cast): a gathering windup flare (cast_flare) + a few flicking motes.
/** @param {{ name:string, pri:[number,number,number], sec:[number,number,number] }} s @returns {VfxPreset} */
export function elem_cast_preset(s) {
  return {
    name: s.name,
    duration: 0.6,
    emitters: [
      // FLARE — the ElementalMagic windup gather (cast_flare): a rising energy band with a bright top glow.
      {
        name: 'flare',
        count: 1,
        lifetime: 0.55,
        explosiveness: 1,
        shape: 'point',
        offset: [0, 0.3, 0],
        size: [2.4, 2.4],
        size_curve: [0.4, 1.1, 0.9],
        alpha_curve: [0, 1, 0.6],
        appearance: 'elem_flare',
        color: s.pri,
        color_end: s.sec,
        emission: 1.6,
      },
      // EMBERS — projectile_particles motes flicking up off the gather.
      {
        name: 'embers',
        count: 14,
        lifetime: 0.5,
        explosiveness: 0.4,
        shape: 'sphere',
        radius: 0.6,
        offset: [0, 0.3, 0],
        spread: 180,
        speed: [1.5, 3],
        gravity: [0, 1.2, 0],
        drag: 1.5,
        size: [0.4, 0.8],
        size_curve: [1, 0.3],
        alpha_curve: [0.9, 0],
        appearance: 'elem_mote',
        color: s.pri,
        color_end: s.sec,
      },
    ],
  }
}

// ── BOLT (elem_variant_<el>_bolt): the flowing projectile — a wave-orb head + a comet tail wake + spiral streaks,
// run as a LOOP while the runtime advances origin/travel.
/** @param {{ name:string, pri:[number,number,number], sec:[number,number,number] }} s @returns {VfxPreset} */
export function elem_bolt_preset(s) {
  return {
    name: s.name,
    duration: 1.2,
    loop: true,
    emitters: [
      // HEAD — the flowing wave-orb (projectile_core) riding the projectile.
      {
        name: 'head',
        count: 6,
        lifetime: 0.18,
        explosiveness: 0.4,
        shape: 'sphere',
        radius: 0.18,
        speed: [0.4, 0.9],
        size: [1.1, 1.7],
        size_curve: [1, 0.85],
        alpha_curve: [1, 0.9],
        appearance: 'elem_orb',
        color: s.pri,
        color_end: s.sec,
        emission: 1.6,
      },
      // TRAIL — the comet wake (projectile_tail), world-static behind the head.
      {
        name: 'trail',
        count: 24,
        lifetime: 0.28,
        explosiveness: 0.2,
        shape: 'sphere',
        radius: 0.12,
        trail: true,
        spread: 180,
        speed: [0.6, 1.6],
        size: [0.5, 1],
        size_curve: [1, 0],
        alpha_curve: [0.9, 0],
        appearance: 'elem_tail',
        color: s.pri,
        color_end: s.sec,
      },
      // AURA — spiralling streaks hugging the head so it reads as an energy orb, not a dot.
      {
        name: 'aura',
        count: 10,
        lifetime: 0.2,
        explosiveness: 0.3,
        shape: 'sphere',
        radius: 0.34,
        speed: [0.5, 1.4],
        size: [0.9, 1.5],
        size_curve: [0.7, 1, 0.4],
        alpha_curve: [0.55, 0],
        appearance: 'elem_streak',
        color: s.sec,
        color_end: s.sec,
        emission: 1.5,
        opacity: 0.6,
      },
    ],
  }
}

// ── AREA (elem_variant_<el>_area): a persistent ground ZONE (the polar magic-circle area_ground) + rising motes,
// for AoE / glyph spells. SUSTAINED ⇒ colours clamp1'd + low emission (never blooms).
/** @param {{ name:string, pri:[number,number,number], sec:[number,number,number] }} s @returns {VfxPreset} */
export function elem_area_preset(s) {
  const pri = clamp1(s.pri)
  const sec = clamp1(s.sec)
  return {
    name: s.name,
    duration: 2.6,
    loop: true,
    emitters: [
      // SEAT — the ElementalMagic polar magic-circle on the floor (area_ground): the zone footprint.
      {
        name: 'seat',
        count: 1,
        lifetime: 2.4,
        shape: 'point',
        offset: [0, 0.06, 0],
        size: [2.8, 2.8],
        size_curve: [0.85, 1.05, 0.9],
        alpha_curve: [0, 0.45, 0.35, 0],
        appearance: 'elem_area',
        color: sec,
        color_end: pri,
        emission: 1,
        opacity: 0.46,
      },
      // GLOW — the ElementalMagic area_glow curtain (the Glow_01/Glow_02 bloom layer beside area_ground): a rising
      // energy veil off the magic circle (audit #9 — now ported). Clamped + low emission ⇒ never blooms (sustained).
      {
        name: 'glow',
        count: 1,
        lifetime: 2.4,
        shape: 'point',
        offset: [0, 0.55, 0],
        size: [2.4, 2.4],
        size_curve: [0.7, 1, 0.85],
        alpha_curve: [0, 0.4, 0.32, 0],
        appearance: 'area_glow',
        color: pri,
        color_end: sec,
        emission: 1,
        opacity: 0.45,
      },
      // HAZE — a few slow motes drifting up off the zone (projectile_particles): the subtle life.
      {
        name: 'haze',
        count: 12,
        lifetime: 2.2,
        explosiveness: 0.1,
        shape: 'sphere',
        radius: 1.25,
        offset: [0, 0.2, 0],
        direction: [0, 1, 0],
        spread: 40,
        speed: [0.2, 0.6],
        gravity: [0, 0.35, 0],
        drag: 1,
        size: [0.4, 0.95],
        size_curve: [0.3, 1, 0.4],
        alpha_curve: [0, 0.55, 0],
        appearance: 'elem_mote',
        color: sec,
        color_end: pri,
        emission: 1,
        opacity: 0.5,
        spin: 0.8,
      },
    ],
  }
}

// ── ASSEMBLE — 3 elements × { cast, bolt, area } = 9 presets covering the 18 ElementalMagic variant scenes.
// Names carry the manifest token elem_variant.
export const ELEM_VARIANT_PRESETS = /** @type {Record<string, VfxPreset>} */ ({})
for (const [el, c] of Object.entries(ELEM)) {
  ELEM_VARIANT_PRESETS[`elem_variant_${el}_cast`] = elem_cast_preset({ name: `elem_variant_${el}_cast`, ...c })
  ELEM_VARIANT_PRESETS[`elem_variant_${el}_bolt`] = elem_bolt_preset({ name: `elem_variant_${el}_bolt`, ...c })
  ELEM_VARIANT_PRESETS[`elem_variant_${el}_area`] = elem_area_preset({ name: `elem_variant_${el}_area`, ...c })
}
