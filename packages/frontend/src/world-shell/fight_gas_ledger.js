// FIGHT COST LEDGER (07-11: "show exactly on the fight result card how much the fight cost in
// SUI"). Standalone — zero imports from dungeon_actions.js / dungeon_store.js in EITHER direction, so this
// seam can never become a circular-import trap between the store and the tx module that feeds it.
//
// ACCUMULATE: dungeon_actions.js's shared `sign()` folds every landed tx's NET gas (computation + storage −
// rebate) in via `add()`. A digest existing already means the wallet's tx choke (src/tx) dry-ran AND executed
// on-chain — real gas is spent whether the tx lands success or an on-chain abort (tx-retry-burn law: a digest
// = gas burned), so `add()` is called before dungeon_actions.js's success-check throw.
//
// RESET: fires INSIDE dungeon_actions.js's next_room_fight / join_room_fight / create_world_fight — the THREE
// fresh-entry doors — immediately BEFORE each signs, so the entry tx's own gas IS folded in as the first line
// of the new total (correction 07-11: the entry tx pays the `Fight` object's storage DEPOSIT and the
// later settle tx collects its REBATE; excluding the deposit while including the rebate would show a
// misleading "refund" — deposit and rebate must both land so they net out honestly). A resume/adopt never
// calls these doors (it reads existing chain state instead), so it never resets a total mid-flight.
//
// REFRESH SEMANTICS (chosen deliberately, honest): `use_dungeon` carries no persistence middleware — a hard
// reload already loses the live session's local state. This ledger matches that SAME contract: a mid-fight
// refresh loses the running total (module re-inits to 0 on reload); it is "since this fight's last fresh
// start, this tab" — never a lifetime/per-character total.
import { create } from 'zustand'

const MIST_PER_SUI = 1_000_000_000n

export const use_fight_cost = create((set) => ({
  /** @type {bigint} net MIST spent so far this fight (computation + storage − rebate). May go NEGATIVE — a
   *  rebate-heavy settle/burn can pull the running total below zero; the card shows that as an honest refund. */
  net_mist: 0n,

  /** Zero the running total — call ONLY at a FRESH fight start (never a resume/adopt). */
  reset() {
    set({ net_mist: 0n })
  },

  /**
   * Fold one landed tx's gas into the running total. `gas_used` is the gRPC-shaped, string-encoded
   * `{ computationCost, storageCost, storageRebate }` normalize_receipt now carries on every receipt. A no-op
   * on a nullish arg so callers can pass a receipt's `gasUsed` unconditionally.
   * @param {{ computationCost?: string|number, storageCost?: string|number, storageRebate?: string|number } | null | undefined} gas_used
   */
  add(gas_used) {
    if (!gas_used) return
    const gross = BigInt(gas_used.computationCost ?? 0) + BigInt(gas_used.storageCost ?? 0)
    const rebate = BigInt(gas_used.storageRebate ?? 0)
    set((state) => ({ net_mist: state.net_mist + gross - rebate }))
  },
}))

/**
 * Format the running net total for the result card: exact SUI to 4dp (truncated, never rounded — the card
 * never OVERSTATES what left the wallet), plus a refund flag when the total is negative (a rebate-heavy
 * settle/burn outweighed the turn costs — shown as an honest refund line, never a negative "cost").
 * @param {bigint} net_mist @returns {{ sui: string, is_refund: boolean }}
 */
export function format_fight_cost(net_mist) {
  const is_refund = net_mist < 0n
  const abs = is_refund ? -net_mist : net_mist
  const whole = abs / MIST_PER_SUI
  const frac_4dp = (abs % MIST_PER_SUI) / (MIST_PER_SUI / 10_000n)
  return { sui: `${whole}.${frac_4dp.toString().padStart(4, '0')}`, is_refund }
}
