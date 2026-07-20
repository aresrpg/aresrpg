/// CONSUME-LINK tests: the game-side `character_link::consume_units` primitive the `aresrpg::consume` lane
/// calls — the burn-N-of-a-stack door. It composes ONLY public items doors + this package's custodied NS_BURN +
/// NS_MINT caps: extract the whole stack, BURN it, and (when it held more than `units`) RE-MINT the remainder and
/// re-lock it. These prove the DECLARED burn+remint mechanism (net-identical to `item::split`, which is items-
/// package-private): a partial consume leaves a locked remainder, a full consume leaves none, and the guards
/// (over-stack / zero / template-mismatch) fire. Runs against the REAL value paths on the `test_world` harness.
#[test_only]
module aresrpg_gifting::consume_link_tests;

use aresrpg::{config::GameConfig, extract::ItemExtractPolicy, item::{Item, ItemTemplate}, version::Version};
use aresrpg_gifting::{gift_world as test_world, gifting};
use kiosk::personal_kiosk::PersonalKioskCap;
use std::unit_test::assert_eq;
use sui::{kiosk::Kiosk, test_scenario::{Self as ts, Scenario}, transfer_policy::TransferPolicy};

// ── mirrored character_link error values (location disambiguates the aborting module) ──
const EConsumeTemplateMismatch: u64 = 106;
const EConsumeExceedsStack: u64 = 107;
const EZeroConsume: u64 = 108;

// ╔════════════════ [ Drivers ] ══════════════════════════════════════════════ ]

/// Burn `units` from the consumable stack `item_id` (template `template_id`) in `who`'s kiosk through
/// `consume_units`; returns the burned template id.
fun do_consume(sc: &mut Scenario, who: address, template_id: ID, item_id: ID, units: u64): ID {
  sc.next_tx(who);
  let tmpl = ts::take_shared_by_id<ItemTemplate>(sc, template_id);
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let xpol = sc.take_shared<ItemExtractPolicy>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let ver = sc.take_shared<Version>();
  let cfg = sc.take_shared<GameConfig>();
  let tid = gifting::burn_units(&cfg, &tmpl, units, item_id, &mut k, &pkcap, &xpol, &mkt, &ver, sc.ctx());
  ts::return_shared(tmpl); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(xpol); ts::return_shared(mkt); ts::return_shared(ver); ts::return_shared(cfg);
  tid
}

/// (is `item_id` still in `who`'s kiosk?, how many objects the kiosk holds) — the burn+remint probe.
fun kiosk_probe(sc: &mut Scenario, who: address, item_id: ID): (bool, u32) {
  sc.next_tx(who);
  let k = sc.take_shared<Kiosk>();
  let has = k.has_item(item_id);
  let count = k.item_count();
  ts::return_shared(k);
  (has, count)
}

/// Boot + a fresh character + a whitelisted consumable template; returns (cid, template_id).
fun setup(sc: &mut Scenario): (ID, ID) {
  test_world::boot(sc);
  let cid = test_world::mint_character(sc, test_world::owner());
  test_world::whitelist(sc, b"consumable");
  let tid = test_world::make_template(sc, b"Potion", b"potion", b"consumable", 1);
  (cid, tid)
}

// ╔════════════════ [ Partial consume — remainder re-minted + re-locked ] ═════ ]

#[test]
/// Consuming 3 of a 10-stack: the original stack is BURNED and a fresh 7-remainder is re-minted + re-locked, so
/// the kiosk still holds exactly {character, remainder} (2). The returned id is the burned template.
fun consume_partial_relocks_remainder() {
  let mut sc = ts::begin(test_world::owner());
  let (_cid, tid) = setup(&mut sc);
  let iid = test_world::mint_lock_stack(&mut sc, test_world::owner(), tid, 10);
  let burned = do_consume(&mut sc, test_world::owner(), tid, iid, 3);
  assert_eq!(burned, tid);
  let (has_original, count) = kiosk_probe(&mut sc, test_world::owner(), iid);
  assert!(!has_original); // the original 10-stack was burned
  assert_eq!(count, 2); // character + the re-minted 7-remainder
  sc.end();
}

#[test]
/// Consuming the WHOLE stack (10 of 10) burns it with NO re-mint: the kiosk drops to just {character} (1).
fun consume_full_stack_no_remainder() {
  let mut sc = ts::begin(test_world::owner());
  let (_cid, tid) = setup(&mut sc);
  let iid = test_world::mint_lock_stack(&mut sc, test_world::owner(), tid, 10);
  do_consume(&mut sc, test_world::owner(), tid, iid, 10);
  let (has_original, count) = kiosk_probe(&mut sc, test_world::owner(), iid);
  assert!(!has_original);
  assert_eq!(count, 1); // character only — no remainder minted
  sc.end();
}

// ╔════════════════ [ Guards ] ═══════════════════════════════════════════════ ]

#[test, expected_failure(abort_code = EConsumeExceedsStack, location = aresrpg_gifting::gifting)]
fun consume_exceeding_stack_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (_cid, tid) = setup(&mut sc);
  let iid = test_world::mint_lock_stack(&mut sc, test_world::owner(), tid, 10);
  do_consume(&mut sc, test_world::owner(), tid, iid, 11); // > stack → EConsumeExceedsStack
  abort
}

#[test, expected_failure(abort_code = EZeroConsume, location = aresrpg_gifting::gifting)]
fun consume_zero_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (_cid, tid) = setup(&mut sc);
  let iid = test_world::mint_lock_stack(&mut sc, test_world::owner(), tid, 10);
  do_consume(&mut sc, test_world::owner(), tid, iid, 0); // 0 → EZeroConsume
  abort
}

#[test, expected_failure(abort_code = EConsumeTemplateMismatch, location = aresrpg_gifting::gifting)]
/// Passing a DIFFERENT template than the extracted item's aborts — the remainder can only be re-minted as the same item.
fun consume_template_mismatch_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (_cid, tid_a) = setup(&mut sc);
  let tid_b = test_world::make_template(&mut sc, b"Elixir", b"elixir", b"consumable", 1);
  let iid = test_world::mint_lock_stack(&mut sc, test_world::owner(), tid_a, 10);
  do_consume(&mut sc, test_world::owner(), tid_b, iid, 3); // template B ≠ item's template A → mismatch
  abort
}
