// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FLAGSHIP VFX — STATUS / WARD / VORTEX / IMPACT (class e_status_impact). The remaining e-class pack scenes ported
// to their consumers: BattleFX shield (14 = 7 el × 2 tiers) → `shield_ward_<el>_<tier>` defensive-ward LOOP blooms;
// DarkMagicFX vortex (3) → `dark_vortex_<tint>` pull/summon bursts; ElectricFX impact (6) → `air_impact_pack_N`
// air-strike bursts. The gate (scripts/vfx_utilization_gate.py) greps `shield_ward` / `dark_vortex` / `air_impact_pack`.
//
// CONSUMER MAPPING (the NOTED wires — vfx_map.js is Wave-owned, so the rows are documented, not edited here):
//   • shield_ward → STATUS_VFX.buff + the defensive spells: role `shield` (8) + `reflect` (6) + `buff_stat` (14).
//     LOOP (a sustained ward around the buffed character). Tier a = small buff, tier b = big shield.
//   • dark_vortex → SUMMON_VFX + the displacement spells: role `pull` (5) + `swap` (3) + the Tomoda summoner.
//   • air_impact_pack → IMPACT_3D.air (replaces the generic Hit-accent borrow for the air element's impact beat).
//
// SOURCE OF TRUTH: every palette row is transcribed from its .tscn (via a tscn-parsing script) — the
// shield scenes' primary/secondary_color, the vortex scenes' magenta/blue/orange tints, the 6 impact scenes' white
// core + distinct secondary (cyan/yellow/pink/purple/orange/green). The colour IS the scene identity.
//
// SHAPE = REAL PACK PORTS, not generic placeholders: shield reuses `aura_shell` (aura_sphere.gdshader swirl
// capsule = the shield_shell/surface dome) + `sphere_glow` (glow.gdshader fresnel = shield_aura) + orbiting `spark`
// motes (the shield_orbit Shards). vortex reuses `portal` + `streaks` + inward `void_particle` + `void_core` (the
// real DarkMagic swirl vocabulary — the same op-for-op ports the soul_death burst composes). air impact reuses
// `sphere_impact` (impact_sphere.gdshader hot ball) + `zap_burst` (ground_impact.gdshader crackle) + `impact_core`.
// DIVERGENCE (documented): the pack's dedicated shield_shell/orbit and dark_vortex/area_dark shaders would each need
// a new dispatch branch in the FROZEN vfx_pack_shaders.js (this lane's fence) — the reused appearances are the
// nearest FAITHFUL pack ports, never a generic disc. NO-HALO LAW: the shield LOOP is clamp1'd + emission-capped so a
// sustained ward never blows a white bloom (preset_peak_luma < the 2.05 engine threshold — mirrors vfx_presets_world).

import { create_vfx_preset } from './vfx_preset_engine.js'

/** @typedef {import('./vfx_preset_engine.js').VfxPreset} VfxPreset */
/** @typedef {import('./vfx_preset_engine.js').VfxEmitter} VfxEmitter */

/** @type {[number,number,number]} */
const HOT = [1, 1, 1]
/** Clamp a colour ≤1 per channel — the no-bloom discipline for a SUSTAINED emitter (mirrors vfx_presets_world). */
const clamp1 = (/** @type {[number,number,number]} */ c) =>
  /** @type {[number,number,number]} */ ([Math.min(1, c[0]), Math.min(1, c[1]), Math.min(1, c[2])])

// ── SHIELD WARD (BattleFX shield, LOOP) ───────────────────────────────────────────────────────────────────────
/** Shield palettes, transcribed from the vfx_<el>_shield_0N.tscn (VFXBattleShieldBB primary/secondary_color).
 *  Keyed by GAME element (blank→neutral, fire→fire, ice→water, wind→air, nature→earth, dark→death, data→arcane).
 *  @type {Record<string, { pri:[number,number,number], sec:[number,number,number] }>} */
const SPAL = {
  neutral: { pri: [1, 1, 1], sec: [0.37, 0.37, 0.37] },
  fire: { pri: [1, 0.8227, 0.44], sec: [0.97, 0, 0] },
  water: { pri: [0.6431, 1, 1], sec: [0, 0.5569, 0.9725] },
  air: { pri: [1, 1, 1], sec: [0.3752, 0.56, 0.5508] },
  earth: { pri: [0.7451, 0.8353, 0], sec: [0.1725, 0.7412, 0] },
  death: { pri: [0.851, 0.1686, 0.7216], sec: [0.0933, 0, 0.8776] }, // dark + plasma scenes share this magenta/violet
  arcane: { pri: [0.2685, 1, 0.5404], sec: [0, 0.6113, 0.4345] },
}
/** The 7 shield game elements (× 2 tiers = the 14 pack scenes). */
export const SHIELD_ELEMENTS = /** @type {const} */ (['neutral', 'fire', 'water', 'air', 'earth', 'death', 'arcane'])

/**
 * One defensive-ward LOOP bloom. `big` = tier 02 (the full shield: larger radius, brighter, more orbit motes) vs
 * tier 01 (a small buff ward). Three layers mirror the pack scene's Surface+Aura (dome), Orbit (shell) and Shards
 * (rising motes): a translucent `aura_shell` swirl capsule + a `sphere_glow` fresnel rim + orbiting `spark` motes.
 * @param {{ name:string, pal:typeof SPAL[string], big:boolean }} s @returns {VfxPreset}
 */
function shield_ward(s) {
  const pri = clamp1(s.pal.pri)
  const sec = clamp1(s.pal.sec)
  const r = s.big ? 1.9 : 1.25 // pack SphereMesh r2.0 (big) — scaled to the board avatar's ~2-tall body
  const em_shell = s.big ? 1.8 : 1.4
  const em_glow = s.big ? 1.6 : 1.2
  return {
    name: s.name,
    duration: 2.0, // pack Shards lifetime 2.0 (LOOP → this is only the demo age ceiling)
    loop: true,
    emitters: [
      // DOME — the aura_sphere swirl capsule (shield_shell/surface): a translucent additive shell hugging the body.
      {
        name: 'dome',
        count: 1,
        lifetime: 2.0,
        appearance: 'aura_shell',
        geometry: 'sphere',
        ellipsoid: [r, r * 1.15, r],
        offset: [0, 0.9, 0],
        size: [r, r],
        alpha_curve: [0.85, 0.85],
        color: pri,
        color_end: sec,
        emission: em_shell,
        opacity: 0.7,
      },
      // RIM — the shield_aura fresnel halo (glow.gdshader): a bright element rim where the dome faces away.
      {
        name: 'rim',
        count: 1,
        lifetime: 2.0,
        appearance: 'sphere_glow',
        geometry: 'sphere',
        ellipsoid: [r * 1.02, r * 1.18, r * 1.02],
        offset: [0, 0.9, 0],
        size: [r, r],
        alpha_curve: [0.9, 0.9],
        color: pri,
        color_end: sec,
        emission: em_glow,
        opacity: 0.85,
      },
      // MOTES — the shield_orbit Shards: small motes drifting up a ring around the body (pack amount 64–200,
      //   initial_velocity 0.01–0.02 ≈ static, emission_ring r2.0–2.2). Capped to the LOOP budget + given a gentle
      //   orbit + slow rise so the ring reads alive without a bloom.
      {
        name: 'motes',
        count: s.big ? 40 : 24,
        lifetime: 2.0,
        shape: 'ring',
        radius: r * 1.05,
        inner: r * 0.9,
        offset: [0, 0.2, 0],
        orbit: 0.6,
        speed: [0.2, 0.5],
        gravity: [0, 0.35, 0],
        drag: 0.6,
        size: [0.14, 0.34],
        size_curve: [0.3, 1, 0.4],
        alpha_curve: [0, 1, 1, 0],
        appearance: 'arcane_mote', // BattleFX attack_particles.gdshader — the orbit Shards (was the generic FBM 'spark')
        color: pri,
        color_end: sec,
        opacity: 0.9,
      },
    ],
  }
}

// ── DARK VORTEX (DarkMagicFX vortex, BURST) ────────────────────────────────────────────────────────────────────
/** Vortex palettes, transcribed from vfx_<tint>_vortex.tscn. `sec` falls back to a grey when the scene shipped
 *  none (black). @type {Record<string, { pri:[number,number,number], sec:[number,number,number] }>} */
const VPAL = {
  black: { pri: [1, 1, 1], sec: [0.42, 0.42, 0.42] },
  evil: { pri: [1, 0.3725, 0], sec: [1, 0, 0] },
  void: { pri: [0.9373, 0.1098, 1], sec: [0, 0.302, 0.7843] },
}
export const VORTEX_TINTS = /** @type {const} */ (['black', 'evil', 'void'])

/** A dark pull/summon vortex burst: a swirling ground portal ring (portal), counter-rotating streaks, inward-imploding
 *  void motes and a punched void-core hole, opening then closing (the pack's 0.6 s "open" anim). @param {{ name:string,
 *  pal:typeof VPAL[string] }} s @returns {VfxPreset} */
function dark_vortex(s) {
  const { pri, sec } = s.pal
  return {
    name: s.name,
    duration: 1.4,
    flash: { color: pri, ms: 160 },
    emitters: [
      // SWIRL RING — the real DarkMagic void_aura.gdshader corona (bright radial-waves + angular streaks). Was the
      // invented 'portal' appearance, deleted in Wave-B (had zero DarkMagic source); re-sourced to the real void_aura.
      {
        name: 'portal',
        count: 1,
        lifetime: 1.3,
        explosiveness: 1,
        shape: 'point',
        offset: [0, 0.06, 0],
        size: [3.2, 3.2], // pack PlaneMesh 3.2×3.2
        size_curve: [0.3, 1.1, 1],
        alpha_curve: [0, 0.9, 0.5, 0],
        appearance: 'void_aura', // real DarkMagic corona (was the deleted invented 'portal')
        color: pri,
        color_end: sec,
        emission: 2.4,
      },
      // SWIRL — counter-rotating angular streaks (the dark_vortex swirl body), facing the camera.
      {
        name: 'swirl',
        count: 1,
        lifetime: 1.2,
        explosiveness: 1,
        shape: 'point',
        offset: [0, 0.5, 0],
        size: [3.4, 3.4],
        size_curve: [0.4, 1.1, 1],
        alpha_curve: [0, 0.9, 0.5, 0],
        appearance: 'streaks',
        color: sec,
        color_end: pri,
        emission: 2.2,
      },
      // MOTES — dark energy imploding toward the centre (void_particles), the pull read.
      {
        name: 'motes',
        count: 24,
        lifetime: 0.8,
        explosiveness: 0.5,
        shape: 'shell',
        radius: 2.2,
        inward: true,
        offset: [0, 0.5, 0],
        speed: [3.5, 5.5],
        drag: 1.2,
        size: [0.4, 1],
        size_curve: [1, 0.3],
        alpha_curve: [0, 1, 0],
        appearance: 'void_particle',
        color: pri,
        color_end: sec,
        emission: 2.2,
      },
      // CORE — a small black fresnel hole at the eye of the vortex (void_core), rendered in front.
      {
        name: 'core',
        count: 1,
        lifetime: 1.2,
        offset: [0, 0.5, 0],
        size: [0.9, 0.9],
        size_curve: [0.2, 1, 0.9],
        alpha_curve: [0, 1, 0.9, 0],
        appearance: 'void_core',
        displace: 0.4,
        color: HOT,
      },
    ],
  }
}

// ── AIR IMPACT (ElectricFX impact, BURST) ──────────────────────────────────────────────────────────────────────
/** The 6 impact scenes: white core + a distinct secondary. Transcribed from vfx_impact_(lightning|plasma)_0N.tscn.
 *  @type {{ id:string, sec:[number,number,number] }[]} */
const IMPACTS = [
  { id: 'air_impact_pack_1', sec: [0, 0.8431, 1] }, // lightning_01 cyan
  { id: 'air_impact_pack_2', sec: [0.8392, 0.7725, 0] }, // lightning_02 yellow
  { id: 'air_impact_pack_3', sec: [0.9098, 0, 0.3961] }, // lightning_03 pink
  { id: 'air_impact_pack_4', sec: [0.6039, 0.2706, 0.9843] }, // lightning_04 purple
  { id: 'air_impact_pack_5', sec: [0.8549, 0.2667, 0] }, // plasma_01 orange
  { id: 'air_impact_pack_6', sec: [0, 0.5922, 0.3804] }, // plasma_02 green
]

/** An air/electric impact burst: a hot noise-carved ball (sphere_impact), a radial ground crackle (zap_burst), an
 *  expanding shockwave (impact_core) and gravity sparks. Pack Shards lifetimes 0.5/0.2/0.4, velocity 5–10.
 *  @param {{ name:string, sec:[number,number,number] }} s @returns {VfxPreset} */
function air_impact(s) {
  const { sec } = s
  return {
    name: s.name,
    duration: 0.9,
    flash: { color: HOT, ms: 120 },
    emitters: [
      // BALL — the impact_sphere hot electric ball at the contact point (a rough noise-carved energy sphere).
      {
        name: 'ball',
        count: 1,
        lifetime: 0.5,
        offset: [0, 0.6, 0],
        size: [1.3, 1.3],
        size_curve: [0.3, 1.1, 0.8],
        alpha_curve: [0, 1, 0],
        appearance: 'sphere_impact',
        displace: 0.5,
        color: HOT,
        color_end: sec,
        emission: 2.4,
      },
      // CRACKLE — the ground_impact radial electric burst (a flat facing crackle), bright core → element edge.
      {
        name: 'crackle',
        count: 1,
        lifetime: 0.4,
        explosiveness: 1,
        shape: 'point',
        offset: [0, 0.6, 0],
        size: [3, 3],
        size_curve: [0.4, 1.2],
        alpha_curve: [1, 0.6, 0],
        appearance: 'zap_burst',
        color: HOT,
        color_end: sec,
        emission: 2.2,
      },
      // SHOCK — an expanding swirl shockwave ring (impact_core), the contact weight.
      {
        name: 'shock',
        count: 1,
        lifetime: 0.9,
        explosiveness: 1,
        shape: 'point',
        offset: [0, 0.6, 0],
        size: [3.4, 3.4],
        size_curve: [0.3, 1.3],
        alpha_curve: [0.85, 0.4, 0],
        appearance: 'impact_core',
        color: sec,
        color_end: HOT,
        emission: 2,
      },
      // SPARKS — electric bits flung off the strike (pack initial_velocity 5–10), tapering out: ElectricFX zap
      // (electric_particle.gdshader arc-sparks), not the generic FBM `spark` — cut EVERY non-Godot effect.
      {
        name: 'sparks',
        count: 16,
        lifetime: 0.4,
        explosiveness: 1,
        shape: 'sphere',
        radius: 0.2,
        offset: [0, 0.6, 0],
        spread: 180,
        speed: [5, 10],
        gravity: [0, -10, 0],
        size: [0.2, 0.5],
        size_curve: [1, 0],
        alpha_curve: [1, 0],
        appearance: 'zap', // ElectricFX electric_particle.gdshader — the electric arc-sparks (was generic 'spark')
        color: HOT,
        color_end: sec,
      },
    ],
  }
}

/** The e-class STATUS/WARD/VORTEX/IMPACT presets, keyed by name. Merged into the master PRESETS by
 *  vfx_presets_data.js (the NOTED 1-line wire), same as SPELL_PRESETS/WORLD_PRESETS. @type {Record<string, VfxPreset>} */
export const IMPACT_PRESETS = /** @type {Record<string, VfxPreset>} */ ({})
for (const el of SHIELD_ELEMENTS) {
  IMPACT_PRESETS[`shield_ward_${el}_a`] = shield_ward({ name: `shield_ward_${el}_a`, pal: SPAL[el], big: false })
  IMPACT_PRESETS[`shield_ward_${el}_b`] = shield_ward({ name: `shield_ward_${el}_b`, pal: SPAL[el], big: true })
}
for (const t of VORTEX_TINTS)
  IMPACT_PRESETS[`dark_vortex_${t}`] = dark_vortex({ name: `dark_vortex_${t}`, pal: VPAL[t] })
for (const i of IMPACTS) IMPACT_PRESETS[i.id] = air_impact({ name: i.id, sec: i.sec })

/** Resolve a shield-ward preset for a defensive buff on a character. @param {string} element a game element
 *  @param {1|2} [tier] 1 = small buff, 2 = big shield @returns {string} a name into IMPACT_PRESETS */
export function shield_ward_preset(element, tier = 1) {
  const el = SHIELD_ELEMENTS.includes(/** @type {any} */ (element)) ? element : 'neutral'
  return `shield_ward_${el}_${tier === 2 ? 'b' : 'a'}`
}

/** The dark-vortex preset names (SUMMON_VFX / pull / swap). @type {string[]} */
export const DARK_VORTEX_PRESETS = VORTEX_TINTS.map((t) => `dark_vortex_${t}`)
/** The air-impact rotation names (IMPACT_3D.air) — the renderer rotates these for variety. @type {string[]} */
export const AIR_IMPACT_PRESETS = IMPACTS.map((i) => i.id)
