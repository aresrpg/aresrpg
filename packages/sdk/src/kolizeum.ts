// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { SDK, living_content } from './client.ts'
import { receipt_digest, receipt_event, type Receipt } from './cache.ts'
import { create_kiosk_runner, type KioskCapLoader, type KioskCustody } from './kiosk_runner.ts'
import {
  execute_settlement_mode,
  last_settler_refusal,
  project_fight_boundary_receipt,
  type FightReceipt,
} from './fight.ts'
import { board_catalog_id } from './seed_ids.ts'
import { friends_actions } from './friends.ts'
import { owned_ref } from './cache.ts'
import { event_u64 } from './receipt_decode.ts'

type GameSdk = ReturnType<typeof SDK>
export type KolizeumActionsCtx = Readonly<{ kiosk_cap: KioskCapLoader; address: string }>

const created_ids = (receipt: Receipt) => {
  const event = receipt_event(receipt, '::kolizeum::KolizeumCreated')
  if (typeof event?.kolizeum !== 'string' || typeof event.fight !== 'string')
    throw new Error('The Kolizeum creation receipt carried no lobby/fight identity.')
  return Object.freeze({ kolizeum: event.kolizeum, fight: event.fight })
}

export const kolizeum_actions = (sdk: GameSdk, { kiosk_cap, address }: KolizeumActionsCtx) => {
  const { with_kiosk, with_terminal_kiosk } = create_kiosk_runner(sdk, kiosk_cap)
  const submit = async (scope: string, compose: (tx: ReturnType<GameSdk['tx']>) => void) => {
    const tx = sdk.tx()
    compose(tx)
    return Object.freeze({ digest: receipt_digest(await sdk.execute(tx, { gas_scope: scope })) })
  }
  const boundary = async (fight: string, compose: (tx: ReturnType<GameSdk['tx']>) => void): Promise<FightReceipt> => {
    const tx = sdk.tx()
    compose(tx)
    return project_fight_boundary_receipt(await sdk.execute(tx, { gas_scope: `fight:${fight}` }))
  }

  return Object.freeze({
    create: async ({
      pledge_mist,
      format,
      level_min,
      level_max,
      access = 'public',
      character_id,
      custody,
    }: {
      pledge_mist: bigint
      format: 1 | 3 | 6
      level_min: number
      level_max: number
      access?: 'public' | 'friends'
      character_id: string
      custody?: KioskCustody
    }) => {
      const { content_root, seed_package_original } = living_content(sdk, 'Kolizeum creation')
      const catalog = board_catalog_id(content_root, seed_package_original)
      const friend_list = access === 'friends' ? friends_actions(sdk, { address }).list : null
      await sdk.hydrate_unknown([catalog, ...(friend_list ? [friend_list] : [])])
      if (friend_list && !owned_ref(sdk.cache, friend_list))
        throw new Error('Add at least one friend before creating a friends-only lobby.')
      const receipt = await with_terminal_kiosk(
        (tx, kiosk, personal) => {
          const args = {
            pledge: sdk.coin_of(tx, pledge_mist),
            format,
            level_min,
            level_max,
            access: 0,
            kiosk,
            personal,
            character_id,
            catalog,
          }
          if (friend_list) sdk.doors.create_kolizeum_friends(tx, { ...args, list: friend_list })
          else sdk.doors.create_kolizeum(tx, args)
        },
        { custody, gas_scope: 'kolizeum:create' }
      )
      const ids = created_ids(receipt)
      sdk.tag_gas?.(receipt, `fight:${ids.fight}`)
      return Object.freeze({ digest: receipt_digest(receipt), ...ids })
    },

    join: async ({
      kolizeum,
      fight,
      pledge_mist,
      side,
      character_id,
      custody,
    }: {
      kolizeum: string
      fight: string
      pledge_mist: bigint
      side: 0 | 1
      character_id: string
      custody?: KioskCustody
    }) => {
      await sdk.hydrate_unknown([kolizeum, fight])
      const receipt = await with_kiosk(
        (tx, kiosk, cap) =>
          sdk.doors.join_kolizeum(tx, {
            lobby: kolizeum,
            fight_object: fight,
            pledge: sdk.coin_of(tx, pledge_mist),
            side,
            kiosk,
            cap,
            character_id,
          }),
        { custody, gas_scope: `fight:${fight}` }
      )
      return Object.freeze({ digest: receipt_digest(receipt), fight })
    },

    ready: async ({ kolizeum, fight, fighter_idx }: { kolizeum: string; fight: string; fighter_idx: bigint }) => {
      await sdk.hydrate_unknown([kolizeum, fight])
      return boundary(fight, (tx) =>
        sdk.doors.ready_and_start_kolizeum(tx, { lobby: kolizeum, fight_object: fight, fighter_idx })
      )
    },

    start: async ({ kolizeum, fight }: { kolizeum: string; fight: string }) => {
      await sdk.hydrate_unknown([kolizeum, fight])
      return boundary(fight, (tx) => sdk.doors.start_kolizeum(tx, { lobby: kolizeum, fight_object: fight }))
    },

    exit: async ({
      kolizeum,
      fight,
      fighter_idx,
      custody,
    }: {
      kolizeum: string
      fight: string
      fighter_idx: bigint
      custody?: KioskCustody
    }) => {
      await sdk.hydrate_unknown([kolizeum, fight])
      const execute_exit = (last: boolean) =>
        with_kiosk(
          (tx, kiosk, cap) => {
            const args = { lobby: kolizeum, fight_object: fight, fighter_idx, kiosk, cap }
            if (last) sdk.doors.exit_last_kolizeum(tx, args)
            else sdk.doors.exit_kolizeum(tx, args)
          },
          { custody, gas_scope: `fight:${fight}` }
        )
      const receipt = await execute_exit(true).catch((error: unknown) => {
        if (!last_settler_refusal(error)) throw error
        return execute_exit(false)
      })
      return Object.freeze({ digest: receipt_digest(receipt) })
    },

    forfeit: async ({
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
        (tx, kiosk, cap) => sdk.doors.forfeit_kolizeum(tx, { fight_object: fight, fighter_idx, kiosk, cap }),
        { custody, gas_scope: `fight:${fight}` }
      )
      return Object.freeze({ digest: receipt_digest(receipt) })
    },

    settle: async ({
      kolizeum,
      fight,
      fighter_idx,
      custody,
      last,
    }: {
      kolizeum: string
      fight: string
      fighter_idx: bigint
      custody?: KioskCustody
      last?: boolean
    }) => {
      await sdk.hydrate_unknown([kolizeum, fight])
      const execute_settlement = (last: boolean) =>
        with_terminal_kiosk(
          (tx, kiosk, personal) => {
            const args = { lobby: kolizeum, fight_object: fight, fighter_idx, kiosk, personal }
            if (last) sdk.doors.settle_last_kolizeum(tx, args)
            else sdk.doors.settle_kolizeum(tx, args)
          },
          { custody, gas_scope: `fight:${fight}` }
        )
      const receipt = await execute_settlement_mode(last, execute_settlement)
      return Object.freeze({
        digest: receipt_digest(receipt),
        paid_mist: BigInt(event_u64(receipt_event(receipt, '::kolizeum::KolizeumPaid') ?? {}, 'amount')),
        closed: receipt_event(receipt, '::fight::FightClosed') !== null,
      })
    },

    close: async ({ kolizeum, fight }: { kolizeum: string; fight: string }) => {
      await sdk.hydrate_unknown([kolizeum, fight])
      return submit(`fight:${fight}`, (tx) => sdk.doors.close_kolizeum(tx, { lobby: kolizeum, fight_object: fight }))
    },
  })
}

export type KolizeumActions = ReturnType<typeof kolizeum_actions>
