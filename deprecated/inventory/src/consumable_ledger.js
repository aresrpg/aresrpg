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
//
// THE LEDGER IS REDUCER STATE (`sui.pending_uses`), never a module global: it is rendered by the reducer, so
// the reducer owns it. A module-scoped Map outlived `action/sui_logout` — which clears every reducer-owned
// ledger by hand — and masked the NEXT account's stacks with the previous one's in-flight clicks. The
// transforms below are pure records in / records out; the batcher below only REPORTS its deltas through
// injected dispatchers, exactly like every other async edge in this codebase.

/** @param {Record<string, number>} [pending] @param {string} id @returns {number} */
export const pending_units = (pending, id) => pending?.[id] ?? 0

/** Add `units` to `id`'s pending delta. @param {Record<string, number>} [pending] */
export const add_pending_units = (pending, id, units) => ({ ...pending, [id]: pending_units(pending, id) + units })

/** Drain `units` from `id`'s pending (a batch settled — success or failure). Floors at 0, dropping the key. */
export function drain_pending_units(pending, id, units) {
  const next = pending_units(pending, id) - units
  const rest = Object.fromEntries(Object.entries(pending ?? {}).filter(([key]) => key !== id))
  return next > 0 ? { ...rest, [id]: next } : rest
}

/**
 * Render-mask a CHAIN-TRUTH items array against the ledger: amount − pending per id; a row masked to ≤0 is
 * dropped (the cell disappears — its last units are in flight). Items with no pending pass through untouched
 * (same refs — cheap for the common empty-ledger case).
 * @param {any[]} items @param {Record<string, number>} [pending] @returns {any[]}
 */
export function mask_pending_items(items, pending) {
  if (!pending || Object.keys(pending).length === 0) return items
  const out = []
  for (const item of items) {
    const p = pending[item?.id]
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
 * Trailing-click batcher: every `click` accumulates one unit into the batch and REPORTS it through `on_pending`;
 * a trailing timer (`delay` ms after the LAST click) fires ONE `flush({ character_id, potion_id, amount })`.
 * Clicks landing while a flush is in flight form the NEXT batch (fired `delay` after the flight settles —
 * flights are serialized per potion so two txs never race the same owned object). Settle (either way) reports
 * the batch's drain through `on_drain`; failure additionally reports through `on_failed` (ONE toast per batch,
 * caller-side). The ledger deltas are DISPATCHED, never written here — the reducer owns the ledger.
 * @param {{
 *   flush: (args: { character_id: string, potion_id: string, amount: number }) => Promise<any>,
 *   on_pending: (potion_id: string, units: number) => void,
 *   on_drain: (potion_id: string, units: number) => void,
 *   on_settled?: (out: any, batch: { potion_id: string, units: number }) => void,
 *   on_failed?: (error: any, batch: { potion_id: string, units: number }) => void,
 *   delay?: number,
 * }} opts
 */
export function create_consume_batcher({ flush, on_pending, on_drain, on_settled, on_failed, delay = 500 }) {
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
    on_pending(potion_id, 1)
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
      on_drain(batch.potion_id, units) // chain burned them — mask hands the count back to chain truth
      on_settled?.(out, { potion_id: batch.potion_id, units })
    } catch (error) {
      on_drain(batch.potion_id, units) // failed — drop the optimistic delta; caller refetches authoritative
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
