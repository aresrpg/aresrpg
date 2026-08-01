// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The additive staged crush door: its ability-less `RuneMint` must land every committed template in order,
/// close completely, preserve the legacy missing-template audit, and mint the exact legacy result for one seed.
#[test_only]
module aresrpg_forgemagie::crush_builder_tests;

use aresrpg::{
  admin::AdminCap,
  config::GameConfig,
  extract::ItemExtractPolicy,
  item::{Item, ItemTemplate},
  item_stats::{Self, ItemStatistics},
  version::Version,
};
use aresrpg_forgemagie::{forge_world as test_world, forgemagie::{Self, CrushBoard}};
use kiosk::personal_kiosk::PersonalKioskCap;
use std::unit_test::assert_eq;
use sui::{kiosk::Kiosk, test_scenario::{Self as ts, Scenario}, transfer_policy::TransferPolicy};

const OWNER: address = @0xA;
const SHIFT: u16 = 32_768;
const STR: u8 = 2;
const TIER_BA: u8 = 1;
const TIER_PA: u8 = 2;
const TIER_RA: u8 = 3;

const EMissingTemplate: u64 = 109;
const EWrongRuneTemplate: u64 = 115;
const EPartialRuneRoster: u64 = 116;

fun uniform(v: u16): ItemStatistics {
  item_stats::new(v, v, v, v, v, v, v, v, v, v, v, v, v, v, v, v, v)
}

/// Core world + one max-strength L50 gear template + the three strength-rune tiers on two identical fresh boards.
fun stage(sc: &mut Scenario): (ID, ID, ID, ID, ID, ID, ID) {
  test_world::boot(sc);
  let cid = test_world::mint_character(sc, OWNER);
  test_world::whitelist(sc, b"sword");
  test_world::whitelist(sc, b"rune");
  let s = SHIFT;
  let max = item_stats::new(s, s, s + 50, s, s, s, s, s, s, s, s, s, s, s, s, s, s);
  let sword = test_world::make_template_ranged(sc, b"Blade", b"blade", b"sword", 50, uniform(s), max);
  let ba = test_world::make_template(sc, b"Rune Fo", b"rune_fo", b"rune", 1);
  let pa = test_world::make_template(sc, b"Rune Pa Fo", b"rune_pa_fo", b"rune", 1);
  let ra = test_world::make_template(sc, b"Rune Ra Fo", b"rune_ra_fo", b"rune", 1);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let board_a = forgemagie::create_board_id_for_testing(sc.ctx());
  let board_b = forgemagie::create_board_id_for_testing(sc.ctx());
  sc.next_tx(OWNER);
  let mut a = ts::take_shared_by_id<CrushBoard>(sc, board_a);
  let mut b = ts::take_shared_by_id<CrushBoard>(sc, board_b);
  forgemagie::register_rune(&cap, &mut a, ba, STR, TIER_BA, &ver, sc.ctx());
  forgemagie::register_rune(&cap, &mut a, pa, STR, TIER_PA, &ver, sc.ctx());
  forgemagie::register_rune(&cap, &mut a, ra, STR, TIER_RA, &ver, sc.ctx());
  forgemagie::register_rune(&cap, &mut b, ba, STR, TIER_BA, &ver, sc.ctx());
  forgemagie::register_rune(&cap, &mut b, pa, STR, TIER_PA, &ver, sc.ctx());
  forgemagie::register_rune(&cap, &mut b, ra, STR, TIER_RA, &ver, sc.ctx());
  ts::return_shared(a);
  ts::return_shared(b);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  (cid, sword, ba, pa, ra, board_a, board_b)
}

fun maxed_gear(sc: &mut Scenario, sword: ID): ID {
  let gear = test_world::mint_lock_gear(sc, OWNER, sword);
  sc.next_tx(OWNER);
  let cfg = sc.take_shared<GameConfig>();
  let mut kiosk = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let s = SHIFT;
  let rolled = item_stats::new(s, s, s + 50, s, s, s, s, s, s, s, s, s, s, s, s, s, s);
  forgemagie::set_rolled_for_testing(&cfg, &mut kiosk, &pkcap, gear, rolled);
  ts::return_shared(cfg);
  ts::return_shared(kiosk);
  sc.return_to_sender(pkcap);
  gear
}

fun kiosk_count(sc: &mut Scenario): u32 {
  sc.next_tx(OWNER);
  let kiosk = sc.take_shared<Kiosk>();
  let count = kiosk.item_count();
  ts::return_shared(kiosk);
  count
}

fun legacy_result(
  sc: &mut Scenario,
  board_id: ID,
  cid: ID,
  sword: ID,
  gear: ID,
  ba: ID,
  pa: ID,
  ra: ID,
  seed: u64,
): vector<u64> {
  sc.next_tx(OWNER);
  let mut board = ts::take_shared_by_id<CrushBoard>(sc, board_id);
  let mut kiosk = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let gear_template = ts::take_shared_by_id<ItemTemplate>(sc, sword);
  let t_ba = ts::take_shared_by_id<ItemTemplate>(sc, ba);
  let t_pa = ts::take_shared_by_id<ItemTemplate>(sc, pa);
  let t_ra = ts::take_shared_by_id<ItemTemplate>(sc, ra);
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let policy = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let rolled = forgemagie::crush_for_testing(
    &mut board, &mut kiosk, &pkcap, cid, &gear_template, vector[gear],
    &t_ba, &t_pa, &t_ra, &gear_template, &xpolicy, &policy, &cfg, &ver, seed, sc.ctx(),
  );
  ts::return_shared(board);
  ts::return_shared(kiosk);
  sc.return_to_sender(pkcap);
  ts::return_shared(gear_template);
  ts::return_shared(t_ba);
  ts::return_shared(t_pa);
  ts::return_shared(t_ra);
  ts::return_shared(xpolicy);
  ts::return_shared(policy);
  ts::return_shared(cfg);
  ts::return_shared(ver);
  rolled
}

fun staged_result(
  sc: &mut Scenario,
  board_id: ID,
  cid: ID,
  sword: ID,
  gear: ID,
  ba: ID,
  pa: ID,
  ra: ID,
  seed: u64,
): vector<u64> {
  sc.next_tx(OWNER);
  let mut board = ts::take_shared_by_id<CrushBoard>(sc, board_id);
  let mut kiosk = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let gear_template = ts::take_shared_by_id<ItemTemplate>(sc, sword);
  let t_ba = ts::take_shared_by_id<ItemTemplate>(sc, ba);
  let t_pa = ts::take_shared_by_id<ItemTemplate>(sc, pa);
  let t_ra = ts::take_shared_by_id<ItemTemplate>(sc, ra);
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let policy = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut mint = forgemagie::open_crush(vector[ba, pa, ra, sword]);
  forgemagie::add_rune_template(&mut mint, &t_ba);
  forgemagie::add_rune_template(&mut mint, &t_pa);
  forgemagie::add_rune_template(&mut mint, &t_ra);
  forgemagie::add_rune_template(&mut mint, &gear_template);
  let rolled = forgemagie::close_crush_for_testing(
    mint, &mut board, &mut kiosk, &pkcap, cid, &gear_template, vector[gear],
    &xpolicy, &policy, &cfg, &ver, seed, sc.ctx(),
  );
  ts::return_shared(board);
  ts::return_shared(kiosk);
  sc.return_to_sender(pkcap);
  ts::return_shared(gear_template);
  ts::return_shared(t_ba);
  ts::return_shared(t_pa);
  ts::return_shared(t_ra);
  ts::return_shared(xpolicy);
  ts::return_shared(policy);
  ts::return_shared(cfg);
  ts::return_shared(ver);
  rolled
}

#[test]
/// Same seed, fresh identical state: owed rows and the kiosk object-count delta are exactly the legacy path's.
/// Both paths mint through `item::mint_stack_snapshot`, so matching owed quantities also pins item/event fields.
fun staged_crush_mints_identical_legacy_results() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword, ba, pa, ra, board_a, board_b) = stage(&mut sc);
  let legacy_gear = maxed_gear(&mut sc, sword);
  let staged_gear = maxed_gear(&mut sc, sword);
  let before = kiosk_count(&mut sc);
  let legacy = legacy_result(&mut sc, board_a, cid, sword, legacy_gear, ba, pa, ra, 7);
  let after_legacy = kiosk_count(&mut sc);
  let staged = staged_result(&mut sc, board_b, cid, sword, staged_gear, ba, pa, ra, 7);
  let after_staged = kiosk_count(&mut sc);
  assert_eq!(staged, legacy);
  assert_eq!(after_legacy + 1 - before, after_staged + 1 - after_legacy);
  sc.end();
}

#[test, expected_failure(abort_code = EWrongRuneTemplate, location = aresrpg_forgemagie::forgemagie)]
/// The commitment is positional: adding Pa where slot zero committed Ba aborts before the roll.
fun swapping_committed_template_slots_aborts() {
  let mut sc = ts::begin(OWNER);
  let (_cid, _sword, ba, pa, _ra, _board_a, _board_b) = stage(&mut sc);
  sc.next_tx(OWNER);
  let t_pa = ts::take_shared_by_id<ItemTemplate>(&sc, pa);
  let mut mint = forgemagie::open_crush(vector[ba, pa]);
  forgemagie::add_rune_template(&mut mint, &t_pa);
  abort
}

#[test, expected_failure(abort_code = EPartialRuneRoster, location = aresrpg_forgemagie::forgemagie)]
/// The hot potato cannot close short: every committed template must have landed.
fun closing_with_unlanded_commitment_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword, ba, pa, _ra, board_id, _other_board) = stage(&mut sc);
  let gear = maxed_gear(&mut sc, sword);
  sc.next_tx(OWNER);
  let mut board = ts::take_shared_by_id<CrushBoard>(&sc, board_id);
  let mut kiosk = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let gear_template = ts::take_shared_by_id<ItemTemplate>(&sc, sword);
  let t_ba = ts::take_shared_by_id<ItemTemplate>(&sc, ba);
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let policy = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut mint = forgemagie::open_crush(vector[ba, pa]);
  forgemagie::add_rune_template(&mut mint, &t_ba);
  forgemagie::close_crush_for_testing(
    mint, &mut board, &mut kiosk, &pkcap, cid, &gear_template, vector[gear],
    &xpolicy, &policy, &cfg, &ver, 7, sc.ctx(),
  );
  abort
}

#[test, expected_failure(abort_code = EMissingTemplate, location = aresrpg_forgemagie::forgemagie)]
/// A complete commitment can still omit the yielded rune set; the unchanged owed-empty audit reverts the crush.
fun leftover_owed_row_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword, _ba, _pa, _ra, board_id, _other_board) = stage(&mut sc);
  let gear = maxed_gear(&mut sc, sword); // +50 Fo guarantees at least one owed rune
  sc.next_tx(OWNER);
  let mut board = ts::take_shared_by_id<CrushBoard>(&sc, board_id);
  let mut kiosk = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let gear_template = ts::take_shared_by_id<ItemTemplate>(&sc, sword);
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let policy = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut mint = forgemagie::open_crush(vector[sword]);
  forgemagie::add_rune_template(&mut mint, &gear_template); // unregistered filler: zeroes no owed row
  forgemagie::close_crush_for_testing(
    mint, &mut board, &mut kiosk, &pkcap, cid, &gear_template, vector[gear],
    &xpolicy, &policy, &cfg, &ver, 7, sc.ctx(),
  );
  abort
}

// ╔════════════════ [ Batch bound — the caller-supplied gear list ] ══════════ ]

const EBatchTooLarge: u64 = 117;

#[test, expected_failure(abort_code = EBatchTooLarge, location = forgemagie)]
/// UNBOUNDED BATCH (audit class 4): `gear_ids` had no length cap, so one fixed-price crush door looped an
/// arbitrarily long caller-supplied list — an extract, a stat roll, a burn and a coefficient decay EACH. 51
/// unrolled gear items (one over the cap, and stat-less so nothing is owed and the mint walk stays clean)
/// must be refused at the door instead of driving the loop.
fun crush_over_the_batch_cap_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, sword, ba, pa, ra, board_a, _board_b) = stage(&mut sc);

  let mut gear = vector[];
  let mut i = 0;
  while (i < 51) { gear.push_back(test_world::mint_lock_gear(&mut sc, OWNER, sword)); i = i + 1; };

  sc.next_tx(OWNER);
  let mut board = ts::take_shared_by_id<CrushBoard>(&sc, board_a);
  let mut kiosk = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let gear_template = ts::take_shared_by_id<ItemTemplate>(&sc, sword);
  let t_ba = ts::take_shared_by_id<ItemTemplate>(&sc, ba);
  let t_pa = ts::take_shared_by_id<ItemTemplate>(&sc, pa);
  let t_ra = ts::take_shared_by_id<ItemTemplate>(&sc, ra);
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let policy = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  forgemagie::crush_for_testing(
    &mut board, &mut kiosk, &pkcap, cid, &gear_template, gear,
    &t_ba, &t_pa, &t_ra, &gear_template, &xpolicy, &policy, &cfg, &ver, 7, sc.ctx(),
  ); // EBatchTooLarge
  abort
}
