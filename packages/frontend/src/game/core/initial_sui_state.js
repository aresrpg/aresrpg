// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The account-scoped Sui slice's one initial shape. Game boot and wallet teardown both import this exact
// record, so adding a field cannot leave the next account holding the previous account's value.
export const INITIAL_SUI_STATE = {
  /** @type {boolean} true once the read-model has been fetched at least once (empty vs loading) */
  loaded: false,
  /** @type {string | null} a human reason the roster fetch/connect failed (the read-model never
   *  resolved) — drives the roster UI's error + Retry terminal state so it never sticks on "loading".
   *  null = no error. Cleared the moment a connect/fetch succeeds. */
  load_error: null,
  /** @type {any[]} on-chain characters (from the server's FalkorDB read-model) */
  characters: [],
  /** @type {boolean} has this account already claimed its one free character on-chain (the C2
   *  free-vs-paid marker)? The client CANNOT infer this from the count (the count drops to 0 on
   *  delete while the on-chain claim is permanent), so the server surfaces it in the roster payload.
   *  Drives the create-screen's free-vs-paid CTA so it matches the server's mint routing. */
  has_claimed_free_character: false,
  /** @type {number | null} the LIVE additional-character price in SUI (from the server env), so the
   *  create-screen shows the REAL price instead of a hardcoded client mirror that can drift. */
  character_price_sui: null,
  /** @type {any[]} */
  items: [],
  /** @type {Record<string, any>} receipt-proven loot rows held until a snapshot includes each exact id */
  settled_item_floor: {},
  /** @type {Record<string, number>} in-flight consumable units per item id — the bag renders chain − pending */
  pending_uses: {},
  /** @type {Record<string, any>} receipt-proven mint rows held until a roster snapshot includes each exact id */
  minted_character_floor: {},
  /** @type {any[]} */
  items_for_sale: [],
  /** @type {bigint | null} */
  balance: null,
  /** @type {any[]} */
  tokens: [],
  /** @type {any[]} */
  admin_caps: [],
  /** @type {any[]} */
  finished_crafts: [],
  /** @type {any[]} */
  recipes: [],
}
