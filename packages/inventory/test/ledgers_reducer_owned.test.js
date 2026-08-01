// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST — THE PENDING LEDGERS MUST BE REDUCER-OWNED STATE. `action/sui_logout` (game/core/modules/
// sui_session.js) clears every reducer-owned ledger BY HAND — settled_item_floor, minted_character_floor,
// xp_floor, deleted_ids — for one stated reason: "a mint from account A can never survive into account B".
// The optimistic pending ledgers were module-global `Map`s written by async tx callbacks from OUTSIDE the
// reducer, so that reset could not see them: they outlive the wallet switch and land account A's optimistic
// paint on account B's bag. One root, two symptoms — the state was not owned by the reducer that renders it.
//
// The property under test never moves: a FRESH `sui` reduces a chain snapshot to exactly that snapshot's
// truth, whatever optimistic writes preceded it in the process.
import { describe, expect, it } from 'bun:test'

import { reduce_sui_data } from '../src/reduce.js'

/** Exactly what `action/sui_logout` hands the next account: reducer state with every ledger empty. */
const fresh_sui = (over = {}) => ({
  characters: [],
  items: [],
  xp_floor: {},
  deleted_ids: {},
  settled_item_floor: {},
  minted_character_floor: {},
  loaded: false,
  ...over,
})

const A_KEY = { id: '0xa-key', item_type: 'dungeon_key', item_category: 'key', amount: 1 }
const POTION = '0xa-potion'

const snapshot = (items) => ({ kind: 'snapshot', items })

/** What the bag RENDERS for a state: chain truth re-read through the reducer's own mask. */
const mask = (sui) => reduce_sui_data(sui, snapshot(sui.items)).items

describe('the optimistic ledgers are reducer state — a wallet switch cannot leak them', () => {
  it("account A's pending buy is never injected into account B's bag", () => {
    // Account A buys: the receipt paints the row and HOLDS it until a chain read projects the id.
    const account_a = reduce_sui_data(fresh_sui(), { kind: 'receipt_patch', op: 'settled_loot', rows: [A_KEY] })
    expect(account_a.items, "A's own bag paints the buy").toEqual([A_KEY])

    // The wallet switches before the indexer ever projects it. B's first chain read is B's whole truth.
    const account_b = reduce_sui_data(fresh_sui(), snapshot([{ id: '0xb-owned' }]))
    expect(account_b.items, "B's bag is B's chain truth — never A's phantom buy").toEqual([{ id: '0xb-owned' }])
  })

  it("account A's pending consume never masks account B's identical stack", () => {
    // Account A clicks 3 units: the batcher reports the optimistic delta before the tx settles.
    const account_a = reduce_sui_data(fresh_sui({ items: [{ id: POTION, amount: 5 }] }), {
      kind: 'receipt_patch',
      op: 'pending_use',
      id: POTION,
      units: 3,
    })
    expect(mask(account_a), "A's own count paints down instantly").toEqual([{ id: POTION, amount: 2 }])

    // The wallet switches mid-flight. B owns 3 of the same potion object — untouched by A's clicks.
    const account_b = reduce_sui_data(fresh_sui(), snapshot([{ id: POTION, amount: 3 }]))
    expect(account_b.items, "B's stack renders chain truth — never A's in-flight delta").toEqual([
      { id: POTION, amount: 3 },
    ])
  })
})
