// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SETTLE HONESTY (#882) — the ONE place that decides whether a settlement may be REPORTED as landed.
//
// The dead-end take of record observed the client reporting `settled=true` while the chain still held the Fight
// object: `settle_chain` returned true the moment `settle_and_open` resolved, and a resolved tx whose
// `ResultOpened` event could not be read was treated exactly like a proven one ("a null result_id no-ops the
// loot leg but still repaints"). A settlement nobody can point at on chain is not a settlement — it strands the
// character (fight_marker still set, abort 111 on every new fight) behind a UI that says the fight is over.
//
// The rule: a settle reports TRUE only with CHAIN CONFIRMATION —
//   • the receipt's own `ResultOpened` (a `result_id`) — the settlement's on-chain event, proof by itself; or
//   • a liveness re-read that no longer finds a LIVE Fight (destroyed by this settle, or terminal).
// Anything else is UNCONFIRMED and says so. The re-read costs one cheap read and only on the ambiguous branch —
// a proven receipt never pays for it.
//
// BURN LAW: the unconfirmed case means a tx EXECUTED (a digest exists, gas was spent) without provable effect,
// so the halt is classified `executed_failure` — latched, never auto-re-fired; the manual pill door stays open.

/** The receipt's own settlement proof: a parsed `ResultOpened` result id. Pure. @param {unknown} result_id */
export const receipt_confirms_settlement = (result_id) => typeof result_id === 'string' && result_id.length > 0

/**
 * The chain-gated settle verdict. `read_liveness` is injected (leaf law — no mock.module) and is only called on
 * the ambiguous branch; a read that throws or cannot be classified leaves the settlement UNCONFIRMED (never
 * reported as landed on hope).
 * @param {{ fight_id?: string|null, result_id?: unknown,
 *   read_liveness?: ((fight_id: string) => Promise<{ state: 'live'|'absent'|'settled' }>) | null }} args
 * @returns {Promise<{ settled: boolean, halt: 'executed_failure' | null }>} `halt` is the on_halt verdict to
 *   report when the settlement could not be confirmed (executed, so never auto-retried).
 */
export async function settle_verdict({ fight_id = null, result_id = null, read_liveness = null } = {}) {
  if (receipt_confirms_settlement(result_id)) return { settled: true, halt: null }
  if (!fight_id || typeof read_liveness !== 'function') return { settled: false, halt: 'executed_failure' }
  const liveness = await read_liveness(fight_id).catch(() => null)
  // 'absent' = the Fight was destroyed by the settle · 'settled' = terminal on chain. Both are confirmation.
  // 'live' (or an unreadable state) is not: the object outlived the transaction that claimed to consume it.
  return liveness && (liveness.state === 'absent' || liveness.state === 'settled')
    ? { settled: true, halt: null }
    : { settled: false, halt: 'executed_failure' }
}
