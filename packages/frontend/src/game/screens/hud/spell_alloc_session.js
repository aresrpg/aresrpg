// #55 SPELL-ALLOCATION RECEIPT FLOOR — the ONE home for a `raise_spell_level` receipt's proven effect, held
// across the Spellbook drawer's remounts until the chain-direct read (read_spell_state.js) catches up. Mirrors
// Stats.jsx's characteristic-point `allocation_session` EXACTLY (copy > abstract): a raised spell level + the
// spent point is a receipt-proven FACT, and a lagging chain read must NEVER regress it (a spell that just leveled
// must never re-display as unlevelled, with available points reverting too — the panel's blind `refetch().then(set_alloc)`
// adopted a still-stale fullnode snapshot and threw the receipt away). Model per the CLIENT-INDEPENDENCE law:
// PREDICT on the SUCCESS receipt (spell level +1, spent +cost), then RECONCILE with a floor — the rendered view
// takes the MAX spell level and MAX spent of {chain read, confirmed projection}, and the projection self-clears
// the instant the chain read reaches it (spell_alloc_caught_up). No async callback ever regresses a receipt.

import { useSyncExternalStore } from 'react'

/** @typedef {{ spent: number, levels: Record<string, number>, degraded?: boolean }} SpellAlloc */

// module-level session — survives the Spellbook drawer's remounts, exactly like `allocation_session` (Stats.jsx).
/** @type {{ confirmed: Record<string, SpellAlloc> }} */
let session = { confirmed: {} }
const listeners = new Set()
const snapshot = () => session
const subscribe = (/** @type {() => void} */ listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const commit = (/** @type {(s: typeof session) => typeof session} */ next_fn) => {
  const next = next_fn(session)
  if (next === session) return
  session = next
  for (const listener of listeners) listener()
}

/** Record the receipt-proven allocation projection for a character (held until the chain read catches up). */
export const record_confirmed_spell = (/** @type {string} */ character_id, /** @type {SpellAlloc} */ alloc) =>
  commit((s) => ({ ...s, confirmed: { ...s.confirmed, [character_id]: alloc } }))

/** Drop the projection once the chain read reached it — idempotent, only clears the EXACT held ref (Stats law). */
export const clear_confirmed_spell = (/** @type {string} */ character_id, /** @type {SpellAlloc} */ expected) =>
  commit((s) => {
    if (s.confirmed[character_id] !== expected) return s
    const confirmed = { ...s.confirmed }
    delete confirmed[character_id]
    return { ...s, confirmed }
  })

export const spell_session_snapshot = () => session
/** React binding — subscribe a component to the live session (the confirmed-projection map). */
export const use_spell_alloc_session = () => useSyncExternalStore(subscribe, snapshot, snapshot)

// ── pure receipt/reconcile algebra (unit-tested; React-free) ──────────────────────────────────────────────

/**
 * The confirmed projection AFTER one successful `raise_spell_level` receipt: `spent += cost` and the spell's
 * level `+= 1`, computed off whatever we already know (a prior projection, else the chain read, else the free
 * baseline 1) so stacking two upgrades before the chain catches up composes correctly.
 * @param {SpellAlloc | null} confirmed  the character's held projection (null = none yet)
 * @param {SpellAlloc | null} chain  the latest chain read (read_spell_state), null while loading
 * @param {string} spell_id  the SpellTemplate object id raised
 * @param {number} cost  the S8 point cost spent (target_level − 1)
 * @returns {SpellAlloc}
 */
export function apply_upgrade_receipt(confirmed, chain, spell_id, cost) {
  const base = confirmed ?? chain ?? { spent: 0, levels: {} }
  const cur_level = Number(base.levels?.[spell_id] ?? chain?.levels?.[spell_id] ?? 1)
  return {
    spent: Number(base.spent ?? 0) + Number(cost ?? 0),
    levels: { ...base.levels, [spell_id]: cur_level + 1 },
  }
}

/**
 * The floored view the panel renders: the chain read raised UP to the confirmed projection. A receipt-proven
 * spell level / spent total is a floor a stale read can never regress below (levels only climb, points are only
 * ever spent — the MAX is always the truth); a chain read that has moved PAST the projection (leveled on another
 * device) wins on its own, higher, values. `degraded` rides from the chain read (the spend gate keys on it).
 * @param {SpellAlloc | null} chain @param {SpellAlloc | null} confirmed @returns {SpellAlloc | null}
 */
export function merge_confirmed(chain, confirmed) {
  if (!confirmed) return chain
  if (!chain) return confirmed
  const levels = { ...chain.levels }
  for (const [id, level] of Object.entries(confirmed.levels ?? {}))
    levels[id] = Math.max(Number(chain.levels?.[id] ?? 1), Number(level))
  return {
    ...chain,
    spent: Math.max(Number(chain.spent ?? 0), Number(confirmed.spent ?? 0)),
    levels,
  }
}

/**
 * Has the chain read reached the receipt-proven projection? (every confirmed spell level ≤ the chain's level AND
 * the chain's spent total ≥ the confirmed spent) → the projection can be dropped. Mirrors `stat_doc_caught_up`.
 * @param {SpellAlloc | null} chain @param {SpellAlloc | null} confirmed @returns {boolean}
 */
export function spell_alloc_caught_up(chain, confirmed) {
  if (!chain || !confirmed) return false
  const levels_ok = Object.entries(confirmed.levels ?? {}).every(
    ([id, level]) => Number(chain.levels?.[id] ?? 1) >= Number(level)
  )
  return levels_ok && Number(chain.spent ?? 0) >= Number(confirmed.spent ?? 0)
}
