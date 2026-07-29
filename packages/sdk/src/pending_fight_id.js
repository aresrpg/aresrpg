// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE PENDING FIGHT ID — the branded session identity a client mounts a fight under BEFORE the create
// transaction finalizes (#1609). The engage board is fully derivable at click (board::generate_for_anchor's
// twin), but the SESSION had no identity until the create receipt ~6.5s later, so the player watched a dead
// screen. A pending session mounts under a synthetic id and RE-KEYS to the minted object id at finality.
//
// THE BRAND IS THE FENCE, not a convention. `pending:<uuid>` is deliberately NOT 0x-hex: it cannot parse as a
// Sui object id, so a settle/PTB path that reached one would be composing against an identity the chain has
// never heard of. Every write door refuses it MECHANICALLY through `assert_chain_id` at the object-arg seam
// (sui/object_arg.js — the one boundary every PTB object parameter crosses), and the refusal is a TYPED error
// with a stable code: failures flow as data, so a caller discriminates on `code`, never on message text.
//
// ONE HOME: the mint, the predicate, the error and the assert are all defined here — the SDK is the lowest
// layer both the write doors and the frontend session already depend on, so neither side re-declares the shape.

/** The brand. Not 0x-hex on purpose — a Sui object id can never collide with it. */
export const PENDING_FIGHT_ID_PREFIX = 'pending:'

/** The stable discrimination code every refusal carries (`error.code`). */
export const PENDING_FIGHT_ID_ERROR_CODE = 'E_PENDING_FIGHT_ID'

/** The typed refusal — a chain door was handed a pending-branded session id. */
export class PendingFightIdError extends Error {
  /** @param {string} value the offending id @param {string} [where] the door/seam that refused */
  constructor(value, where = 'chain door') {
    super(`[${where}] refused a pending session id (${value}) — it has no on-chain identity yet`)
    this.name = 'PendingFightIdError'
    this.code = PENDING_FIGHT_ID_ERROR_CODE
    this.value = value
  }
}

/**
 * Mint a fresh pending session id. `crypto.randomUUID` is the platform's (browser + node ≥19) — no dependency.
 * @returns {string}
 */
export const new_pending_fight_id = () => `${PENDING_FIGHT_ID_PREFIX}${crypto.randomUUID()}`

/**
 * Is `value` a pending-branded session id? Total over every input shape — a ref object, null, a number.
 * @param {unknown} value
 * @returns {boolean}
 */
export const is_pending_fight_id = value =>
  typeof value === 'string' && value.startsWith(PENDING_FIGHT_ID_PREFIX)

/**
 * THE ASSERT. Refuse a pending-branded id at a chain boundary. Accepts the whole object-arg union (a plain id
 * string or a cached `{ objectId }` ref) so the seam can call it once, before any shape discrimination.
 * @param {unknown} ref_or_id
 * @param {string} [where] the door/seam name that appears in the message
 * @returns {void}
 */
export function assert_chain_id(ref_or_id, where = 'chain door') {
  const value =
    is_pending_fight_id(ref_or_id) ?
      /** @type {string} */ (ref_or_id)
    : /** @type {{ objectId?: unknown }} */ (ref_or_id ?? {}).objectId
  if (is_pending_fight_id(value))
    throw new PendingFightIdError(/** @type {string} */ (value), where)
}
