// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Immutable weighted loot-table rows and deterministic selection.
module aresrpg_math::loot_table;

public struct LootEntry has copy, drop, store { template: ID, weight: u64, amount: u32 }

public fun new_entry(template: ID, weight: u64, amount: u32): LootEntry {
  LootEntry { template, weight, amount }
}

public fun template(entry: &LootEntry): ID { entry.template }

public fun amount(entry: &LootEntry): u32 { entry.amount }

public fun total_weight(entries: &vector<LootEntry>): u64 {
  let mut sum = 0;
  let mut index = 0;
  while (index < entries.length()) {
    sum = sum + entries[index].weight;
    index = index + 1;
  };
  sum
}

/// Walk the weighted pool with CONSTANT work: both window comparisons run for every row and
/// exactly one assignment fires for any valid draw — the selected row cannot alter gas, so a
/// tight gas budget can never be used to filter rolls. Never "simplify" this to an early return.
public fun pick(entries: &vector<LootEntry>, draw: u64): LootEntry {
  let mut accumulated = 0;
  let mut selected = entries[0];
  let mut index = 0;
  while (index < entries.length()) {
    let at_or_after_start = draw >= accumulated;
    accumulated = accumulated + entries[index].weight;
    let before_end = draw < accumulated;
    if (at_or_after_start == before_end) selected = entries[index];
    index = index + 1;
  };
  selected
}
