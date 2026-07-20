// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ─────────────────────────────────────────────────────────────────────────────
//  PER-FIGHT-SESSION GAS-COIN PIN (latency lane 4 — the <1s turn commit, design ruling 2026-07-11)
// ─────────────────────────────────────────────────────────────────────────────
//  Fight-ref-cache pins the SHARED objects a commit touches (Fight + 0x8 Random) so its build resolves nothing.
//  The last unpinned input is the GAS COIN: with payment/price/budget UNSET, @mysten/sui's `needsTransaction
//  resolution` is TRUE, so the wallet's `Transaction.build()` fires a resolve round-trip to SELECT a gas coin +
//  fetch the reference gas price — even the Enoki (zkLogin) wallet, which re-parses `transaction.toJSON()` and
//  calls `build({ client })` (VERIFIED: toJSON preserves a pre-set gasData WITHOUT resolving, and the resolve
//  plugin short-circuits when payment+price+budget are all set AND every input is resolved → ZERO round-trip).
//
//  So we CHAIN the gas coin across a fight's commits: every landed commit MUTATES the wallet's gas coin, and the
//  gRPC effects hand back its fresh `{ id, outputVersion, outputDigest }`. We stamp that ref + the epoch
//  reference gas price and pin the NEXT commit with `setGasPayment([ref]) + setGasPrice(price)` — its build is
//  fully offline (0 round-trips). The FIRST commit of a fight has no chained ref yet → one ordinary selection,
//  then it chains from its own receipt.
//
//  MONEY SAFETY — a stale pinned coin is a PRE-EXECUTION rejection (object-version mismatch: no digest, ZERO gas
//  burned), never a drain, so every failure mode degrades safely to a fresh selection. INVALIDATION (all wired
//  by the callers, see below): (a) any executed failure or pre-exec throw on a pinned commit; (b) EPOCH change
//  (the pinned price may no longer meet the reference — dropped so it is re-read); (c) EQUIVOCATION guard — ANY
//  non-turn-commit tx from this wallet (a self-pay buy/send, a crank/settle between commits) may mutate the same
//  coin, so it drops the pin (execute_tx calls `invalidate_gas_coin` for every tx that is NOT a chained commit).
//  On a miss the caller degrades to normal selection — NEVER a fabricated or stale coin.
//
//  IN-MEMORY ONLY (client-cache law — no IndexedDB): three module-scoped values, cleared at every fight boundary.
// ─────────────────────────────────────────────────────────────────────────────

/** @type {{ objectId: string, version: string, digest: string } | null} the last landed commit's gas coin ref. */
import { game_log } from '../core/log.js'

let coin = null
/** @type {string | null} the epoch reference gas price (MIST) — epoch-stable, so read once per fight/epoch. */
let price = null
/** @type {string | null} the epoch the cached coin/price belong to (drop the price when it advances). */
let epoch = null

/**
 * Pin the cached gas coin + price onto a commit tx so its build resolves NO gas round-trip. Requires BOTH the
 * chained coin AND the price (a partial pin still forces a resolve, so it is all-or-nothing). Returns false on a
 * miss (first commit / just-invalidated) so the caller lets the wallet select gas exactly as before.
 * @param {any} tx a `@mysten/sui` Transaction
 * @returns {boolean} true when the tx was fully gas-pinned
 */
export function apply_pinned_gas(tx) {
  if (!coin || price == null) return false
  tx.setGasPayment([coin]) // { objectId, version, digest } — the exact fresh ref the last commit's effects gave
  tx.setGasPrice(price) // the epoch reference gas price (build needs price set to skip its own fetch)
  return true
}

/**
 * Chain the gas coin from a LANDED commit's RAW gRPC receipt (`{ Transaction: { epoch, effects: { gasObject } } }`).
 * The gas coin is mutated by every tx, so `gasObject.{ outputVersion, outputDigest }` is its next-usable ref. On an
 * epoch advance the pinned price is dropped (it may no longer meet the reference gas price). A failed/missing tx is
 * NOT chained (the caller invalidates instead). No-op-safe on a malformed receipt.
 * @param {any} raw the raw `waitForTransaction` result (BEFORE normalize_receipt strips the gasObject)
 */
export function remember_gas_coin(raw) {
  const tx = raw?.Transaction
  const g = tx?.effects?.gasObject
  // FIELD DRIFT FIX (probe 07-12): the REAL @mysten/sui 2.20 gRPC parse names the coin `gasObject.objectId` —
  // the `id` read matched nothing, so the pin never chained off a live receipt. Accept both (tests use `id`).
  // NOTE testnet currently settles gas via the ACCUMULATOR model (outputState 'AccumulatorWriteV1'): output
  // version/digest come back null there, so this guard keeps the pin DORMANT — a miss, normal gas selection,
  // never a fabricated ref. On any node still returning versioned gas coins the chain works as designed.
  const gid = g?.objectId ?? g?.id
  if (!gid || g?.outputVersion == null || !g?.outputDigest) return // no usable ref — leave the cache as-is
  const tx_epoch = tx?.epoch == null ? null : String(tx.epoch)
  if (tx_epoch != null && epoch != null && tx_epoch !== epoch) price = null // epoch advanced → stale price
  if (tx_epoch != null) epoch = tx_epoch
  coin = { objectId: gid, version: String(g.outputVersion), digest: g.outputDigest }
}

/**
 * Ensure the epoch reference gas price is cached (read ONCE per fight/epoch — it is epoch-stable). Off the hot
 * path: called right after a commit lands (the player is watching the mob wave), never before a sign. Leaves the
 * price null on a read failure so `apply_pinned_gas` simply misses and the next commit selects gas normally.
 * @param {{ grpc_client: any }} sdk
 * @param {string | number | null} [tx_epoch] the landed commit's epoch (keeps price + epoch consistent)
 */
export async function ensure_gas_price(sdk, tx_epoch = null) {
  const e = tx_epoch == null ? null : String(tx_epoch)
  if (price != null && (e == null || e === epoch)) return // already have this epoch's price
  try {
    const { referenceGasPrice } = await sdk.grpc_client.core.getReferenceGasPrice()
    if (referenceGasPrice != null) {
      price = String(referenceGasPrice)
      if (e != null) epoch = e
    }
  } catch (err) {
    game_log('gas-pin', 'reference gas price read failed — the next commit selects gas normally:', err)
  }
}

/**
 * Chain a landed commit's gas coin AND ensure the epoch price — the ONE post-commit bookkeeping call the fight
 * sign() choke makes (only for turn commits). Sequenced: remember the coin (may drop a now-stale price on an
 * epoch advance) THEN ensure the price (re-reads it if the advance dropped it).
 * @param {{ grpc_client: any }} sdk @param {any} raw the raw waitForTransaction result
 */
export async function chain_gas_from_receipt(sdk, raw) {
  if (!raw?.Transaction) return // a failed tx never chains — the caller invalidates the pin instead
  remember_gas_coin(raw)
  await ensure_gas_price(sdk, raw.Transaction.epoch)
}

/**
 * Drop the chained COIN (keep the epoch-stable price): the coin may have moved out-of-band — a non-commit tx from
 * this wallet (equivocation guard) or any commit failure. The next commit selects gas fresh and re-chains.
 */
export function invalidate_gas_coin() {
  coin = null
}

/** Drop the WHOLE pin — a fight boundary (fresh entry / result open). @returns {void} */
export function clear_gas_coin_cache() {
  coin = null
  price = null
  epoch = null
}

/** TEST-ONLY snapshot of the private state (no production reader). @returns {{ coin: any, price: any, epoch: any }} */
export function _peek_gas_cache() {
  return { coin, price, epoch }
}
