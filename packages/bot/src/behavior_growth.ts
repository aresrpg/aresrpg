// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  characteristic_cost_step,
  characteristic_names,
  is_class_name,
  type CharacteristicName,
  type ClassName,
} from '@aresrpg/immutable'

import type { WorldSelection } from './behavior_world.ts'
import { owned_character, type GameplayContext } from './gameplay_context.ts'
import { identifier, nonempty, object_schema } from './gameplay_schema.ts'
import { spell_upgrade_quote } from './spell_catalog.ts'

/** Authored priorities, never a hidden build. Stat points go to the first listed stat they can
 * raise. Spell points go to the first listed spell that still has a rank to gain and wait until they
 * pay for it, so a later spell never takes what an earlier one is saving for. A hero with nothing to
 * spend fails the leaf, so its selector moves on. */
export type SpendAction = Readonly<{
  type: 'spend_points'
  character_id: string
  stats: readonly CharacteristicName[]
  spells: readonly string[]
}>
export const SPEND_ACTION_SCHEMA = object_schema({
  type: { const: 'spend_points' },
  character_id: identifier,
  stats: { type: 'array', uniqueItems: true, items: { oneOf: characteristic_names.map((stat) => ({ const: stat })) } },
  spells: { type: 'array', uniqueItems: true, items: nonempty },
})
/** Every whole class-cost step the unspent capital pays for in one stat. */
const stat_spending = (classe: ClassName, stat: CharacteristicName, value: number, points: number) => {
  let [spent, gained] = [0, 0]
  for (;;) {
    const step = characteristic_cost_step(classe, stat, value + gained)
    if (step.cost < 1 || spent + step.cost > points) return spent
    spent += step.cost
    gained += step.gain
  }
}
export const select_spending = (action: SpendAction, context: GameplayContext): WorldSelection => {
  const hero = owned_character(context, action.character_id)
  const { classe, id: character_id } = hero
  if (!is_class_name(classe) || hero.custody !== 'kiosk' || hero.active_fight)
    return { status: 'failure', code: 'character_not_available' }
  const points = (stat: CharacteristicName) => stat_spending(classe, stat, hero[stat], hero.available_points)
  const stat = action.stats.find((name) => points(name) > 0)
  if (stat)
    return {
      status: 'action',
      action: { kind: 'raise_stats', payload: { character_id, spending: { [stat]: points(stat) } } },
    }
  const spell = action.spells.find((name) => spell_upgrade_quote(name, hero) !== null)
  return spell && spell_upgrade_quote(spell, hero)!.cost <= hero.available_spell_points
    ? { status: 'action', action: { kind: 'raise_spell', payload: { character_id, spell } } }
    : { status: 'failure', code: 'nothing_to_spend' }
}
