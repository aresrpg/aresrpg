/// Additive receipt boundaries for committed spell/weapon actions. The deployed `Cast` event stays frozen; this
/// module owns the stable action key, immutable identity snapshots, and the mob-side turn/action dynamic field.
module aresrpg_fight::action_envelope;

use aresrpg_fight::{
  fight::{Self, Fight},
  fight_events,
  participant::WeaponLine,
};
use aresrpg_foundation::spell_effect::{Effect, SpellLevel};
use sui::dynamic_field as df;

const CRIT_BOUND: u64 = 10_000;

public struct MobActionKey has copy, drop, store { mob: u64 }
public struct MobActionState has copy, drop, store { turn: u64, actions: u64 }

/// Start a new mob turn. Production calls this once after refill; direct resolver tests call the same seam.
public(package) fun note_mob_turn(fight: &mut Fight, mob: u64) {
  let key = MobActionKey { mob };
  if (df::exists(fight::uid(fight), key)) {
    let state = df::borrow_mut<MobActionKey, MobActionState>(fight::uid_mut(fight), key);
    state.turn = state.turn + 1;
    state.actions = 0;
  } else {
    df::add(fight::uid_mut(fight), key, MobActionState { turn: 1, actions: 0 });
  };
}

/// The mob's OWN turn counter (0 before its first turn) — the monotonic cooldown / per-turn clock, the mob
/// twin of `cast::seat_turn`. Advances once per mob turn-start via `note_mob_turn`, so it numerically equals
/// @aresrpg/sim's per-round `turn_number` for every mob (each living mob acts once per round).
public(package) fun mob_turn(fight: &Fight, mob: u64): u64 {
  let key = MobActionKey { mob };
  if (df::exists(fight::uid(fight), key)) df::borrow<MobActionKey, MobActionState>(fight::uid(fight), key).turn else 0
}

/// Reserve this committed action's pre-action ordinal. A transaction abort rolls the reservation back.
public(package) fun next_mob_action(fight: &mut Fight, mob: u64): (u64, u64) {
  let key = MobActionKey { mob };
  if (!df::exists(fight::uid(fight), key)) {
    df::add(fight::uid_mut(fight), key, MobActionState { turn: 0, actions: 0 });
  };
  let state = df::borrow_mut<MobActionKey, MobActionState>(fight::uid_mut(fight), key);
  let turn = state.turn;
  let action = state.actions;
  state.actions = action + 1;
  (turn, action)
}

public(package) fun emit_started(
  fight: ID,
  caster_is_mob: bool,
  caster_idx: u64,
  turn: u64,
  action: u64,
  action_kind: u8,
  target: u64,
  ap_cost: u64,
  effect_count: u64,
) {
  fight_events::emit_action_started(
    fight, caster_is_mob, caster_idx, turn, action, action_kind, target, ap_cost, effect_count,
  );
}

public(package) fun emit_effect(
  fight: ID,
  caster_is_mob: bool,
  caster_idx: u64,
  turn: u64,
  action: u64,
  effect_ordinal: u64,
  effect: Effect,
) {
  fight_events::emit_action_effect(
    fight, caster_is_mob, caster_idx, turn, action, effect_ordinal, effect,
  );
}

public(package) fun emit_player_spell(
  fight: ID,
  seat: u64,
  target: u64,
  turn: u64,
  action: u64,
  ap_cost: u64,
  critical: bool,
  fumbled: bool,
  returned: bool,
  spell: ID,
  learned_level: u8,
  level: SpellLevel,
  crit_roll: u64,
  fumble_roll: u64,
  fumble_bound: u64,
  random_domains: vector<u8>,
  random_effect_ordinals: vector<u64>,
  random_rolls: vector<u64>,
  random_bounds: vector<u64>,
  effects: vector<Effect>,
) {
  fight_events::emit_action_resolved(
    fight, false, seat, target, fight_events::action_kind_spell(), turn, action, ap_cost,
    critical, fumbled, returned, option::some(spell), learned_level, option::some(level),
    option::none(), option::none(), 0, 0, 0, 0, 0, 0, vector[], crit_roll, CRIT_BOUND,
    fumble_roll, fumble_bound, random_domains, random_effect_ordinals, random_rolls, random_bounds, effects,
  );
}

public(package) fun emit_mob_spell(
  fight: ID,
  mob: u64,
  target: u64,
  turn: u64,
  action: u64,
  ap_cost: u64,
  fumbled: bool,
  returned: bool,
  group_template: ID,
  spell_ordinal: u64,
  level: SpellLevel,
  fumble_roll: u64,
  fumble_bound: u64,
  random_domains: vector<u8>,
  random_effect_ordinals: vector<u64>,
  random_rolls: vector<u64>,
  random_bounds: vector<u64>,
  effects: vector<Effect>,
) {
  fight_events::emit_action_resolved(
    fight, true, mob, target, fight_events::action_kind_spell(), turn, action, ap_cost,
    false, fumbled, returned, option::none(), 0, option::some(level), option::some(group_template),
    option::some(spell_ordinal), 0, 0, 0, 0, 0, 0, vector[], 0, 0, fumble_roll, fumble_bound,
    random_domains, random_effect_ordinals, random_rolls, random_bounds, effects,
  );
}

public(package) fun emit_weapon(
  fight: ID,
  seat: u64,
  target: u64,
  turn: u64,
  action: u64,
  critical: bool,
  element: u8,
  damage: u64,
  crit_damage: u64,
  crit_rate: u64,
  ap_cost: u64,
  reach: u64,
  lines: vector<WeaponLine>,
  crit_roll: u64,
  random_domains: vector<u8>,
  random_effect_ordinals: vector<u64>,
  random_rolls: vector<u64>,
  random_bounds: vector<u64>,
  effect: Effect,
) {
  fight_events::emit_action_resolved(
    fight, false, seat, target, fight_events::action_kind_weapon(), turn, action, ap_cost,
    critical, false, false, option::none(), 0, option::none(), option::none(), option::none(),
    element, damage, crit_damage, crit_rate, ap_cost, reach, lines, crit_roll, CRIT_BOUND, 0, 0,
    random_domains, random_effect_ordinals, random_rolls, random_bounds, vector[effect],
  );
}
