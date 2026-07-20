/// Event-contract twins for the two chain-side observability fixes (07-18 night):
///   • TELEPORT emits a movement event — the `k_teleport` caster relocation rides the SAME `Displaced` seam
///     push/pull use (from→to, side+idx), so the client renders it instead of the fighter silently warping
///     ("senshi teleport fully dead" — the block mutated the cell but emitted NOTHING).
///   • REVEAL emits `Revealed` — a hidden fighter that lands positive DIRECT damage clears invisibility AND now
///     announces it, so the client can drop the hidden state (the clear was already correct but silent).
/// The status-CLEARING semantics themselves live in `invisibility_tests`; these prove the EVENTS fire (and,
/// for reveal, that a visible fighter's guarded no-op fires nothing).
#[test_only]
module aresrpg_fight::cast_event_contract_tests;

use aresrpg_fight::{
  cast,
  fight::{Self, Fight},
  fight_events,
  fight_scaffold::{create_fight, plain_stats, stand_up},
  mob,
  participant,
  statuses,
};
use aresrpg_foundation::{spell, spell_board, spell_effect::{Self, Effect}};
use sui::{event, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;

fun fresh_fight(sc: &mut Scenario): Fight {
  stand_up(sc);
  create_fight(sc, 100, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  sc.take_shared<Fight>()
}

fun finish(sc: Scenario, fight: Fight) {
  ts::return_shared(fight);
  sc.end();
}

/// A caster-self teleport effect. The teleport block short-circuits before reading zone/element/filter, so only
/// `kind` matters — the rest are neutral placeholders.
fun teleport_effect(): Effect {
  spell_effect::new_effect(
    spell_effect::k_teleport(),
    spell::el_none(),
    0,
    spell_effect::shape_point(),
    0,
    spell_effect::tf_none(),
    100,
    0,
    0,
    0,
    spell_effect::phase_on_enter(),
  )
}

fun invisibility_row(turns: u8): Effect {
  spell_effect::new_effect(
    spell_effect::k_invisibility(),
    spell::el_none(),
    0,
    spell_effect::shape_point(),
    0,
    spell_effect::tf_none(),
    100,
    turns,
    0,
    0,
    spell_effect::phase_on_enter(),
  )
}

fun assert_single_displaced(is_mob: bool, idx: u64, from_cell: u64, to_cell: u64) {
  let events = event::events_by_type<fight_events::Displaced>();
  assert!(events.length() == 1);
  let (_fight, got_side, got_idx, got_kind, got_from, got_to, got_requested, got_blocked) =
    fight_events::displaced_for_testing(events.borrow(0));
  assert!(got_side == is_mob && got_idx == idx);
  assert!(got_kind == spell_effect::k_teleport());
  assert!(got_from == from_cell && got_to == to_cell);
  assert!(got_requested == 0 && got_blocked == 0); // a teleport is instant — no collision walk
}

// ╔════════════════ [ Item 1 — teleport movement event ] ════════════════════ ]

#[test]
/// A PLAYER teleport relocates the caster AND fires one Displaced(kind=teleport, from→to).
fun player_teleport_emits_displaced_move() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 164);
  let stats = plain_stats();
  let mut rng = 7;

  cast::apply_effect_for_testing(&mut fight, 0, 0, 164, &stats, 50, 200, &teleport_effect(), &mut rng);

  assert!(participant::cell(fight::participants(&fight).borrow(0)) == 200);
  assert_single_displaced(false, 0, 164, 200);
  assert!(event::events_by_type<fight_events::Hit>().is_empty()); // teleport deals no damage
  finish(sc, fight);
}

#[test]
/// A MOB teleport relocates the mob caster AND fires one Displaced(target_is_mob=true, kind=teleport, from→to).
fun mob_teleport_emits_displaced_move() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 165);
  let stats = plain_stats();
  let mut rng = 7;

  cast::apply_effect_for_testing(&mut fight, 1, 0, 165, &stats, 50, 100, &teleport_effect(), &mut rng);

  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 100);
  assert_single_displaced(true, 0, 165, 100);
  finish(sc, fight);
}

// ╔════════════════ [ Item 2 — invisibility reveal event ] ══════════════════ ]

#[test]
/// Revealing a hidden fighter clears invisibility AND emits exactly one Revealed keyed at that fighter.
fun reveal_emits_revealed_and_clears() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  spell_board::add_status(fight::fx_mut(&mut fight), 0, 0, invisibility_row(3));
  assert!(statuses::is_invisible(&fight, false, 0));

  statuses::reveal(&mut fight, false, 0);

  assert!(!statuses::is_invisible(&fight, false, 0));
  let revealed = event::events_by_type<fight_events::Revealed>();
  assert!(revealed.length() == 1);
  let (_fid, is_mob, idx) = fight_events::revealed_for_testing(revealed.borrow(0));
  assert!(!is_mob && idx == 0);
  finish(sc, fight);
}

#[test]
/// Guard: revealing an ALREADY-VISIBLE fighter is a no-op and emits nothing (so the every-damaging-cast callers
/// never spam a phantom reveal for a visible caster).
fun reveal_on_visible_fighter_emits_nothing() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  assert!(!statuses::is_invisible(&fight, false, 0));

  statuses::reveal(&mut fight, false, 0);

  assert!(event::events_by_type<fight_events::Revealed>().is_empty());
  finish(sc, fight);
}

#[test]
/// Integration on the real damaging-action door: an INVISIBLE player striking a mob for positive damage clears
/// its invisibility AND emits Revealed(is_mob=false) — the end-to-end did_damage → reveal → event chain.
fun invisible_striker_damage_emits_revealed() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 164);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 165);
  participant::begin_turn(fight::participants_mut(&mut fight).borrow_mut(0), 0, 0, 0, 0);
  spell_board::add_status(fight::fx_mut(&mut fight), 0, 0, invisibility_row(3));
  assert!(statuses::is_invisible(&fight, false, 0));

  cast::weapon_strike(&mut fight, 0, 165);

  assert!(!statuses::is_invisible(&fight, false, 0));
  let revealed = event::events_by_type<fight_events::Revealed>();
  assert!(revealed.length() == 1);
  let (_fid, is_mob, idx) = fight_events::revealed_for_testing(revealed.borrow(0));
  assert!(!is_mob && idx == 0);
  finish(sc, fight);
}
