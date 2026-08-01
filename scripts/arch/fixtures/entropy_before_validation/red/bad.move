// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
module fixture::entropy_before_validation_red;

// RED control: caller input is still unvalidated when the public entry consumes fresh entropy.
public entry fun draw_before_input_guard(quantity: u64, r: &Random, ctx: &mut TxContext) {
  let generator = random::new_generator(r, ctx);
  assert!(quantity > 0, 1);
  consume(generator);
}
