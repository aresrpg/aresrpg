// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE ROLL-RANGE LAW, gated as a CLASS (not three instances).
//
// `Effect.value_max` is a roll range for DAMAGE / LIFE_STEAL / CASTER_DAMAGE / PUNISHMENT_DAMAGE / HEAL /
// APPLY_DOT and NOTHING else — spell_effect.move:241 states it as the field's own contract ("Other kinds:
// == value, ignored"), and the engine implements exactly that: `cast.move:1223` binds `base = effect.value()`
// for "points / distance / stat / %-life (deterministic, never rolled)" and every stat / shield / points /
// critical-failure sink reads that scalar (`land_alter_player`, `give_points`, `record_timed`,
// `retro_effects.move:334/353/374`). The chain also records only FOUR entropy domains — RETURN, EFFECT_CHANCE,
// DAMAGE_INVERSION, DRAIN (`fight_events.move:291-294`) — so a rolled magnitude has no channel to be mirrored
// on a receipt at all.
//
// The sim rolled them anyway (`fight_stat_effects.js` alter sink, `fight_spells.js` shield sink,
// `fight_retro_effects.js` critical-failure sink). Because `rng_range` advances the stream even when
// min === max, EVERY such row burned one crank draw the chain never takes, so every LATER draw of the same
// cast/crank — the dodge-contested AP/MP drain above all — resolved off a stream position the chain never
// reaches. That is a mispredicted drain, and a drain is AP/MP, and AP/MP is damage.

import assert from 'node:assert/strict'
import test from 'node:test'

import { turn_rng_of } from '../src/combat_clock.js'
import {
  FLAG_DODGE,
  K_ALTER_RESIST,
  K_ALTER_STAT,
  K_APPLY_STATE,
  K_CRITICAL_FAILURE,
  K_GIVE_POINTS,
  K_POOL_SHIELD,
  K_REDUCE_DAMAGE,
  K_REFLECT_DAMAGE,
  K_REMOVE_POINTS,
  K_STEAL_POINTS,
  K_STEAL_STAT,
  POINT_MP,
  STAT_AGILITY,
  STAT_STRENGTH,
  TF_NONE,
} from '../src/spell_effect.js'

import {
  cast,
  fighter,
  raw_effect,
  spell_of,
  state_of,
} from './missing_effect_helpers.js'

/** The chain's centering for ALTER_STAT / ALTER_RESIST wire values (#904). */
const SIGNED_SHIFT = 32_768

const CASTER = { x: 2, y: 2 }
const TARGET = { x: 4, y: 2 }

const board = (target_stats = {}, seed = 1) =>
  state_of(
    [fighter('p0', CASTER, true, { stats: { wisdom: 60 } })],
    [fighter('m0', TARGET, false, { stats: target_stats })],
    seed,
  )

/** Cast ONE effect at the enemy and report how the shared combat thread moved. */
const entropy_of = (effects, state = board()) => {
  const before = turn_rng_of(state)
  const out = cast(state, 'p0', spell_of('s_probe', effects), TARGET)
  return { before, after: turn_rng_of(out.state), state: out.state }
}

/**
 * EVERY non-range chain kind that carries a magnitude, with the scalar the chain applies for it. A kind whose
 * chain path legitimately draws (a sub-100 proc chance, a dodgeable drain, a return roll) is not in this table:
 * those draws exist on both twins and are recorded on the receipt.
 */
const flat_kinds = [
  [
    'K_ALTER_STAT',
    K_ALTER_STAT,
    { value: SIGNED_SHIFT + 7, stat: STAT_AGILITY, turns: 3 },
  ],
  [
    'K_ALTER_RESIST',
    K_ALTER_RESIST,
    { value: SIGNED_SHIFT + 11, element: 2, turns: 3 },
  ],
  ['K_STEAL_STAT', K_STEAL_STAT, { value: 9, stat: STAT_AGILITY, turns: 3 }],
  ['K_GIVE_POINTS', K_GIVE_POINTS, { value: 2, stat: POINT_MP, turns: 1 }],
  ['K_REMOVE_POINTS', K_REMOVE_POINTS, { value: 2, stat: POINT_MP, turns: 1 }],
  ['K_STEAL_POINTS', K_STEAL_POINTS, { value: 2, stat: POINT_MP, turns: 1 }],
  ['K_REDUCE_DAMAGE', K_REDUCE_DAMAGE, { value: 30, turns: 3 }],
  ['K_POOL_SHIELD', K_POOL_SHIELD, { value: 30, turns: 3 }],
  ['K_CRITICAL_FAILURE', K_CRITICAL_FAILURE, { value: 4, turns: 3 }],
  ['K_REFLECT_DAMAGE', K_REFLECT_DAMAGE, { value: 12, turns: 3 }],
  ['K_APPLY_STATE', K_APPLY_STATE, { value: 5, turns: 3 }],
]

test('a non-range chain effect consumes NO combat entropy — the chain applies effect.value() flat', () => {
  const drawn = flat_kinds.filter(([, kind, overrides]) => {
    const { before, after } = entropy_of([
      raw_effect(kind, { ...overrides, chance: 100, target_filter: TF_NONE }),
    ])
    return before !== after
  })
  assert.deepEqual(
    drawn.map(([name]) => name),
    [],
    'these kinds advanced the sim combat thread; the chain draws nothing for them (cast.move:1223)',
  )
})

test('a buff in front of a drain does not move the drain — the chain has no magnitude draw to shift it', () => {
  // The consequence, stated in the money. Same seed, same fighters, same dodge contest; the only difference is
  // a leading stat buff on a stat the drain formula never reads (STRENGTH — the contest reads caster wisdom and
  // target agility + ap/mp_dodge). On chain that buff costs ZERO entropy, so the drain's first contest roll is
  // the crank's first draw either way and BOTH spells shave the same MP. In the sim the buff ate that draw, so
  // the drain rolled off the second: the four-point drain fully dodged and the client predicted an untouched
  // pool the chain had already shaved.
  const state = board({ agility: 40 }, 6)
  const drain = raw_effect(K_REMOVE_POINTS, {
    value: 4,
    stat: POINT_MP,
    turns: 2,
    flags: FLAG_DODGE,
    chance: 100,
    target_filter: TF_NONE,
  })
  const buff = raw_effect(K_ALTER_STAT, {
    value: SIGNED_SHIFT + 5,
    stat: STAT_STRENGTH,
    turns: 3,
    chance: 100,
    target_filter: TF_NONE,
  })
  const mp_after = effects => {
    const { state: out } = entropy_of(effects, state)
    return out.team1.find(entity => entity.id === 'm0').mp
  }
  assert.equal(
    mp_after([drain]),
    5,
    'the drain-alone baseline moved — fixture drifted',
  )
  assert.equal(
    mp_after([buff, drain]),
    5,
    'the leading buff shifted the drain contest — a crank draw the chain never takes',
  )
})
