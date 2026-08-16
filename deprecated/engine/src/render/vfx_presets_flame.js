// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FLAGSHIP VFX — the FLAME colour-variant b_spell family: FlameFX's five recoloured fire scenes reclaimed as
// element-flavoured flame LOOPs (a lingering coloured flame — status flame / remnant / flavour layer, faithful to
// the pack's STANDING-flame scene). Wave-A coverage lane (docs/VFX_FULL_UTILIZATION_PLAN.md §L6 /
// scripts/vfx_scene_consumers.json b_spell — reuse `fire`, ZERO new shaders): 10 scenes (5 tints × 2).
// Mapped by FLAVOUR (the variant selector, vfx_variants.js): cold → water/frost · green → nature/poison-dot ·
// purple → arcane/neutral · void → death (Yajin) · light → heal.
//
// PORT METHOD + the fire_particle colour model (B2): the ported `fire` (fire_particle) now renders the REAL pack
// 2-hue model — mix(primary, secondary, COLOR.r) · (1 − COLOR.r) — so each tint shows BOTH its authored hues: a
// bright PRIMARY body with the SECONDARY 2nd hue in the dim licks (audit #4 — the fire_particle re-port unlocked
// this fidelity). color = the pack scene primary, color_end = the pack scene SECONDARY (both transcribed EXACT from
// vfx_<tint>_fire_01, node→shader verified). VOID is the one exception: its pack primary is near-black (0.02,0,0.137
// — a black flame is invisible) and its secondary an HDR magenta (2.84,1.21,10.58), so it uses a folded magenta pair.
//
// APPEARANCE REUSE (fence: shader files are another lane's — READ-only): the FlameFX look is ALREADY ported
// op-for-op in phase A as `fire` (fire_particle). These LOOPs reuse it recoloured — the same reuse the WORLD-PROPS
// bonfire/candle lane makes (vfx_presets_world.js).

/** @typedef {import('./vfx_preset_types.js').VfxPreset} VfxPreset */
/** @typedef {import('./vfx_preset_types.js').VfxEmitter} VfxEmitter */

const rgb = (/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b) =>
  /** @type {[number,number,number]} */ ([r, g, b])
const clamp1 = (/** @type {[number,number,number]} */ c) =>
  /** @type {[number,number,number]} */ ([Math.min(1, c[0]), Math.min(1, c[1]), Math.min(1, c[2])])

// ── FIVE FLAME TINTS — the REAL pack 2-hue pairs (primary body + secondary 2nd hue), transcribed exact from each
// vfx_<tint>_fire_01 scene's fire_particle ShaderMaterial (layermap 2026-07-12). The new fire_particle 2-hue model
// renders both. Distinct reads: pale-gold+magenta · green+teal · holy-white+cyan · lavender+deep-blue · void-magenta.
export const FLAME_VARIANT_TINTS = /** @type {const} */ (['cold', 'green', 'light', 'purple', 'void'])
const FLAME = /** @type {Record<string, { pri:[number,number,number], sec:[number,number,number] }>} */ ({
  cold: { pri: rgb(1, 1, 0.557), sec: rgb(0.616, 0, 0.282) }, // pale-gold body + magenta-red licks (cold_01 exact)
  green: { pri: rgb(0.524, 1, 0.449), sec: rgb(0, 0.357, 0.508) }, // green body + teal-blue licks (green_01 exact)
  light: { pri: rgb(1, 1, 1), sec: rgb(0, 0.788, 0.876) }, // holy-white body (HDR folded) + cyan licks (light_01)
  purple: { pri: rgb(0.776, 0.713, 1), sec: rgb(0.061, 0, 0.972) }, // lavender body + deep-blue licks (purple_01 exact)
  void: { pri: rgb(0.75, 0.32, 1), sec: rgb(0.32, 0.08, 0.5) }, // folded magenta pair (pack primary is near-black)
})

// ── FLAME LOOP (flame_variant_<tint>): a rising column of coloured flame motes + a warm base glow, run as a LOOP
// (a lingering flavour flame). SUSTAINED ⇒ colours clamp1'd + low emission (never blooms; the sustained halo
// ceiling the engine test enforces).
/** @param {{ name:string, pri:[number,number,number], sec:[number,number,number] }} s @returns {VfxPreset} */
export function flame_variant_preset(s) {
  const pri = clamp1(s.pri)
  const sec = clamp1(s.sec)
  return {
    name: s.name,
    duration: 2,
    loop: true,
    emitters: [
      // FLAMES — a rising, licking column of coloured fire (the ported FlameFX fire_particle).
      {
        name: 'flames',
        count: 22,
        lifetime: 1.4,
        explosiveness: 0.15,
        shape: 'sphere',
        radius: 0.7,
        offset: [0, 0.4, 0],
        direction: [0, 1, 0],
        spread: 45,
        speed: [0.5, 1.2],
        gravity: [0, 1, 0],
        drag: 0.8,
        size: [0.7, 1.5],
        size_curve: [0.4, 1, 0.4],
        alpha_curve: [0, 0.85, 0],
        appearance: 'fire',
        color: pri,
        color_end: sec,
        emission: 1.3,
        opacity: 0.85,
      },
      // GLOW — a warm coloured seat under the rising flames.
      {
        name: 'glow',
        count: 5,
        lifetime: 1.2,
        explosiveness: 0.2,
        shape: 'sphere',
        radius: 0.4,
        offset: [0, 0.3, 0],
        speed: [0.2, 0.5],
        size: [1, 1.8],
        size_curve: [0.6, 1, 0.6],
        alpha_curve: [0, 0.5, 0],
        appearance: 'fire',
        color: sec,
        color_end: pri,
        emission: 1.3,
        opacity: 0.5,
      },
    ],
  }
}

// ── ASSEMBLE — 5 tints = 5 flame presets covering the 10 FlameFX colour-variant scenes. Names carry the manifest
// token flame_variant.
export const FLAME_VARIANT_PRESETS = /** @type {Record<string, VfxPreset>} */ ({})
for (const tint of FLAME_VARIANT_TINTS)
  FLAME_VARIANT_PRESETS[`flame_variant_${tint}`] = flame_variant_preset({
    name: `flame_variant_${tint}`,
    ...FLAME[tint],
  })
