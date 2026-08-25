// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The ONE home of the action builders' kiosk execution bracket (character_actions and fight
// both compose custody-proven doors — the wrapper lived twice, audit 2026-08-20). Two shapes:
//   with_kiosk          — the standard personal borrow_val/return_val bracket (finalize after)
//   with_terminal_kiosk — for TERMINAL (&Random) doors: Sui permits only TransferObjects and
//     MergeCoins after the command consuming Random, so the potato bracket (which appends a
//     MoveCall after compose) is illegal there. The inner KioskOwnerCap is read by REFERENCE
//     (personal_kiosk::borrow — nothing to return) and the kiosk resolves as its own shared
//     object, keeping the Random door the last command of its transaction.
//
// CUSTODY IS WIRE TRUTH (owner 2026-08-21): the indexer projects each kiosk's personal cap and
// the server pushes it on the character row — callers pass `{ kiosk, kiosk_cap }` and the SDK
// queries NOTHING. The loader is the one fallback, for caps the indexer has not met yet
// (historical objects surface only when a checkpoint next touches them) — cached, one query.

import type { KioskOwnerCap } from '@mysten/kiosk'

import type { SDK } from './client.ts'
import type { Receipt } from './cache.ts'

type GameSdk = ReturnType<typeof SDK>

/** The custody pair off the wire: the kiosk HOLDING the acted-on object + its personal cap. */
export type KioskCustody = Readonly<{ kiosk: string; kiosk_cap?: string }>

/** `kiosk_id` names the wanted kiosk — with several personal kiosks on one address the first
 *  cap is wrong whenever the object lives elsewhere. */
export type KioskCapLoader = (kiosk_id?: string) => Promise<KioskOwnerCap | null>

type RunOptions = Readonly<{ include?: object; custody?: KioskCustody; gas_scope?: string }>

export const create_kiosk_runner = (sdk: GameSdk, kiosk_cap: KioskCapLoader) => {
  const resolve_cap = async (custody?: KioskCustody): Promise<KioskOwnerCap | null> =>
    custody?.kiosk_cap
      ? ({ objectId: custody.kiosk_cap, kioskId: custody.kiosk, isPersonal: true } as KioskOwnerCap)
      : kiosk_cap(custody?.kiosk)

  return {
    with_kiosk: async (
      compose: (
        tx: ReturnType<GameSdk['tx']>,
        kiosk: Parameters<Parameters<GameSdk['with_owner_kiosk']>[2]>[0],
        cap: Parameters<Parameters<GameSdk['with_owner_kiosk']>[2]>[1]
      ) => void,
      options: RunOptions = {}
    ): Promise<Receipt> => {
      const cap = await resolve_cap(options.custody)
      const tx = sdk.tx()
      sdk.with_owner_kiosk(tx, cap, (kiosk, owner_cap) => compose(tx, kiosk, owner_cap))
      return sdk.execute(tx, options)
    },

    /** &Random doors take the PACKED PersonalKioskCap — Move unpacks inside (api.move law,
     *  2026-08-21): no bracket, no borrow commands, the Random door stays the last command. */
    with_terminal_kiosk: async (
      compose: (tx: ReturnType<GameSdk['tx']>, kiosk: string, personal: string) => void,
      options: RunOptions = {}
    ): Promise<Receipt> => {
      const personal = await resolve_cap(options.custody)
      if (!personal) throw new Error('No personal kiosk exists for this session yet')
      // Unknown external inputs read once. After any own transaction, the receipt-fed cache
      // already holds the exact next cap ref; polling a load-balanced node may only regress it.
      await sdk.hydrate_unknown([personal.objectId, personal.kioskId])
      const tx = sdk.tx()
      compose(tx, personal.kioskId, personal.objectId)
      return sdk.execute(tx, options)
    },
  }
}
