// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE COMPOSED CORPUS — at least one real SDK-composed PTB for every write door, built offline through the
// deployment override seam (_onchain_fixtures.js). One home, two readers: write_move_signatures.test.js pins
// the Move signatures of every call in it, and api/sponsor.command_graph.test.js pins that the sponsor's
// command-graph check accepts every shape the game actually emits — so a composer that starts emitting a new
// command kind is caught by the money path's own test instead of discovering it in production.

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
  onboard_kiosk_ptb,
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
export function composed_transactions() {
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
    // LAST on purpose: the kiosk-less onboarding tx declares no explicit `target:` of its own (its calls come
    // from KioskTransaction), so it adds no door to the census — it is here because it is the first PTB a
    // brand-new account ever signs, and the sponsor's command-graph test needs that shape in the corpus.
    onboard_kiosk_ptb(deployed_context)(),
  ]
}
