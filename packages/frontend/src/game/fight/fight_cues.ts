// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable complexity -- cue projection exhaustively maps the sealed fight-event union in one function. */
// Pure fight-event -> engine-cue projection. This is the only game-side presentation mapping;
// it reads canonical results and never re-resolves combat.
/* eslint-disable functional/immutable-data -- The reducer mutates only its fresh local cue accumulator, then freezes it. */

import {
  player_max_hp,
  POOL_EFFECT_REASONS,
  type FightEvent,
  type HydratedFightCheckpoint,
  type SpellEffect,
} from '@aresrpg/fight'
import { fight_path_gait, type FightCastStyle, type FightPresentationCue } from '@aresrpg/engine'
import { CHANNELS, CONTRACT_CONSTANTS, EFFECT_KINDS } from '@aresrpg/fight/move_contract'

type CastEvent = Extract<FightEvent, Readonly<{ type: 'spell_cast' }>>

const entity_id = (checkpoint: Readonly<HydratedFightCheckpoint>, seat: bigint): string =>
  checkpoint.contract.fighters[Number(seat)]?.kind.type === 'mob' ? `fight_mob_${seat}` : `fight_character_${seat}`

const max_hp = (checkpoint: Readonly<HydratedFightCheckpoint>, seat: bigint): bigint | null => {
  const fighter = checkpoint.contract.fighters[Number(seat)]
  if (!fighter) return null
  return fighter.kind.type === 'mob'
    ? fighter.kind.snapshot.max_hp
    : player_max_hp(checkpoint.sources.players[fighter.kind.character])
}

const cast_rows = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  event: Readonly<CastEvent>
): readonly SpellEffect[] => {
  const fighter = checkpoint.contract.fighters[Number(event.payload.caster)]
  if (!fighter) return Object.freeze([])
  if (fighter.kind.type === 'mob') {
    const level = fighter.kind.snapshot.kit.find(({ name }) => name === event.payload.spell)?.level
    if (!level) return Object.freeze([])
    return event.payload.critical && level.crit_effects.length > 0 ? level.crit_effects : level.effects
  }
  const source = checkpoint.sources.players[fighter.kind.character]
  const spell = checkpoint.sources.spells[event.payload.spell]
  const invested = source?.spell_levels[event.payload.spell] ?? 1n
  const level = spell?.levels[Number(invested - 1n)]
  if (!level) return Object.freeze([])
  return event.payload.critical && level.crit_effects.length > 0 ? level.crit_effects : level.effects
}

const authored_element = (checkpoint: Readonly<HydratedFightCheckpoint>, event: Readonly<CastEvent>): string =>
  cast_rows(checkpoint, event).find(({ element }) => element.length > 0)?.element ?? 'neutral'

const cast_style = (
  rows: readonly SpellEffect[],
  events: readonly FightEvent[],
  placement: 'trap' | 'glyph' | null,
  weapon: boolean
): FightCastStyle => {
  if (weapon) return 'weapon'
  if (placement) return placement
  if (events.some((event) => event.type === 'fighter_moved' && event.payload.mode === 'push')) return 'push'
  if (events.some((event) => event.type === 'fighter_moved' && event.payload.mode === 'pull')) return 'pull'
  if (
    events.some(
      (event) => event.type === 'fighter_moved' && (event.payload.mode === 'teleport' || event.payload.mode === 'swap')
    )
  )
    return 'teleport'
  if (rows.some(({ kind }) => kind === EFFECT_KINDS.push)) return 'push'
  if (rows.some(({ kind }) => kind === EFFECT_KINDS.pull)) return 'pull'
  if (rows.some(({ kind }) => kind === EFFECT_KINDS.teleport || kind === EFFECT_KINDS.swap)) return 'teleport'
  if (rows.some(({ kind, stat, turns }) => stat === CHANNELS.hp && kind !== EFFECT_KINDS.add && turns > 0n))
    return 'dot'
  if (rows.some(({ kind, stat }) => stat === CHANNELS.hp && kind === EFFECT_KINDS.add)) return 'heal'
  if (events.some(({ type }) => type === 'heal_number')) return 'heal'
  if (
    rows.some(
      ({ kind }) =>
        kind === EFFECT_KINDS.damage ||
        kind === EFFECT_KINDS.pct_life ||
        kind === EFFECT_KINDS.caster_damage ||
        kind === EFFECT_KINDS.punishment
    )
  )
    return 'damage'
  if (events.some(({ type }) => type === 'damage_number')) return 'damage'
  if (rows.some(({ kind }) => kind === EFFECT_KINDS.remove || kind === EFFECT_KINDS.steal)) return 'debuff'
  if (rows.some(({ kind }) => kind === EFFECT_KINDS.add)) return 'buff'
  return 'state'
}

// A trap/glyph trigger is a presentation boundary: the cast owns only what happens BEFORE the
// first trigger — a sprung trap's damage and sounds belong to its own zone cue, never folded
// into the cast's impact.
const cast_segment = (events: readonly FightEvent[], index: number): readonly FightEvent[] => {
  const tail = events.slice(index + 1)
  const boundary = tail.findIndex(({ type }) =>
    ['spell_cast', 'turn_switched', 'trap_triggered', 'glyph_triggered'].includes(type)
  )
  return Object.freeze(boundary < 0 ? tail : tail.slice(0, boundary))
}

const zone_segment = (events: readonly FightEvent[], index: number): readonly FightEvent[] => {
  const tail = events.slice(index + 1)
  const boundary = tail.findIndex(
    ({ type }) =>
      type === 'trap_triggered' ||
      type === 'glyph_triggered' ||
      type === 'fighter_moved' ||
      type === 'spell_cast' ||
      type === 'turn_switched'
  )
  return Object.freeze(boundary < 0 ? tail : tail.slice(0, boundary))
}

const zone_element = (events: readonly FightEvent[], index: number, cause: 'trap' | 'glyph'): string => {
  const segment = zone_segment(events, index)
  const damage = segment.find(
    (row): row is Extract<FightEvent, Readonly<{ type: 'damage_number' }>> =>
      row.type === 'damage_number' && row.payload.cause === cause
  )
  if (damage?.payload.element) return damage.payload.element
  return segment.some((row) => row.type === 'heal_number' && row.payload.cause === cause) ? 'heal' : 'neutral'
}

const affected_seats = (events: readonly FightEvent[]): readonly bigint[] =>
  Object.freeze([
    ...new Set(
      events.flatMap((event) => {
        if (event.type === 'damage_number' || event.type === 'damage_reduced' || event.type === 'heal_number')
          return [event.payload.target]
        return []
      })
    ),
  ])

const affected_status_seats = (events: readonly FightEvent[]): readonly bigint[] =>
  Object.freeze([
    ...new Set(
      events.flatMap((event) => {
        if (event.type === 'effect_applied') return [event.payload.target]
        if (event.type === 'ap_mp_change' && [...POOL_EFFECT_REASONS, 'tackle_toll'].includes(event.payload.reason))
          return [event.payload.fighter]
        return []
      })
    ),
  ])

// A resolution segment ends where a new cause begins — every per-segment ledger resets here.
export const is_segment_boundary = (event_type: string): boolean =>
  ['spell_cast', 'trap_triggered', 'glyph_triggered', 'turn_switched'].includes(event_type)

// One signed pool float per fighter+channel per resolution segment: a live change floats its
// deltas; a lasting ap/mp row floats only when that channel's live pool did not move (an
// inactive target prices the next refill and emits no ap_mp_change). `floated` is the
// segment's dedupe ledger of `${fighter}:${channel}` keys; the caller records the returned keys.
const pool_cue = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  event: Readonly<FightEvent>,
  floated: ReadonlySet<string>,
  id: string
): Readonly<{ cue: FightPresentationCue; keys: readonly string[] }> | null => {
  if (event.type === 'ap_mp_change' && POOL_EFFECT_REASONS.includes(event.payload.reason as never)) {
    const ap = Number(event.payload.ap_after - event.payload.ap_before)
    const mp = Number(event.payload.mp_after - event.payload.mp_before)
    return Object.freeze({
      keys: Object.freeze([
        ...(ap === 0 ? [] : [`${event.payload.fighter}:${CHANNELS.ap}`]),
        ...(mp === 0 ? [] : [`${event.payload.fighter}:${CHANNELS.mp}`]),
      ]),
      cue: Object.freeze({
        id,
        type: 'pool' as const,
        entity_id: entity_id(checkpoint, event.payload.fighter),
        ap,
        mp,
      }),
    })
  }
  if (
    event.type === 'effect_applied' &&
    (event.payload.channel === CHANNELS.ap || event.payload.channel === CHANNELS.mp) &&
    !floated.has(`${event.payload.target}:${event.payload.channel}`)
  ) {
    const signed = Number(event.payload.value) * (event.payload.kind === EFFECT_KINDS.add ? 1 : -1)
    return Object.freeze({
      keys: Object.freeze([`${event.payload.target}:${event.payload.channel}`]),
      cue: Object.freeze({
        id,
        type: 'pool' as const,
        entity_id: entity_id(checkpoint, event.payload.target),
        ap: event.payload.channel === CHANNELS.ap ? signed : 0,
        mp: event.payload.channel === CHANNELS.mp ? signed : 0,
      }),
    })
  }
  return null
}

const cue_id = (fight: string, batch: number, index: number): string => `${fight}:${batch}:${index}`

const order_cast_displacement = (cues: readonly FightPresentationCue[]): readonly FightPresentationCue[] => {
  const ordered: FightPresentationCue[] = []
  let index = 0
  while (index < cues.length) {
    const cue = cues[index]!
    if (cue.type !== 'cast') {
      ordered.push(cue)
      index += 1
      continue
    }
    const tail = cues.slice(index + 1)
    const offset = tail.findIndex(({ type }) => type === 'cast' || type === 'turn')
    const end = offset < 0 ? cues.length : index + 1 + offset
    const segment = cues.slice(index + 1, end)
    // Hoisting stops at the first sprung zone: movement after a trigger belongs to that
    // trigger's aftermath (slide → boom → slide → boom), never to the cast's opening beat.
    const zone_boundary = segment.findIndex(({ type }) => type === 'zone')
    const prefix = zone_boundary < 0 ? segment : segment.slice(0, zone_boundary)
    const aftermath = zone_boundary < 0 ? [] : segment.slice(zone_boundary)
    const displacement = prefix.filter(
      (candidate) => candidate.type === 'movement' && candidate.mode !== 'walk' && candidate.mode !== 'place'
    )
    ordered.push(cue, ...displacement, ...prefix.filter((candidate) => !displacement.includes(candidate)), ...aftermath)
    index = end
  }
  return Object.freeze(ordered)
}

const assign_walk_mp = (cues: readonly FightPresentationCue[]): readonly FightPresentationCue[] => {
  const totals = new Map<string, Readonly<{ total: number; cells: number; last: number }>>()
  cues.forEach((cue, index) => {
    if (cue.type !== 'movement' || cue.mode !== 'walk') return
    const current = totals.get(cue.entity_id) ?? { total: 0, cells: 0, last: index }
    totals.set(
      cue.entity_id,
      Object.freeze({ total: current.total + cue.mp_spent, cells: current.cells + cue.cells.length, last: index })
    )
  })
  return Object.freeze(
    cues.map((cue, index) => {
      if (cue.type !== 'movement' || cue.mode !== 'walk') return cue
      const total = totals.get(cue.entity_id)
      return Object.freeze({
        ...cue,
        mp_spent: total?.last === index ? total.total : 0,
        gait: fight_path_gait(total?.cells ?? cue.cells.length),
      })
    })
  )
}

export const project_fight_cues = ({
  checkpoint,
  events,
  batch,
}: Readonly<{
  checkpoint: HydratedFightCheckpoint
  events: readonly FightEvent[]
  batch: number
}>): readonly FightPresentationCue[] => {
  const cues: FightPresentationCue[] = []
  let cast_critical = false
  // Fighters whose LIVE pool already floated in the current resolution segment — an active
  // target emits both the spend and the lasting row for one contested removal (one fact).
  let pool_floated = new Set<string>()
  events.forEach((event, index) => {
    const id = cue_id(checkpoint.contract.id, batch, index)
    if (is_segment_boundary(event.type)) pool_floated = new Set()
    if (event.type === 'spell_cast') {
      cast_critical = event.payload.critical
      const segment = cast_segment(events, index)
      const damage = segment.flatMap((row) => (row.type === 'damage_number' ? [row.payload] : []))
      const heals = segment.flatMap((row) => (row.type === 'heal_number' ? [row.payload] : []))
      const placement = segment.some(({ type }) => type === 'trap_placed')
        ? 'trap'
        : segment.some(({ type }) => type === 'glyph_placed')
          ? 'glyph'
          : null
      const targets = affected_seats(segment)
      const primary = damage.reduce<(typeof damage)[number] | null>(
        (found, row) => (!found || row.amount > found.amount ? row : found),
        null
      )
      const element = event.payload.weapon
        ? 'weapon'
        : (damage.find(({ element: value }) => value.length > 0)?.element ??
          (heals.length > 0 ? 'heal' : authored_element(checkpoint, event)))
      const rows = cast_rows(checkpoint, event)
      cues.push(
        Object.freeze({
          id,
          type: 'cast',
          caster_id: entity_id(checkpoint, event.payload.caster),
          self_cast:
            Number(checkpoint.contract.fighters[Number(event.payload.caster)]?.cell ?? -1) ===
            Number(event.payload.target_cell),
          spell: event.payload.spell,
          cast_level: Number(event.payload.cast_level),
          target_cell: Number(event.payload.target_cell),
          element,
          style: cast_style(rows, segment, placement, event.payload.weapon),
          critical: event.payload.critical,
          amount: Number([...damage, ...heals].reduce((total, row) => total + row.amount, 0n)),
          target_max_hp: primary ? Number(max_hp(checkpoint, primary.target)) : null,
          affected_cells: Object.freeze(
            targets.flatMap((seat) => {
              const fighter = checkpoint.contract.fighters[Number(seat)]
              return fighter ? [Number(fighter.cell)] : []
            })
          ),
          killed: damage.some(({ hp_after }) => hp_after === 0n),
        })
      )
      return
    }
    if (event.type === 'fighter_placed') {
      cues.push(
        Object.freeze({
          id,
          type: 'movement',
          entity_id: entity_id(checkpoint, event.payload.fighter),
          cells: Object.freeze([Number(event.payload.to)]),
          mode: 'place',
          source_id: entity_id(checkpoint, event.payload.fighter),
          mp_spent: 0,
          gait: 'walk',
        })
      )
      return
    }
    if (event.type === 'fighter_moved') {
      const projected = Object.freeze({
        id,
        type: 'movement' as const,
        entity_id: entity_id(checkpoint, event.payload.fighter),
        cells: Object.freeze([Number(event.payload.to)]),
        mode: event.payload.mode,
        source_id: entity_id(checkpoint, event.payload.source),
        mp_spent: Number(event.payload.mp_spent),
        // forced displacement slides — no gait animation, no reorientation
        gait:
          event.payload.mode === 'push' || event.payload.mode === 'pull'
            ? ('slide' as const)
            : event.payload.mode === 'walk'
              ? ('walk' as const)
              : ('run' as const),
      })
      const previous = cues.at(-1)
      if (
        previous?.type === 'movement' &&
        previous.entity_id === projected.entity_id &&
        previous.mode === projected.mode &&
        previous.source_id === projected.source_id
      )
        cues[cues.length - 1] = Object.freeze({
          ...previous,
          cells: Object.freeze([...previous.cells, ...projected.cells]),
          mp_spent: previous.mp_spent + projected.mp_spent,
        })
      else cues.push(projected)
      return
    }
    if (event.type === 'tackle_resolved' && (event.payload.ap_lost > 0n || event.payload.mp_lost > 0n)) {
      cues.push(
        Object.freeze({
          id,
          type: 'tackle',
          entity_id: entity_id(checkpoint, event.payload.runner),
          source_id: entity_id(checkpoint, event.payload.lockers[0] ?? event.payload.runner),
          ap_lost: Number(event.payload.ap_lost),
          mp_lost: Number(event.payload.mp_lost),
        })
      )
      return
    }
    if (event.type === 'trap_placed' || event.type === 'glyph_placed') {
      cues.push(
        Object.freeze({
          id,
          type: 'zone_placed',
          action: event.type,
          zone_id: event.payload.zone_id,
          owner_id: entity_id(checkpoint, event.payload.owner),
          cell: Number(event.payload.anchor),
        })
      )
      return
    }
    const pool = pool_cue(checkpoint, event, pool_floated, id)
    if (pool) {
      pool.keys.forEach((key) => pool_floated.add(key))
      cues.push(pool.cue)
      return
    }
    if (event.type === 'damage_number') {
      cues.push(
        Object.freeze({
          id,
          type: 'damage',
          source_id: entity_id(checkpoint, event.payload.source),
          target_id: entity_id(checkpoint, event.payload.target),
          amount: Number(event.payload.amount),
          hp_before: Number(event.payload.hp_before),
          hp_after: Number(event.payload.hp_after),
          element: event.payload.element || 'neutral',
          cause: event.payload.cause,
          critical: (event.payload.cause === 'spell' || event.payload.cause === 'weapon') && cast_critical,
        })
      )
      return
    }
    if (event.type === 'damage_reduced') {
      cues.push(
        Object.freeze({
          id,
          type: 'absorb',
          source_id: entity_id(checkpoint, event.payload.source),
          target_id: entity_id(checkpoint, event.payload.target),
          prevented: Number(event.payload.prevented),
          remaining: Number(event.payload.remaining),
        })
      )
      return
    }
    if (event.type === 'heal_number') {
      cues.push(
        Object.freeze({
          id,
          type: 'heal',
          source_id: entity_id(checkpoint, event.payload.source),
          target_id: entity_id(checkpoint, event.payload.target),
          amount: Number(event.payload.amount),
          hp_before: Number(event.payload.hp_before),
          hp_after: Number(event.payload.hp_after),
          cause: event.payload.cause,
        })
      )
      return
    }
    if (event.type === 'fighter_died') {
      cues.push(
        Object.freeze({
          id,
          type: 'death',
          entity_id: entity_id(checkpoint, event.payload.fighter),
          source_id: entity_id(checkpoint, event.payload.source),
          cell: Number(event.payload.cell),
          cause: event.payload.cause,
        })
      )
      return
    }
    if (event.type === 'trap_triggered' || event.type === 'glyph_triggered') {
      const segment = zone_segment(events, index)
      const damage_targets = new Set(affected_seats(segment))
      cues.push(
        Object.freeze({
          id,
          type: 'zone',
          action: event.type,
          zone_id: event.payload.zone_id,
          owner_id: entity_id(checkpoint, event.payload.owner),
          target_id: entity_id(checkpoint, event.payload.fighter),
          affected_ids: Object.freeze(
            affected_status_seats(segment)
              .filter((seat) => !damage_targets.has(seat))
              .map((seat) => entity_id(checkpoint, seat))
          ),
          cell: Number(event.payload.cell),
          element: zone_element(events, index, event.type === 'trap_triggered' ? 'trap' : 'glyph'),
        })
      )
      return
    }
    if (event.type === 'turn_switched') {
      cast_critical = false
      const mob = checkpoint.contract.fighters[Number(event.payload.to)]?.kind.type === 'mob'
      cues.push(
        Object.freeze({
          id,
          type: 'turn',
          entity_id: entity_id(checkpoint, event.payload.to),
          // a mob turn holds the card for the chain's own per-turn floor
          ...(mob ? { min_ms: Number(CONTRACT_CONSTANTS.turn_min_ms) } : {}),
        })
      )
    }
  })
  return assign_walk_mp(order_cast_displacement(cues))
}
