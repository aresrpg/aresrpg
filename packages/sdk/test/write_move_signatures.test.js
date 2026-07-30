// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Every explicit Move target in src/sui/write is represented once here. Captured fixtures come from the
// deployed normalized module service; TODO fixtures are skipped until the capture command replaces them.

import { describe, expect, test } from 'bun:test'
import {
  readFileSync as read_file_sync,
  readdirSync as read_directory_sync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

import {
  MOVE_SIGNATURE_DOORS,
  MOVE_SIGNATURE_FIXTURE_PATHS,
} from '../scripts/move_signature_doors.mjs'
import { burn_mob_template_ptb, burn_sale_ptb } from '../src/sui/write/admin.js'
import {
  airdrop_add_addresses_ptb,
  airdrop_claim_ptb,
  airdrop_close_ptb,
  airdrop_create_ptb,
  airdrop_remove_addresses_ptb,
} from '../src/sui/write/airdrop.js'
import { delete_character_ptb } from '../src/sui/write/character_delete.js'
import {
  commission_accept_ptb,
  commission_cancel_ptb,
  commission_execute_ptb,
  commission_redeem_xp_ptb,
  commission_request_ptb,
} from '../src/sui/write/commission.js'
import { consume_potion_ptb } from '../src/sui/write/consume.js'
import { craft_ptb } from '../src/sui/write/craft.js'
import { abandon_ptb } from '../src/sui/write/dungeon_run.js'
import {
  gather_ptb,
  join_world_ptb,
  search_zone_ptb,
} from '../src/sui/write/game_world.js'
import {
  gift_claim_ptb,
  gift_recall_ptb,
  gift_send_ptb,
} from '../src/sui/write/gift.js'
import {
  merge_stack_ptb,
  split_stack_ptb,
} from '../src/sui/write/item_stacks.js'
import {
  create_character_free_ptb,
  create_character_paid_ptb,
} from '../src/sui/write/items_creation.js'
import {
  burn_ptb,
  equip_ptb,
  unequip_ptb,
} from '../src/sui/write/items_extract.js'
import {
  delist_ptb,
  list_ptb,
  marketplace_buy_character_ptb,
  marketplace_buy_item_ptb,
} from '../src/sui/write/items_marketplace.js'
import { buy_many_ptb, buy_ptb } from '../src/sui/write/items_shop.js'
import {
  cancel_ptb,
  create_friends_only_ptb,
  create_public_ptb,
  exit_ptb,
  join_ptb,
  sweep_ptb,
} from '../src/sui/write/kolizeum_lobby.js'
import { claim_pet_ptb, open_box_ptb } from '../src/sui/write/lootbox.js'
import {
  add_friend_ptb,
  create_friend_list_ptb,
  remove_friend_ptb,
} from '../src/sui/write/social_friends.js'

import { IDS, deployed_context, id } from './_onchain_fixtures.js'

const here = path.dirname(file_url_to_path(import.meta.url))
const fixture_directory = path.join(here, 'fixtures')
const fixtures = new Map(
  MOVE_SIGNATURE_DOORS.map(door => [
    door.id,
    JSON.parse(
      read_file_sync(path.join(fixture_directory, door.fixture), 'utf8'),
    ),
  ]),
)

const policy_fixture = kind => ({
  id: kind === 'item' ? IDS.aresrpg.ITEM_POLICY : IDS.aresrpg.CHARACTER_POLICY,
  rules: [
    `${id('base-rule')}::royalty_rule::Rule`,
    `${id('base-rule')}::kiosk_lock_rule::Rule`,
    `${id('personal-rule')}::personal_kiosk_rule::Rule`,
    ...(kind === 'item'
      ? [`${IDS.aresrpg.PACKAGE_ID}::item::ListingRule`]
      : [`${IDS.aresrpg.PACKAGE_ID}::character_listing_rule::Rule`]),
    ...(kind === 'item' ? [`${IDS.aresrpg.PACKAGE_ID}::item::LotRule`] : []),
  ],
})

const item_policy = policy_fixture('item')
const character_policy = policy_fixture('character')
const kiosk = {
  kiosk_id: id('kiosk'),
  personal_kiosk_cap_id: id('pkcap'),
}
const character = { ...kiosk, character_id: id('character') }

/** Build at least one real SDK composition containing every declared door. */
function composed_transactions() {
  const admin_cap_id = id('admin-cap')
  const airdrop_id = id('airdrop')
  const recipe_id = id('recipe')
  const request_id = id('request')
  const lobby = { kolizeum_id: id('lobby') }
  const seat = { ...character }
  const marketplace_buyer = {
    kiosk_id: id('buyer-kiosk'),
    personal_kiosk_cap_id: id('buyer-cap'),
    seller_kiosk_id: id('seller-kiosk'),
    price_mist: 5000n,
  }

  return [
    burn_mob_template_ptb(deployed_context)({
      admin_cap_id,
      mob_template_id: id('mob-template'),
    }),
    burn_sale_ptb(deployed_context)({ admin_cap_id, sale_id: id('sale') }),
    airdrop_claim_ptb(deployed_context)({
      ...kiosk,
      airdrop_id,
      template_id: id('template'),
    }),
    airdrop_create_ptb(deployed_context)({
      admin_cap_id,
      template_id: id('template'),
      name: 'Signature fixture',
    }),
    airdrop_add_addresses_ptb(deployed_context)({
      admin_cap_id,
      airdrop_id,
      addresses: [id('eligible')],
    }),
    airdrop_remove_addresses_ptb(deployed_context)({
      admin_cap_id,
      airdrop_id,
      addresses: [id('eligible')],
    }),
    airdrop_close_ptb(deployed_context)({ admin_cap_id, airdrop_id }),
    delete_character_ptb({
      ...deployed_context,
      network: 'localnet',
    })(character),
    commission_request_ptb(deployed_context)({
      artisan: id('artisan'),
      recipe_id,
      amount_mist: 5000n,
    }),
    commission_accept_ptb(deployed_context)({
      request_id,
      recipe_id,
      artisan_kiosk_id: id('artisan-kiosk'),
      personal_kiosk_cap_id: id('artisan-cap'),
      character_id: id('artisan-character'),
    }),
    commission_execute_ptb(deployed_context)({
      ...kiosk,
      request_id,
      recipe_id,
      input_item_ids: [id('ingredient')],
      output_template_id: id('output-template'),
    }),
    commission_cancel_ptb(deployed_context)({ request_id }),
    commission_redeem_xp_ptb(deployed_context)({
      ...kiosk,
      voucher_id: id('voucher'),
    }),
    consume_potion_ptb(deployed_context)({
      ...character,
      item_id: id('potion'),
      template_id: id('potion-template'),
      quantity: 2,
    }),
    craft_ptb(deployed_context)({
      ...character,
      recipe_id,
      input_item_ids: [id('ingredient')],
      output_template_id: id('output-template'),
    }),
    abandon_ptb(deployed_context)({ ...kiosk, run_pass_id: id('run-pass') }),
    join_world_ptb(deployed_context)({
      ...character,
      world_id: id('world'),
    }),
    search_zone_ptb(deployed_context)({
      ...character,
      world_id: id('world'),
      x: 1,
      z: 2,
    }),
    gather_ptb(deployed_context)({
      ...character,
      world_id: id('world'),
      zx: 1,
      zy: 2,
      node_index: 3,
      template_id: id('resource-template'),
      protector_template_id: id('protector-template'),
    }),
    gift_send_ptb(deployed_context)({
      ...kiosk,
      recipient: id('recipient'),
      item_transfers: [
        { item_id: id('partial'), amount: 1, available_amount: 2 },
        { item_id: id('whole'), amount: 1, available_amount: 1 },
      ],
    }),
    gift_claim_ptb(deployed_context)({
      gift_id: id('gift'),
      sender_kiosk_id: id('sender-kiosk'),
      recipient_kiosk_id: id('recipient-kiosk'),
      personal_kiosk_cap_id: id('recipient-cap'),
    }),
    gift_recall_ptb(deployed_context)({
      gift_id: id('gift'),
      sender_kiosk_id: id('sender-kiosk'),
    }),
    split_stack_ptb(deployed_context)({
      ...kiosk,
      item_id: id('stack'),
      amount: 1,
    }),
    merge_stack_ptb(deployed_context)({
      ...kiosk,
      target_item_id: id('stack-target'),
      source_item_id: id('stack-source'),
    }),
    create_character_free_ptb(deployed_context)({
      ...kiosk,
      name: 'fixture-free',
      class: 'senshi',
      address_seed: 1n,
      world_id: id('world'),
    }),
    create_character_paid_ptb(deployed_context)({
      ...kiosk,
      name: 'fixture-paid',
      class: 'senshi',
      price_mist: 1n,
      world_id: id('world'),
    }),
    equip_ptb(deployed_context)({
      ...character,
      item_id: id('equipment'),
      item_template_id: id('equipment-template'),
    }),
    unequip_ptb(deployed_context)({
      ...character,
      item_key_id: id('equipment'),
    }),
    burn_ptb(deployed_context)({ ...kiosk, item_id: id('burn-item') }),
    buy_ptb(deployed_context)({
      ...kiosk,
      sale_id: id('shop-sale'),
      template_id: id('shop-template'),
      price_mist: 1n,
    }),
    buy_many_ptb(deployed_context)({
      ...kiosk,
      sale_id: id('shop-sale'),
      template_id: id('shop-template'),
      price_mist: 1n,
      quantity: 2,
    }),
    create_friend_list_ptb(deployed_context)(),
    add_friend_ptb(deployed_context)({
      friend_list_id: id('friend-list'),
      addr: id('friend'),
    }),
    remove_friend_ptb(deployed_context)({
      friend_list_id: id('friend-list'),
      addr: id('friend'),
    }),
    open_box_ptb(deployed_context)({
      ...kiosk,
      box_id: id('box'),
      box_template_id: id('box-template'),
    }),
    claim_pet_ptb(deployed_context)({
      ...kiosk,
      claim_id: id('claim'),
      rolled_template_id: id('pet-template'),
    }),
    create_public_ptb(deployed_context)({
      ...seat,
      format_slots: 3,
      pledge_amount: 1000,
      max_level_diff: 20,
    }),
    create_friends_only_ptb(deployed_context)({
      ...seat,
      friend_list_id: id('friend-list'),
      format_slots: 3,
      pledge_amount: 1000,
      max_level_diff: 20,
    }),
    join_ptb(deployed_context)({
      ...seat,
      ...lobby,
      pledge_amount: 1000,
    }),
    exit_ptb(deployed_context)(lobby),
    cancel_ptb(deployed_context)(lobby),
    sweep_ptb(deployed_context)(lobby),
    list_ptb(deployed_context)({
      ...kiosk,
      item_id: id('listed-item'),
      price_mist: 5000n,
      policy: item_policy,
    }),
    delist_ptb(deployed_context)({
      ...kiosk,
      item_id: id('listed-item'),
      policy: item_policy,
    }),
    marketplace_buy_item_ptb(deployed_context)({
      ...marketplace_buyer,
      item_id: id('listed-item'),
      policy: item_policy,
    }),
    marketplace_buy_character_ptb(deployed_context)({
      ...marketplace_buyer,
      character_id: id('listed-character'),
      policy: character_policy,
    }),
  ]
}

function move_calls(transaction) {
  return transaction
    .getData()
    .commands.filter(command => command.$kind === 'MoveCall')
    .map(command => ({
      transaction,
      call: command.MoveCall,
      target: `${command.MoveCall.module}::${command.MoveCall.function}`,
    }))
}

let cached_calls
const all_composed_calls = () =>
  (cached_calls ??= composed_transactions().flatMap(move_calls))

function source_door_ids() {
  const write_directory = path.join(here, '../src/sui/write')
  const found = new Set()
  let sites = 0
  for (const file of read_directory_sync(write_directory).filter(name =>
    name.endsWith('.js'),
  )) {
    const source = read_file_sync(path.join(write_directory, file), 'utf8')
    for (const match of source.matchAll(/target:\s*(?:'([^']+)'|`([^`]+)`)/g)) {
      sites += 1
      const expression = match[1] ?? match[2]
      if (expression.includes('listing_rule_module')) {
        found.add('item::prove_listing_amount')
        found.add('character_listing_rule::prove_level')
        continue
      }
      const tail = expression.match(/::([a-z0-9_]+)::([a-z0-9_]+)$/)
      if (!tail)
        throw new Error(
          `[write signature census] cannot resolve ${file} target ${expression}`,
        )
      found.add(`${tail[1]}::${tail[2]}`)
    }
  }
  return { sites, doors: [...found].sort() }
}

function composed_arg_kind(transaction, argument) {
  if (argument?.$kind === 'Result' || argument?.$kind === 'NestedResult')
    return 'result'
  if (argument?.$kind !== 'Input') return String(argument?.$kind)
  return transaction.getData().inputs[argument.Input]?.Pure ? 'pure' : 'object'
}

describe('deployed Move signatures — every SDK write door', () => {
  test('census is 71 call sites / 65 distinct doors, with a real composed sample and fixture for each', () => {
    const census = source_door_ids()
    const declared = MOVE_SIGNATURE_DOORS.map(
      ({ id: door_id }) => door_id,
    ).sort()
    expect(census.sites).toBe(71)
    expect(census.doors).toEqual(declared)
    expect(new Set(MOVE_SIGNATURE_FIXTURE_PATHS).size).toBe(65)

    const composed = new Set(all_composed_calls().map(({ target }) => target))
    expect(declared.filter(door_id => !composed.has(door_id))).toEqual([])
  })

  for (const door of MOVE_SIGNATURE_DOORS) {
    const fixture = fixtures.get(door.id)
    // The original craft capture predates the sweep's explicit status/target/package fields; provenance makes it
    // captured. Keeping that evidence byte-for-byte also preserves the fixture-adjudication boundary.
    const is_captured = fixture.status === 'captured' || fixture.provenance
    test.skipIf(!is_captured)(
      `[${door.id}] composed PTB matches deployed argument shape`,
      () => {
        if (fixture.target) expect(fixture.target).toBe(door.id)
        if (fixture.package) expect(fixture.package).toBe(door.package)
        const sample = all_composed_calls().find(
          ({ target }) => target === door.id,
        )
        if (!sample) throw new Error(`[${door.id}] has no composed SDK sample`)

        const expected = fixture.ptb_arg_kinds
        const actual = sample.call.arguments.map(argument =>
          composed_arg_kind(sample.transaction, argument),
        )
        if (actual.length !== expected.length)
          throw new Error(
            `[${door.id}] divergent arg count: deployed=${expected.length}, composed=${actual.length}`,
          )
        for (let index = 0; index < expected.length; index += 1) {
          // A prior Move-call result is statically typed by that call, and a generic parameter admits either kind.
          if (
            actual[index] !== 'result' &&
            expected[index] !== 'generic' &&
            actual[index] !== expected[index]
          )
            throw new Error(
              `[${door.id}] divergent arg ${index}: deployed=${expected[index]}, composed=${actual[index]}`,
            )
        }
      },
    )
  }
})
