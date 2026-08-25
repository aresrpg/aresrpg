// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure fight-events -> chat-line projection: the ONE place combat becomes prose facts. Lines
// carry template keys and tokenized values (chat module contract); the Chat renderer owns text
// and color. Costs, refills, and turn switches stay silent — the log speaks only what fighters
// do to each other.

import type { FightEvent, HydratedFightCheckpoint } from '@aresrpg/fight'
import { CHANNELS, EFFECT_KINDS } from '@aresrpg/fight/move_contract'

import type { ChatLine, ChatLineValue } from '../../modules/chat.ts'
import { is_segment_boundary } from './fight_cues.ts'

const POOL_LOG_REASONS = Object.freeze(['effect_grant', 'tackle_toll'])

// channel id -> the localized stat key rendered next to a lasting stat change
const STAT_KEYS: Readonly<Record<string, string>> = Object.freeze({
  [String(CHANNELS.strength)]: 'stat_strength',
  [String(CHANNELS.intelligence)]: 'stat_intelligence',
  [String(CHANNELS.chance)]: 'stat_chance',
  [String(CHANNELS.agility)]: 'stat_agility',
  [String(CHANNELS.wisdom)]: 'stat_wisdom',
  [String(CHANNELS.range)]: 'stat_range',
  [String(CHANNELS.power)]: 'stat_power',
  [String(CHANNELS.raw_damage)]: 'stat_raw_damage',
  [String(CHANNELS.critical)]: 'stat_critical',
  [String(CHANNELS.resist)]: 'stat_resistance',
})

type NameOf = (seat: bigint) => string

const fighter_value = (name_of: NameOf, seat: bigint, cls: string): ChatLineValue =>
  Object.freeze({ text: name_of(seat), cls, seat: Number(seat) })

const number_value = (text: string, cls: string): ChatLineValue => Object.freeze({ text, cls })

// the same typographic signs the floating numbers use — one visual language
const signed = (delta: bigint): string => (delta > 0n ? `+${delta}` : `\u2212${-delta}`)

type ContestedEvent = Extract<FightEvent, Readonly<{ type: 'points_contested' }>>

const contested_line = (
  event: Readonly<ContestedEvent>,
  name_of: NameOf
): Readonly<{ key: string; values: Readonly<Record<string, ChatLineValue>> }> => {
  const ap = event.payload.channel === CHANNELS.ap
  const unit_cls = ap ? 'num--ap' : 'num--mp'
  const dodged = event.payload.attempted - event.payload.removed
  const values = {
    source: fighter_value(name_of, event.payload.source, 'name'),
    target: fighter_value(name_of, event.payload.target, 'target'),
    amount: number_value(event.payload.removed.toString(), unit_cls),
    dodged: number_value(dodged.toString(), unit_cls),
    attempted: number_value(event.payload.attempted.toString(), unit_cls),
    unit: Object.freeze({ text: ap ? 'AP' : 'MP', cls: unit_cls, copy_key: ap ? 'unit_ap' : 'unit_mp' }),
  }
  if (event.payload.removed === 0n) return Object.freeze({ key: 'log_points_dodge', values })
  if (dodged > 0n) return Object.freeze({ key: 'log_points_partial', values })
  return Object.freeze({ key: event.payload.stolen ? 'log_points_steal' : 'log_points_loss', values })
}

type AppliedEvent = Extract<FightEvent, Readonly<{ type: 'effect_applied' }>>
type DamageEvent = Extract<FightEvent, Readonly<{ type: 'damage_number' }>>

// the reduction that shaved THIS hit emits immediately before it — one merged line
const damage_line = (
  event: Readonly<DamageEvent>,
  before: Readonly<FightEvent> | undefined,
  name_of: NameOf
): Readonly<{ key: string; values: Readonly<Record<string, ChatLineValue>> }> => {
  const reduced =
    before?.type === 'damage_reduced' && before.payload.target === event.payload.target
      ? before.payload.prevented
      : null
  return Object.freeze({
    key: reduced === null ? 'log_lost' : 'log_lost_reduced',
    values: Object.freeze({
      target: fighter_value(name_of, event.payload.target, 'target'),
      amount: number_value(event.payload.amount.toString(), 'num'),
      ...(reduced === null ? {} : { reduced: number_value(reduced.toString(), 'num--shield') }),
    }),
  })
}

const turns_tokens = (turns: bigint): Readonly<Record<string, ChatLineValue>> =>
  Object.freeze({
    turns: number_value(turns.toString(), 'verb'),
    turns_word: Object.freeze({ text: 'turns', cls: 'verb', copy_key: 'unit_turns' }),
  })

// A lasting row speaks once, with its duration. A chatiment fold already spoke its
// per-trigger delta the line above; a pool row whose LIVE spend already spoke (active
// target) stays silent — the caller's ledger carries that fact.
const stat_change_values = (
  event: Readonly<AppliedEvent>,
  before: Readonly<FightEvent> | undefined,
  name_of: NameOf,
  pool_logged: ReadonlySet<string>
): Readonly<Record<string, ChatLineValue>> | null => {
  if (
    event.payload.kind !== EFFECT_KINDS.add &&
    event.payload.kind !== EFFECT_KINDS.remove &&
    event.payload.kind !== EFFECT_KINDS.steal
  )
    return null
  if (before?.type === 'chatiment_triggered') return null
  const gain = event.payload.kind === EFFECT_KINDS.add
  const pool = event.payload.channel === CHANNELS.ap || event.payload.channel === CHANNELS.mp
  // pool removals/steals already spoke through points_contested; a pool GRANT row speaks
  // only when its live grant did not (the inactive ally case)
  if (pool && (!gain || pool_logged.has(`${event.payload.target}:${event.payload.channel}`))) return null
  const ap = event.payload.channel === CHANNELS.ap
  const stat_key = pool ? (ap ? 'unit_ap' : 'unit_mp') : STAT_KEYS[String(event.payload.channel)]
  if (!stat_key) return null
  const delta_cls = pool ? (ap ? 'num--ap' : 'num--mp') : gain ? 'num--gain' : 'num'
  return Object.freeze({
    target: fighter_value(name_of, event.payload.target, 'target'),
    delta: number_value(signed(gain ? event.payload.value : -event.payload.value), delta_cls),
    stat: Object.freeze({ text: '', cls: pool ? delta_cls : 'stat', copy_key: stat_key }),
    ...turns_tokens(event.payload.turns),
  })
}

export const project_fight_chat_lines = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  events: readonly FightEvent[],
  batch: string,
  name_of: NameOf
): readonly ChatLine[] => {
  const line = (index: number, key: string, values: Readonly<Record<string, ChatLineValue>>): ChatLine =>
    Object.freeze({ id: `${checkpoint.contract.id}:${batch}:${index}`, channel: 'combat' as const, key, values })
  // fighters+channels whose LIVE pool already spoke in the current resolution segment
  let pool_logged = new Set<string>()
  return Object.freeze(
    events.flatMap((event, index) => {
      if (is_segment_boundary(event.type)) pool_logged = new Set()
      if (event.type === 'ap_mp_change' && POOL_LOG_REASONS.includes(event.payload.reason)) {
        if (event.payload.ap_after !== event.payload.ap_before)
          pool_logged.add(`${event.payload.fighter}:${CHANNELS.ap}`)
        if (event.payload.mp_after !== event.payload.mp_before)
          pool_logged.add(`${event.payload.fighter}:${CHANNELS.mp}`)
      }
      if (event.type === 'fight_started') return [line(index, 'log_fight_started', {})]
      if (event.type === 'spell_cast') {
        return [
          line(index, event.payload.critical ? 'log_critical_cast' : 'log_cast', {
            caster: fighter_value(name_of, event.payload.caster, 'name'),
            spell: number_value(event.payload.spell, 'spell'),
          }),
        ]
      }
      if (event.type === 'spell_returned')
        return [line(index, 'log_returned', { target: fighter_value(name_of, event.payload.target, 'target') })]
      if (event.type === 'damage_number') {
        const damage = damage_line(event, events[index - 1], name_of)
        return [line(index, damage.key, damage.values)]
      }
      // a fully-absorbed hit emits no damage_number — the shield line is the only trace
      if (event.type === 'damage_reduced' && event.payload.remaining === 0n)
        return [
          line(index, 'log_absorbed', {
            target: fighter_value(name_of, event.payload.target, 'target'),
            reduced: number_value(event.payload.prevented.toString(), 'num--shield'),
          }),
        ]
      if (event.type === 'heal_number')
        return [
          line(index, 'log_heal', {
            source: fighter_value(name_of, event.payload.source, 'name'),
            target: fighter_value(name_of, event.payload.target, 'target'),
            amount: number_value(event.payload.amount.toString(), 'num--heal'),
          }),
        ]
      if (event.type === 'points_contested') {
        const contested = contested_line(event, name_of)
        return [line(index, contested.key, contested.values)]
      }
      if (event.type === 'ap_mp_change' && POOL_LOG_REASONS.includes(event.payload.reason)) {
        const target = fighter_value(name_of, event.payload.fighter, 'target')
        const deltas = [
          { key: 'log_ap_change', cls: 'num--ap', delta: event.payload.ap_after - event.payload.ap_before },
          { key: 'log_mp_change', cls: 'num--mp', delta: event.payload.mp_after - event.payload.mp_before },
        ]
        return deltas
          .filter(({ delta }) => delta !== 0n)
          .map(({ key, cls, delta }) => line(index, key, { target, delta: number_value(signed(delta), cls) }))
      }
      if (event.type === 'chatiment_triggered') {
        const stat_key = STAT_KEYS[String(event.payload.channel)]
        if (!stat_key) return []
        return [
          line(index, 'log_stat_change', {
            target: fighter_value(name_of, event.payload.fighter, 'target'),
            delta: number_value(signed(event.payload.value), 'num--gain'),
            stat: Object.freeze({ text: '', cls: 'stat', copy_key: stat_key }),
            ...turns_tokens(event.payload.turns),
          }),
        ]
      }
      if (event.type === 'effect_applied') {
        const values = stat_change_values(event, events[index - 1], name_of, pool_logged)
        return values ? [line(index, 'log_stat_change', values)] : []
      }
      if (event.type === 'trap_placed')
        return [line(index, 'log_trap_placed', { owner: fighter_value(name_of, event.payload.owner, 'name') })]
      if (event.type === 'glyph_placed')
        return [line(index, 'log_glyph_placed', { owner: fighter_value(name_of, event.payload.owner, 'name') })]
      if (event.type === 'fighter_died')
        return [line(index, 'log_death', { target: fighter_value(name_of, event.payload.fighter, 'death') })]
      if (event.type === 'fighter_forfeited')
        return [line(index, 'log_forfeit', { target: fighter_value(name_of, event.payload.fighter, 'death') })]
      if (event.type === 'fight_ended')
        return [
          event.payload.winner === null
            ? line(index, 'log_draw', {})
            : line(index, 'log_team_wins', {
                team: number_value((Number(event.payload.winner) + 1).toString(), 'name'),
              }),
        ]
      return []
    })
  )
}
