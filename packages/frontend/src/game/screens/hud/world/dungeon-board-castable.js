// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { WEAPON_ATTACK_ID } from '../../../core/modules/fight.js'
import { cast_range_set_dungeon } from '../../../../fight-engine/overlay_intents.js'
import { places_trap } from '@aresrpg/sim/spell_targeting'
import { decode } from '@aresrpg/fight/los'
import { dungeon_grid_of } from '../../dungeon-grid.js'
import { on_cooldown, cooldown_left, target_cap_reached } from '@aresrpg/fight/draft_budget'

export function cast_budget_state({ me, fight, cast_path, active_level, active_spell, last_cast_turn, my_turn_no }) {
  const my_ap = me?.committed?.ap ?? 0
  const my_mp = me?.committed?.mp ?? 0
  const my_mp_eff = Math.max(0, me?.mp ?? my_mp)
  const CASTS_UNLIMITED = 255
  const remaining_ap = Math.max(0, me?.ap ?? my_ap)
  const armed_id = fight?.armed_spell_id ?? null
  const cpt = armed_id === WEAPON_ATTACK_ID ? Infinity : (active_level?.casts_per_turn ?? CASTS_UNLIMITED)
  const cpt_cap = cpt === CASTS_UNLIMITED || cpt === 0 ? Infinity : cpt
  const armed_key = armed_id === WEAPON_ATTACK_ID ? WEAPON_ATTACK_ID : (active_spell?.name_key ?? null)
  const armed_queued = cast_path.reduce((n, entry) => (entry.spell_key === armed_key ? n + 1 : n), 0)
  const armed_cooldown = armed_id === WEAPON_ATTACK_ID ? 0 : (active_level?.cooldown ?? 0)
  return {
    my_mp_eff,
    remaining_ap,
    armed_key,
    armed_queued,
    armed_on_cd: on_cooldown(last_cast_turn[armed_key], my_turn_no, armed_cooldown),
    armed_cd_left: cooldown_left(last_cast_turn[armed_key], my_turn_no, armed_cooldown),
    cpt_cap_eff: armed_cooldown > 0 ? 1 : cpt_cap,
    cpt_target_authored: armed_id === WEAPON_ATTACK_ID ? Infinity : active_level?.casts_per_target,
  }
}

function cast_los_blockers(obstacles, occupied, me_cell, optimistic_vacated) {
  const blockers = [...obstacles]
  for (const [cell, occupant] of occupied)
    if (occupant.alive && cell !== me_cell && !optimistic_vacated.has(cell)) blockers.push(cell)
  return blockers
}

function spell_castable_cells({
  active_level,
  cast_params,
  active_fighter,
  caster_cell,
  dungeon,
  los_blockers,
  fight,
  cast_path,
  armed_key,
  cpt_target_authored,
}) {
  const level = active_level
  const my_trap_cells = places_trap(level ?? {}) && fight?.fight_id ? fight.my_traps : undefined
  return cast_range_set_dungeon(
    level ?? [cast_params.range_min, cast_params.range_max],
    { ...active_fighter, cell: decode(caster_cell) },
    dungeon_grid_of(dungeon),
    los_blockers,
    {
      los: level?.line_of_sight !== false,
      linear: level?.linear === true,
      free_cell: level?.free_cell === true,
      modifiable_range: level?.modifiable_range === true,
      trap_cells: my_trap_cells,
      target_cap_reached: (cell) => target_cap_reached(cast_path, armed_key, cell, cpt_target_authored),
    }
  )
}

function quick_castable_cells({
  fight,
  active_level,
  cast_params,
  active_fighter,
  caster_cell,
  dungeon,
  los_blockers,
  cast_path,
  armed_key,
  cpt_target_authored,
  occupied,
}) {
  const quick_level = fight?.armed_spell_id === WEAPON_ATTACK_ID ? null : active_level
  const footprint = cast_range_set_dungeon(
    [cast_params.range_min, cast_params.range_max],
    { ...active_fighter, cell: decode(caster_cell) },
    dungeon_grid_of(dungeon),
    los_blockers,
    {
      los: true,
      linear: quick_level?.linear === true,
      modifiable_range: quick_level?.modifiable_range === true,
      target_cap_reached:
        fight?.armed_spell_id === WEAPON_ATTACK_ID
          ? null
          : (cell) => target_cap_reached(cast_path, armed_key, cell, cpt_target_authored),
    }
  )
  const out = new Set()
  for (const [cell, occupant] of occupied) {
    if (occupant.kind !== 'mob' || !occupant.alive) continue
    if (footprint.has(cell)) out.add(cell)
  }
  return out
}

export function castable_cells(state) {
  const {
    me,
    my_turn,
    remaining_ap,
    cast_params,
    armed_queued,
    cpt_cap_eff,
    armed_on_cd,
    caster_cell,
    obstacles,
    occupied,
    optimistic_vacated,
    fight,
  } = state
  if (
    !me ||
    !my_turn ||
    remaining_ap < cast_params.ap_cost ||
    armed_queued >= cpt_cap_eff ||
    armed_on_cd ||
    caster_cell == null
  )
    return new Set()
  // Dungeon LOS clears through obstacles ∪ living bodies, excluding the caster's stale pre-move cell.
  const los_blockers = cast_los_blockers(obstacles, occupied, me.cell, optimistic_vacated)
  const inputs = { ...state, los_blockers }
  return fight?.armed_spell_id && fight.armed_spell_id !== WEAPON_ATTACK_ID
    ? spell_castable_cells(inputs)
    : quick_castable_cells(inputs)
}
