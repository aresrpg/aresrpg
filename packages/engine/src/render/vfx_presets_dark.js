// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FLAGSHIP VFX — the DARK (necro) b_spell family: DarkMagicFX ball / projectile / area scenes ported into the
// house billboard-particle vocabulary and spread across the Yajin necromancer's spellbook for maximum variety.
// Wave-A coverage lane (docs/VFX_FULL_UTILIZATION_PLAN.md §L3 / scripts/vfx_scene_consumers.json b_spell):
//   • dark_orb  (vfx_ball_{black,evil}_0[12] + vfx_ball_void_02) — a travelling necro damage ORB (loop head+aura+wake)
//   • dark_bolt (vfx_{black,evil,void}_projectile_0[12])         — a dark COMET for dot / punishment / life-steal
//   • dark_zone (vfx_{black,evil,void}_area_0[12])               — a ground DECAL for dark trap / glyph / area spells
//
// PORT METHOD (identical to vfx_presets_spell.js): each scene's ShaderMaterial primary/secondary colours + its
// ParticleProcessMaterial motion numbers are TRANSCRIBED (parser in scratchpad, never guessed) into these rows.
// The three DarkMagic sub-tints are exact: black = monochrome void (pri 0,0,0 · sec 1,1,1), evil = hellfire
// (pri 1,0.373,0 · sec 1,0,0), void = the signature magenta/blue (pri 0.939,0.109,1 · sec 0,0.302,0.783 — the
// same colours EL.death already carries). color = the pack primary (dense CORE), color_end = the pack secondary
// (EDGE) — the engine's mix(sec,pri,value) reproduces the pack's within-quad gradient.
//
// APPEARANCE: every look is a REAL op-for-op pack port registered in billboard_pack — void_particle (the imploding
// void motes), void_aura (the ball scene's coloured corona), area_dark (the shadow-pool ground), trail_blade (the
// real dark_projectile_trail wake). B2 (audit sec3) ADDS the four accessory shaders that were previously
// approximated — dark_ring / dark_lift (the void-area Ring + rising Lift columns) and dark_glow / dark_flares (the
// void-projectile head Glow + Flares wisps) — now ported in vfx_pack_shaders3.js, node→shader verified against
// vfx_void_area_01 / vfx_void_projectile_01. dark_zone uses the real dark_ring + dark_lift; dark_bolt the real
// dark_glow + dark_flares. No appearance falls back to a generic disc.

/** @typedef {import('./vfx_preset_types.js').VfxPreset} VfxPreset */
/** @typedef {import('./vfx_preset_types.js').VfxEmitter} VfxEmitter */

const rgb = (/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b) =>
  /** @type {[number,number,number]} */ ([r, g, b])
/** Fold an (HDR) colour to ≤1 per channel — the sustained-loop no-halo clamp (engine peak-luma test < 2.05). */
const clamp1 = (/** @type {[number,number,number]} */ c) =>
  /** @type {[number,number,number]} */ ([Math.min(1, c[0]), Math.min(1, c[1]), Math.min(1, c[2])])

// void_aura + area_dark ARE registered in billboard_pack (the sibling DARK-KO lane ported them, replacing the
// fabricated `portal`), but the SHARED appearance union in vfx_preset_types.js is STALE — it still lists the
// removed `portal` and omits these two. Cast past the stale union here (runtime is proven by the preset test,
// which checks the live PACK_BILLBOARD Set). LEAD 1-liner: add 'void_aura'|'area_dark' to VfxEmitter.appearance
// and drop 'portal'.
const look = (/** @type {string} */ k) =>
  /** @type {NonNullable<VfxEmitter['appearance']>} */ (/** @type {unknown} */ (k))

// ── DARK SUB-TINTS (transcribed from the .tscn root-node exports). `core` = the pack primary_color (dense
// centre), `edge` = the pack secondary_color, `deep` = a darkened edge for the aura's far falloff. The black
// variant's pure-black core is lifted to 0.1 so the void still reads on the near-black fight board (a readability
// micro-divergence; the pack renders black-on-white-mesh where the board is dark).
const DARK = /** @type {Record<string, { core:[number,number,number], edge:[number,number,number], deep:[number,number,number] }>} */ ({
  black: { core: rgb(0.12, 0.12, 0.16), edge: rgb(0.92, 0.92, 1), deep: rgb(0.05, 0.05, 0.1) },
  evil: { core: rgb(1, 0.373, 0), edge: rgb(1, 0, 0), deep: rgb(0.42, 0.06, 0) },
  void: { core: rgb(0.939, 0.109, 1), edge: rgb(0, 0.302, 0.783), deep: rgb(0.05, 0.15, 0.5) },
}) // prettier-ignore

// ── ORB (dark_orb): a travelling necro-damage ball, run as a LOOP so head+aura+wake shed continuously while the
// runtime advances `origin`/`travel`. Ball scene = void_particles (imploding motes, emission SPHERE r1.0,
// radial_accel −5..−4) + void_aura halo + void_ball/void_core sphere. Billboard-faithful: motes head + a soft
// halo (void_aura stand-in) + the dark_projectile_trail wake.
/** @param {{ name:string, core:[number,number,number], edge:[number,number,number], deep:[number,number,number] }} s @returns {VfxPreset} */
export function dark_orb_preset(s) {
  return {
    name: s.name,
    duration: 1.2, // loop — the runtime disposes on impact (BEAT.travel_s); this is only the demo age ceiling
    loop: true,
    emitters: [
      // HEAD — dense void motes riding the orb: the dark-energy ball body (color=pack primary core → secondary edge).
      {
        name: 'head',
        count: 14,
        lifetime: 0.24,
        explosiveness: 0.4,
        shape: 'sphere',
        radius: 0.24,
        speed: [0.4, 1],
        size: [1, 1.7],
        size_curve: [1, 0.85],
        alpha_curve: [1, 0.9],
        appearance: 'void_particle',
        color: s.core,
        color_end: s.edge,
        emission: 1.7,
      },
      // AURA — the ball scene's REAL void_aura corona: ONE centred radial halo (the pack has a single Aura node,
      // not a mote cloud), so it reads as a soft disc — the shader's sqrt(1−r) mask fades the quad corners (no
      // overlapping-square billboards). void_aura scrolls its own noise for life; steady alpha (a persistent orb halo).
      {
        name: 'aura',
        count: 1,
        lifetime: 0.3,
        shape: 'point',
        size: [1.8, 1.8],
        size_curve: [1, 1],
        alpha_curve: [0.5, 0.5],
        appearance: look('void_aura'),
        color: s.core,
        color_end: s.edge,
        emission: 0.9,
        opacity: 0.35,
        blend: 'additive', // the pack void_aura is blend_add: the faint quad edges add ~0 to the dark bg (no square), only the bright corona glows
      },
      // TRAIL — the world-static wake (the real dark_projectile_trail port), shed behind the flying head.
      {
        name: 'trail',
        count: 22,
        lifetime: 0.26,
        explosiveness: 0.2,
        shape: 'sphere',
        radius: 0.14,
        trail: true,
        spread: 180,
        speed: [0.5, 1.4],
        size: [0.5, 1.1],
        size_curve: [1, 0],
        alpha_curve: [0.85, 0],
        appearance: 'trail_blade',
        color: s.core,
        color_end: s.edge,
      },
    ],
  }
}

// ── BOLT (dark_bolt): a dark COMET — a leaner head with a LONGER, denser wake than the orb (the projectile scene:
// dark_projectile_glow head + dark_projectile_flares + dark_projectile_trail). For necro dot / punishment /
// life-steal ranged casts.
/** @param {{ name:string, core:[number,number,number], edge:[number,number,number], deep:[number,number,number] }} s @returns {VfxPreset} */
export function dark_bolt_preset(s) {
  return {
    name: s.name,
    duration: 1.2,
    loop: true,
    emitters: [
      // HEAD — the void-projectile FLARES wisps riding the comet head: the REAL dark_projectile_flares.gdshader (the
      // MeshInstance Flares1/Flares2 flaring wisps — was a void_particle mote head). blend_add.
      {
        name: 'head',
        count: 8,
        lifetime: 0.18,
        explosiveness: 0.4,
        shape: 'sphere',
        radius: 0.16,
        speed: [0.3, 0.8],
        size: [0.9, 1.5],
        size_curve: [1, 0.8],
        alpha_curve: [1, 0.9],
        appearance: 'dark_flares', // DarkMagic dark_projectile_flares.gdshader (was void_particle)
        color: s.core,
        color_end: s.edge,
        emission: 1.8,
        blend: 'additive',
      },
      // TRAIL — a long dense flaring wake (dark_projectile_flares/trail): the comet signature.
      {
        name: 'trail',
        count: 30,
        lifetime: 0.34,
        explosiveness: 0.15,
        shape: 'sphere',
        radius: 0.12,
        trail: true,
        spread: 180,
        speed: [0.7, 1.8],
        size: [0.55, 1.2],
        size_curve: [1, 0],
        alpha_curve: [0.9, 0],
        appearance: 'trail_blade',
        color: s.edge,
        color_end: s.deep,
        emission: 1.5,
      },
      // GLOW — the void-projectile head GLOW: the REAL dark_projectile_glow.gdshader (the Glow MeshInstance, a
      // primary-only taper seat behind the head — was a faint void_particle cloud). blend_add.
      {
        name: 'glow',
        count: 4,
        lifetime: 0.2,
        explosiveness: 0.3,
        shape: 'sphere',
        radius: 0.32,
        speed: [0.4, 1.2],
        size: [1.1, 1.8],
        size_curve: [0.7, 1, 0.4],
        alpha_curve: [0.45, 0],
        appearance: 'dark_glow', // DarkMagic dark_projectile_glow.gdshader (was void_particle)
        color: s.core,
        color_end: s.deep,
        emission: 1.3,
        opacity: 0.5,
        blend: 'additive',
      },
    ],
  }
}

// ── ZONE (dark_zone): a persistent ground DECAL for dark trap / glyph / area spells. Area scene = dark_lift
// (rising columns) + dark_ring (flat ring) + area_dark (mist plane). REUSE: `portal` IS the real DarkMagic
// area/portal .gdshader (already ported, phase A) — the bright ring with a void centre — as the SEAT; void_particle
// as the rising mist. SUSTAINED ⇒ colours clamp1'd + low emission (never blooms; sustained halo ceiling).
/** @param {{ name:string, core:[number,number,number], edge:[number,number,number] }} s @returns {VfxPreset} */
export function dark_zone_preset(s) {
  const core = clamp1(s.core)
  const edge = clamp1(s.edge)
  return {
    name: s.name,
    duration: 2.6,
    loop: true,
    emitters: [
      // POOL — the REAL DarkMagic area_dark shadow pool on the floor (a rippling dark zone that darkens the ground).
      {
        name: 'pool',
        count: 1,
        lifetime: 2.4,
        shape: 'point',
        offset: [0, 0.05, 0],
        size: [3, 3],
        size_curve: [0.85, 1.05, 0.9],
        alpha_curve: [0, 0.55, 0.45, 0],
        appearance: look('area_dark'),
        color: edge,
        color_end: core,
        emission: 1,
        opacity: 0.6,
        spin: 0.15,
      },
      // RING — the void-area RING: the REAL dark_ring.gdshader polar annulus (was the void_aura corona stand-in).
      {
        name: 'ring',
        count: 1,
        lifetime: 2.4,
        shape: 'point',
        offset: [0, 0.07, 0],
        size: [2.9, 2.9],
        size_curve: [0.85, 1.05, 0.9],
        alpha_curve: [0, 0.4, 0.32, 0],
        appearance: 'dark_ring', // DarkMagic dark_ring.gdshader (was the void_aura corona reuse)
        color: core,
        color_end: edge,
        emission: 1,
        opacity: 0.55,
        spin: 0.25,
        blend: 'additive', // dark_ring is blend_add: the bright rune glows, quad edges add ~0 (no square footprint)
      },
      // LIFT — the void-area rising Lift columns: the REAL dark_lift.gdshader (the MeshInstance Lift1/Lift2 vertical
      // energy curtains climbing off the ring — was a void_particle mote mist). blend_add.
      {
        name: 'lift',
        count: 3,
        lifetime: 2.2,
        explosiveness: 0,
        shape: 'ring',
        radius: 1.15,
        inner: 0.75,
        offset: [0, 0.12, 0],
        size: [1.5, 2.4],
        size_curve: [0.6, 1, 0.7],
        alpha_curve: [0, 0.5, 0.4, 0],
        appearance: 'dark_lift', // DarkMagic dark_lift.gdshader (was the void_particle mist reuse)
        color: core,
        color_end: edge,
        emission: 1,
        opacity: 0.55,
        blend: 'additive',
      },
    ],
  }
}

// ── ASSEMBLE — 3 tints × { orb, bolt, zone } = 9 dark presets. Names carry the manifest tokens (dark_orb /
// dark_bolt / dark_zone), so the utilization gate greps them LIVE across the b_spell dark scenes.
export const DARK_PRESETS = /** @type {Record<string, VfxPreset>} */ ({})
for (const [tint, c] of Object.entries(DARK)) {
  DARK_PRESETS[`dark_orb_${tint}`] = dark_orb_preset({ name: `dark_orb_${tint}`, ...c })
  DARK_PRESETS[`dark_bolt_${tint}`] = dark_bolt_preset({ name: `dark_bolt_${tint}`, ...c })
  DARK_PRESETS[`dark_zone_${tint}`] = dark_zone_preset({ name: `dark_zone_${tint}`, core: c.core, edge: c.edge })
}
