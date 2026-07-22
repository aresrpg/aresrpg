// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure adapters over the fold's per-fighter status home. The HUD keeps the raw chain ints; mechanics consumers
// normalize only the rows they understand into the deterministic sim vocabulary.

import { effective_stats } from '@aresrpg/sim/fight_state'

const K_ALTER_STAT = 9
const K_INVISIBILITY = 27
const STAT_RANGE = 6
const FLAG_NEGATIVE = 8

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
    if (kind === K_ALTER_STAT && Number(row.stat) === STAT_RANGE)
      effects.push({
        id: row.id ?? `range:${index}`,
        type: (Number(row.flags) & FLAG_NEGATIVE) === FLAG_NEGATIVE ? 'STAT_DEBUFF' : 'STAT_BUFF',
        timing: 'TURN_END',
        source_id: fighter?.id ?? null,
        stat: 'range',
        value: Number(row.value) || 0,
        turns_remaining: Number(row.remaining_turns) || 0,
      })
    else if (kind === K_INVISIBILITY)
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
