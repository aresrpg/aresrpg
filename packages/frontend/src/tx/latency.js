// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ─────────────────────────────────────────────────────────────────────────────
//  TX LATENCY PLUMBING — the finality poll DIET (lever 2) + the ?txtiming=1 per-leg
//  instrumentation (lever 3). Both are read by the two halves of the tx choke: src/tx's
//  execute_tx (dry-run + wallet sign+submit) and the fight sign() choke (submit→effects wait).
// ─────────────────────────────────────────────────────────────────────────────

// FINALITY POLL DIET (lever 2) — @mysten/sui's CoreClient.waitForTransaction default pollSchedule is
// [0, 300, 600, 1500, 3500] then +2000ms forever (CUMULATIVE ms offsets from submit; it returns at the first
// poll AFTER the tx is final). Those gaps leave dead zones: a tx final at t≈700ms is not SEEN until 1500ms
// (~800ms wasted), and one at t≈1.6s waits until 3500ms (~1.9s wasted). Testnet Mysticeti finality is ~0.4-1s,
// landing squarely in them. We poll every 250ms through the 0-3s window where turns land, then coarsen (tail
// interval = 5000-4000 = 1000ms) — SAME 60s default timeout, same `include`. Worst-case detection latency in
// the hot window drops from up-to-2000ms to ≤250ms. Each poll is one lightweight getTransaction; a genuinely
// stuck tx costs ~13 dense polls + ~1/s to the 60s ceiling.
export const FINALITY_POLL_SCHEDULE = [
  0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2250, 2500, 2750, 3000, 4000, 5000,
]

/** Monotonic-ish high-res clock (perf.now in the browser; Date.now fallback under bun test). */
export const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

// ?txtiming=1 (lever 3) — off by default; flip it to SEE where a turn's seconds go. Debug-console only.
export const TX_TIMING_ON =
  typeof window !== 'undefined' && new URLSearchParams(window.location?.search ?? '').get('txtiming') === '1'

// Per-tx preflight timings, keyed by the Transaction object itself: execute_tx stamps { dry_run_ms, sign_ms }
// (both live in src/tx), then the fight sign() choke — which holds the SAME tx ref + the submit→effects wait —
// flushes ONE line. A WeakMap keys by identity, so there is no cross-tx bleed and nothing to clean up.
const legs = new WeakMap()

/** execute_tx: record the two preflight phases for this tx (no-op unless ?txtiming=1). */
export function stamp_preflight(
  /** @type {any} */ tx,
  /** @type {number} */ dry_run_ms,
  /** @type {number} */ sign_ms
) {
  if (TX_TIMING_ON && tx) legs.set(tx, { dry_run_ms, sign_ms })
}

const ms = (/** @type {number|null|undefined} */ v) => (v == null ? '—' : `${Math.round(v)}ms`)

/**
 * Run one leg and return its value alongside its wall time. The sponsored door measures every hop with this,
 * so a leg's duration is derived at the leg — never reconstructed from a chain of ambient timestamps.
 * @template T @param {() => Promise<T>} run @returns {Promise<{ value: T, ms: number }>}
 */
export async function timed(run) {
  const started = now()
  const value = await run()
  return { value, ms: now() - started }
}

/**
 * The SPONSORED door's per-leg line (#1663). The engage trace (core/engage_timing.js) already covers a fight
 * engage end-to-end, but it is bound to ONE active fight transaction — create-character and join-world sponsored
 * txs mark into a dead trace and were invisible. This is the door's own instrument: same ?txtiming=1 gate, same
 * console.debug idiom, every sponsored tx regardless of caller. `prepare` is the max of its two CONCURRENT legs.
 * @param {{ build_ms: number, zkp_sign_ms: number, prepare_ms: number, reserve_ms: number,
 *           wallet_sign_ms: number, execute_ms: number, total_ms: number }} legs
 */
export function flush_sponsor_legs(legs) {
  if (!TX_TIMING_ON) return
  console.debug(
    `[txtiming] sponsored: prepare ${ms(legs.prepare_ms)} (kind-build ${ms(legs.build_ms)} ‖ zkp-sign ` +
      `${ms(legs.zkp_sign_ms)}) · reserve ${ms(legs.reserve_ms)} · wallet-sign ${ms(legs.wallet_sign_ms)} · ` +
      `execute ${ms(legs.execute_ms)} · total ${ms(legs.total_ms)}`
  )
}

/** The fight sign() choke: emit the full per-leg line (dry-run · sign+submit · submit→effects) and clear it. */
export function flush_leg(/** @type {any} */ tx, /** @type {string} */ label, /** @type {number} */ wait_ms) {
  if (!TX_TIMING_ON) return
  const pre = (tx && legs.get(tx)) || {}
  if (tx) legs.delete(tx)
  console.debug(
    `[txtiming] ${label}: dry-run ${ms(pre.dry_run_ms)} · sign+submit ${ms(pre.sign_ms)} · submit→effects ${ms(wait_ms)}`
  )
}
