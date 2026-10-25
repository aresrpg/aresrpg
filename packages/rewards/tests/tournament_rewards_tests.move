// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_rewards::tournament_rewards_tests;
use aresrpg_rewards::tournament_rewards as funds;
use sui::{coin, sui::SUI, test_scenario};

#[test]
fun refunds_and_claims_preserve_the_funded_total_and_fixed_recipients() {
  let mut s = test_scenario::begin(@0xA);
  let mut pool = funds::new(coin::mint_for_testing<SUI>(100, s.ctx()));
  funds::deposit(&mut pool, coin::mint_for_testing<SUI>(7, s.ctx()));
  assert!(funds::total(&pool) == 107 && funds::balance(&pool) == 107, 0);
  funds::refund(&mut pool, 7, @0xB, s.ctx());
  funds::refund(&mut pool, 107, @0xC, s.ctx());
  assert!(funds::total(&pool) == 107 && funds::balance(&pool) == 100, 1);
  funds::claim(&mut pool, @0x1.to_id(), @0xC, 100, s.ctx());
  funds::claim(&mut pool, @0x2.to_id(), @0xD, 0, s.ctx());
  assert!(funds::total(&pool) == 107 && funds::balance(&pool) == 0, 2);
  s.next_tx(@0xA);
  let refund = s.take_from_address<coin::Coin<SUI>>(@0xB);
  let prize = s.take_from_address<coin::Coin<SUI>>(@0xC);
  assert!(refund.value() == 7 && prize.value() == 100, 3);
  assert!(!test_scenario::has_most_recent_for_address<coin::Coin<SUI>>(@0xD), 4);
  coin::burn_for_testing(refund); coin::burn_for_testing(prize);
  funds::destroy_for_testing(pool); s.end();
}

#[test]
fun fully_awarded_pool_requires_no_zero_coin_refund() {
  let mut s = test_scenario::begin(@0xA);
  let mut pool = funds::new(coin::mint_for_testing<SUI>(1, s.ctx()));
  funds::refund(&mut pool, 0, @0xB, s.ctx());
  funds::claim(&mut pool, @0x1.to_id(), @0xC, 1, s.ctx());
  s.next_tx(@0xA);
  assert!(!test_scenario::has_most_recent_for_address<coin::Coin<SUI>>(@0xB), 0);
  coin::burn_for_testing(s.take_from_address<coin::Coin<SUI>>(@0xC));
  funds::destroy_for_testing(pool); s.end();
}

#[test, expected_failure(abort_code = 2, location = aresrpg_rewards::tournament_rewards)]
fun an_empty_coin_cannot_create_an_escrow() {
  let mut ctx = tx_context::dummy();
  let _pool = funds::new(coin::zero<SUI>(&mut ctx)); abort 999
}

#[test, expected_failure(abort_code = 0, location = aresrpg_rewards::tournament_rewards)]
fun claims_require_final_allocation() {
  let mut ctx = tx_context::dummy();
  let mut pool = funds::new(coin::mint_for_testing<SUI>(1, &mut ctx));
  funds::claim(&mut pool, @0x1.to_id(), @0xA, 1, &mut ctx); abort 999
}

#[test, expected_failure(abort_code = 0, location = aresrpg_rewards::tournament_rewards)]
fun donations_cannot_change_entitlements_after_allocation() {
  let mut ctx = tx_context::dummy();
  let mut pool = funds::new(coin::mint_for_testing<SUI>(1, &mut ctx));
  funds::refund(&mut pool, 0, @0xA, &mut ctx);
  funds::deposit(&mut pool, coin::mint_for_testing<SUI>(1, &mut ctx)); abort 999
}

#[test, expected_failure(abort_code = 1, location = aresrpg_rewards::tournament_rewards)]
fun the_same_character_cannot_collect_twice() {
  let mut ctx = tx_context::dummy();
  let mut pool = funds::new(coin::mint_for_testing<SUI>(2, &mut ctx));
  funds::refund(&mut pool, 0, @0xA, &mut ctx);
  funds::claim(&mut pool, @0x1.to_id(), @0xA, 1, &mut ctx);
  funds::claim(&mut pool, @0x1.to_id(), @0xA, 1, &mut ctx); abort 999
}
