// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SINGLE-PTB overdue auto-crank — the tx-EDGE half of the turn-commit system (its pure half —
// stage_to_batch / keys / epochs / auto_commit_decision — lives in @aresrpg/fight turn_commit.js).
// This stays at the frontend tx edge because it RUNS commits and speaks the tx error vocabulary
// (tx_digest_error): the fight core stays promise-free.
//
//   commit_with_overdue_retry  ONE batch attempt; on the DISTINCT turns::ESomeoneOverdue simulation refusal —
//                              fire one best-effort crank (losing the crank race to the liquidation janitor or
//                              a peer is fine) and retry ONCE. Anything else rethrows untouched: never a blind
//                              retry, and both refusals are PRE-EXECUTION (no digest, zero gas), so the
//                              tx-retry-burn law is never in play.

import { error_executed_digest } from './tx_digest_error.js'

/**
 * Run `commit` once; if it fails with the DISTINCT someone-overdue class, crank (best-effort — a lost race is
 * fine) and retry `commit` exactly once. Every other failure — and a second failure after the retry — rethrows.
 * @template T
 * @param {{ commit: () => Promise<T>, crank: () => Promise<unknown>, is_overdue: (error: unknown) => boolean }} deps
 * @returns {Promise<T>}
 */
export async function commit_with_overdue_retry({ commit, crank, is_overdue }) {
  try {
    return await commit()
  } catch (error) {
    // Classification alone never grants a retry. Overdue is expected to be a simulation refusal, but a race can
    // surface the same abort after submission; its digest is proof that gas burned, so it stops here.
    if (error_executed_digest(error) || !is_overdue(error)) throw error
    await crank().catch(() => {}) // permissionless janitor — the retry surfaces the fresh truth either way
    return commit()
  }
}
