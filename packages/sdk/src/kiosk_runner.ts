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
import { pre_submission_stale_owned_ref } from './transaction_error.ts'

type GameSdk = ReturnType<typeof SDK>
type KioskObjectRef = Pick<KioskOwnerCap, 'objectId' | 'version' | 'digest'>
type PersonalKioskAction<T> = Readonly<{ value: T; kiosk_cap: KioskOwnerCap }>

/** The custody pair off the wire: the kiosk HOLDING the acted-on object + its personal cap. */
export type KioskCustody = Readonly<{ kiosk: string; kiosk_cap?: string }>

/** Fresh cap loader. `kiosk_id` names the wanted kiosk — with several personal kiosks on one
 * address the first cap is wrong whenever the object lives elsewhere. */
export type KioskCapLoader = (kiosk_id?: string, fresh?: boolean) => Promise<KioskOwnerCap | null>

type RunOptions = Readonly<{
  include?: object
  custody?: KioskCustody
  gas_scope?: string
  budget?: bigint | 'estimate'
  /** Other objects needed by a terminal door; hydrated with the kiosk in one cold read. */
  inputs?: readonly string[]
}>

const same_object_id = (expected: string | undefined, current: string | undefined): boolean =>
  expected === undefined || current?.toLowerCase() === expected.toLowerCase()

const cap_matches_custody = (cap: KioskOwnerCap | null, custody: KioskCustody | undefined): boolean =>
  same_object_id(custody?.kiosk, cap?.kioskId) && same_object_id(custody?.kiosk_cap, cap?.objectId)

export const resolve_kiosk_cap = async (
  kiosk_cap: KioskCapLoader,
  custody?: KioskCustody,
  fresh = false
): Promise<KioskOwnerCap | null> => {
  const cap = await kiosk_cap(custody?.kiosk, fresh)
  if (!cap_matches_custody(cap, custody)) throw new Error('The requested PersonalKioskCap is unavailable')
  return cap
}

/** Cached identity is the steady state. A foreign tab advancing the cap is detected before
 * signing by transaction resolution; only that proven stale-ref failure earns one fresh read. */
export const retry_stale_kiosk_ref = async <T>(action: (fresh: boolean) => Promise<T>): Promise<T> => {
  try {
    return await action(false)
  } catch (error) {
    if (!pre_submission_stale_owned_ref(error)) throw error
    return action(true)
  }
}

/** Serialize the session's first personal-custody transition. Concurrent actions cannot both
 * observe absence, and an external-tab stale cap gets the same single fresh retry as every other
 * kiosk action. */
export const create_personal_kiosk_runner = (load: KioskCapLoader) => {
  let known: KioskOwnerCap | null = null
  let tail = Promise.resolve()
  return <T>(action: (cap: KioskOwnerCap | null) => Promise<PersonalKioskAction<T>>): Promise<T> => {
    const pending = tail.then(() =>
      retry_stale_kiosk_ref(async (fresh) => {
        const loaded = await load(undefined, fresh)
        const current = !fresh && known && (!loaded || BigInt(known.version) >= BigInt(loaded.version)) ? known : loaded
        const result = await action(current)
        known = result.kiosk_cap
        return result.value
      })
    )
    tail = pending.then(
      () => undefined,
      () => undefined
    )
    return pending
  }
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
    ): Promise<Receipt> =>
      retry_stale_kiosk_ref(async (fresh) => {
        const cap = await resolve_kiosk_cap(kiosk_cap, options.custody, fresh)
        const tx = sdk.tx()
        sdk.with_owner_kiosk(tx, cap, (kiosk, owner_cap) => compose(tx, kiosk, owner_cap))
        return sdk.execute(tx, options)
      }),

    /** &Random doors take the PACKED PersonalKioskCap — Move unpacks inside (api.move law,
     *  2026-08-21): no bracket, no borrow commands, the Random door stays the last command. */
    with_terminal_kiosk: async (
      compose: (tx: ReturnType<GameSdk['tx']>, kiosk: string, personal: KioskObjectRef) => void,
      options: RunOptions = {}
    ): Promise<Receipt> =>
      retry_stale_kiosk_ref(async (fresh) => {
        const personal = await resolve_kiosk_cap(kiosk_cap, options.custody, fresh)
        if (!personal) throw new Error('No personal kiosk exists for this session yet')
        await sdk.hydrate_unknown([personal.kioskId, ...(options.inputs ?? [])])
        const tx = sdk.tx()
        compose(tx, personal.kioskId, object_ref(personal))
        return sdk.execute(tx, options)
      }),
  }
}
