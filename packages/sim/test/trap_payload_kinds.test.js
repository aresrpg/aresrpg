// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// trap_payload_kinds.test.js — THE TRAP PAYLOAD COVERAGE GATE (#954).
//
// A trap detonation routes its payload through `apply_payload`. That sink modelled DAMAGE / POISON / STEAL and
// PUSH / PULL and SILENTLY SKIPPED everything else — so a live trap whose payload is an MP drain fired,
// consumed itself, and did NOTHING. Two of the seven shipped yajin traps (`yajin_snaptrap`, `yajin_mute_snare`)
// are exactly that shape, which is the "zero damage on any trigger" #954 reports, mob-step and self-step alike.
//
// THE SPEC IS THE CHAIN: `cast.move` `apply_board_batch_from` (the trap-payload twin, cast.move:1625-1694)
// resolves damage / dot / life_steal, percent_life_damage, heal, give_points, remove_points / steal_points,
// alter_stat / alter_resist, forced_death and stance — with a ZERO caster block and NO dodge contest on the
// pool rows (it calls `participant::remove_points` flat). This pins the sim to that set.

import { describe, expect, test } from 'bun:test'

import { check_traps, place_trap } from '../src/fight_traps.js'
import { create_fight_state } from '../src/reduce.js'

const arena = {
  width: 16,
  height: 11,
  radius: 8,
  center: { x: 8, y: 5 },
  cells: new Uint8Array(16 * 11),
  spawns_a: [{ x: 0, y: 0 }],
  spawns_b: [{ x: 8, y: 0 }],
}

const fighter = (id, cell, is_player) => ({
  id,
  name: id,
  cell,
  health: 200,
  health_max: 200,
  ap: 10,
  ap_max: 10,
  mp: 6,
  mp_max: 6,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'senshi' : '0xmob',
  level: 20,
  stats: {},
  effects: [],
  spell_levels: {},
  ap_reserve: 0,
})

/** A started state with a placer at (0,0) and a victim at (3,0) about to step onto (2,0). */
const staged = payload => {
  const base = create_fight_state({
    fight_id: 'traps:1',
    arena_seed: 7,
    arena_radius: arena.radius,
    arena,
    team0: [fighter('p0', { x: 0, y: 0 }, true)],
    team1: [fighter('mob_0', { x: 3, y: 0 }, false)],
  })
  return place_trap(base, 'p0', [{ x: 2, y: 0 }], payload, { x: 2, y: 0 })
}

const step_on = (state, entity_id) =>
  check_traps(state, { x: 2, y: 0 }, entity_id)
const mob_of = state => state.team1.find(e => e.id === 'mob_0')

describe('trap payload · the sink resolves the kinds the chain resolves (#954)', () => {
  test('a DAMAGE payload still detonates (the control)', () => {
    const out = step_on(
      staged([{ type: 'DAMAGE', element: 'EARTH', min: 12, max: 12 }]),
      'mob_0',
    )
    expect(out.triggered).toBe(true)
    expect(mob_of(out.state).health).toBeLessThan(200)
    expect(out.effects.some(e => e.damage > 0)).toBe(true)
  })

  test('an MP-DRAIN payload drains the pool — cast.move:1681 participant::remove_points', () => {
    // `yajin_snaptrap` / `yajin_mute_snare` shape: the trap's whole payload is a remove_points row.
    const out = step_on(
      staged([
        { type: 'REMOVE', kind: 7, stat: 'mp', value: 4, min: 4, max: 4 },
      ]),
      'mob_0',
    )
    expect(out.triggered).toBe(true)
    expect(mob_of(out.state).mp).toBe(2) // 6 − 4
    expect(
      out.effects.some(e => e.status === 'STAT_DEBUFF' && e.stat === 'mp'),
    ).toBe(true)
  })

  test('an AP-GRANT payload feeds the pool — cast.move:1679 participant::give_points', () => {
    const out = step_on(
      staged([{ type: 'ADD', kind: 6, stat: 'ap', value: 2, min: 2, max: 2 }]),
      'mob_0',
    )
    expect(mob_of(out.state).ap).toBe(12) // 10 + 2
    expect(
      out.effects.some(e => e.status === 'STAT_BUFF' && e.stat === 'ap'),
    ).toBe(true)
  })

  test('a HEAL payload heals flat — cast.move:1677 participant::apply_heal (zero-caster law)', () => {
    const hurt = staged([{ type: 'HEAL', min: 15, max: 15 }])
    const wounded = { ...hurt, team1: [{ ...mob_of(hurt), health: 100 }] }
    const out = step_on(wounded, 'mob_0')
    expect(mob_of(out.state).health).toBe(115)
    expect(out.effects.some(e => e.heal > 0)).toBe(true)
  })

  test('a timed STAT-ALTER payload lands a row — cast.move:1684 apply_alter + record_timed', () => {
    const out = step_on(
      staged([
        {
          type: 'REMOVE',
          kind: 9,
          stat: 'agility',
          value: 30,
          min: 30,
          max: 30,
          turns: 2,
        },
      ]),
      'mob_0',
    )
    expect(
      mob_of(out.state).effects.some(
        e => e.type === 'STAT_DEBUFF' && e.stat === 'agility',
      ),
    ).toBe(true)
  })

  test('the placer stepping on their OWN trap takes the payload too (entrant-blind, §5f#3)', () => {
    const out = step_on(
      staged([
        { type: 'REMOVE', kind: 7, stat: 'mp', value: 3, min: 3, max: 3 },
      ]),
      'p0',
    )
    expect(out.triggered).toBe(true)
    expect(out.state.team0.find(e => e.id === 'p0').mp).toBe(3) // 6 − 3
  })

  test('an unmodelled payload kind is LOUD, never a silent no-op', () => {
    const errors = []
    const original = console.error
    console.error = (...args) => errors.push(args.join(' '))
    try {
      step_on(staged([{ type: 'A_BRAND_NEW_MECHANIC' }]), 'mob_0')
    } finally {
      console.error = original
    }
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.join(' ')).toContain('A_BRAND_NEW_MECHANIC')
  })
})
