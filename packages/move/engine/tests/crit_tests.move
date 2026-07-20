/// TURN-SEED CRIT wiring (damage variance reverted same day: no global
/// band, damage is exactly the authored base). The foundation suite proves the pure derivation (`prng`/
/// `spell_formula`); THIS suite proves the engine feeds it correctly end-to-end: the seat- and slot-bound turn
/// seed, a real weapon strike whose crit matches the client-previewable derivation, and the slot index advancing
/// across strikes (routing = the mechanic). Uses the crit-capable scaffold weapon (crit_rate 2 → 50% via the bp
/// threshold; 50 base / 90 crit) over a zero-resist bag, so `final_damage` reduces to the base and the assertions
/// are exact.
#[test_only]
module aresrpg_fight::crit_tests;

use aresrpg_fight::{actions, fight::{Self, Fight}, mob, participant, turns, version::Version};
use aresrpg_fight::fight_scaffold::{create_fight_crit, create_fight_weapon, mk_clock, stand_up};
use aresrpg_foundation::spell_formula;
use sui::{clock, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0;

/// Stand up a CRIT-capable creator and drive to ACTIVE with the player adjacent to the bag (player cell 100, mob
/// 101 — Manhattan 1, clear LOS). Returns the shared Fight + Version (taken via a tx sent by OWNER). `turn_deadline_ms` is set by
/// the placement → ACTIVE transition (the seed's per-turn reveal).
fun active_crit_fight(sc: &mut Scenario, bag_hp: u64): (Fight, Version) {
  stand_up(sc);
  create_fight_crit(sc, bag_hp, 1, 1000);
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let cell0 = participant::cell(fight::participants(&fight).borrow(0));
  let clock = mk_clock(sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), cell0, &ver, &clock, OWNER);
  clock::destroy_for_testing(clock);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 100);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 101);
  (fight, ver)
}

/// The client's preview math for a crit-weapon strike at `slot`: crit swaps 50→90 base, exactly (no further
/// variance). Zero caster/target stats ⇒ `final_damage` == the base, so this IS the HP loss.
fun predicted(turn_seed: u64, slot: u64): u64 {
  let crit = spell_formula::crit_at(spell_formula::slot_crit_roll(turn_seed, slot), 2, 0);
  if (crit) 90 else 50
}

#[test]
/// The turn seed binds to SEAT (PvP symmetry: each seat its own sequence) and each slot's crit roll binds to the
/// INDEX only (distinct slots → distinct crit rolls, so reordering actions swaps which slot crits).
fun turn_seed_binds_to_seat_and_slot() {
  let mut sc = ts::begin(OWNER);
  let (fight, ver) = active_crit_fight(&mut sc, 500);
  let s0 = fight::turn_seed_for_testing(&fight, 0);
  let s1 = fight::turn_seed_for_testing(&fight, 1);
  assert!(s0 != s1, 0); // each seat its own seed
  assert!(s0 == fight::turn_seed_for_testing(&fight, 0), 1); // deterministic
  assert!(spell_formula::slot_crit_roll(s0, 0) != spell_formula::slot_crit_roll(s0, 1), 2); // index-bound crit
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// A real weapon strike's crit damage matches the derivation the client previews from public state — the crit
/// branch (50→90) is wired through the actual resolution, with NO further variance.
fun weapon_strike_matches_derivation() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = active_crit_fight(&mut sc, 500);
  let expected = predicted(fight::turn_seed_for_testing(&fight, 0), 0);
  let hp_before = mob::hp(fight::mobs(&fight).borrow(0));
  actions::weapon_for_testing(&mut fight, object::id_from_address(CHAR), 101, &ver, 1000, OWNER);
  let hp_after = mob::hp(fight::mobs(&fight).borrow(0));
  assert!(hp_before - hp_after == expected, 0);
  // exactly one of the two authored bases — never anything in between.
  assert!(expected == 50 || expected == 90, 1);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// The slot index ADVANCES across strikes in commit order: strike 1 resolves slot 0, strike 2 resolves slot 1 —
/// each matching its own slot's derivation. Proves the counter (`casts_this_turn`) covers weapon strikes.
fun consecutive_strikes_advance_the_slot() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = active_crit_fight(&mut sc, 5000); // high hp: survives both strikes, fight stays ACTIVE
  let s0 = fight::turn_seed_for_testing(&fight, 0);
  let e0 = predicted(s0, 0);
  let e1 = predicted(s0, 1);
  let hp0 = mob::hp(fight::mobs(&fight).borrow(0));
  actions::weapon_for_testing(&mut fight, object::id_from_address(CHAR), 101, &ver, 1000, OWNER); // AP 6→3, slot 0
  let hp1 = mob::hp(fight::mobs(&fight).borrow(0));
  actions::weapon_for_testing(&mut fight, object::id_from_address(CHAR), 101, &ver, 1000, OWNER); // AP 3→0, slot 1
  let hp2 = mob::hp(fight::mobs(&fight).borrow(0));
  assert!(hp0 - hp1 == e0, 0);
  assert!(hp1 - hp2 == e1, 1);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

// ╔════════════════ [ Class-affinity +10% (DECISIONS 07-12 — universal weapons) ] ═ ]

/// A LONGSWORD family line: caster/target stats are zero on the bag, so a strike's HP loss IS the base (crit swaps
/// to crit_damage). Longsword reach 1 / ap_cost 4 both fit the 100→101 adjacency + the 6-AP seat.
fun longsword_line(affinity: bool): participant::Weapon {
  participant::weapon_line_of(option::some(b"longsword".to_string()), affinity)
}

/// The client-previewable strike derivation for a bare weapon LINE at `slot` (crit swaps damage→crit_damage; zero
/// stats ⇒ `final_damage` == the base). Reused by both strike-path assertions.
fun strike_expect(turn_seed: u64, slot: u64, w: &participant::Weapon): u64 {
  let crit = spell_formula::crit_at(spell_formula::slot_crit_roll(turn_seed, slot), participant::weapon_line_crit_rate(w), 0);
  if (crit) participant::weapon_line_crit_damage(w) else participant::weapon_line_damage(w)
}

/// Active fight seating a creator with weapon line `w`, player adjacent to the bag (100 vs 101) — the strike scaffold.
fun active_weapon_fight(sc: &mut Scenario, bag_hp: u64, w: participant::Weapon): (Fight, Version) {
  stand_up(sc);
  create_fight_weapon(sc, bag_hp, 1, 1000, w);
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let cell0 = participant::cell(fight::participants(&fight).borrow(0));
  let clock = mk_clock(sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), cell0, &ver, &clock, OWNER);
  clock::destroy_for_testing(clock);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 100);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 101);
  (fight, ver)
}

#[test]
/// The +10% own-class affinity scales the DAMAGE bases ONLY: damage & crit_damage rise by exactly (base×110)/100;
/// crit_rate / ap_cost / reach are mechanics and NEVER move. Bare hands never carry affinity (returns un-scaled).
fun affinity_scales_damage_and_crit_only() {
  let base = longsword_line(false);
  let aff = longsword_line(true);
  assert!(participant::weapon_line_damage(&aff) == participant::weapon_line_damage(&base) * 110 / 100, 0);
  assert!(participant::weapon_line_crit_damage(&aff) == participant::weapon_line_crit_damage(&base) * 110 / 100, 1);
  assert!(participant::weapon_line_crit_rate(&aff) == participant::weapon_line_crit_rate(&base), 2); // no-scale guard
  assert!(participant::weapon_line_ap_cost(&aff) == participant::weapon_line_ap_cost(&base), 3); // no-scale guard
  assert!(participant::weapon_line_reach(&aff) == participant::weapon_line_reach(&base), 4); // no-scale guard
  assert!(participant::weapon_line_damage(&aff) > participant::weapon_line_damage(&base), 5); // bands ≥10 ⇒ real +
  let bare_t = participant::weapon_line_of(option::none(), true);
  let bare_f = participant::weapon_line_of(option::none(), false);
  assert!(participant::weapon_line_damage(&bare_t) == participant::weapon_line_damage(&bare_f), 6); // unarmed: no affinity
}

#[test]
/// MATCHING wielder: a real weapon strike deals the +10%-scaled longsword line (the affinity flows through the
/// actual resolver, not just the pure line builder). Deterministic — the HP loss equals the previewable derivation.
fun weapon_strike_affinity_deals_scaled_line() {
  let mut sc = ts::begin(OWNER);
  let w = longsword_line(true); // own-class weapon
  let (mut fight, ver) = active_weapon_fight(&mut sc, 5000, w); // hi hp: survives, stays ACTIVE
  let expected = strike_expect(fight::turn_seed_for_testing(&fight, 0), 0, &w);
  let hp_before = mob::hp(fight::mobs(&fight).borrow(0));
  actions::weapon_for_testing(&mut fight, object::id_from_address(CHAR), 101, &ver, 1000, OWNER);
  let hp_after = mob::hp(fight::mobs(&fight).borrow(0));
  assert!(hp_before - hp_after == expected, 0);
  assert!(expected == participant::weapon_line_damage(&w) || expected == participant::weapon_line_crit_damage(&w), 1);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// MISMATCHED wielder: the same longsword with NO affinity deals the un-scaled band — the strike deals strictly less
/// than the matching wielder would (the pair proves the +10% is real end-to-end and gated on the affinity bool).
fun weapon_strike_no_affinity_deals_base_line() {
  let mut sc = ts::begin(OWNER);
  let w = longsword_line(false); // cross-class weapon (no affinity)
  let (mut fight, ver) = active_weapon_fight(&mut sc, 5000, w);
  let expected = strike_expect(fight::turn_seed_for_testing(&fight, 0), 0, &w);
  let hp_before = mob::hp(fight::mobs(&fight).borrow(0));
  actions::weapon_for_testing(&mut fight, object::id_from_address(CHAR), 101, &ver, 1000, OWNER);
  let hp_after = mob::hp(fight::mobs(&fight).borrow(0));
  assert!(hp_before - hp_after == expected, 0);
  // the un-scaled line is strictly weaker than its affinity twin (same slot ⇒ same crit branch)
  let aff = longsword_line(true);
  assert!(strike_expect(0, 0, &w) < strike_expect(0, 0, &aff), 1);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}
