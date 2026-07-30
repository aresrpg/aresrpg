// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE STATUS VOCABULARY — the ONE home translating between a live `@aresrpg/sim` effect row and the chain's
// per-fighter status row, plus the pure adapters over the fold's status home. The HUD keeps the raw chain ints;
// mechanics consumers normalize only the rows they understand into the deterministic sim vocabulary.
//
// #1049. Three modules used to hand-roll this translation, each with its OWN partial table, and a kind missing
// from any one of them vanished from that door: `predict_cast` knew three rows (range · ap/mp GRANT ·
// invisibility), so a +20 Strength buff, a +110% damage buff, a reflect and every point DEBUFF painted nothing at
// cast time; `sim_chain_events` knew the full set; the receipt door in `inputs.js` knew three kinds. One home per
// fact: `status_row_of` is the single sim→chain projection, `STATUS_KINDS` the single "does this kind live in the
// status home" membership test, and every door — prediction, the simulator's snapshot, the receipt envelope, the
// render exhaustiveness gate — reads them instead of a local list.

import { effective_stats } from '@aresrpg/sim/fight_state'
import * as fx from '@aresrpg/sim/spell_effect'

import { is_signed_status_kind } from './fight_status_snapshot.js'

const ELEMENT_NEUTRAL = 255

/** `Drain`/`Granted` point discriminant (`spell_effect::point_ap()` = 0, `point_mp()` = 1). Only these two sim
 *  stat keys are POOLS; every other stat is a timed block row. */
const POOL_POINT_KIND = { ap: fx.POINT_AP, mp: fx.POINT_MP }

/** The sim's stat keys → the chain's numeric stat id (`spell_effect.move` STAT_*; the inverse of the spell
 *  normalizer's STAT_ID_MAP). A key absent here carries no numeric id and rides as null. */
const STAT_CHAIN_ID = {
  strength: fx.STAT_STRENGTH,
  intelligence: fx.STAT_INTELLIGENCE,
  chance: fx.STAT_CHANCE,
  agility: fx.STAT_AGILITY,
  wisdom: fx.STAT_WISDOM,
  vitality: fx.STAT_VITALITY,
  range: fx.STAT_RANGE,
  critical_hit: fx.STAT_CRIT,
  percent_damage: fx.STAT_PERCENT_DAMAGE,
  raw_damage: fx.STAT_RAW_DAMAGE,
  max_hp: fx.STAT_MAX_HP,
  heal: fx.STAT_HEAL,
  ap_dodge: fx.STAT_AP_DODGE,
  mp_dodge: fx.STAT_MP_DODGE,
  physical_damage: fx.STAT_PHYSICAL_DAMAGE,
}

/** Resist stat key → the chain element ordinal a K_ALTER_RESIST row carries (255 = NONE/neutral). */
const RESIST_ELEMENT = {
  fire_resistance: 0,
  water_resistance: 1,
  earth_resistance: 2,
  air_resistance: 3,
  neutral_resistance: 255,
}

/** A sim `ActiveEffect.type` → the chain status kind it is recorded as. The pool/resist variants of the two stat
 *  rows are disambiguated by the row's own `stat` in `status_kind_of`, so this table holds the rest. */
const STATUS_KIND = {
  GIVE_POINTS: fx.K_GIVE_POINTS,
  REMOVE_POINTS: fx.K_REMOVE_POINTS,
  ALTER_STAT: fx.K_ALTER_STAT,
  ALTER_RESIST: fx.K_ALTER_RESIST,
  INVISIBILITY: fx.K_INVISIBILITY,
  POISON: fx.K_APPLY_DOT,
  SHIELD: fx.K_REDUCE_DAMAGE,
  POOL_SHIELD: fx.K_POOL_SHIELD,
  REFLECT_DAMAGE: fx.K_REFLECT_DAMAGE,
  RETURN_SPELL: fx.K_RETURN_SPELL,
  APPLY_STATE: fx.K_APPLY_STATE,
  STUN: fx.K_APPLY_STATE, // a stun is a named state on chain (no dedicated kind)
  DAMAGE_TO_HEAL: fx.K_DAMAGE_TO_HEAL,
  TIMED_PAYLOAD: fx.K_TIMED_PAYLOAD,
  NAMED_DAMAGE_STACK: fx.K_NAMED_DAMAGE_STACK,
  STANCE: fx.K_STANCE,
  REACTIVE_PUNISHMENT: fx.K_REACTIVE_PUNISHMENT,
  EROSION: fx.K_EROSION,
  DAMAGE_REDIRECT: fx.K_DAMAGE_REDIRECT,
}

/** EVERY chain kind that can appear in the per-fighter status home — the stat/point/resist alter rows plus the
 *  table above. The ONE universe: the receipt door asks it whether an envelope row is a status, and the render
 *  exhaustiveness gate asks it which kinds must own a badge arm (a kind added here with no arm goes red). */
export const STATUS_KINDS = Object.freeze([...new Set(Object.values(STATUS_KIND))].sort((a, b) => a - b))

const STATUS_KIND_SET = new Set(STATUS_KINDS)

const CHAIN_ELEMENT_OF = {
  FIRE: 0,
  WATER: 1,
  EARTH: 2,
  AIR: 3,
  NONE: ELEMENT_NEUTRAL,
}

/** Does this chain kind live in the per-fighter status home? */
export const is_status_kind = (kind) => STATUS_KIND_SET.has(Number(kind))

/** The chain kind for one live sim effect row, or null when the row is not a status the chain records
 *  (a plain DAMAGE/HEAL tick row is bookkeeping, never a badge). Poison is the one exception: fight_spells.js
 *  rides its tick on a `type: 'DAMAGE'` row (reusing the generic damage-tick machinery, #1211) and marks it
 *  `dot: true` so it still reports as K_APPLY_DOT here — a badge for its target, mob or player alike. */
const status_kind_of = (effect) => {
  if (effect.dot) return STATUS_KIND.POISON
  if (effect.type === 'STAT_BUFF' || effect.type === 'STAT_DEBUFF') {
    if (POOL_POINT_KIND[effect.stat] !== undefined)
      return effect.type === 'STAT_BUFF' ? STATUS_KIND.GIVE_POINTS : STATUS_KIND.REMOVE_POINTS
    return RESIST_ELEMENT[effect.stat] !== undefined ? STATUS_KIND.ALTER_RESIST : STATUS_KIND.ALTER_STAT
  }
  return STATUS_KIND[effect.type] ?? null
}

/**
 * ONE live sim effect row → the status row the fold's per-fighter home speaks, or null when the row is not a
 * status. The home speaks DECODED SIGNED deltas (`fight_status_snapshot.decode_status_value` strips the chain's
 * 32768 centering at every wire door, #886/#983), so a signed-kind DEBUFF carries a NEGATIVE value here and the
 * sign lives exactly once. `flags` rides only when set — a derived mirror of the minted row, never a sign source
 * (#904): reading it as the sign is what folded an unflagged centered debuff as a buff.
 * @param {{ type: string, stat?: string, value?: number, turns_remaining?: number, chance?: number }} effect
 * @returns {{ kind:number, remaining_turns:number, element:number|null, value:number, stat:number|null,
 *   chance:number|null, flags?:number } | null}
 */
export const status_row_of = (effect) => {
  const kind = effect == null ? null : status_kind_of(effect)
  if (kind == null) return null
  const remaining_turns = Math.max(0, Math.trunc(Number(effect.turns_remaining) || 0))
  if (remaining_turns <= 0) return null
  const magnitude = Number(effect.value) || 0
  const negative = is_signed_status_kind(kind) && effect.type === 'STAT_DEBUFF'
  const shield_element =
    effect.type === 'SHIELD' || effect.type === 'POOL_SHIELD' ? CHAIN_ELEMENT_OF[effect.element] : undefined
  return {
    kind,
    remaining_turns,
    element: shield_element ?? RESIST_ELEMENT[effect.stat] ?? null,
    value: negative ? -magnitude : magnitude,
    stat: POOL_POINT_KIND[effect.stat] ?? STAT_CHAIN_ID[effect.stat] ?? null,
    chance: effect.chance ?? null,
    ...(negative ? { flags: fx.FLAG_NEGATIVE } : {}),
  }
}

const active = (row) => row?.remaining_turns == null || Number(row.remaining_turns) > 0

/** Chain stat id → the sim stat key it moves. DERIVED from `STAT_CHAIN_ID` above, never a second table: the two
 *  directions of one fact drift the moment they are written twice. */
const SIM_STAT_OF_CHAIN_ID = Object.freeze(
  Object.fromEntries(Object.entries(STAT_CHAIN_ID).map(([key, id]) => [id, key]))
)

/** Chain element ordinal → the sim resist stat key a K_ALTER_RESIST row moves — the inverse of RESIST_ELEMENT. */
const SIM_RESIST_OF_ELEMENT = Object.freeze(
  Object.fromEntries(Object.entries(RESIST_ELEMENT).map(([key, ordinal]) => [ordinal, key]))
)

const SIM_ELEMENT_OF_CHAIN_ID = Object.freeze(
  Object.fromEntries(Object.entries(CHAIN_ELEMENT_OF).map(([key, ordinal]) => [ordinal, key]))
)

/** The sim stat key ONE raw status row moves, or null when the row is not a timed stat row. A resist row with no
 *  element is NEUTRAL — the same default the seed mint writes (255 = NONE) and the sim's own RESIST_STAT_MAP takes. */
const sim_stat_of = (row) => {
  const kind = Number(row?.kind)
  if (kind === STATUS_KIND.ALTER_STAT) return SIM_STAT_OF_CHAIN_ID[Number(row.stat)] ?? null
  if (kind === STATUS_KIND.ALTER_RESIST)
    return SIM_RESIST_OF_ELEMENT[row.element == null ? ELEMENT_NEUTRAL : Number(row.element)] ?? null
  return null
}

/** Convert the active raw status rows exposed by engine_view into the sim effects prediction consumes — the
 * REVERSE of `status_row_of`, and total over the same stat vocabulary (#1083). It used to promote a RANGE alter
 * row and invisibility ONLY, so an active `+20 Strength` or `+110% Damage` was presentation-only: the damage
 * floater priced the unbuffed number while the chain resolved the buffed one. Range was never special — it was
 * the one stat someone had needed so far — so the special case now falls out of the general one.
 *
 * The ap/mp point-pool rows (GIVE/REMOVE_POINTS) stay out on purpose: `inputs.pool_grant` already folds them into the
 * fighter's turn-start budget and `project.js` hands that RESULT to the sim entity, so promoting them here would
 * count the same grant twice. One home per fact. Damage shields ARE promoted because the prediction damage fold
 * consumes kind 40 and reads kind 24 on every hit; reflects/DoTs stay presentation-only until their consumer does.
 *
 * Already-normalized effects pass through for the legacy world-fight view. */
export const sim_effects_of = (fighter) => {
  const effects = []
  for (const [index, row] of (fighter?.effects ?? []).entries()) {
    if (!active(row)) continue
    if (row?.type) {
      effects.push(row)
      continue
    }
    const kind = Number(row?.kind)
    const stat = sim_stat_of(row)
    if (stat) {
      // The row's `value` is already the real SIGNED delta (fight_status_snapshot.js strips the chain's
      // 32768 centering at the wire door, issue #886), so the SIGN LIVES ONCE — in the value. Reading
      // FLAG_NEGATIVE here as well would re-apply it: the sim vocabulary carries the sign in the row TYPE,
      // so a debuff is `STAT_DEBUFF` + the magnitude (effective_stats subtracts it).
      const delta = Number(row.value) || 0
      effects.push({
        id: row.id ?? `${stat}:${index}`,
        type: delta < 0 ? 'STAT_DEBUFF' : 'STAT_BUFF',
        timing: 'TURN_END',
        source_id: fighter?.id ?? null,
        stat,
        value: Math.abs(delta),
        turns_remaining: Number(row.remaining_turns) || 0,
      })
    } else if (kind === STATUS_KIND.INVISIBILITY)
      effects.push({
        id: row.id ?? `invisibility:${index}`,
        type: 'INVISIBILITY',
        timing: 'TURN_END',
        source_id: fighter?.id ?? null,
        value: 0,
        turns_remaining: Number(row.remaining_turns) || 0,
      })
    else if (kind === STATUS_KIND.SHIELD || kind === STATUS_KIND.POOL_SHIELD)
      effects.push({
        id: row.id ?? `shield:${kind}:${index}`,
        type: kind === STATUS_KIND.POOL_SHIELD ? 'POOL_SHIELD' : 'SHIELD',
        timing: 'TURN_END',
        source_id: fighter?.id ?? null,
        element: SIM_ELEMENT_OF_CHAIN_ID[row.element == null ? ELEMENT_NEUTRAL : Number(row.element)] ?? 'NONE',
        value: Math.max(0, Number(row.value) || 0),
        turns_remaining: Number(row.remaining_turns) || 0,
      })
  }
  if (fighter?.invisible && !effects.some((row) => row.type === 'INVISIBILITY'))
    effects.push({
      id: 'invisibility:fallback',
      type: 'INVISIBILITY',
      timing: 'TURN_END',
      source_id: fighter?.id ?? null,
      value: 0,
      turns_remaining: 1,
    })
  return effects
}

/** Full live range stat: immutable fight-start base (gear included) plus the active signed range rows. Clamp at
 * zero like Move's u64 stat fold; `effective_stats` is the same sim read actual cast validation uses. */
export const range_bonus_of = (fighter) => {
  const range = Number(fighter?.base_range ?? fighter?.stats?.range ?? 0) || 0
  return Math.max(0, Number(effective_stats({ stats: { range }, effects: sim_effects_of(fighter) }).range) || 0)
}
