#[test_only]
module aresrpg::retired_currency_tests;

use aresrpg::{trade, version};
use aresrpg_kares::kares::KARES;
use sui::{coin, test_scenario};

fun retired(operation: u8) {
    let mut scenario = test_scenario::begin(@0xA);
    version::test_init(scenario.ctx());
    scenario.next_tx(@0xA);
    let version = scenario.take_shared<version::Version>();
    let mut trade = trade::trade_for_testing(@0xA, @0xB, 1, 0, 0, 0, scenario.ctx());
    if (operation == 0) trade::put_kares(&mut trade, coin::mint_for_testing<KARES>(1, scenario.ctx()), 0, &version, scenario.ctx());
    if (operation == 1) { coin::burn_for_testing(trade::take_kares(&mut trade, 1, 0, &version, scenario.ctx())); };
    if (operation == 2) { coin::burn_for_testing(trade::claim_kares(&mut trade, &version, scenario.ctx())); };
    if (operation == 3) { coin::burn_for_testing(trade::recover_kares(&mut trade, &version, scenario.ctx())); };
    abort 999
}

#[test, expected_failure(abort_code = 602, location = aresrpg::trade)]
fun legacy_deposit_is_retired() { retired(0) }
#[test, expected_failure(abort_code = 602, location = aresrpg::trade)]
fun legacy_withdrawal_is_retired() { retired(1) }
#[test, expected_failure(abort_code = 602, location = aresrpg::trade)]
fun legacy_claim_is_retired() { retired(2) }
#[test, expected_failure(abort_code = 602, location = aresrpg::trade)]
fun legacy_recovery_is_retired() { retired(3) }

#[test, expected_failure(abort_code = 601, location = aresrpg::version)]
fun version_gate_precedes_retirement() {
    let ctx = &mut tx_context::dummy();
    let version = version::stale_for_testing(ctx);
    let mut trade = trade::trade_for_testing(@0xA, @0xB, 1, 0, 0, 0, ctx);
    trade::put_kares(&mut trade, coin::mint_for_testing<KARES>(1, ctx), 0, &version, ctx);
    abort 999
}

#[test, expected_failure(abort_code = 602, location = aresrpg::api)]
fun legacy_boss_payout_is_retired() {
    let mut scenario = test_scenario::begin(@0xA);
    version::test_init(scenario.ctx());
    scenario.next_tx(@0xA);
    let version = scenario.take_shared<version::Version>();
    let offering = aresrpg_kares::offering::create_for_testing(scenario.ctx());
    let mut pot = aresrpg_kares::combat_rewards::create_for_testing(scenario.ctx());
    let clock = sui::clock::create_for_testing(scenario.ctx());
    let character = aresrpg::character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
    let mut fight = aresrpg::fight::party_authority_fight_for_testing(character, @0xA, false, scenario.ctx());
    aresrpg::api::prepare_boss_rewards(&mut fight, 0, &offering, &mut pot, &version, &clock, scenario.ctx());
    abort 999
}
