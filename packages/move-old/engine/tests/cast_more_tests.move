// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Coverage for `cast`'s zero-covered functions — the meatiest cluster. Three access strategies:
///  (a) `public(package)` accessors called DIRECTLY (`cell_occupied`, `trigger_on_enter`, `weapon_strike_player`).
///  (b) private effect-dispatch helpers (`apply_alter`/`apply_to_mob`/`record_timed`/`refresh_player_stats`/
///      `heal_caster`/the shared displacement path) driven through `resolve_mob_cast` (`public(package)`) with
///      hand-built `SpellLevel`s — a mob kit needs no `SpellTemplate`, so this is the cheap path.
///  (c) `resolve_player_cast`/`has_placement`/`place_effects`/`non_placement_effects` are reachable ONLY through
///      the real player-cast door, which needs an actual `&SpellTemplate` — minted via the `aresrpg_spells`
///      package's real `mint_spell` ceremony (its own AdminCap/Version/SpellRegistry, all local deps of this
///      package so their `#[test_only]` doors compile here same as `aresrpg_foundation`'s).
#[test_only]
module aresrpg_fight::cast_more_tests;

use aresrpg_fight::{cast, fight::{Self, Fight}, fight_events, mob, participant, version::Version};
use aresrpg_fight::fight_scaffold::{combatant, create_fight, mk_clock, mob_stats, stand_up, tsregs_for};
use aresrpg_foundation::{spell, spell_board, spell_effect};
use sui::{clock, event, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const OWNER2: address = @0xB;
const CHAR: address = @0xC0;
const CHAR2: address = @0xC2;
const WORLD: address = @0x704D;
const KOLI: address = @0x201;

// ╔════════════════ [ (a) direct public(package) calls ] ═════════════════════ ]

#[test]
fun cell_occupied_and_trigger_on_enter_direct_calls() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 100);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 200);
  assert!(cast::cell_occupied(&fight, 100));
  assert!(cast::cell_occupied(&fight, 200));
  assert!(!cast::cell_occupied(&fight, 150));
  cast::trigger_on_enter(&mut fight, false, 0); // player seat 0 — no board rows placed, no-ops safely
  cast::trigger_on_enter(&mut fight, true, 0); // mob 0 — same
  ts::return_shared(fight);
  sc.end();
}

fun pvp_two_seats(sc: &mut Scenario): (Fight, Version) {
  stand_up(sc);
  sc.next_tx(OWNER);
  let (mut registry, mut latch) = tsregs_for(sc, object::id_from_address(KOLI), object::id_from_address(CHAR));
  let ver = sc.take_shared<Version>();
  let clock = mk_clock(sc, 5000);
  fight::create_pvp_fight_for_testing(&mut registry, &mut latch, object::id_from_address(KOLI), 1, 999, 40, 40, 1, combatant(CHAR, 100), &ver, &clock, sc.ctx());
  clock::destroy_for_testing(clock);
  ts::return_shared(latch);
  ts::return_shared(registry);
  sc.next_tx(OWNER2);
  let mut fight = sc.take_shared<Fight>();
  fight::join_with_cap_for_testing(&mut fight, combatant(CHAR2, 100), OWNER2, 1);
  (fight, ver)
}

#[test]
fun weapon_strike_player_finds_and_hits_the_enemy() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = pvp_two_seats(&mut sc);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 100);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(1), 101); // Manhattan 1
  participant::begin_turn(fight::participants_mut(&mut fight).borrow_mut(0), 0, 0, 0, 0); // refill ap (no placement run)
  cast::weapon_strike_player(&mut fight, 0, 101);
  assert!(participant::hp(fight::participants(&fight).borrow(1)) < 100); // the strike landed
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

// ╔════════════════ [ (b) mob-cast effect dispatch — no SpellTemplate needed ] ═ ]

fun single_effect_spell(effect: spell_effect::Effect): spell_effect::SpellLevel {
  spell_effect::new_spell_level(1, 1, 0, 0, false, false, false, false, 255, 255, 0, 0, false, vector[], vector[], vector[effect], vector[])
}

/// A support/skirmisher mob kit exercising 4 effect kinds a mob can cast at a PLAYER or itself: a dispellable
/// debuff (apply_alter/record_timed/refresh_player_stats), life-steal (heal_caster — a no-op branch for a mob
/// caster, still function-covered), a self-heal (apply_to_mob), and a push (the shared displacement path).
fun kit_spec(): mob::MobSpec {
  let kit = vector[
    single_effect_spell(spell_effect::alter_stat(spell_effect::stat_strength(), participant::centered_value(10, true), true, true, 2)),
    single_effect_spell(spell_effect::life_steal(spell::el_fire(), 15)),
    single_effect_spell(spell_effect::heal(20)),
    single_effect_spell(spell_effect::push(2)),
  ];
  mob::new_mob_spec(1, 1, 200, 10, 0, mob_stats(), kit, 100, vector[])
}

#[test]
fun mob_cast_effect_dispatch_covers_alter_lifesteal_heal_push() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  sc.next_tx(OWNER);
  let (mut registry, mut latch) = tsregs_for(&sc, object::id_from_address(WORLD), object::id_from_address(CHAR));
  let ver = sc.take_shared<Version>();
  let clock = mk_clock(&mut sc, 1000);
  let spec = kit_spec();
  fight::create_for_testing(&mut registry, &mut latch, object::id_from_address(WORLD), 1, 12345, 100, 200, 0, true, option::none(), &spec, 1, combatant(CHAR, 100), &ver, &clock, sc.ctx());
  clock::destroy_for_testing(clock);
  ts::return_shared(latch);
  ts::return_shared(registry);
  ts::return_shared(ver);

  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let player_cell = participant::cell(fight::participants(&fight).borrow(0));
  let mob_cell = mob::cell(fight::mobs(&fight).borrow(0));

  let mut rng = 7u64; // mob-cast entropy thread (drain dodge draws off it; deterministic here)
  cast::resolve_mob_cast(&mut fight, 0, 0, player_cell, &mut rng); // alter debuff (TF_NOT_TEAM -> hits the player)
  cast::resolve_mob_cast(&mut fight, 0, 1, player_cell, &mut rng); // life steal (TF_NOT_TEAM -> hits the player)
  cast::resolve_mob_cast(&mut fight, 0, 2, mob_cell, &mut rng); // heal (TF_NOT_ENEMY -> self-heals the caster mob)
  cast::resolve_mob_cast(&mut fight, 0, 3, player_cell, &mut rng); // push (TF_NOT_TEAM -> displaces the player)

  assert!(participant::hp(fight::participants(&fight).borrow(0)) < 100); // debuff + life-steal both hit
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) > 0); // the self-heal never killed it
  ts::return_shared(fight);
  sc.end();
}

// ╔════════════════ [ (c) resolve_player_cast — the real SpellTemplate ceremony ] ═ ]

/// A 6-level free-cell trap spell (band-legal at damage_base=40/damage_per_level=5): every level 1..5 gates at
/// character level 1, L6 gates at `unlock_level(1) + 100` (the `mint_spell` top-gate law).
fun trap_level(min_char_level: u16): spell_effect::SpellLevel {
  spell_effect::new_spell_level(
    min_char_level, 3, 1, 4, false, false, false, true, 255, 255, 0, 0, false, vector[], vector[],
    vector[spell_effect::place_trap(spell_effect::shape_circle(), 1), spell_effect::push(2)],
    vector[],
  )
}

#[test]
fun resolve_player_cast_places_and_triggers_owned_push_trap() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 100, 1, 0, 1000, true, option::none());

  sc.next_tx(OWNER);
  aresrpg_spells::version::test_init(sc.ctx());
  aresrpg_spells::admin::test_init(sc.ctx());
  aresrpg_spells::spell_template::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<aresrpg_spells::admin::AdminCap>();
  let sver = sc.take_shared<aresrpg_spells::version::Version>();
  let mut sreg = sc.take_shared<aresrpg_spells::spell_template::SpellRegistry>();
  let levels = vector[trap_level(1), trap_level(1), trap_level(1), trap_level(1), trap_level(1), trap_level(101)];
  aresrpg_spells::spell_template::mint_spell(&cap, &mut sreg, b"senshi".to_string(), 1, b"Test Trap".to_string(), levels, 40, 5, &sver, sc.ctx());
  ts::return_shared(sreg);
  ts::return_shared(sver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let spell = sc.take_shared<aresrpg_spells::spell_template::SpellTemplate>();
  let mut fight = sc.take_shared<Fight>();

  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 100);
  participant::set_level_for_testing(fight::participants_mut(&mut fight).borrow_mut(0), 36);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 300); // well clear of the trap's 1..4 cast range
  participant::begin_turn(fight::participants_mut(&mut fight).borrow_mut(0), 0, 0, 0, 0); // refill ap (no placement run)

  cast::resolve_player_cast(&mut fight, 0, &spell, 102); // Manhattan 2, free cell, in range [1,4]
  assert!(participant::ap(fight::participants(&fight).borrow(0)) == 3); // base_ap 6 - ap_cost 3
  assert!(spell_board::entry_count(fight::fx(&fight)) == 1);

  // Simulate the target entering the trap zone after placement. PUSH from anchor 102 toward the living blocker
  // at 100 is immediately blocked, so recorded owner level 36 deals 8 * 2 = 16 (fallback level 1 would deal 2).
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 101);
  let fight_id = fight::id(&fight);
  cast::trigger_on_enter(&mut fight, true, 0);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 101);
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 84);
  assert!(spell_board::entry_count(fight::fx(&fight)) == 0);
  let displaced = event::events_by_type<fight_events::Displaced>();
  let hits = event::events_by_type<fight_events::Hit>();
  assert!(displaced.length() == 1 && hits.length() == 1);
  let (got_fight, target_is_mob, target_idx, kind, from_cell, to_cell, requested, blocked) =
    fight_events::displaced_for_testing(displaced.borrow(0));
  assert!(got_fight == fight_id && target_is_mob && target_idx == 0);
  assert!(kind == spell_effect::k_push() && from_cell == 101 && to_cell == 101);
  assert!(requested == 2 && blocked == 2);
  let (hit_fight, victim_is_mob, victim_idx, amount, remaining_hp) =
    fight_events::hit_for_testing(hits.borrow(0));
  assert!(hit_fight == fight_id && victim_is_mob && victim_idx == 0);
  assert!(amount == 16 && remaining_hp == 84);

  ts::return_shared(fight);
  ts::return_shared(spell);
  sc.end();
}

fun push_level(min_char_level: u16): spell_effect::SpellLevel {
  spell_effect::new_spell_level(
    min_char_level, 3, 1, 4, false, false, false, false, 255, 255, 0, 0, false, vector[], vector[],
    vector[spell_effect::push(2)],
    vector[],
  )
}

#[test]
fun resolve_player_push_spends_ap_and_displaces_mob() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 100, 1, 0, 1000, true, option::none());

  sc.next_tx(OWNER);
  aresrpg_spells::version::test_init(sc.ctx());
  aresrpg_spells::admin::test_init(sc.ctx());
  aresrpg_spells::spell_template::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<aresrpg_spells::admin::AdminCap>();
  let sver = sc.take_shared<aresrpg_spells::version::Version>();
  let mut sreg = sc.take_shared<aresrpg_spells::spell_template::SpellRegistry>();
  let levels = vector[push_level(1), push_level(1), push_level(1), push_level(1), push_level(1), push_level(101)];
  aresrpg_spells::spell_template::mint_spell(&cap, &mut sreg, b"senshi".to_string(), 1, b"Push Regression".to_string(), levels, 0, 0, &sver, sc.ctx());
  ts::return_shared(sreg);
  ts::return_shared(sver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let spell = sc.take_shared<aresrpg_spells::spell_template::SpellTemplate>();
  let mut fight = sc.take_shared<Fight>();
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 164);
  participant::set_level_for_testing(fight::participants_mut(&mut fight).borrow_mut(0), 50);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 165);
  participant::begin_turn(fight::participants_mut(&mut fight).borrow_mut(0), 0, 0, 0, 0);

  let fight_id = fight::id(&fight);
  assert!(participant::ap(fight::participants(&fight).borrow(0)) == 6);
  cast::resolve_player_cast(&mut fight, 0, &spell, 165);
  assert!(participant::ap(fight::participants(&fight).borrow(0)) == 3);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 167);
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 100);
  assert!(event::events_by_type<fight_events::Hit>().is_empty());
  let displaced = event::events_by_type<fight_events::Displaced>();
  assert!(displaced.length() == 1);
  let (got_fight, target_is_mob, target_idx, kind, from_cell, to_cell, requested, blocked) =
    fight_events::displaced_for_testing(displaced.borrow(0));
  assert!(got_fight == fight_id && target_is_mob && target_idx == 0);
  assert!(kind == spell_effect::k_push() && from_cell == 165 && to_cell == 167);
  assert!(requested == 2 && blocked == 0);

  ts::return_shared(fight);
  ts::return_shared(spell);
  sc.end();
}
