// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Timed stat and AP/MP-pool effects, including the live dodge contest. Explicit AP/MP dodge stats augment the
// defender's agility term; physical damage remains an ordinary timed stat consumed only by EARTH/NONE damage.

import { rng_range } from './prng.js'
import { add_effect } from './fight_actions.js'
import { effective_stats, next_id, update_entity } from './fight_state.js'
import {
  FLAG_DODGE,
  K_REMOVE_POINTS,
  K_STEAL_POINTS,
  K_STEAL_STAT,
} from './spell_effect.js'
import { remove_points } from './spell_formula.js'

/** Mint ONE timed stat row on `target_id`. Shared with the board-hazard sink (fight_traps.js) so a trap
 *  payload's alter row and a cast's alter row are the SAME row shape — one home for the fact. */
export const add_row = (
  state,
  target_id,
  caster_id,
  effect,
  value,
  force_type,
) => {
  const allocated = next_id(state)
  return add_effect(allocated.state, target_id, {
    id: allocated.id,
    type: force_type ?? (effect.type === 'ADD' ? 'STAT_BUFF' : 'STAT_DEBUFF'),
    timing: 'TURN_START',
    source_id: caster_id,
    stat: effect.stat,
    value,
    turns_remaining: Math.max(1, effect.turns ?? 1),
  })
}

/** Apply ADD/REMOVE, returning handled=false for every other internal type. */
export const apply_stat_effect = (state, effect, caster, target) => {
  if (effect.type !== 'ADD' && effect.type !== 'REMOVE')
    return { handled: false, state, effects: [] }
  if (!effect.stat) return { handled: true, state, effects: [] }

  if (
    effect.type === 'REMOVE' &&
    (effect.kind === K_REMOVE_POINTS || effect.kind === K_STEAL_POINTS) &&
    (effect.stat === 'ap' || effect.stat === 'mp')
  ) {
    const requested = Math.max(0, Math.floor(effect.value ?? 0))
    const target_stats = effective_stats(target)
    const dodge_stat =
      effect.stat === 'ap' ? target_stats.ap_dodge : target_stats.mp_dodge
    const result = remove_points(
      state.rng,
      requested,
      ((effect.flags ?? 0) & FLAG_DODGE) !== 0,
      effective_stats(caster).wisdom ?? 0,
      (target_stats.agility ?? 0) + Math.max(0, dodge_stat ?? 0),
      target[effect.stat],
      effect.stat === 'ap' ? target.ap_max : target.mp_max,
    )
    const with_rng = { ...state, rng: result.state }
    // The chain stores debt only when something landed, but emits Drain for EVERY contested outcome — including
    // removed=0. Keep the durable-row guard and let the same STAT_DEBUFF wire row below carry both full and
    // partial dodges through the ordinary pool fold.
    const stored =
      result.removed > 0
        ? add_row(with_rng, target.id, caster.id, effect, result.removed)
        : with_rng
    const drained = update_entity(stored, target.id, entity => ({
      ...entity,
      [effect.stat]: Math.max(0, entity[effect.stat] - result.removed),
    }))
    // STEAL: feed the ACTUAL post-dodge removed count to the caster now (immediate-use, no credit row) —
    // mirrors give_caster_points (cast.move:585-586, 1056-1060); on-chain give_points does not cap at max.
    const after =
      effect.kind === K_STEAL_POINTS
        ? update_entity(drained, caster.id, entity => ({
            ...entity,
            [effect.stat]: entity[effect.stat] + result.removed,
          }))
        : drained
    return {
      handled: true,
      state: after,
      effects: [
        // `stat` + `requested` ride the row so a POOL drain can be stated on the wire as the chain states it
        // (cast.move:1796 `emit_drain(point_kind, removed, requested)`). A consumer that only knows statuses
        // still reads STAT_DEBUFF; one that folds pools reads the pool and the count. #952.
        {
          target_id: target.id,
          status: 'STAT_DEBUFF',
          stat: effect.stat,
          value: result.removed,
          requested,
        },
      ],
    }
  }

  if (effect.min === undefined || effect.max === undefined)
    return { handled: true, state, effects: [] }
  const draw = rng_range(state.rng, effect.min, effect.max)
  const with_rng = { ...state, rng: draw.state }
  const stored = add_row(with_rng, target.id, caster.id, effect, draw.value)
  const delta = effect.type === 'ADD' ? draw.value : -draw.value
  const after =
    effect.stat === 'ap' || effect.stat === 'mp'
      ? update_entity(stored, target.id, entity => ({
          ...entity,
          [effect.stat]: Math.max(0, entity[effect.stat] + delta),
        }))
      : stored
  // STEAL_STAT mirror leg: the debited `draw.value` ALSO lands on the CASTER as a same-stat, same-duration timed
  // STAT_BUFF — target LOSES it, caster GAINS it, both revert on expiry (spell_effect.move:33 declared intent; the
  // K_STEAL_POINTS twin feeds the caster the same way, immediate-pool there / timed-row here since stats are folded
  // by effective_stats and decayed by process_turn_effects, not a consumable pool). Chain arm rides the next train.
  const with_caster_gain =
    effect.kind === K_STEAL_STAT
      ? add_row(after, caster.id, caster.id, effect, draw.value, 'STAT_BUFF')
      : after
  return {
    handled: true,
    state: with_caster_gain,
    effects: [
      // The row STATES the stat it moved and by how much. An AP/MP row is a POOL move the chain performs
      // silently (cast.move:1098-1101 give_points) and the object read carries; the simulator has no object
      // read, so the receipt is the only channel and needs both facts to encode a Granted/Drain. #952.
      {
        target_id: target.id,
        status: effect.type === 'ADD' ? 'STAT_BUFF' : 'STAT_DEBUFF',
        stat: effect.stat,
        value: draw.value,
      },
      ...(effect.kind === K_STEAL_STAT
        ? [
            {
              target_id: caster.id,
              status: 'STAT_BUFF',
              stat: effect.stat,
              value: draw.value,
            },
          ]
        : []),
    ],
  }
}
