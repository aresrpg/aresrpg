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

import { is_signed_status_kind } from './fight_status_snapshot.js'

const K_ALTER_STAT = 9
const K_INVISIBILITY = 27
const STAT_RANGE = 6
const FLAG_NEGATIVE = 8

/** `Drain`/`Granted` point discriminant (`spell_effect::point_ap()` = 0, `point_mp()` = 1). Only these two sim
 *  stat keys are POOLS; every other stat is a timed block row. */
const POOL_POINT_KIND = { ap: 0, mp: 1 }

/** The sim's stat keys → the chain's numeric stat id (`spell_effect.move` STAT_*; the inverse of the spell
 *  normalizer's STAT_ID_MAP). A key absent here carries no numeric id and rides as null. */
const STAT_CHAIN_ID = {
  strength: 0,
  intelligence: 1,
  chance: 2,
  agility: 3,
  wisdom: 4,
  vitality: 5,
  range: 6,
  critical_hit: 7,
  percent_damage: 8,
  raw_damage: 9,
  max_hp: 10,
  heal: 11,
  ap_dodge: 12,
  mp_dodge: 13,
  physical_damage: 14,
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
  INVISIBILITY: 27, // K_INVISIBILITY
  POISON: 21, // K_APPLY_DOT
  SHIELD: 24, // K_REDUCE_DAMAGE
  REFLECT_DAMAGE: 25, // K_REFLECT_DAMAGE
  RETURN_SPELL: 29, // K_RETURN_SPELL
  APPLY_STATE: 22, // K_APPLY_STATE
  STUN: 22, // a stun is a named state on chain (no dedicated kind)
  DAMAGE_TO_HEAL: 32, // K_DAMAGE_TO_HEAL
  TIMED_PAYLOAD: 34, // K_TIMED_PAYLOAD
  NAMED_DAMAGE_STACK: 35, // K_NAMED_DAMAGE_STACK
  STANCE: 36, // K_STANCE
  REACTIVE_PUNISHMENT: 37, // K_REACTIVE_PUNISHMENT
  EROSION: 38, // K_EROSION
  DAMAGE_REDIRECT: 39, // K_DAMAGE_REDIRECT
}

/** EVERY chain kind that can appear in the per-fighter status home — the stat/point/resist alter rows plus the
 *  table above. The ONE universe: the receipt door asks it whether an envelope row is a status, and the render
 *  exhaustiveness gate asks it which kinds must own a badge arm (a kind added here with no arm goes red). */
export const STATUS_KINDS = Object.freeze(
  [...new Set([6, 7, 9, 11, ...Object.values(STATUS_KIND)])].sort((a, b) => a - b)
)

const STATUS_KIND_SET = new Set(STATUS_KINDS)

/** Does this chain kind live in the per-fighter status home? */
export const is_status_kind = (kind) => STATUS_KIND_SET.has(Number(kind))

/** The chain kind for one live sim effect row, or null when the row is not a status the chain records
 *  (a plain DAMAGE/HEAL tick row is bookkeeping, never a badge). Poison is the one exception: fight_spells.js
 *  rides its tick on a `type: 'DAMAGE'` row (reusing the generic damage-tick machinery, #1211) and marks it
 *  `dot: true` so it still reports as K_APPLY_DOT here — a badge for its target, mob or player alike. */
const status_kind_of = (effect) => {
  if (effect.dot) return STATUS_KIND.POISON
  if (effect.type === 'STAT_BUFF' || effect.type === 'STAT_DEBUFF') {
    if (POOL_POINT_KIND[effect.stat] !== undefined) return effect.type === 'STAT_BUFF' ? 6 : 7 // GIVE/REMOVE_POINTS
    return RESIST_ELEMENT[effect.stat] !== undefined ? 11 : 9 // ALTER_RESIST : ALTER_STAT
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
  return {
    kind,
    remaining_turns,
    element: RESIST_ELEMENT[effect.stat] ?? null,
    value: negative ? -magnitude : magnitude,
    stat: POOL_POINT_KIND[effect.stat] ?? STAT_CHAIN_ID[effect.stat] ?? null,
    chance: effect.chance ?? null,
    ...(negative ? { flags: FLAG_NEGATIVE } : {}),
  }
}

const active = (row) => row?.remaining_turns == null || Number(row.remaining_turns) > 0

/** Convert the active raw status rows exposed by engine_view into the sim effects prediction consumes. Already-
 * normalized effects pass through for the legacy world-fight view. Other raw kinds stay presentation-only until a
 * mechanics consumer explicitly supports them. */
export const sim_effects_of = (fighter) => {
  const effects = []
  for (const [index, row] of (fighter?.effects ?? []).entries()) {
    if (!active(row)) continue
    if (row?.type) {
      effects.push(row)
      continue
    }
    const kind = Number(row?.kind)
    if (kind === K_ALTER_STAT && Number(row.stat) === STAT_RANGE) {
      // The row's `value` is already the real SIGNED delta (fight_status_snapshot.js strips the chain's
      // 32768 centering at the wire door, issue #886), so the SIGN LIVES ONCE — in the value. Reading
      // FLAG_NEGATIVE here as well would re-apply it: the sim vocabulary carries the sign in the row TYPE,
      // so a debuff is `STAT_DEBUFF` + the magnitude (effective_stats subtracts it).
      const delta = Number(row.value) || 0
      effects.push({
        id: row.id ?? `range:${index}`,
        type: delta < 0 ? 'STAT_DEBUFF' : 'STAT_BUFF',
        timing: 'TURN_END',
        source_id: fighter?.id ?? null,
        stat: 'range',
        value: Math.abs(delta),
        turns_remaining: Number(row.remaining_turns) || 0,
      })
    } else if (kind === K_INVISIBILITY)
      effects.push({
        id: row.id ?? `invisibility:${index}`,
        type: 'INVISIBILITY',
        timing: 'TURN_END',
        source_id: fighter?.id ?? null,
        value: 0,
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
