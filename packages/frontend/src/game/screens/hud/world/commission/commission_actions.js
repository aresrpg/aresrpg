// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The thin CHAIN-DECOUPLED seam for artisan commissions — the SDK WIRING CONTRACT. The Move v2 commission
// redesign runs in PARALLEL; until it lands every read/write here returns MOCK data so the modal is complete
// and demoable NOW. When the chain lands ONLY THIS FILE changes — the views never do:
//
//   READS:
//     list_artisans(my_address)  → Artisan[]   the caller's FRIEND ROSTER (Commission Flow v2 — an artisan
//       must be a friend first, so the picker never shows a thousand names) — read_roster
//       (soulbound FriendList + /v1 `jobs` enrichment). Every friend is a candidate artisan; their craftable
//       recipes derive from their on-chain job levels. The old "every artisan" mock is GONE.
//     list_commissions(address)  → { as_artisan, as_customer }   still the /v1 stub (the parallel Move-v2 read
//       lane owns it).
//   WRITES (swap the mock body for an @aresrpg/sdk PTB run through the standard run_tx choke — dryRun-guarded,
//           NO auto-retry, ONE honest toast at the call site):
//     request_craft({ artisan_address, recipe_id, job_id, payment_mist }) → { ok: true }
//     accept_craft({ commission_id })                                     → { ok: true }
//
// @typedef {{ address: string, name: string, jobs: Record<string, number> }} Artisan
// @typedef {{
//   id: string, status: string, payment_mist: number,
//   customer_name: string, customer_address: string,
//   artisan_name: string, artisan_address: string,
//   recipe_id: string, recipe_name: string, recipe_icon: string, recipe_category: string, recipe_quality: string,
// }} Commission

import { read_roster } from '../../../../../world-shell/friends_reads.js'

/** SUI is 9-decimal (MIST). The payment is authored in SUI and stored on-chain as MIST. */
export const SUI_DECIMALS = 9
const MIST_PER_SUI = 10 ** SUI_DECIMALS
/** @param {number|string} sui @returns {number} whole MIST (negatives clamp to 0) */
export const to_mist = sui => Math.max(0, Math.round((Number(sui) || 0) * MIST_PER_SUI))
/** @param {number} mist @returns {number} SUI (for display) */
export const from_mist = mist => (Number(mist) || 0) / MIST_PER_SUI

// COMMISSION PAYMENT FLOOR: the minimum payment is 0.1 SUI. The v1
// zero-payment path is retired; a commission now always pays the artisan ≥ 0.1 SUI. THIS is the client guard that
// protects the user meanwhile — the on-chain `commission::request` assert (EAmountTooLow) rides the NEXT publish.
export const MIN_PAYMENT_SUI = 0.1
export const MIN_PAYMENT_MIST = to_mist(MIN_PAYMENT_SUI) // 100_000_000 — mirrors commission::MIN_PAYMENT_MIST
/** True iff the SUI-authored payment clears the 0.1 SUI floor. @param {number|string} sui @returns {boolean} */
export const meets_min_payment = sui => to_mist(sui) >= MIN_PAYMENT_MIST

/** Short 0x… address for a name fallback when a friend's character name hasn't indexed. */
const short = (/** @type {string} */ a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')

/** @type {{ as_artisan: Commission[], as_customer: Commission[] }} — the /v1/commissions live shape. */
const MOCK_COMMISSIONS = {
  // INCOMING — other players asking ME to craft (the artisan view queue).
  as_artisan: [
    {
      id: 'cm_1', status: 'pending', payment_mist: to_mist(2.5),
      customer_name: 'Aelric', customer_address: '0xE1',
      artisan_name: 'You', artisan_address: '0xME',
      recipe_id: 'iron_sword', recipe_name: 'Iron Sword', recipe_icon: 'iron_sword',
      recipe_category: 'sword', recipe_quality: 'rare',
    },
    {
      id: 'cm_2', status: 'pending', payment_mist: to_mist(0.1), // the 0.1 SUI floor
      customer_name: 'Milla', customer_address: '0xE2',
      artisan_name: 'You', artisan_address: '0xME',
      recipe_id: 'leather_cap', recipe_name: 'Leather Cap', recipe_icon: 'leather_cap',
      recipe_category: 'hat', recipe_quality: 'common',
    },
    {
      id: 'cm_3', status: 'pending', payment_mist: to_mist(0.75),
      customer_name: 'Doran', customer_address: '0xE3',
      artisan_name: 'You', artisan_address: '0xME',
      recipe_id: 'oak_shield', recipe_name: 'Oak Shield', recipe_icon: 'oak_shield',
      recipe_category: 'cloak', recipe_quality: 'uncommon',
    },
  ],
  // OUTGOING — MY pending requests to others (kept for the future "your requests" strip; live shape parity).
  as_customer: [
    {
      id: 'cm_9', status: 'pending', payment_mist: to_mist(1),
      customer_name: 'You', customer_address: '0xME',
      artisan_name: 'Yseult', artisan_address: '0xC4r0l',
      recipe_id: 'health_potion', recipe_name: 'Health Potion', recipe_icon: 'health_potion', recipe_quality: 'common',
    },
  ],
}

/** A short latency so the mock reads/writes read like real network calls in the demo. */
const beat = (/** @type {number} */ ms = 220) => new Promise(res => setTimeout(res, ms))

/**
 * The craftspeople a customer can commission = the caller's FRIEND ROSTER. Reads the
 * soulbound FriendList + /v1 enrichment via read_roster and projects each friend to `{ address, name, jobs }`.
 * Every friend is a candidate artisan; the view derives their craftable recipes from `jobs` (a friend with no
 * craft levels shows an empty recipe list). Empty roster / logged-out → `[]` (the view shows the add-friends hint).
 * @param {string | null} [my_address] the signed-in wallet whose friend list to read
 * @returns {Promise<Artisan[]>}
 */
export async function list_artisans(my_address) {
  if (!my_address) return []
  const { rows } = await read_roster(my_address)
  return rows.map(r => ({ address: r.address, name: r.name || short(r.address), jobs: r.jobs ?? {} }))
}

/**
 * The commissions touching `address`, split by side (the /v1/commissions live shape). REAL body: GET
 * /v1/commissions?address={address}. The mock ignores the address and returns the fixed demo set.
 * @param {string} [address]
 * @returns {Promise<{ as_artisan: Commission[], as_customer: Commission[] }>}
 */
export async function list_commissions(address) {
  await beat()
  void address
  return { as_artisan: [...MOCK_COMMISSIONS.as_artisan], as_customer: [...MOCK_COMMISSIONS.as_customer] }
}

/**
 * CUSTOMER → request a craft from an artisan. STUB write today (resolves after a beat); the real body composes the
 * @aresrpg/sdk commission PTB (escrow the ≥0.1 SUI payment + the recipe intent) through run_tx when the Move-v2
 * read wiring lands.
 * @param {{ artisan_address: string, recipe_id: string, job_id: string, payment_mist: number,
 *   customer_address?: string, customer_name?: string, recipe_name?: string, recipe_icon?: string,
 *   recipe_category?: string }} req
 * @returns {Promise<{ ok: true }>}
 */
export async function request_craft(req) {
  await beat(300)
  return { ok: true }
}

/**
 * ARTISAN → accept an incoming commission. STUB: resolves after a beat. REAL body: compose the
 * @aresrpg/sdk accept PTB (burn the ingredients from the escrow / mint the output, release payment).
 * @param {{ commission_id: string }} req
 * @returns {Promise<{ ok: true }>}
 */
export async function accept_craft(req) {
  await beat(300)
  void req
  return { ok: true }
}
