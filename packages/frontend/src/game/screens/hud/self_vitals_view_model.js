// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE SELF VITALS VIEW-MODEL (#1993 WP7, audit row `SpellBar.jsx:52`) — mount scope and vitals as ONE atomic
// projection.
//
// The HP gem, the world self-plate and the design harness each spelled the same four-rung ladder themselves
// (`fight hp ?? expedition carried_hp ?? projected /v1 hp ?? character.health`), and each paired it with its own
// max — so a rung that answered null in one term and not the other rendered a fraction whose numerator and
// denominator came from two different worlds. SCOPE IS DECIDED ONCE here and every number is read from the
// scope that won: a surface can no longer half-read.
//
// The HP a fight scope reports is the entity vitals record's DISPLAY value — the one number a bar renders
// (`vitals_record.js`). It is deliberately NOT the presentation fold: at rest that fold carries this client's
// unacked prediction, which is how the turn card and this gem came to show two different numbers for one
// fighter in one frame.
//
// PURE — no store read, no clock. `projected_health` (the lazy-regen projection of the on-chain block) is an
// INPUT because it is a function of `now`; each caller owns its own repaint cadence for it (SpellBar reads it
// per render, SelfPlate drives it off a timer hook).

import { get_total_stat, STATISTICS } from '@aresrpg/sdk/stats'
import { character_max_hp } from '../../../chain/read_character.js'

/**
 * @param {{
 *   fighter?: { vitals?: { display?: number|null, max?: number|null, ap?: number|null, ap_max?: number|null,
 *     mp?: number|null, mp_max?: number|null } } | null,
 *   expedition?: { carried_hp?: number, max_hp?: number } | null,
 *   character?: any,
 *   projected_health?: number|null,
 * }} args
 * @returns {{ scope: 'fight'|'expedition'|'character'|'none', health: number, max_health: number,
 *   ap: number, ap_max: number|null, mp: number, mp_max: number|null }}
 */
export const self_vitals_view_model = ({
  fighter = null,
  expedition = null,
  character = null,
  projected_health = null,
} = {}) => {
  // FIGHT — the canonical entity row wins outright, HP and max together.
  if (fighter?.vitals)
    return {
      scope: 'fight',
      health: Number(fighter.vitals.display ?? 0),
      max_health: Number(fighter.vitals.max ?? 0),
      ap: Number(fighter.vitals.ap ?? 0),
      ap_max: fighter.vitals.ap_max ?? null,
      mp: Number(fighter.vitals.mp ?? 0),
      mp_max: fighter.vitals.mp_max ?? null,
    }

  // The out-of-fight budget is the character's own stat block; a run carries HP but no per-turn pools.
  const ap = character ? get_total_stat(character, STATISTICS.ACTION) : 0
  const mp = character ? get_total_stat(character, STATISTICS.MOVEMENT) : 0

  // EXPEDITION — #42 backend-off: outside a fight the player's real HP is the ACTIVE run's on-chain carried_hp.
  if (expedition)
    return {
      scope: 'expedition',
      health: Number(expedition.carried_hp ?? 0),
      max_health: Number(expedition.max_hp ?? 0),
      ap,
      ap_max: null,
      mp,
      mp_max: null,
    }

  // CHARACTER — the lobby: the caller's lazy-regen projection of the on-chain block, paired with the chain-exact
  // geared max that shares its scale (read_character.js: never `get_max_health`).
  if (character)
    return {
      scope: 'character',
      health: Number(projected_health ?? character.health ?? 0),
      max_health: character._type ? character_max_hp(character) : 0,
      ap,
      ap_max: null,
      mp,
      mp_max: null,
    }

  return { scope: 'none', health: 0, max_health: 0, ap: 0, ap_max: null, mp: 0, mp_max: null }
}

/** The gem/bar fill for a vitals view-model — 0 when there is no denominator, never a fabricated full bar. */
export const self_vitals_pct = ({ health, max_health }) =>
  max_health > 0 ? Math.max(0, Math.min(100, (health / max_health) * 100)) : 0
