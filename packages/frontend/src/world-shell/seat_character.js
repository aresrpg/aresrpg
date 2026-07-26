// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// world-shell/seat_character.js — THE FIGHT HUD's seat row, and the ONE home of the level→experience
// derivation every xp gate on it decodes (#1001). It lives with the fight session, not under `roster/`,
// because its whole point is that a SEAT is not a wallet roster entry — and because the /simulator page must
// be able to read it (the zero-divergence arch rule keeps `roster/` off that page's import graph).
//
// On chain a character carries `experience` and never a `level`; the level is read back off the SDK curve. So
// every level-gated fight surface (the board's spell-unlock gate, the bar's XP strip) resolved its character
// out of `sui.characters` — the WALLET's roster — and any seat the wallet does not own was invisible to it.
// The simulator's seat is the standing case: `fight_shim`'s seeding door is GUARDED on an empty roster (so a
// real session's characters are never clobbered by a sandbox seat), which means a connected wallet owning
// chain characters — or simply a player who touched the world first — left `sim_c1` in no roster at all:
// `experience ?? 0` ⇒ 0 ⇒ LEVEL 1 ⇒ the three unlock-1 starters beside a seat carrying level-200 pools.
// #949's symptom by a third door, and #1000's seeded `experience` never even dispatched.
//
// The derivation therefore may not live behind that guard. It lives HERE, at the consumption seam, over the
// source that always holds a seated character regardless of wallet or seeding state: the FIGHT's own fighter
// book, projected from `ctx.roster` (which the sim shim hands the core directly at init) and already carrying
// the level the turn card prints (`character_level`, project.js).

import { level_to_experience } from '@aresrpg/sdk/experience'

/**
 * A row in the shape every xp consumer decodes. Rows built from a level rather than the curve — the
 * simulator's seats, the fight core's fighter projection — get that level's floor experience, so
 * `xp_progress` reads their real level back. Idempotent, and CHAIN TRUTH ALWAYS WINS: a row that already
 * carries `experience` is returned untouched, never re-synthesised from a level beside it.
 * @param {any} row @returns {any|null}
 */
export const with_experience = (row) => {
  if (!row) return null
  if (row.experience != null) return row
  const level = Number(row.level)
  return Number.isFinite(level) && level > 0 ? { ...row, experience: level_to_experience(level) } : row
}

/**
 * The character row a fight surface should show for `character_id`, from the two sources that between them
 * always hold it: the wallet's roster first (chain truth), else the live fight's own fighter.
 * Pure — the caller selects both, so this never reaches into a store.
 * @param {readonly any[]|null|undefined} characters `sui.characters`
 * @param {Map<string, any>|null|undefined} fighters `fight_view().fighters`
 * @param {string|null|undefined} character_id
 * @returns {any|null}
 */
export const seat_character = (characters, fighters, character_id) => {
  if (!character_id) return null
  return with_experience(
    (characters ?? []).find((character) => character?.id === character_id) ?? fighters?.get?.(character_id) ?? null
  )
}
