/// EVENTS — the single home for every Fight lifecycle event (§7 "every state change observable via events" —
/// the RPC indexer + the client's optimistic-prediction reconciliation feed). One module so the indexer watches
/// one file for the whole fight contract. Every transition has an event: created / joined / placed / ready /
/// turn-started / moved / displaced / cast / hit / turn-ended / abandoned / victory / defeat / settled / result-minted /
/// result-opened / loot-minted / result-burned / swept. All emit fns are `public(package)` — fired by `fight` /
/// `turns` / `actions` / `cast` / `results`.
module aresrpg_fight::fight_events;

use aresrpg_fight::participant::WeaponLine;
use aresrpg_foundation::spell_effect::{Effect, SpellLevel};
use sui::event;

const ACTION_KIND_SPELL: u8 = 0;
const ACTION_KIND_WEAPON: u8 = 1;
const RANDOM_DOMAIN_RETURN: u8 = 0;
const RANDOM_DOMAIN_EFFECT_CHANCE: u8 = 1;
const RANDOM_DOMAIN_DAMAGE_INVERSION: u8 = 2;
const RANDOM_DOMAIN_DRAIN: u8 = 3;
const NO_EFFECT_ORDINAL: u64 = 18_446_744_073_709_551_615;

public struct FightCreated has copy, drop {
  fight: ID,
  world: ID,
  spawn_id: u64,
  anchor_x: u32,
  anchor_z: u32,
  public_fight: bool,
  aged_bp: u64,
  mob_count: u64,
}
public struct FightJoined has copy, drop { fight: ID, character: ID, seat: u64 }
public struct Placed has copy, drop { fight: ID, character: ID, cell: u64 }
public struct Ready has copy, drop { fight: ID, character: ID }
public struct TurnStarted has copy, drop { fight: ID, is_mob: bool, idx: u64, deadline_ms: u64 }
public struct Moved has copy, drop { fight: ID, character: ID, to_cell: u64 }
/// A MOB repositioned during its turn. Keyed by `idx` (the mob's slot), NOT an object id — mobs have no standalone
/// object like a Character, so every mob-side event (Cast/Hit/TurnStarted/TurnEnded) keys by `idx`; this mirrors
/// them. Fires ONLY on a reposition-only mob turn; spell and trap displacement emits `Displaced` instead.
public struct MobMoved has copy, drop { fight: ID, idx: u64, to_cell: u64 }
/// A spell/trap PUSH or PULL attempt — and a caster TELEPORT (kind=k_teleport, requested=blocked=0: instant, no
/// collision walk), both riding this one fighter-A→B seam so the client renders the relocation. `blocked` counts
/// only cells denied by a hard collision; a trap force-stop and a zero direction report zero. Both target sides.
public struct Displaced has copy, drop {
  fight: ID,
  target_is_mob: bool,
  target_idx: u64,
  kind: u8,
  from_cell: u64,
  to_cell: u64,
  requested: u64,
  blocked: u64,
}
public struct Cast has copy, drop { fight: ID, caster_is_mob: bool, caster_idx: u64, target_cell: u64 }
/// Leading boundary for one committed spell/weapon action. The stable `(fight, caster side/index, turn, action)`
/// key partitions the following cross-type effect events without changing the deployed `Cast` layout.
public struct ActionStarted has copy, drop {
  fight: ID,
  caster_is_mob: bool,
  caster_idx: u64,
  turn_ordinal: u64,
  action_ordinal: u64,
  action_kind: u8,
  target_cell: u64,
  ap_cost: u64,
  effect_count: u64,
}
/// Immediately precedes resolution of one authored top-level effect. Exact descriptors remove any corpus lookup
/// or repeated-kind ambiguity; ordinary effect events retain their existing layouts and follow this marker.
public struct ActionEffect has copy, drop {
  fight: ID,
  caster_is_mob: bool,
  caster_idx: u64,
  turn_ordinal: u64,
  action_ordinal: u64,
  effect_ordinal: u64,
  effect: Effect,
}
/// Terminal receipt envelope, emitted after the frozen `Cast`. Identity arms are mutually exclusive: player
/// spells carry object+learned-level, mobs carry group-template+kit ordinal, and weapons carry their immutable
/// seated snapshot. SpellLevel/effect/weapon-line copies are execution-time truth, independent of later tuning.
public struct ActionResolved has copy, drop {
  fight: ID,
  caster_is_mob: bool,
  caster_idx: u64,
  target_cell: u64,
  action_kind: u8,
  turn_ordinal: u64,
  action_ordinal: u64,
  ap_cost: u64,
  critical: bool,
  fumbled: bool,
  returned: bool,
  spell: Option<ID>,
  learned_level: u8,
  spell_level: Option<SpellLevel>,
  mob_template: Option<ID>,
  mob_spell_ordinal: Option<u64>,
  weapon_element: u8,
  weapon_damage: u64,
  weapon_crit_damage: u64,
  weapon_crit_rate: u64,
  weapon_ap_cost: u64,
  weapon_reach: u64,
  weapon_lines: vector<WeaponLine>,
  crit_roll: u64,
  crit_bound: u64,
  fumble_roll: u64,
  fumble_bound: u64,
  random_domains: vector<u8>,
  random_effect_ordinals: vector<u64>,
  random_rolls: vector<u64>,
  random_bounds: vector<u64>,
  effects: vector<Effect>,
}
/// A status-driven 1-in-N fumble committed the cast but suppressed its payload.
public struct CriticalFailure has copy, drop { fight: ID, caster_is_mob: bool, caster_idx: u64 }
/// Presentation seam for a mechanics-owned stance. `active=false` is explicit removal or natural expiry.
public struct StanceChanged has copy, drop { fight: ID, fighter_is_mob: bool, fighter_idx: u64, stance: u64, active: bool }
/// An invisible fighter was REVEALED — every invisibility row on it is gone. Fired by a positive DIRECT damaging
/// cast / weapon / displacement-collision FROM the hidden fighter (1.29: only positive direct damage reveals the
/// damager), or a reveal spell landing on it; the client clears the hidden state for `idx`. Keyed side+idx like
/// every fighter event. NEVER fires on an already-visible fighter — the reveal is a guarded no-op there.
public struct Revealed has copy, drop { fight: ID, is_mob: bool, idx: u64 }
public struct Hit has copy, drop { fight: ID, victim_is_mob: bool, victim_idx: u64, amount: u64, remaining_hp: u64 }
/// An AP/MP DRAIN outcome (k_remove_points / k_steal_points) — `removed` < `requested` means the target DODGED
/// part or all of it (the log must always show "resisted/dodged", never a silent nothing). `point_kind`
/// 0 = AP / 1 = MP. Keyed by idx like every fighter event; the indexer projects it onto the combat + drain log.
public struct Drain has copy, drop { fight: ID, target_is_mob: bool, target_idx: u64, point_kind: u8, removed: u64, requested: u64 }
/// A FAILED tackle escape (the ordinary-movement contest — chain twin of the sim rule, fight_actions.js:63-100):
/// the runner tried to leave a living adjacent enemy's tackle zone and lost the agility contest — the move is
/// DENIED and the runner loses the failed fraction of both pools (`ap_lost`/`mp_lost`, ceil-rounded). `num`/`den`
/// is the escape fraction it rolled against (the client renders the odds; a successful escape emits nothing —
/// the Moved/MobMoved event IS the success signal). Keyed by side+idx like every fighter event.
public struct Tackled has copy, drop { fight: ID, runner_is_mob: bool, runner_idx: u64, ap_lost: u64, mp_lost: u64, num: u64, den: u64 }
public struct TurnEnded has copy, drop { fight: ID, is_mob: bool, idx: u64 }
/// A seated player quit the fight — treated as DEATH (hp→0). The indexer projects it exactly like a lethal Hit
/// on `seat` (mirrors FightJoined's shape); the terminal/turn events that may follow ride their own emits.
public struct Abandoned has copy, drop { fight: ID, character: ID, seat: u64 }
public struct Victory has copy, drop { fight: ID, aged_bp: u64 }
public struct Defeat has copy, drop { fight: ID }
public struct Settled has copy, drop { fight: ID, outcome: u8, results: u64 }
public struct ResultMinted has copy, drop { result: ID, fight: ID, character: ID, owner: address, outcome: u8, xp_share: u64, final_hp: u64 }
public struct ResultOpened has copy, drop { result: ID, character: ID, xp_share: u64, loot_units: u64 }
public struct LootMinted has copy, drop { result: ID, item_template: ID, qty: u64 }
public struct ResultBurned has copy, drop { result: ID }
public struct Swept has copy, drop { fight: ID }

public(package) fun emit_created(fight: ID, world: ID, spawn_id: u64, anchor_x: u32, anchor_z: u32, public_fight: bool, aged_bp: u64, mob_count: u64) {
  event::emit(FightCreated { fight, world, spawn_id, anchor_x, anchor_z, public_fight, aged_bp, mob_count });
}
public(package) fun emit_joined(fight: ID, character: ID, seat: u64) { event::emit(FightJoined { fight, character, seat }); }
public(package) fun emit_placed(fight: ID, character: ID, cell: u64) { event::emit(Placed { fight, character, cell }); }
public(package) fun emit_ready(fight: ID, character: ID) { event::emit(Ready { fight, character }); }
public(package) fun emit_turn_started(fight: ID, is_mob: bool, idx: u64, deadline_ms: u64) { event::emit(TurnStarted { fight, is_mob, idx, deadline_ms }); }
public(package) fun emit_moved(fight: ID, character: ID, to_cell: u64) { event::emit(Moved { fight, character, to_cell }); }
public(package) fun emit_mob_moved(fight: ID, idx: u64, to_cell: u64) { event::emit(MobMoved { fight, idx, to_cell }); }
public(package) fun emit_displaced(fight: ID, target_is_mob: bool, target_idx: u64, kind: u8, from_cell: u64, to_cell: u64, requested: u64, blocked: u64) {
  event::emit(Displaced { fight, target_is_mob, target_idx, kind, from_cell, to_cell, requested, blocked });
}
public(package) fun emit_cast(fight: ID, caster_is_mob: bool, caster_idx: u64, target_cell: u64) { event::emit(Cast { fight, caster_is_mob, caster_idx, target_cell }); }
public(package) fun emit_action_started(
  fight: ID,
  caster_is_mob: bool,
  caster_idx: u64,
  turn_ordinal: u64,
  action_ordinal: u64,
  action_kind: u8,
  target_cell: u64,
  ap_cost: u64,
  effect_count: u64,
) {
  event::emit(ActionStarted {
    fight, caster_is_mob, caster_idx, turn_ordinal, action_ordinal, action_kind, target_cell, ap_cost, effect_count,
  });
}
public(package) fun emit_action_effect(
  fight: ID,
  caster_is_mob: bool,
  caster_idx: u64,
  turn_ordinal: u64,
  action_ordinal: u64,
  effect_ordinal: u64,
  effect: Effect,
) {
  event::emit(ActionEffect {
    fight, caster_is_mob, caster_idx, turn_ordinal, action_ordinal, effect_ordinal, effect,
  });
}
public(package) fun emit_action_resolved(
  fight: ID,
  caster_is_mob: bool,
  caster_idx: u64,
  target_cell: u64,
  action_kind: u8,
  turn_ordinal: u64,
  action_ordinal: u64,
  ap_cost: u64,
  critical: bool,
  fumbled: bool,
  returned: bool,
  spell: Option<ID>,
  learned_level: u8,
  spell_level: Option<SpellLevel>,
  mob_template: Option<ID>,
  mob_spell_ordinal: Option<u64>,
  weapon_element: u8,
  weapon_damage: u64,
  weapon_crit_damage: u64,
  weapon_crit_rate: u64,
  weapon_ap_cost: u64,
  weapon_reach: u64,
  weapon_lines: vector<WeaponLine>,
  crit_roll: u64,
  crit_bound: u64,
  fumble_roll: u64,
  fumble_bound: u64,
  random_domains: vector<u8>,
  random_effect_ordinals: vector<u64>,
  random_rolls: vector<u64>,
  random_bounds: vector<u64>,
  effects: vector<Effect>,
) {
  event::emit(ActionResolved {
    fight, caster_is_mob, caster_idx, target_cell, action_kind, turn_ordinal, action_ordinal, ap_cost,
    critical, fumbled, returned, spell, learned_level, spell_level, mob_template, mob_spell_ordinal,
    weapon_element, weapon_damage, weapon_crit_damage, weapon_crit_rate, weapon_ap_cost, weapon_reach,
    weapon_lines, crit_roll, crit_bound, fumble_roll, fumble_bound, random_domains,
    random_effect_ordinals, random_rolls, random_bounds, effects,
  });
}
public(package) fun emit_critical_failure(fight: ID, caster_is_mob: bool, caster_idx: u64) {
  event::emit(CriticalFailure { fight, caster_is_mob, caster_idx });
}
public(package) fun emit_stance_changed(fight: ID, fighter_is_mob: bool, fighter_idx: u64, stance: u64, active: bool) {
  event::emit(StanceChanged { fight, fighter_is_mob, fighter_idx, stance, active });
}
public(package) fun emit_revealed(fight: ID, is_mob: bool, idx: u64) { event::emit(Revealed { fight, is_mob, idx }); }
public(package) fun emit_hit(fight: ID, victim_is_mob: bool, victim_idx: u64, amount: u64, remaining_hp: u64) { event::emit(Hit { fight, victim_is_mob, victim_idx, amount, remaining_hp }); }
public(package) fun emit_drain(fight: ID, target_is_mob: bool, target_idx: u64, point_kind: u8, removed: u64, requested: u64) { event::emit(Drain { fight, target_is_mob, target_idx, point_kind, removed, requested }); }
public(package) fun emit_tackled(fight: ID, runner_is_mob: bool, runner_idx: u64, ap_lost: u64, mp_lost: u64, num: u64, den: u64) {
  event::emit(Tackled { fight, runner_is_mob, runner_idx, ap_lost, mp_lost, num, den });
}
public(package) fun emit_turn_ended(fight: ID, is_mob: bool, idx: u64) { event::emit(TurnEnded { fight, is_mob, idx }); }
public(package) fun emit_abandoned(fight: ID, character: ID, seat: u64) { event::emit(Abandoned { fight, character, seat }); }
public(package) fun emit_victory(fight: ID, aged_bp: u64) { event::emit(Victory { fight, aged_bp }); }

/// S-13b ceremony observability: a CreatorCap was minted (RPC audit trail for the custody chain).
public struct CreatorCapIssued has copy, drop { by: address }
public(package) fun emit_creator_cap_issued(by: address) { event::emit(CreatorCapIssued { by }); }
public(package) fun emit_defeat(fight: ID) { event::emit(Defeat { fight }); }
public(package) fun emit_settled(fight: ID, outcome: u8, results: u64) { event::emit(Settled { fight, outcome, results }); }
public(package) fun emit_result_minted(result: ID, fight: ID, character: ID, owner: address, outcome: u8, xp_share: u64, final_hp: u64) {
  event::emit(ResultMinted { result, fight, character, owner, outcome, xp_share, final_hp });
}
public(package) fun emit_result_opened(result: ID, character: ID, xp_share: u64, loot_units: u64) { event::emit(ResultOpened { result, character, xp_share, loot_units }); }
public(package) fun emit_loot_minted(result: ID, item_template: ID, qty: u64) { event::emit(LootMinted { result, item_template, qty }); }
public(package) fun emit_result_burned(result: ID) { event::emit(ResultBurned { result }); }
public(package) fun emit_swept(fight: ID) { event::emit(Swept { fight }); }

#[test_only]
public fun displaced_for_testing(e: &Displaced): (ID, bool, u64, u8, u64, u64, u64, u64) {
  (e.fight, e.target_is_mob, e.target_idx, e.kind, e.from_cell, e.to_cell, e.requested, e.blocked)
}

#[test_only]
public fun hit_for_testing(e: &Hit): (ID, bool, u64, u64, u64) {
  (e.fight, e.victim_is_mob, e.victim_idx, e.amount, e.remaining_hp)
}

#[test_only]
public fun tackled_for_testing(e: &Tackled): (ID, bool, u64, u64, u64, u64, u64) {
  (e.fight, e.runner_is_mob, e.runner_idx, e.ap_lost, e.mp_lost, e.num, e.den)
}

#[test_only]
public fun revealed_for_testing(e: &Revealed): (ID, bool, u64) { (e.fight, e.is_mob, e.idx) }

public fun action_kind_spell(): u8 { ACTION_KIND_SPELL }
public fun action_kind_weapon(): u8 { ACTION_KIND_WEAPON }
public fun random_domain_return(): u8 { RANDOM_DOMAIN_RETURN }
public fun random_domain_effect_chance(): u8 { RANDOM_DOMAIN_EFFECT_CHANCE }
public fun random_domain_damage_inversion(): u8 { RANDOM_DOMAIN_DAMAGE_INVERSION }
public fun random_domain_drain(): u8 { RANDOM_DOMAIN_DRAIN }
public fun no_effect_ordinal(): u64 { NO_EFFECT_ORDINAL }

#[test_only]
public fun action_started_for_testing(e: &ActionStarted): (ID, bool, u64, u64, u64, u8, u64, u64, u64) {
  (e.fight, e.caster_is_mob, e.caster_idx, e.turn_ordinal, e.action_ordinal, e.action_kind, e.target_cell, e.ap_cost, e.effect_count)
}

#[test_only]
public fun action_effect_for_testing(e: &ActionEffect): (ID, bool, u64, u64, u64, u64, Effect) {
  (e.fight, e.caster_is_mob, e.caster_idx, e.turn_ordinal, e.action_ordinal, e.effect_ordinal, e.effect)
}

#[test_only]
public fun action_resolved_core_for_testing(e: &ActionResolved): (ID, bool, u64, u64, u8, u64, u64, u64, bool, bool, bool) {
  (e.fight, e.caster_is_mob, e.caster_idx, e.target_cell, e.action_kind, e.turn_ordinal, e.action_ordinal, e.ap_cost, e.critical, e.fumbled, e.returned)
}

#[test_only]
public fun action_resolved_spell_for_testing(e: &ActionResolved): (Option<ID>, u8) {
  (e.spell, e.learned_level)
}

#[test_only]
public fun action_resolved_mob_spell_for_testing(e: &ActionResolved): (Option<ID>, Option<u64>, Option<SpellLevel>) {
  (e.mob_template, e.mob_spell_ordinal, e.spell_level)
}

#[test_only]
public fun action_resolved_spell_level_for_testing(e: &ActionResolved): Option<SpellLevel> { e.spell_level }

#[test_only]
public fun action_resolved_weapon_for_testing(e: &ActionResolved): (u8, u64, u64, u64, u64, u64) {
  (e.weapon_element, e.weapon_damage, e.weapon_crit_damage, e.weapon_crit_rate, e.weapon_ap_cost, e.weapon_reach)
}

#[test_only]
public fun action_resolved_weapon_lines_for_testing(e: &ActionResolved): vector<WeaponLine> { e.weapon_lines }

#[test_only]
public fun action_resolved_random_for_testing(e: &ActionResolved): (u64, u64, u64, u64, vector<u64>, vector<u64>) {
  (e.crit_roll, e.crit_bound, e.fumble_roll, e.fumble_bound, e.random_rolls, e.random_bounds)
}

#[test_only]
public fun action_resolved_random_labels_for_testing(e: &ActionResolved): (vector<u8>, vector<u64>) {
  (e.random_domains, e.random_effect_ordinals)
}

#[test_only]
public fun action_resolved_effects_for_testing(e: &ActionResolved): (vector<u64>, vector<u8>) {
  let mut ordinals = vector[];
  let mut kinds = vector[];
  let n = e.effects.length();
  let mut i = 0;
  while (i < n) {
    ordinals.push_back(i);
    kinds.push_back(e.effects.borrow(i).kind());
    i = i + 1;
  };
  (ordinals, kinds)
}

#[test_only]
public fun action_resolved_effect_descriptors_for_testing(e: &ActionResolved): vector<Effect> { e.effects }
