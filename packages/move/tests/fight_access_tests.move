// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WHO MAY TAKE A SIDE — the rule the duel incident of 2026-08-22 was decided by. A duel's
// side B is RESERVED for the challenged character: the chain is the only authority that can
// keep a bystander out of it, and reading the side's POPULATION instead of its RULE both let
// a stranger take that seat and let an emptied side be re-opened under a stranger's setting.
#[test_only]
module aresrpg::fight_access_tests;

use aresrpg::fight;
use sui::test_scenario;

const ACCESS_PUBLIC: u8 = 0;
const ACCESS_GROUP: u8 = 1;
const ACCESS_INVITED: u8 = 2;
const ACCESS_UNSET: u8 = 255;
const EGroupOnly: u64 = 1727;

#[test]
fun a_reserved_side_admits_the_character_it_names() {
    let mut scenario = test_scenario::begin(@0x1);
    let ctx = scenario.ctx();
    let invited = object::id_from_address(@0xa11ce);
    // admitted, and it does NOT claim the side: the rule was written at the challenge
    assert!(
        !fight::side_admission_for_testing(ACCESS_INVITED, option::some(invited), false, invited, ctx),
        0,
    );
    scenario.end();
}

#[test]
#[expected_failure(abort_code = EGroupOnly, location = aresrpg::fight)]
fun a_reserved_side_refuses_a_bystander() {
    let mut scenario = test_scenario::begin(@0x1);
    let ctx = scenario.ctx();
    let invited = object::id_from_address(@0xa11ce);
    let bystander = object::id_from_address(@0xb0b);
    fight::side_admission_for_testing(ACCESS_INVITED, option::some(invited), false, bystander, ctx);
    abort 0
}

#[test]
fun an_unclaimed_empty_side_is_claimed_by_its_first_player() {
    let mut scenario = test_scenario::begin(@0x1);
    let ctx = scenario.ctx();
    let joiner = object::id_from_address(@0xb0b);
    assert!(
        fight::side_admission_for_testing(ACCESS_UNSET, option::none(), false, joiner, ctx),
        0,
    );
    scenario.end();
}

#[test]
#[expected_failure(abort_code = EGroupOnly, location = aresrpg::fight)]
fun a_sealed_side_stays_shut_while_it_holds_a_player() {
    // the ambush law: both sides UNSET and never empty — no join door ever admits a helper
    let mut scenario = test_scenario::begin(@0x1);
    let ctx = scenario.ctx();
    let joiner = object::id_from_address(@0xb0b);
    fight::side_admission_for_testing(ACCESS_UNSET, option::none(), true, joiner, ctx);
    abort 0
}

#[test]
fun a_public_side_admits_anyone_without_reclaiming_it() {
    let mut scenario = test_scenario::begin(@0x1);
    let ctx = scenario.ctx();
    let joiner = object::id_from_address(@0xb0b);
    assert!(
        !fight::side_admission_for_testing(ACCESS_PUBLIC, option::none(), true, joiner, ctx),
        0,
    );
    scenario.end();
}

#[test]
#[expected_failure(abort_code = EGroupOnly, location = aresrpg::fight)]
fun a_group_side_refuses_the_plain_door() {
    let mut scenario = test_scenario::begin(@0x1);
    let ctx = scenario.ctx();
    let joiner = object::id_from_address(@0xb0b);
    fight::side_admission_for_testing(ACCESS_GROUP, option::none(), true, joiner, ctx);
    abort 0
}
