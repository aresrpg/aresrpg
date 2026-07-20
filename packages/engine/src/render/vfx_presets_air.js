// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FLAGSHIP VFX — the AIR (electric) b_spell family: ElectricFX ball / zap scenes ported into the house
// billboard vocabulary and spread across the 54 air-element spells for maximum variety (six distinct tints so a
// Senshi Gale Slash and a Storm Arc land DIFFERENT bolts). Wave-A coverage lane (docs/VFX_FULL_UTILIZATION_PLAN.md
// §L4 / scripts/vfx_scene_consumers.json b_spell):
//   • air_bolt_orb   (vfx_ball_{lightning_0[1-4],plasma_0[12]}) — a travelling electric ORB (the air projectile)
//   • air_zap_strike (vfx_zap_{lightning_0[1-4],plasma_0[12]})  — the SKYFALL lightning-strike delivery ("falls
//                                                                 from the sky") + a ground crackle on landing
//
// PORT METHOD: the six ElectricFX tints are transcribed EXACT from each scene's root secondary_color (the ball is
// white-cored — primary 1,1,1 — with the colour in the arc): lightning_01 cyan (0,0.843,1) · _02 gold
// (0.839,0.773,0) · _03 magenta (0.910,0,0.396) · _04 violet (0.604,0.271,0.984) · plasma_01 orange
// (0.855,0.267,0) · plasma_02 green (0,0.592,0.380). color = white hot core, color_end = the tint.
//
// APPEARANCE REUSE (fence: shader files are another lane's — READ-only): the ElectricFX look is ALREADY ported
// op-for-op in phase B — `zap` (the electric_particle jagged lightning arc), `zap_burst` (the ground_impact radial
// crackle), `star4` (the four_point_star sparkle). These presets reuse those EXACT ports, recoloured per scene.
// DIVERGENCE (documented): the ball/zap Glow + Sphere layers are SphereMesh heroes (sphere_glow/sphere_impact),
// proven one-shot only; the travelling LOOP omits them and lets the zap+star read carry the electric look. The
// pack's ground_streaks skyfall curtain is a Wave-B follow-up (gated behind the fenced shader dispatch).

/** @typedef {import('./vfx_preset_types.js').VfxPreset} VfxPreset */
/** @typedef {import('./vfx_preset_types.js').VfxEmitter} VfxEmitter */

const rgb = (/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b) =>
  /** @type {[number,number,number]} */ ([r, g, b])
const HOT = rgb(1, 1, 1) // the ElectricFX primary_color — a white-hot arc core in every tint

// ── SIX ELECTRIC TINTS (exact scene secondary_color). `01`/`02` split lightning vs plasma tiers → the six-way
// hash(spell_id) rotation the variant selector drives (vfx_variants.js). `strong` marks the plasma tiers (the
// pack ran them at emission 10 vs 4 — a punchier bolt).
const AIR = /** @type {{ key:string, body:[number,number,number], strong?:boolean }[]} */ ([
  { key: 'cyan', body: rgb(0, 0.843, 1) },
  { key: 'gold', body: rgb(0.839, 0.773, 0) },
  { key: 'magenta', body: rgb(0.91, 0, 0.396) },
  { key: 'violet', body: rgb(0.604, 0.271, 0.984) },
  { key: 'orange', body: rgb(0.855, 0.267, 0), strong: true },
  { key: 'green', body: rgb(0, 0.592, 0.38), strong: true },
])

// ── BOLT-ORB (air_bolt_orb): a travelling electric ball — a jagged lightning core + crisp four-point sparkles +
// a light electric wake, run as a LOOP while the runtime advances origin/travel. Ball scene: Zaps/ZapsExtra
// (electric_particle, emission SPHERE r0.8, spread 180) + Star (four_point_star, amount 4).
/** @param {{ name:string, body:[number,number,number], strong?:boolean }} s @returns {VfxPreset} */
export function air_bolt_orb_preset(s) {
  const em = s.strong ? 2 : 1.6
  return {
    name: s.name,
    duration: 1.2,
    loop: true,
    emitters: [
      // CORE — the jagged lightning arc body (electric_particle), the DOMINANT read: a dense cluster of the tall
      // `zap` arcs riding the orb (a white-hot core in the tinted arc), so the ball reads as electric, not a blob.
      {
        name: 'core',
        count: 14,
        lifetime: 0.2,
        explosiveness: 0.3,
        shape: 'sphere',
        radius: 0.26,
        spread: 180,
        speed: [0.4, 1.1],
        size: [1.1, 2],
        size_curve: [1, 0.85],
        alpha_curve: [1, 0.85],
        appearance: 'zap',
        color: HOT,
        color_end: s.body,
        emission: em,
      },
      // GLOW — a soft radial TINTED halo (aura_mote) hugging the arcs (the ball scene's Glow sphere, as a soft
      // billboard so the loop stays travel-safe). Coloured, never a white disc — it seats the electric core.
      {
        name: 'glow',
        count: 6,
        lifetime: 0.24,
        explosiveness: 0.3,
        shape: 'sphere',
        radius: 0.34,
        speed: [0.2, 0.8],
        size: [1.4, 2.4],
        size_curve: [0.6, 1, 0.5],
        alpha_curve: [0.5, 0],
        appearance: 'aura_mote',
        color: s.body,
        color_end: s.body,
        emission: s.strong ? 1.4 : 1.2,
        opacity: 0.5,
      },
      // WAKE — a light electric trail so the flying orb reads as a moving bolt.
      {
        name: 'wake',
        count: 18,
        lifetime: 0.24,
        explosiveness: 0.2,
        shape: 'sphere',
        radius: 0.12,
        trail: true,
        spread: 180,
        speed: [0.5, 1.4],
        size: [0.45, 1],
        size_curve: [1, 0],
        alpha_curve: [0.8, 0],
        appearance: 'zap',
        color: s.body,
        color_end: s.body,
      },
    ],
  }
}

// ── ZAP-STRIKE (air_zap_strike): the SKYFALL lightning delivery — a tall jagged bolt with a bright electric
// crackle at its base, run as a LOOP while the runtime drops origin from BEAT.sky_h. Zap scene: Zap/ZapExtra
// (electric_particle) + ZapImpact (ground_impact = zap_burst) + ZapStreaks (ground_streaks).
/** @param {{ name:string, body:[number,number,number], strong?:boolean }} s @returns {VfxPreset} */
export function air_zap_strike_preset(s) {
  const em = s.strong ? 2.2 : 1.8
  return {
    name: s.name,
    duration: 1.2,
    loop: true,
    emitters: [
      // BOLT — a tall vertical lightning column: a slim cluster of the tall jagged `zap` arc billboards (each
      // billboard's UV.y taper IS the vertical bolt) rising the strike path.
      {
        name: 'bolt',
        count: 10,
        lifetime: 0.2,
        explosiveness: 0.4,
        shape: 'sphere',
        radius: 0.2,
        offset: [0, 0.6, 0],
        speed: [0.3, 0.8],
        size: [1, 2.2],
        size_curve: [1, 0.8],
        alpha_curve: [1, 0.85],
        appearance: 'zap',
        color: HOT,
        color_end: s.body,
        emission: em,
      },
      // CRACKLE — the radial electric ring at the strike base (ground_impact port). TINTED (body, not white-hot)
      // so the jagged ring reads coloured instead of washing to a white disc at this footprint.
      {
        name: 'crackle',
        count: 2,
        lifetime: 0.32,
        explosiveness: 1,
        shape: 'point',
        offset: [0, 0.08, 0],
        size: [2.2, 2.9],
        size_curve: [0.5, 1.6],
        alpha_curve: [0.9, 0.4, 0],
        appearance: 'zap_burst',
        color: s.body,
        color_end: s.body,
        emission: em,
      },
      // WAKE — the descending electric trail behind the falling bolt.
      {
        name: 'wake',
        count: 16,
        lifetime: 0.26,
        explosiveness: 0.2,
        shape: 'sphere',
        radius: 0.14,
        trail: true,
        spread: 180,
        speed: [0.5, 1.5],
        size: [0.5, 1.1],
        size_curve: [1, 0],
        alpha_curve: [0.8, 0],
        appearance: 'zap',
        color: s.body,
        color_end: s.body,
      },
    ],
  }
}

// ── ASSEMBLE — 6 tints × { bolt_orb, zap_strike } = 12 air presets, numbered 01..06 by tier so the variant
// selector rotates hash(spell_id) % 6. Names carry the manifest tokens (air_bolt_orb / air_zap_strike).
export const AIR_PRESETS = /** @type {Record<string, VfxPreset>} */ ({})
AIR.forEach((t, i) => {
  const n = String(i + 1).padStart(2, '0')
  AIR_PRESETS[`air_bolt_orb_${n}`] = air_bolt_orb_preset({ name: `air_bolt_orb_${n}`, body: t.body, strong: t.strong })
  AIR_PRESETS[`air_zap_strike_${n}`] = air_zap_strike_preset({
    name: `air_zap_strike_${n}`,
    body: t.body,
    strong: t.strong,
  })
})
