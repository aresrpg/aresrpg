// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENGAGE GATE (#861) — the ONE home for "may this player start a world fight right now?".
//
// These preconditions used to live only INSIDE world_spawns' engage() closure, as three bare `return`s. The
// [R] ATTACK pill knew nothing about them, so it armed gold over a group the player could not actually engage
// and every press died in silence: no tx, no toast, no console line, and — because engage() is async, so the
// press promise resolved instantly — the PromptStack's pending latch released and the pill re-appeared ARMED.
// That is indistinguishable from a dead button, which is exactly how it was reported (#861: "composed zero
// transactions… no toast, no error… the pill still armed"). One home, read by BOTH sides: the pill derives its
// armed/blocked presentation from it, and engage() keeps it as the last line of defense.
//
// Pure by construction — the caller reads the live stores and hands the values in, so this stays a plain
// transform over plain data (and a real unit, not a source-shape assertion).

/**
 * @typedef {'engaging' | 'fight_session' | 'no_character'} EngageBlock
 *   `engaging`      — a claim from THIS renderer is already in flight (re-entry latch; internal, never copy).
 *   `fight_session` — the dungeon store still holds a live fight/run-pass session for this client.
 *   `no_character`  — no character is selected, so there is nobody to seat in the fight.
 */

/**
 * The FIRST precondition that refuses this press, or null when it may proceed. Order is the order engage()
 * itself checks in, so the pill and the press can never disagree about WHY.
 * @param {{ engaging?: boolean, fight_session_id?: string | null, character_id?: string | null }} state
 * @returns {EngageBlock | null}
 */
export function engage_block({ engaging = false, fight_session_id = null, character_id = null } = {}) {
  if (engaging) return 'engaging'
  if (fight_session_id) return 'fight_session'
  if (!character_id) return 'no_character'
  return null
}

/**
 * The player-facing i18n key for a block, or null when the block is INTERNAL — the re-entry latch is not a
 * player-relevant refusal (the pill is already cleared while a claim is in flight), so it surfaces as a log
 * line rather than a toast. Every key here already ships in all six locales.
 * @type {Record<EngageBlock, string | null>}
 */
const BLOCK_COPY = {
  engaging: null,
  // the exact fact the on-chain refusal already words this way — one home for the copy too
  fight_session: 'errors.fight_character_busy',
  no_character: 'errors.engage_no_character',
}

/**
 * @param {EngageBlock | null} block
 * @returns {string | null} the i18n key to render/toast, or null when there is nothing to say to the player.
 */
export const engage_block_copy_key = (block) => (block ? (BLOCK_COPY[block] ?? null) : null)
