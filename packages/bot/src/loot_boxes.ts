// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { LOOT_BOX_BATCH_LIMIT } from '@aresrpg/sdk/character'
import { living_content, resolve_pins } from '@aresrpg/sdk/pins'
import { item_template_id } from '@aresrpg/sdk/seed-ids'
import { receipt_event, receipt_events, type Receipt } from '@aresrpg/sdk/cache'
import { stack_merge_target, encumbered_asset_ids } from '@aresrpg/protocol/inventory'

import items from '../../../seed/content/items.json'

import { object_schema, identifier, decode } from './gameplay_schema.ts'
import { owned_character, custody_of, type GameplayContext } from './gameplay_context.ts'
import { profession_inventory, inventory_projected } from './actor_inventory.ts'
import { profession_item } from './profession_catalog.ts'

const open_schema = object_schema({
  character_id: identifier,
  item_id: identifier,
  count: { type: 'integer', minimum: 1, maximum: LOOT_BOX_BATCH_LIMIT },
})
const claim_schema = object_schema({
  character_id: identifier,
  claim_ids: { type: 'array', items: identifier, minItems: 1, maxItems: LOOT_BOX_BATCH_LIMIT, uniqueItems: true },
})
export const LOOT_BOX_ACTIONS = Object.freeze({
  open_loot_boxes: {
    description:
      'Open an exact quantity from one available loot-box stack, including resource and mushroom bags. Uses the existing limit of 50. Observe the resulting claims, then explicitly call bot_claim_loot; opening alone does not deliver resources.',
    input_schema: open_schema,
    parse: (value: unknown) =>
      decode<Readonly<{ character_id: string; item_id: string; count: number }>>(open_schema, value),
  },
  claim_loot: {
    description:
      'Collect up to 50 observed owned box claims into the selected character kiosk through the SDK. Reward templates derive from observed claims, never caller input. Observe inventory before crafting or resuming a profession.',
    input_schema: claim_schema,
    parse: (value: unknown) =>
      decode<Readonly<{ character_id: string; claim_ids: readonly string[] }>>(claim_schema, value),
  },
})
const character_inventory = (context: GameplayContext, id: string) => {
  const character = owned_character(context, id)
  if (character.custody !== 'kiosk' || character.active_fight) throw new Error('character_not_available')
  return {
    custody: custody_of(character),
    inventory: profession_inventory(context.snapshot.inventory, character.kiosk),
  }
}
export const validate_open_boxes = (context: GameplayContext) => {
  const payload = LOOT_BOX_ACTIONS.open_loot_boxes.parse(context.command.payload)
  const { custody, inventory } = character_inventory(context, payload.character_id)
  const item = inventory.find(({ id }) => id === payload.item_id)
  if (
    !item?.version ||
    item.category !== 'consumable' ||
    profession_item(item.item_type)?.consumable?.type !== 'loot_box'
  )
    throw new Error('loot_box_unavailable')
  if (item.amount < payload.count) throw new Error('insufficient_loot_boxes')
  return {
    kind: 'open_loot_boxes' as const,
    input: { box_item_id: item.id, box_item_type: item.item_type, count: payload.count, custody },
  }
}
export const validate_claim_loot = (context: GameplayContext) => {
  const payload = LOOT_BOX_ACTIONS.claim_loot.parse(context.command.payload)
  const { custody, inventory } = character_inventory(context, payload.character_id)
  const { content_root, seed_package_original } = living_content(
    { pins: resolve_pins('mainnet', context.pins) },
    'Bot loot claims'
  )
  const templates = new Map(
    items.map(({ item_type }) => [item_template_id(content_root, seed_package_original, item_type), item_type])
  )
  const state = context.snapshot.inventory!
  const encumbered = encumbered_asset_ids(state.listings!, state.trades!)
  const claims = payload.claim_ids.map((claim_id) => {
    const claim = context.snapshot.inventory?.claims?.find(({ id }) => id === claim_id)
    const rolled_item_type = claim?.rolled_template && templates.get(claim.rolled_template)
    if (claim?.kind !== 'box' || !rolled_item_type) throw new Error('loot_claim_unavailable')
    return {
      claim_id,
      rolled_item_type,
      existing: stack_merge_target(inventory, encumbered, rolled_item_type, custody.kiosk),
    }
  })
  return { kind: 'claim_loot' as const, input: { claims, custody } }
}
export type LootBoxPlan = ReturnType<typeof validate_open_boxes> | ReturnType<typeof validate_claim_loot>
export const loot_boxes_projected = (receipt: Receipt, context: GameplayContext) => {
  if (!inventory_projected(receipt, context.snapshot.inventory)) return false
  const { claims } = context.snapshot.inventory!
  if (!claims) return false
  if (context.command.kind === 'open_loot_boxes') {
    const ids = receipt_event(receipt, '::loot_box::LootBoxesOpened')?.claim_ids
    return (
      Array.isArray(ids) &&
      ids.length === context.command.payload.count &&
      ids.every((id) => claims.some((claim) => claim.id === id && !!claim.rolled_template))
    )
  }
  const ids = LOOT_BOX_ACTIONS.claim_loot.parse(context.command.payload).claim_ids
  return (
    receipt_events(receipt, '::loot_box::LootClaimed').length === ids.length &&
    ids.every((id) => !claims.some((claim) => claim.id === id))
  )
}
