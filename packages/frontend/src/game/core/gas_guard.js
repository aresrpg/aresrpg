// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GAS PREFLIGHT — the pure money-decision behind auth/index.ts's preflight_gas_guard (gas-burn emergency 07-06).
// NO I/O here (that lives in auth): this is the unit-tested verdict a simulateTransaction result + the signer's
// balance produce. GAS_CEILING_SUI is the ONE standing ceiling for every app PTB — a tx that would cost more is
// refused BEFORE signing (zero gas). Admin/deploy CLI scripts run outside the app path and never reach here.

// TESTNET QA DIAL (2026-07-11): raised 0.1 → 0.25 so the mob-AI crank can't refuse a legitimate turn mid-fight.
// act_pass resolves the living mobs' turns ON-CHAIN — a per-spell/per-target BFS whose cost scales with
// mobs × player-targets × mob-MP; measured range 0.013 (solo, 2 low-MP mobs) → 0.128 (a real blocked-tx state).
// Compute-dominated (storage ~0). RESTORE TO 0.1 BEFORE MAINNET (mainnet-prep queue, alongside the kolizeum-gate
// restore). The real fix is bounding the crank compute Move-side (early-exit BFS + cap targets) — lead-owned;
// this dial is belt-and-braces, NOT the fix (a max party×mob fight could still approach 0.25).
export const GAS_CEILING_SUI = 0.25 // hard refuse-above ceiling — fail loudly if a tx costs more than 0.1; testnet-dialed to 0.25
export const MIST_PER_SUI = 1_000_000_000n
export const GAS_CEILING_MIST = BigInt(Math.round(GAS_CEILING_SUI * 1e9))
// BUDGET HEADROOM (a "can't start a fight" failure on a 0.109 SUI wallet): the ×1.5 pad applies to
// COMPUTATION ONLY. Storage cost is DETERMINISTIC from the simulated effects (bytes are bytes — execution
// writes the same objects the sim wrote), so padding it bought zero safety and inflated every storage-heavy
// budget ~50% (fight-create: 0.284 demanded for a 0.189 gross whose bulk is the REFUNDABLE Fight deposit).
// budget = storage + computation × 1.5 — always ≥ gross, floor drops to what the chain actually requires.
const BUDGET_HEADROOM_NUM = 3n // computation pad = ×3/2 = ×1.5 over the simulated computation
const BUDGET_HEADROOM_DEN = 2n

/**
 * @typedef {{ ok: true, budget: bigint }
 *   | { ok: false, reason: 'sim_failed' | 'over_ceiling' | 'insufficient_balance', cost_sui?: string }} GasVerdict
 */

/**
 * The GROSS (computation + storage) and NET (after the storage rebate) MIST of a simulated tx — the two gas
 * numbers the guard needs: GROSS drives the ×1.5 budget, NET is what the ceiling compares. ONE home for the gas
 * math so the per-fight budget cache (src/tx/budget_cache.js) can re-arm the ceiling on a cached hit from the
 * SAME formula. Returns 0n on a nullish / non-gas sim.
 * @param {any} sim grpc simulateTransaction result: { $kind, Transaction|FailedTransaction: { effects } }
 * @returns {{ gross: bigint, net: bigint }}
 */
export function sim_gas(sim) {
  const g = (sim?.Transaction ?? sim?.FailedTransaction)?.effects?.gasUsed ?? {}
  const computation = BigInt(g.computationCost ?? 0)
  const storage = BigInt(g.storageCost ?? 0)
  const gross = computation + storage // budget must cover the max charge
  const rebate = BigInt(g.storageRebate ?? 0)
  // net = real SUI leaving the wallet after the rebate; computation/storage split feeds the budget math.
  return { gross, net: gross > rebate ? gross - rebate : gross, computation, storage }
}

/**
 * Decide whether a simulated tx may be sent, and at what gas budget.
 *   - simulation reports failure (would abort on-chain) → REFUSE ('sim_failed') — the caller humanizes the cause.
 *   - simulated NET cost (computation + storage − rebate) over the ceiling → REFUSE ('over_ceiling', cost_sui).
 *   - budget (gross × 1.5) exceeds the known balance → REFUSE ('insufficient_balance').
 *   - otherwise → { ok, budget } to pin on the tx so the wallet can never under-budget.
 * @param {any} sim grpc simulateTransaction result: { $kind, Transaction|FailedTransaction: { effects } }
 * @param {bigint | null} [balance_mist] signer SUI balance in MIST (null = unknown → skip the balance gate)
 * @returns {GasVerdict}
 */
export function gas_guard_decision(sim, balance_mist = null) {
  const effects = (sim?.Transaction ?? sim?.FailedTransaction)?.effects
  // ALLOW-BY-EXCEPTION (money-path hardening #796): only an explicitly clean success is priceable — union tag
  // `Transaction` AND `status.success === true`. The old shape refused what LOOKED failed and priced everything
  // else, so a missing status, an unknown union tag or a non-boolean `success` read as "fine" and had `gasUsed`
  // taken off it (an absent gasUsed yields budget 0 — a guaranteed InsufficientGas burn, the very drain this
  // guard exists to prevent). The @server's simulate gate makes the identical call; their parity is a test
  // (api/sponsor.simulate_gate.test.js), so this condition and classify_simulation move together or go red.
  if (sim?.$kind !== 'Transaction' || effects?.status?.success !== true) return { ok: false, reason: 'sim_failed' }

  const { net, computation, storage } = sim_gas(sim)
  if (net > GAS_CEILING_MIST) return { ok: false, reason: 'over_ceiling', cost_sui: mist_to_sui_str(net) }

  // Pad computation only (varies run-to-run); storage is byte-deterministic — see BUDGET_HEADROOM doc.
  const budget = storage + (computation * BUDGET_HEADROOM_NUM) / BUDGET_HEADROOM_DEN
  if (balance_mist != null && balance_mist < budget) return { ok: false, reason: 'insufficient_balance' }
  return { ok: true, budget }
}

/** MIST bigint → a short SUI string for player copy (3 dp). */
export function mist_to_sui_str(/** @type {bigint} */ mist) {
  return (Number(mist) / 1e9).toFixed(3)
}
