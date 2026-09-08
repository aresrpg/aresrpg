// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::seller_proof_tests;

use aresrpg::{item, listing_rule};
use kiosk::personal_kiosk;
use std::bcs;
use sui::{event, kiosk, package::Publisher, test_scenario, transfer_policy};

const OWNER: address = @0xA11CE;

#[test]
fun a_cosmetic_owner_cannot_redirect_the_seller_witness() { prove_seller(false); }

#[test, expected_failure(abort_code = 803, location = aresrpg::listing_rule)]
fun the_witness_must_name_the_actual_source_kiosk() { prove_seller(true); }

fun prove_seller(wrong_source: bool) {
  let mut scenario = test_scenario::begin(OWNER);
  item::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let publisher = scenario.take_from_sender<Publisher>();
  let (policy, policy_cap) = transfer_policy::new<item::Item>(&publisher, scenario.ctx());
  let (mut seller, cap) = kiosk::new(scenario.ctx());
  let personal = personal_kiosk::new(&mut seller, cap, scenario.ctx());
  seller.set_owner_custom(personal_kiosk::borrow(&personal), @0xBAD);
  let source = if (wrong_source) object::id_from_address(@0x2) else object::id(&seller);
  let request = transfer_policy::new_request<item::Item>(object::id_from_address(@0x1), 1000, source);
  listing_rule::prove_seller(&request, &seller);
  let proofs = event::events_by_type<listing_rule::SellerProved>();
  assert!(proofs.length() == 1);
  let mut expected = bcs::to_bytes(&object::id(&seller));
  let owner = OWNER;
  expected.append(bcs::to_bytes(&owner));
  assert!(bcs::to_bytes(&proofs[0]) == expected);
  let (_, _, _) = policy.confirm_request(request);
  transfer_policy::destroy_and_withdraw(policy, policy_cap, scenario.ctx()).into_balance().destroy_zero();
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  transfer::public_share_object(seller);
  publisher.burn();
  scenario.end();
}
