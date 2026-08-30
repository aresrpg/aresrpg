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
// CUSTODY IDENTITY IS WIRE TRUTH: the server names the kiosk and PersonalKioskCap. Their exact
// mutable ref is transaction-building state, so the SDK refreshes that one cap before composing;
// another tab may have advanced it without this session receiving its receipt.

import type { KioskOwnerCap } from '@mysten/kiosk'

import type { SDK } from './client.ts'
import type { Receipt } from './cache.ts'

type GameSdk = ReturnType<typeof SDK>
type KioskObjectRef = Pick<KioskOwnerCap, 'objectId' | 'version' | 'digest'>

/** The custody pair off the wire: the kiosk HOLDING the acted-on object + its personal cap. */
export type KioskCustody = Readonly<{ kiosk: string; kiosk_cap?: string }>

/** Fresh cap loader. `kiosk_id` names the wanted kiosk — with several personal kiosks on one
 * address the first cap is wrong whenever the object lives elsewhere. */
export type KioskCapLoader = (kiosk_id?: string) => Promise<KioskOwnerCap | null>

type RunOptions = Readonly<{ include?: object; custody?: KioskCustody; gas_scope?: string }>

const same_object_id = (expected: string | undefined, current: string | undefined): boolean =>
  expected === undefined || current?.toLowerCase() === expected.toLowerCase()

const cap_matches_custody = (cap: KioskOwnerCap | null, custody: KioskCustody | undefined): boolean =>
  same_object_id(custody?.kiosk, cap?.kioskId) && same_object_id(custody?.kiosk_cap, cap?.objectId)

export const resolve_kiosk_cap = async (
  kiosk_cap: KioskCapLoader,
  custody?: KioskCustody
): Promise<KioskOwnerCap | null> => {
  const cap = await kiosk_cap(custody?.kiosk)
  if (!cap_matches_custody(cap, custody)) throw new Error('The requested PersonalKioskCap is unavailable')
  return cap
}

const object_ref = ({ objectId, version, digest }: KioskOwnerCap): KioskObjectRef =>
  Object.freeze({ objectId, version, digest })

export const create_kiosk_runner = (sdk: GameSdk, kiosk_cap: KioskCapLoader) => {
  return {
    with_kiosk: async (
      compose: (
        tx: ReturnType<GameSdk['tx']>,
        kiosk: Parameters<Parameters<GameSdk['with_owner_kiosk']>[2]>[0],
        cap: Parameters<Parameters<GameSdk['with_owner_kiosk']>[2]>[1]
      ) => void,
      options: RunOptions = {}
    ): Promise<Receipt> => {
      const cap = await resolve_kiosk_cap(kiosk_cap, options.custody)
      const tx = sdk.tx()
      sdk.with_owner_kiosk(tx, cap, (kiosk, owner_cap) => compose(tx, kiosk, owner_cap))
      return sdk.execute(tx, options)
    },

    /** &Random doors take the PACKED PersonalKioskCap — Move unpacks inside (api.move law,
     *  2026-08-21): no bracket, no borrow commands, the Random door stays the last command. */
    with_terminal_kiosk: async (
      compose: (tx: ReturnType<GameSdk['tx']>, kiosk: string, personal: KioskObjectRef) => void,
      options: RunOptions = {}
    ): Promise<Receipt> => {
      const personal = await resolve_kiosk_cap(kiosk_cap, options.custody)
      if (!personal) throw new Error('No personal kiosk exists for this session yet')
      // The kiosk is shared and stable. The personal cap is owned and mutable, so pass the exact
      // freshly loaded ref instead of asking the receipt cache to resolve yesterday's version.
      await sdk.hydrate_unknown([personal.kioskId])
      const tx = sdk.tx()
      compose(tx, personal.kioskId, object_ref(personal))
      return sdk.execute(tx, options)
    },
  }
}
