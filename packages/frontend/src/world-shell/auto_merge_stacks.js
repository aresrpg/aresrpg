// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1495 — the BOOT SWEEP: on world load, once the owned-items read has settled, fold the same-template
// duplicates every acquisition path mints (see chain/stack_merge.js for why they exist) into one stack per
// template, in ONE transaction.
//
// The orchestrator only. Its fight predicate, submit door and fold door are INJECTED by the edge that owns
// them (roster/load_roster.js) — this module reads nothing and writes nothing, so its four laws are provable
// with plain functions:
//   1. ONCE PER SESSION — a boot sweep, re-armed only by a fresh app load (the latch is module state).
//   2. NEVER MID-FIGHT — a fight is a chain-side turn clock; a background PTB has no business racing it.
//      A fight-active boot leaves the sweep ARMED, so the next roster load (every gameplay tx re-runs it)
//      sweeps once the fight is over.
//   3. THE RECEIPT FOLDS THE BAG — never the plan (no optimistic rewrite; a failed merge changes nothing).
//   4. NEVER RETRY — the latch is consumed BEFORE the submit, so an EXECUTED failure (a digest exists = gas
//      burned) can never re-burn, and a pre-flight refusal simply waits for the next app load. Cosmetics are
//      the only thing at stake: an unmerged bag is a tidy-up, never a blocker, so every failure is silent
//      to the player and loud to the console.

import { plan_stack_merges, stack_merge_receipt_rows } from '../chain/stack_merge.js'
import { game_log } from '../core/log.js'

// One PTB's worth of merges. A hoarder with hundreds of duplicates would otherwise compose a transaction over
// the gas ceiling — the guard would refuse it (zero gas) and the bag would NEVER tidy. Capped, the sweep
// converges over a few sessions instead of failing forever.
const MAX_MERGES_PER_SWEEP = 32

/** Session state, by design: a fresh app load is a fresh module. @type {{ fired: boolean }} */
const session_latch = { fired: false }

/**
 * @param {{
 *   items: any[],
 *   fight_active: () => boolean,
 *   submit: (merges: any[]) => Promise<any>,
 *   fold: (rows: { into: string, from: string, total: number }[]) => void,
 *   latch?: { fired: boolean },
 * }} deps
 * @returns {Promise<{ swept: boolean, reason?: string, merged?: number, error?: unknown }>}
 */
export async function sweep_duplicate_stacks({ items, fight_active, submit, fold, latch = session_latch }) {
  if (latch.fired) return { swept: false, reason: 'already-swept' }
  if (fight_active()) return { swept: false, reason: 'fight-active' }

  const merges = plan_stack_merges(items).slice(0, MAX_MERGES_PER_SWEEP)
  if (!merges.length) return { swept: false, reason: 'nothing-to-merge' }

  latch.fired = true // consumed BEFORE the submit: one attempt per session, whatever happens next
  try {
    const rows = stack_merge_receipt_rows(await submit(merges))
    if (rows.length) fold(rows)
    game_log('stack-sweep', `merged ${rows.length}/${merges.length} duplicate stack(s)`)
    return { swept: true, merged: rows.length }
  } catch (error) {
    // Loud here, silent to the player. run_tx already reported the failure with its executed/pre-flight
    // provenance; the bag simply stays as it was until the next app load re-arms the sweep.
    game_log('stack-sweep', 'duplicate-stack merge failed — the bag stays unmerged this session', error)
    return { swept: true, error }
  }
}
