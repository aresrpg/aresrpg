// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable no-param-reassign -- The Move twin updates only its reducer-owned structuredClone draft; caller snapshots stay immutable. */

import {
  GRID_CELLS,
  approach_field,
  bfs_cast_cell,
  in_zone,
  line_of_sight,
  manhattan,
  same_line,
} from './combat_grid.ts'
import { KINDS, STATS, base_ap_of, base_mp_of, is_mob, max_hp_of, mob_snapshot, set_pools } from './fighters.ts'
import { placement_rows_castable, resolve_rows, resolve_spell, sight_blockers } from './effects.ts'
import { walk_down, walk_toward, wall_mask } from './movement.ts'
import { emit, fail } from './runtime.ts'
import { apply_pool_effects, tick_cooldowns, tick_turn_end, tick_turn_start } from './turn_effects.ts'
import { on_enter } from './zones.ts'
import { CONTRACT_CONSTANTS, TARGET_FILTERS } from './move_contract.gen.ts'
import type {
  FightContract,
  FightRuntime,
  KitSpell,
  MobFighter,
  MobTurnObserver,
  SeedProvider,
  SpellLevel,
} from './types.ts'

export const weave = (contract: FightContract): bigint[] => {
  const side_a = contract.fighters
    .map((_, index) => BigInt(index))
    .filter((seat) => contract.fighters[Number(seat)].team === 0n)
  const side_b = contract.fighters
    .map((_, index) => BigInt(index))
    .filter((seat) => contract.fighters[Number(seat)].team === 1n)
  const output: bigint[] = []
  let a = 0n
  let b = 0n
  const length_a = BigInt(side_a.length)
  const length_b = BigInt(side_b.length)
  while (a < length_a || b < length_b) {
    const take_a = a >= length_a ? false : b >= length_b || (length_a - a) * length_b >= (length_b - b) * length_a
    if (take_a) {
      output.push(side_a[Number(a)])
      a += 1n
    } else {
      output.push(side_b[Number(b)])
      b += 1n
    }
  }
  return output
}

const is_invisible = (runtime: FightRuntime, seat: bigint): boolean =>
  runtime.contract.fighters[Number(seat)].effects.some((row) => row.kind === KINDS.invis)

const nearest_enemy = (runtime: FightRuntime, mob: bigint): bigint | null => {
  const fighter = runtime.contract.fighters[Number(mob)]
  return (
    runtime.contract.fighters.reduce<{ seat: bigint; distance: bigint } | null>((best, candidate, index) => {
      const seat = BigInt(index)
      if (candidate.dead || candidate.team === fighter.team || is_invisible(runtime, seat)) return best
      const distance = manhattan(candidate.cell, fighter.cell)
      return best === null || distance < best.distance ? { seat, distance } : best
    }, null)?.seat ?? null
  )
}

const wounded_ally = (runtime: FightRuntime, mob: bigint): bigint | null => {
  const { team } = runtime.contract.fighters[Number(mob)]
  return (
    runtime.contract.fighters.reduce<{ seat: bigint; missing: bigint } | null>((best, fighter, index) => {
      const seat = BigInt(index)
      if (fighter.dead || fighter.team !== team) return best
      const missing = max_hp_of(runtime, seat) - fighter.hp
      return missing > (best?.missing ?? 0n) ? { seat, missing } : best
    }, null)?.seat ?? null
  )
}

const nearest_ally = (runtime: FightRuntime, mob: bigint): bigint => {
  const fighter = runtime.contract.fighters[Number(mob)]
  return (
    runtime.contract.fighters.reduce<{ seat: bigint; distance: bigint } | null>((best, candidate, index) => {
      const seat = BigInt(index)
      if (seat === mob || candidate.dead || candidate.team !== fighter.team) return best
      const distance = manhattan(candidate.cell, fighter.cell)
      return best === null || distance < best.distance ? { seat, distance } : best
    }, null)?.seat ?? mob
  )
}

const has_heal = (level: SpellLevel): boolean =>
  level.effects.some((row) => row.kind === KINDS.add && row.stat === STATS.hp)

const spell_rows = (level: SpellLevel) => [...level.effects, ...level.crit_effects]
const aims_only_at_allies = (level: SpellLevel): boolean => {
  const rows = spell_rows(level)
  return (
    rows.length > 0 &&
    rows.every(
      ({ target_filter }) => target_filter === TARGET_FILTERS.not_enemy || target_filter === TARGET_FILTERS.only_caster
    )
  )
}
const aims_only_at_caster = (level: SpellLevel): boolean => {
  const rows = spell_rows(level)
  return rows.length > 0 && rows.every(({ target_filter }) => target_filter === TARGET_FILTERS.only_caster)
}

const placement_level_castable = (runtime: FightRuntime, level: SpellLevel, anchor: bigint): boolean =>
  placement_rows_castable(runtime, level.effects, anchor) &&
  (level.crit_effects.length === 0 || placement_rows_castable(runtime, level.crit_effects, anchor))

const mob_castable = (runtime: FightRuntime, mob: bigint, level: SpellLevel, from: bigint, anchor: bigint): boolean => {
  const distance = manhattan(from, anchor)
  if (distance < level.range_min || distance > level.range_max) return false
  if (level.line_launch && !same_line(from, anchor)) return false
  return !level.line_of_sight || line_of_sight(from, anchor, sight_blockers(runtime, mob, anchor))
}

const cooldown_left = (runtime: FightRuntime, mob: bigint, spell: string): bigint =>
  runtime.contract.fighters[Number(mob)].cooldowns.find((row) => row.spell === spell)?.left ?? 0n

const enter = (runtime: FightRuntime, fighter: bigint, from: bigint): boolean =>
  on_enter(runtime, fighter, from, resolve_rows)

const rush_toward = (runtime: FightRuntime, mob: bigint, target: bigint): FightRuntime => {
  // ONE approach flood from the target's open flanks, walked down as far as MP allows — a
  // detour routes by construction (the frog law). A sealed target leaves the field
  // unreached at the mob's cell — the one legal hold. Twin of aresrpg::fight `rt`.
  const fighter = runtime.contract.fighters[Number(mob)]
  const field = approach_field(target, wall_mask(runtime, mob), fighter.cell)
  if (field[Number(fighter.cell)] === GRID_CELLS) return runtime
  return walk_down(runtime, mob, field, enter)
}

export const mob_turn = (runtime: FightRuntime, mob: bigint): FightRuntime => {
  const enemy = nearest_enemy(runtime, mob)
  if (enemy === null) {
    const fighter = runtime.contract.fighters[Number(mob)]
    const starts = fighter.team === 0n ? runtime.contract.board.start_cells_a : runtime.contract.board.start_cells_b
    const [anchor] = starts
    return anchor === undefined ? runtime : rush_toward(runtime, mob, anchor)
  }
  const { kit } = mob_snapshot(runtime.contract.fighters[Number(mob)] as MobFighter)
  for (const spell of kit as KitSpell[]) {
    const heal = has_heal(spell.level)
    const caster_only = aims_only_at_caster(spell.level)
    const ally_only = aims_only_at_allies(spell.level)
    const anchor_seat = caster_only
      ? mob
      : heal
        ? wounded_ally(runtime, mob)
        : ally_only && spell.level.range_max === 0n
          ? mob
          : ally_only
            ? nearest_ally(runtime, mob)
            : enemy
    const fighter = runtime.contract.fighters[Number(mob)]
    if (anchor_seat === null || fighter.ap < spell.level.ap_cost || cooldown_left(runtime, mob, spell.name) > 0n)
      continue
    const anchor = runtime.contract.fighters[Number(anchor_seat)].cell
    if (!placement_level_castable(runtime, spell.level, anchor)) continue
    if (mob_castable(runtime, mob, spell.level, fighter.cell, anchor)) {
      resolve_spell({
        runtime,
        caster: mob,
        level: spell.level,
        name: spell.name,
        target_cell: anchor,
        cast_level: spell.ordinal,
      })
      return runtime
    }
    // provably unreachable this turn (triangle inequality) — skip the flood entirely
    if (!heal && !caster_only && manhattan(fighter.cell, anchor) <= fighter.mp + spell.level.range_max) {
      const cast_cell = bfs_cast_cell({
        start: fighter.cell,
        target: anchor,
        wall_mask: wall_mask(runtime, mob),
        budget: fighter.mp,
        range_min: spell.level.range_min,
        range_max: spell.level.range_max,
        needs_los: spell.level.line_of_sight,
        obstacles: sight_blockers(runtime, mob, anchor),
      })
      if (cast_cell !== null) {
        walk_toward(runtime, mob, cast_cell, enter)
        if (runtime.contract.ended || runtime.contract.fighters[Number(mob)].dead) return runtime
        const landed = runtime.contract.fighters[Number(mob)].cell
        const aim = runtime.contract.fighters[Number(anchor_seat)].cell
        if (
          placement_level_castable(runtime, spell.level, aim) &&
          mob_castable(runtime, mob, spell.level, landed, aim) &&
          runtime.contract.fighters[Number(mob)].ap >= spell.level.ap_cost
        )
          resolve_spell({
            runtime,
            caster: mob,
            level: spell.level,
            name: spell.name,
            target_cell: aim,
            cast_level: spell.ordinal,
          })
        return runtime
      }
    }
  }
  return rush_toward(runtime, mob, runtime.contract.fighters[Number(enemy)].cell)
}

const random_turn_start = (runtime: FightRuntime, actor: bigint): boolean => {
  const { cell } = runtime.contract.fighters[Number(actor)]
  return runtime.contract.zones.some(
    (zone) =>
      !zone.trap &&
      in_zone(zone.shape, zone.size, zone.anchor, cell) &&
      zone.effects.some((row) => row.chance_bp < 10_000n || row.value_max > row.value)
  )
}

export const run_until_player = ({
  runtime,
  seed_for,
  on_mob_turn = null,
  now,
  opening,
  reason,
}: {
  runtime: FightRuntime
  seed_for: SeedProvider
  on_mob_turn?: MobTurnObserver | null
  now: bigint
  opening: boolean
  reason: string
}): FightRuntime => {
  const length = BigInt(runtime.contract.queue.length)
  let virtual_ms = now
  let examine_current = opening
  let hops = 0n
  let from = opening ? null : runtime.contract.queue[Number(runtime.contract.turn_ptr)]
  let skipped: bigint[] = []
  while (hops <= 2n * length) {
    if (!examine_current) {
      const pointer = (runtime.contract.turn_ptr + 1n) % length
      if (pointer === 0n) runtime.contract.round += 1n
      runtime.contract.turn_ptr = pointer
    }
    examine_current = false
    const actor = runtime.contract.queue[Number(runtime.contract.turn_ptr)]
    const fighter = runtime.contract.fighters[Number(actor)]
    if (fighter.dead) {
      skipped = [...skipped, actor]
      hops += 1n
      continue
    }
    const supplied = seed_for(actor, is_mob(fighter))
    if (!supplied && random_turn_start(runtime, actor))
      return fail(runtime, 'missing_turn_seed_witness', { seat: actor, phase: 'turn_start' })
    runtime.contract.turn_seed = supplied?.seed ?? 0n
    runtime.contract.turn_slot = 0n
    runtime.contract.turn_casts = []
    emit(runtime, 'turn_switched', { from, to: actor, round: runtime.contract.round, skipped, reason })
    skipped = []
    set_pools(runtime, actor, base_ap_of(runtime, actor), base_mp_of(runtime, actor), 'turn_refill', actor)
    apply_pool_effects(runtime, actor)
    tick_turn_start(runtime, actor)
    if (runtime.contract.ended) return runtime
    if (!runtime.contract.fighters[Number(actor)].dead) {
      if (!is_mob(runtime.contract.fighters[Number(actor)])) {
        if (!supplied) return fail(runtime, 'missing_player_turn_seed', { seat: actor })
        runtime.contract.turn_started_ms = virtual_ms
        return runtime
      }
      if (!supplied?.witnessed) return fail(runtime, 'missing_mob_turn_witness', { seat: actor, phase: 'mob_action' })
      if (on_mob_turn) on_mob_turn(actor, supplied.seed)
      mob_turn(runtime, actor)
      if (runtime.contract.ended) return runtime
      tick_turn_end(runtime, actor)
      tick_cooldowns(runtime, actor)
      virtual_ms += CONTRACT_CONSTANTS.turn_min_ms
    }
    from = actor
    hops += 1n
  }
  return runtime
}
