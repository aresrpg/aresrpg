// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Summon (minion) lifecycle: spawn an AI-driven fighter onto the caster's team mid-fight.
//
// A AresRPG `summon` spell effect drops a mob-shaped fighter at/near the cast cell, on the caster's team, INTO
// the turn order — so the server's existing AI driver (it sends `ai_turn` for any non-is_player active
// fighter) gives it turns with NO server change. The minion shares the generic MOB_ATTACK (like a mob), so
// it moves toward + strikes the nearest enemy via the existing AI/cast path. It dies as a corpse (skipped by
// the turn advance, exactly like a dead mob), so "despawn on death" needs no special teardown.
//
// CAP: a caster may have at most `summons` (the reference-corpus stat, base 1 + equipment + in-fight buffs) LIVING
// summons at once; a cast over the cap is a no-op. The cap is PER SUMMONER (each summon carries its `owner_id`).
//
// DETERMINISM: the id comes from the monotonic next_id (no rng), HP from an integer formula, placement from a
// fixed-order free-cell scan. The minion's stats are a BAKED template (a sim constant, mirroring
// MOB_ATTACK_TEMPLATE) until per-summon content tables land — a flagged follow-up. Pure: plain data in/out.

import {
  next_id,
  team_of,
  find_entity_at,
  stat_modifier,
} from './fight_state.js'
import { MOB_ATTACK_ID } from './spell_templates.js'

const SUMMON_AP_MAX = 6
const SUMMON_MP_MAX = 3

// The `summons` stat default (SPEC.md "17 Stats", l.1082: equipment-derived, default 1 = "Max simultaneous
// summons"). Used when a caster has no baked summons stat (mobs, test fixtures): the cap falls back to 1.
const DEFAULT_SUMMON_CAP = 1

/**
 * A caster's EFFECTIVE max simultaneous summons: the baked `summons` stat (base 1 + equipment) plus any active
 * in-fight summons buff/debuff (the existing `statistic: summons` spell plumbing). Clamped >= 0, integer.
 * @param {import('./fight_state.js').FightEntity} caster
 * @returns {number}
 */
const summon_cap = caster =>
  Math.max(
    0,
    (caster.stats.summons ?? DEFAULT_SUMMON_CAP) +
      stat_modifier(caster, 'summons'),
  )

/**
 * How many LIVING summons the caster currently owns across both teams (per-summoner cap, reference-corpus-faithful: the
 * cap is per the summoner, not per team — two summoners on one team keep independent pools).
 * @param {import('./fight_state.js').FightState} state
 * @param {string} caster_id
 * @returns {number}
 */
const living_owned_summons = (state, caster_id) =>
  [...state.team0, ...state.team1].filter(
    e => e.is_summon && e.owner_id === caster_id && e.health > 0,
  ).length

/**
 * A minion's max HP: baked, integer, scaling with the summoner's level (offensive power rides MOB_ATTACK +
 * the minion's level, which equals the caster's). Flagged: per-summon stat tables are a content follow-up.
 * @param {number} caster_level
 * @returns {number}
 */
const summon_health = caster_level => 30 + caster_level * 10

/**
 * First free (terrain-walkable AND unoccupied) cell at, or adjacent to, `cell`, scanned in a fixed order
 * (self -> orthogonals -> diagonals) for determinism, or null if the whole neighborhood is blocked.
 * @param {import('./fight_state.js').FightState} state
 * @param {(cell: import('./cell.js').Cell) => boolean} terrain_walkable
 * @param {import('./cell.js').Cell} cell
 * @returns {import('./cell.js').Cell | null}
 */
const free_cell_near = (state, terrain_walkable, cell) => {
  const ring = [
    cell,
    { x: cell.x + 1, y: cell.y },
    { x: cell.x - 1, y: cell.y },
    { x: cell.x, y: cell.y + 1 },
    { x: cell.x, y: cell.y - 1 },
    { x: cell.x + 1, y: cell.y + 1 },
    { x: cell.x + 1, y: cell.y - 1 },
    { x: cell.x - 1, y: cell.y + 1 },
    { x: cell.x - 1, y: cell.y - 1 },
  ]
  return (
    ring.find(c => terrain_walkable(c) && !find_entity_at(state, c)) ?? null
  )
}

/**
 * Spawn a minion for `caster` at/near `cell`: append it to the caster's team AND the turn order (so the AI
 * driver picks it up), and report a SUMMON effect (the server maps `status:'SUMMON'` to a spawn broadcast).
 * A no-op (empty effects) when the caster has no team or the neighborhood has no free cell.
 * @param {import('./fight_state.js').FightState} state
 * @param {import('./fight_state.js').FightEntity} caster
 * @param {import('./cell.js').Cell} cell
 * @param {(cell: import('./cell.js').Cell) => boolean} terrain_walkable
 * @param {string} variant   the AresRPG `summon` id (art key); '' = a generic minion
 * @returns {{ state: import('./fight_state.js').FightState, effects: import('./fight_spells.js').SpellCastEffect[] }}
 */
export const summon_entity = (
  state,
  caster,
  cell,
  terrain_walkable,
  variant,
) => {
  const team = team_of(state, caster.id)
  if (team === -1) return { state, effects: [] }
  // Per-caster summon cap (the `summons` stat): a caster already at its cap of living summons spawns no
  // more — a no-op (empty effects), exactly like the no-team / no-free-cell guards.
  if (living_owned_summons(state, caster.id) >= summon_cap(caster))
    return { state, effects: [] }
  const spot = free_cell_near(state, terrain_walkable, cell)
  if (!spot) return { state, effects: [] }

  const { state: s2, id } = next_id(state)
  const health = summon_health(caster.level)
  /** @type {import('./fight_state.js').FightEntity} */
  const summon = {
    id: `summon_${id}`,
    name: variant === '' ? 'Summon' : variant,
    cell: spot,
    health,
    health_max: health,
    ap: SUMMON_AP_MAX,
    ap_max: SUMMON_AP_MAX,
    mp: SUMMON_MP_MAX,
    mp_max: SUMMON_MP_MAX,
    ap_used: 0,
    mp_used: 0,
    is_player: false,
    is_summon: true,
    owner_id: caster.id,
    template_id: 'summon',
    level: caster.level,
    stats: {},
    effects: [],
    deck: [],
    hand: [MOB_ATTACK_ID],
    discard: [],
    spell_levels: { [MOB_ATTACK_ID]: 1 },
    ap_reserve: 0,
    ...(variant === '' ? {} : { variant }),
  }
  const teamed =
    team === 0
      ? { ...s2, team0: [...s2.team0, summon] }
      : { ...s2, team1: [...s2.team1, summon] }
  const ordered = { ...teamed, turn_order: [...teamed.turn_order, summon.id] }
  return {
    state: ordered,
    effects: [{ target_id: summon.id, status: 'SUMMON', cell: spot }],
  }
}
