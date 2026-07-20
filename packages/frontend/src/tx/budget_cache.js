// ─────────────────────────────────────────────────────────────────────────────
//  PER-FIGHT BUDGET CACHE (latency lever 1 — pre-republish quick win)
// ─────────────────────────────────────────────────────────────────────────────
//  A fight turn commits up to 3 SEQUENTIAL self-pay txs (act_move → act_weapon → act_pass+crank), and EVERY
//  one currently pays a ~0.5s dry-run (simulateTransaction) round-trip before the wallet signs. The engine
//  acts are `&Random`-free in COST-shape and stable per fight: the same move-call target over the same fight/
//  character objects has a gas cost that varies only by the pure args (destination cell, target) — variance
//  the ×1.5 budget headroom already absorbs, and the mob-crank cost only TRENDS DOWN as mobs die.
//
//  So: the FIRST act of each shape per fight dry-runs fresh (unchanged), caches its ×1.5 budget + measured NET
//  cost, and every SUBSEQUENT identical-shape act in the SAME fight reuses that budget and SKIPS the dry-run.
//  The budget is STILL dry-run-DERIVED (S-54 law holds — the value came from a real simulate of the identical
//  shape earlier THIS fight); the GAS_CEILING refuse stays ARMED (a cached value over the ceiling is dropped,
//  never reused). Win: −0.4-0.6s × the 2-3 legs of every turn after the first.
//
//  DELIBERATE TRADE: a cached-shape act skips the free would-abort refuse. If such an act
//  WOULD abort on-chain (an illegal move the client-side @aresrpg/sim should already have blocked), it now
//  EXECUTES and aborts — a small compute burn, NOT the InsufficientGas WHOLE-budget drain S-54 exists to stop
//  (the budget is still a real ×1.5). The executed failure then INVALIDATES the cache (clear on any on-chain
//  failure) and is NEVER auto-retried (existing law). Bounded, self-healing, money-safe.
//
//  INVALIDATION (all wired by the callers): any executed failure → clear; any guard refusal → forget the key;
//  fresh fight entry + fight end → clear. The cache is IN-MEMORY and one-fight-at-a-time (the fight store runs
//  its txs strictly sequentially), so a global clear at each fight boundary IS per-fight scoping.
// ─────────────────────────────────────────────────────────────────────────────

import { GAS_CEILING_MIST } from '../game/core/gas_guard.js'

/** shape-key → { budget: bigint, net: bigint }. Cleared at every fight boundary (see clear_budget_cache). */
const store = new Map()

/**
 * The cache key for a built PTB: its MoveCall target(s) + the SORTED ids of every OBJECT input (fight, version,
 * clock, random, …). PURE inputs (the destination cell, character id, spell target) are EXCLUDED by design — a
 * cost-stable act over the same fight objects shares one entry regardless of those args. Two acts of the same
 * shape in the SAME fight ⇒ identical key (hit); a different fight ⇒ a different fight-object id ⇒ different key
 * (miss). Derived from `tx.getData()` so nothing threads a key down the stable choke signature.
 * @param {any} tx a `@mysten/sui` Transaction
 * @returns {string | null} the key, or null when it can't be derived (⇒ caller dry-runs fresh, never caches)
 */
export function budget_cache_key(tx) {
  try {
    const data = tx.getData()
    const targets = []
    for (const c of data.commands)
      if (c.$kind === 'MoveCall') targets.push(`${c.MoveCall.package}::${c.MoveCall.module}::${c.MoveCall.function}`)
    if (targets.length === 0) return null // no move-call ⇒ not a shape we cache
    const object_ids = []
    for (const inp of data.inputs) {
      if (inp.$kind === 'UnresolvedObject') object_ids.push(inp.UnresolvedObject.objectId)
      else if (inp.$kind === 'Object') {
        const o = inp.Object
        const id = (o.SharedObject ?? o.ImmOrOwnedObject ?? o.Receiving)?.objectId
        if (id) object_ids.push(id)
      }
      // Pure inputs are intentionally ignored — they are the per-act args the ×1.5 headroom covers.
    }
    return `${targets.join('|')}@@${object_ids.sort().join(',')}`
  } catch {
    return null // un-inspectable tx (e.g. a test fake) ⇒ no caching, dry-run every time
  }
}

/**
 * A cached budget to pin for this shape, or null to dry-run fresh. The GAS_CEILING refuse stays ARMED: a cached
 * value whose measured net now exceeds the ceiling is DROPPED (never reused) and null is returned so the caller
 * re-dry-runs — which will then refuse loudly if it is genuinely over-ceiling.
 * @param {string | null} key @returns {bigint | null}
 */
export function cached_budget(key) {
  if (!key) return null
  const hit = store.get(key)
  if (!hit) return null
  if (hit.net > GAS_CEILING_MIST) {
    store.delete(key) // ceiling arm — never reuse an over-ceiling budget
    return null
  }
  return hit.budget
}

/**
 * Remember a fresh dry-run's outcome for the rest of this fight.
 * @param {string | null} key @param {bigint} budget the ×1.5 budget @param {bigint} net the measured net MIST cost
 */
export function remember_budget(key, budget, net) {
  if (key) store.set(key, { budget, net })
}

/** Drop ONE shape (a guard refusal on that shape). @param {string | null} key */
export function forget_budget(key) {
  if (key) store.delete(key)
}

/** Drop EVERY cached budget — a fight boundary (fresh entry / end) or any executed on-chain failure. */
export function clear_budget_cache() {
  store.clear()
}
