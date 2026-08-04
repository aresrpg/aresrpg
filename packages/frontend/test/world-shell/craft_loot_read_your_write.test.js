// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2178 (D51 read-your-write, 5th instance) — CRAFTED loot needed a page refresh to appear.
//
// The fight-outcome claim and the loot-box pet claim already re-enter the ONE inventory reducer door
// (loot_inventory_effect.js `reduce_minted_receipt` — #265/#1488/#1212). CRAFT did not: `craft_item` held the
// executed receipt, read only the `crafting::Crafted` roll verdict off it, and handed the BAG nothing but
// `load_roster()` — the chain/indexer round-trip, and the inventory's ONLY reconciliation door (there is no
// poll). So the crafted output was invisible until that round-trip landed, or until a manual page refresh.
//
// PROVENANCE. The receipts here are the REAL captured craft receipt
// (`test/fixtures/craft_receipt_failed_roll.json`, testnet digest GBZrteiekUsVD89MovE7usxcTHTHCarPZvF4cuvcm1rY
// — see its own `_provenance`). The failed-roll case uses it verbatim. The success case is that same captured
// event stream with the one arm a passing roll adds: `item::ItemMinted`, emitted inside `crafting::y19` →
// `character_link::y10` → `extension::y29` → `item::mint` (move/aresrpg/sources/item.move:121 the struct,
// :243 the emit) BEFORE `crafting::Crafted` (crafting.move:294 then :300) — field names and value types as
// the struct declares them (`amount: u64` arrives as a decimal string, exactly like the captured
// `ItemBurned.amount`).

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { reset_auth_mock } from '../../src/test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'
import captured_failed_roll from '../fixtures/craft_receipt_failed_roll.json'

const OWNER = '0xowner'
const OUTPUT_ITEM = '0xcrafted-item'
const OUTPUT_TEMPLATE = '0xoutput-template'

const character_handle = { kiosk_id: '0xcharacter-kiosk', personal_kiosk_cap_id: '0xcharacter-cap' }
const in_character_kiosk = (row) => ({
  ...row,
  kiosk_id: character_handle.kiosk_id,
  kiosk_cap_id: character_handle.personal_kiosk_cap_id,
})

const bag = [
  in_character_kiosk({ id: '0xore', item_type: 'iron_ore', amount: 2 }),
  in_character_kiosk({ id: '0xwood', item_type: 'oak_wood', amount: 1 }),
]

const recipe = {
  recipe_id: '0xrecipe',
  output_template_id: OUTPUT_TEMPLATE,
  ingredients: [
    { id: 'iron_ore', qty: 2 },
    { id: 'oak_wood', qty: 1 },
  ],
}

/** The captured receipt's kiosk/split/burn stream, with the roll verdict stripped off the tail. */
const burn_stream = captured_failed_roll.events.filter((event) => !event.type.endsWith('::crafting::Crafted'))

/** The captured stream + the two arms a PASSING roll adds, in the order crafting.move emits them. */
const crafted_receipt = {
  digest: captured_failed_roll.digest,
  effects: captured_failed_roll.effects,
  events: [
    ...burn_stream,
    {
      type: '0xaresrpg-package::item::ItemMinted',
      parsedJson: { item: OUTPUT_ITEM, template: OUTPUT_TEMPLATE, item_type: 'iron_sword', amount: '1' },
    },
    {
      type: '0xaresrpg-package::crafting::Crafted',
      parsedJson: { success: true, output_quantity: '1', job_xp_gained: '10' },
    },
  ],
}

const templates = new Map([
  [OUTPUT_TEMPLATE, { name: 'Iron Sword', item_type: 'iron_sword', category: 'WEAPON', level: 12 }],
])

const fake_tx = { fake: 'craft-tx' }
const fake_sdk = { craft_ptb: () => fake_tx }

const kiosk_resolve = await import('../../src/world-shell/kiosk_resolve.js')
const tx_seam = await import('../../src/world-shell/tx.js')
const roster = await import('../../src/roster/load_roster.js')
const findables = await import('../../src/chain/read_findables.js')
const { context } = await import('../../src/game/core/game.js')
const { craft_item } = await import('../../src/world-shell/craft_actions.js')

const bag_ids = () => context.get_state().sui.items.map((item) => item.id)
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const craft = () => craft_item({ recipe, items: bag, character_id: '0xcharacter' })

let spies = []
let submit

beforeEach(() => {
  context.dispatch('action/sui_logout') // the one door that empties the bag AND its receipt floor
  reset_auth_mock({ address: OWNER, wallet_name: 'zklogin' })
  set_expedition_sdk_mock(async () => fake_sdk)
  submit = spyOn(tx_seam, 'run_tx').mockResolvedValue({ result: crafted_receipt })
  spies = [
    spyOn(kiosk_resolve, 'kiosk_for_character').mockResolvedValue(character_handle),
    submit,
    // THE POLL IS OFF. Nothing but the craft's own receipt may put the output in the bag.
    spyOn(roster, 'load_roster').mockResolvedValue(undefined),
    spyOn(findables, 'get_template_map').mockResolvedValue(templates),
  ]
})

afterEach(async () => {
  for (const test_spy of [...spies].reverse()) test_spy.mockRestore()
  spies = []
  reset_expedition_sdk_mock()
  reset_auth_mock()
  await settle()
  context.dispatch('action/sui_logout')
})

describe('#2178 — the craft reads its own write', () => {
  test('the executed craft receipt paints the minted output with NO poll tick', async () => {
    await expect(craft()).resolves.toEqual({ outcome: 'success', quantity: 1 })
    await settle()

    expect(bag_ids()).toContain(OUTPUT_ITEM)
    expect(context.get_state().sui.items.find((item) => item.id === OUTPUT_ITEM)).toMatchObject({
      template_id: OUTPUT_TEMPLATE,
      name: 'Iron Sword',
      item_category: 'weapon',
      amount: 1,
      kiosk_id: character_handle.kiosk_id,
      kiosk_cap_id: character_handle.personal_kiosk_cap_id,
    })
  })

  // THE MERGE LAW (idempotent re-entry): the authoritative read that eventually carries the same object hands
  // authority back to the snapshot — it never stacks a second copy of the row the receipt already painted.
  test('a later authoritative snapshot carrying the same loot does not duplicate it', async () => {
    await craft()
    await settle()

    context.dispatch('action/sui_data', {
      kind: 'snapshot',
      items: [
        ...bag,
        { id: OUTPUT_ITEM, template_id: OUTPUT_TEMPLATE, item_type: 'iron_sword', amount: 1, item_category: 'weapon' },
      ],
    })
    await settle()

    expect(bag_ids().filter((id) => id === OUTPUT_ITEM)).toHaveLength(1)
    expect(context.get_state().sui.settled_item_floor[OUTPUT_ITEM]).toBeUndefined() // presence drains the floor
  })

  // A failed roll burns the ingredients and mints NOTHING. The captured receipt carries no ItemMinted, so the
  // door is a no-op BY CONSTRUCTION — never a second "did the roll pass" branch at the call site.
  test('the captured failed-roll receipt paints no phantom row', async () => {
    submit.mockResolvedValue({ result: captured_failed_roll })

    await expect(craft()).resolves.toEqual({ outcome: 'failure', quantity: 0 })
    await settle()

    expect(bag_ids()).toEqual([])
    expect(context.get_state().sui.settled_item_floor).toEqual({})
  })
})
