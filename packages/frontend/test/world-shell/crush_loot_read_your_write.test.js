// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2178 (D51 read-your-write, 5th instance) — the crush TWIN of the craft proof.
//
// `forgemagie::crush` destroys the gear, rolls the yield and kiosk-locks the minted rune stacks in ONE tx:
// "Minted runes carry their own `item::ItemMinted` events (one per stack) — no claim event exists anymore"
// (move/forgemagie/sources/forgemagie.move:165; the emit itself is item.move:275 `mint_stack_snapshot`, the
// stackable door `extension::y30` reaches). `crush_item` held that receipt and handed the BAG nothing but
// `load_roster()` — the chain/indexer round-trip and the inventory's only reconciliation door — so a crushed
// item's runes could stay invisible until a manual page refresh.
//
// The receipt shape is the run_tx `result` block (`{ events: [{ type, parsedJson }] }`), the same shape the
// captured craft receipt in `test/fixtures/craft_receipt_failed_roll.json` pins; `amount` is the decimal
// STRING the u64 field arrives as, exactly as that capture shows.

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { reset_auth_mock } from '../../src/test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'

const OWNER = '0xowner'
const RUNE_ITEM = '0xrune-stack'
const RUNE_TEMPLATE = '0xrune-template'

const fake_sdk = { get_rolled_stats: async () => null, grpc_client: {} }

const item = { id: '0xitem', template_id: '0xtemplate', item_type: 'sword', kiosk_id: '0xitem-kiosk', level: 1 }
const character_handle = { kiosk_id: '0xitem-kiosk', personal_kiosk_cap_id: '0xcharacter-cap' }

// ONE ItemMinted per minted rune stack — `amount` is the stack's unit count (item.move:275).
const crush_receipt = {
  digest: '0xcrush-digest',
  effects: { status: { status: 'success' } },
  events: [
    {
      type: '0xaresrpg-package::item::ItemMinted',
      parsedJson: { item: RUNE_ITEM, template: RUNE_TEMPLATE, item_type: 'rune_strength_1', amount: '3' },
    },
  ],
}

const templates = new Map([
  [item.template_id, { id: item.template_id, item_type: item.item_type, level: 1 }],
  [RUNE_TEMPLATE, { name: 'Rune of Strength', item_type: 'rune_strength_1', category: 'RESOURCE', level: 1 }],
])

const sdk_game = await import('@aresrpg/sdk/game')
const read_findables = await import('../../src/chain/read_findables.js')
const kiosk_resolve = await import('../../src/world-shell/kiosk_resolve.js')
const tx_seam = await import('../../src/world-shell/tx.js')
const roster = await import('../../src/roster/load_roster.js')
const { context } = await import('../../src/game/core/game.js')
const { default: sui_session } = await import('../../src/game/core/modules/sui_session.js')
const { crush_item } = await import('../../src/world-shell/crush_actions.js')

// Own door onto the ambient engine handle, folded through the ENGINE'S OWN sui_session reducer — see the craft
// twin (craft_loot_read_your_write.test.js) for why the ambient handle cannot be trusted in a whole-suite run.
const engine_reduce = sui_session().reduce
const empty_state = () => ({
  sui: {
    items: [],
    characters: [],
    settled_item_floor: {},
    minted_character_floor: {},
    pending_uses: {},
    xp_floor: {},
    deleted_ids: {},
  },
})
let engine_state = empty_state()
const ambient = { dispatch: context.dispatch, get_state: context.get_state }
context.dispatch = (type, payload) => {
  engine_state = engine_reduce(engine_state, { type, payload }) ?? engine_state
}
context.get_state = () => engine_state
afterAll(() => {
  context.dispatch = ambient.dispatch
  context.get_state = ambient.get_state
})

const bag_ids = () => engine_state.sui.items.map((row) => row.id)

let spies = []

beforeEach(() => {
  engine_state = empty_state()
  reset_auth_mock({ address: OWNER, wallet_name: 'zklogin' })
  set_expedition_sdk_mock(async () => fake_sdk)
  spies = [
    spyOn(read_findables, 'get_template_map').mockResolvedValue(templates),
    spyOn(read_findables, 'get_template_by_item_type_map').mockResolvedValue(new Map()),
    spyOn(sdk_game, 'get_crush_registry').mockImplementation(() => async () => ({ by_key: new Map() })),
    spyOn(sdk_game, 'crush_ptb').mockImplementation(() => () => ({ fake: 'tx' })),
    spyOn(kiosk_resolve, 'kiosk_for_character').mockResolvedValue(character_handle),
    spyOn(tx_seam, 'run_tx_random').mockResolvedValue({ result: crush_receipt, timing: { digest: '0xcrush' } }),
    // THE POLL IS OFF. Nothing but the crush's own receipt may put the runes in the bag.
    spyOn(roster, 'load_roster').mockResolvedValue(undefined),
  ]
})

afterEach(() => {
  for (const test_spy of [...spies].reverse()) test_spy.mockRestore()
  spies = []
  reset_expedition_sdk_mock()
  reset_auth_mock()
  engine_state = empty_state()
})

describe('#2178 — the crush reads its own write', () => {
  test('the executed crush receipt paints the minted rune stack with NO poll tick', async () => {
    await crush_item({ item, character_id: '0xcharacter' })

    expect(bag_ids()).toContain(RUNE_ITEM)
    expect(engine_state.sui.items.find((row) => row.id === RUNE_ITEM)).toMatchObject({
      template_id: RUNE_TEMPLATE,
      name: 'Rune of Strength',
      item_category: 'resource',
      amount: 3,
      kiosk_id: character_handle.kiosk_id,
      kiosk_cap_id: character_handle.personal_kiosk_cap_id,
      stackable: true,
    })
  })

  // Idempotent re-entry: the authoritative read that eventually carries the same stack hands authority back to
  // the snapshot rather than stacking a second copy of the row the receipt already painted.
  test('a later authoritative snapshot carrying the same runes does not duplicate them', async () => {
    await crush_item({ item, character_id: '0xcharacter' })

    context.dispatch('action/sui_data', {
      kind: 'snapshot',
      items: [{ id: RUNE_ITEM, template_id: RUNE_TEMPLATE, item_type: 'rune_strength_1', amount: 3 }],
    })

    expect(bag_ids().filter((id) => id === RUNE_ITEM)).toHaveLength(1)
    expect(engine_state.sui.settled_item_floor[RUNE_ITEM]).toBeUndefined()
  })
})
