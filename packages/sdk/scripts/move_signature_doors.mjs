// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The complete set of distinct Move targets explicitly composed by src/sui/write/*.js.
//
// `package` is a release.json package key, `rules` is the stamped kiosk-rule linkage package, and the two
// framework selectors are protocol packages. Keep this table in target order: capture, the fixture gate, and
// the human-readable census all share it.

const door = (package_selector, module, function_name) => ({
  id: `${module}::${function_name}`,
  package: package_selector,
  module,
  function: function_name,
  fixture: `${module}_${function_name}_signature.json`,
})

export const MOVE_SIGNATURE_DOORS = Object.freeze([
  door('rules', 'personal_kiosk', 'borrow_val'),
  door('rules', 'personal_kiosk', 'return_val'),
  door('gifting', 'consume', 'use_many'),
  door('aresrpg', 'extract', 'split_locked_stack'),
  door('aresrpg', 'extract', 'merge_locked_stacks_and_relock'),
  door('aresrpg', 'shop', 'buy'),
  door('aresrpg', 'shop', 'buy_many'),
  door('aresrpg', 'commission', 'request'),
  door('aresrpg', 'commission', 'accept'),
  door('aresrpg', 'commission', 'execute'),
  door('aresrpg', 'commission', 'cancel'),
  door('aresrpg', 'commission', 'redeem_craft_xp'),
  door('aresrpg', 'character', 'new_customization'),
  door('gifting', 'creation', 'create_character_free'),
  door('aresrpg', 'character', 'lock_in_kiosk'),
  door('gifting', 'creation', 'create_character_paid'),
  door('social', 'friends', 'create_friend_list'),
  door('social', 'friends', 'add_friend'),
  door('social', 'friends', 'remove_friend'),
  door('aresrpg', 'mob_template', 'burn_mob_template'),
  door('aresrpg', 'shop', 'burn_sale'),
  door('aresrpg', 'character_extract', 'delete_character'),
  door('gifting', 'airdrop', 'claim'),
  door('gifting', 'airdrop', 'admin_create'),
  door('gifting', 'airdrop', 'admin_add_addresses'),
  door('gifting', 'airdrop', 'admin_remove_addresses'),
  door('gifting', 'airdrop', 'admin_close'),
  door('dungeon', 'dungeon', 'abandon'),
  door('aresrpg', 'crafting', 'craft'),
  door('aresrpg', 'extract', 'extract_for_equip'),
  door('aresrpg', 'equipment', 'equip'),
  door('aresrpg', 'equipment', 'unequip'),
  door('aresrpg', 'item', 'lock_in_kiosk'),
  door('aresrpg', 'extract', 'extract_for_burn'),
  door('aresrpg', 'extract', 'burn'),
  door('move_stdlib', 'vector', 'singleton'),
  door('move_stdlib', 'vector', 'push_back'),
  door('gifting', 'gift', 'send'),
  door('gifting', 'gift', 'claim'),
  door('gifting', 'gift', 'recall'),
  door('gifting', 'loot_box', 'open_box'),
  door('gifting', 'loot_box', 'claim_pet'),
  door('aresrpg', 'zones', 'join_world'),
  door('aresrpg', 'zones', 'search_zone'),
  door('aresrpg', 'gathering', 'gather'),
  door('sui_framework', 'kiosk', 'borrow_val'),
  door('sui_framework', 'kiosk', 'return_val'),
  door('kolizeum', 'kolizeum', 'create_public'),
  door('kolizeum', 'kolizeum', 'create_friends_only'),
  door('kolizeum', 'kolizeum', 'join'),
  door('kolizeum', 'kolizeum', 'exit'),
  door('kolizeum', 'kolizeum', 'cancel'),
  door('kolizeum', 'kolizeum', 'sweep'),
  door('sui_framework', 'kiosk', 'list'),
  door('sui_framework', 'kiosk', 'delist'),
  door('aresrpg', 'header', 'aresrpg'),
  door('rules', 'royalty_rule', 'fee_amount'),
  door('rules', 'royalty_rule', 'pay'),
  door('aresrpg', 'item', 'prove_listing_amount'),
  door('aresrpg', 'character_listing_rule', 'prove_level'),
  door('aresrpg', 'item', 'prove_lot'),
  door('rules', 'kiosk_lock_rule', 'prove'),
  door('rules', 'personal_kiosk_rule', 'prove'),
  door('sui_framework', 'transfer_policy', 'confirm_request'),
])

const duplicate = MOVE_SIGNATURE_DOORS.find(
  (entry, index, all) => all.findIndex(other => other.id === entry.id) !== index,
)
if (duplicate)
  throw new Error(`[move_signature_doors] duplicate target ${duplicate.id}`)

export const MOVE_SIGNATURE_FIXTURE_PATHS = MOVE_SIGNATURE_DOORS.map(
  ({ fixture }) => `packages/sdk/test/fixtures/${fixture}`,
)
