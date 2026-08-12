// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PTB composition helpers — the client-side moves that deliberately stay OUT of Move
// (DECISIONS: PTB-safe never pollutes the modules). The personal-kiosk borrow/return pair is
// the OFFICIAL @mysten/kiosk KioskTransaction's job (owner 2026-08-12: never hand-roll what
// the kiosk SDK ships) — `finalize()` returns the cap to the PersonalKioskCap wrapper.

import { KioskTransaction } from '@mysten/kiosk'

/**
 * Compose door calls against a kiosk through the official KioskTransaction. `cap` is a
 * `KioskOwnerCap` row from `kioskClient.getOwnedKiosks()` (fetch once at session start, keep in
 * app state — it knows `isPersonal`); the wrapper borrows/returns the cap around `compose` and
 * finalizes:
 *
 *   with_kiosk(tx, kiosk_client, cap, (kiosk, kiosk_cap) => {
 *     doors.equip_item(tx, { kiosk, cap: kiosk_cap, ... })
 *   })
 *
 * @param {import('@mysten/sui/transactions').Transaction} tx
 * @param {import('@mysten/kiosk').KioskClient} kiosk_client
 * @param {import('@mysten/kiosk').KioskOwnerCap} cap
 * @param {(kiosk: unknown, kiosk_cap: unknown, ktx: KioskTransaction) => unknown} compose
 */
export const with_kiosk = (tx, kiosk_client, cap, compose) => {
  const ktx = new KioskTransaction({ transaction: tx, kioskClient: kiosk_client, cap })
  const result = compose(ktx.getKiosk(), ktx.getKioskCap(), ktx)
  ktx.finalize()
  return result
}

/**
 * Split `amount` MIST off the gas coin — the payment shape every paying door takes.
 * @param {import('@mysten/sui/transactions').Transaction} tx
 * @param {bigint | number} amount
 */
export const coin_of = (tx, amount) => {
  const [coin] = tx.splitCoins(tx.gas, [amount])
  return coin
}
