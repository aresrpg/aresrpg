// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The public Party/Fight authority boundary: invitations use the real API doors, real Party
/// membership, and a Character held under the Fight UID.
#[test_only]
module aresrpg::party_fight_invite_tests;

use aresrpg::{
  api,
  character::{Self, Character},
  fight::{Self, Fight},
  friends::FriendRegistry,
  party::{Self, Party},
  version::{Self, Version},
};
use sui::test_scenario::{Self, Scenario};

const OWNER: address = @0xA11CE;
const STRANGER: address = @0xBEEF;

fun begin_with_version(sender: address): (Scenario, Version) {
  let mut scenario = test_scenario::begin(OWNER);
  version::test_init(scenario.ctx());
  scenario.next_tx(sender);
  let version = scenario.take_shared<Version>();
  (scenario, version)
}

fun member_party(
  registry: &mut FriendRegistry,
  leader: &Character,
  actor: &Character,
  ctx: &mut TxContext,
): Party {
  let mut row = party::inviting_for_testing(registry, leader, object::id(actor), ctx);
  party::accept(registry, &mut row, object::id(actor));
  row
}

fun clean_member_party(
  registry: &mut FriendRegistry,
  mut row: Party,
  leader: Character,
  actor: Character,
) {
  party::leave(registry, &mut row, object::id(&leader));
  party::disband(registry, row, object::id(&actor));
  character::destroy(leader);
  character::destroy(actor);
}

#[test]
fun accepted_member_invites_through_the_public_fight_door() {
  let (mut scenario, version) = begin_with_version(OWNER);
  let mut registry = party::registry_for_testing(scenario.ctx());
  let leader = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let actor = character::test_character(b"shugo".to_string(), 1, 0, scenario.ctx());
  let actor_id = object::id(&actor);
  let target = object::id_from_address(@0xCAFE);
  let mut row = member_party(&mut registry, &leader, &actor, scenario.ctx());
  let fight = fight::party_authority_fight_for_testing(actor, OWNER, false, scenario.ctx());

  api::party_invitation_from_fight(
    &registry, &mut row, &fight, 0, actor_id, target, &version, scenario.ctx(),
  );
  let (_, invited, members, pending) = party::shape_for_testing(&row);
  assert!(invited == target && members == 2 && pending == 1, 0);

  let actor = fight::take_party_authority_character_for_testing(fight);
  clean_member_party(&mut registry, row, leader, actor);
  party::destroy_registry_for_testing(registry);
  test_scenario::return_shared(version);
  scenario.end();
}

#[test]
#[expected_failure(abort_code = 1708, location = aresrpg::fight)]
fun another_sender_cannot_use_the_fighter() {
  let (mut scenario, version) = begin_with_version(STRANGER);
  let mut registry = party::registry_for_testing(scenario.ctx());
  let leader = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let actor = character::test_character(b"shugo".to_string(), 1, 0, scenario.ctx());
  let actor_id = object::id(&actor);
  let mut row = member_party(&mut registry, &leader, &actor, scenario.ctx());
  let fight = fight::party_authority_fight_for_testing(actor, OWNER, false, scenario.ctx());
  api::party_invitation_from_fight(
    &registry, &mut row, &fight, 0, actor_id, object::id_from_address(@0xCAFE), &version, scenario.ctx(),
  );
  abort 999
}

#[test]
#[expected_failure(abort_code = 1708, location = aresrpg::fight)]
fun a_stale_character_id_cannot_use_the_fighter() {
  let (mut scenario, version) = begin_with_version(OWNER);
  let mut registry = party::registry_for_testing(scenario.ctx());
  let leader = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let actor = character::test_character(b"shugo".to_string(), 1, 0, scenario.ctx());
  let mut row = member_party(&mut registry, &leader, &actor, scenario.ctx());
  let fight = fight::party_authority_fight_for_testing(actor, OWNER, false, scenario.ctx());
  api::party_invitation_from_fight(
    &registry,
    &mut row,
    &fight,
    0,
    object::id_from_address(@0xBAD),
    object::id_from_address(@0xCAFE),
    &version,
    scenario.ctx(),
  );
  abort 999
}

#[test]
#[expected_failure(abort_code = 1708, location = aresrpg::fight)]
fun a_mob_seat_cannot_invite() {
  let (mut scenario, version) = begin_with_version(OWNER);
  let mut registry = party::registry_for_testing(scenario.ctx());
  let leader = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let actor = character::test_character(b"shugo".to_string(), 1, 0, scenario.ctx());
  let actor_id = object::id(&actor);
  let mut row = member_party(&mut registry, &leader, &actor, scenario.ctx());
  let fight = fight::mob_party_authority_fight_for_testing(scenario.ctx());
  api::party_invitation_from_fight(
    &registry, &mut row, &fight, 0, actor_id, object::id_from_address(@0xCAFE), &version, scenario.ctx(),
  );
  abort 999
}

#[test]
#[expected_failure(abort_code = 1708, location = aresrpg::fight)]
fun a_settled_seat_cannot_invite() {
  let (mut scenario, version) = begin_with_version(OWNER);
  let mut registry = party::registry_for_testing(scenario.ctx());
  let leader = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let actor = character::test_character(b"shugo".to_string(), 1, 0, scenario.ctx());
  let actor_id = object::id(&actor);
  let mut row = member_party(&mut registry, &leader, &actor, scenario.ctx());
  let fight = fight::party_authority_fight_for_testing(actor, OWNER, true, scenario.ctx());
  api::party_invitation_from_fight(
    &registry, &mut row, &fight, 0, actor_id, object::id_from_address(@0xCAFE), &version, scenario.ctx(),
  );
  abort 999
}

#[test]
#[expected_failure(abort_code = 2006, location = aresrpg::party)]
fun a_controlled_nonmember_cannot_mutate_the_party() {
  let (mut scenario, version) = begin_with_version(OWNER);
  let mut registry = party::registry_for_testing(scenario.ctx());
  let leader = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let actor = character::test_character(b"shugo".to_string(), 1, 0, scenario.ctx());
  let actor_id = object::id(&actor);
  let mut row = party::inviting_for_testing(
    &mut registry, &leader, object::id_from_address(@0xF1), scenario.ctx(),
  );
  let fight = fight::party_authority_fight_for_testing(actor, OWNER, false, scenario.ctx());
  api::party_invitation_from_fight(
    &registry, &mut row, &fight, 0, actor_id, object::id_from_address(@0xCAFE), &version, scenario.ctx(),
  );
  abort 999
}
