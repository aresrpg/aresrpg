// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CRAFT OUTCOME (#2034) — the two facts a crafting player needs, as pure functions over plain data.
//
// THE TRUTH BUG THIS EXISTS FOR: `crafting::craft` is a SUCCESS-ROLL door (crafting.move) — it burns the
// inputs and credits job XP on EVERY attempt, and mints the output only when the roll passes. A failed roll
// is therefore a perfectly SUCCESSFUL transaction, so "the promise resolved" says nothing about whether the
// player got anything. The drawer used to toast `craft_success` on transaction success, which announced a
// win the chain never granted and sent the owner hunting for a pickaxe that had never existed (#2034).
//
// THE DISCRIMINATOR is the receipt's own event: `crafting::Crafted { …, success: bool, output_quantity }`
// (crafting.move:116, emitted in `y90` at :300). It is live on the deployed package — the reported craft's
// own receipt is pinned as `test/fixtures/craft_receipt_failed_roll.json` (testnet digest
// GBZrteiekUsVD89MovE7usxcTHTHCarPZvF4cuvcm1rY: effects.status SUCCESS, Crafted.success false; only the
// opaque object ids are redacted, per the hardcoded-chain-id gate — see the fixture's own _provenance).
// Reading it is the same receipt idiom gather_actions.js uses for `gathering::ResourceGathered`.
//
// AN ABSENT EVENT IS `unknown`, NEVER AN ASSUMED SUCCESS — coercing a missing signal into a plausible
// answer is precisely the class of lie this row removes.
//
// NOTE (one home): `craft_success_rate_bp` mirrors `crafting.move`'s `y91`. Its siblings — the craft XP and
// unlock-level mirrors of `y21`/`y92` — live in `@aresrpg/sdk/jobs`, which is where this belongs too; the
// sdk is outside this change's reach, so the mirror lands here with the Move line it copies named above it.

/** The event whose `success` flag is the ONLY authority on whether a craft produced anything. */
const CRAFTED_EVENT_SUFFIX = '::crafting::Crafted'

/**
 * @typedef {{ outcome: 'success' | 'failure' | 'unknown', quantity: number }} CraftOutcome
 */

/**
 * Read the craft outcome out of an executed transaction receipt. Pure.
 * @param {any} receipt the `result` block of a run_tx receipt (`{ events: [{ type, parsedJson }] }`)
 * @returns {CraftOutcome}
 */
export function craft_outcome(receipt) {
  const event = (receipt?.events ?? []).find((/** @type {any} */ entry) =>
    String(entry?.type ?? '').endsWith(CRAFTED_EVENT_SUFFIX)
  )
  const success = event?.parsedJson?.success
  if (typeof success !== 'boolean') return { outcome: 'unknown', quantity: 0 }
  return {
    outcome: success ? 'success' : 'failure',
    quantity: success ? Number(event.parsedJson.output_quantity) || 0 : 0,
  }
}

// ── The success chance the recipe UI shows BEFORE the player spends ────────────────────────────────
// crafting.move:409 — `y91(level) = min(9900, 5000 + (level - 1) * 50)` basis points: 50% at job level 1,
// +0.5% per level, capped at 99%. Integer math, so the number on screen is the number the chain rolls.

/** The floor: a level-1 crafter passes half the time (5000 bp). */
export const CRAFT_SUCCESS_BP_AT_LEVEL_1 = 5000
/** The ceiling: no crafter is ever certain (9900 bp). */
export const CRAFT_SUCCESS_BP_CAP = 9900
/** Basis points gained per job level above 1. */
const CRAFT_SUCCESS_BP_PER_LEVEL = 50

/**
 * The chain's own success chance for a crafter at `level`, in basis points. An unreadable or sub-1 level
 * clamps to the level-1 floor (the chain's own minimum job level).
 * @param {number} level @returns {number}
 */
export function craft_success_rate_bp(level) {
  const clamped = Math.max(1, Number.isFinite(Number(level)) ? Math.floor(Number(level)) : 1)
  return Math.min(CRAFT_SUCCESS_BP_CAP, CRAFT_SUCCESS_BP_AT_LEVEL_1 + (clamped - 1) * CRAFT_SUCCESS_BP_PER_LEVEL)
}

/**
 * The same chance as a PERCENT for display. The curve steps by 0.5 points, so one decimal is exact — never
 * rounded to a whole number the chain does not use (50.5% is not 51%).
 * @param {number} level @returns {number}
 */
export const craft_success_percent = (level) => Math.round(craft_success_rate_bp(level) / 10) / 10
