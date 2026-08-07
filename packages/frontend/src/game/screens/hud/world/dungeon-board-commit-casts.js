// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { WEAPON_ATTACK_ID, WEAPON_ATTACK_RANGE } from '../../../core/modules/fight.js'
import { game_log } from '../../../../core/log.js'
import { fight_store } from '@aresrpg/fight/store'
import { committed_mob_hp, committed_truth, fight_view } from '@aresrpg/fight/project'
import {
  CAST_DROP_STALE_TARGET,
  CAST_DROP_TARGET_OUT_OF_REACH,
  local_commit_cast_drop,
  strike_flush_illegal,
} from '@aresrpg/fight/turn_commit'
import { evolve_flush_casts } from '@aresrpg/fight/predict_cast'
import { retarget_cast } from '@aresrpg/fight/txs'
import { places_trap } from '@aresrpg/sim/spell_targeting'
import { decode } from '@aresrpg/fight/los'
import { cast_range_set_dungeon } from '../../../../fight-engine/overlay_intents.js'
import { target_cap_reached } from '@aresrpg/fight/draft_budget'
import { dungeon_grid_of } from '../../dungeon-grid.js'
import { context } from '../../../store.js'
import { is_bare_hands, weapon_action_name } from '../deck-weapon-socket.js'
import { equipped_weapon_name } from '../inventory-equip.js'
import { evolution_actions_of } from './DungeonBoardState.jsx'

function cast_los(obstacles, occupied, caster_seat) {
  const los = [...obstacles]
  for (const [cell, occupant] of occupied)
    if (occupant.alive && !(occupant.kind === 'player' && occupant.idx === caster_seat)) los.push(cell)
  return los
}

function weapon_cast_verdict({ entry, cast_anchor, me, dungeon, los, target_committed_cell, occupied }) {
  const reach = me.weapon?.reach ?? WEAPON_ATTACK_RANGE[1]
  const footprint = cast_range_set_dungeon([1, reach], { cell: decode(cast_anchor) }, dungeon_grid_of(dungeon), los, {
    los: true,
    linear: false,
  })
  const retargeted = retarget_cast({
    target_cell: entry.cell,
    committed_cell: target_committed_cell,
    reaches: (cell) => footprint.has(cell),
  })
  if (retargeted.dropped) return { drop_reason: CAST_DROP_TARGET_OUT_OF_REACH }
  const target_cell = retargeted.target
  const target = occupied.get(target_cell)
  const illegal = strike_flush_illegal({
    in_footprint: footprint.has(target_cell),
    is_weapon: true,
    target_is_mob: target?.kind === 'mob',
    committed_target_alive: target?.kind === 'mob' && (committed_mob_hp(fight_store.getState(), target.idx) ?? 0) > 0,
  })
  return { target_cell, illegal }
}

function spell_cast_verdict({
  entry,
  drafted_spell,
  cast_anchor,
  active_fighter,
  dungeon,
  los,
  fight,
  cast_queue,
  cast_i,
  level_row,
  cast_params,
  target_committed_cell,
}) {
  const level = level_row(drafted_spell)
  const range = level?.range ?? [cast_params.range_min, cast_params.range_max]
  const places_trap_at_level = places_trap(level ?? {})
  const self_cast = (range?.[1] ?? 0) === 0
  const footprint = cast_range_set_dungeon(
    level ?? range,
    { ...active_fighter, cell: decode(cast_anchor) },
    dungeon_grid_of(dungeon),
    los,
    {
      los: level?.line_of_sight !== false,
      linear: level?.linear === true,
      free_cell: level?.free_cell === true,
      modifiable_range: level?.modifiable_range === true,
      trap_cells: places_trap_at_level ? (fight?.my_traps ?? []).filter((cell) => cell !== entry.cell) : null,
      target_cap_reached: (cell) =>
        target_cap_reached(cast_queue.slice(0, cast_i), entry.spell_key, cell, level?.casts_per_target),
    }
  )
  const retargeted = self_cast
    ? { target: cast_anchor }
    : retarget_cast({
        target_cell: entry.cell,
        committed_cell: target_committed_cell,
        reaches: (cell) => footprint.has(cell),
      })
  if (retargeted.dropped) return { drop_reason: CAST_DROP_TARGET_OUT_OF_REACH }
  const target_cell = retargeted.target
  return {
    target_cell,
    illegal: strike_flush_illegal({ in_footprint: footprint.has(target_cell), is_weapon: false, self_cast }),
  }
}

function dropped_cast({
  reason,
  entry,
  cast_anchor,
  is_weapon,
  background,
  entity_id,
  spell_name,
  drafted_spell,
  level_row,
}) {
  game_log('board', `flush_commit: staged strike dropped — ${reason}`, {
    cell: entry.cell,
    anchor: cast_anchor,
    weapon: is_weapon,
    background,
  })
  return {
    action: null,
    drop: local_commit_cast_drop({ actor_id: entity_id, spell_name, reason }),
    trap_dropped: places_trap(level_row(drafted_spell) ?? {}) ? entry.cell : null,
    trap_placed: null,
  }
}

function validate_cast_entry({
  entry,
  cast_i,
  evolved,
  committed_caster_cell,
  caster_seat,
  my_spells,
  level_row,
  occupied,
  obstacles,
  t,
  background,
  entity_id,
  me,
  dungeon,
  active_fighter,
  fight,
  cast_queue,
  cast_params,
  weapon_label,
}) {
  const is_weapon = entry.spell_key === WEAPON_ATTACK_ID
  const drafted_spell = is_weapon ? null : (my_spells.find((spell) => spell.name_key === entry.spell_key) ?? null)
  const ground_targeted = !is_weapon && level_row(drafted_spell)?.free_cell === true
  const cast_anchor = evolved[cast_i]?.caster_cell ?? committed_caster_cell
  const spell_name = is_weapon
    ? weapon_label
    : t(`spells.spell_${entry.spell_key}`, { defaultValue: drafted_spell?.name ?? entry.spell_key })
  const current_occupied = evolved[cast_i]?.occupied ?? occupied
  const caster_alive = [...current_occupied.values()].find(
    (fighter) => fighter.kind === 'player' && fighter.idx === caster_seat
  )?.alive
  const los = cast_los(obstacles, current_occupied, caster_seat)
  const eye_target = ground_targeted ? null : occupied.get(entry.cell)
  const target_committed_cell = eye_target
    ? (committed_truth(fight_store.getState()).fighters?.[`${eye_target.kind === 'mob' ? 'm' : 'p'}${eye_target.idx}`]
        ?.cell ?? null)
    : null
  const drop = (reason) =>
    dropped_cast({
      reason,
      entry,
      cast_anchor,
      is_weapon,
      background,
      entity_id,
      spell_name,
      drafted_spell,
      level_row,
    })
  if (caster_alive === false) return drop(CAST_DROP_STALE_TARGET)
  const verdict = is_weapon
    ? weapon_cast_verdict({
        entry,
        cast_anchor,
        me,
        dungeon,
        los,
        target_committed_cell,
        occupied: current_occupied,
      })
    : spell_cast_verdict({
        entry,
        drafted_spell,
        cast_anchor,
        active_fighter,
        dungeon,
        los,
        fight,
        cast_queue,
        cast_i,
        level_row,
        cast_params,
        target_committed_cell,
      })
  if (verdict.drop_reason) return drop(verdict.drop_reason)
  if (verdict.illegal) return drop(CAST_DROP_STALE_TARGET)
  if (is_weapon)
    return {
      action: { kind: 2, target: verdict.target_cell, spell_key: WEAPON_ATTACK_ID },
      drop: null,
      trap_dropped: null,
      trap_placed: null,
    }
  if (drafted_spell?.object_id)
    return {
      action: {
        kind: 1,
        target: verdict.target_cell,
        spell_template_id: drafted_spell.object_id,
        spell_key: drafted_spell.name_key,
      },
      drop: null,
      trap_dropped: null,
      trap_placed: places_trap(level_row(drafted_spell) ?? {}) ? verdict.target_cell : null,
    }
  game_log('board', 'flush_commit: cast drafted but no on-chain spell id resolved — skipped', {
    spell_key: entry.spell_key,
  })
  return { action: null, drop: null, trap_dropped: null, trap_placed: null }
}

export function validate_commit_casts({
  draft_actions,
  my_spells,
  me,
  fight,
  entity_id,
  resolve_ref,
  occupied,
  obstacles,
  dungeon,
  level_row,
  cast_params,
  active_fighter,
  background,
  t,
}) {
  const cast_queue = (draft_actions ?? [])
    .filter((action) => action.kind === 1 || action.kind === 2)
    .map((action) => ({ cell: action.target, spell_key: action.spell_key ?? null }))
  const committed_caster_cell = me?.committed?.cell ?? me?.cell ?? null
  const caster_seat = resolve_ref(entity_id)?.idx ?? -1
  // #2279 — THE SWING'S NAME, resolved once for this flush: the attack IS the item, so a dropped strike
  // names the weapon that would have swung. Exactly the label the bar's slot 0 wears (`weapon_action_name`
  // over the paper doll's `equipped_weapon_name`), so the log and the socket cannot call one action by two
  // names; bare hands and an unread equipment feed keep the generic strings.
  const game_state = context.get_state()
  const weapon_label = weapon_action_name(
    equipped_weapon_name(
      (game_state.sui?.characters ?? []).find((row) => row.id === entity_id) ?? null,
      game_state.sui?.items
    ),
    is_bare_hands(me?.weapon),
    t
  )
  const evolved = evolve_flush_casts({
    view: fight_view(),
    committed: committed_truth(fight_store.getState()),
    caster_id: entity_id,
    actions: evolution_actions_of(draft_actions, my_spells, me?.weapon),
    resolve_ref,
  })
  const empty = () => ({ action: null, drop: null, trap_dropped: null, trap_placed: null })
  const results =
    me && dungeon && committed_caster_cell != null
      ? cast_queue.map((entry, cast_i) =>
          validate_cast_entry({
            entry,
            cast_i,
            evolved,
            committed_caster_cell,
            caster_seat,
            my_spells,
            level_row,
            occupied,
            obstacles,
            t,
            background,
            entity_id,
            me,
            dungeon,
            active_fighter,
            fight,
            cast_queue,
            cast_params,
            weapon_label,
          })
        )
      : cast_queue.map(empty)
  const cast_drops = results.flatMap((result) => (result.drop ? [result.drop] : []))
  return {
    cast_actions: results.map((result) => result.action),
    trap_placed: results.flatMap((result) => (result.trap_placed == null ? [] : [result.trap_placed])),
    trap_dropped: results.flatMap((result) => (result.trap_dropped == null ? [] : [result.trap_dropped])),
    dropped: cast_drops.length,
    cast_drops,
  }
}
