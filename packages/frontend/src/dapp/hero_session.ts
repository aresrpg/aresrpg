// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The game's character and jobs tabs, driven for a hero of the bot account: they read the hero and its
// bag as the game server pushes them, and every change they make is one direct request of the bot wallet.
import type { CharacteristicValues } from '@aresrpg/immutable'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'

import type { CharacterSession } from '../characters/character_session.ts'
import { equipment_change_set, equipment_map_of, type EquipmentMap } from '../characters/equipment_stage.ts'

import type { DirectPayload, HeroDirectAction } from './direct.ts'
import { direct_free, type DappState } from './state.ts'

type Hero = Readonly<CharacterRow>
/** One change of one hero, in the bot's own words. */
export type HeroDirect = Readonly<{ action: HeroDirectAction; payload: DirectPayload }>

/**
 * Whether this hero's gear, characteristics and spells can change now, and whether it can craft. The
 * bot changes a hero that stands in its kiosk, out of a fight, an ambush and a dungeon, and it holds
 * one direct request at a time.
 */
export const hero_editable = (state: DappState, hero: Hero): boolean =>
  [direct_free(state), hero.custody === 'kiosk', !hero.active_fight, !hero.ambush, !hero.dungeon_run].every(Boolean)

/**
 * The bot's `equip_item` for one gesture of the equipment tab. A gesture changes one slot: it wears
 * an item there, which also swaps out what was worn, or it empties the slot, which names no item.
 * Gear that differs in no slot, or in several, is no single request: nothing is asked.
 */
export const equip_payload = (hero: Hero, next: EquipmentMap): DirectPayload | null => {
  const { to_equip, to_unequip } = equipment_change_set(next, equipment_map_of(hero))
  const [slot, ...others] = [...new Set([...to_equip, ...to_unequip].map((change) => change.slot))]
  if (slot === undefined || others.length) return null
  const [worn] = to_equip
  return worn ? { character_id: hero.id, slot, item_id: worn.item_id } : { character_id: hero.id, slot }
}

/**
 * The adapter the game's equipment, characteristics, spells and jobs tabs write through. `items` is
 * what this hero can use: its own kiosk, without what a listing or a trade locks. While the hero cannot
 * change, nothing is sent: a spell offers no raise, a craft is locked with `locked`, the sentence that
 * says why, and any other gesture says why through `refuse`. `roster` is the account's heroes and the
 * way to look at another one: the jobs tab advises a better crafter among them.
 */
export const hero_session = ({
  hero,
  items,
  roster,
  editable,
  locked,
  send,
  refuse,
}: Readonly<{
  hero: Hero
  items: readonly ItemRow[]
  roster: NonNullable<CharacterSession['roster']>
  editable: boolean
  locked: string
  send: (request: HeroDirect) => void
  refuse: () => void
}>): CharacterSession => {
  const ask = (action: HeroDirectAction, payload: DirectPayload): void =>
    editable ? send({ action, payload }) : refuse()
  return {
    inventory: items,
    roster,
    // One gesture is one `craft` of the bot: that many tries of one recipe, from this hero's kiosk.
    craft: {
      locked: editable ? null : locked,
      run: (output_type, attempts) => ask('craft', { character_id: hero.id, output_type, attempts }),
    },
    commit: (equipment) => {
      const payload = equip_payload(hero, equipment)
      if (payload) ask('equip_item', payload)
    },
    raise_stats: (spending: CharacteristicValues) => ask('raise_stats', { character_id: hero.id, spending }),
    ...(editable ? { raise_spell: (spell: string) => ask('raise_spell', { character_id: hero.id, spell }) } : {}),
  }
}
