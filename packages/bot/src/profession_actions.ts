// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  gatherable_of,
  is_tool_category,
  gather_gate,
  job_level_from_xp,
  craft_required_level,
  craft_batch_limit,
} from '@aresrpg/immutable'
import { live_resource_packs } from '@aresrpg/protocol'
import { craft_stack_plan, encumbered_asset_ids } from '@aresrpg/protocol/inventory'

import { object_schema, identifier, nonempty, coordinate, decode } from './gameplay_schema.ts'
import {
  owned_character,
  gameplay_action,
  zone_checkpoint_id,
  custody_of,
  assert_travel,
  travel_destination,
  assert_tracked_zone,
  type GameplayContext,
} from './gameplay_context.ts'
import { zone_key } from './actor_world.ts'
import { profession_recipe, profession_item, recipe_job } from './catalog.ts'
import { profession_inventory } from './actor_inventory.ts'

const gather_schema = object_schema({
  character_id: identifier,
  world: nonempty,
  zone_x: coordinate,
  zone_z: coordinate,
  pack_index: coordinate,
  item_type: nonempty,
  zone_checkpoint_id: nonempty,
})
const craft_schema = object_schema({
  character_id: identifier,
  output_type: nonempty,
  attempts: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
})
const equip_schema = object_schema({ character_id: identifier, item_id: identifier })
const ambush_schema = object_schema({ character_id: identifier })
type GatherPayload = Readonly<{
  character_id: string
  world: string
  zone_x: number
  zone_z: number
  pack_index: number
  item_type: string
  zone_checkpoint_id: string
}>
type CraftPayload = Readonly<{ character_id: string; output_type: string; attempts: number }>
const parse_tool = (value: unknown) => decode<Readonly<{ character_id: string; item_id: string }>>(equip_schema, value)
const parse_gather = (value: unknown) => decode<GatherPayload>(gather_schema, value)
const parse_craft = (value: unknown) => decode<CraftPayload>(craft_schema, value)
const parse_ambush = (value: unknown) => decode<Readonly<{ character_id: string }>>(ambush_schema, value)
const equip_plan = (context: GameplayContext) => {
  const payload = parse_tool(context.command.payload)
  const character = owned_character(context, payload.character_id)
  if ([character.custody !== 'kiosk', character.active_fight, character.ambush].some(Boolean))
    throw new Error('character_not_available')
  const item = profession_inventory(context.snapshot.inventory, character.kiosk).find(
    ({ id }) => id === payload.item_id
  )
  if (!item?.version || !is_tool_category(item.category)) throw new Error('tool_unavailable')
  if (character.level < item.level) throw new Error('equipment_level_required')
  const current = character.equipment.find(({ slot }) => slot === 'tool')
  if (character.equipment.some(({ id }) => id === item.id)) throw new Error('tool_already_equipped')
  return {
    input: {
      character_id: character.id,
      to_equip: [{ slot: 'tool' as const, item_id: item.id }],
      to_unequip: current ? [{ slot: 'tool' as const, item_id: current.id }] : [],
      custody: custody_of(character),
    },
  }
}
const gather_plan = (context: GameplayContext) => {
  const payload = parse_gather(context.command.payload)
  const character = owned_character(context, payload.character_id)
  assert_tracked_zone(context, character.id, payload.world, payload.zone_x, payload.zone_z)
  const row = context.snapshot.zones[zone_key(payload.world, payload.zone_x, payload.zone_z)]
  if (!row?.spawns || zone_checkpoint_id(row) !== payload.zone_checkpoint_id) throw new Error('needs_resync')
  const pack = live_resource_packs(row.spawns.resources, row.zone).find(
    (entry) => entry.index === payload.pack_index && entry.item_type === payload.item_type
  )
  const resource = gatherable_of(payload.item_type)
  if (![pack, resource].every(Boolean)) throw new Error('resource_unavailable')
  const gate = gather_gate(character, resource!)
  if (!gate.ok) throw new Error(gate.reason === 'level' ? 'gathering_level_required' : 'gathering_tool_required')
  assert_travel(character, payload, pack!.x, pack!.z, context.snapshot.clock!.chain_ms)
  return {
    travel: travel_destination(character, pack!.x, pack!.z),
    input: {
      ...payload,
      rare_item_type: resource!.rare_item_type,
      existing: null,
      existing_rare: null,
      custody: custody_of(character),
    },
  }
}
const craft_plan = (context: GameplayContext) => {
  const payload = parse_craft(context.command.payload)
  const character = owned_character(context, payload.character_id)
  if ([character.custody !== 'kiosk', character.active_fight, character.ambush].some(Boolean))
    throw new Error('character_not_available')
  const recipe = profession_recipe(payload.output_type)
  const item = profession_item(payload.output_type)
  const job = recipe_job(payload.output_type)
  if (![recipe, item, job].every(Boolean)) throw new Error('recipe_unavailable')
  if (payload.attempts > craft_batch_limit(item!.category)) throw new Error('craft_batch_limit')
  if (job_level_from_xp(Number(character.jobs[job!] ?? '0')) < craft_required_level(Object.keys(recipe!.inputs).length))
    throw new Error('crafting_level_required')
  const inventory = profession_inventory(context.snapshot.inventory, character.kiosk)
  if (inventory.some((row) => !row.version)) throw new Error('inventory_unavailable')
  const state = context.snapshot.inventory!
  const plan = craft_stack_plan(
    recipe!.inputs,
    payload.attempts,
    inventory,
    encumbered_asset_ids(state.listings!, state.trades!),
    character.kiosk
  )
  if (!plan) throw new Error('ingredients_required')
  return {
    input: {
      ...payload,
      input_item_ids: plan.map(({ target_id }) => target_id),
      merges: plan,
      existing: null,
      custody: custody_of(character),
    },
  }
}
const ambush_plan = (context: GameplayContext) => {
  const { character_id } = parse_ambush(context.command.payload)
  const character = owned_character(context, character_id)
  if (character.custody !== 'kiosk' || character.active_fight || !character.ambush)
    throw new Error('protector_required')
  return { input: { character_id, protector_mob_type: character.ambush.protector, custody: custody_of(character) } }
}
export const PROFESSION_ACTIONS = {
  equip_tool: gameplay_action({
    description:
      'Equip one available tool from the owned character kiosk through the SDK, replacing its observed tool atomically. Observe the equipment change before gathering or resuming a profession run.',
    input_schema: equip_schema,
    parse: parse_tool,
    validate: equip_plan,
    execute: (sdk, input) => sdk.equip(input),
  }),
  gather: gameplay_action({
    description:
      'Harvest one observed resource node through the SDK. Checks exact pack, tool, job level, custody and chain travel. A protector stops ordinary continuation.',
    input_schema: gather_schema,
    parse: parse_gather,
    validate: gather_plan,
    execute: (sdk, input) => sdk.gather(input),
  }),
  craft: gameplay_action({
    description:
      'Craft an approved recipe from current available inventory in the character kiosk, reusing SDK stack preparation. Attempts consume ingredients even when the craft roll fails.',
    input_schema: craft_schema,
    parse: parse_craft,
    validate: craft_plan,
    execute: (sdk, input) => sdk.craft(input),
  }),
  resolve_ambush: gameplay_action({
    description:
      'Create the exact protector fight committed by an owned character gathering verdict. Does not choose combat actions or forfeit.',
    input_schema: ambush_schema,
    parse: parse_ambush,
    validate: ambush_plan,
    execute: (sdk, input) => sdk.resolve_ambush(input),
  }),
}
