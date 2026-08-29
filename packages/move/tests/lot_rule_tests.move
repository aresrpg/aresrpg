// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

#[test_only]
module aresrpg::lot_rule_tests;

use aresrpg::lot_rule;

#[test]
fun private_escrow_accepts_exact_amounts_while_paid_sales_keep_fixed_lots() {
  assert!(lot_rule::valid_lot_for_testing(2, 0));
  assert!(lot_rule::valid_lot_for_testing(17, 0));
  assert!(!lot_rule::valid_lot_for_testing(2, 1));
  assert!(lot_rule::valid_lot_for_testing(1, 1));
  assert!(lot_rule::valid_lot_for_testing(10, 1));
  assert!(lot_rule::valid_lot_for_testing(100, 1));
  assert!(lot_rule::valid_lot_for_testing(1000, 1));
}
