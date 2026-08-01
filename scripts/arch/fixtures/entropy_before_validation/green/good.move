// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
module fixture::entropy_before_validation_green;

// GREEN control: deterministic caller input is checked before entropy is consumed.
entry fun input_guard_before_draw(quantity: u64, r: &Random, ctx: &mut TxContext) {
  assert!(quantity > 0, 1);
  let generator = random::new_generator(r, ctx);
  consume(generator);
}

// GREEN control: a post-draw guard informed by the drawn outcome is not an input retry gate.
public fun drawn_value_guard(r: &Random, ctx: &mut TxContext) {
  let generator = random::new_generator(r, ctx);
  let roll = generator.generate_u64();
  assert!(roll > 0, 1);
}

// GREEN control: private helpers are not externally callable entry/public surfaces.
fun private_helper_draws_first(quantity: u64, r: &Random, ctx: &mut TxContext) {
  let generator = random::new_generator(r, ctx);
  assert_ne!(quantity, 0);
  consume(generator);
}
