// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// CAST — the 1.29 effect resolver (harvested from `dungeon_cast`, rewired off the dead `spell_registry` onto
/// `aresrpg::spell_template` + the frozen `aresrpg_foundation` algebra). Resolves a caster's spell level
/// → `spell_target::can_cast_at` (geometry/occupancy/LOS) → per-effect zone (`combat_grid::zone_cells`) →
/// per-fighter team filter (`spell_target::effect_hits`) → a dispatch over the effect kinds, computing values
/// through `spell_formula` (§5h amplify/resist). FULLY DETERMINISTIC (single-PTB turn law 2026-07-11): the crit
/// boolean derives from the public turn seed (§7), damage is the authored base, and no effect kind draws —
/// so player actions batch freely ahead of the turn's one terminal `&Random` crank. Serves both
/// PLAYER casts (the commit action) and MOB casts (the §17.21 AI's chosen spell).
///
/// SPELL LEVEL: a player's allocated spell level lives in the future character-progression DF (declared game
/// seam, not built) — so casts resolve at LEVEL 1 (the free unlock) until that lands. Mobs cast the exact
/// `SpellLevel` their kit carries. COVERAGE: the direct combat families are resolved (damage / heal /
/// life-steal / %-life / caster-damage / give·remove·steal points / alter-stat·resist / steal-stat / push /
/// pull / teleport / swap) plus board placement (traps / glyphs) + DoT. The board-status control kinds
/// (invisibility / reflect / reduce / return / dispel / reveal / carry / throw / reset / named states) persist
/// on the foundation effect board via `record` and are a faithful-port extension (no shipped content uses them
/// yet — the dungeon_cast note); their machinery already lives in `spell_board`.
module aresrpg_fight::cast;

use aresrpg_fight::{
  action_envelope,
  displacement,
  fight_events,
  fight::{Self, Fight},
  mob,
  participant,
  retro_effects,
  statuses,
};
use aresrpg_foundation::{
  combat_grid,
  prng,
  spell::{Self, Stats},
  spell_board,
  spell_effect::{Self, Effect},
  spell_formula,
  spell_target
};
use aresrpg_spells::spell_template::{Self, SpellTemplate};
use sui::dynamic_field as df;

const EInsufficientAP: u64 = 101; // ap < the level's ap_cost
const EIllegalCast: u64 = 102; // can_cast_at rejects (range / LOS / occupancy / line-launch)
const ECastsPerTurn: u64 = 103; // this caster already cast THIS spell casts_per_turn times this turn
const ENotClassSpell: u64 = 104; // the spell does not belong to the caster's class
const ESpellOnCooldown: u64 = 105; // this caster's last cast of THIS spell is still inside its cooldown window
const ECastsPerTarget: u64 = 106; // this caster already hit THIS target cell casts_per_target times this turn
const ECellAlreadyTrapped: u64 = 107; // placing a trap on a cell that already anchors a LIVE trap (1.29 no-stack)
const EMissingRequiredState: u64 = 108; // caster lacks one of the level's required named-state rows
const EForbiddenStatePresent: u64 = 109; // caster holds one of the level's forbidden named-state rows
const EUnhandledEffectKind: u64 = 110; // an effect kind neither sink implements — refuse rather than pay AP for nothing (see the sink tails)

const PLAYER_SIDE: u8 = 0;
const MOB_SIDE: u8 = 1;

const CASTS_UNLIMITED: u8 = 255; // casts_per_turn / casts_per_target sentinel = no cap (spell_bands F3)

// ── PER-CASTER CAST HISTORY (combat-integrity) — DYNAMIC FIELDS on the Fight UID, the
// upgrade-safe state channel: `Participant`'s layout is FROZEN across package upgrades, so cooldown / cast-limit
// bookkeeping lives here, never in a new struct field. The clock is the caster's OWN turn counter (`SeatTurnKey`),
// bumped once per PLAYER turn-start in `turns::resolve_from` — each living seat takes exactly one turn per round,
// so it numerically equals @aresrpg/sim's per-round `turn_number` for every caster. Per-turn counters reset
// LAZILY by comparing a record's `last_turn` to the caster's current turn (no turn-start sweep). Keyed by SEAT
// (stable for the fight's life — seats are append-only, never reused). Orphaned at settlement's `object::delete`
// (no abort — ephemeral per-fight dust).
public struct SeatTurnKey has copy, drop, store { seat: u64 }
public struct CastKey has copy, drop, store { seat: u64, spell: ID }
public struct TargetKey has copy, drop, store { seat: u64, spell: ID, cell: u64 }
// MOB cast history (mob cooldown enforcement — parity with @aresrpg/sim's uniform `check_cast_limits`). Mob kit
// spells carry NO SpellTemplate object, so they cannot be keyed by an `ID` like player casts — they are keyed by
// (mob index, kit `spell_index`), unique within the fight. New DF key structs are upgrade-additive (they touch no
// frozen struct layout). Same `CastRecord`/`TargetRecord` values, same pure verdict math, same monotone clock
// (the mob's own `action_envelope::mob_turn`, == the sim's per-round `turn_number`).
public struct MobCastKey has copy, drop, store { mob: u64, spell: u64 }
public struct MobTargetKey has copy, drop, store { mob: u64, spell: u64, cell: u64 }
public struct CastRecord has copy, drop, store { last_turn: u64, casts_this_turn: u8 }
public struct TargetRecord has copy, drop, store { last_turn: u64, casts: u8 }
public struct ReturnTarget has copy, drop { is_mob: bool, idx: u64 }

fun record_random(
  domains: &mut vector<u8>,
  effect_ordinals: &mut vector<u64>,
  rolls: &mut vector<u64>,
  bounds: &mut vector<u64>,
  domain: u8,
  effect_ordinal: u64,
  roll: u64,
  bound: u64,
) {
  domains.push_back(domain);
  effect_ordinals.push_back(effect_ordinal);
  rolls.push_back(roll);
  bounds.push_back(bound);
}

#[test_only]
/// Drive the private per-effect dispatch directly (a hand-built `Effect` over positioned fighters) — the mob
/// points/alter tests exercise `apply_to_mob`'s new branches without the SpellTemplate/band mint ceremony.
/// `caster_side` 0 = player / 1 = mob. Threads the drain `rng` like the real casts.
public fun apply_effect_for_testing(fight: &mut Fight, caster_side: u8, caster_idx: u64, caster_cell: u64, caster_stats: &Stats, caster_level: u64, target_cell: u64, effect: &Effect, rng: &mut u64) {
  let mut domains = vector[];
  let mut ordinals = vector[];
  let mut rolls = vector[];
  let mut bounds = vector[];
  let _did_damage = apply_effect(
    fight, caster_side, caster_idx, caster_cell, caster_stats, caster_level, target_cell, effect, 0,
    0, option::none(), 0, rng, &mut domains, &mut ordinals, &mut rolls, &mut bounds,
  );
}

// ╔════════════════ [ Player cast (commit action) ] ═════════════════════════ ]

/// Resolve `seat`'s cast of `spell` at `target_cell`. Gates class-book + AP + `can_cast_at` + the authored cast
/// LIMITS (cooldown / casts_per_turn / casts_per_target via `enforce_and_record_cast`), derives the crit boolean
/// from the turn seed, applies each effect over its zone, spends AP, advances the action slot. Returns nothing —
/// mutations land on the Fight. Deterministic (no rng). (Level 1 — see module doc.)
public(package) fun resolve_player_cast(fight: &mut Fight, seat: u64, spell: &SpellTemplate, target_cell: u64) {
  // read caster data up front (copy the stats out so no &fight borrow is held across the &mut writes).
  let caster_cell; let caster_level; let caster_stats; let ap; let casts; let caster_class;
  {
    let p = fight::participants(fight).borrow(seat);
    caster_cell = participant::cell(p);
    caster_level = participant::level(p);
    caster_stats = *participant::stats(p);
    ap = participant::ap(p);
    casts = participant::casts_this_turn(p);
    caster_class = participant::class(p);
  };
  assert!(spell_template::class(spell) == caster_class, ENotClassSpell);
  // F-07 CLOSED: the seat's LEARNED level rides the Combatant snapshot (seat-time, snapshot law — a mid-fight
  // spell raise never changes THIS fight); absent = 1, the free unlock.
  let spell_id = object::id(spell);
  let learned = { let p = fight::participants(fight).borrow(seat); participant::spell_level_of(p, spell_id) };
  let sl = *spell_template::level_of(spell, learned);
  assert_states(fight, seat, &sl);
  assert!(ap >= sl.sl_ap_cost(), EInsufficientAP);

  let occupied = cell_occupied(fight, target_cell);
  let los = los_obstacles(fight);
  let range_bonus = spell::stat_range(&caster_stats);
  assert!(spell_target::can_cast_at(&sl, caster_cell, target_cell, occupied, &los, range_bonus), EIllegalCast);
  let crit_rate = sl.sl_crit_rate();
  // Resolve the selected normal/critical list while every read is still side-effect free. Direct point casts may
  // not select an invisible ENEMY; any non-point fighter effect is cell-resolved AoE and remains legal.
  let turn_seed = fight::turn_seed(fight, seat);
  let crit_roll = spell_formula::slot_crit_roll(turn_seed, casts);
  let is_crit = spell_formula::crit_at(crit_roll, crit_rate, spell::stat_critical_hit(&caster_stats));
  let effects = *sl.effects_for(is_crit);
  assert!(!(statuses::is_direct_effect_list(&effects) && statuses::invisible_enemy_at(fight, seat, target_cell)), EIllegalCast);
  // CAST LIMITS — cooldown / casts_per_turn / casts_per_target, PER CASTER (makes the HUD's
  // displayed limits real; the old check gated the shared action counter — weapon strikes bled its budget and it
  // reset every turn, so cooldowns and per-target caps were unenforced). Runs after the read-only gates + before
  // any effect write, so an over-limit cast aborts clean (nothing applied). `casts` above is still the crit slot.
  enforce_and_record_cast(fight, seat, spell_id, sl.sl_casts_per_turn(), sl.sl_casts_per_target(), sl.sl_cooldown_turns(), target_cell);

  // Retro critical failure is a committed cast: history is already recorded, AP and the action slot are spent,
  // but no payload runs. The authored end-turn bit forfeits both remaining pools; normal turn handoff stays on
  // the published pass path.
  let fight_id = fight::id(fight);
  let action_turn = seat_turn(fight, seat);
  let failure_bound = retro_effects::failure_denominator(fight, seat);
  let failure_roll = spell_formula::critical_failure_roll(turn_seed, casts, failure_bound);
  let fumbled = failure_bound > 0 && failure_roll == 0;
  if (fumbled) {
    action_envelope::emit_started(
      fight_id, false, seat, action_turn, casts, fight_events::action_kind_spell(), target_cell,
      sl.sl_ap_cost(), 0,
    );
    let pm = fight::participants_mut(fight).borrow_mut(seat);
    participant::spend_ap(pm, sl.sl_ap_cost());
    participant::count_action(pm);
    if (sl.sl_ends_turn_on_fail()) participant::forfeit_actions(pm);
    fight_events::emit_critical_failure(fight_id, false, seat);
    fight_events::emit_cast(fight_id, false, seat, target_cell);
    action_envelope::emit_player_spell(
      fight_id, seat, target_cell, action_turn, casts, sl.sl_ap_cost(), is_crit, true, false,
      spell_id, learned, sl, crit_roll, failure_roll, failure_bound,
      vector[], vector[], vector[], vector[],
    );
    return
  };

  let mut random_domains = vector[];
  let mut random_effect_ordinals = vector[];
  let mut random_rolls = vector[];
  let mut random_bounds = vector[];
  let mut return_rng = prng::mix(spell_formula::dodge_seed(turn_seed, casts), spell_effect::k_return_spell() as u64);
  let (returned, returned_damage, _returned_effects) = try_return_spell(
    fight, PLAYER_SIDE, seat, action_turn, casts, sl.sl_ap_cost(), &caster_stats, target_cell, &effects,
    &mut return_rng, &mut random_domains, &mut random_effect_ordinals, &mut random_rolls,
    &mut random_bounds,
  );
  if (returned) {
    let pm = fight::participants_mut(fight).borrow_mut(seat);
    participant::spend_ap(pm, sl.sl_ap_cost());
    participant::count_action(pm);
    if (returned_damage) statuses::reveal(fight, false, seat);
    fight_events::emit_cast(fight_id, false, seat, target_cell);
    action_envelope::emit_player_spell(
      fight_id, seat, target_cell, action_turn, casts, sl.sl_ap_cost(), is_crit, false, true,
      spell_id, learned, sl, crit_roll, failure_roll, failure_bound, random_domains,
      random_effect_ordinals, random_rolls, random_bounds,
    );
    return
  };

  action_envelope::emit_started(
    fight_id, false, seat, action_turn, casts, fight_events::action_kind_spell(), target_cell,
    sl.sl_ap_cost(), effects.length(),
  );

  let cast_turn = seat_turn(fight, seat);
  let named_target = fighter_fid_at(fight, target_cell);
  let named_bonus = if (named_target.is_some()) {
    retro_effects::named_damage_bonus(fight, seat, spell_id, *named_target.borrow(), cast_turn)
  } else 0;

  if (has_placement(&effects)) {
    let mut marker = 0;
    while (marker < effects.length()) {
      action_envelope::emit_effect(
        fight_id, false, seat, action_turn, casts, marker, *effects.borrow(marker),
      );
      marker = marker + 1;
    };
    place_effects(fight, target_cell, seat, &effects);
  } else {
    // DRAIN-DODGE ENTROPY — a per-cast prng STATE derived from the public turn-seed slot — the
    // point-removal contest threads it exactly like a crit reads its slot roll, so the client previews every dodge
    // before commit and player casts stay &Random-free (deterministic single-PTB batch). One seed per cast
    // decorrelates its effects; the @aresrpg/sim mirror derives the identical state.
    let mut drain_rng = spell_formula::dodge_seed(turn_seed, casts);
    // #577 — ONE per-cast damage roll from the public turn seed (the client mirrors it to preview this turn's
    // exact damage). Applied to each damage/heal effect's own [value, value_max]; fixed effects (max==value) ignore it.
    let damage_roll = spell_formula::slot_damage_roll(turn_seed, casts);
    let ne = effects.length();
    let mut e = 0;
    let mut did_damage = false;
    while (e < ne) {
      let effect = effects.borrow(e);
      action_envelope::emit_effect(fight_id, false, seat, action_turn, casts, e, *effect);
      let kind = effect.kind();
      if (kind == spell_effect::k_timed_payload()) {
        let count = effect.stat() as u64;
        let mut payload = vector[];
        let mut p = 0;
        while (p < count && e + 1 + p < ne) {
          action_envelope::emit_effect(
            fight_id, false, seat, action_turn, casts, e + 1 + p, *effects.borrow(e + 1 + p),
          );
          payload.push_back(*effects.borrow(e + 1 + p));
          p = p + 1;
        };
        let delay = if (effect.turns() > 0) effect.turns() as u64 else effect.value();
        retro_effects::schedule_payload(fight, seat, seat, delay, payload);
        e = e + p;
      } else if (kind == spell_effect::k_named_damage_stack()) {
        if (named_target.is_some()) {
          retro_effects::record_named_stack(fight, seat, spell_id, *named_target.borrow(), cast_turn, effect.value(), effect.turns());
        };
      } else if (apply_effect(
        fight, PLAYER_SIDE, seat, caster_cell, &caster_stats, caster_level, target_cell, effect,
        named_bonus, damage_roll, named_target, e, &mut drain_rng, &mut random_domains,
        &mut random_effect_ordinals, &mut random_rolls, &mut random_bounds,
      )) {
        did_damage = true;
      };
      e = e + 1;
    };
    if (did_damage) statuses::reveal(fight, false, seat);
  };

  let pm = fight::participants_mut(fight).borrow_mut(seat);
  participant::spend_ap(pm, sl.sl_ap_cost());
  participant::count_action(pm);
  fight_events::emit_cast(fight_id, false, seat, target_cell);
  action_envelope::emit_player_spell(
    fight_id, seat, target_cell, action_turn, casts, sl.sl_ap_cost(), is_crit, false, false,
    spell_id, learned, sl, crit_roll, failure_roll, failure_bound, random_domains,
    random_effect_ordinals, random_rolls, random_bounds,
  );
}

// ╔════════════════ [ Cast-limit enforcement + the per-caster turn clock ] ══════ ]

/// The caster's OWN turn counter (0 before its first turn) — the monotonic cooldown / per-turn clock.
fun seat_turn(fight: &Fight, seat: u64): u64 {
  let k = SeatTurnKey { seat };
  if (df::exists(fight::uid(fight), k)) *df::borrow<SeatTurnKey, u64>(fight::uid(fight), k) else 0
}

/// Advance `seat`'s own turn counter — `turns::resolve_from` calls this at every PLAYER turn-start (the one point
/// a player turn begins), so cooldowns count the caster's OWN turns (1.29 relaunch-interval semantics).
public(package) fun note_seat_turn(fight: &mut Fight, seat: u64) {
  let k = SeatTurnKey { seat };
  if (df::exists(fight::uid(fight), k)) {
    let v = df::borrow_mut<SeatTurnKey, u64>(fight::uid_mut(fight), k);
    *v = *v + 1;
  } else {
    df::add(fight::uid_mut(fight), k, 1u64);
  };
}

#[test_only]
/// Drive ONE effect kind straight at a player seat and at a mob, bypassing the zone/target-filter walk. The
/// sink-parity suite uses it to walk the whole vocabulary through both tails.
public fun apply_to_both_for_testing(
  fight: &mut Fight,
  caster_stats: &Stats,
  pc: u64,
  midx: u64,
  effect: &Effect,
  rng: &mut u64,
) {
  let mut d = vector<u8>[];
  let mut o = vector<u64>[];
  let mut r = vector<u64>[];
  let mut b = vector<u64>[];
  // `damage_roll` 0 = the low end of an authored range; the walk is about which BRANCH a kind lands in, never
  // about the number it produces.
  let _p = apply_to_player(fight, PLAYER_SIDE, 0, pc, 0, caster_stats, 1, effect.element(), effect, 0, 0, 0, rng, &mut d, &mut o, &mut r, &mut b);
  let _m = apply_to_mob(fight, PLAYER_SIDE, 0, midx, 0, caster_stats, 1, effect.element(), effect, 0, 0, 0, rng, &mut d, &mut o, &mut r, &mut b);
}

#[test_only]
/// Drive one limited cast through the recorder — the field-reclaim suite's writer for the four cast families.
public fun test_record_cast(fight: &mut Fight, seat: u64, spell: ID, target_cell: u64) {
  enforce_and_record_cast(fight, seat, spell, 1, 1, 1, target_cell);
}

#[test_only]
/// Do this module's rows still exist on the Fight? (Key structs are module-private — the probe must live here.)
public fun test_rows_exist(fight: &Fight, seat: u64, spell: ID, target_cell: u64): bool {
  df::exists(fight::uid(fight), SeatTurnKey { seat })
    || df::exists(fight::uid(fight), CastKey { seat, spell })
    || df::exists(fight::uid(fight), TargetKey { seat, spell, cell: target_cell })
}

/// Reclaim every field family this module writes onto the Fight UID (S-07 — called by `settlement` before
/// `fight::destroy`). Seat clocks are bounded by the seat count; the four cast-limit families carry a spell id
/// in their key, so they ride the write-set index.
public(package) fun sweep_fields(fight: &mut Fight) {
  let seats = fight::participant_count(fight);
  let mut s = 0;
  while (s < seats) { fight::drop_field<SeatTurnKey, u64>(fight, SeatTurnKey { seat: s }); s = s + 1; };
  fight::sweep_indexed<CastKey, CastRecord>(fight);
  fight::sweep_indexed<TargetKey, TargetRecord>(fight);
  fight::sweep_indexed<MobCastKey, CastRecord>(fight);
  fight::sweep_indexed<MobTargetKey, TargetRecord>(fight);
}

/// Mob twin of the seat clock. Kept at the cast boundary so turn orchestration and direct resolver tests share
/// one exact seam; the dynamic field preserves the frozen Fight layout.
public(package) fun note_mob_turn(fight: &mut Fight, midx: u64) {
  action_envelope::note_mob_turn(fight, midx);
}

/// Named-state cast gate. Required rows must all be live and forbidden rows must all be absent. The board row is
/// the authority, so normal duration expiry changes eligibility without any parallel fighter field.
fun assert_states(fight: &Fight, fighter: u64, sl: &spell_effect::SpellLevel) {
  let required = sl.sl_required_states();
  let mut i = 0;
  while (i < required.length()) {
    assert!(spell_board::fighter_has_state(fight::fx(fight), fighter, *required.borrow(i)), EMissingRequiredState);
    i = i + 1;
  };
  let forbidden = sl.sl_forbidden_states();
  let mut j = 0;
  while (j < forbidden.length()) {
    assert!(!spell_board::fighter_has_state(fight::fx(fight), fighter, *forbidden.borrow(j)), EForbiddenStatePresent);
    j = j + 1;
  };
}

/// Non-aborting twin for mob-plan revalidation.
fun states_satisfied(fight: &Fight, fighter: u64, sl: &spell_effect::SpellLevel): bool {
  let required = sl.sl_required_states();
  let mut i = 0;
  while (i < required.length()) {
    if (!spell_board::fighter_has_state(fight::fx(fight), fighter, *required.borrow(i))) return false;
    i = i + 1;
  };
  let forbidden = sl.sl_forbidden_states();
  let mut j = 0;
  while (j < forbidden.length()) {
    if (spell_board::fighter_has_state(fight::fx(fight), fighter, *forbidden.borrow(j))) return false;
    j = j + 1;
  };
  true
}

/// Enforce + record a PLAYER cast against the level's authored limits, keyed by caster seat. Three sealed caps:
///   • cooldown C>0: recastable only when `current_turn − last_cast_turn > C` — so a C>0 spell is at most once per
///     turn (the 1.29 relaunch interval); C=0 = no cooldown. Matches the HUD's "Cooldown: N turns" chip exactly.
///   • casts_per_turn:   ≤ N casts of THIS spell per caster turn (255 = unlimited).
///   • casts_per_target: ≤ N casts of THIS spell at the SAME target cell per turn (255 = unlimited).
/// Unlimited + cooldown-free spells (the common case) touch ZERO dynamic fields. Per-turn counters reset lazily
/// (a record whose `last_turn` != the current turn reads as 0). Aborts BEFORE any effect write (the caller runs
/// it after the read-only gates), so a rejected cast reverts whole. `t >= last_turn` always (the clock is monotone).
fun enforce_and_record_cast(fight: &mut Fight, seat: u64, spell: ID, casts_per_turn: u8, casts_per_target: u8, cooldown: u8, target_cell: u64) {
  let track_spell = cooldown > 0 || casts_per_turn != CASTS_UNLIMITED;
  let track_target = casts_per_target != CASTS_UNLIMITED;
  if (!track_spell && !track_target) return; // no authored limit — the common case pays nothing
  let t = seat_turn(fight, seat);
  if (track_spell) {
    let ck = CastKey { seat, spell };
    let cur = read_cast_record(fight, ck);
    let v = cast_record_violation(cur, t, casts_per_turn, cooldown);
    if (v != 0) abort v; // aborts BEFORE any write, so a rejected player cast reverts whole
    write_cast_record(fight, ck, cast_record_next(cur, t));
  };
  if (track_target) {
    let tk = TargetKey { seat, spell, cell: target_cell };
    let cur = read_target_record(fight, tk);
    let v = target_record_violation(cur, t, casts_per_target);
    if (v != 0) abort v;
    write_target_record(fight, tk, target_record_next(cur, t));
  };
}

// ── Cast-limit primitives shared by the player (abort) and mob (refuse) paths — ONE home for the cooldown /
// per-turn / per-target verdict math (the sim-parity semantics) + the DF read/write plumbing (generic over the key
// type, so player `CastKey`/`TargetKey` and mob `MobCastKey`/`MobTargetKey` share it).

/// Pure verdict over an existing cast record (0 = OK). Cooldown first (matches the player-path abort order), then
/// the per-turn cap. `none` = first-ever cast, always OK. `t >= last_turn` always (the clock is monotone).
fun cast_record_violation(cur: Option<CastRecord>, t: u64, casts_per_turn: u8, cooldown: u8): u64 {
  if (cur.is_none()) return 0;
  let rec = cur.destroy_some();
  if (cooldown > 0 && !(t - rec.last_turn > (cooldown as u64))) return ESpellOnCooldown;
  let this_turn = if (rec.last_turn == t) rec.casts_this_turn else 0; // lazy per-turn reset
  if (!((this_turn as u64) < (casts_per_turn as u64))) return ECastsPerTurn;
  0
}

/// The record after a cast lands (fresh or incremented, per-turn reset lazily against the current turn).
fun cast_record_next(cur: Option<CastRecord>, t: u64): CastRecord {
  if (cur.is_none()) return CastRecord { last_turn: t, casts_this_turn: 1 };
  let rec = cur.destroy_some();
  let this_turn = if (rec.last_turn == t) rec.casts_this_turn else 0;
  CastRecord { last_turn: t, casts_this_turn: this_turn + 1 }
}

fun target_record_violation(cur: Option<TargetRecord>, t: u64, casts_per_target: u8): u64 {
  if (cur.is_none()) return 0;
  let rec = cur.destroy_some();
  let this_target = if (rec.last_turn == t) rec.casts else 0; // lazy per-turn reset
  if (!((this_target as u64) < (casts_per_target as u64))) return ECastsPerTarget;
  0
}

fun target_record_next(cur: Option<TargetRecord>, t: u64): TargetRecord {
  if (cur.is_none()) return TargetRecord { last_turn: t, casts: 1 };
  let rec = cur.destroy_some();
  let this_target = if (rec.last_turn == t) rec.casts else 0;
  TargetRecord { last_turn: t, casts: this_target + 1 }
}

fun read_cast_record<K: copy + drop + store>(fight: &Fight, key: K): Option<CastRecord> {
  if (df::exists(fight::uid(fight), key)) option::some(*df::borrow<K, CastRecord>(fight::uid(fight), key))
  else option::none()
}

fun write_cast_record<K: copy + drop + store>(fight: &mut Fight, key: K, rec: CastRecord) {
  if (df::exists(fight::uid(fight), key)) *df::borrow_mut<K, CastRecord>(fight::uid_mut(fight), key) = rec
  else { fight::note_field(fight, key); df::add(fight::uid_mut(fight), key, rec); };
}

fun read_target_record<K: copy + drop + store>(fight: &Fight, key: K): Option<TargetRecord> {
  if (df::exists(fight::uid(fight), key)) option::some(*df::borrow<K, TargetRecord>(fight::uid(fight), key))
  else option::none()
}

fun write_target_record<K: copy + drop + store>(fight: &mut Fight, key: K, rec: TargetRecord) {
  if (df::exists(fight::uid(fight), key)) *df::borrow_mut<K, TargetRecord>(fight::uid_mut(fight), key) = rec
  else { fight::note_field(fight, key); df::add(fight::uid_mut(fight), key, rec); };
}

// ── Mob cast-limit twin (§17.21 AI resolution) — the CHAIN gaining the enforcement @aresrpg/sim already models.
// Player casts ABORT on a violation (the client re-signs); a mob cast is crank-driven, so a violation must REFUSE
// (the mob skips it via `mob_can_cast`) never abort — an abort would stall the whole turn crank. Keyed by
// (mob, kit spell_index), clocked by the mob's own turn. Read verdict + write record are split exactly like the
// sim's `check_cast_limits` / `record_cast`.

/// Read-only verdict for `mob_can_cast` (0 = the mob may cast; non-zero = a live cooldown / cap refuses it).
fun mob_cast_limit_violation(fight: &Fight, midx: u64, spell_index: u64, sl: &spell_effect::SpellLevel, target_cell: u64): u64 {
  let casts_per_turn = sl.sl_casts_per_turn();
  let casts_per_target = sl.sl_casts_per_target();
  let cooldown = sl.sl_cooldown_turns();
  let track_spell = cooldown > 0 || casts_per_turn != CASTS_UNLIMITED;
  let track_target = casts_per_target != CASTS_UNLIMITED;
  if (!track_spell && !track_target) return 0;
  let t = action_envelope::mob_turn(fight, midx);
  if (track_spell) {
    let v = cast_record_violation(read_cast_record(fight, MobCastKey { mob: midx, spell: spell_index }), t, casts_per_turn, cooldown);
    if (v != 0) return v;
  };
  if (track_target) {
    let v = target_record_violation(read_target_record(fight, MobTargetKey { mob: midx, spell: spell_index, cell: target_cell }), t, casts_per_target);
    if (v != 0) return v;
  };
  0
}

/// Record a mob cast against its authored limits (the write twin, run inside `resolve_mob_cast` — reached only for
/// a cast `mob_can_cast` already cleared). Clocked by `t` (the mob's current turn). A fumbled cast still records
/// (a committed cast, mirroring the player path).
fun record_mob_cast(fight: &mut Fight, midx: u64, spell_index: u64, casts_per_turn: u8, casts_per_target: u8, cooldown: u8, target_cell: u64, t: u64) {
  if (cooldown > 0 || casts_per_turn != CASTS_UNLIMITED) {
    let ck = MobCastKey { mob: midx, spell: spell_index };
    let next = cast_record_next(read_cast_record(fight, ck), t);
    write_cast_record(fight, ck, next);
  };
  if (casts_per_target != CASTS_UNLIMITED) {
    let tk = MobTargetKey { mob: midx, spell: spell_index, cell: target_cell };
    let next = target_record_next(read_target_record(fight, tk), t);
    write_target_record(fight, tk, next);
  };
}

// ╔════════════════ [ Mob cast (§17.21 AI resolution) ] ═════════════════════ ]

/// Resolve mob `midx` casting its `spell_index` kit spell at `target_cell`. Spends the mob's AP, applies the
/// spell's effects to the PLAYERS in the zone (mobs are the enemy side). Uses the same effect dispatch. The mob's
/// OUTGOING amplification now reads its own MUTABLE per-fight block (`mob::stats` — a str/damage shred on the mob
/// softens its hits). Damage/heal is deterministic (no crit — turn-seed slots are player-only); the ONLY draw is
/// the point-removal DODGE, which threads the crank `rng` (mob actions are crank-entropy-driven, replay-exact
/// from the crank seed, never previewable — unlike a player cast's turn-seed derivation).
public(package) fun resolve_mob_cast(fight: &mut Fight, midx: u64, spell_index: u64, target_cell: u64, rng: &mut u64) {
  let caster_cell; let caster_level; let caster_stats; let ap_cost; let effects; let ends_turn_on_fail; let sl;
  {
    let m = fight::mobs(fight).borrow(midx);
    caster_cell = mob::cell(m);
    caster_level = mob::level(m);
    caster_stats = *mob::stats(m); // per-mob LIVE block (was the shared kit) — alters on THIS mob change its damage
    sl = *mob::kit_spell_at(fight::content_kit(fight::member_content(fight, midx)), spell_index); // THIS mob's kit (mixed packs: one kit per member)
    ap_cost = sl.sl_ap_cost();
    effects = *sl.sl_effects();
    ends_turn_on_fail = sl.sl_ends_turn_on_fail();
  };
  let caster_fid = retro_effects::fid_of(true, midx);
  assert_states(fight, caster_fid, &sl);
  let fight_id = fight::id(fight);
  let group_template = fight::content_template(fight::member_content(fight, midx)); // the CASTER's species, not the pack's primary
  let (action_turn, action_ordinal) = action_envelope::next_mob_action(fight, midx);
  // Record this cast against its authored cooldown / per-turn / per-target limits, clocked by the mob's own turn
  // (`action_turn`). `mob_can_cast` already refused any violating cast, so this is a committed record — a fumble
  // below still counts (mirroring the player path). Parity with @aresrpg/sim's `record_cast`.
  record_mob_cast(fight, midx, spell_index, sl.sl_casts_per_turn(), sl.sl_casts_per_target(), sl.sl_cooldown_turns(), target_cell, action_turn);
  let mut random_domains = vector[];
  let mut random_effect_ordinals = vector[];
  let mut random_rolls = vector[];
  let mut random_bounds = vector[];
  let denominator = retro_effects::failure_denominator(fight, caster_fid);
  let mut failure_roll = 0;
  if (denominator > 0) {
    let (next_rng, roll) = prng::rng_int(*rng, denominator);
    *rng = next_rng;
    failure_roll = roll;
    if (retro_effects::roll_fumbles(fight, caster_fid, roll)) {
      action_envelope::emit_started(
        fight_id, true, midx, action_turn, action_ordinal, fight_events::action_kind_spell(),
        target_cell, ap_cost, 0,
      );
      let m = fight::mobs_mut(fight).borrow_mut(midx);
      mob::spend_ap(m, ap_cost);
      if (ends_turn_on_fail) mob::forfeit_actions(m);
      fight_events::emit_critical_failure(fight_id, true, midx);
      fight_events::emit_cast(fight_id, true, midx, target_cell);
      action_envelope::emit_mob_spell(
        fight_id, midx, target_cell, action_turn, action_ordinal, ap_cost, true, false,
        group_template, spell_index, sl, failure_roll, denominator, vector[], vector[], vector[],
        vector[],
      );
      return
    };
  };
  let mut did_damage = false;
  let (returned, returned_damage, _returned_effects) = try_return_spell(
    fight, MOB_SIDE, midx, action_turn, action_ordinal, ap_cost, &caster_stats, target_cell, &effects,
    rng, &mut random_domains, &mut random_effect_ordinals, &mut random_rolls, &mut random_bounds,
  );
  if (!returned) {
    action_envelope::emit_started(
      fight_id, true, midx, action_turn, action_ordinal, fight_events::action_kind_spell(),
      target_cell, ap_cost, effects.length(),
    );
    if (has_glyph_placement(&effects)) {
      let mut marker = 0;
      while (marker < effects.length()) {
        action_envelope::emit_effect(
          fight_id, true, midx, action_turn, action_ordinal, marker, *effects.borrow(marker),
        );
        marker = marker + 1;
      };
      place_mob_glyphs(fight, target_cell, &effects);
    } else {
      // #577 — the mob's per-cast damage roll: a non-advancing read of the crank rng state (mob damage is
      // crank-driven, never previewable). Byte-identical for fixed (max==value) effects; the stream is untouched.
      let mob_damage_roll = spell_formula::crank_damage_roll(*rng);
      let ne = effects.length();
      let mut e = 0;
      while (e < ne) {
        let effect = effects.borrow(e);
        action_envelope::emit_effect(
          fight_id, true, midx, action_turn, action_ordinal, e, *effect,
        );
        if (effect.kind() == spell_effect::k_timed_payload()) {
          let count = effect.stat() as u64;
          let mut payload = vector[];
          let mut p = 0;
          while (p < count && e + 1 + p < ne) {
            action_envelope::emit_effect(
              fight_id, true, midx, action_turn, action_ordinal, e + 1 + p,
              *effects.borrow(e + 1 + p),
            );
            payload.push_back(*effects.borrow(e + 1 + p));
            p = p + 1;
          };
          let delay = if (effect.turns() > 0) effect.turns() as u64 else effect.value();
          retro_effects::schedule_payload(fight, caster_fid, caster_fid, delay, payload);
          e = e + p;
        } else if (effect.kind() != spell_effect::k_named_damage_stack()
          && apply_effect(
            fight, MOB_SIDE, midx, caster_cell, &caster_stats, caster_level, target_cell, effect, 0,
            mob_damage_roll, option::none(), e, rng, &mut random_domains, &mut random_effect_ordinals,
            &mut random_rolls, &mut random_bounds,
          )) {
          did_damage = true;
        };
        e = e + 1;
      };
    };
  };
  if (did_damage || returned_damage) statuses::reveal(fight, true, midx);
  mob::spend_ap(fight::mobs_mut(fight).borrow_mut(midx), ap_cost);
  fight_events::emit_cast(fight_id, true, midx, target_cell);
  action_envelope::emit_mob_spell(
    fight_id, midx, target_cell, action_turn, action_ordinal, ap_cost, false, returned,
    group_template, spell_index, sl, failure_roll, denominator, random_domains,
    random_effect_ordinals, random_rolls, random_bounds,
  );
}

/// Revalidate an AI plan against the LIVE post-movement board. Ordinary movement can stop early on a trap, so
/// the precomputed cast cell is no longer authoritative after walking. This mirrors the sim reducer: a stopped
/// mob never casts omnisciently from the cell it failed to reach.
public(package) fun mob_can_cast(fight: &Fight, midx: u64, spell_index: u64, target_cell: u64): bool {
  let m = fight::mobs(fight).borrow(midx);
  let sl = mob::kit_spell_at(fight::content_kit(fight::member_content(fight, midx)), spell_index);
  mob::ap(m) >= sl.sl_ap_cost()
    && states_satisfied(fight, mob_fid(midx), sl)
    && mob_cast_limit_violation(fight, midx, spell_index, sl, target_cell) == 0
    && spell_target::can_cast_at(
      sl,
      mob::cell(m),
      target_cell,
      cell_occupied(fight, target_cell),
      &los_obstacles(fight),
      spell::stat_range(mob::stats(m)),
    )
}

// ╔════════════════ [ Weapon attack (§17.27 — AP-priced, repeatable) ] ══════ ]

/// §17.27 wave-2a — the total damage of ONE weapon strike. With authored item `lines`: sum `final_damage` PER
/// line, each amplified by the caster's element-primary stat then resisted by the TARGET's own per-element resist
/// — byte-identical to how a multi-element spell applies (fire line vs fire resist, water vs water). With NO lines
/// (pre-wave-2a fights, un-authored weapons, bare hands): the single seated `Weapon` line (`fb_*`) — the exact old
/// path. ONE crit boolean (resolved upstream from the turn-seed slot) swaps EVERY line to its crit base, mirroring
/// how crit swaps a whole spell's effect list. Deterministic — no rolls (line ranges seed-roll in wave-2b).
fun weapon_damage_total(lines: &vector<participant::WeaponLine>, fb_element: u8, fb_min: u64, fb_max: u64, fb_crit_min: u64, fb_crit_max: u64, is_crit: bool, damage_roll: u64, caster: &Stats, target: &Stats): u64 {
  if (lines.is_empty()) {
    let (min, max) = if (is_crit) (fb_crit_min, fb_crit_max) else (fb_min, fb_max);
    return spell_formula::final_damage(spell_formula::roll_in_range(min, max, damage_roll), fb_element, caster, target)
  };
  let n = lines.length();
  let (mut total, mut i) = (0, 0);
  while (i < n) {
    let w = lines.borrow(i);
    let (min, max) = if (is_crit) (participant::wl_crit_damage(w), participant::wl_crit_damage_max(w))
      else (participant::wl_damage(w), participant::wl_damage_max(w));
    total = total + spell_formula::final_damage(spell_formula::roll_in_range(min, max, damage_roll), participant::wl_element(w), caster, target);
    i = i + 1;
  };
  total
}

/// #577 — the ROLLED authored base a weapon action marker records (element-neutral, deliberately precedes
/// resistance): the same one per-strike `damage_roll` mapped onto each line's `[min, max]` and summed. Fixed
/// weapons (max==min) emit their single base, byte-identical to the pre-#577 marker.
fun weapon_effect_value(
  lines: &vector<participant::WeaponLine>,
  fb_min: u64,
  fb_max: u64,
  fb_crit_min: u64,
  fb_crit_max: u64,
  critical: bool,
  damage_roll: u64,
): u64 {
  if (lines.is_empty()) {
    let (min, max) = if (critical) (fb_crit_min, fb_crit_max) else (fb_min, fb_max);
    return spell_formula::roll_in_range(min, max, damage_roll)
  };
  let mut total = 0;
  let mut i = 0;
  while (i < lines.length()) {
    let line = lines.borrow(i);
    let (min, max) = if (critical) (participant::wl_crit_damage(line), participant::wl_crit_damage_max(line))
      else (participant::wl_damage(line), participant::wl_damage_max(line));
    total = total + spell_formula::roll_in_range(min, max, damage_roll);
    i = i + 1;
  };
  total
}

/// Resolve `seat`'s equipped-weapon strike at `target_cell`: gate AP + reach + LOS + a living mob on the cell,
/// roll the crit boolean, deal `final_damage`, spend AP. Repeatable while AP lasts (no per-turn cap — the AP
/// economy IS the limit, §17.27). Does NOT advance the turn (an action, like a cast).
public(package) fun weapon_strike(fight: &mut Fight, seat: u64, target_cell: u64) {
  let caster_cell; let caster_stats; let ap; let element; let dmg_base; let dmg_max; let crit_base; let crit_max; let crit_rate; let ap_cost; let reach; let slot;
  {
    let p = fight::participants(fight).borrow(seat);
    caster_cell = participant::cell(p);
    caster_stats = *participant::stats(p);
    ap = participant::ap(p);
    element = participant::weapon_element(p);
    dmg_base = participant::weapon_damage(p);
    dmg_max = participant::weapon_damage_max(p);
    crit_base = participant::weapon_crit_damage(p);
    crit_max = participant::weapon_crit_damage_max(p);
    crit_rate = participant::weapon_crit_rate(p);
    ap_cost = participant::weapon_ap_cost(p);
    reach = participant::weapon_reach(p);
    slot = participant::casts_this_turn(p); // §7 turn-seed slot index (pre-action)
  };
  assert!(ap >= ap_cost, EInsufficientAP);
  let d = combat_grid::manhattan(caster_cell, target_cell);
  assert!(d >= 1 && d <= reach, EIllegalCast);
  let los = los_obstacles(fight);
  assert!(combat_grid::line_of_sight(caster_cell, target_cell, &los), EIllegalCast);
  let midx_opt = find_living_mob_at(fight, target_cell);
  assert!(midx_opt.is_some(), EIllegalCast);
  let midx = midx_opt.destroy_some();
  assert!(!statuses::is_invisible(fight, true, midx), EIllegalCast);

  let fight_id = fight::id(fight);
  let action_turn = seat_turn(fight, seat);
  let turn_seed = fight::turn_seed(fight, seat);
  let crit_roll = spell_formula::slot_crit_roll(turn_seed, slot);
  let is_crit = spell_formula::crit_at(crit_roll, crit_rate, spell::stat_critical_hit(&caster_stats));
  let damage_roll = spell_formula::slot_damage_roll(turn_seed, slot); // #577 — one previewable per-strike roll across every line
  let lines = fight::weapon_lines_at(fight, seat); // §17.27 wave-2a — authored item lines (empty ⇒ single-line fallback)
  let target_stats = *mob::stats(fight::mobs(fight).borrow(midx)); // the struck mob's per-fight block (resist shred applies)
  let damage = weapon_damage_total(&lines, element, dmg_base, dmg_max, crit_base, crit_max, is_crit, damage_roll, &caster_stats, &target_stats);
  let effect = spell_effect::damage(
    spell::el_none(), weapon_effect_value(&lines, dmg_base, dmg_max, crit_base, crit_max, is_crit, damage_roll),
  );
  action_envelope::emit_started(
    fight_id, false, seat, action_turn, slot, fight_events::action_kind_weapon(), target_cell,
    ap_cost, 1,
  );
  action_envelope::emit_effect(fight_id, false, seat, action_turn, slot, 0, effect);
  let mut random_domains = vector[];
  let mut random_effect_ordinals = vector[];
  let mut random_rolls = vector[];
  let mut random_bounds = vector[];
  let mut reaction_rng = spell_formula::dodge_seed(turn_seed, slot);
  hit_mob_from(
    fight, midx, PLAYER_SIDE, seat, damage, 0, &mut reaction_rng, &mut random_domains,
    &mut random_effect_ordinals, &mut random_rolls, &mut random_bounds,
  );
  if (damage > 0) statuses::reveal(fight, false, seat);
  let pm = fight::participants_mut(fight).borrow_mut(seat);
  participant::spend_ap(pm, ap_cost);
  participant::count_action(pm); // advance the slot index (weapon strikes share the sequence with casts)
  fight_events::emit_cast(fight_id, false, seat, target_cell);
  action_envelope::emit_weapon(
    fight_id, seat, target_cell, action_turn, slot, is_crit, element, dmg_base, crit_base,
    crit_rate, ap_cost, reach, lines, crit_roll, random_domains, random_effect_ordinals,
    random_rolls, random_bounds,
  );
}

/// PvP weapon strike (F-08 — kolizeum has no mobs): same gates, target = a living OTHER-TEAM player on the cell.
/// Kept as a SEPARATE resolution path so the PvM strike above stays byte-identical for world fights.
public(package) fun weapon_strike_player(fight: &mut Fight, seat: u64, target_cell: u64) {
  let caster_cell; let caster_stats; let caster_team; let ap; let element; let dmg_base; let dmg_max; let crit_base; let crit_max; let crit_rate; let ap_cost; let reach; let slot;
  {
    let p = fight::participants(fight).borrow(seat);
    caster_cell = participant::cell(p);
    caster_stats = *participant::stats(p);
    caster_team = participant::team(p);
    ap = participant::ap(p);
    element = participant::weapon_element(p);
    dmg_base = participant::weapon_damage(p);
    dmg_max = participant::weapon_damage_max(p);
    crit_base = participant::weapon_crit_damage(p);
    crit_max = participant::weapon_crit_damage_max(p);
    crit_rate = participant::weapon_crit_rate(p);
    ap_cost = participant::weapon_ap_cost(p);
    reach = participant::weapon_reach(p);
    slot = participant::casts_this_turn(p); // §7 turn-seed slot index (pre-action)
  };
  assert!(ap >= ap_cost, EInsufficientAP);
  let d = combat_grid::manhattan(caster_cell, target_cell);
  assert!(d >= 1 && d <= reach, EIllegalCast);
  let los = los_obstacles(fight);
  assert!(combat_grid::line_of_sight(caster_cell, target_cell, &los), EIllegalCast);
  let victim = find_living_enemy_player_at(fight, target_cell, caster_team);
  assert!(victim.is_some(), EIllegalCast);
  let pc = victim.destroy_some();
  assert!(!statuses::is_invisible(fight, false, pc), EIllegalCast);

  let fight_id = fight::id(fight);
  let action_turn = seat_turn(fight, seat);
  let turn_seed = fight::turn_seed(fight, seat);
  let crit_roll = spell_formula::slot_crit_roll(turn_seed, slot);
  let is_crit = spell_formula::crit_at(crit_roll, crit_rate, spell::stat_critical_hit(&caster_stats));
  let damage_roll = spell_formula::slot_damage_roll(turn_seed, slot); // #577 — one previewable per-strike roll across every line
  let lines = fight::weapon_lines_at(fight, seat); // §17.27 wave-2a — authored item lines (empty ⇒ single-line fallback)
  let target_stats = *participant::stats(fight::participants(fight).borrow(pc));
  let damage = weapon_damage_total(&lines, element, dmg_base, dmg_max, crit_base, crit_max, is_crit, damage_roll, &caster_stats, &target_stats);
  let effect = spell_effect::damage(
    spell::el_none(), weapon_effect_value(&lines, dmg_base, dmg_max, crit_base, crit_max, is_crit, damage_roll),
  );
  action_envelope::emit_started(
    fight_id, false, seat, action_turn, slot, fight_events::action_kind_weapon(), target_cell,
    ap_cost, 1,
  );
  action_envelope::emit_effect(fight_id, false, seat, action_turn, slot, 0, effect);
  let mut random_domains = vector[];
  let mut random_effect_ordinals = vector[];
  let mut random_rolls = vector[];
  let mut random_bounds = vector[];
  let mut reaction_rng = spell_formula::dodge_seed(turn_seed, slot);
  hit_player_from(
    fight, pc, PLAYER_SIDE, seat, damage, 0, &mut reaction_rng, &mut random_domains,
    &mut random_effect_ordinals, &mut random_rolls, &mut random_bounds,
  );
  if (damage > 0) statuses::reveal(fight, false, seat);
  let pm = fight::participants_mut(fight).borrow_mut(seat);
  participant::spend_ap(pm, ap_cost);
  participant::count_action(pm); // advance the slot index
  fight_events::emit_cast(fight_id, false, seat, target_cell);
  action_envelope::emit_weapon(
    fight_id, seat, target_cell, action_turn, slot, is_crit, element, dmg_base, crit_base,
    crit_rate, ap_cost, reach, lines, crit_roll, random_domains, random_effect_ordinals,
    random_rolls, random_bounds,
  );
}

/// Index of the first living player on `cell` whose team differs from `team`, if any.
fun find_living_enemy_player_at(fight: &Fight, cell: u64, team: u8): Option<u64> {
  let n = fight::participants(fight).length();
  let mut i = 0;
  while (i < n) {
    let p = fight::participants(fight).borrow(i);
    if (participant::is_alive(p) && participant::cell(p) == cell && participant::team(p) != team) return option::some(i);
    i = i + 1;
  };
  option::none()
}

/// Single critical fold for spell, PvM-weapon, and PvP-weapon actions. Keeping the caster-stat read here prevents
/// any resolver from silently substituting a literal bonus; the foundation helper enforces denominator >= 2.
public(package) fun crits_with_stats(turn_seed: u64, slot: u64, crit_rate: u64, caster_stats: &Stats): bool {
  spell_formula::crit_at(
    spell_formula::slot_crit_roll(turn_seed, slot),
    crit_rate,
    spell::stat_critical_hit(caster_stats),
  )
}

/// Index of the FIRST living mob standing on `cell`, if any.
public(package) fun find_living_mob_at(fight: &Fight, cell: u64): Option<u64> {
  let n = fight::mobs(fight).length();
  let mut i = 0;
  while (i < n) {
    let m = fight::mobs(fight).borrow(i);
    if (mob::is_alive(m) && mob::cell(m) == cell) return option::some(i);
    i = i + 1;
  };
  option::none()
}

/// Stable named-stack identity at the aimed cell. The row follows this fighter if it later moves; empty cells
/// never create a stack, and another fighter cannot inherit one by stepping onto the old cell.
fun fighter_fid_at(fight: &Fight, cell: u64): Option<u64> {
  let np = fight::participants(fight).length();
  let mut i = 0;
  while (i < np) {
    let p = fight::participants(fight).borrow(i);
    if (participant::is_alive(p) && participant::cell(p) == cell) return option::some(i);
    i = i + 1;
  };
  let mob_idx = find_living_mob_at(fight, cell);
  if (mob_idx.is_some()) option::some(mob_fid(mob_idx.destroy_some())) else option::none()
}

/// RETURN_SPELL is a cast redirect, not damage reflection. Only a wholly point-shaped cast aimed at a living
/// enemy qualifies. On proc, its ordinary DAMAGE lines hit the original caster through the raw local sinks and
/// normal target resolution is skipped; those writes never enter return/reflect reactions, enforcing depth one.
fun try_return_spell(
  fight: &mut Fight,
  caster_side: u8,
  caster_idx: u64,
  action_turn: u64,
  action_ordinal: u64,
  ap_cost: u64,
  caster_stats: &Stats,
  target_cell: u64,
  effects: &vector<Effect>,
  rng: &mut u64,
  random_domains: &mut vector<u8>,
  random_effect_ordinals: &mut vector<u64>,
  random_rolls: &mut vector<u64>,
  random_bounds: &mut vector<u64>,
): (bool, bool, vector<Effect>) {
  if (!all_point(effects)) return (false, false, vector[]);
  let target = return_target(fight, caster_side, caster_idx, target_cell);
  if (target.is_none()) return (false, false, vector[]);
  let target = target.destroy_some();
  let target_is_mob = target.is_mob;
  let target_idx = target.idx;
  let target_fid = if (target_is_mob) mob_fid(target_idx) else target_idx;
  let row = spell_board::fighter_status_of(fight::fx(fight), target_fid, spell_effect::k_return_spell());
  if (row.is_none() || !effect_proc(
    row.borrow(), rng, fight_events::random_domain_return(), fight_events::no_effect_ordinal(),
    random_domains, random_effect_ordinals, random_rolls, random_bounds,
  )) return (false, false, vector[]);

  let caster_is_mob = caster_side == MOB_SIDE;
  let fight_id = fight::id(fight);
  let n = effects.length();
  let mut effect_count = 0;
  let mut count_idx = 0;
  while (count_idx < n) {
    if (effects.borrow(count_idx).kind() == spell_effect::k_damage()) effect_count = effect_count + 1;
    count_idx = count_idx + 1;
  };
  action_envelope::emit_started(
    fight_id, caster_is_mob, caster_idx, action_turn, action_ordinal,
    fight_events::action_kind_spell(), target_cell, ap_cost, effect_count,
  );
  let mut i = 0;
  let mut did_damage = false;
  let mut resolved = vector[];
  // #577 — the returned-spell reflection rolls its damage the same non-advancing way a mob cast does (this is a
  // reaction, off the threaded rng — byte-identical for fixed effects; a range varies deterministically).
  let damage_roll = spell_formula::crank_damage_roll(*rng);
  while (i < n && fighter_alive(fight, caster_is_mob, caster_idx)) {
    let effect = effects.borrow(i);
    if (effect.kind() == spell_effect::k_damage()) {
      let effect_ordinal = resolved.length();
      action_envelope::emit_effect(
        fight_id, caster_is_mob, caster_idx, action_turn, action_ordinal, effect_ordinal, *effect,
      );
      let damage = spell_formula::final_damage(
        spell_formula::roll_in_range(effect.value(), effect.value_max(), damage_roll), effect.element(), caster_stats, caster_stats,
      );
      if (caster_is_mob) hit_mob(fight, caster_idx, damage)
      else hit_player(fight, caster_idx, damage);
      if (damage > 0) did_damage = true;
      resolved.push_back(*effect);
    };
    i = i + 1;
  };
  (true, did_damage, resolved)
}

fun all_point(effects: &vector<Effect>): bool {
  let n = effects.length();
  let mut i = 0;
  while (i < n) {
    if (effects.borrow(i).area_shape() != spell_effect::shape_point()) return false;
    i = i + 1;
  };
  true
}

/// Resolve only enemy fighters at the aimed cell. Player-vs-player uses participant team; mobs are one side.
fun return_target(fight: &Fight, caster_side: u8, caster_idx: u64, cell: u64): Option<ReturnTarget> {
  let caster_team = if (caster_side == PLAYER_SIDE) {
    participant::team(fight::participants(fight).borrow(caster_idx))
  } else 255;
  let np = fight::participants(fight).length();
  let mut i = 0;
  while (i < np) {
    let p = fight::participants(fight).borrow(i);
    let enemy = caster_side == MOB_SIDE || participant::team(p) != caster_team;
    if (enemy && participant::is_alive(p) && participant::cell(p) == cell) {
      return option::some(ReturnTarget { is_mob: false, idx: i })
    };
    i = i + 1;
  };
  if (caster_side == PLAYER_SIDE) {
    let nm = fight::mobs(fight).length();
    let mut j = 0;
    while (j < nm) {
      let m = fight::mobs(fight).borrow(j);
      if (mob::is_alive(m) && mob::cell(m) == cell) {
        return option::some(ReturnTarget { is_mob: true, idx: j })
      };
      j = j + 1;
    };
  };
  option::none()
}

// ╔════════════════ [ Per-effect dispatch over a zone ] ═════════════════════ ]

/// Apply ONE effect from a caster on `caster_side` (0 players / 1 mobs). Caster-only kinds short-circuit; else
/// enumerate every living fighter, keep those in the effect's zone AND passing its team filter, and dispatch by
/// kind. `caster_idx` = the caster's seat (player) or mob index. Deterministic — no kind draws.
fun apply_effect(
  fight: &mut Fight,
  caster_side: u8,
  caster_idx: u64,
  caster_cell: u64,
  caster_stats: &Stats,
  caster_level: u64,
  target_cell: u64,
  effect: &Effect,
  damage_bonus: u64,
  damage_roll: u64, // #577 — the per-cast turn-seed (player) / crank (mob) roll fraction, mapped onto each effect's range
  bonus_target: Option<u64>,
  effect_ordinal: u64,
  rng: &mut u64,
  random_domains: &mut vector<u8>,
  random_effect_ordinals: &mut vector<u64>,
  random_rolls: &mut vector<u64>,
  random_bounds: &mut vector<u64>,
): bool {
  let kind = effect.kind();
  // Caster-side kinds (never key off the zone or team).
  if (kind == spell_effect::k_caster_damage()) {
    // recoil rides the SAME hit sinks as every HP write now: the combat log sees the self-hit (it emitted
    // NOTHING before), and a recoil-death runs the death fold (MOB_DEBUFF_HAT P3 — rows purge at every kill path).
    if (caster_side == PLAYER_SIDE) hit_player(fight, caster_idx, effect.value())
    else hit_mob(fight, caster_idx, effect.value());
    return false
  };
  if (kind == spell_effect::k_teleport()) {
    // Announce the relocation on the SAME Displaced seam push/pull ride so the client renders it — without this
    // the caster's cell silently changed and the client never learned ("senshi teleport fully dead", 07-18).
    // kind=k_teleport distinguishes the blink; requested=blocked=0 — a teleport is instant, no collision walk.
    let is_mob = caster_side == MOB_SIDE;
    let from_cell = if (is_mob) mob::cell(fight::mobs(fight).borrow(caster_idx))
      else participant::cell(fight::participants(fight).borrow(caster_idx));
    if (caster_side == PLAYER_SIDE) participant::set_cell(fight::participants_mut(fight).borrow_mut(caster_idx), target_cell)
    else mob::set_cell(fight::mobs_mut(fight).borrow_mut(caster_idx), target_cell);
    fight_events::emit_displaced(fight::id(fight), is_mob, caster_idx, spell_effect::k_teleport(), from_cell, target_cell, 0, 0);
    trigger_on_enter(fight, is_mob, caster_idx); // a teleport lands on traps too (F-12)
    return false
  };

  let element = effect.element();
  let zone = combat_grid::zone_cells(effect.area_shape(), effect.area_size(), target_cell, caster_cell);
  // Effect 783's geometric kind is intentionally blind to caster ownership or team: every living fighter in the frozen effect
  // zone is repelled. Existing kinds retain their authored target filter.
  let tf = if (kind == spell_effect::k_geometric_push()) spell_effect::tf_none() else effect.target_filter();

  // PLAYERS in zone: ally = SAME PARTICIPANT TEAM as a player caster (F-08 — PvM seats all sit on team 0, so
  // this degenerates to the old side check; kolizeum seats two player teams and the filter must split them).
  // A mob caster treats every player as enemy regardless of team.
  let caster_team = if (caster_side == PLAYER_SIDE) participant::team(fight::participants(fight).borrow(caster_idx)) else 255;
  let np = fight::participants(fight).length();
  let mut i = 0;
  let mut did_damage = false;
  while (i < np) {
    let (alive, pcell, pteam) = { let p = fight::participants(fight).borrow(i); (participant::is_alive(p), participant::cell(p), participant::team(p)) };
    if (alive && zone.contains(&pcell)) {
      let same_team = caster_side == PLAYER_SIDE && pteam == caster_team;
      let is_caster = caster_side == PLAYER_SIDE && i == caster_idx;
      if (spell_target::effect_hits(tf, is_caster, same_team)) {
        if (kind == spell_effect::k_geometric_push()) {
          let requested = displacement::zone_edge_distance(&zone, target_cell, pcell);
          if (displace_target(fight, false, i, target_cell, caster_level, kind, requested)) did_damage = true;
        } else {
          let target_bonus = if (bonus_target.is_some() && *bonus_target.borrow() == i) damage_bonus else 0;
          if (apply_to_player(
            fight, caster_side, caster_idx, i, caster_cell, caster_stats, caster_level, element,
            effect, target_bonus, damage_roll, effect_ordinal, rng, random_domains, random_effect_ordinals,
            random_rolls, random_bounds,
          )) did_damage = true;
        };
      };
    };
    i = i + 1;
  };

  // MOBS in zone: enemies if caster is a player (any team), allies if caster is a mob.
  let m_same_team = caster_side == MOB_SIDE;
  let nm = fight::mobs(fight).length();
  let mut j = 0;
  while (j < nm) {
    let (alive, mcell) = { let m = fight::mobs(fight).borrow(j); (mob::is_alive(m), mob::cell(m)) };
    if (alive && zone.contains(&mcell)) {
      let is_caster = m_same_team && j == caster_idx;
      if (spell_target::effect_hits(tf, is_caster, m_same_team)) {
        if (kind == spell_effect::k_geometric_push()) {
          let requested = displacement::zone_edge_distance(&zone, target_cell, mcell);
          if (displace_target(fight, true, j, target_cell, caster_level, kind, requested)) did_damage = true;
        } else {
          let target_bonus = if (bonus_target.is_some() && *bonus_target.borrow() == mob_fid(j)) damage_bonus else 0;
          if (apply_to_mob(
            fight, caster_side, caster_idx, j, caster_cell, caster_stats, caster_level, element,
            effect, target_bonus, damage_roll, effect_ordinal, rng, random_domains, random_effect_ordinals,
            random_rolls, random_bounds,
          )) did_damage = true;
        };
      };
    };
    j = j + 1;
  };
  did_damage
}

/// Dispatch one effect onto a PLAYER fighter `pc` (an ally/self of a player caster, or a mob caster's enemy).
fun apply_to_player(
  fight: &mut Fight,
  caster_side: u8,
  caster_idx: u64,
  pc: u64,
  caster_cell: u64,
  caster_stats: &Stats,
  caster_level: u64,
  element: u8,
  effect: &Effect,
  damage_bonus: u64,
  damage_roll: u64,
  effect_ordinal: u64,
  rng: &mut u64,
  random_domains: &mut vector<u8>,
  random_effect_ordinals: &mut vector<u64>,
  random_rolls: &mut vector<u64>,
  random_bounds: &mut vector<u64>,
): bool {
  let kind = effect.kind();
  let base = effect.value(); // scalar for points / distance / stat / %-life (deterministic, never rolled)
  // #577 — the damage/heal ROLL: one value in [value, value_max] from the shared per-cast fraction (max==value ⇒ fixed).
  let rolled = spell_formula::roll_in_range(base, effect.value_max(), damage_roll);
  let target_stats = *participant::stats(fight::participants(fight).borrow(pc));
  let mut did_damage = false;
  if (kind == spell_effect::k_damage()) {
    let damage = spell_formula::final_damage(rolled + damage_bonus, element, caster_stats, &target_stats);
    hit_player_from(
      fight, pc, caster_side, caster_idx, damage, effect_ordinal, rng, random_domains,
      random_effect_ordinals, random_rolls, random_bounds,
    );
    did_damage = damage > 0;
  } else if (kind == spell_effect::k_heal()) {
    participant::apply_heal(fight::participants_mut(fight).borrow_mut(pc), spell_formula::heal_amount(rolled, caster_stats));
  } else if (kind == spell_effect::k_percent_life_damage()) {
    // %-life is a fraction of the HP POOL, not an authored damage line → no roll (deterministic).
    let (hp, maxhp) = { let p = fight::participants(fight).borrow(pc); (participant::hp(p), participant::max_hp(p)) };
    let pool = if (effect.has_flag(spell_effect::flag_life_lost())) maxhp - hp else hp;
    let damage = pool * base / 100;
    hit_player_from(
      fight, pc, caster_side, caster_idx, damage, effect_ordinal, rng, random_domains,
      random_effect_ordinals, random_rolls, random_bounds,
    );
    did_damage = damage > 0;
  } else if (kind == spell_effect::k_life_steal()) {
    let dmg = spell_formula::final_damage(rolled + damage_bonus, element, caster_stats, &target_stats);
    let actual = hit_player_from(
      fight, pc, caster_side, caster_idx, dmg, effect_ordinal, rng, random_domains,
      random_effect_ordinals, random_rolls, random_bounds,
    );
    heal_caster(fight, caster_side, caster_idx, actual / 2);
    did_damage = dmg > 0;
  } else if (kind == spell_effect::k_punishment_damage()) {
    // The `apply_to_mob` twin. Missing here, this fell to the tail and became a STATUS ROW, so a mob casting a
    // punishment line at a player did no damage at all — while @aresrpg/sim folded it as DAMAGE for both sides.
    let damage = spell_formula::final_damage(base + damage_bonus, element, caster_stats, &target_stats);
    hit_player_from(
      fight, pc, caster_side, caster_idx, damage, effect_ordinal, rng, random_domains,
      random_effect_ordinals, random_rolls, random_bounds,
    );
    did_damage = damage > 0;
  } else if (kind == spell_effect::k_give_points()) {
    // +n NOW (usable if the recipient is mid-act) + a CREDIT row so a feed landed off-turn survives the
    // recipient's begin_turn (MOB_DEBUFF_HAT P1 #2).
    participant::give_points(fight::participants_mut(fight).borrow_mut(pc), effect.stat(), base);
    record_credit(fight, pc, fid_of(caster_side, caster_idx), effect);
  } else if (kind == spell_effect::k_remove_points()) {
    resolve_drain(
      fight, false, pc, caster_side, caster_idx, caster_stats, effect, effect_ordinal, rng,
      random_domains, random_effect_ordinals, random_rolls, random_bounds,
    );
  } else if (kind == spell_effect::k_steal_points()) {
    // STEAL = remove from the target (dodge-contested) + give the ACTUAL removed to the caster, atomically.
    let removed = resolve_drain(
      fight, false, pc, caster_side, caster_idx, caster_stats, effect, effect_ordinal, rng,
      random_domains, random_effect_ordinals, random_rolls, random_bounds,
    );
    give_caster_points(fight, caster_side, caster_idx, effect.stat(), removed);
  } else if (kind == spell_effect::k_alter_stat() || kind == spell_effect::k_alter_resist()) {
    // Timed (turns>0) alters live ONLY as board rows; turns==0 is permanent and lands on the base block.
    // Either way the live block re-derives from base + rows — never delta-reverted (the 0-floor leaked gains).
    apply_alter(fight, pc, effect);
    record_timed(fight, pc, fid_of(caster_side, caster_idx), effect);
    refresh_player_stats(fight, pc);
  } else if (kind == spell_effect::k_steal_stat()) {
    apply_steal_stat(fight, false, pc, caster_side, caster_idx, effect);
  } else if (kind == spell_effect::k_apply_dot()) {
    spell_board::apply_dot(fight::fx_mut(fight), pc, fid_of(caster_side, caster_idx), *effect);
  } else if (kind == spell_effect::k_push()) {
    did_damage = displace_target(fight, false, pc, caster_cell, caster_level, kind, base);
  } else if (kind == spell_effect::k_pull()) {
    did_damage = displace_target(fight, false, pc, caster_cell, caster_level, kind, base);
  } else if (kind == spell_effect::k_throw()) {
    let requested = if (base == 0) 1 else base;
    did_damage = displace_target(fight, false, pc, caster_cell, caster_level, kind, requested);
  } else if (kind == spell_effect::k_swap_positions()) {
    swap_fighters(fight, caster_side == MOB_SIDE, caster_idx, false, pc);
  } else if (kind == spell_effect::k_carry()) {
    carry_fighter(fight, caster_side == MOB_SIDE, caster_idx, false, pc);
  } else if (kind == spell_effect::k_dispel()) {
    dispel_target(fight, false, pc);
  } else if (kind == spell_effect::k_reveal()) {
    statuses::reveal(fight, false, pc);
  } else if (kind == spell_effect::k_forced_death()) {
    did_damage = retro_effects::force_death(fight, false, pc);
  } else if (kind == spell_effect::k_stance()) {
    retro_effects::apply_stance(fight, false, pc, fid_of(caster_side, caster_idx), effect);
  } else if (kind == spell_effect::k_critical_failure()) {
    if (effect_proc(
      effect, rng, fight_events::random_domain_effect_chance(), effect_ordinal, random_domains,
      random_effect_ordinals, random_rolls, random_bounds,
    )) record_timed(fight, pc, fid_of(caster_side, caster_idx), effect);
  } else if (is_board_status(kind)) {
    record_timed(fight, pc, fid_of(caster_side, caster_idx), effect);
  } else if (is_unimplemented(kind)) {
    // NAMED NO-OP, not a silent one. Neither twin implements these; @aresrpg/sim normalizes them to UNSUPPORTED
    // and folds nothing, so recording a row here would invent a status the sim never predicts.
  } else {
    abort EUnhandledEffectKind
  };
  did_damage
}

/// Dispatch one effect onto a MOB fighter `midx` (a player caster's enemy, or a mob caster's ally). The mob's
/// RESIST read + its points/alter HOME are now its MUTABLE per-fight block (`mob::stats` + the board rows), so a
/// player's shred/drain/steal lands for real and an ALLY mob's buff/feed lands too (symmetric
/// with the player path; the old "skipped (flagged)" no-op is gone).
fun apply_to_mob(
  fight: &mut Fight,
  caster_side: u8,
  caster_idx: u64,
  midx: u64,
  caster_cell: u64,
  caster_stats: &Stats,
  caster_level: u64,
  element: u8,
  effect: &Effect,
  damage_bonus: u64,
  damage_roll: u64,
  effect_ordinal: u64,
  rng: &mut u64,
  random_domains: &mut vector<u8>,
  random_effect_ordinals: &mut vector<u64>,
  random_rolls: &mut vector<u64>,
  random_bounds: &mut vector<u64>,
): bool {
  let kind = effect.kind();
  let base = effect.value(); // scalar for points / distance / stat / %-life (deterministic, never rolled)
  let rolled = spell_formula::roll_in_range(base, effect.value_max(), damage_roll); // #577 — damage/heal roll (max==value ⇒ fixed)
  let target_stats = *mob::stats(fight::mobs(fight).borrow(midx)); // the struck mob's per-fight block (resist shred applies)
  let mut did_damage = false;
  if (kind == spell_effect::k_damage()) {
    let damage = spell_formula::final_damage(rolled + damage_bonus, element, caster_stats, &target_stats);
    hit_mob_from(
      fight, midx, caster_side, caster_idx, damage, effect_ordinal, rng, random_domains,
      random_effect_ordinals, random_rolls, random_bounds,
    );
    did_damage = damage > 0;
  } else if (kind == spell_effect::k_life_steal()) {
    let damage = spell_formula::final_damage(rolled + damage_bonus, element, caster_stats, &target_stats);
    let actual = hit_mob_from(
      fight, midx, caster_side, caster_idx, damage, effect_ordinal, rng, random_domains,
      random_effect_ordinals, random_rolls, random_bounds,
    );
    heal_caster(fight, caster_side, caster_idx, actual / 2);
    did_damage = damage > 0;
  } else if (kind == spell_effect::k_percent_life_damage()) {
    // %-life is a fraction of the HP POOL, not an authored damage line → no roll (deterministic).
    let (hp, maxhp) = { let m = fight::mobs(fight).borrow(midx); (mob::hp(m), mob::max_hp(m)) };
    let pool = if (effect.has_flag(spell_effect::flag_life_lost())) maxhp - hp else hp;
    let damage = pool * base / 100;
    hit_mob_from(
      fight, midx, caster_side, caster_idx, damage, effect_ordinal, rng, random_domains,
      random_effect_ordinals, random_rolls, random_bounds,
    );
    did_damage = damage > 0;
  } else if (kind == spell_effect::k_punishment_damage()) {
    let damage = spell_formula::final_damage(rolled + damage_bonus, element, caster_stats, &target_stats);
    hit_mob_from(
      fight, midx, caster_side, caster_idx, damage, effect_ordinal, rng, random_domains,
      random_effect_ordinals, random_rolls, random_bounds,
    );
    did_damage = damage > 0;
  } else if (kind == spell_effect::k_apply_dot()) {
    // DoT ticks resolve on the board (deterministic, zero-caster) — the stored tick value is not slot-varied.
    spell_board::apply_dot(fight::fx_mut(fight), mob_fid(midx), fid_of(caster_side, caster_idx), *effect);
  } else if (kind == spell_effect::k_heal()) {
    // support mobs heal allies — same caster-stat amplification as the player heal.
    mob::apply_heal(fight::mobs_mut(fight).borrow_mut(midx), spell_formula::heal_amount(rolled, caster_stats));
  } else if (kind == spell_effect::k_give_points()) {
    // an ALLY mob feeds this mob AP/MP (boss-synergy: allies add MP to a boss): +n NOW
    // + a CREDIT row so the feed survives the boss's own begin_turn to the turn it was meant to boost
    // (MOB_DEBUFF_HAT P1 #2 — without the row the refill overwrote it and the synergy was gameplay-inert).
    mob::give_points(fight::mobs_mut(fight).borrow_mut(midx), effect.stat(), base);
    record_credit(fight, mob_fid(midx), fid_of(caster_side, caster_idx), effect);
  } else if (kind == spell_effect::k_remove_points()) {
    resolve_drain(
      fight, true, midx, caster_side, caster_idx, caster_stats, effect, effect_ordinal, rng,
      random_domains, random_effect_ordinals, random_rolls, random_bounds,
    );
  } else if (kind == spell_effect::k_steal_points()) {
    let removed = resolve_drain(
      fight, true, midx, caster_side, caster_idx, caster_stats, effect, effect_ordinal, rng,
      random_domains, random_effect_ordinals, random_rolls, random_bounds,
    );
    give_caster_points(fight, caster_side, caster_idx, effect.stat(), removed);
  } else if (kind == spell_effect::k_alter_stat() || kind == spell_effect::k_alter_resist()) {
    // TIMED → board row on the mob's fid; PERMANENT (turns==0) → the mob's base block. Either way the live block
    // re-derives from base + rows (the `apply_to_player` twin). Symmetric sign: a debuff shreds, an ally's buff adds.
    apply_alter_mob(fight, midx, effect);
    record_timed(fight, mob_fid(midx), fid_of(caster_side, caster_idx), effect);
    refresh_mob_stats(fight, midx);
  } else if (kind == spell_effect::k_steal_stat()) {
    apply_steal_stat(fight, true, midx, caster_side, caster_idx, effect);
  } else if (kind == spell_effect::k_push() || kind == spell_effect::k_pull()) {
    did_damage = displace_target(fight, true, midx, caster_cell, caster_level, kind, base);
  } else if (kind == spell_effect::k_throw()) {
    let requested = if (base == 0) 1 else base;
    did_damage = displace_target(fight, true, midx, caster_cell, caster_level, kind, requested);
  } else if (kind == spell_effect::k_swap_positions()) {
    swap_fighters(fight, caster_side == MOB_SIDE, caster_idx, true, midx);
  } else if (kind == spell_effect::k_carry()) {
    carry_fighter(fight, caster_side == MOB_SIDE, caster_idx, true, midx);
  } else if (kind == spell_effect::k_dispel()) {
    dispel_target(fight, true, midx);
  } else if (kind == spell_effect::k_invisibility()) {
    record_timed(fight, mob_fid(midx), fid_of(caster_side, caster_idx), effect);
  } else if (kind == spell_effect::k_reveal()) {
    statuses::reveal(fight, true, midx);
  } else if (kind == spell_effect::k_forced_death()) {
    did_damage = retro_effects::force_death(fight, true, midx);
  } else if (kind == spell_effect::k_stance()) {
    retro_effects::apply_stance(fight, true, midx, fid_of(caster_side, caster_idx), effect);
  } else if (kind == spell_effect::k_critical_failure()) {
    if (effect_proc(
      effect, rng, fight_events::random_domain_effect_chance(), effect_ordinal, random_domains,
      random_effect_ordinals, random_rolls, random_bounds,
    )) record_timed(fight, mob_fid(midx), fid_of(caster_side, caster_idx), effect);
  } else if (is_board_status(kind)) {
    record_timed(fight, mob_fid(midx), fid_of(caster_side, caster_idx), effect);
  } else if (is_unimplemented(kind)) {
    // The `apply_to_player` twin — see there.
  } else {
    // The tail this chain LACKED: an unhandled kind was a silent no-op on a mob while the player sink recorded
    // a row for it. Divergence by omission is exactly what a terminal arm exists to prevent.
    abort EUnhandledEffectKind
  };
  did_damage
}

// ╔════════════════ [ HP application helpers (emit Hit) ] ═══════════════════ ]

fun hit_player(fight: &mut Fight, pc: u64, dmg: u64) {
  let fid = fight::id(fight);
  let remaining = { let p = fight::participants_mut(fight).borrow_mut(pc); participant::apply_damage(p, dmg); participant::hp(p) };
  fight_events::emit_hit(fid, false, pc, dmg, remaining);
  // DEATH FOLD (MOB_DEBUFF_HAT P3 spell_board:286): a corpse's turn never comes, so its rows could never expire —
  // purge them at the kill (no revive-by-heal; rows it SOURCED on others persist). Idempotent on a re-hit corpse.
  if (remaining == 0) purge_fighter_rows(fight, false, pc);
}

fun hit_mob(fight: &mut Fight, midx: u64, dmg: u64) {
  let fid = fight::id(fight);
  let remaining = { let m = fight::mobs_mut(fight).borrow_mut(midx); mob::damage(m, dmg); mob::hp(m) };
  fight_events::emit_hit(fid, true, midx, dmg, remaining);
  if (remaining == 0) purge_fighter_rows(fight, true, midx); // death fold (see hit_player)
}

/// Attributable direct-hit twins. A draw from the cast's existing deterministic stream resolves effect 79;
/// every other Wave 12 reaction is deterministic from the active rows and actual HP loss.
fun hit_player_from(
  fight: &mut Fight,
  pc: u64,
  caster_side: u8,
  caster_idx: u64,
  dmg: u64,
  effect_ordinal: u64,
  rng: &mut u64,
  random_domains: &mut vector<u8>,
  random_effect_ordinals: &mut vector<u64>,
  random_rolls: &mut vector<u64>,
  random_bounds: &mut vector<u64>,
): u64 {
  let mut roll = 0;
  if (retro_effects::has_damage_inversion(fight, false, pc)) {
    let (next_rng, drawn) = prng::rng_int(*rng, 100);
    *rng = next_rng;
    roll = drawn;
    record_random(
      random_domains, random_effect_ordinals, random_rolls, random_bounds,
      fight_events::random_domain_damage_inversion(), effect_ordinal, drawn, 100,
    );
  };
  retro_effects::hit(fight, false, pc, caster_side == MOB_SIDE, caster_idx, true, dmg, roll)
}

fun hit_mob_from(
  fight: &mut Fight,
  midx: u64,
  caster_side: u8,
  caster_idx: u64,
  dmg: u64,
  effect_ordinal: u64,
  rng: &mut u64,
  random_domains: &mut vector<u8>,
  random_effect_ordinals: &mut vector<u64>,
  random_rolls: &mut vector<u64>,
  random_bounds: &mut vector<u64>,
): u64 {
  let mut roll = 0;
  if (retro_effects::has_damage_inversion(fight, true, midx)) {
    let (next_rng, drawn) = prng::rng_int(*rng, 100);
    *rng = next_rng;
    roll = drawn;
    record_random(
      random_domains, random_effect_ordinals, random_rolls, random_bounds,
      fight_events::random_domain_damage_inversion(), effect_ordinal, drawn, 100,
    );
  };
  retro_effects::hit(fight, true, midx, caster_side == MOB_SIDE, caster_idx, true, dmg, roll)
}

fun effect_proc(
  effect: &Effect,
  rng: &mut u64,
  random_domain: u8,
  effect_ordinal: u64,
  random_domains: &mut vector<u8>,
  random_effect_ordinals: &mut vector<u64>,
  random_rolls: &mut vector<u64>,
  random_bounds: &mut vector<u64>,
): bool {
  if (effect.chance() >= 100) return true;
  if (effect.chance() == 0) return false;
  let (next_rng, roll) = prng::rng_int(*rng, 100);
  *rng = next_rng;
  record_random(
    random_domains, random_effect_ordinals, random_rolls, random_bounds,
    random_domain, effect_ordinal, roll, 100,
  );
  roll < (effect.chance() as u64)
}

fun is_retro_status(kind: u8): bool {
  kind == spell_effect::k_damage_to_heal()
    || kind == spell_effect::k_reactive_punishment()
    || kind == spell_effect::k_erosion()
    || kind == spell_effect::k_damage_redirect()
}

/// Kinds whose whole implementation IS a board row: the damage path (or a cast gate) reads them back later.
/// ONE list, consulted by both sinks — the player tail used to swallow these in an unnamed catch-all while the
/// mob tail spelled half of them out, which is how the two drifted without anything failing.
fun is_board_status(kind: u8): bool {
  is_retro_status(kind)
    || kind == spell_effect::k_reduce_damage()
    || kind == spell_effect::k_reflect_damage()
    || kind == spell_effect::k_apply_state()
    || kind == spell_effect::k_return_spell()
    || kind == spell_effect::k_invisibility()
}

/// Kinds in the vocabulary that NEITHER twin implements. Named here so "does nothing" is a decision with a home
/// rather than a gap: @aresrpg/sim normalizes both to UNSUPPORTED and folds nothing, so the chain folds nothing
/// too. Implementing either means deleting it from this list and wiring BOTH sinks in the same commit.
fun is_unimplemented(kind: u8): bool {
  kind == spell_effect::k_remove_state() || kind == spell_effect::k_reset_positions()
}

/// PURGE every board row on a fighter — the ONE death-fold home (fid namespace mapped here). Called by the hit
/// sinks on any kill and by `actions::mark_abandoned` (abandon = death by the same law).
public(package) fun purge_fighter_rows(fight: &mut Fight, is_mob: bool, idx: u64) {
  spell_board::clear_fighter(fight::fx_mut(fight), if (is_mob) mob_fid(idx) else idx);
}

fun heal_caster(fight: &mut Fight, caster_side: u8, caster_idx: u64, amount: u64) {
  if (caster_side == PLAYER_SIDE) participant::apply_heal(fight::participants_mut(fight).borrow_mut(caster_idx), amount);
}

// ╔════════════════ [ Movement effects (push / pull) ] ══════════════════════ ]

/// One sink for both target sides and direct/trap payloads. The shared module mutates the cell; this layer owns
/// combat events, target-only HP writes, and trap payload recursion so module dependencies stay acyclic.
fun displace_target(
  fight: &mut Fight,
  target_is_mob: bool,
  target_idx: u64,
  origin_cell: u64,
  collision_level: u64,
  kind: u8,
  requested: u64,
): bool {
  let (from_cell, to_cell, blocked, damage, entered_trap) = displacement::apply(
    fight, target_is_mob, target_idx, origin_cell, kind, collision_level, requested,
  );
  fight_events::emit_displaced(fight::id(fight), target_is_mob, target_idx, kind, from_cell, to_cell, requested, blocked);
  if (damage > 0) {
    if (target_is_mob) hit_mob(fight, target_idx, damage) else hit_player(fight, target_idx, damage);
  };
  if (entered_trap) trigger_on_enter(fight, target_is_mob, target_idx);
  damage > 0
}

/// Atomic direct exchange: both source cells are captured before either write, then target and caster movements
/// are announced in that order. Swap/carry intentionally bypass occupancy walking and collision/trap reactions.
fun swap_fighters(
  fight: &mut Fight,
  caster_is_mob: bool,
  caster_idx: u64,
  target_is_mob: bool,
  target_idx: u64,
) {
  if (caster_is_mob == target_is_mob && caster_idx == target_idx) return;
  let caster_cell = fighter_cell(fight, caster_is_mob, caster_idx);
  let target_cell = fighter_cell(fight, target_is_mob, target_idx);
  set_fighter_cell(fight, target_is_mob, target_idx, caster_cell);
  set_fighter_cell(fight, caster_is_mob, caster_idx, target_cell);
  let id = fight::id(fight);
  fight_events::emit_displaced(
    id, target_is_mob, target_idx, spell_effect::k_swap_positions(), target_cell, caster_cell, 0, 0,
  );
  fight_events::emit_displaced(
    id, caster_is_mob, caster_idx, spell_effect::k_swap_positions(), caster_cell, target_cell, 0, 0,
  );
}

/// CARRY's ruled co-location is a direct relocation onto the caster's occupied cell.
fun carry_fighter(
  fight: &mut Fight,
  caster_is_mob: bool,
  caster_idx: u64,
  target_is_mob: bool,
  target_idx: u64,
) {
  if (caster_is_mob == target_is_mob && caster_idx == target_idx) return;
  let from_cell = fighter_cell(fight, target_is_mob, target_idx);
  let to_cell = fighter_cell(fight, caster_is_mob, caster_idx);
  set_fighter_cell(fight, target_is_mob, target_idx, to_cell);
  fight_events::emit_displaced(
    fight::id(fight), target_is_mob, target_idx, spell_effect::k_carry(), from_cell, to_cell, 0, 0,
  );
}

/// Remove exactly the board rows admitted by `spell_board::dispel_fighter`, then reconcile the field-backed and
/// derived views through the same expiry sinks. Visibility emits its existing presentation event on real change.
fun dispel_target(fight: &mut Fight, target_is_mob: bool, target_idx: u64) {
  let was_invisible = statuses::is_invisible(fight, target_is_mob, target_idx);
  let fighter = if (target_is_mob) mob_fid(target_idx) else target_idx;
  let expired = spell_board::dispel_fighter(fight::fx_mut(fight), fighter);
  retro_effects::revert_expired_max_hp(fight, target_is_mob, target_idx, &expired);
  retro_effects::emit_expired_stances(fight, target_is_mob, target_idx, &expired);
  if (!expired.is_empty()) {
    if (target_is_mob) refresh_mob_stats(fight, target_idx)
    else refresh_player_stats(fight, target_idx);
  };
  if (was_invisible && !statuses::is_invisible(fight, target_is_mob, target_idx)) {
    fight_events::emit_revealed(fight::id(fight), target_is_mob, target_idx);
  };
}

// ╔════════════════ [ Placement (traps / glyphs) ] ═════════════════════════ ]

fun has_placement(effects: &vector<Effect>): bool {
  let n = effects.length();
  let mut i = 0;
  while (i < n) {
    let k = effects.borrow(i).kind();
    if (k == spell_effect::k_place_trap() || k == spell_effect::k_place_glyph()) return true;
    i = i + 1;
  };
  false
}

fun has_glyph_placement(effects: &vector<Effect>): bool {
  let n = effects.length();
  let mut i = 0;
  while (i < n) {
    if (effects.borrow(i).kind() == spell_effect::k_place_glyph()) return true;
    i = i + 1;
  };
  false
}

/// Mob-authored glyphs use the same board envelope as player glyphs. The sibling non-placement lines become the
/// delayed payload and therefore do not resolve immediately at cast time.
fun place_mob_glyphs(fight: &mut Fight, target: u64, effects: &vector<Effect>) {
  let payload = non_placement_effects(effects);
  let n = effects.length();
  let mut i = 0;
  while (i < n) {
    let effect = effects.borrow(i);
    if (effect.kind() == spell_effect::k_place_glyph()) {
      spell_board::place_glyph(
        fight::fx_mut(fight),
        target,
        MOB_SIDE,
        effect.area_shape(),
        effect.area_size(),
        effect.turns(),
        effect.phase() == spell_effect::phase_end(),
        payload,
      );
    };
    i = i + 1;
  };
}

/// `owner_seat` = the placing player's seat (F-10 — the board rows carry the real owner; PvM owner team is the
/// players' side team 0; kolizeum placement inherits the seat's team so a trap never triggers "for" the enemy).
fun place_effects(fight: &mut Fight, target: u64, owner_seat: u64, effects: &vector<Effect>) {
  let payload = non_placement_effects(effects);
  let owner_team = participant::team(fight::participants(fight).borrow(owner_seat));
  let n = effects.length();
  let mut i = 0;
  while (i < n) {
    let e = effects.borrow(i);
    if (e.kind() == spell_effect::k_place_trap()) {
      // 1.29 TRAP-STACKING BAN — no two traps share an anchor cell: ONE live trap per
      // ANCHOR cell — a second trap on a trapped cell aborts whole (a detonated trap frees it; overlapping
      // blast ZONES stay legal, the ban is anchor-on-anchor). INFO-LEAK ACCEPTED BY DESIGN: the check reads ANY
      // live trap regardless of owner, so casting onto an ENEMY's invisible trap aborts — revealing one exists
      // there. A chain abort can't be hidden (and Fight.fx is public on-chain anyway); 1.29 leaked the same.
      // A per-owner-team alternative is as cheap (CellEntry carries owner_team) but would let a trap stack on
      // top of an enemy's — rejected: the rule is per-CELL, owner-blind.
      assert!(!spell_board::has_trap_at(fight::fx(fight), target), ECellAlreadyTrapped);
      spell_board::place_trap(fight::fx_mut(fight), target, owner_team, e.area_shape(), e.area_size(), payload);
      displacement::record_trap_owner(fight, target, owner_seat);
    } else if (e.kind() == spell_effect::k_place_glyph()) {
      let end_of_turn = e.phase() == spell_effect::phase_end();
      spell_board::place_glyph(fight::fx_mut(fight), target, owner_team, e.area_shape(), e.area_size(), e.turns(), end_of_turn, payload);
    };
    i = i + 1;
  };
}

fun non_placement_effects(effects: &vector<Effect>): vector<Effect> {
  let mut out = vector[];
  let n = effects.length();
  let mut i = 0;
  while (i < n) {
    let e = effects.borrow(i);
    let k = e.kind();
    if (k != spell_effect::k_place_trap() && k != spell_effect::k_place_glyph()) out.push_back(*e);
    i = i + 1;
  };
  out
}

// ╔════════════════ [ Board ticks (F-12 — traps / glyphs / DoT / timed expiry) ] ═ ]

/// Turn-START board work for a fighter (§5d ordering): apply the due start-phase glyph payloads + its DoT rows.
/// Returns whether the fighter survived (a DoT can kill at turn start — the turn machine then walks on).
public(package) fun tick_turn_start(fight: &mut Fight, is_mob: bool, idx: u64): bool {
  let fid = if (is_mob) mob_fid(idx) else idx;
  let mut payloads = retro_effects::take_due_payloads(fight, fid);
  while (!payloads.is_empty()) {
    let (_source, effects) = retro_effects::destroy_payload(payloads.remove(0));
    apply_board_batch(fight, is_mob, idx, &effects);
    if (!fighter_alive(fight, is_mob, idx)) return false;
  };
  let cell = fighter_cell(fight, is_mob, idx);
  let due = spell_board::tick_start(fight::fx(fight), fid, cell);
  apply_board_batch(fight, is_mob, idx, &due);
  fighter_alive(fight, is_mob, idx)
}

/// Turn-END board work (§5d): end-phase glyph payloads, then EXPIRE the fighter's timed rows — BOTH sides
/// re-derive live stats from base + the surviving rows (the mob per-fight block is mutable since 2026-07-12;
/// stale-doc fix per MOB_DEBUFF_HAT P3 cast:486). Glyph DURATIONS tick on player turn-ends (v1 DECLARED anchor:
/// exact for PvM where one player side drives the round; the per-caster anchoring refinement rides the kolizeum polish).
public(package) fun tick_turn_end(fight: &mut Fight, is_mob: bool, idx: u64) {
  let fid = if (is_mob) mob_fid(idx) else idx;
  let cell = fighter_cell(fight, is_mob, idx);
  let due = spell_board::tick_end(fight::fx(fight), cell);
  apply_board_batch(fight, is_mob, idx, &due);
  let expired = spell_board::decrement_fighter_statuses(fight::fx_mut(fight), fid);
  retro_effects::revert_expired_max_hp(fight, is_mob, idx, &expired);
  retro_effects::emit_expired_stances(fight, is_mob, idx, &expired);
  // An expired timed ALTER row must re-derive the fighter's live stats — for MOBS too now (their per-fight block
  // is mutable), else a shred/buff would never wear off. Drain rows carry no revert delta (not in `expired`); the
  // pool recomputes from base at the next `begin_turn`, so nothing to refresh there.
  if (is_mob) {
    if (!expired.is_empty()) refresh_mob_stats(fight, idx);
  } else {
    if (!expired.is_empty()) refresh_player_stats(fight, idx);
    spell_board::decrement_glyphs(fight::fx_mut(fight));
  };
}

/// A fighter ENTERED its current cell (move / push / pull / teleport / mob advance): detonate a covering trap
/// onto the MOVER (no team check — a trap fires for anyone, §5f#3).
public(package) fun trigger_on_enter(fight: &mut Fight, is_mob: bool, idx: u64) {
  let cell = fighter_cell(fight, is_mob, idx);
  let (anchor, payload) = spell_board::on_enter_with_anchor(fight::fx_mut(fight), cell);
  if (anchor.is_some()) {
    let origin = anchor.destroy_some();
    let collision_level = displacement::take_trap_owner_level(fight, origin);
    if (!payload.is_empty()) apply_board_batch_from(fight, is_mob, idx, &payload, option::some(origin), collision_level);
  };
}

/// Apply a BOARD payload batch to ONE fighter. The source's live stats are gone (dead/anonymous), so v1
/// DECLARED: flat values through `final_damage` with a ZERO caster block (the target's resists still apply, no
/// amplification), heal/points apply directly, alters land base-or-row + re-derive (self-sourced when timed),
/// and origin-less glyph/DoT displacement remains skipped. Deterministic — no RNG.
fun apply_board_batch(fight: &mut Fight, is_mob: bool, idx: u64, effects: &vector<Effect>) {
  apply_board_batch_from(fight, is_mob, idx, effects, option::none(), 1);
}

/// Trap payload twin: `origin` is the removed trap anchor and `collision_level` is the level recorded for its owner, or
/// 1 for a pre-upgrade trap. PUSH/PULL route through the same side-aware sink as direct spell effects.
fun apply_board_batch_from(
  fight: &mut Fight,
  is_mob: bool,
  idx: u64,
  effects: &vector<Effect>,
  origin: Option<u64>,
  collision_level: u64,
) {
  let zero = spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  let n = effects.length();
  let mut e = 0;
  while (e < n) {
    let effect = effects.borrow(e);
    let kind = effect.kind();
    let base = effect.value();
    let element = effect.element();
    let is_damage = kind == spell_effect::k_damage() || kind == spell_effect::k_apply_dot() || kind == spell_effect::k_life_steal();
    let board_roll = prng::mix(fight::turn_seed(fight, if (is_mob) mob_fid(idx) else idx), e) % 100;
    // #577 — board ticks (traps/glyphs/DoT) are turn-seed-derived + previewable; the damage roll uses the effect
    // ordinal as its slot so each tick rolls its own [value, value_max] (fixed effects, max==value, are unchanged).
    let board_damage = spell_formula::roll_in_range(base, effect.value_max(), spell_formula::slot_damage_roll(fight::turn_seed(fight, if (is_mob) mob_fid(idx) else idx), e));
    if ((kind == spell_effect::k_push() || kind == spell_effect::k_pull()) && origin.is_some()) {
      let _did_damage = displace_target(fight, is_mob, idx, *origin.borrow(), collision_level, kind, base);
    } else if (is_mob) {
      if (is_damage) {
        let target_stats = *mob::stats(fight::mobs(fight).borrow(idx)); // the mob's per-fight block (resist shred applies)
        retro_effects::hit(fight, true, idx, false, 0, false, spell_formula::final_damage(board_damage, element, &zero, &target_stats), board_roll);
      } else if (kind == spell_effect::k_percent_life_damage()) {
        let (hp, maxhp) = { let m = fight::mobs(fight).borrow(idx); (mob::hp(m), mob::max_hp(m)) };
        let pool = if (effect.has_flag(spell_effect::flag_life_lost())) maxhp - hp else hp;
        retro_effects::hit(fight, true, idx, false, 0, false, pool * base / 100, board_roll);
      } else if (kind == spell_effect::k_heal()) {
        mob::apply_heal(fight::mobs_mut(fight).borrow_mut(idx), base); // board heals apply flat (zero-caster law)
      } else if (kind == spell_effect::k_give_points()) {
        mob::give_points(fight::mobs_mut(fight).borrow_mut(idx), effect.stat(), base);
      } else if (kind == spell_effect::k_remove_points() || kind == spell_effect::k_steal_points()) {
        // board-tick drains are GUARANTEED + immediate ONLY (no dodge, no debt row): a glyph re-applies each turn
        // a fighter stands in it, so a lingering debt would double-count. STEAL-in-payload applies its REMOVAL
        // half here (MOB_DEBUFF_HAT P3 cast:534 — was a silent no-op); the feed half has no live caster to pay
        // (zero-caster law: the source is dead/anonymous). Mirrors the player board branch below.
        mob::drain_points(fight::mobs_mut(fight).borrow_mut(idx), effect.stat(), base);
      } else if (kind == spell_effect::k_alter_stat() || kind == spell_effect::k_alter_resist()) {
        apply_alter_mob(fight, idx, effect);
        record_timed(fight, mob_fid(idx), mob_fid(idx), effect);
        refresh_mob_stats(fight, idx);
      } else if (kind == spell_effect::k_forced_death()) {
        retro_effects::force_death(fight, true, idx);
      } else if (kind == spell_effect::k_stance()) {
        retro_effects::apply_stance(fight, true, idx, mob_fid(idx), effect);
      } else if (is_retro_status(kind)) {
        record_timed(fight, mob_fid(idx), mob_fid(idx), effect);
      };
    } else if (is_damage) {
      let target_stats = *participant::stats(fight::participants(fight).borrow(idx));
      retro_effects::hit(fight, false, idx, false, 0, false, spell_formula::final_damage(board_damage, element, &zero, &target_stats), board_roll);
    } else if (kind == spell_effect::k_percent_life_damage()) {
      let (hp, maxhp) = { let p = fight::participants(fight).borrow(idx); (participant::hp(p), participant::max_hp(p)) };
      let pool = if (effect.has_flag(spell_effect::flag_life_lost())) maxhp - hp else hp;
      retro_effects::hit(fight, false, idx, false, 0, false, pool * base / 100, board_roll);
    } else if (kind == spell_effect::k_heal()) {
      participant::apply_heal(fight::participants_mut(fight).borrow_mut(idx), base);
    } else if (kind == spell_effect::k_give_points()) {
      participant::give_points(fight::participants_mut(fight).borrow_mut(idx), effect.stat(), base);
    } else if (kind == spell_effect::k_remove_points() || kind == spell_effect::k_steal_points()) {
      // steal-in-payload = its removal half (MOB_DEBUFF_HAT P3 cast:534) — see the mob branch above.
      participant::remove_points(fight::participants_mut(fight).borrow_mut(idx), effect.stat(), base);
    } else if (kind == spell_effect::k_alter_stat() || kind == spell_effect::k_alter_resist()) {
      apply_alter(fight, idx, effect);
      record_timed(fight, idx, idx, effect);
      refresh_player_stats(fight, idx);
    } else if (kind == spell_effect::k_forced_death()) {
      retro_effects::force_death(fight, false, idx);
    } else if (kind == spell_effect::k_stance()) {
      retro_effects::apply_stance(fight, false, idx, idx, effect);
    } else if (is_retro_status(kind)) {
      record_timed(fight, idx, idx, effect);
    };
    e = e + 1;
  };
}

/// PERMANENT (turns==0) alter application: lands on the participant's BASE block (a timed alter instead becomes
/// a board row via `record_timed`). Exactly one of the two paths does work for any alter effect; both end in a
/// `refresh_player_stats` re-derivation at the call site. Magnitude and sign both come out of the CENTERED
/// value (`participant::alter_delta`, #904) — the raw `effect.value()` is an encoded number, never an amount.
fun apply_alter(fight: &mut Fight, pc: u64, effect: &Effect) {
  if (effect.turns() > 0) return;
  // Corpus raw142 duration 0 means the bearer's current turn, not fight-permanent. `record_timed` creates its
  // synthetic one-turn row; never write this new stat id into the permanent base block.
  if (effect.kind() == spell_effect::k_alter_stat() && effect.stat() == spell_effect::stat_physical_damage()) return;
  let (amount, neg) = participant::alter_delta(effect);
  let p = fight::participants_mut(fight).borrow_mut(pc);
  if (effect.kind() == spell_effect::k_alter_stat()) {
    participant::alter_base_stat(p, effect.stat(), amount, neg)
  } else {
    participant::alter_base_resist(p, effect.element(), amount, neg)
  };
}

/// Re-derive player `pc`'s live stats from base + its live alter rows (`participant::refresh_stats`) — apply
/// and expiry both converge on this one fold. Control kinds (reduce/reflect/invisibility) carry no stat delta,
/// so their expiry needs nothing beyond the row drop.
fun refresh_player_stats(fight: &mut Fight, pc: u64) {
  let rows = spell_board::fighter_alter_rows(fight::fx(fight), pc);
  participant::refresh_stats(fight::participants_mut(fight).borrow_mut(pc), &rows);
}

// ╔════════════════ [ Points economy — dodge-contested drains / steal / alter (mob-parity) ] ═ ]
//
// AP/MP-REMOVAL SEMANTICS (documented as the module contract):
//   • CONTEST — every removal is agility-contested (the `dodgeable` flag = 1.29's dodgeable class 101/127; the
//     guaranteed class 168/169 skips the roll). DEFENDER term = agility + ap/mp_dodge; REMOVER term = wisdom.
//     A player cast rolls off the public turn-seed slot (previewable); a mob cast rolls off the crank draw.
//     The contest runs against the REFILL BASE (`current = max`), NEVER the residual pool (MOB_DEBUFF_HAT P1 #1:
//     drains land between the target's turns when its pool is spent-down — a residual-capped contest made every
//     real-flow retrait a no-op; base-contest also restores the 1.29 characteristic-contest of `(current−removed)/max`).
//   • PERSISTENCE — the post-dodge `removed` records a timed DEBT row, so the target's next `begin_turn` refills
//     to base − removed + credits (a drain that didn't survive the refill was a real bug — the boss just
//     refilled and one-shot the party). The LIVE pool is also shaved now, floored at what it still holds (the
//     immediate half matters only when the target still acts this turn). Duration = the effect's `turns`, floored
//     at 1 (a removal always denies the next turn). MOB pools ARE the constraint: draining AP throttles a mob's
//     per-turn casts, draining MP throttles its movement (the AI reads ap/mp for exactly this).
//   • GIVE — the buff twin (MOB_DEBUFF_HAT P1 #2): +n NOW plus a CREDIT row, so a feed landed between the
//     recipient's turns survives its `begin_turn` (refill = base − debt + credit) instead of evaporating unread.
//     STEAL = the removal + feeding the actual removed to the caster NOW (caster is mid-act — immediate-use, no
//     credit row: 1.29 stolen points last the caster's current turn).
//   • CLAMP — pools and the net refill floor at 0 (u64-safe, never wraps); alters saturate at 0 (spell::sub_*).

/// Resolve a point-removal at ONE target (`target_is_mob` picks the pool + dodge home). See the block header.
/// Returns the POST-DODGE removed count (steal's caster-feed reads it).
fun resolve_drain(
  fight: &mut Fight,
  target_is_mob: bool,
  target_idx: u64,
  caster_side: u8,
  caster_idx: u64,
  caster_stats: &Stats,
  effect: &Effect,
  effect_ordinal: u64,
  rng: &mut u64,
  random_domains: &mut vector<u8>,
  random_effect_ordinals: &mut vector<u64>,
  random_rolls: &mut vector<u64>,
  random_bounds: &mut vector<u64>,
): u64 {
  let point_kind = effect.stat();
  let dodgeable = effect.has_flag(spell_effect::flag_dodge());
  // P1 #1 (MOB_DEBUFF_HAT): the contest pool is the REFILL BASE, not the live residual — `removed` is what the
  // drain denies the target's NEXT refill, independent of how spent the pool happens to be right now.
  let (base, target_dodge) = if (target_is_mob) {
    let kit = fight::content_kit(fight::member_content(fight, target_idx));
    let mx = if (point_kind == spell_effect::point_ap()) mob::kit_base_ap(kit) else mob::kit_base_mp(kit);
    (mx, dodge_term(mob::stats(fight::mobs(fight).borrow(target_idx)), point_kind))
  } else {
    let p = fight::participants(fight).borrow(target_idx);
    let mx = if (point_kind == spell_effect::point_ap()) participant::base_ap(p) else participant::base_mp(p);
    (mx, dodge_term(participant::stats(p), point_kind))
  };
  let requested = effect.value();
  let (new_rng, removed, drain_rolls) = spell_formula::remove_points_with_rolls(
    *rng, requested, dodgeable, spell::stat_wisdom(caster_stats), target_dodge, base, base,
  );
  *rng = new_rng;
  let mut roll_idx = 0;
  while (roll_idx < drain_rolls.length()) {
    record_random(
      random_domains, random_effect_ordinals, random_rolls, random_bounds,
      fight_events::random_domain_drain(), effect_ordinal, *drain_rolls.borrow(roll_idx), 100,
    );
    roll_idx = roll_idx + 1;
  };
  if (removed > 0) {
    // immediate half: shave the LIVE pool, floored at what it holds (drain_points/remove_points both floor at 0).
    if (target_is_mob) mob::drain_points(fight::mobs_mut(fight).borrow_mut(target_idx), point_kind, removed)
    else participant::remove_points(fight::participants_mut(fight).borrow_mut(target_idx), point_kind, removed);
    // persistent half: the FULL contested count lands as debt on the next refill.
    let target_fid = if (target_is_mob) mob_fid(target_idx) else target_idx;
    let dur = if (effect.turns() == 0) 1 else effect.turns();
    spell_board::add_status(fight::fx_mut(fight), target_fid, fid_of(caster_side, caster_idx), spell_effect::drain_row(point_kind, removed, dur));
  };
  fight_events::emit_drain(fight::id(fight), target_is_mob, target_idx, point_kind, removed, requested);
  removed
}

/// The DEFENDER's dodge term: agility + the pool-specific dodge stat (a boss with enough agility dodges).
fun dodge_term(s: &Stats, point_kind: u8): u64 {
  spell::stat_agility(s) + if (point_kind == spell_effect::point_ap()) spell::stat_ap_dodge(s) else spell::stat_mp_dodge(s)
}

/// GIVE the stolen points to the CASTER (steal's second half) — player seat or mob index. Immediate-use ONLY
/// (no credit row): the caster is mid-act and spends them this turn; 1.29 stolen points last the caster's turn.
fun give_caster_points(fight: &mut Fight, caster_side: u8, caster_idx: u64, point_kind: u8, n: u64) {
  if (n == 0) return;
  if (caster_side == PLAYER_SIDE) participant::give_points(fight::participants_mut(fight).borrow_mut(caster_idx), point_kind, n)
  else mob::give_points(fight::mobs_mut(fight).borrow_mut(caster_idx), point_kind, n);
}

/// Record a give's CREDIT row on `target_fid` (the drain row's opposite-sign twin — MOB_DEBUFF_HAT P1 #2).
/// Duration = the effect's `turns` floored at 1: the feed boosts at least the recipient's next refill, then
/// expires at that fighter's turn-end (a SELF/mid-turn give's row dies at the giver's own turn-end — no double).
fun record_credit(fight: &mut Fight, target_fid: u64, src_fid: u64, effect: &Effect) {
  let dur = if (effect.turns() == 0) 1 else effect.turns();
  spell_board::add_status(fight::fx_mut(fight), target_fid, src_fid, spell_effect::credit_row(effect.stat(), effect.value(), dur));
}

/// PERMANENT (turns==0) alter on a MOB → its base block (the `apply_alter` twin). Timed alters are rows.
fun apply_alter_mob(fight: &mut Fight, midx: u64, effect: &Effect) {
  if (effect.turns() > 0) return;
  if (effect.kind() == spell_effect::k_alter_stat() && effect.stat() == spell_effect::stat_physical_damage()) return;
  let (amount, neg) = participant::alter_delta(effect);
  let m = fight::mobs_mut(fight).borrow_mut(midx);
  if (effect.kind() == spell_effect::k_alter_stat()) {
    mob::alter_base_stat(m, effect.stat(), amount, neg)
  } else {
    mob::alter_base_resist(m, effect.element(), amount, neg)
  };
}

/// Re-derive mob `midx`'s live stats from base + its live alter rows (the `refresh_player_stats` twin).
fun refresh_mob_stats(fight: &mut Fight, midx: u64) {
  let rows = spell_board::fighter_alter_rows(fight::fx(fight), mob_fid(midx));
  mob::refresh_stats(fight::mobs_mut(fight).borrow_mut(midx), &rows);
}

/// STEAL_STAT splits one authored line into two ordinary timed alter rows: a negative row on the target and an
/// equal positive row on the caster. Both share duration/dispellability and naturally disappear through each
/// fighter's own status clock; live stats always re-derive from the board fold.
fun apply_steal_stat(
  fight: &mut Fight,
  target_is_mob: bool,
  target_idx: u64,
  caster_side: u8,
  caster_idx: u64,
  effect: &Effect,
) {
  let duration = if (effect.turns() == 0) 1 else effect.turns();
  let dispellable = effect.has_flag(spell_effect::flag_dispellable());
  // STEAL_STAT (kind 12) is NOT a signed kind — its own `value` is a plain magnitude. The two ALTER_STAT rows
  // it mints are, so both are CENTERED on the way out (#904): the board holds one encoding, minted or synthetic.
  let debit = spell_effect::alter_stat(effect.stat(), participant::centered_value(effect.value(), true), true, dispellable, duration);
  let credit = spell_effect::alter_stat(effect.stat(), participant::centered_value(effect.value(), false), false, dispellable, duration);
  let source = fid_of(caster_side, caster_idx);
  let target = if (target_is_mob) mob_fid(target_idx) else target_idx;
  spell_board::add_status(fight::fx_mut(fight), target, source, debit);
  spell_board::add_status(fight::fx_mut(fight), source, source, credit);
  if (target_is_mob) refresh_mob_stats(fight, target_idx)
  else refresh_player_stats(fight, target_idx);
  if (caster_side == MOB_SIDE) refresh_mob_stats(fight, caster_idx)
  else refresh_player_stats(fight, caster_idx);
}

/// The (ap_debt, mp_debt, ap_credit, mp_credit) point adjustments on a fighter — the turn machine reads them at
/// `begin_turn` to refill to `net_refill(base, debt, credit)` (MOB_DEBUFF_HAT P1 #2 folded the give credits in).
/// `is_mob` picks the fid namespace (player seat vs mob_fid); the single home for the fid→rows mapping.
public(package) fun point_adjust(fight: &Fight, is_mob: bool, idx: u64): (u64, u64, u64, u64) {
  let fid = if (is_mob) mob_fid(idx) else idx;
  let fx = fight::fx(fight);
  (spell_board::fighter_point_debt(fx, fid, spell_effect::point_ap()),
   spell_board::fighter_point_debt(fx, fid, spell_effect::point_mp()),
   spell_board::fighter_point_credit(fx, fid, spell_effect::point_ap()),
   spell_board::fighter_point_credit(fx, fid, spell_effect::point_mp()))
}

fun fighter_cell(fight: &Fight, is_mob: bool, idx: u64): u64 {
  if (is_mob) mob::cell(fight::mobs(fight).borrow(idx)) else participant::cell(fight::participants(fight).borrow(idx))
}

fun set_fighter_cell(fight: &mut Fight, is_mob: bool, idx: u64, cell: u64) {
  if (is_mob) mob::set_cell(fight::mobs_mut(fight).borrow_mut(idx), cell)
  else participant::set_cell(fight::participants_mut(fight).borrow_mut(idx), cell);
}

fun fighter_alive(fight: &Fight, is_mob: bool, idx: u64): bool {
  if (is_mob) mob::is_alive(fight::mobs(fight).borrow(idx)) else participant::is_alive(fight::participants(fight).borrow(idx))
}

// ╔════════════════ [ Small helpers ] ══════════════════════════════════════ ]

const MOB_FID_BASE: u64 = 1_000; // effect-board fighter-id namespace: players = seat, mobs = base + idx
fun mob_fid(idx: u64): u64 { MOB_FID_BASE + idx }
/// A caster's effect-board fighter id (F-10/11 — board rows carry the REAL source, namespaced by side).
fun fid_of(side: u8, idx: u64): u64 { if (side == MOB_SIDE) mob_fid(idx) else idx }

/// Record a TIMED status row on the effect board (buff/debuff/state); a `turns==0` effect persists permanently
/// (no row). Timed alter_stat/alter_resist rows are reverted by the turn-tick machinery. `src_fid` = the real
/// caster's board fid (F-11 — dispel-by-source and kill attribution read it).
fun record_timed(fight: &mut Fight, pc: u64, src_fid: u64, effect: &Effect) {
  if (effect.turns() > 0) {
    spell_board::add_status(fight::fx_mut(fight), pc, src_fid, *effect);
  } else if (effect.kind() == spell_effect::k_alter_stat() && effect.stat() == spell_effect::stat_physical_damage()) {
    // The value rides through VERBATIM — it is already the centered encoding (#904) and the row it lands in is
    // read by the same fold; re-deriving it from `alter_delta` would only re-center what is already centered.
    let current_turn = spell_effect::alter_stat(
      spell_effect::stat_physical_damage(), effect.value(), effect.has_flag(spell_effect::flag_negative()), false, 1,
    );
    spell_board::add_status(fight::fx_mut(fight), pc, src_fid, current_turn);
  };
}

/// Is any living fighter standing on `cell`? (occupancy for can_cast_at + slide).
public(package) fun cell_occupied(fight: &Fight, cell: u64): bool {
  let np = fight::participants(fight).length();
  let mut i = 0;
  while (i < np) {
    let p = fight::participants(fight).borrow(i);
    if (participant::is_alive(p) && participant::cell(p) == cell) return true;
    i = i + 1;
  };
  let nm = fight::mobs(fight).length();
  let mut j = 0;
  while (j < nm) {
    let m = fight::mobs(fight).borrow(j);
    if (mob::is_alive(m) && mob::cell(m) == cell) return true;
    j = j + 1;
  };
  false
}

/// The immutable OFF-SHAPE wall set as a MASK_WORDS-word BITSET: every grid cell NOT on the board's `shape_mask`
/// (impassable terrain). A pure function of the FIXED board geometry (shape_mask is set at fight creation, never
/// mutated), so it is constant for the whole fight. The mob crank builds it ONCE per `resolve_from` (gas diet d)
/// instead of re-scanning all ~380 cells per mob — and as a bitset the memo threads 6 u64 words, not a ~200-cell
/// vector copy (gas-diet #1). `move_blocked_cells` reuses it too, so the scan has a single home.
public(package) fun off_shape_mask(fight: &Fight): vector<u64> {
  displacement::off_shape_mask(fight)
}

/// The MOVEMENT wall set for BFS as a MASK_WORDS-word BITSET: obstacles ∪ holes ∪ off-shape cells ∪ every living
/// body EXCEPT the mover. `exclude_mob` + `exclude_idx` name the mover (so it doesn't block its own path). Fed
/// straight into `combat_grid::bfs_*` for O(1) `mask_get` membership (gas-diet #1). Used by player moves + the mob
/// AI's advance. (The mob crank uses `move_blocked_cells_memo` to share one off-shape scan across the walk.)
public(package) fun move_blocked_cells(fight: &Fight, exclude_mob: bool, exclude_idx: u64): vector<u64> {
  displacement::move_blocked_cells(fight, exclude_mob, exclude_idx)
}

/// (d) MEMO twin of `move_blocked_cells` for the mob-turn crank: takes the precomputed immutable `off_shape` MASK
/// (so the ~380-cell scan runs ONCE per `resolve_from`, not per mob — a 6-word memo, not a ~200-cell copy) while
/// the DYNAMIC bodies are STILL re-read here — a mob that moved, or a participant/mob that died earlier in the
/// same walk, is reflected correctly (only the terrain is memoized, never a body position). Always the mob path:
/// excludes mob `exclude_idx`, every living participant blocks. BIT-IDENTICAL to `move_blocked_cells(fight, true,
/// exclude_idx)` (masks are canonical — same cells ⇒ same words).
public(package) fun move_blocked_cells_memo(fight: &Fight, exclude_idx: u64, off_shape: &vector<u64>): vector<u64> {
  displacement::move_blocked_cells_memo(fight, exclude_idx, off_shape)
}

/// LOS blocker set = obstacles ∪ living fighter bodies (no shooting through walls or fighters).
public(package) fun los_obstacles(fight: &Fight): vector<u64> {
  let mut out = fight::obstacles(fight);
  let np = fight::participants(fight).length();
  let mut i = 0;
  while (i < np) {
    let p = fight::participants(fight).borrow(i);
    if (participant::is_alive(p)) out.push_back(participant::cell(p));
    i = i + 1;
  };
  let nm = fight::mobs(fight).length();
  let mut j = 0;
  while (j < nm) {
    let m = fight::mobs(fight).borrow(j);
    if (mob::is_alive(m)) out.push_back(mob::cell(m));
    j = j + 1;
  };
  out
}
