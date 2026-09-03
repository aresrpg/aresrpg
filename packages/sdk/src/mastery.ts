// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { bcs } from '@mysten/sui/bcs'
import { deriveObjectID, normalizeSuiObjectId } from '@mysten/sui/utils'
import type { MasteryRow } from '@aresrpg/protocol'

import { receipt_digest, receipt_event, owned_ref, type Receipt } from './cache.ts'
import { SDK, living_content } from './client.ts'
import { create_kiosk_runner, type KioskCapLoader, type KioskCustody } from './kiosk_runner.ts'
import { event_boolean, event_integer, event_string, event_u64 } from './receipt_decode.ts'
import { item_template_id, mastery_offer_id, world_content_id } from './seed_ids.ts'

type GameSdk = ReturnType<typeof SDK>

const address_registry = (sdk: GameSdk): string => {
  const id = (sdk.pins.friend_registry as Readonly<{ id?: unknown }> | undefined)?.id
  if (typeof id !== 'string') throw new Error('Mastery is unavailable: the address registry pin is missing.')
  return id
}

export const mastery_id = (registry: string, type_package: string, owner: string): string =>
  deriveObjectID(registry, `${type_package}::mastery::MasteryKey`, bcs.Address.serialize(owner).toBytes())

const option_u64 = (event: Readonly<Record<string, unknown>>, field: string): string | null => {
  const value = event[field]
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value[0] === undefined ? null : event_u64({ [field]: value[0] }, field)
  if (typeof value === 'object' && value !== null && Array.isArray(Reflect.get(value, 'vec')))
    return Reflect.get(value, 'vec')[0] === undefined
      ? null
      : event_u64({ [field]: Reflect.get(value, 'vec')[0] }, field)
  return event_u64(event, field)
}

export const mastery_row_from_event = (event: Readonly<Record<string, unknown>>): MasteryRow =>
  Object.freeze({
    id: normalizeSuiObjectId(event_string(event, 'mastery')),
    owner: normalizeSuiObjectId(event_string(event, 'owner')),
    points: event_u64(event, 'points'),
    last_completed_epoch: option_u64(event, 'last_completed_epoch'),
    quest_epoch: event_u64(event, 'quest_epoch'),
    quest_started_ms: event_u64(event, 'quest_started_ms'),
    quest_world: event_string(event, 'quest_world'),
    quest_dungeon: normalizeSuiObjectId(event_string(event, 'quest_dungeon')),
    quest_reward: event_integer(event, 'quest_reward'),
    quest_completed: event_boolean(event, 'quest_completed'),
  })

export const mastery_receipt_row = (receipt: Receipt): MasteryRow | null => {
  const event = receipt_event(receipt, '::mastery::MasteryUpdated')
  return event ? mastery_row_from_event(event) : null
}

export const mastery_actions = (
  sdk: GameSdk,
  { address, kiosk_cap }: Readonly<{ address: string; kiosk_cap: KioskCapLoader }>
) => {
  const { with_kiosk, with_terminal_kiosk } = create_kiosk_runner(sdk, kiosk_cap)
  const id = () => {
    if (!sdk.game_type_package) throw new Error('Mastery is unavailable: the defining package is missing.')
    return mastery_id(address_registry(sdk), sdk.game_type_package, address)
  }
  return Object.freeze({
    get id() {
      return id()
    },
    start: async ({
      world,
      character_id,
      custody,
    }: Readonly<{ world: string; character_id: string; custody?: KioskCustody }>) => {
      const mastery = id()
      const { content_root, seed_package_original } = living_content(sdk, 'Mastery assignment')
      const world_content = world_content_id(content_root, seed_package_original, world)
      await sdk.hydrate_unknown([mastery, world_content])
      const exists = owned_ref(sdk.cache, mastery) !== undefined
      const receipt = await with_terminal_kiosk(
        (tx, kiosk, personal) => {
          if (exists)
            sdk.doors.start_daily_quest(tx, { mastery_object: mastery, world_content, kiosk, personal, character_id })
          else sdk.doors.start_first_daily_quest(tx, { world_content, kiosk, personal, character_id })
        },
        { custody, gas_scope: `mastery:${address}` }
      )
      const row = mastery_receipt_row(receipt)
      if (!row) throw new Error('The daily quest receipt carried no MasteryUpdated state.')
      return Object.freeze({ digest: receipt_digest(receipt), mastery: row })
    },
    redeem: async ({
      item_type,
      existing,
      custody,
    }: Readonly<{ item_type: string; existing: string | null; custody?: KioskCustody }>) => {
      const mastery = id()
      const { content_root, seed_package_original } = living_content(sdk, 'Mastery redemption')
      if (!sdk.game_type_package) throw new Error('Mastery is unavailable: the defining package is missing.')
      const offer = mastery_offer_id(content_root, sdk.game_type_package, item_type)
      const template = item_template_id(content_root, seed_package_original, item_type)
      await sdk.hydrate_unknown([mastery, offer, template, ...(existing ? [existing] : [])])
      const receipt = await with_kiosk(
        (tx, kiosk, cap) =>
          sdk.doors.redeem_mastery_offer(tx, {
            mastery_object: mastery,
            offer,
            template,
            existing,
            kiosk,
            cap,
          }),
        { custody, gas_scope: `mastery:${address}` }
      )
      const row = mastery_receipt_row(receipt)
      if (!row) throw new Error('The redemption receipt carried no MasteryUpdated state.')
      return Object.freeze({ digest: receipt_digest(receipt), mastery: row })
    },
  })
}

export type MasteryActions = ReturnType<typeof mastery_actions>
