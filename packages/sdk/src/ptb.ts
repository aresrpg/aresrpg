// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PTB composition helpers — the client-side moves that deliberately stay OUT of Move
// (DECISIONS: PTB-safe never pollutes the modules). The personal-kiosk borrow/return pair is
// the OFFICIAL @mysten/kiosk KioskTransaction's job (owner 2026-08-12: never hand-roll what
// the kiosk SDK ships) — `finalize()` returns the cap to the PersonalKioskCap wrapper.

import { KioskTransaction, type KioskClient, type KioskOwnerCap } from '@mysten/kiosk'
import type { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions'

/**
 * Compose door calls against a kiosk through the official KioskTransaction. `cap` is a
 * `KioskOwnerCap` row from `kioskClient.getOwnedKiosks()` (fetch once at session start, keep in
 * app state — it knows `isPersonal`); the wrapper borrows/returns the cap around `compose` and
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

/** Split `amount` MIST off the gas coin — the payment shape every paying door takes. */
export const coin_of = (tx: Transaction, amount: bigint | number): TransactionObjectArgument => {
  const [coin] = tx.splitCoins(tx.gas, [amount])
  return coin!
}
