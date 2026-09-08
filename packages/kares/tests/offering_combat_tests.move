#[test_only]
module aresrpg_kares::offering_combat_tests;

use aresrpg_kares::kares;
use aresrpg_kares::offering::{Self, Offering};
use aresrpg_kares::combat_rewards::{Self, CombatPot};
use sui::clock::{Self, Clock};
use sui::test_scenario::{Self, Scenario};

public struct ForgedVictory has drop {}

fun unrelated_pot(): (Scenario, Offering, CombatPot, Clock) {
    let mut scenario = test_scenario::begin(@0xA);
    let clock = clock::create_for_testing(scenario.ctx());
    let genesis = kares::genesis_for_testing(scenario.ctx());
    let cap = sui::package::test_publish(object::id_from_address(@aresrpg_kares), scenario.ctx());
    offering::setup(genesis, cap, 1, 10, 100, @0xA, @0xA, @0xA, @0xA, scenario.ctx());
    scenario.next_tx(@0xA);
    let offering = scenario.take_shared<Offering>();
    let pot = combat_rewards::create(scenario.ctx());
    (scenario, offering, pot, clock)
}

fun finish(scenario: Scenario, offering: Offering, pot: CombatPot, clock: Clock) {
    test_scenario::return_shared(offering);
    combat_rewards::destroy_for_testing(pot);
    clock.destroy_for_testing();
    scenario.end();
}

#[test, expected_failure(abort_code = offering::EWrongPool)]
fun even_the_treasury_cannot_redirect_reserved_combat_tokens() {
    let (mut scenario, mut offering, mut pot, clock) = unrelated_pot();
    offering::seed_combat(&mut offering, &mut pot, scenario.ctx());
    finish(scenario, offering, pot, clock);
}

#[test, expected_failure(abort_code = offering::EWrongPool)]
fun even_the_treasury_cannot_authorize_an_unrelated_pot() {
    let (mut scenario, offering, mut pot, clock) = unrelated_pot();
    offering::authorize_combat<ForgedVictory>(&offering, &mut pot, scenario.ctx());
    finish(scenario, offering, pot, clock);
}

#[test, expected_failure(abort_code = offering::EWrongPool)]
fun another_offering_cannot_supply_a_fake_release_clock() {
    let (mut scenario, offering, mut pot, clock) = unrelated_pot();
    offering::boss_bounty(&offering, &mut pot, ForgedVictory {}, 200, 1, &clock, scenario.ctx()).destroy_zero();
    finish(scenario, offering, pot, clock);
}
