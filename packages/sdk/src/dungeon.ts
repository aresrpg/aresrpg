// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Dungeon writes are a thin coordinator over kiosk custody, living content, and normal fights.

import { SDK, living_content } from './client.ts'
import { receipt_digest } from './cache.ts'
import { create_kiosk_runner, type KioskCapLoader, type KioskCustody } from './kiosk_runner.ts'
import { created_fight_id } from './fight.ts'
import { board_catalog_id, item_template_id, mob_template_id, world_content_id, world_id } from './seed_ids.ts'

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
      w: world_id(content_root, sdk.game_type_package, world),
      wc: world_content_id(content_root, seed_package_original, world),
    })
  }
  const scope = (world: string, x: number, z: number) => `dungeon:${world}:${x}:${z}`

  return Object.freeze({
    enter: async ({
      character_id,
      custody,
      world,
      zx,
      zz,
      key_id,
    }: {
      character_id: string
      custody?: KioskCustody
      world: string
      zx: number
      zz: number
      key_id: string
    }) => {
      const { w, wc } = world_refs(world, 'Dungeon entry')
      await sdk.hydrate_unknown([w, wc, key_id])
      const receipt = await with_terminal_kiosk(
        (tx, kiosk, personal) => sdk.doors.enter_dungeon(tx, { w, kiosk, personal, character_id, wc, zx, zz, key_id }),
        { custody, gas_scope: `dungeon-entry:${world}:${zx}:${zz}` }
      )
      return Object.freeze({ digest: receipt_digest(receipt) })
    },

    start_fight: async ({
      character_id,
      custody,
      world,
      x,
      z,
      mob_types,
      access,
    }: {
      character_id: string
      custody?: KioskCustody
      world: string
      x: number
      z: number
      mob_types: readonly string[]
      access: 0 | 1
    }) => {
      const { content_root, seed_package_original, w, wc } = world_refs(world, 'Dungeon fight')
      const catalog = board_catalog_id(content_root, seed_package_original)
      const templates = mob_types.map((mob_type) => mob_template_id(content_root, seed_package_original, mob_type))
      await sdk.hydrate_unknown([w, wc, catalog, ...templates])
      const receipt = await with_kiosk(
        (tx, kiosk, cap) => {
          const build = sdk.doors.engage_dungeon_room(tx, {
            w,
            wc,
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
        { custody, gas_scope: scope(world, x, z) }
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
            sdk.doors.join_dungeon_room_grouped(tx, { f: fight, kiosk, cap, character_id, shared_party: party })
          else sdk.doors.join_dungeon_room(tx, { f: fight, kiosk, cap, character_id })
        },
        { custody, gas_scope: `fight:${fight}` }
      )
      return Object.freeze({ digest: receipt_digest(receipt) })
    },

    settle_fight: async ({
      fight,
      fighter_idx,
      world,
      loot: requested_loot,
      custody,
    }: {
      fight: string
      fighter_idx: bigint
      world: string
      loot: readonly Readonly<{ item_type: string; existing: string | null }>[]
      custody?: KioskCustody
    }) => {
      const { content_root, seed_package_original, wc } = world_refs(world, 'Dungeon settlement')
      const loot = [...new Map(requested_loot.map((row) => [row.item_type, row])).values()]
      const templates = loot.map(({ item_type }) => item_template_id(content_root, seed_package_original, item_type))
      await sdk.hydrate_unknown([fight, wc, ...templates])
      const receipt = await with_terminal_kiosk(
        (tx, kiosk, personal) => {
          const plan = loot.map(({ existing }, index) =>
            sdk.doors.prepare_fight_loot(tx, { template: templates[index]!, existing })
          )
          sdk.doors.settle_dungeon_room(tx, { wc, f: fight, fighter_idx, plan, kiosk, personal })
        },
        { custody, gas_scope: `fight:${fight}` }
      )
      return Object.freeze({ digest: receipt_digest(receipt) })
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
        (tx, kiosk, cap) => sdk.doors.give_up_dungeon_room(tx, { f: fight, fighter_idx, kiosk, cap }),
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
