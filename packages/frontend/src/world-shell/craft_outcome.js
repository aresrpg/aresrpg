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
// The success-chance curve this outcome is rolled against is NOT here: `craft_success_rate_bp` mirrors
// `crafting.move`'s `y91` and now lives in `@aresrpg/sdk/jobs` beside its `y21`/`y92` siblings (#2052).

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
