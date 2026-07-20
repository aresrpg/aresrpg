// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D307 — the consumable PENDING-DELTA LEDGER + trailing-click batcher. PURE, dependency-free (unit-testable):
// the wiring to the real tx/toasts lives in consumable_actions.js.
//
// The problem it solves: rapid consumable clicks must (a) paint the count down INSTANTLY per click, (b) fire
// ONE tx carrying the accumulated amount (the on-chain consume takes a per-unit `amount`), and (c) never let a
// chain reconcile that RACES an in-flight batch bounce the number. The ledger is the invariant that makes (c)
// structural: every reconcile renders `chain_amount − pending_units(id)` (mask_pending_items, applied at the
// load_roster dispatch — the ONE producer of chain-truth bag amounts). Pending drains exactly when a batch
// settles: success → the chain burned those units (chain − batch, pending − batch → same rendered count);
// failure → drain + the caller refetches authoritative (D203: never arithmetic-revert), so the count restores.

/** pending optimistic uses per potion OBJECT id — units clicked but not yet chain-settled. */
const pending = new Map()

/** @param {string} id @returns {number} */
export const pending_units = (id) => pending.get(id) ?? 0

/** @param {string} id @param {number} units */
export function add_pending(id, units) {
  pending.set(id, (pending.get(id) ?? 0) + units)
}

/** Drain `units` from `id`'s pending (a batch settled — success or failure). Floors at 0. */
export function drain_pending(id, units) {
  const next = (pending.get(id) ?? 0) - units
  if (next > 0) pending.set(id, next)
  else pending.delete(id)
}

/** TEST-ONLY: reset the module ledger between cases. */
export function reset_pending() {
  pending.clear()
}

/**
 * Render-mask a CHAIN-TRUTH items array against the ledger: amount − pending per id; a row masked to ≤0 is
 * dropped (the cell disappears — its last units are in flight). Items with no pending pass through untouched
 * (same refs — cheap for the common empty-ledger case).
 * @param {any[]} items @returns {any[]}
 */
export function mask_pending_items(items) {
  if (pending.size === 0) return items
  const out = []
  for (const item of items) {
    const p = pending.get(item?.id)
    if (!p) {
      out.push(item)
      continue
    }
    const amount = (Number(item.amount) || 1) - p
    if (amount > 0) out.push({ ...item, amount })
  }
  return out
}

/**
 * Trailing-click batcher: every `click` accumulates one unit into the ledger + the current batch; a trailing
 * timer (`delay` ms after the LAST click) fires ONE `flush({ character_id, potion_id, amount })`. Clicks
 * landing while a flush is in flight form the NEXT batch (fired `delay` after the flight settles — flights
 * are serialized per potion so two txs never race the same owned object). Settle (either way) drains the
 * batch's pending; failure additionally reports through `on_failed` (ONE toast per batch, caller-side).
 * @param {{
 *   flush: (args: { character_id: string, potion_id: string, amount: number }) => Promise<any>,
 *   on_settled?: (out: any, batch: { potion_id: string, units: number }) => void,
 *   on_failed?: (error: any, batch: { potion_id: string, units: number }) => void,
 *   delay?: number,
 * }} opts
 */
export function create_consume_batcher({ flush, on_settled, on_failed, delay = 500 }) {
  /** @type {Map<string, { character_id: string, potion_id: string, units: number, timer: any, in_flight: boolean }>} */
  const batches = new Map()

  function click(/** @type {{ character_id: string, potion_id: string }} */ { character_id, potion_id }) {
    const key = `${character_id}:${potion_id}`
    let batch = batches.get(key)
    if (!batch) {
      batch = { character_id, potion_id, units: 0, timer: null, in_flight: false }
      batches.set(key, batch)
    }
    batch.units += 1
    add_pending(potion_id, 1)
    if (batch.timer) clearTimeout(batch.timer)
    batch.timer = setTimeout(() => fire(key), delay)
  }

  async function fire(/** @type {string} */ key) {
    const batch = batches.get(key)
    if (!batch) return
    batch.timer = null
    if (batch.in_flight || batch.units === 0) return // an in-flight settle re-arms the trailing units
    const { units } = batch
    batch.units = 0 // clicks from here accumulate into the NEXT batch
    batch.in_flight = true
    try {
      const out = await flush({ character_id: batch.character_id, potion_id: batch.potion_id, amount: units })
      drain_pending(batch.potion_id, units) // chain burned them — mask hands the count back to chain truth
      on_settled?.(out, { potion_id: batch.potion_id, units })
    } catch (error) {
      drain_pending(batch.potion_id, units) // failed — drop the optimistic delta; caller refetches authoritative
      on_failed?.(error, { potion_id: batch.potion_id, units })
    } finally {
      batch.in_flight = false
      if (batch.units > 0) {
        // clicks landed during the flight — they are the next batch; trail a fresh full delay from settle
        if (batch.timer) clearTimeout(batch.timer)
        batch.timer = setTimeout(() => fire(key), delay)
      } else if (!batch.timer) {
        batches.delete(key)
      }
    }
  }

  return { click }
}
