// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #676 — fish pets hover above the character rather than walking on the ground. Pure
// vertical-placement math + family detection, split out the same way pet_follow.js's dead-zone steering is:
// engine-free, unit-testable without the @aresrpg/engine3 import pet_companion.js's rig factory carries (issue
// #117). Horizontal steering (dead-zone follow + roam, pet_follow.js) is UNCHANGED for every pet family —
// hover only replaces the vertical term and the played clip; ground-walking pets never call into this module's
// hover math at all (pet_companion.js's own ground_off placement is untouched).
//
// FAMILY DETECTION — DATA GAP: pet_catalog.js and mob_catalog.js (the two catalogs every pet resolves its
// GLB through, see pet_companion_resolver.js) carry rows shaped `{ appearance, glb }` only — no family /
// species / element field to key off (checked both catalog modules + their test fixtures + the
// rpc/fixtures/encyclopedia.json flavor-text fixture: none carry one). #676's own issue body asks for
// catalog-data detection "if the data carries it" — it doesn't, yet. Until the content repo publishes a real
// field, fish pets are enumerated here by hand. Name alone is NOT reliable evidence — the #526 resolver
// finding already caught a fish-sounding slug lying: pet_siluri ("Silury" → French "silure", catfish) LOOKS
// fish-named but its published mob-catalog appearance is 'Tortoise' (verified live, pet_companion_resolver.
// test.js) — so it is deliberately excluded here. The three below are unambiguous: pet_cryofin / pet_chromafin
// both carry the "-fin" fish-anatomy suffix, pet_moray is a moray eel by name, and #676 names Cryofin.
// FLAGGED FOR THE CONTENT REPO: a real family/species field on the catalog row would
// let this hand-kept set retire in favor of a data-driven read.
export const FISH_PETS = new Set(['pet_cryofin', 'pet_chromafin', 'pet_moray'])

/** @param {string | null | undefined} slug @returns {boolean} */
export const is_fish_pet = slug => (slug ? FISH_PETS.has(slug) : false)

export const HOVER_HEIGHT_M = 1.5 // world blocks above the fed ground y (#676)
export const HOVER_BOB_AMPLITUDE_M = 0.15 // small — a gentle bob, never a bounce
export const HOVER_BOB_PERIOD_S = 2.6 // seconds per full bob cycle — slow, reads as floating/swimming

/**
 * The gentle sinusoidal bob at elapsed time `t` seconds — TIME-based (not frame-based), so it is stable across
 * any dt/framerate and stays a pure function of elapsed time alone.
 * @param {number} elapsed_s seconds since the rig started hovering
 * @returns {number} the bob offset in world blocks, within ±HOVER_BOB_AMPLITUDE_M
 */
export const hover_bob = elapsed_s => Math.sin((elapsed_s / HOVER_BOB_PERIOD_S) * Math.PI * 2) * HOVER_BOB_AMPLITUDE_M

/**
 * A fish-family companion's target world Y: a fixed height above the fed ground y, plus the gentle bob.
 * Ground-walking pets never call this — they keep the existing ground_off placement untouched.
 * @param {number} ground_y the fed ground/visual y (embed_voxel_player.js's `visual_y` / a remote rig's `gy`)
 * @param {number} elapsed_s seconds since the rig started hovering
 * @returns {number}
 */
export const hover_target_y = (ground_y, elapsed_s) => ground_y + HOVER_HEIGHT_M + hover_bob(elapsed_s)

/**
 * Pick the active clip for a companion: a fish-family pet prefers a SWIM clip when its GLB carries one: every
 * other pet (and a fish GLB with no swim clip) keeps the existing idle-loop convention — pet_companion.js's
 * only clip selection until now, so a non-fish pet is byte-identical even if one of its clips happens to be
 * named "swim". Pure over clip names; the GLB's AnimationClip objects carry `.name`.
 * @param {{ name: string }[]} clips
 * @param {boolean} is_fish
 * @returns {{ name: string } | undefined}
 */
export const select_companion_clip = (clips, is_fish) => {
  const swim_clip = is_fish ? clips.find(c => /swim/i.test(c.name)) : undefined
  return swim_clip ?? clips.find(c => /idle/i.test(c.name)) ?? clips[0]
}
