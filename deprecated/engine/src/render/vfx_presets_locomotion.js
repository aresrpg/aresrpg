// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FLAGSHIP VFX — LOCOMOTION PROPS (class d_world). One-shot movement puffs mounted in the ROAM scene by the
// frontend player (embed_voxel_player.js) at the feet on a controller cue. Today: `dust_puff` — the DOUBLE-JUMP
// bounce kick — a proper double-jump bounce smoke effect. A quick, subtle, dissipating
// dusty puff that reads as a bounce pad under the feet — NOT a fight-VFX explosion.
//
// REUSE, NO NEW SHADER: both emitters reuse already-ported ExplosionFX pack appearances (vfx_pack_shaders_expansion.js) —
// `explo_smoke` (the billowing dust cloud) + `explo_rings` (the expanding shock annulus, here a soft ground
// ripple). Same one-shot RUNTIME every fight burst uses (create_vfx_preset → add_to_scene → drive age → dispose
// at `duration`). Merged into the master PRESETS by vfx_presets_data.js exactly as SPELL/WORLD/MELEE presets are,
// so the app plays it via `PRESETS.dust_puff` off the existing @aresrpg/engine3/vfx barrel — nothing new to wire.
//
// NORMAL blend (AgX-safe, the house law) + low emission + a warm dust palette: a dim, earthy read, never a bright
// additive flash. Colours are ≤1 per channel (no-halo discipline). Every knob below is one line — the feel (size /
// count / duration / colour) retunes here without touching the physics or the app.

/** @typedef {import('./vfx_preset_engine.js').VfxPreset} VfxPreset */
/** @typedef {import('./vfx_preset_engine.js').VfxEmitter} VfxEmitter */

/** Warm settling dust (bright core → shadowed edge) — the explo_smoke pack model mixes toward color_end×0.4. */
const DUST = /** @type {[number,number,number]} */ ([0.64, 0.58, 0.47])
const DUST_DEEP = /** @type {[number,number,number]} */ ([0.4, 0.35, 0.29])

/**
 * The DOUBLE-JUMP feet puff — a ~0.55 s dusty bounce kick. Two emitters, both one-shot:
 *   • dust — a low ring of explo_smoke billboards billowing OUTWARD + slightly up (the ring shape's own dir),
 *     then settling with heavy drag (quick dissipation). The dusty cloud body + the "slight ring spread".
 *   • ripple — a single explo_rings annulus snapping outward flat at the ground line: the "bounce pad" read.
 * @returns {VfxPreset}
 */
function dust_puff_preset() {
  /** @type {VfxEmitter[]} */
  const emitters = [
    {
      name: 'dust',
      count: 14,
      lifetime: 0.5,
      explosiveness: 1, // all born at t0 — a single kick, not a stream
      shape: 'ring',
      radius: 0.34, // a small foot-ring; particles launch outward+up from it (seed_emitter ring dir)
      offset: [0, 0.06, 0],
      speed: [1.1, 2],
      gravity: [0, 0.6, 0], // a gentle lift as it thins
      drag: 5, // settles fast → the quick dissipation
      size: [0.5, 0.95],
      size_curve: [0.5, 1, 0.85],
      alpha_curve: [0.6, 0.5, 0],
      appearance: 'explo_smoke', // ExplosionFX explosion_smoke — the billowing dust cloud (reuse, no new shader)
      color: DUST,
      color_end: DUST_DEEP,
      emission: 1.1, // low — a dim earthy read, never a bright cloud
      opacity: 0.5, // subtle — not a fight-VFX explosion
    },
    {
      name: 'ripple',
      count: 1,
      lifetime: 0.42,
      explosiveness: 1,
      shape: 'point',
      offset: [0, 0.04, 0], // hug the ground line under the feet
      size: [1.4, 1.4],
      size_curve: [0.5, 1.7], // snaps outward = the bounce-pad shock ring
      alpha_curve: [0.5, 0.28, 0],
      appearance: 'explo_rings', // ExplosionFX explosion_rings — the expanding annulus, here a soft dust ripple
      color: DUST, // NORMAL blend + dust colour → an earthy ring, not the pack's additive fire flash
      emission: 1.3,
      opacity: 0.4,
    },
  ]
  return { name: 'dust_puff', duration: 0.55, emitters }
}

/** The one-shot locomotion presets, keyed by name. Merged into the master PRESETS by vfx_presets_data.js.
 *  @type {Record<string, VfxPreset>} */
export const LOCOMOTION_PRESETS = /** @type {Record<string, VfxPreset>} */ ({
  dust_puff: dust_puff_preset(),
})
