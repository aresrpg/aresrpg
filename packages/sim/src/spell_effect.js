// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SPELL EFFECT ENVELOPE — the composable, data-only effect record, a byte-for-byte mirror of
// aresrpg_foundation::spell_effect.move (S-16 parity). A spell is a LIST of `Effect`s, each selecting one of
// ~30 mechanics by a `kind` discriminant; element/stat are PARAMETERS, not opcodes. PURE DATA — no coupling to
// board/fighter state. This is the vocabulary `effect_board.js` resolves against and `stats_derive.js` folds.
//
// Independent of `spell.js` on purpose (mirrors the Move no-cycle rule: spell_effect never `use`s spell).

// ╔════════════════ [ Effect kinds (~30 mechanics; summoning EXCLUDED) ] ═══════════ ]
export const K_DAMAGE = 0
export const K_PERCENT_LIFE_DAMAGE = 1
export const K_LIFE_STEAL = 2
export const K_CASTER_DAMAGE = 3
export const K_PUNISHMENT_DAMAGE = 4
export const K_HEAL = 5
export const K_GIVE_POINTS = 6
export const K_REMOVE_POINTS = 7
export const K_STEAL_POINTS = 8
export const K_ALTER_STAT = 9
export const K_STEAL_STAT = 10
export const K_ALTER_RESIST = 11
export const K_PUSH = 12
export const K_PULL = 13
export const K_TELEPORT = 14
export const K_SWAP_POSITIONS = 15
export const K_CARRY = 16
export const K_THROW = 17
export const K_RESET_POSITIONS = 18
export const K_PLACE_TRAP = 19
export const K_PLACE_GLYPH = 20
export const K_APPLY_DOT = 21
export const K_APPLY_STATE = 22
export const K_REMOVE_STATE = 23
export const K_REDUCE_DAMAGE = 24
export const K_REFLECT_DAMAGE = 25
export const K_DISPEL = 26
export const K_INVISIBILITY = 27
export const K_REVEAL = 28
export const K_RETURN_SPELL = 29
// Effect 783: target cell is the repulsion origin; distance is derived from the selected fighter's outward ray
// to the immutable effect-zone edge. AresRPG brand law keeps corpus names out of runtime vocabulary.
export const K_GEOMETRIC_PUSH = 30
// Wave 12 retro mechanics. Append-only: every published discriminant above remains byte-stable.
// AresRPG brand law keeps reference names in the corpus and runtime vocabulary generic/internal.
export const K_CRITICAL_FAILURE = 31
export const K_DAMAGE_TO_HEAL = 32
export const K_FORCED_DEATH = 33
export const K_TIMED_PAYLOAD = 34
export const K_NAMED_DAMAGE_STACK = 35
export const K_STANCE = 36
export const K_REACTIVE_PUNISHMENT = 37
export const K_EROSION = 38
export const K_DAMAGE_REDIRECT = 39

// ╔════════════════ [ AoE shape codes (taxonomy §3) — the ZONE namespace ] ═════════ ]
export const SHAPE_POINT = 0
export const SHAPE_CIRCLE = 1
export const SHAPE_CROSS = 2
export const SHAPE_LINE = 3
export const SHAPE_TBAR = 4
export const SHAPE_RING = 5
export const SHAPE_ALLMAP = 6
export const SHAPE_CONE = 7

export const shape_point = () => SHAPE_POINT
export const shape_circle = () => SHAPE_CIRCLE
export const shape_cross = () => SHAPE_CROSS
export const shape_line = () => SHAPE_LINE
export const shape_tbar = () => SHAPE_TBAR
export const shape_ring = () => SHAPE_RING
export const shape_allmap = () => SHAPE_ALLMAP
export const shape_cone = () => SHAPE_CONE

// ╔════════════════ [ Target filter bitmask (taxonomy §2b) ] ═══════════════════════ ]
export const TF_NONE = 0
export const TF_NOT_TEAM = 1
export const TF_NOT_SELF = 2
export const TF_NOT_ENEMY = 4
export const TF_ONLY_CASTER = 32

// ╔════════════════ [ Point kinds / stat ids / flags / trigger phases ] ════════════ ]
export const POINT_AP = 0
export const POINT_MP = 1

export const STAT_STRENGTH = 0
export const STAT_INTELLIGENCE = 1
export const STAT_CHANCE = 2
export const STAT_AGILITY = 3
export const STAT_WISDOM = 4
export const STAT_VITALITY = 5
export const STAT_RANGE = 6
export const STAT_CRIT = 7
export const STAT_PERCENT_DAMAGE = 8
export const STAT_RAW_DAMAGE = 9
export const STAT_MAX_HP = 10
export const STAT_HEAL = 11
export const STAT_AP_DODGE = 12
export const STAT_MP_DODGE = 13
export const STAT_PHYSICAL_DAMAGE = 14

export const FLAG_DODGE = 1
export const FLAG_PERCENT = 2
export const FLAG_DISPELLABLE = 4
export const FLAG_NEGATIVE = 8
export const FLAG_LIFE_LOST = 16
// (bit 32 — FLAG_RANDOM_ELEMENT — removed 2026-07-11 in lockstep with the Move vocabulary: dead flag, zero
// shipped spells; the on-chain resolver is fully deterministic under the single-PTB turn law.)

export const PHASE_ON_ENTER = 0
export const PHASE_START = 1
export const PHASE_END = 2

export const k_place_trap = () => K_PLACE_TRAP
export const k_place_glyph = () => K_PLACE_GLYPH
export const k_apply_dot = () => K_APPLY_DOT
export const k_alter_stat = () => K_ALTER_STAT
export const k_alter_resist = () => K_ALTER_RESIST
export const k_reduce_damage = () => K_REDUCE_DAMAGE
export const k_reflect_damage = () => K_REFLECT_DAMAGE
export const k_invisibility = () => K_INVISIBILITY
export const k_reveal = () => K_REVEAL
export const k_return_spell = () => K_RETURN_SPELL
export const k_geometric_push = () => K_GEOMETRIC_PUSH
export const k_critical_failure = () => K_CRITICAL_FAILURE
export const k_damage_to_heal = () => K_DAMAGE_TO_HEAL
export const k_forced_death = () => K_FORCED_DEATH
export const k_timed_payload = () => K_TIMED_PAYLOAD
export const k_named_damage_stack = () => K_NAMED_DAMAGE_STACK
export const k_stance = () => K_STANCE
export const k_reactive_punishment = () => K_REACTIVE_PUNISHMENT
export const k_erosion = () => K_EROSION
export const k_damage_redirect = () => K_DAMAGE_REDIRECT
export const stat_ap_dodge = () => STAT_AP_DODGE
export const stat_mp_dodge = () => STAT_MP_DODGE
export const stat_physical_damage = () => STAT_PHYSICAL_DAMAGE
export const phase_on_enter = () => PHASE_ON_ENTER
export const phase_start = () => PHASE_START
export const phase_end = () => PHASE_END

// ╔════════════════ [ Effect — the flat envelope record ] ══════════════════════════ ]
/**
 * One effect in a spell's effect list. Flat by design (the 1.29 effect record shape). `value`'s meaning is
 * per-`kind`; unused fields are 0. Mirrors spell_effect.move `Effect`.
 * @typedef {{ kind:number, element:number, value:number, area_shape:number, area_size:number,
 *   target_filter:number, chance:number, turns:number, stat:number, flags:number, phase:number }} Effect
 */

/** Full constructor — every field explicit. @returns {Effect} */
export const new_effect = (
  kind,
  element,
  value,
  area_shape,
  area_size,
  target_filter,
  chance,
  turns,
  stat,
  flags,
  phase,
) => ({
  kind,
  element,
  value,
  area_shape,
  area_size,
  target_filter,
  chance,
  turns,
  stat,
  flags,
  phase,
})

// ── Accessors (mirror the Move getter names so fixtures read 1:1) ──
export const kind = e => e.kind
export const element = e => e.element
export const value = e => e.value
export const area_shape = e => e.area_shape
export const area_size = e => e.area_size
export const target_filter = e => e.target_filter
export const chance = e => e.chance
export const turns = e => e.turns
export const stat = e => e.stat
export const flags = e => e.flags
export const phase = e => e.phase
export const has_flag = (e, flag) => (e.flags & flag) === flag

// ╔════════════════ [ Structural legality — mirrors spell_effect::is_legal ] ════════ ]
const TF_ALL_MASK = 39 // NOT_TEAM|NOT_SELF|NOT_ENEMY|ONLY_CASTER
const FLAG_ALL_MASK = 31 // all five FLAG_* bits; bit 32 is dead vocabulary, matching Move
const AIR_ELEMENT = 3
const NONE_ELEMENT = 255

export const is_legal = e =>
  e.kind <= K_DAMAGE_REDIRECT &&
  e.area_shape <= SHAPE_CONE &&
  (e.target_filter | TF_ALL_MASK) === TF_ALL_MASK &&
  e.chance <= 100 &&
  (e.flags | FLAG_ALL_MASK) === FLAG_ALL_MASK &&
  e.phase <= PHASE_END &&
  e.stat <= STAT_PHYSICAL_DAMAGE &&
  (e.element <= AIR_ELEMENT || e.element === NONE_ELEMENT)

// ╔════════════════ [ Convenience constructors (the common kinds) ] ════════════════ ]
export const damage = (el, base) =>
  new_effect(
    K_DAMAGE,
    el,
    base,
    SHAPE_POINT,
    0,
    TF_NOT_TEAM,
    100,
    0,
    0,
    0,
    PHASE_ON_ENTER,
  )

export const heal = base =>
  new_effect(
    K_HEAL,
    255,
    base,
    SHAPE_POINT,
    0,
    TF_NOT_ENEMY,
    100,
    0,
    0,
    0,
    PHASE_ON_ENTER,
  )

export const life_steal = (el, base) =>
  new_effect(
    K_LIFE_STEAL,
    el,
    base,
    SHAPE_POINT,
    0,
    TF_NOT_TEAM,
    100,
    0,
    0,
    0,
    PHASE_ON_ENTER,
  )

export const push = n =>
  new_effect(
    K_PUSH,
    255,
    n,
    SHAPE_POINT,
    0,
    TF_NOT_TEAM,
    100,
    0,
    0,
    0,
    PHASE_ON_ENTER,
  )

export const geometric_push = (zone_shape, zone_size) =>
  new_effect(
    K_GEOMETRIC_PUSH,
    255,
    0,
    zone_shape,
    zone_size,
    TF_NONE,
    100,
    0,
    0,
    0,
    PHASE_ON_ENTER,
  )

export const pull = n =>
  new_effect(
    K_PULL,
    255,
    n,
    SHAPE_POINT,
    0,
    TF_NOT_TEAM,
    100,
    0,
    0,
    0,
    PHASE_ON_ENTER,
  )

export const remove_points = (point_kind, n, dodge) =>
  new_effect(
    K_REMOVE_POINTS,
    255,
    n,
    SHAPE_POINT,
    0,
    TF_NOT_TEAM,
    100,
    0,
    point_kind,
    dodge ? FLAG_DODGE : 0,
    PHASE_ON_ENTER,
  )

export const give_points = (point_kind, n) =>
  new_effect(
    K_GIVE_POINTS,
    255,
    n,
    SHAPE_POINT,
    0,
    TF_NOT_ENEMY,
    100,
    1,
    point_kind,
    0,
    PHASE_ON_ENTER,
  )

/** A DRAIN DEBT ROW — the post-dodge `removed` count a point-removal records so the target's next begin_turn
 *  refills to base − removed. `turns` = duration (the resolver floors at 1). Mirrors spell_effect::drain_row. */
export const drain_row = (point_kind, removed, turns) =>
  new_effect(
    K_REMOVE_POINTS,
    255,
    removed,
    SHAPE_POINT,
    0,
    TF_NONE,
    100,
    turns,
    point_kind,
    0,
    PHASE_ON_ENTER,
  )

/** A GIVE CREDIT ROW — the drain row's opposite-sign twin (MOB_DEBUFF_HAT P1 #2): the given count ADDED at the
 *  recipient's next begin_turn refill (base − debt + credit), so an off-turn feed survives to the turn it was
 *  meant to boost. Mirrors spell_effect::credit_row. */
export const credit_row = (point_kind, given, turns) =>
  new_effect(
    K_GIVE_POINTS,
    255,
    given,
    SHAPE_POINT,
    0,
    TF_NONE,
    100,
    turns,
    point_kind,
    0,
    PHASE_ON_ENTER,
  )

/** Buff/debuff a stat — mirrors spell_effect::alter_stat (sign→FLAG_NEGATIVE, filter follows sign). */
export const alter_stat = (
  stat_id,
  amount,
  negative,
  dispellable,
  duration,
) => {
  let flag = 0
  if (negative) flag |= FLAG_NEGATIVE
  if (dispellable) flag |= FLAG_DISPELLABLE
  const filter = negative ? TF_NOT_TEAM : TF_NOT_ENEMY
  return new_effect(
    K_ALTER_STAT,
    255,
    amount,
    SHAPE_POINT,
    0,
    filter,
    100,
    duration,
    stat_id,
    flag,
    PHASE_ON_ENTER,
  )
}

export const place_trap = (zone_shape, zone_size) =>
  new_effect(
    K_PLACE_TRAP,
    255,
    0,
    zone_shape,
    zone_size,
    TF_NONE,
    100,
    0,
    0,
    0,
    PHASE_ON_ENTER,
  )

export const place_glyph = (zone_shape, zone_size, duration, end_of_turn) =>
  new_effect(
    K_PLACE_GLYPH,
    255,
    0,
    zone_shape,
    zone_size,
    TF_NONE,
    100,
    duration,
    0,
    0,
    end_of_turn ? PHASE_END : PHASE_START,
  )

export const apply_dot = (el, per_tick_base, duration) =>
  new_effect(
    K_APPLY_DOT,
    el,
    per_tick_base,
    SHAPE_POINT,
    0,
    TF_NOT_TEAM,
    100,
    duration,
    0,
    0,
    PHASE_START,
  )
