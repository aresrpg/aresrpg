/// RED-FIRST Move twins for the ruled chain arms. These vectors deliberately describe the required end-state,
/// not today's partial record/no-op behavior. They mirror the sim fixtures with a plain player, one plain mob,
/// fixed values, deterministic point zones, and the standard Fight event stream.
#[test_only]
module aresrpg_fight::chain_arms_twin_vectors;

use aresrpg_fight::{
  cast,
  fight::{Self, Fight},
  fight_events,
  fight_scaffold::{combatant, create_fight, mk_clock, plain_stats, stand_up, tsreg},
  mob,
  participant,
  statuses,
  version::Version,
};
use aresrpg_foundation::{
  spell,
  spell_board,
  spell_effect::{Self, Effect, SpellLevel},
};
use aresrpg_spells::spell_template::SpellTemplate;
use sui::{clock, event, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0;
const WORLD: address = @0x704D;
// Sim matrix fixture: caster (2,4), enemy (4,4) on the shared 20-cell stride.
const PLAYER_CELL: u64 = 82;
const MOB_CELL: u64 = 84;
const MOB_FID: u64 = 1_000;
const ERequiredState: u64 = 108;
const EForbiddenState: u64 = 109;

fun effect_of(kind: u8, value: u64, turns: u8, stat: u8, flags: u8, filter: u8): Effect {
  spell_effect::new_effect(
    kind,
    spell::el_none(),
    value,
    spell_effect::shape_point(),
    0,
    filter,
    100,
    turns,
    stat,
    flags,
    spell_effect::phase_on_enter(),
  )
}

fun prepare(fight: &mut Fight) {
  participant::set_cell(fight::participants_mut(fight).borrow_mut(0), PLAYER_CELL);
  mob::set_cell(fight::mobs_mut(fight).borrow_mut(0), MOB_CELL);
  participant::begin_turn(fight::participants_mut(fight).borrow_mut(0), 0, 0, 0, 0);
}

fun fresh_fight(sc: &mut Scenario): Fight {
  stand_up(sc);
  create_fight(sc, 100, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  prepare(&mut fight);
  fight
}

fun finish(sc: Scenario, fight: Fight) {
  ts::return_shared(fight);
  sc.end();
}

fun finish_spell(sc: Scenario, fight: Fight, spell: SpellTemplate) {
  ts::return_shared(fight);
  ts::return_shared(spell);
  sc.end();
}

fun apply_player(fight: &mut Fight, effect: &Effect, target_cell: u64) {
  let stats = plain_stats();
  let mut rng = 7;
  cast::apply_effect_for_testing(
    fight, 0, 0, PLAYER_CELL, &stats, 50, target_cell, effect, &mut rng,
  );
}

fun apply_mob(fight: &mut Fight, effect: &Effect, target_cell: u64) {
  let stats = plain_stats();
  let mut rng = 9;
  cast::apply_effect_for_testing(
    fight, 1, 0, MOB_CELL, &stats, 50, target_cell, effect, &mut rng,
  );
}

fun gated_damage_level(min_char_level: u16, required_state: u16, forbidden_state: u16): SpellLevel {
  let required = if (required_state == 0) vector[] else vector[required_state];
  let forbidden = if (forbidden_state == 0) vector[] else vector[forbidden_state];
  spell_effect::new_spell_level(
    min_char_level,
    1,
    1,
    4,
    false,
    false,
    false,
    false,
    255,
    255,
    0,
    0,
    false,
    required,
    forbidden,
    vector[spell_effect::damage(spell::el_earth(), 10)],
    vector[],
  )
}

fun mint_damage_spell(sc: &mut Scenario, required_state: u16, forbidden_state: u16) {
  sc.next_tx(OWNER);
  aresrpg_spells::version::test_init(sc.ctx());
  aresrpg_spells::admin::test_init(sc.ctx());
  aresrpg_spells::spell_template::test_init(sc.ctx());
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<aresrpg_spells::admin::AdminCap>();
  let version = sc.take_shared<aresrpg_spells::version::Version>();
  let mut registry = sc.take_shared<aresrpg_spells::spell_template::SpellRegistry>();
  let levels = vector[
    gated_damage_level(1, required_state, forbidden_state),
    gated_damage_level(1, required_state, forbidden_state),
    gated_damage_level(1, required_state, forbidden_state),
    gated_damage_level(1, required_state, forbidden_state),
    gated_damage_level(1, required_state, forbidden_state),
    gated_damage_level(101, required_state, forbidden_state),
  ];
  aresrpg_spells::spell_template::mint_spell(
    &cap,
    &mut registry,
    b"senshi".to_string(),
    1,
    b"Chain arm twin".to_string(),
    levels,
    10,
    0,
    &version,
    sc.ctx(),
  );
  ts::return_shared(registry);
  ts::return_shared(version);
  sc.return_to_sender(cap);
}

fun spell_fight(sc: &mut Scenario, required_state: u16, forbidden_state: u16): (Fight, SpellTemplate) {
  stand_up(sc);
  create_fight(sc, 100, 1, 0, 1000, true, option::none());
  mint_damage_spell(sc, required_state, forbidden_state);
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let spell = sc.take_shared<SpellTemplate>();
  prepare(&mut fight);
  (fight, spell)
}

fun assert_displaced(index: u64, target_is_mob: bool, kind: u8, from_cell: u64, to_cell: u64) {
  let events = event::events_by_type<fight_events::Displaced>();
  let (_fight, got_side, got_idx, got_kind, got_from, got_to, _requested, _blocked) =
    fight_events::displaced_for_testing(events.borrow(index));
  assert!(got_side == target_is_mob && got_idx == 0);
  assert!(got_kind == kind && got_from == from_cell && got_to == to_cell);
}

#[test, expected_failure(abort_code = ERequiredState, location = aresrpg_fight::cast)]
/// Sim twin: APPLY_STATE(788, 1t) is a live named row. It admits a required-state cast, then its expiry makes the
/// same cast illegal. The expected abort is deliberately the second cast.
fun apply_state_row_drives_required_gate_and_expires() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, spell) = spell_fight(&mut sc, 788, 0);
  let state = effect_of(
    spell_effect::k_apply_state(), 788, 1, 0, 0, spell_effect::tf_only_caster(),
  );
  apply_player(&mut fight, &state, PLAYER_CELL);
  assert!(spell_board::fighter_has_state(fight::fx(&fight), 0, 788));

  cast::resolve_player_cast(&mut fight, 0, &spell, MOB_CELL);
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 90);
  cast::tick_turn_end(&mut fight, false, 0);
  assert!(!spell_board::fighter_has_state(fight::fx(&fight), 0, 788));

  cast::resolve_player_cast(&mut fight, 0, &spell, MOB_CELL);
  finish_spell(sc, fight, spell);
}

#[test, expected_failure(abort_code = EForbiddenState, location = aresrpg_fight::cast)]
/// The required-state gate's inverse: a live forbidden state rejects the cast before any payload write.
fun apply_state_row_drives_forbidden_gate() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, spell) = spell_fight(&mut sc, 0, 788);
  let state = effect_of(
    spell_effect::k_apply_state(), 788, 2, 0, 0, spell_effect::tf_only_caster(),
  );
  apply_player(&mut fight, &state, PLAYER_CELL);
  assert!(spell_board::fighter_has_state(fight::fx(&fight), 0, 788));

  cast::resolve_player_cast(&mut fight, 0, &spell, MOB_CELL);
  finish_spell(sc, fight, spell);
}

#[test]
/// Sim twin: STEAL_STAT strength 11/3t debits the target and gives the caster an equal timed mirror leg. Each
/// fighter's own three turn-ends removes its row and re-derives the original stats.
fun steal_stat_has_two_timed_legs_and_both_expire() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  let steal = effect_of(
    spell_effect::k_steal_stat(), 11, 3, spell_effect::stat_strength(), 0,
    spell_effect::tf_not_team(),
  );

  apply_player(&mut fight, &steal, MOB_CELL);
  // The sim fixture starts from an empty stat block. Move's unsigned live stat saturates at zero, while the exact
  // -11 debit remains in the timed row and therefore still reverts without leaking a gain.
  assert!(spell::stat_strength(mob::stats(fight::mobs(&fight).borrow(0))) == 0);
  assert!(spell::stat_strength(participant::stats(fight::participants(&fight).borrow(0))) == 11);
  assert!(spell_board::status_count(fight::fx(&fight)) == 2);
  let debit = spell_board::fighter_status_of(
    fight::fx(&fight), MOB_FID, spell_effect::k_alter_stat(),
  );
  assert!(debit.is_some());
  assert!(debit.borrow().value() == 11 && debit.borrow().has_flag(spell_effect::flag_negative()));

  cast::tick_turn_end(&mut fight, true, 0);
  cast::tick_turn_end(&mut fight, false, 0);
  cast::tick_turn_end(&mut fight, true, 0);
  cast::tick_turn_end(&mut fight, false, 0);
  cast::tick_turn_end(&mut fight, true, 0);
  cast::tick_turn_end(&mut fight, false, 0);
  assert!(spell::stat_strength(mob::stats(fight::mobs(&fight).borrow(0))) == 0);
  assert!(spell::stat_strength(participant::stats(fight::participants(&fight).borrow(0))) == 0);
  assert!(spell_board::status_count(fight::fx(&fight)) == 0);
  finish(sc, fight);
}

#[test]
/// A timed REFLECT_DAMAGE row applies its flat value to the attributable attacker after the incoming line. It is
/// not the percentage-based DAMAGE_REDIRECT kind and stops at the raw reflected hit.
fun reflect_damage_consumes_flat_row_on_incoming_hit() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  let reflect = effect_of(
    spell_effect::k_reflect_damage(), 2, 2, 0, 0, spell_effect::tf_only_caster(),
  );
  apply_player(&mut fight, &reflect, PLAYER_CELL);
  assert!(spell_board::fighter_status_of(
    fight::fx(&fight), 0, spell_effect::k_reflect_damage(),
  ).is_some());

  let hit = spell_effect::damage(spell::el_earth(), 10);
  apply_mob(&mut fight, &hit, PLAYER_CELL);
  assert!(participant::hp(fight::participants(&fight).borrow(0)) == 90);
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 98);
  let hits = event::events_by_type<fight_events::Hit>();
  assert!(hits.length() == 2);
  let (_f0, side0, idx0, amount0, hp0) = fight_events::hit_for_testing(hits.borrow(0));
  let (_f1, side1, idx1, amount1, hp1) = fight_events::hit_for_testing(hits.borrow(1));
  assert!(!side0 && idx0 == 0 && amount0 == 10 && hp0 == 90);
  assert!(side1 && idx1 == 0 && amount1 == 2 && hp1 == 98);

  cast::tick_turn_end(&mut fight, false, 0);
  cast::tick_turn_end(&mut fight, false, 0);
  assert!(spell_board::fighter_status_of(
    fight::fx(&fight), 0, spell_effect::k_reflect_damage(),
  ).is_none());
  apply_mob(&mut fight, &hit, PLAYER_CELL);
  assert!(participant::hp(fight::participants(&fight).borrow(0)) == 80);
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 98);
  finish(sc, fight);
}

#[test]
/// Engine-level DISPEL twin: the authored arm, not merely the board primitive, strips only flagged rows and
/// reconciles every derived/presentation view through the ordinary expiry sinks.
fun dispel_cast_filters_rows_and_reconciles_live_views() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  let base = spell::new_stats(20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  mob::set_stats_for_testing(fight::mobs_mut(&mut fight).borrow_mut(0), base);

  let debuff = spell_effect::alter_stat(spell_effect::stat_strength(), 5, true, true, 3);
  let sticky = effect_of(
    spell_effect::k_apply_state(), 111, 2, 0, 0, spell_effect::tf_not_team(),
  );
  let hidden = effect_of(
    spell_effect::k_invisibility(), 0, 2, 0, spell_effect::flag_dispellable(),
    spell_effect::tf_not_team(),
  );
  let stance = effect_of(
    spell_effect::k_stance(), 77, 2, 0, spell_effect::flag_dispellable(),
    spell_effect::tf_not_team(),
  );
  apply_player(&mut fight, &debuff, MOB_CELL);
  apply_player(&mut fight, &sticky, MOB_CELL);
  apply_player(&mut fight, &hidden, MOB_CELL);
  apply_player(&mut fight, &stance, MOB_CELL);
  assert!(spell::stat_strength(mob::stats(fight::mobs(&fight).borrow(0))) == 15);
  assert!(statuses::is_invisible(&fight, true, 0));
  assert!(event::events_by_type<fight_events::StanceChanged>().length() == 1);

  let dispel = effect_of(
    spell_effect::k_dispel(), 0, 1, 0, 0, spell_effect::tf_not_team(),
  );
  apply_player(&mut fight, &dispel, MOB_CELL);

  assert!(spell::stat_strength(mob::stats(fight::mobs(&fight).borrow(0))) == 20);
  assert!(!statuses::is_invisible(&fight, true, 0));
  assert!(event::events_by_type<fight_events::Revealed>().length() == 1);
  assert!(event::events_by_type<fight_events::StanceChanged>().length() == 2);
  assert!(spell_board::status_count(fight::fx(&fight)) == 1);
  assert!(spell_board::fighter_has_state(fight::fx(&fight), MOB_FID, 111));
  finish(sc, fight);
}

#[test]
/// RETURN_SPELL redirects the incoming point cast to its original caster. Both fighters hold return rows, proving
/// the returned cast is tagged depth 1 and cannot bounce back to the original target.
fun return_spell_redirects_once_at_depth_one() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, spell) = spell_fight(&mut sc, 0, 0);
  let return_enemy = effect_of(
    spell_effect::k_return_spell(), 0, 2, 0, 0, spell_effect::tf_not_team(),
  );
  let return_self = effect_of(
    spell_effect::k_return_spell(), 0, 2, 0, 0, spell_effect::tf_only_caster(),
  );
  apply_player(&mut fight, &return_enemy, MOB_CELL);
  apply_player(&mut fight, &return_self, PLAYER_CELL);
  assert!(spell_board::fighter_status_of(
    fight::fx(&fight), MOB_FID, spell_effect::k_return_spell(),
  ).is_some());
  assert!(spell_board::fighter_status_of(
    fight::fx(&fight), 0, spell_effect::k_return_spell(),
  ).is_some());

  cast::resolve_player_cast(&mut fight, 0, &spell, MOB_CELL);
  assert!(participant::hp(fight::participants(&fight).borrow(0)) == 90);
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 100);
  let hits = event::events_by_type<fight_events::Hit>();
  assert!(hits.length() == 1);
  let (_fight, victim_is_mob, victim_idx, amount, remaining) =
    fight_events::hit_for_testing(hits.borrow(0));
  assert!(!victim_is_mob && victim_idx == 0 && amount == 10 && remaining == 90);
  finish_spell(sc, fight, spell);
}

#[test]
/// Sim twin: player 82 and mob 84 atomically exchange cells and each relocation emits Displaced.
fun swap_positions_exchanges_both_cells_and_emits_both() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  let swap = effect_of(
    spell_effect::k_swap_positions(), 1, 0, 0, 0, spell_effect::tf_not_team(),
  );
  apply_player(&mut fight, &swap, MOB_CELL);

  assert!(participant::cell(fight::participants(&fight).borrow(0)) == MOB_CELL);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == PLAYER_CELL);
  assert!(event::events_by_type<fight_events::Displaced>().length() == 2);
  assert_displaced(0, true, spell_effect::k_swap_positions(), MOB_CELL, PLAYER_CELL);
  assert_displaced(1, false, spell_effect::k_swap_positions(), PLAYER_CELL, MOB_CELL);
  finish(sc, fight);
}

#[test]
/// Sim twin: carry directly relocates the target onto the caster's occupied cell and emits one Displaced.
fun carry_colocates_target_with_caster_and_emits() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  let carry = effect_of(
    spell_effect::k_carry(), 1, 0, 0, 0, spell_effect::tf_not_team(),
  );
  apply_player(&mut fight, &carry, MOB_CELL);

  assert!(participant::cell(fight::participants(&fight).borrow(0)) == PLAYER_CELL);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == PLAYER_CELL);
  assert!(event::events_by_type<fight_events::Displaced>().length() == 1);
  assert_displaced(0, true, spell_effect::k_carry(), MOB_CELL, PLAYER_CELL);
  finish(sc, fight);
}

#[test]
/// Sim twin: the degenerate target-cell throw uses the minimum bounded heave, one cell along caster->target.
fun throw_uses_minimum_heave_and_emits() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  let throw = effect_of(
    spell_effect::k_throw(), 1, 0, 0, 0, spell_effect::tf_not_team(),
  );
  apply_player(&mut fight, &throw, MOB_CELL);

  assert!(participant::cell(fight::participants(&fight).borrow(0)) == PLAYER_CELL);
  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 85);
  assert!(event::events_by_type<fight_events::Displaced>().length() == 1);
  assert_displaced(0, true, spell_effect::k_throw(), MOB_CELL, 85);
  finish(sc, fight);
}

fun mob_glyph_level(): SpellLevel {
  spell_effect::new_spell_level(
    1,
    1,
    1,
    4,
    false,
    false,
    false,
    true,
    255,
    255,
    0,
    0,
    false,
    vector[],
    vector[],
    vector[
      spell_effect::place_glyph(spell_effect::shape_point(), 0, 2, false),
      spell_effect::damage(spell::el_earth(), 7),
    ],
    vector[],
  )
}

fun mob_glyph_fight(sc: &mut Scenario): Fight {
  mob_spell_fight(sc, mob_glyph_level())
}

fun mob_spell_fight(sc: &mut Scenario, level: SpellLevel): Fight {
  stand_up(sc);
  sc.next_tx(OWNER);
  let mut registry = tsreg(sc);
  let version = sc.take_shared<Version>();
  let clock = mk_clock(sc, 1000);
  let spec = mob::new_mob_spec(
    1, 1, 100, 6, 0, plain_stats(), vector[level], 100, vector[],
  );
  fight::create_for_testing(
    &mut registry,
    object::id_from_address(WORLD),
    1,
    12345,
    100,
    200,
    0,
    true,
    option::none(),
    &spec,
    1,
    combatant(CHAR, 100),
    &version,
    &clock,
    sc.ctx(),
  );
  clock::destroy_for_testing(clock);
  ts::return_shared(registry);
  ts::return_shared(version);
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  prepare(&mut fight);
  fight
}

fun mob_utility_level(): SpellLevel {
  spell_effect::new_spell_level(
    1, 1, 1, 4, false, false, false, false, 255, 255, 0, 0, false,
    vector[], vector[],
    vector[effect_of(
      spell_effect::k_apply_state(), 42, 1, 0, 0, spell_effect::tf_not_team(),
    )],
    vector[],
  )
}

#[test]
/// RETURN suppresses the point utility payload at depth one, but a zero-damage return is not a positive direct
/// attack and therefore must not reveal the invisible original caster.
fun returned_utility_cast_does_not_reveal_caster() {
  let mut sc = ts::begin(OWNER);
  let mut fight = mob_spell_fight(&mut sc, mob_utility_level());
  let returned = effect_of(
    spell_effect::k_return_spell(), 0, 2, 0, 0, spell_effect::tf_not_team(),
  );
  let hidden = effect_of(
    spell_effect::k_invisibility(), 0, 2, 0, 0, spell_effect::tf_only_caster(),
  );
  apply_mob(&mut fight, &returned, PLAYER_CELL);
  apply_mob(&mut fight, &hidden, MOB_CELL);
  assert!(statuses::is_invisible(&fight, true, 0));

  let mut rng = 11;
  cast::resolve_mob_cast(&mut fight, 0, 0, PLAYER_CELL, &mut rng);

  assert!(statuses::is_invisible(&fight, true, 0));
  assert!(event::events_by_type<fight_events::Revealed>().is_empty());
  assert!(!spell_board::fighter_has_state(fight::fx(&fight), 0, 42));
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 100);
  finish(sc, fight);
}

#[test]
/// A mob-authored placement follows the player placement contract: the non-placement line becomes glyph payload,
/// does not fire immediately, and ticks when a fighter later stands on the anchor.
fun mob_authored_place_glyph_stores_payload_then_ticks() {
  let mut sc = ts::begin(OWNER);
  let mut fight = mob_glyph_fight(&mut sc);
  let mut rng = 11;

  cast::resolve_mob_cast(&mut fight, 0, 0, 166, &mut rng);
  assert!(spell_board::entry_count(fight::fx(&fight)) == 1);
  assert!(participant::hp(fight::participants(&fight).borrow(0)) == 100);

  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 166);
  assert!(cast::tick_turn_start(&mut fight, false, 0));
  assert!(participant::hp(fight::participants(&fight).borrow(0)) == 93);
  assert!(spell_board::entry_count(fight::fx(&fight)) == 1);
  finish(sc, fight);
}
