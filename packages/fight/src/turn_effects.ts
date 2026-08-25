// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable no-param-reassign -- The Move twin updates only its reducer-owned structuredClone draft; caller snapshots stay immutable. */

import { KINDS, STATS, add_ap, add_mp, heal_seat, hit, spend_ap, spend_mp } from './fighters.ts'
import { effect_id_at, emit } from './runtime.ts'
import { fire_glyphs_under, tick_board_zones } from './zones.ts'
import { resolve_rows } from './effects.ts'
import type { ActiveEffect, FightRuntime } from './types.ts'

export const apply_pool_effects = (runtime: FightRuntime, fighter: bigint): void => {
  const rows = [...runtime.contract.fighters[Number(fighter)].effects]
  rows.forEach((row) => {
    if (row.kind === KINDS.add) {
      if (row.stat === STATS.ap) add_ap(runtime, fighter, row.value, 'timed_pool', row.source)
      else if (row.stat === STATS.mp) add_mp(runtime, fighter, row.value, 'timed_pool', row.source)
    } else if (row.kind === KINDS.remove || row.kind === KINDS.steal) {
      if (row.stat === STATS.ap) spend_ap(runtime, fighter, row.value, 'timed_pool', row.source)
      else if (row.stat === STATS.mp) spend_mp(runtime, fighter, row.value, 'timed_pool', row.source)
    }
  })
}

export const tick_turn_start = (runtime: FightRuntime, fighter: bigint): void => {
  const target = runtime.contract.fighters[Number(fighter)]
  const rows = [...target.effects]
  rows.forEach((row) => {
    if (row.stat === STATS.hp && (row.kind === KINDS.remove || row.kind === KINDS.steal)) {
      hit(runtime, {
        target: fighter,
        amount: row.value,
        source: row.source,
        cause: 'damage_over_time',
        element: row.element,
      })
    }
    if (row.stat === STATS.hp && row.kind === KINDS.add) {
      heal_seat(runtime, {
        target: fighter,
        amount: row.value,
        source: row.source,
        cause: 'regeneration',
      })
    }
  })
  if (!runtime.contract.ended) fire_glyphs_under(runtime, fighter, resolve_rows)
  tick_board_zones(runtime, fighter)
}

/** Duration includes the current turn. A row cast during this turn steps from 2 → 1 when the
 * turn closes, remains active through the next turn, then expires at that turn's close. */
export const tick_turn_end = (runtime: FightRuntime, fighter: bigint): void => {
  const target = runtime.contract.fighters[Number(fighter)]
  const rows = [...target.effects]
  const row_ids = [...runtime.render_ids.effects[Number(fighter)]]
  const kept: ActiveEffect[] = []
  const kept_ids: string[] = []
  rows.forEach((row, index) => {
    const turns_left = row.turns_left > 0n ? row.turns_left - 1n : 0n
    if (turns_left > 0n) {
      kept.push({ ...row, turns_left })
      kept_ids.push(row_ids[index])
      return
    }
    emit(runtime, 'effect_expired', {
      target: fighter,
      effect_id: effect_id_at(runtime, fighter, index),
      kind: row.kind,
      channel: row.stat,
    })
    if (row.kind === KINDS.invis)
      emit(runtime, 'invisibility_changed', { fighter, invisible: false, reason: 'expired' })
  })
  target.effects = kept
  runtime.render_ids.effects[Number(fighter)] = kept_ids
}

export const tick_cooldowns = (runtime: FightRuntime, fighter: bigint): void => {
  runtime.contract.fighters[Number(fighter)].cooldowns = runtime.contract.fighters[Number(fighter)].cooldowns.map(
    (row) => {
      if (row.left === 0n) return row
      const next = { ...row, left: row.left - 1n }
      emit(runtime, 'cooldown_changed', {
        fighter,
        spell: row.spell,
        before: row.left,
        after: next.left,
        reason: 'turn_end',
      })
      return next
    }
  )
}
