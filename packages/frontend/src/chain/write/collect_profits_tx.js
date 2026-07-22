// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// BUILD #180 — the multi-kiosk COLLECT PTB shape, split out of write_listings.js so it is independently
// unit-testable: write_listings.js imports `../../auth` at module scope, and auth/index.ts registers Enoki
// wallets at import time (touches `window` — real in a browser, absent under `bun test`). This mirrors
// exactly why marketplace_buy_sdk.js is its own file too (split from write_listings.js for the identical
// testability reason) — this file imports NOTHING auth/network-touching; @mysten/kiosk's KioskTransaction
// only builds a local PTB graph, no network call happens while composing it.
import { KioskTransaction } from '@mysten/kiosk'

/**
 * Build the multi-kiosk withdraw PTB shape: one independent borrow → withdraw → return cycle per cap, all
 * sharing ONE `Transaction` (BUILD #180 — a wallet can hold more than one personal kiosk across lineages,
 * so a single-kiosk withdraw strands money in kiosk #2+). Multiple `KioskTransaction` instances can safely
 * share one `Transaction`: their borrowed-cap state is per-instance (kiosk-transaction.ts keeps
 * `kioskCap`/`#personalCap`/`#promise` on `this`, never shared module state), so N kiosks settle in ONE
 * signature instead of N wallet prompts.
 * @param {{ tx: import('@mysten/sui/transactions').Transaction, kiosk_client: import('@mysten/kiosk').KioskClient, caps: { kioskId: string, objectId: string, isPersonal?: boolean }[], address: string }} args
 */
export function build_collect_profits_tx({ tx, kiosk_client, caps, address }) {
  for (const cap of caps)
    new KioskTransaction({ transaction: tx, kioskClient: kiosk_client, cap }).withdraw(address).finalize()
  return tx
}
