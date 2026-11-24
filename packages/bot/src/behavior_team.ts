// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CharacterRow, ItemRow, ListingRow, TradeRow } from '@aresrpg/protocol'
import { available_inventory_items, encumbered_asset_ids } from '@aresrpg/protocol/inventory'

import { inventory_read } from './actor_inventory.ts'
import type { SelectedAction } from './behavior_targets.ts'
import type { WorldSelection } from './behavior_world.ts'
import { COMBAT_PROFILE_SCHEMA, type CombatProfile } from './combat_profile.ts'
import {
  owned_character,
  type GameplayContext,
  fight_checkpoint_id,
  hydrate_gameplay_fight,
} from './gameplay_context.ts'
import { identifier, nonempty, object_schema, type Schema } from './gameplay_schema.ts'
import { dungeon_content, joinable_team } from './team_actions.ts'

/** Teammates are heroes of the same wallet: each follows its own tree, and none leads. */
export const ALLIES_SCHEMA: Schema = { type: 'array', items: identifier, uniqueItems: true }
export type JoinAction = Readonly<{ type: 'join'; character_id: string; allies: readonly string[] }>
export type DungeonAction = Readonly<{
  type: 'dungeon'
  character_id: string
  world: string
  dungeon: string
  profile: CombatProfile
  allies?: readonly string[]
}>
const dungeon_properties = {
  type: { const: 'dungeon' },
  character_id: identifier,
  world: nonempty,
  dungeon: nonempty,
  profile: COMBAT_PROFILE_SCHEMA,
} as const
export const TEAM_LEAF_SCHEMAS = [
  object_schema({ type: { const: 'join' }, character_id: identifier, allies: ALLIES_SCHEMA }),
  { ...object_schema({ ...dungeon_properties, allies: ALLIES_SCHEMA }), required: Object.keys(dungeon_properties) },
] as const
type Room = Readonly<{ dungeon: string; room: number }>
/** A listed teammate's placement this hero can still take a seat in, of the same kind and room. */
const open_fight = (
  hero: string,
  allies: readonly string[],
  context: GameplayContext,
  room?: Room
): SelectedAction | undefined =>
  context.snapshot.characters
    .filter((ally) => allies.includes(ally.id) && ally.active_fight)
    .flatMap((ally) => {
      const row = context.snapshot.fights[ally.active_fight!.id]
      if (!row) return []
      const { contract } = hydrate_gameplay_fight(row)
      const same_kind = room
        ? contract.dungeon === room.dungeon && Number(contract.dungeon_room) === room.room
        : contract.dungeon === null
      if (!same_kind || joinable_team(contract, context.address, hero) === null) return []
      const payload = { character_id: hero, fight: contract.id, checkpoint_id: fight_checkpoint_id(row) }
      return [{ kind: 'fight_join' as const, payload: room ? { ...payload, dungeon: room.dungeon } : payload }]
    })[0]
export const select_join = (action: JoinAction, context: GameplayContext): WorldSelection => {
  const hero = owned_character(context, action.character_id)
  const free = [hero.custody === 'kiosk', !hero.active_fight, !hero.ambush, !hero.dungeon_run].every(Boolean)
  const joined = free ? open_fight(hero.id, action.allies, context) : undefined
  return joined ? { status: 'action', action: joined } : { status: 'failure', code: 'fight_not_joinable' }
}
/** What a wallet holds as the bot observes it: every item, with the listings and trades that lock some. */
type RaidBag = Readonly<{
  items: readonly ItemRow[]
  listings: readonly ListingRow[]
  trades: readonly TradeRow[]
}>
/** The keys of one kiosk a raid can burn: certified on chain and neither listed nor in a trade. */
export const raid_keys = (bag: RaidBag, key: string, kiosk: string): readonly ItemRow[] =>
  available_inventory_items(bag.items, encumbered_asset_ids(bag.listings, bag.trades), kiosk).filter(
    (item) => item.version && item.item_type === key
  )
/** Entering burns a key for good. Of the listed heroes, in their order, those who can be in this
 * dungeon run: already inside it, or one hero per usable key of its kiosk. A hero the wallet does not
 * hold cannot. A hero enters only when this is the whole team. */
export const raid_entrants = (
  raid: Readonly<{
    dungeon: string
    key: string
    team: readonly string[]
    heroes: readonly Readonly<Pick<CharacterRow, 'id' | 'kiosk' | 'dungeon_run'>>[]
    bag: RaidBag
  }>
): readonly string[] => {
  const members = raid.team.flatMap((id) => raid.heroes.find((hero) => hero.id === id) ?? [])
  const outside = members.filter((hero) => hero.dungeon_run?.dungeon !== raid.dungeon)
  const units = (kiosk: string) => raid_keys(raid.bag, raid.key, kiosk).reduce((total, { amount }) => total + amount, 0)
  const keyed = outside.filter(
    (hero, index) => outside.slice(0, index).filter(({ kiosk }) => kiosk === hero.kiosk).length < units(hero.kiosk)
  )
  return members.filter((hero) => !outside.includes(hero) || keyed.includes(hero)).map(({ id }) => id)
}
/** A hero enters only when every listed teammate can follow. */
const entry_step = (action: DungeonAction, hero: CharacterRow, context: GameplayContext): WorldSelection => {
  const { character_id, world, dungeon } = action
  const { inventory, characters } = context.snapshot
  if (!inventory_read(inventory)) return { status: 'waiting', code: 'inventory_unavailable' }
  const { key } = dungeon_content(dungeon)
  const team = [character_id, ...(action.allies ?? [])]
  const followed = raid_entrants({ dungeon, key, team, heroes: characters, bag: inventory }).length === team.length
  const [owned] = raid_keys(inventory, key, hero.kiosk)
  if (!followed || !owned) return { status: 'failure', code: 'item_unavailable' }
  const payload = { character_id, world, dungeon, key_id: owned.id }
  return { status: 'action', action: { kind: 'dungeon_enter', payload } }
}
/** Advance one dungeon run from what is observed: enter with an owned key, then for each room join
 * the fight a teammate already opened, otherwise open it. The room fight itself is ordinary combat. */
export const select_dungeon_step = (action: DungeonAction, context: GameplayContext): WorldSelection => {
  const hero = owned_character(context, action.character_id)
  const run = hero.dungeon_run
  if (!run) return entry_step(action, hero, context)
  const { character_id, world, dungeon } = action
  if (run.dungeon !== dungeon) return { status: 'failure', code: 'dungeon_unavailable' }
  const joined = open_fight(hero.id, action.allies ?? [], context, run)
  return { status: 'action', action: joined ?? { kind: 'dungeon_fight', payload: { character_id, world, dungeon } } }
}
