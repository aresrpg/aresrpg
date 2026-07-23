// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// AresRPG spell corpus -> sim SpellLevel/SpellEffect normalizer.
//
// The donor's spell logic is UPPERCASE-discriminant (DamageEffect.type === 'DAMAGE', area_type 'CIRCLE');
// AresRPG's @aresrpg/sdk `spells.json` is nested-by-class, LOWERCASE-discriminant ('damage', 'circle'), with
// a `target` field, a `statistic` field on steal, `critical_effects` (donor: `crit_effects`), and effect
// types the donor lacks ('stun', 'poison', 'taunt', 'invulnerable', 'trap_modifier'). This module is the
// single boundary that maps AresRPG JSON -> the sim's internal shape so every downstream algorithm stays on
// the donor's clean discriminated union.
//
// Plain data in, plain data out — no I/O. The current numeric effect envelope and the still-live SDK legacy
// ingress both converge here on one internal shape.

import {
  signed_delta,
  K_ALTER_RESIST,
  K_ALTER_STAT,
  K_APPLY_DOT,
  K_APPLY_STATE,
  K_CARRY,
  K_CASTER_DAMAGE,
  K_CRITICAL_FAILURE,
  K_DAMAGE,
  K_DAMAGE_REDIRECT,
  K_DAMAGE_TO_HEAL,
  K_DISPEL,
  K_EROSION,
  K_FORCED_DEATH,
  K_GIVE_POINTS,
  K_GEOMETRIC_PUSH,
  K_HEAL,
  K_INVISIBILITY,
  K_LIFE_STEAL,
  K_NAMED_DAMAGE_STACK,
  K_PERCENT_LIFE_DAMAGE,
  K_PLACE_GLYPH,
  K_PLACE_TRAP,
  K_PULL,
  K_PUNISHMENT_DAMAGE,
  K_PUSH,
  K_REACTIVE_PUNISHMENT,
  K_REDUCE_DAMAGE,
  K_REFLECT_DAMAGE,
  K_RETURN_SPELL,
  K_REVEAL,
  K_REMOVE_POINTS,
  K_STANCE,
  K_STEAL_POINTS,
  K_STEAL_STAT,
  K_SWAP_POSITIONS,
  K_TELEPORT,
  K_THROW,
  K_TIMED_PAYLOAD,
  SHAPE_CIRCLE,
  SHAPE_CROSS,
  SHAPE_LINE,
  SHAPE_POINT,
  TF_NONE,
  TF_NOT_ENEMY,
  TF_NOT_SELF,
  TF_NOT_TEAM,
  TF_ONLY_CASTER,
} from './spell_effect.js'

/**
 * One spell effect, sim-internal (UPPERCASE). A faithful subset of the donor union (spells/types.ts:162).
 * Only the MVP-supported effects carry handlers in fight_spells.js; the rest are inert (flagged TODO).
 * @typedef {object} SpellEffect
 * @property {'DAMAGE'|'PERCENT_LIFE_DAMAGE'|'HEAL'|'STEAL'|'SHIELD'|'STUN'|'POISON'|'TELEPORT'|'PUSH'|'PULL'|'GEOMETRIC_PUSH'|'SWAP_POSITIONS'|'CARRY'|'THROW'|'PLACE_TRAP'|'GLYPH'|'ADD'|'REMOVE'|'SUMMON'|'INVISIBILITY'|'REVEAL'|'APPLY_STATE'|'REFLECT_DAMAGE'|'DISPEL'|'RETURN_SPELL'|'CRITICAL_FAILURE'|'DAMAGE_TO_HEAL'|'FORCED_DEATH'|'TIMED_PAYLOAD'|'NAMED_DAMAGE_STACK'|'STANCE'|'REACTIVE_PUNISHMENT'|'EROSION'|'DAMAGE_REDIRECT'|'UNSUPPORTED'} type
 * @property {number} [kind]
 * @property {number} [value]
 * @property {number} [min]
 * @property {number} [max]
 * @property {import('./fight_state.js').Element} [element]
 * @property {number} [chance]
 * @property {number} [turns]
 * @property {number} [distance]
 * @property {number} [target_filter]
 * @property {number} [area_shape]
 * @property {number} [area_size]
 * @property {number} [area]
 * @property {number} [flags]
 * @property {number} [phase]
 * @property {number} [raw_stat]
 * @property {number} [delay]
 * @property {number} [trigger_turns]
 * @property {'CIRCLE'|'SQUARE'|'LINE'} [area_type]
 * @property {SpellEffect[]} [payload]
 * @property {keyof import('./fight_state.js').Stats | 'life'} [steal]
 * @property {keyof import('./fight_state.js').Stats | 'ap' | 'mp' | 'summons' | 'max_hp'} [stat]   ADD/REMOVE target stat (AresRPG `statistic`, mapped)
 * @property {string} [summon]   SUMMON minion id (AresRPG `summon`; '' = a generic summon)
 * @property {'enemy'|'ally'|'self'|'cell'|'any'|'trap'} [target]
 * @property {string} [raw_type]   the original lowercase AresRPG type (for UNSUPPORTED diagnostics)
 */

/**
 * A DAMAGE effect — the calculator's input shape (min/max/element guaranteed present). Donor DamageEffect.
 * @typedef {SpellEffect & { type: 'DAMAGE', min: number, max: number, element: import('./fight_state.js').Element }} DamageEffect
 */

/**
 * A HEAL effect — min/max guaranteed present. Donor HealEffect.
 * @typedef {SpellEffect & { type: 'HEAL', min: number, max: number }} HealEffect
 */

/**
 * One spell level (donor SpellLevel, spells/types.ts:186), area_type uppercased.
 * @typedef {object} SpellLevel
 * @property {number} cost
 * @property {[number, number]} range
 * @property {number} critical_chance
 * @property {number} area
 * @property {'CIRCLE'|'SQUARE'|'LINE'} area_type
 * @property {number} casts_per_turn    255 = unlimited (mirror of Move's CASTS_UNLIMITED sentinel, cast.move:43)
 * @property {number} casts_per_target  255 = unlimited
 * @property {number} cooldown_turns    turn-skip count; 0 = no cooldown (Move `sl_cooldown_turns`, cast.move:100/170)
 * @property {boolean} modifiable_range
 * @property {boolean} line_of_sight
 * @property {boolean} linear
 * @property {boolean} free_cell
 * @property {SpellEffect[]} base_effects
 * @property {SpellEffect[]} [crit_effects]
 */

/**
 * A castable spell (donor SpellTemplate, spells/types.ts:234).
 * @typedef {object} SpellTemplate
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {SpellLevel[]} levels
 */

// The generic mob basic melee attack (the SEAM that gives every mob a real damaging turn). Mobs ship with
// an empty deck/hand (the player card system is theirs alone), so the AI could previously only MOVE — never
// damage. This single-target (area 0), range-1, low-cost EARTH strike is dealt to every mob via
// `mob_to_fight_entity`, and registered into the fight `ctx.spell_templates` so the existing handle_cast path
// drives it with NO new reducer code. Damage stays low + integer and mobs carry 0 offensive stats, so the hit
// is small and deterministic. FLAGGED placeholder: the content
// teammate keys per-mob attacks by `template_id` later — this generic default is the single home until then.
export const MOB_ATTACK_ID = 'mob_attack'

// The "no cap" sentinel for casts_per_turn / casts_per_target — mirrors Move's `CASTS_UNLIMITED` (cast.move:43)
// EXACTLY so client prediction and on-chain resolution agree bit-for-bit. A missing count normalizes to this
// (unlimited), NOT 0 (which Move reads as a real "castable once ever" cap). cooldown defaults to 0 (no cooldown).
export const CASTS_UNLIMITED = 255

/** @type {SpellTemplate} */
export const MOB_ATTACK_TEMPLATE = {
  id: MOB_ATTACK_ID,
  name: 'Strike',
  description: 'A basic melee strike.',
  levels: [
    {
      cost: 3,
      range: [1, 1],
      critical_chance: 0,
      area: 0,
      area_type: 'CIRCLE',
      casts_per_turn: CASTS_UNLIMITED, // AP economy is the only limit on the basic mob strike (Move mobs uncapped)
      casts_per_target: CASTS_UNLIMITED,
      cooldown_turns: 0,
      modifiable_range: false,
      line_of_sight: true,
      linear: false,
      free_cell: false,
      base_effects: [
        {
          type: 'DAMAGE',
          min: 3,
          max: 5,
          element: 'EARTH',
          target: 'enemy',
          target_filter: TF_NOT_TEAM,
          chance: 100,
        },
      ],
      crit_effects: [],
    },
  ],
}

/** lowercase element -> sim Element. @type {Record<string, import('./fight_state.js').Element>} */
const ELEMENT_MAP = {
  0: 'FIRE',
  1: 'WATER',
  2: 'EARTH',
  3: 'AIR',
  255: 'NONE',
  fire: 'FIRE',
  water: 'WATER',
  earth: 'EARTH',
  air: 'AIR',
  neutral: 'NONE',
  none: 'NONE',
}

/** lowercase area_type -> sim area_type. @type {Record<string, 'CIRCLE'|'SQUARE'|'LINE'>} */
const AREA_MAP = {
  circle: 'CIRCLE',
  square: 'SQUARE',
  line: 'LINE',
}

const AREA_SHAPE_MAP = {
  circle: SHAPE_CIRCLE,
  square: SHAPE_CROSS,
  line: SHAPE_LINE,
}

const AREA_TYPE_MAP = {
  [SHAPE_POINT]: 'CIRCLE',
  [SHAPE_CIRCLE]: 'CIRCLE',
  [SHAPE_CROSS]: 'SQUARE',
  [SHAPE_LINE]: 'LINE',
}

/**
 * AresRPG `statistic` (ADD/REMOVE) -> the sim stat/pool key the modifier targets. `damage` maps to
 * `raw_damage` (a flat damage bonus). `ap`/`mp` are the resource pools (effective_ap_max / effective_mp_max);
 * a `summons` modifier raises/lowers the per-caster summon cap (consumed by fight_summon.js `summon_cap`).
 * @type {Record<string, keyof import('./fight_state.js').Stats | 'ap' | 'mp' | 'summons' | 'max_hp'>}
 */
const STATISTIC_MAP = {
  raw_damage: 'raw_damage',
  damage: 'raw_damage',
  physical_damage: 'physical_damage',
  ap_dodge: 'ap_dodge',
  mp_dodge: 'mp_dodge',
  max_hp: 'max_hp',
  agility: 'agility',
  strength: 'strength',
  intelligence: 'intelligence',
  chance: 'chance',
  vitality: 'vitality',
  wisdom: 'wisdom',
  range: 'range',
  critical_hit: 'critical_hit',
  ap: 'ap',
  mp: 'mp',
  summons: 'summons',
}

const STAT_ID_MAP = {
  0: 'strength',
  1: 'intelligence',
  2: 'chance',
  3: 'agility',
  4: 'wisdom',
  5: 'vitality',
  6: 'range',
  7: 'critical_hit',
  8: 'percent_damage',
  9: 'raw_damage',
  10: 'max_hp',
  11: 'heal',
  12: 'ap_dodge',
  13: 'mp_dodge',
  14: 'physical_damage',
}

const POINT_ID_MAP = { 0: 'ap', 1: 'mp' }

/**
 * K_ALTER_RESIST element -> the sim resist stat key it modifies. Mirrors the chain: `apply_alter` /
 * `refresh_stats` alter the resist for `effect.element()` (cast.move:984, participant.move:294/327), and the
 * seed mint defaults a missing element to 255=NONE (reseed_plan.mjs:67) -> NEUTRAL resist. A resist row folds
 * into effective_stats exactly like an alter_stat row (fight_state.js effective_stats), so predicted damage
 * matches chain. @type {Record<string, keyof import('./fight_state.js').Stats>}
 */
const RESIST_STAT_MAP = {
  FIRE: 'fire_resistance',
  WATER: 'water_resistance',
  EARTH: 'earth_resistance',
  AIR: 'air_resistance',
  NONE: 'neutral_resistance',
}

/** AresRPG `target` -> sim target category. @type {Record<string, 'enemy'|'ally'|'self'|'cell'|'any'|'trap'>} */
const TARGET_MAP = {
  cell: 'cell',
  enemies: 'enemy',
  self: 'self',
  // 'trap' is preserved (NOT folded to 'cell'): an effect targeting 'trap' is PLACED as a trap hazard at
  // the cast cell rather than applied immediately (the yajin trap mechanic). The cast pipeline branches on it.
  trap: 'trap',
}

const TARGET_FILTER_MAP = {
  enemies: TF_NOT_TEAM,
  enemy: TF_NOT_TEAM,
  allies: TF_NOT_ENEMY | TF_NOT_SELF,
  ally: TF_NOT_ENEMY | TF_NOT_SELF,
  self: TF_ONLY_CASTER,
  cell: TF_NONE,
  any: TF_NONE,
  trap: TF_NONE,
}

/**
 * R3: decode a CENTERED alter (kind 9/11) `value`/`value_max` → the sim's [type, min_magnitude, max_magnitude].
 * Both endpoints of a valid same-sign range decode to the same sign (a debuff's more-negative centered endpoint
 * is the larger magnitude, so magnitudes sort ascending). This is the sim's fight decode boundary — downstream
 * `apply_stat_effect` rolls in [min,max] and applies the sign via `type`. Mirrors chain `signed_delta`.
 * @returns {['ADD'|'REMOVE', number, number]}
 */
const signed_alter = (kind, value, value_max) => {
  const [neg, mag_a] = signed_delta(kind, value)
  const [, mag_b] = signed_delta(kind, value_max)
  return [
    neg ? 'REMOVE' : 'ADD',
    Math.min(mag_a, mag_b),
    Math.max(mag_a, mag_b),
  ]
}

/**
 * Normalize one AresRPG effect into the sim's UPPERCASE SpellEffect.
 * Handlers exist for: damage, heal, steal, stun, poison, teleport, push, pull, glyph, trap (placement),
 * add/remove (stat + ap/mp buff/debuff), summon, invisibility, and reveal. Still inert (flagged TODO):
 * invulnerable, taunt, trap_modifier, and unsupported.
 * @param {Record<string, unknown>} e  raw AresRPG effect
 * @returns {SpellEffect}
 */
const normalize_effect = (e, fallback_area) => {
  const numeric_kind = typeof e['kind'] === 'number' ? e['kind'] : undefined
  const raw_type = String(e['type'] ?? numeric_kind)
  const value = Number(e['value'] ?? 0)
  // #577 — the chain now carries a damage/heal RANGE: `value` = MIN, `value_max` = MAX (== value ⇒ fixed). No
  // longer collapsed to a single number — the sim rolls in [min, max] off the turn seed, exactly like the chain.
  const value_max =
    typeof e['value_max'] === 'number' ? Number(e['value_max']) : value
  const raw_stat = Number(e['stat'] ?? 0)
  const element = ELEMENT_MAP[String(e['element'])]
  const target = TARGET_MAP[String(e['target'])] ?? 'cell'
  const area_shape = Number(
    e['area_shape'] ?? fallback_area?.area_shape ?? SHAPE_POINT,
  )
  const area_size = Number(e['area_size'] ?? fallback_area?.area_size ?? 0)
  const base = {
    kind: numeric_kind,
    value: numeric_kind === undefined ? undefined : value,
    // #577 — the authored damage/heal range for KNOWN chain kinds: min = value, max = value_max. UNKNOWN-kind
    // (donor / `statistic`-shaped stat buffs) keep their explicit min/max — their magnitude draws from that range
    // (fight_stat_effects.js), so forcing it undefined silently dropped every stat buff.
    min:
      numeric_kind === undefined
        ? typeof e['min'] === 'number'
          ? Number(e['min'])
          : undefined
        : value,
    max:
      numeric_kind === undefined
        ? typeof e['max'] === 'number'
          ? Number(e['max'])
          : undefined
        : value_max,
    element,
    chance: typeof e['chance'] === 'number' ? e['chance'] : undefined,
    turns: typeof e['turns'] === 'number' ? e['turns'] : undefined,
    flags: typeof e['flags'] === 'number' ? e['flags'] : 0,
    phase: typeof e['phase'] === 'number' ? e['phase'] : 0,
    raw_stat,
    distance:
      numeric_kind === K_PUSH || numeric_kind === K_PULL
        ? value
        : typeof e['distance'] === 'number'
          ? e['distance']
          : undefined,
    stat: STATISTIC_MAP[String(e['statistic'])],
    target,
    target_filter:
      typeof e['target_filter'] === 'number'
        ? e['target_filter']
        : (TARGET_FILTER_MAP[String(e['target'])] ?? TF_NONE),
    area_shape,
    area_size,
    area: area_size,
    area_type: AREA_TYPE_MAP[area_shape] ?? 'CIRCLE',
    raw_type,
  }
  if (numeric_kind !== undefined) {
    if (numeric_kind === K_DAMAGE) return { ...base, type: 'DAMAGE' }
    if (numeric_kind === K_LIFE_STEAL)
      return { ...base, type: 'STEAL', steal: 'life' }
    if (
      numeric_kind === K_CASTER_DAMAGE ||
      numeric_kind === K_PUNISHMENT_DAMAGE
    )
      return { ...base, type: 'DAMAGE' }
    if (numeric_kind === K_HEAL) return { ...base, type: 'HEAL' }
    if (numeric_kind === K_REDUCE_DAMAGE)
      return { ...base, type: 'SHIELD', element: 'NONE' }
    if (numeric_kind === K_GIVE_POINTS)
      return { ...base, type: 'ADD', stat: POINT_ID_MAP[Number(e['stat'])] }
    if (numeric_kind === K_REMOVE_POINTS)
      return { ...base, type: 'REMOVE', stat: POINT_ID_MAP[Number(e['stat'])] }
    if (numeric_kind === K_ALTER_STAT) {
      // R3: value/value_max are CENTERED — decode sign + magnitude range through the one home.
      const [type, min, max] = signed_alter(numeric_kind, value, value_max)
      return {
        ...base,
        type,
        value: min,
        min,
        max,
        stat: STAT_ID_MAP[Number(e['stat'])],
      }
    }
    if (numeric_kind === K_STEAL_STAT)
      // STEAL a stat = alter_stat's twin (spell_effect.move:33 "debuff target + buff caster same stat; value =
      // amount"): unconditionally the target LOSES `value` and the caster GAINS it — both timed rows reverting on
      // expiry. Normalizes to the debuff (REMOVE) leg; fight_stat_effects.js reads `kind === K_STEAL_STAT` to ALSO
      // mint the caster's mirror STAT_BUFF (the K_STEAL_POINTS twin feeds the caster the same way). Chain arm: next train.
      return { ...base, type: 'REMOVE', stat: STAT_ID_MAP[Number(e['stat'])] }
    if (numeric_kind === K_ALTER_RESIST) {
      // AlterResist is an alter row on an element's resist (chain: alter_base_resist(effect.element())).
      // A missing element mints to 255=NONE -> neutral resist; the `stat` field is vestigial for this kind.
      // R3: value/value_max are CENTERED — decode sign + magnitude range through the one home.
      const [type, min, max] = signed_alter(numeric_kind, value, value_max)
      return {
        ...base,
        type,
        value: min,
        min,
        max,
        stat: RESIST_STAT_MAP[element ?? 'NONE'] ?? 'neutral_resistance',
      }
    }
    if (numeric_kind === K_STEAL_POINTS)
      // Steal = the dodge-contested AP/MP drain (REMOVE path) whose removed count also feeds the caster
      // (fight_stat_effects.js reads the K_STEAL_POINTS kind to add the caster-feed). Mirrors cast.move:583-586.
      return { ...base, type: 'REMOVE', stat: POINT_ID_MAP[Number(e['stat'])] }
    if (numeric_kind === K_PERCENT_LIFE_DAMAGE)
      // %-of-life: a fraction of the HP pool, resolved at runtime against the target's live HP (no element
      // amplification / no variance / no resist) — mirrors cast.move:564-570.
      return { ...base, type: 'PERCENT_LIFE_DAMAGE' }
    if (numeric_kind === K_PUSH) return { ...base, type: 'PUSH' }
    if (numeric_kind === K_PULL) return { ...base, type: 'PULL' }
    if (numeric_kind === K_GEOMETRIC_PUSH)
      return { ...base, type: 'GEOMETRIC_PUSH', target_filter: TF_NONE }
    if (numeric_kind === K_TELEPORT) return { ...base, type: 'TELEPORT' }
    // Pandawa-class displacements (spell_effect.move:39-41); Move arms unwired — semantics in fight_spells.js.
    if (numeric_kind === K_SWAP_POSITIONS)
      return { ...base, type: 'SWAP_POSITIONS' }
    if (numeric_kind === K_CARRY) return { ...base, type: 'CARRY' }
    if (numeric_kind === K_THROW) return { ...base, type: 'THROW' }
    if (numeric_kind === K_PLACE_TRAP) return { ...base, type: 'PLACE_TRAP' }
    if (numeric_kind === K_PLACE_GLYPH) return { ...base, type: 'GLYPH' }
    if (numeric_kind === K_APPLY_DOT) return { ...base, type: 'POISON' }
    if (numeric_kind === K_APPLY_STATE)
      // A NAMED STATE (value = state id) recorded for `turns` — a pure flag row, no delta. Mirrors the chain:
      // cast.move records it via record_timed and spell_board::fighter_has_state reads it back
      // (kind == k_apply_state && value == state_id) to back the required/forbidden-states cast gate.
      return { ...base, type: 'APPLY_STATE' }
    if (numeric_kind === K_REFLECT_DAMAGE)
      // A FLAT damage-reflect (spell_effect.move:57 "reflect a flat amount of received damage; value = flat"):
      // a TIMED defensive row on the protected fighter (target_filter 4 = NOT_ENEMY → self/ally). Mirrors the
      // DAMAGE_REDIRECT idiom — a timed status row the damage path consults — recorded via record_timed
      // (cast.move:681) and reverted on dispel (spell_board.move:277). Distinct from DAMAGE_REDIRECT's PERCENT
      // reflect (spell_effect.move:82); the FLAT-reflect CONSUMPTION rides the next train.
      return { ...base, type: 'REFLECT_DAMAGE' }
    if (numeric_kind === K_DISPEL)
      // STRIP the target's dispellable rows (spell_effect.move:58): fight_spells.js removes exactly the
      // FLAG_DISPELLABLE rows (spell_effect.move:200 "else survives Dispel"; the F5 band forces negative alter
      // rows dispellable). Move's `dispel_fighter` (spell_board.move:257, 0 callers) is the coarse "strip all";
      // the flag-filtering cast-resolver arm rides the next train.
      return { ...base, type: 'DISPEL' }
    if (numeric_kind === K_RETURN_SPELL)
      // SPELL-RETURN (spell_effect.move:61-64 "#55-E2: RETURN the incoming cast to its caster; ≠ REFLECT's flat
      // dmg reflect; turns"): a TIMED status row on the shielded fighter, recorded via record_timed
      // (cast.move:682). The DEPTH-1 return-redirect RESOLUTION is enforced at the dungeon resolver, never in
      // this pure-data layer (spell_effect.move:62-63) — the sim lands the ROW; the redirect arm rides the next train.
      return { ...base, type: 'RETURN_SPELL' }
    if (numeric_kind === K_INVISIBILITY)
      return { ...base, type: 'INVISIBILITY' }
    if (numeric_kind === K_REVEAL) return { ...base, type: 'REVEAL' }
    if (numeric_kind === K_CRITICAL_FAILURE)
      return { ...base, type: 'CRITICAL_FAILURE' }
    if (numeric_kind === K_DAMAGE_TO_HEAL)
      return { ...base, type: 'DAMAGE_TO_HEAL' }
    if (numeric_kind === K_FORCED_DEATH)
      return { ...base, type: 'FORCED_DEATH' }
    if (numeric_kind === K_TIMED_PAYLOAD)
      return {
        ...base,
        type: 'TIMED_PAYLOAD',
        delay: Math.max(1, Number(e['turns'] || e['value'] || 1)),
      }
    if (numeric_kind === K_NAMED_DAMAGE_STACK)
      return { ...base, type: 'NAMED_DAMAGE_STACK' }
    if (numeric_kind === K_STANCE) return { ...base, type: 'STANCE' }
    if (numeric_kind === K_REACTIVE_PUNISHMENT)
      return {
        ...base,
        type: 'REACTIVE_PUNISHMENT',
        stat: STAT_ID_MAP[raw_stat],
        trigger_turns: Math.max(1, area_size),
      }
    if (numeric_kind === K_EROSION) return { ...base, type: 'EROSION' }
    if (numeric_kind === K_DAMAGE_REDIRECT)
      return { ...base, type: 'DAMAGE_REDIRECT' }
    return { ...base, type: 'UNSUPPORTED' }
  }
  switch (raw_type) {
    case 'damage':
      return { ...base, type: 'DAMAGE' }
    case 'heal':
      return { ...base, type: 'HEAL' }
    case 'steal':
      // MVP supports life-steal only (AresRPG `statistic: 'health'`); stat-steal is a flagged TODO.
      return { ...base, type: 'STEAL', steal: 'life' }
    case 'stun':
      return { ...base, type: 'STUN' }
    case 'poison':
      // Damage-over-time: a TURN_START DAMAGE effect carrying min/max/element/turns (retro DoT).
      return { ...base, type: 'POISON' }
    case 'teleport':
      return { ...base, type: 'TELEPORT' }
    case 'push':
      return { ...base, type: 'PUSH' }
    case 'pull':
      return { ...base, type: 'PULL' }
    case 'glyph':
      return { ...base, type: 'GLYPH' }
    case 'summon':
      // Spawn an AI minion onto the caster's team (fight_summon.js); `summon` is the art/variant id.
      return { ...base, type: 'SUMMON', summon: String(e['summon'] ?? '') }
    case 'add':
      // Stat / ap / mp BUFF for `turns` (rolled [min,max] on `stat`); ticked + expired by process_turn_effects.
      return { ...base, type: 'ADD' }
    case 'remove':
      // Stat / ap / mp DEBUFF for `turns` (AresRPG `remove` = subtract points of `statistic`, NOT a cleanse).
      return { ...base, type: 'REMOVE' }
    case 'invisibility':
      return { ...base, type: 'INVISIBILITY' }
    case 'reveal':
      return { ...base, type: 'REVEAL' }
    // ── flagged TODO: typed but inert in the MVP core loop ──
    case 'invulnerable':
      return { ...base, type: 'SHIELD' } // closest supported analog, but min/max often absent -> inert
    default:
      return { ...base, type: 'UNSUPPORTED' }
  }
}

/** A placement marker owns every non-placement sibling as its deferred board payload. */
const normalize_effect_list = (effects, fallback_area) => {
  const normalized = effects.map(e => normalize_effect(e, fallback_area))
  const linked = []
  for (let i = 0; i < normalized.length; i += 1) {
    const effect = normalized[i]
    if (effect?.type !== 'TIMED_PAYLOAD') {
      linked.push(effect)
      continue
    }
    const count = Math.max(0, Math.floor(effect.raw_stat ?? 0))
    linked.push({ ...effect, payload: normalized.slice(i + 1, i + 1 + count) })
    i += count
  }
  const markers = linked.filter(
    e =>
      e.type === 'PLACE_TRAP' ||
      (e.type === 'GLYPH' && e.kind === K_PLACE_GLYPH),
  )
  if (markers.length > 0) {
    const payload = linked.filter(e => !markers.includes(e))
    return markers.map(marker => ({ ...marker, payload }))
  }
  const legacy_traps = linked.filter(e => e.target === 'trap')
  if (legacy_traps.length === 0) return linked
  return legacy_traps.map(effect => ({
    ...effect,
    type: 'PLACE_TRAP',
    payload: [{ ...effect, target: 'cell' }],
  }))
}

/**
 * Normalize one AresRPG spell level.
 * @param {Record<string, unknown>} lvl
 * @returns {SpellLevel}
 */
const normalize_level = lvl => {
  const legacy_area = {
    area_shape: AREA_SHAPE_MAP[String(lvl['area_type'])] ?? SHAPE_POINT,
    area_size: Number(lvl['area'] ?? 0),
  }
  const current_effects = Array.isArray(lvl['effects'])
  const effects = /** @type {Record<string, unknown>[]} */ (
    current_effects ? lvl['effects'] : (lvl['base_effects'] ?? [])
  )
  const crit_effects = /** @type {Record<string, unknown>[]} */ (
    current_effects
      ? (lvl['crit_effects'] ?? [])
      : (lvl['critical_effects'] ?? [])
  )
  return {
    cost: Number(lvl['ap_cost'] ?? lvl['ap'] ?? lvl['cost'] ?? 0),
    range: /** @type {[number, number]} */ (
      lvl['range'] ?? [
        Number(lvl['range_min'] ?? 0),
        Number(lvl['range_max'] ?? 0),
      ]
    ),
    critical_chance: Number(lvl['crit_rate'] ?? lvl['critical_chance'] ?? 0),
    area: legacy_area.area_size,
    area_type: AREA_MAP[String(lvl['area_type'])] ?? 'CIRCLE',
    casts_per_turn: Number(lvl['casts_per_turn'] ?? CASTS_UNLIMITED),
    casts_per_target: Number(lvl['casts_per_target'] ?? CASTS_UNLIMITED),
    cooldown_turns: Number(
      lvl['cooldown_turns'] ?? lvl['cooldown'] ?? lvl['turns_to_recast'] ?? 0,
    ),
    modifiable_range: Boolean(lvl['modifiable_range']),
    line_of_sight: Boolean(lvl['line_of_sight']),
    linear: Boolean(lvl['line_launch'] ?? lvl['linear']),
    free_cell: Boolean(lvl['free_cell']),
    base_effects: normalize_effect_list(
      effects,
      current_effects ? undefined : legacy_area,
    ),
    crit_effects: normalize_effect_list(
      crit_effects,
      current_effects ? undefined : legacy_area,
    ),
  }
}

const authored_spells = spells_json => {
  if (Array.isArray(spells_json)) return spells_json
  if (Array.isArray(spells_json?.['spells'])) return spells_json['spells']
  const rows = []
  for (const spell_class of Object.values(spells_json ?? {})) {
    if (Array.isArray(spell_class)) {
      rows.push(...spell_class)
      continue
    }
    for (const [id, spell] of Object.entries(spell_class ?? {}))
      rows.push({ ...spell, id: spell['id'] ?? id })
  }
  return rows
}

/**
 * Normalize current spell arrays (or the legacy nested SDK object) into the reducer's flat template map.
 * @param {unknown} spells_json
 * @returns {Map<string, SpellTemplate>}
 */
export const normalize_spell_templates = spells_json => {
  /** @type {Map<string, SpellTemplate>} */
  const templates = new Map()
  // Seed the generic mob basic attack so every consumer (server authority, client prediction, agent) resolves
  // a mob's cast from ONE source — no per-call registration, no drift. Player spells overlay it from the JSON.
  templates.set(MOB_ATTACK_ID, MOB_ATTACK_TEMPLATE)
  for (const raw_spell of authored_spells(spells_json)) {
    const spell = /** @type {Record<string, unknown>} */ (raw_spell)
    const spell_id = String(spell['id'] ?? '')
    if (!spell_id) continue
    templates.set(spell_id, {
      id: spell_id,
      name: String(spell['name'] ?? spell_id),
      description: String(
        spell['description'] ?? spell['description_key'] ?? '',
      ),
      levels: /** @type {Record<string, unknown>[]} */ (
        spell['levels'] ?? []
      ).map(normalize_level),
    })
  }
  return templates
}
