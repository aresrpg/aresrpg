// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PTB composition helpers — the client-side moves that deliberately stay OUT of Move
// (DECISIONS: PTB-safe never pollutes the modules). The personal-kiosk borrow/return pair is
// the OFFICIAL @mysten/kiosk KioskTransaction's job (owner 2026-08-12: never hand-roll what
// the kiosk SDK ships) — `finalize()` returns the cap to the PersonalKioskCap wrapper.

import { KioskTransaction, type KioskClient, type KioskOwnerCap } from '@mysten/kiosk'
import type { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions'

import type { Receipt } from './cache.ts'

/**
 * Compose door calls against a kiosk through the official KioskTransaction. `cap` is a
 * `KioskOwnerCap` row from `kioskClient.getOwnedKiosks()` (fetch once per authenticated session;
 * it knows `isPersonal`); the wrapper borrows/returns the cap around `compose` and
 * finalizes:
 *
 *   with_kiosk(tx, kiosk_client, cap, (kiosk, kiosk_cap) => {
 *     doors.equip_item(tx, { kiosk, cap: kiosk_cap, ... })
 *   })
 */
export const with_kiosk = <T>(
  tx: Transaction,
  kiosk_client: KioskClient,
  cap: KioskOwnerCap,
  compose: (kiosk: TransactionObjectArgument, kiosk_cap: TransactionObjectArgument, ktx: KioskTransaction) => T
): T => {
  const ktx = new KioskTransaction({ transaction: tx, kioskClient: kiosk_client, cap })
  const result = compose(ktx.getKiosk(), ktx.getKioskCap(), ktx)
  ktx.finalize()
  return result
}

/** Compose against the player's personal kiosk, creating it in the same PTB when this is
 * their first custody action. An ordinary kiosk is never an acceptable fallback: every game
 * object is born under the personal-kiosk constitution. */
export const with_personal_kiosk = <T>(
  tx: Transaction,
  kiosk_client: KioskClient,
  cap: KioskOwnerCap | null,
  compose: (kiosk: TransactionObjectArgument, kiosk_cap: TransactionObjectArgument, ktx: KioskTransaction) => T
): T => {
  if (cap && !cap.isPersonal) throw new Error('Game custody requires a personal kiosk.')
  const ktx = new KioskTransaction({ transaction: tx, kioskClient: kiosk_client, ...(cap ? { cap } : {}) })
  if (!cap) ktx.createPersonal(true)
  const result = compose(ktx.getKiosk(), ktx.getKioskCap(), ktx)
  ktx.finalize()
  return result
}

/** Recover the permanent cap created by `createPersonal(true)` from the certified receipt.
 * This closes the only cache transition that cannot be learned before submission. */
export const receipt_personal_kiosk_cap = (receipt: Receipt): KioskOwnerCap | null => {
  const transaction = receipt.Transaction
  const types = transaction?.objectTypes ?? {}
  const created = transaction?.effects?.changedObjects?.filter(({ idOperation }) => idOperation === 'Created') ?? []
  const kiosk = created.find(
    ({ objectId }) => typeof objectId === 'string' && types[objectId]?.endsWith('::kiosk::Kiosk')
  )
  const cap = created.find(
    ({ objectId }) => typeof objectId === 'string' && types[objectId]?.endsWith('::personal_kiosk::PersonalKioskCap')
  )
  if (!kiosk?.objectId || !cap?.objectId || !cap.outputVersion || !cap.outputDigest) return null
  return Object.freeze({
    objectId: cap.objectId,
    kioskId: kiosk.objectId,
    isPersonal: true,
    version: String(cap.outputVersion),
    digest: cap.outputDigest,
  })
}

type PersonalKioskAction<T> = Readonly<{ value: T; kiosk_cap: KioskOwnerCap }>

/** Serialize the session's first personal-custody transition. Concurrent actions cannot both
 * observe absence: the first receipt supplies the permanent cap before the second action builds. */
export const create_personal_kiosk_runner = (load: () => Promise<KioskOwnerCap | null>) => {
  let known: KioskOwnerCap | null = null
  let tail = Promise.resolve()
  return <T>(action: (cap: KioskOwnerCap | null) => Promise<PersonalKioskAction<T>>): Promise<T> => {
    const pending = tail.then(async () => {
      const loaded = await load()
      const current = known && (!loaded || BigInt(known.version) >= BigInt(loaded.version)) ? known : loaded
      const result = await action(current)
      known = result.kiosk_cap
      return result.value
    })
    tail = pending.then(
      () => undefined,
      () => undefined
    )
    return pending
  }
}

/** Split `amount` MIST off the gas coin — the payment shape every paying door takes. */
export const coin_of = (tx: Transaction, amount: bigint | number): TransactionObjectArgument => {
  const [coin] = tx.splitCoins(tx.gas, [amount])
  return coin!
}
