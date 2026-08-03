// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// #2031 INSTRUMENT — a live 7–12 trap band resolved as 10 forever because its stored endpoints were equal.
/// Cured-era provenance: first wave digest Hh9ytJWoq5MfE5qZpWpyjc1UjyP6h6eVm2aFHWhuKNhF.
///
/// The production door pinned here is `cast.move:1864-1876`: each DoT row resolves through
/// `roll_in_range(base, value_max, slot_damage_roll(turn_seed, effect_ordinal))`. The sim twin pins the same
/// door at `packages/sim/src/fight_actions.js:498-512` and its mapper at `turn_seed.js:76-82`.
///
/// N=10 independent DoT rows over the six-value [7,12] band. Under a fair roll the false pass "all N values are
/// identical" has probability 6 * (1/6)^10 = 6^-9 = 1/10,077,696 ≈ 9.92e-8, safely below 1e-6.
#[test_only]
module aresrpg_fight::roll_distribution_instrument_tests;

use aresrpg_fight::{cast, fight::{Self, Fight}, fight_events, fight_scaffold::{create_fight, stand_up}};
use aresrpg_foundation::{spell, spell_board, spell_effect};
use sui::{event, test_scenario::{Self as ts}};

const OWNER: address = @0xA;
const MOB_FID: u64 = 1_000;
const N: u64 = 10;
const TICK_SEED: u64 = 3_049_140_046;
const EDeadRoll: u64 = 2031;

fun dot(min: u64, max: u64): spell_effect::Effect {
  spell_effect::new_effect_ranged(
    spell_effect::k_apply_dot(),
    spell::el_earth(),
    min,
    max,
    spell_effect::shape_point(),
    0,
    spell_effect::tf_not_team(),
    100,
    5,
    0,
    0,
    spell_effect::phase_start(),
  )
}

fun trigger_values(min: u64, max: u64): vector<u64> {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 1_000, 1, 0, 1_000, true, option::none());

  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  // This is the exact literal the sim twin feeds to its turn-start sink.
  assert!(fight::turn_seed_for_testing(&fight, MOB_FID) == TICK_SEED, 0);
  let mut i = 0;
  while (i < N) {
    spell_board::apply_dot(fight::fx_mut(&mut fight), MOB_FID, 0, dot(min, max));
    i = i + 1;
  };

  assert!(cast::tick_turn_start(&mut fight, true, 0), 1);
  let hits = event::events_by_type<fight_events::Hit>();
  assert!(hits.length() == N, 2);
  let mut values = vector[];
  i = 0;
  while (i < N) {
    let (_fight, victim_is_mob, victim_idx, amount, _remaining_hp) =
      fight_events::hit_for_testing(hits.borrow(i));
    assert!(victim_is_mob && victim_idx == 0, 3);
    values.push_back(amount);
    i = i + 1;
  };

  ts::return_shared(fight);
  sc.end();
  values
}

fun distinct_count(values: &vector<u64>): u64 {
  let mut distinct = vector[];
  let mut i = 0;
  while (i < values.length()) {
    if (!distinct.contains(values.borrow(i))) distinct.push_back(*values.borrow(i));
    i = i + 1;
  };
  distinct.length()
}

fun assert_varies(values: &vector<u64>) {
  assert!(distinct_count(values) > 1, EDeadRoll);
}

#[test]
/// Ten independent DoT triggers must resolve to more than one distinct authored-band value.
fun ten_independent_dot_triggers_resolve_more_than_one_distinct_value() {
  let values = trigger_values(7, 12);
  assert!(values == vector[9, 7, 9, 12, 7, 12, 12, 9, 10, 12], 4);
  assert_varies(&values);
}

#[test, expected_failure(abort_code = EDeadRoll, location = Self)]
/// Negative control: a degenerate band must fail exactly at the distinct-count assertion.
fun degenerate_band_fails_exactly_at_distinct_count_assertion() {
  let values = trigger_values(10, 10);
  assert!(values == vector[10, 10, 10, 10, 10, 10, 10, 10, 10, 10], 4);
  assert_varies(&values);
}
