// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable no-param-reassign, fp-law/no-mutating-methods -- The Move twin updates only its reducer-owned structuredClone draft; caller snapshots stay immutable. */
// The one spell/weapon/zone resolver, ported in fight.move mutation order.

import { GRID_CELLS, in_grid, line_of_sight, manhattan, mask_get, same_line, zone_cells } from './combat_grid.ts'
import { contest_points, deal, full_damage, life_steal, resist, roll_value } from './damage.ts'
import { effect_seed, heal_amount, punishment_base } from './fight_math.ts'
import { KINDS, STATS, add_ap, add_mp, heal_seat, hit, max_hp_of, sheet_of, spend_ap, spend_mp } from './fighters.ts'
import { displace, fighter_at, living_cells } from './movement.ts'
import { draw } from './prng.ts'
import { add_effect_id, add_zone_id, effect_id_at, emit, fail } from './runtime.ts'
import { spell_level_of, spell_turn_rows, type FightReadState } from './spell_turn.ts'
import { on_enter } from './zones.ts'
import type {
  ActiveEffect,
  FightRuntime,
  FightSheet,
  PrngCursor,
  ResolveRowsInput,
  SpellEffect,
  SpellLevel,
} from './types.ts'

const NO_TARGET = 0xffff_ffffn

export const legal_cell = (runtime: FightReadState, cell: bigint): boolean =>
  in_grid(cell) && !mask_get(runtime.contract.closed, cell)

const emit_effect = (runtime: FightRuntime, target: bigint, effect: ActiveEffect, id: string): void =>
  emit(runtime, 'effect_applied', {
    target,
    effect_id: id,
    kind: effect.kind,
    channel: effect.stat,
    element: effect.element,
    value: effect.value,
    turns: effect.turns_left,
    source: effect.source,
  })

const push_row = (runtime: FightRuntime, target: bigint, row: SpellEffect, source: bigint, value: bigint): string => {
  const effect = {
    kind: row.kind,
    element: row.element,
    value,
    turns_left: row.turns === 0n ? 1n : row.turns,
    source,
    stat: row.stat,
  }
  runtime.contract.fighters[Number(target)].effects.push(effect)
  const id = add_effect_id(runtime, target)
  emit_effect(runtime, target, effect, id)
  if (effect.kind === KINDS.invis)
    emit(runtime, 'invisibility_changed', { fighter: target, invisible: true, reason: 'applied' })
  return id
}

const drop_invisibility = (runtime: FightRuntime, fighter: bigint, reason: string): void => {
  const rows = runtime.contract.fighters[Number(fighter)].effects
  if (!rows.some((row) => row.kind === KINDS.invis)) return
  const kept = rows
    .map((row, index) => ({ row, id: effect_id_at(runtime, fighter, index) }))
    .filter(({ row }) => row.kind !== KINDS.invis)
  runtime.contract.fighters[Number(fighter)].effects = kept.map(({ row }) => row)
  runtime.render_ids.effects[Number(fighter)] = kept.map(({ id }) => id)
  emit(runtime, 'invisibility_changed', { fighter, invisible: false, reason })
}

const cooldown_left = (runtime: FightReadState, seat: bigint, spell: string): bigint =>
  runtime.contract.fighters[Number(seat)].cooldowns.find((row) => row.spell === spell)?.left ?? 0n

const set_cooldown = (runtime: FightRuntime, seat: bigint, spell: string, left: bigint): void => {
  const fighter = runtime.contract.fighters[Number(seat)]
  const index = fighter.cooldowns.findIndex((row) => row.spell === spell)
  const before = index < 0 ? 0n : fighter.cooldowns[index].left
  if (index < 0) fighter.cooldowns.push({ spell, left })
  else fighter.cooldowns[index] = { spell, left }
  emit(runtime, 'cooldown_changed', { fighter: seat, spell, before, after: left, reason: 'cast' })
}

export const casts_this_turn = (runtime: FightReadState, spell: string, target: bigint | null = null): bigint =>
  BigInt(
    runtime.contract.turn_casts.filter((row) => row.spell === spell && (target === null || row.target === target))
      .length
  )

export const sight_blockers = (runtime: FightReadState, looker: bigint, target_cell: bigint): bigint[] => [
  ...runtime.contract.board.obstacles,
  ...living_cells(runtime, looker).filter((cell) => cell !== target_cell),
]

const visible_occupant = (runtime: FightReadState, caster: bigint, cell: bigint): bigint | null => {
  const occupant = fighter_at(runtime, cell)
  if (occupant === null) return null
  const fighter = runtime.contract.fighters[Number(occupant)]
  const caster_fighter = runtime.contract.fighters[Number(caster)]
  const invisible = fighter.effects.some((row) => row.kind === KINDS.invis)
  return invisible && fighter.team !== caster_fighter.team ? null : occupant
}

const has_offensive = (rows: readonly SpellEffect[]): boolean =>
  rows.some((row) =>
    [KINDS.damage, KINDS.pct_life, KINDS.punishment, KINDS.remove, KINDS.steal, KINDS.push, KINDS.pull].includes(
      row.kind
    )
  )

const is_placement = (row: SpellEffect): boolean => row.kind === KINDS.trap || row.kind === KINDS.glyph

const split_placements = (rows: readonly SpellEffect[]): { placements: SpellEffect[]; payload: SpellEffect[] } => ({
  placements: rows.filter(is_placement),
  payload: rows.filter((row) => !is_placement(row)),
})

const placement_anchor_available = (
  runtime: FightReadState,
  placements: readonly SpellEffect[],
  target_cell: bigint
): boolean =>
  placements.length === 1 &&
  !runtime.contract.zones.some(({ anchor }) => anchor === target_cell) &&
  (placements[0].kind !== KINDS.trap || fighter_at(runtime, target_cell) === null)

export const placement_rows_castable = (
  runtime: FightReadState,
  rows: readonly SpellEffect[],
  target_cell: bigint
): boolean => {
  const placements = rows.filter(is_placement)
  return placements.length === 0 || placement_anchor_available(runtime, placements, target_cell)
}

const zone_targets = (
  runtime: FightRuntime,
  caster: bigint,
  row: SpellEffect,
  anchor: bigint,
  origin: bigint
): bigint[] => {
  const { team } = runtime.contract.fighters[Number(caster)]
  return zone_cells(row.area_shape, row.area_size, anchor, origin)
    .map((cell) => fighter_at(runtime, cell))
    .filter((seat): seat is bigint => seat !== null)
    .filter((seat) => {
      if (row.target_filter === 1n) return runtime.contract.fighters[Number(seat)].team !== team
      if (row.target_filter === 2n) return seat !== caster
      if (row.target_filter === 3n) return runtime.contract.fighters[Number(seat)].team === team
      if (row.target_filter === 4n) return seat === caster
      return true
    })
}

const travel_order = (runtime: FightRuntime, targets: bigint[], pivot: bigint, push: boolean): bigint[] =>
  [...targets].sort((left, right) => {
    const left_distance = manhattan(runtime.contract.fighters[Number(left)].cell, pivot)
    const right_distance = manhattan(runtime.contract.fighters[Number(right)].cell, pivot)
    if (left_distance === right_distance) return Number(left - right)
    const ahead = push ? left_distance > right_distance : left_distance < right_distance
    return ahead ? -1 : 1
  })

type NumberRowInput = {
  runtime: FightRuntime
  caster: bigint
  sheet: FightSheet
  row: SpellEffect
  target: bigint
  cursor: PrngCursor
  critical: boolean
  cast_level: bigint
}

const apply_number_row = ({
  runtime,
  caster,
  sheet,
  row,
  target,
  cursor,
  critical,
  cast_level,
}: NumberRowInput): void => {
  const channel = row.stat
  const { turns } = row
  if (channel === STATS.hp) {
    if (row.kind === KINDS.add && turns === 0n) {
      heal_seat(runtime, {
        target,
        amount: heal_amount(roll_value(row, cursor), sheet.intelligence),
        source: caster,
        cause: 'instant_heal',
      })
    } else if (row.kind === KINDS.add) {
      push_row(runtime, target, row, caster, heal_amount(roll_value(row, cursor), sheet.intelligence))
    } else if (row.kind === KINDS.steal && turns === 0n) {
      life_steal({
        runtime,
        caster,
        sheet,
        target,
        element: row.element,
        base: roll_value(row, cursor),
        cast_level,
      })
    } else {
      push_row(
        runtime,
        target,
        row,
        caster,
        full_damage(runtime, sheet, target, row.element, roll_value(row, cursor), critical)
      )
    }
    return
  }
  if (channel === STATS.ap || channel === STATS.mp) {
    const active = runtime.contract.queue[Number(runtime.contract.turn_ptr)] === target
    if (row.kind === KINDS.add) {
      if (active) {
        if (channel === STATS.ap) add_ap(runtime, target, row.value, 'effect_grant', caster)
        else add_mp(runtime, target, row.value, 'effect_grant', caster)
      }
      if (turns > 0n) push_row(runtime, target, row, caster, row.value)
      return
    }
    const removed = contest_points(runtime, sheet, target, row, cursor)
    if (removed === 0n) return
    if (active) {
      if (channel === STATS.ap) spend_ap(runtime, target, removed, 'effect_remove', caster)
      else spend_mp(runtime, target, removed, 'effect_remove', caster)
    }
    push_row(runtime, target, row, caster, removed)
    if (row.kind === KINDS.steal) {
      if (channel === STATS.ap) add_ap(runtime, caster, removed, 'effect_steal', target)
      else add_mp(runtime, caster, removed, 'effect_steal', target)
    }
    return
  }
  push_row(runtime, target, row, caster, row.value)
  if (row.kind === KINDS.steal) {
    const gain = { ...row, kind: KINDS.add, turns: row.turns === 0n ? 1n : row.turns }
    push_row(runtime, caster, gain, caster, row.value)
  }
}

type ApplyToInput = NumberRowInput & { origin: bigint; cause: string }

const apply_to = ({
  runtime,
  caster,
  sheet,
  row,
  target,
  origin,
  cursor,
  critical,
  cast_level,
  cause,
}: ApplyToInput): void => {
  if (row.kind === KINDS.damage) {
    deal({ runtime, caster, sheet, target, element: row.element, base: roll_value(row, cursor), cast_level, cause })
  } else if (row.kind === KINDS.pct_life) {
    const maximum = max_hp_of(runtime, target)
    hit(runtime, {
      target,
      amount: resist(runtime, target, row.element, (maximum * row.value) / 100n),
      source: caster,
      cause: 'percent_life',
      element: row.element,
    })
  } else if (row.kind === KINDS.caster_damage) {
    hit(runtime, {
      target: caster,
      amount: resist(runtime, caster, row.element, roll_value(row, cursor)),
      source: caster,
      cause: 'caster_damage',
      element: row.element,
    })
  } else if (row.kind === KINDS.punishment) {
    deal({
      runtime,
      caster,
      sheet,
      target,
      element: row.element,
      base: punishment_base(
        roll_value(row, cursor),
        runtime.contract.fighters[Number(caster)].hp,
        max_hp_of(runtime, caster)
      ),
      cast_level,
      cause: 'punishment',
    })
  } else if ([KINDS.add, KINDS.remove, KINDS.steal].includes(row.kind)) {
    apply_number_row({ runtime, caster, sheet, row, target, cursor, critical, cast_level })
  } else if (row.kind === KINDS.reaction) {
    push_row(runtime, target, row, caster, row.value)
  } else if (row.kind === KINDS.push || row.kind === KINDS.pull) {
    displace({
      runtime,
      sheet,
      source: caster,
      target,
      cells: row.value,
      push: row.kind === KINDS.push,
      origin,
      on_enter: (next_runtime, fighter, from) => on_enter(next_runtime, fighter, from, resolve_rows),
    })
  } else if (row.kind === KINDS.return) {
    push_row(runtime, target, { ...row, value: cast_level, stat: 0n }, caster, cast_level)
  } else if (row.kind === KINDS.dispel) {
    const fighter = runtime.contract.fighters[Number(target)]
    const removed_effect_ids = [...runtime.render_ids.effects[Number(target)]]
    const was_invisible = fighter.effects.some((effect) => effect.kind === KINDS.invis)
    fighter.effects = []
    runtime.render_ids.effects[Number(target)] = []
    emit(runtime, 'effects_dispelled', { target, removed_effect_ids })
    if (was_invisible) emit(runtime, 'invisibility_changed', { fighter: target, invisible: false, reason: 'dispelled' })
  } else {
    push_row(runtime, target, row, caster, row.value)
  }
}

type ApplyRowInput = Omit<ApplyToInput, 'target'> & { anchor: bigint }

const apply_row = ({
  runtime,
  caster,
  sheet,
  row,
  anchor,
  origin,
  cursor,
  critical,
  cast_level,
  cause,
}: ApplyRowInput): void => {
  if (row.kind === KINDS.teleport) {
    if (fighter_at(runtime, anchor) === null && legal_cell(runtime, anchor)) {
      const from = runtime.contract.fighters[Number(caster)].cell
      runtime.contract.fighters[Number(caster)].cell = anchor
      emit(runtime, 'fighter_moved', {
        fighter: caster,
        from,
        to: anchor,
        mode: 'teleport',
        source: caster,
        mp_spent: 0n,
      })
      on_enter(runtime, caster, from, resolve_rows)
    }
    return
  }
  if (row.kind === KINDS.swap) {
    const other = fighter_at(runtime, anchor)
    if (other !== null && other !== caster) {
      const caster_cell = runtime.contract.fighters[Number(caster)].cell
      const other_cell = runtime.contract.fighters[Number(other)].cell
      runtime.contract.fighters[Number(caster)].cell = other_cell
      runtime.contract.fighters[Number(other)].cell = caster_cell
      emit(runtime, 'fighter_moved', {
        fighter: caster,
        from: caster_cell,
        to: other_cell,
        mode: 'swap',
        source: caster,
        mp_spent: 0n,
      })
      on_enter(runtime, caster, caster_cell, resolve_rows)
      emit(runtime, 'fighter_moved', {
        fighter: other,
        from: other_cell,
        to: caster_cell,
        mode: 'swap',
        source: caster,
        mp_spent: 0n,
      })
      on_enter(runtime, other, other_cell, resolve_rows)
    }
    return
  }
  const targets = zone_targets(runtime, caster, row, anchor, origin)
  const ordered =
    row.kind === KINDS.push || row.kind === KINDS.pull
      ? travel_order(runtime, targets, origin, row.kind === KINDS.push)
      : targets
  ordered.forEach((target) => {
    if (!runtime.contract.ended)
      apply_to({ runtime, caster, sheet, row, target, origin, cursor, critical, cast_level, cause })
  })
}

export const resolve_rows = ({
  runtime,
  caster,
  sheet,
  rows,
  anchor,
  origin,
  cursor,
  critical,
  cast_level,
  cause,
}: ResolveRowsInput): void => {
  rows.forEach((row) => {
    if (runtime.contract.ended) return
    if (row.chance_bp >= 10_000n || draw(cursor) % 10_000n < row.chance_bp)
      apply_row({ runtime, caster, sheet, row, anchor, origin, cursor, critical, cast_level, cause })
  })
}

type CastLegality =
  | Readonly<{
      ok: true
      sheet: FightSheet
      occupant: bigint | null
      critical: boolean
      rows: readonly SpellEffect[]
    }>
  | Readonly<{ ok: false; code: string }>

const cast_legality = ({
  runtime,
  caster,
  level,
  name,
  target_cell,
}: Readonly<{
  runtime: FightReadState
  caster: bigint
  level: SpellLevel
  name: string
  target_cell: bigint
}>): CastLegality => {
  const fighter = runtime.contract.fighters[Number(caster)]
  if (!fighter || fighter.ap < level.ap_cost) return Object.freeze({ ok: false, code: 'no_ap' })
  if (!legal_cell(runtime, target_cell)) return Object.freeze({ ok: false, code: 'bad_target_cell' })
  const sheet = sheet_of(runtime, caster)
  const caster_cell = fighter.cell
  const distance = manhattan(caster_cell, target_cell)
  const range_bonus = level.modifiable_range ? sheet.range_bonus : 0n
  if (distance < level.range_min || distance > level.range_max + range_bonus)
    return Object.freeze({ ok: false, code: 'out_of_range' })
  if (level.line_launch && !same_line(caster_cell, target_cell))
    return Object.freeze({ ok: false, code: 'not_in_line' })
  if (level.line_of_sight && !line_of_sight(caster_cell, target_cell, sight_blockers(runtime, caster, target_cell)))
    return Object.freeze({ ok: false, code: 'no_line_of_sight' })
  const occupant = visible_occupant(runtime, caster, target_cell)
  if (level.casts_per_turn > 0n && casts_this_turn(runtime, name) >= level.casts_per_turn)
    return Object.freeze({ ok: false, code: 'cast_cap' })
  const ledger_target = occupant ?? NO_TARGET
  if (
    level.casts_per_target > 0n &&
    occupant !== null &&
    casts_this_turn(runtime, name, ledger_target) >= level.casts_per_target
  )
    return Object.freeze({ ok: false, code: 'target_cap' })
  if (level.cooldown_turns > 0n && cooldown_left(runtime, caster, name) > 0n)
    return Object.freeze({ ok: false, code: 'cooldown' })
  const { critical, rows } = spell_turn_rows(runtime, caster, name, level)
  const { placements } = split_placements(rows)
  if (placements.length > 0 && !placement_anchor_available(runtime, placements, target_cell))
    return Object.freeze({ ok: false, code: 'bad_target_cell' })
  return Object.freeze({ ok: true, sheet, occupant, critical, rows })
}

export type SpellCellProjection = Readonly<{
  range: readonly bigint[]
  targetable: readonly bigint[]
}>

export const spell_target_cells = (runtime: FightReadState, caster: bigint, name: string): SpellCellProjection => {
  const fighter = runtime.contract.fighters[Number(caster)]
  if (!fighter || fighter.kind.type !== 'player')
    return Object.freeze({ range: Object.freeze([]), targetable: Object.freeze([]) })
  const level = spell_level_of(runtime, caster, name)
  if (!level) return Object.freeze({ range: Object.freeze([]), targetable: Object.freeze([]) })
  const range_bonus = level.modifiable_range ? sheet_of(runtime, caster).range_bonus : 0n
  const range = Array.from({ length: Number(GRID_CELLS) }, (_, index) => BigInt(index)).filter((cell) => {
    const distance = manhattan(fighter.cell, cell)
    return (
      legal_cell(runtime, cell) &&
      distance >= level.range_min &&
      distance <= level.range_max + range_bonus &&
      (!level.line_launch || same_line(fighter.cell, cell))
    )
  })
  return Object.freeze({
    range: Object.freeze(range),
    targetable: Object.freeze(
      range.filter((target_cell) => cast_legality({ runtime, caster, level, name, target_cell }).ok)
    ),
  })
}

export const resolve_spell = ({
  runtime,
  caster,
  level,
  name,
  target_cell,
  cast_level,
  weapon = false,
}: {
  runtime: FightRuntime
  caster: bigint
  level: SpellLevel
  name: string
  target_cell: bigint
  cast_level: bigint
  weapon?: boolean
}): FightRuntime => {
  const legality = cast_legality({ runtime, caster, level, name, target_cell })
  if (!legality.ok) return fail(runtime, legality.code)
  const { critical, occupant, rows, sheet } = legality
  const caster_cell = runtime.contract.fighters[Number(caster)].cell
  const split = split_placements(rows)
  const ledger_target = occupant ?? NO_TARGET
  const slot = runtime.contract.turn_slot

  spend_ap(runtime, caster, level.ap_cost, 'cast_cost', caster)
  runtime.contract.turn_slot += 1n
  runtime.contract.turn_casts.push({ spell: name, target: ledger_target })
  if (level.cooldown_turns > 0n) set_cooldown(runtime, caster, name, level.cooldown_turns)
  emit(runtime, 'spell_cast', {
    caster,
    spell: name,
    cast_level,
    target_cell,
    slot,
    ap_cost: level.ap_cost,
    critical,
    weapon,
  })
  if (has_offensive(rows)) drop_invisibility(runtime, caster, 'offensive_cast')
  if (split.placements.length > 0) {
    split.placements.forEach((row) => {
      const zone = {
        owner_fighter: caster,
        trap: row.kind === KINDS.trap,
        shape: row.area_shape,
        size: row.area_size,
        anchor: target_cell,
        turns_left: row.kind === KINDS.glyph ? row.turns : 0n,
        effects: split.payload,
      }
      runtime.contract.zones.push(zone)
      const id = add_zone_id(runtime)
      emit(runtime, row.kind === KINDS.trap ? 'trap_placed' : 'glyph_placed', {
        zone_id: id,
        owner: caster,
        anchor: target_cell,
        shape: row.area_shape,
        size: row.area_size,
        ...(row.kind === KINDS.trap ? { visibility: 'owner' } : { turns: row.turns }),
      })
    })
    return runtime
  }
  resolve_rows({
    runtime,
    caster,
    sheet,
    rows,
    anchor: target_cell,
    origin: caster_cell,
    cursor: { state: effect_seed(runtime.contract.turn_seed, slot) },
    critical,
    cast_level,
    cause: weapon ? 'weapon' : 'spell',
  })
  return runtime
}
