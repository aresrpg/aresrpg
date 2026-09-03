// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Dungeon writes are a thin coordinator over kiosk custody, living content, and normal fights.

import { SDK, living_content } from './client.ts'
import { receipt_digest, receipt_event } from './cache.ts'
import { create_kiosk_runner, type KioskCapLoader, type KioskCustody } from './kiosk_runner.ts'
import { created_fight_id, execute_settlement_mode, SETTLEMENT_BATCH_GAS_BUDGET_MIST } from './fight.ts'
import { mastery_receipt_row } from './mastery.ts'
import {
  board_catalog_id,
  dungeon_content_id,
  item_template_id,
  mob_template_id,
  world_content_id,
  world_id,
} from './seed_ids.ts'

type GameSdk = ReturnType<typeof SDK>

export type DungeonActionsCtx = Readonly<{ kiosk_cap: KioskCapLoader }>

export const dungeon_actions = (sdk: GameSdk, { kiosk_cap }: DungeonActionsCtx) => {
  const { with_kiosk, with_terminal_kiosk } = create_kiosk_runner(sdk, kiosk_cap)
  const content = (what: string) => living_content(sdk, what)
  const world_refs = (world: string, what: string) => {
    const { content_root, seed_package_original } = content(what)
    if (!sdk.game_type_package) throw new Error(`${what} unavailable: pins.json has no original game package`)
    return Object.freeze({
      content_root,
      seed_package_original,
      world_object: world_id(content_root, sdk.game_type_package, world),
      world_content: world_content_id(content_root, seed_package_original, world),
    })
  }
  const dungeon_ref = (dungeon: string, what: string) => {
    const { content_root, seed_package_original } = content(what)
    return dungeon_content_id(content_root, seed_package_original, dungeon)
  }
  const scope = (dungeon: string) => `dungeon:${dungeon}`

  return Object.freeze({
    enter: async ({
      character_id,
      custody,
      world,
      dungeon,
      key_id,
    }: {
      character_id: string
      custody?: KioskCustody
      world: string
      dungeon: string
      key_id: string
    }) => {
      const { world_object, world_content } = world_refs(world, 'Dungeon entry')
      const dungeon_content = dungeon_ref(dungeon, 'Dungeon entry')
      await sdk.hydrate_unknown([world_object, world_content, dungeon_content, key_id])
      const receipt = await with_terminal_kiosk(
        (tx, kiosk, personal) =>
          sdk.doors.enter_dungeon(tx, {
            world_object,
            kiosk,
            personal,
            character_id,
            world_content,
            dungeon_content,
            key_id,
          }),
        { custody, gas_scope: `dungeon-entry:${dungeon}` }
      )
      return Object.freeze({ digest: receipt_digest(receipt) })
    },

    start_fight: async ({
      character_id,
      custody,
      world,
      dungeon,
      mob_types,
      access,
    }: {
      character_id: string
      custody?: KioskCustody
      world: string
      dungeon: string
      mob_types: readonly string[]
      access: 0 | 1
    }) => {
      const { content_root, seed_package_original, world_object, world_content } = world_refs(world, 'Dungeon fight')
      const dungeon_content = dungeon_ref(dungeon, 'Dungeon fight')
      const catalog = board_catalog_id(content_root, seed_package_original)
      const templates = mob_types.map((mob_type) => mob_template_id(content_root, seed_package_original, mob_type))
      await sdk.hydrate_unknown([world_object, world_content, dungeon_content, catalog, ...templates])
      const receipt = await with_kiosk(
        (tx, kiosk, cap) => {
          const build = sdk.doors.engage_dungeon_room(tx, {
            world_object,
            world_content,
            dungeon_content,
            kiosk,
            cap,
            character_id,
            access,
            catalog,
          })
          const grown = templates.reduce(
            (current, template) => sdk.doors.add_fight_mob(tx, { build: current, template }),
            build
          )
          sdk.doors.launch_fight(tx, { build: grown })
        },
        { custody, gas_scope: scope(dungeon) }
      )
      const fight = created_fight_id(receipt)
      sdk.tag_gas?.(receipt, `fight:${fight}`)
      return Object.freeze({ digest: receipt_digest(receipt), fight })
    },

    join_fight: async ({
      fight,
      character_id,
      custody,
      party,
    }: {
      fight: string
      character_id: string
      custody?: KioskCustody
      party?: string | null
    }) => {
      await sdk.hydrate_unknown([fight, ...(party ? [party] : [])])
      const receipt = await with_kiosk(
        (tx, kiosk, cap) => {
          if (party)
            sdk.doors.join_dungeon_room_grouped(tx, {
              fight_object: fight,
              kiosk,
              cap,
              character_id,
              shared_party: party,
            })
          else sdk.doors.join_dungeon_room(tx, { fight_object: fight, kiosk, cap, character_id })
        },
        { custody, gas_scope: `fight:${fight}` }
      )
      return Object.freeze({ digest: receipt_digest(receipt) })
    },

    settle: async ({
      fight,
      dungeon,
      settlements,
      custody,
      mastery,
      last,
    }: {
      fight: string
      dungeon: string
      settlements: readonly Readonly<{
        fighter_idx: bigint
        loot: readonly Readonly<{ item_type: string; existing: string | null }>[]
      }>[]
      custody?: KioskCustody
      mastery?: Readonly<{ id: string; fighter_idx: bigint }> | null
      last?: boolean
    }) => {
      if (settlements.length === 0) throw new Error('Dungeon settlement batch is empty')
      const { content_root, seed_package_original } = content('Dungeon settlement')
      const dungeon_content = dungeon_ref(dungeon, 'Dungeon settlement')
      const normalized = settlements.map((settlement) =>
        Object.freeze({
          ...settlement,
          loot: [...new Map(settlement.loot.map((row) => [row.item_type, row])).values()],
        })
      )
      const templates = [
        ...new Set(
          normalized.flatMap(({ loot }) =>
            loot.map(({ item_type }) => item_template_id(content_root, seed_package_original, item_type))
          )
        ),
      ]
      await sdk.hydrate_unknown([fight, dungeon_content, ...templates, ...(mastery ? [mastery.id] : [])])
      const execute_settlement = (final: boolean) =>
        with_terminal_kiosk(
          (tx, kiosk, personal) => {
            if (mastery)
              sdk.doors.complete_daily_quest_if_eligible(tx, {
                mastery_object: mastery.id,
                fight_object: fight,
                fighter_idx: mastery.fighter_idx,
                dungeon_content,
              })
            const plan = normalized.flatMap(({ loot }) =>
              loot.map(({ item_type, existing }) =>
                sdk.doors.prepare_fight_loot(tx, {
                  template: item_template_id(content_root, seed_package_original, item_type),
                  existing,
                })
              )
            )
            const args = {
              dungeon_content,
              fight_object: fight,
              fighter_indices: normalized.map(({ fighter_idx }) => fighter_idx),
              plan_lengths: normalized.map(({ loot }) => loot.length),
              plan,
              kiosk,
              personal,
            }
            if (final) sdk.doors.settle_last_dungeon_room(tx, args)
            else sdk.doors.settle_dungeon_room(tx, args)
          },
          { custody, gas_scope: `fight:${fight}`, budget: SETTLEMENT_BATCH_GAS_BUDGET_MIST }
        )
      const receipt = await execute_settlement_mode(last, execute_settlement)
      return Object.freeze({
        digest: receipt_digest(receipt),
        closable: receipt_event(receipt, '::fight::FightClosable') !== null,
        closed: receipt_event(receipt, '::fight::FightClosed') !== null,
        mastery: mastery_receipt_row(receipt),
      })
    },

    give_up_fight: async ({
      fight,
      fighter_idx,
      custody,
    }: {
      fight: string
      fighter_idx: bigint
      custody?: KioskCustody
    }) => {
      await sdk.hydrate_unknown([fight])
      const receipt = await with_kiosk(
        (tx, kiosk, cap) => sdk.doors.give_up_dungeon_room(tx, { fight_object: fight, fighter_idx, kiosk, cap }),
        { custody, gas_scope: `fight:${fight}` }
      )
      return Object.freeze({ digest: receipt_digest(receipt) })
    },

    abandon: async ({ character_id, custody }: { character_id: string; custody?: KioskCustody }) => {
      const receipt = await with_kiosk(
        (tx, kiosk, cap) => sdk.doors.abandon_dungeon_run(tx, { kiosk, cap, character_id }),
        { custody }
      )
      return Object.freeze({ digest: receipt_digest(receipt) })
    },
  })
}

export type DungeonActions = ReturnType<typeof dungeon_actions>
