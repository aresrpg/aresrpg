// Optimistic BOUGHT-ITEM injection ledger — the ADDITION twin of consumable_ledger's mask_pending_items.
// PURE, dependency-free (unit-testable); the tx/store wiring lives in store_patch.js + shop.tsx.
//
// The problem it solves: a shop buy mints a KIOSK-LOCKED Item on-chain, but the bag reads through the /v1
// owner-items view (get_owned_items — /v1-first, chain-walk fallback), which lags the buy by the indexer's
// projection delay (the just-bought key took noticeably long to show up, 2026-07-12). load_roster is the SINGLE
// producer of chain-truth bag amounts and FULL-REPLACES s.sui.items on every reconcile — so a naive
// optimistic paint would be WIPED on the very next reconcile until the indexer caught up (flash-and-vanish,
// strictly worse). This ledger makes the optimistic row STRUCTURAL: every reconcile renders the chain bag
// MERGED with any pending buy the chain read doesn't yet include (merge_pending_buys, applied at the
// load_roster dispatch, right after mask_pending_items). It self-drains: each pending row carries the item's
// REAL created object id (from the buy tx effects), so the instant a chain read includes that id the pending
// row is dropped and the authoritative row (true amount/kiosk) takes over — zero duplication, no rollback
// needed on an executed success (the id WILL appear). Never involves auto-retry: injection only happens after
// buy success; a failed/pre-exec buy throws before hydration and nothing is injected.

/** pending optimistic buys per created OBJECT id — bought but not yet chain-visible in a bag read. */
const pending = new Map()

/** @param {any} row  a bag row (must carry a real created object `id`). */
export function add_pending_buy(row) {
  if (row?.id) pending.set(row.id, row)
}

/** Drop `id` from the pending set (a reconcile saw it, or a manual rollback). */
export function drop_pending_buy(/** @type {string} */ id) {
  pending.delete(id)
}

/** TEST-ONLY: reset the module ledger between cases. */
export function reset_pending_buys() {
  pending.clear()
}

/**
 * Merge pending-buy rows into a CHAIN-TRUTH items array: any pending id the chain read ALREADY includes
 * self-drains (the authoritative row wins); the rest are appended so the just-bought item survives the
 * full-replace reconcile until the indexer catches up. Empty ledger → the same array ref (cheap common case).
 * @param {any[]} items @returns {any[]}
 */
export function merge_pending_buys(items) {
  if (pending.size === 0) return items
  const have = new Set((items ?? []).map((/** @type {any} */ i) => i?.id))
  const out = (items ?? []).slice()
  for (const [id, row] of pending) {
    if (have.has(id))
      pending.delete(id) // chain caught up — self-drain, the real row already renders
    else out.push(row)
  }
  return out
}
