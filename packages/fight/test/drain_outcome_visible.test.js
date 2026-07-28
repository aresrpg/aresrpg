// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// A FULLY-DODGED DRAIN REACHES THE PLAYER — the wire half of #1168.
//
// The presentation half already landed: `produce_receipt_render_turns` splits a `Drain` row into the two counts
// the presenter speaks (`landed` / `dodged`), and `emit_drain_lines` states each half as its own combat-log
// line. But that whole path starts at a `Drain` row, and `sim_chain_events` used to emit none when the contest
// ate EVERY point: `POINT_DODGED` sat in `INERT_STATUSES` — the set for statuses the chain also never emits —
// while `cast.move:1832` emits `Drain{ removed: 0, requested: n }` on exactly that path (`emit_drain` sits
// AFTER the `if (removed > 0)` block, not inside it). So one contest was fully narrated when it ate 1 of 2
// points and completely silent when it ate both, which is the reading a player cannot tell from "this mechanic
// does nothing". The simulator's receipt is the client's only read; a dropped row is a fact it can never learn.

import { describe, expect, test } from 'bun:test'

import * as SE from '../../sim/src/spell_effect.js'
import { produce_receipt_render_turns } from '../src/fight_render_events.js'
import { encode } from '../src/los.js'
import { commands_from_staged, create_sim_chain, current_actor, submit_commands } from '../src/sim_chain.js'

const level = (effects) => ({
  ap_cost: 2,
  range_min: 0,
  range_max: 14,
  modifiable_range: false,
  line_launch: false,
  line_of_sight: false,
  free_cell: false,
  casts_per_turn: 255,
  casts_per_target: 255,
  cooldown_turns: 0,
  crit_rate: 0,
  effects: effects.map((effect) => ({ chance: 100, ...effect })),
  crit_effects: [],
})

/** A DODGEABLE 2-MP drain (`FLAG_DODGE` = the 1.29 contested class) and its guaranteed twin. */
const KIT = [
  {
    id: 'u_mp_drain_dodgeable',
    levels: [
      level([
        {
          kind: SE.K_REMOVE_POINTS,
          stat: SE.POINT_MP,
          value: 2,
          turns: 1,
          target_filter: SE.TF_NOT_TEAM,
          flags: SE.FLAG_DODGE,
        },
      ]),
    ],
  },
  {
    id: 'u_mp_drain_sure',
    levels: [
      level([
        {
          kind: SE.K_REMOVE_POINTS,
          stat: SE.POINT_MP,
          value: 2,
          turns: 1,
          target_filter: SE.TF_NOT_TEAM,
        },
      ]),
    ],
  },
]

const MOB_KIT = [
  {
    id: 'm_hit',
    levels: [
      level([
        {
          kind: SE.K_DAMAGE,
          element: 0,
          value: 5,
          target_filter: SE.TF_NOT_TEAM,
        },
      ]),
    ],
  },
]

const fighter = (id, cell, is_player, deck) => ({
  id,
  name: id,
  cell,
  health: 200,
  health_max: 200,
  ap: 12,
  ap_max: 12,
  mp: 6,
  mp_max: 6,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'senshi' : '0xmob_template',
  level: 20,
  stats: {},
  effects: [],
  spell_levels: Object.fromEntries(deck.map((spell) => [spell, 1])),
  ap_reserve: 0,
})

const MOB = { x: 4, y: 0 }

/** Cast `spell_id` at the mob on arena `seed`; hand back the receipt this turn produced. The mob's pool is
 *  deliberately NOT read back — `submit_commands` closes the turn, so the mob's own `begin_turn` refill has
 *  already run by the time the chain returns. The RECEIPT is the client's read, and it is the subject. */
const cast_once = (spell_id, seed) => {
  const chain = create_sim_chain({
    seed,
    fight_id: 'drain:1',
    group_template: '0xgroup',
    templates_raw: [...KIT, ...MOB_KIT],
    team0: [
      fighter(
        'p0',
        { x: 0, y: 0 },
        true,
        KIT.map((spell) => spell.id)
      ),
    ],
    team1: [fighter('mob_0', MOB, false, ['m_hit'])],
  })
  expect(current_actor(chain)).toBe('p0')
  const out = submit_commands(
    chain,
    commands_from_staged([{ kind: 1, target: encode(MOB.x, MOB.y), spell_template_id: spell_id }], 'p0'),
    { now_ms: 1_784_752_468_344 }
  )
  return {
    events: out.receipt.events,
    drains: out.receipt.events.filter((row) => row.type.endsWith('::Drain')).map((row) => row.parsedJson),
  }
}

// Seeds measured through `cast_once` itself: on 0x11 the mob wins the contest outright, on 0x41 it wins one of
// the two rolls (the partial that always spoke). The guaranteed spell lands on every seed.
const DODGE_SEED = 0x11
const PARTIAL_SEED = 0x41
const LAND_SEED = 0x21

const drain_beats_of = (events) =>
  produce_receipt_render_turns(events, { fight_id: 'drain:1' })
    .turns.flatMap((turn) => turn.beats ?? turn.events ?? [])
    .filter((beat) => beat.kind === 'status' && beat.payload?.status === 'DRAIN')

describe('the simulator states a drain the way the chain states it — dodge included', () => {
  test('a FULLY-DODGED drain emits Drain{ removed: 0, requested: 2 } (cast.move:1832 emits unconditionally)', () => {
    const { drains } = cast_once('u_mp_drain_dodgeable', DODGE_SEED)
    expect(drains).toHaveLength(1) // the wire says "nothing moved" rather than saying nothing at all
    expect(drains[0].point_kind).toBe(1)
    expect(Number(drains[0].removed)).toBe(0)
    expect(Number(drains[0].requested)).toBe(2)
  })

  test('landed and partial drains keep stating removed AND requested', () => {
    const landed = cast_once('u_mp_drain_sure', LAND_SEED).drains
    expect(landed).toHaveLength(1)
    expect(Number(landed[0].removed)).toBe(2)
    expect(Number(landed[0].requested)).toBe(2)
    const partial = cast_once('u_mp_drain_dodgeable', PARTIAL_SEED).drains
    expect(partial).toHaveLength(1)
    expect(Number(partial[0].removed)).toBe(1)
    expect(Number(partial[0].requested)).toBe(2)
  })
})

describe('every drain ending reaches the presenter as one DRAIN beat', () => {
  test('a full dodge presents landed 0 / dodged 2 — the outcome the player could not see', () => {
    const beats = drain_beats_of(cast_once('u_mp_drain_dodgeable', DODGE_SEED).events)
    expect(beats).toHaveLength(1)
    expect(beats[0].payload.pool).toBe('mp')
    expect(beats[0].payload.landed).toBe(0)
    expect(beats[0].payload.dodged).toBe(2)
  })

  test('a landed drain presents landed 2 / dodged 0, a partial one splits the counts', () => {
    const full = drain_beats_of(cast_once('u_mp_drain_sure', LAND_SEED).events)
    expect(full).toHaveLength(1)
    expect(full[0].payload.landed).toBe(2)
    expect(full[0].payload.dodged).toBe(0)
    const partial = drain_beats_of(cast_once('u_mp_drain_dodgeable', PARTIAL_SEED).events)
    expect(partial).toHaveLength(1)
    expect(partial[0].payload.landed).toBe(1)
    expect(partial[0].payload.dodged).toBe(1)
  })
})
