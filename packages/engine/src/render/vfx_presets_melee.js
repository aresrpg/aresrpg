// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FLAGSHIP VFX — MELEE / WEAPON BURSTS (class c_melee). The BattleFX claw (7) + swing (7) + element-slash (6)
// pack scenes ported to element-keyed IMPACT bursts. 2D-sprite reality (VFX_FULL_UTILIZATION_PLAN §c): the
// fight-board avatars are Koshi2D directional pixel sprites with NO weapon bone — so a "melee" reads as a VFX
// BURST on the physical/strike beat, tinted by the strike's element (exactly like the live `slash_weapon`
// burst). `melee_claw_<el>` (rend rake), `melee_swing_<el>` (heavy weapon arc), `slash_elem_<el>` (element
// weapon slash). The gate (scripts/vfx_utilization_gate.py) greps `melee_claw`/`melee_swing`/`slash_elem`.
//
// SOURCE OF TRUTH: every palette row in PAL below is transcribed from its BattleFX .tscn (parsed 2026-07-12,
// a tscn-parsing script) — the VFXBattle*BB script's own primary/secondary/tertiary_color, identical across
// the claw/swing/slash scenes of one element (they ship as one authored palette). The colour IS the scene
// identity, so each element reads as its distinct pack scene (fire gold→red, ice cyan→blue, dark magenta→violet…).
//
// SHAPE = REAL PACK PORTS, not generic FBM (not a placeholder). The crescent is `slash_arc` — the
// op-for-op TSL port of BattleFX slash.gdshader (vfx_pack_shaders2.js). DIVERGENCES (documented, not hidden —
// same discipline as vfx_presets_world.js):
//   • swing.gdshader's angular-sweep mask and claw.gdshader's 3-band rake have no dedicated appearance: adding
//     one needs a new dispatch branch in the FROZEN vfx_pack_shaders.js (Wave-B territory / this lane's fence).
//     So swing = a WIDER/heavier `slash_arc` crescent + shock; claw = THREE offset `slash_arc` crescents (the
//     rake) + an `arcane_mote` spray (BattleFX attack_particles). Both compose the pack's OWN shaders — the
//     faithful family, never a generic disc/FBM (the fan/bits/trail/spray were `spark` before B2 — now arcane_mote).
//   • The pack scenes are MESH sweeps (claw_factor/swing_factor animate 0→1 over 0.6 s); a burst can't drive a
//     per-mesh sweep uniform, so the arc is a shaped billboard whose size_curve reads as the sweep. Colour +
//     crescent shape + per-element identity are faithful; the vertex sweep is the reinterpretation.

import { create_vfx_preset } from './vfx_preset_engine.js'

/** @typedef {import('./vfx_preset_engine.js').VfxPreset} VfxPreset */
/** @typedef {import('./vfx_preset_engine.js').VfxEmitter} VfxEmitter */

/** @type {[number,number,number]} */
const HOT = [1, 1, 1]

/**
 * The 7 element palettes, transcribed from the BattleFX claw/swing/slash .tscn (identical per element). Keyed by
 * the GAME element (the tint map in the plan: blank→neutral, fire→fire, ice→water, wind→air, nature→earth,
 * dark→death, data→arcane) so the fight consumer picks by the strike's element. `pri` = bright core, `sec` =
 * weapon edge, `deep` = the tertiary_color dark rim (falls back to sec when the scene shipped none).
 * @type {Record<string, { pri:[number,number,number], sec:[number,number,number], deep:[number,number,number] }>}
 */
const PAL = {
  neutral: { pri: [1, 1, 1], sec: [0.3686, 0.3686, 0.3686], deep: [0.0784, 0.0784, 0.0784] }, // vfx_blank_*
  fire: { pri: [1, 0.8235, 0.4392], sec: [0.9686, 0, 0], deep: [0.5741, 0.1723, 0] }, // vfx_fire_*
  water: { pri: [0.6431, 1, 1], sec: [0, 0.5569, 0.9725], deep: [0.3882, 0.2118, 1] }, // vfx_ice_*
  air: { pri: [1, 1, 1], sec: [0.3765, 0.5608, 0.549], deep: [0.3412, 0.3882, 0.4235] }, // vfx_wind_*
  earth: { pri: [0.7451, 0.8353, 0], sec: [0.1725, 0.7412, 0], deep: [0.2588, 0.2941, 0] }, // vfx_nature_*
  death: { pri: [0.851, 0.1686, 0.7216], sec: [0.0941, 0, 0.8784], deep: [0.34, 0.06, 0.3] }, // vfx_dark_*
  arcane: { pri: [0.2667, 1, 0.5412], sec: [0, 0.6118, 0.4353], deep: [0, 0.302, 0.3333] }, // vfx_data_*
}

/** The 7 game elements a melee burst can tint to (claw + swing cover all 7; slash covers 6, no neutral scene —
 *  the neutral weapon slash is the already-LIVE `slash_weapon`). @type {readonly string[]} */
export const MELEE_ELEMENTS = /** @type {const} */ (['neutral', 'fire', 'water', 'air', 'earth', 'death', 'arcane'])
/** slash_elem covers only the 6 ELEMENT slash scenes (dark/data/fire/ice/nature/wind → death/arcane/fire/water/
 *  earth/air). `vfx_blank_slash` is neutral and already ships as `slash_weapon`. */
export const SLASH_ELEMENTS = /** @type {const} */ (['fire', 'water', 'air', 'earth', 'death', 'arcane'])

// ── BURST: element weapon SLASH — BattleFX slash.gdshader crescent (`slash_arc`) + a spark fan across the strike
//    + gravity bits. The neutral one is `slash_weapon`; these are the element-tinted variants so a fire-weapon
//    strike differs from an ice one (the plan's explicit "shape is a real exact port; only per-element colour is new").
/** @param {{ name:string, pal:typeof PAL[string] }} s @returns {VfxPreset} */
function slash_elem(s) {
  const { pri, sec, deep } = s.pal
  return {
    name: s.name,
    duration: 0.9,
    flash: { color: pri, ms: 150 },
    emitters: [
      // ARC — the real slash.gdshader crescent sweeping across the strike, bright core → weapon edge.
      {
        name: 'arc',
        count: 1,
        lifetime: 0.32,
        explosiveness: 1,
        shape: 'point',
        offset: [0, 0.6, 0],
        size: [3.4, 3.4],
        size_curve: [1.2, 0.5],
        alpha_curve: [1, 0.7, 0],
        appearance: 'slash_arc',
        color: HOT,
        color_end: sec,
        emission: 2,
        spin: 0.5,
      },
      // FAN — a flat wide sweep of streaks across the arc (pack Shards: amount 16–32, initial_velocity 4–8).
      {
        name: 'fan',
        count: 26,
        lifetime: 0.35,
        explosiveness: 1,
        shape: 'box',
        radius: 0.4,
        offset: [0, 0.6, 0],
        direction: [1, 0.15, 0],
        spread: 26,
        speed: [8, 16],
        drag: 3,
        size: [0.35, 0.9],
        size_curve: [1, 0.3],
        alpha_curve: [1, 0.9, 0],
        appearance: 'arcane_mote', // BattleFX attack_particles.gdshader — the Shards spray (was the generic FBM 'spark')
        color: pri,
        color_end: sec,
        spin: 2,
      },
      // BITS — a few gravity sparks flung off the strike, tapering to the dark rim.
      {
        name: 'bits',
        count: 12,
        lifetime: 0.5,
        explosiveness: 1,
        shape: 'sphere',
        radius: 0.2,
        offset: [0, 0.6, 0],
        spread: 180,
        speed: [6, 11],
        gravity: [0, -12, 0],
        size: [0.22, 0.5],
        size_curve: [1, 0],
        alpha_curve: [1, 0],
        appearance: 'arcane_mote', // BattleFX attack_particles.gdshader — the Shards spray (was the generic FBM 'spark')
        color: sec,
        color_end: deep,
      },
    ],
  }
}

// ── BURST: heavy weapon SWING — a wider, slower crescent (swing.gdshader is an angular sweep: a fatter arc than
//    the slash) + a ground shock ring + a longer spark trail. The big-hit physical beat.
/** @param {{ name:string, pal:typeof PAL[string] }} s @returns {VfxPreset} */
function swing_burst(s) {
  const { pri, sec, deep } = s.pal
  return {
    name: s.name,
    duration: 1.0,
    flash: { color: pri, ms: 170 },
    emitters: [
      // ARC — a big heavy crescent (swing.gdshader's wide sweep), slower + larger than the slash, deep-rim edge.
      {
        name: 'arc',
        count: 1,
        lifetime: 0.42,
        explosiveness: 1,
        shape: 'point',
        offset: [0, 0.7, 0],
        size: [4.8, 4.8],
        size_curve: [0.9, 1, 0.55],
        alpha_curve: [0.9, 1, 0.5, 0],
        appearance: 'slash_arc',
        color: pri,
        color_end: deep,
        emission: 2.2,
        spin: 0.3,
      },
      // SHOCK — an expanding swirl shockwave at the contact point (the heavy landing weight).
      {
        name: 'shock',
        count: 1,
        lifetime: 0.5,
        explosiveness: 1,
        shape: 'point',
        offset: [0, 0.7, 0],
        size: [3.6, 3.6],
        size_curve: [0.3, 1.3],
        alpha_curve: [0.9, 0.5, 0],
        appearance: 'impact_core',
        color: HOT,
        color_end: sec,
        emission: 2,
      },
      // TRAIL — a long spark trail dragged along the arc's travel (heavier + wider than the slash fan).
      {
        name: 'trail',
        count: 24,
        lifetime: 0.55,
        explosiveness: 1,
        shape: 'box',
        radius: 0.55,
        offset: [0, 0.7, 0],
        direction: [1, 0.1, 0],
        spread: 34,
        speed: [7, 15],
        drag: 2.4,
        gravity: [0, -6, 0],
        size: [0.4, 1.05],
        size_curve: [1, 0.3],
        alpha_curve: [1, 0.85, 0],
        appearance: 'arcane_mote', // BattleFX attack_particles.gdshader — the Shards spray (was the generic FBM 'spark')
        color: pri,
        color_end: sec,
        spin: 1.5,
      },
    ],
  }
}

// ── BURST: CLAW rend — the 3-band rake (claw.gdshader `-sin(uv.x·TAU)` gives three parallel marks). Rendered as
//    THREE offset `slash_arc` crescents fanned across the strike + a spark spray. Fast + vicious (beast/necro melee).
/** @param {{ name:string, pal:typeof PAL[string] }} s @returns {VfxPreset} */
function claw_burst(s) {
  const { pri, sec, deep } = s.pal
  /** One rake mark — a thin crescent offset laterally + rotated, so three read as parallel claw slashes.
   *  @param {string} n @param {number} dx @param {number} spin @returns {VfxEmitter} */
  const mark = (n, dx, spin) => ({
    name: n,
    count: 1,
    lifetime: 0.3,
    explosiveness: 1,
    shape: 'point',
    offset: [dx, 0.6 + dx * 0.35, 0],
    size: [2.9, 1.5],
    size_curve: [1.15, 0.4],
    alpha_curve: [1, 0.75, 0],
    appearance: 'slash_arc',
    color: pri,
    color_end: sec,
    emission: 2.2,
    spin,
  })
  return {
    name: s.name,
    duration: 0.7,
    flash: { color: pri, ms: 130 },
    emitters: [
      mark('rake_lo', -0.55, 0.35),
      mark('rake_mid', 0, 0.35),
      mark('rake_hi', 0.55, 0.35),
      // SPRAY — a tight forward spark spray torn out by the rake (pack vel 4–8, tapering to the deep rim).
      {
        name: 'spray',
        count: 18,
        lifetime: 0.4,
        explosiveness: 1,
        shape: 'cone',
        radius: 0.3,
        offset: [0, 0.6, 0],
        direction: [1, 0.2, 0],
        spread: 40,
        speed: [7, 13],
        drag: 2.6,
        gravity: [0, -9, 0],
        size: [0.25, 0.6],
        size_curve: [1, 0.2],
        alpha_curve: [1, 0],
        appearance: 'arcane_mote', // BattleFX attack_particles.gdshader — the Shards spray (was the generic FBM 'spark')
        color: sec,
        color_end: deep,
      },
    ],
  }
}

/** The melee BURST presets, keyed by name (melee_claw_<el>, melee_swing_<el>, slash_elem_<el>). Merged into the
 *  master PRESETS by vfx_presets_data.js exactly as SPELL_PRESETS/WORLD_PRESETS are (the NOTED 1-line wire).
 *  @type {Record<string, VfxPreset>} */
export const MELEE_PRESETS = /** @type {Record<string, VfxPreset>} */ ({})
for (const el of MELEE_ELEMENTS) {
  MELEE_PRESETS[`melee_claw_${el}`] = claw_burst({ name: `melee_claw_${el}`, pal: PAL[el] })
  MELEE_PRESETS[`melee_swing_${el}`] = swing_burst({ name: `melee_swing_${el}`, pal: PAL[el] })
}
for (const el of SLASH_ELEMENTS)
  MELEE_PRESETS[`slash_elem_${el}`] = slash_elem({ name: `slash_elem_${el}`, pal: PAL[el] })

/**
 * Resolve a melee-burst preset name for the physical strike beat: pick the weapon shape by `kind` and tint by the
 * strike's `element`. The fight consumer (vfx_map BURST_VFX) calls this on a physical hit — the NOTED wire.
 * Unknown element → neutral; slash has no neutral scene, so a neutral slash falls back to the LIVE `slash_weapon`.
 * @param {'claw'|'swing'|'slash'} kind @param {string} element a game element (neutral/fire/water/air/earth/death/arcane)
 * @returns {string} a name into MELEE_PRESETS (or 'slash_weapon' for a neutral slash)
 */
export function melee_burst_preset(kind, element) {
  const el = MELEE_ELEMENTS.includes(/** @type {any} */ (element)) ? element : 'neutral'
  if (kind === 'claw') return `melee_claw_${el}`
  if (kind === 'swing') return `melee_swing_${el}`
  return el === 'neutral' ? 'slash_weapon' : `slash_elem_${el}`
}

/** Prebuild every melee preset once (pipeline warm / a table smoke). Mirrors the world-fixture group's intent —
 *  handy for a prewarm pass; returns the live handles so the caller disposes them. @param {any} engine EngineApi
 *  @returns {{ dispose: () => void }} */
export function prewarm_melee(engine) {
  /** @type {{ dispose: () => void }[]} */
  const handles = []
  for (const preset of Object.values(MELEE_PRESETS)) {
    const h = create_vfx_preset(preset, { position: [0, 0, 0], scale: 1 })
    try {
      engine.add_to_scene(h.object3d)
      handles.push({
        dispose: () => {
          try {
            engine.remove_from_scene(h.object3d)
          } catch {
            /* pre-boot */
          }
          h.dispose()
        },
      })
    } catch {
      h.dispose()
    }
  }
  return {
    dispose() {
      for (const h of handles) h.dispose()
      handles.length = 0
    },
  }
}
