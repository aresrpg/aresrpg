// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2033 — A TRAP HAS NO OWNER IMMUNITY, IN EITHER TWIN.
//
// The chain rule is explicit (`cast::trigger_on_enter`, "no team check — a trap fires for anyone, §5f#3"): a
// trap detonates on whoever ENTERS its cell, its own caster included. The field report read as the sim
// carrying a self/team filter the chain lacks; driving it proved the opposite — `check_traps` and the reducer's
// walk have never had one, and the divergence was upstream, in the CLIENT's trap corpus (a trap the local
// ledger never held was rendered but never predicted, #1858's two-home split).
//
// This seals the trigger rule itself so no future "don't hurt the caster" kindness can be re-added quietly:
// the sim must predict the owner's own detonation exactly as the chain resolves it, on the direct door and
// through a real walk. `#320`'s ally case is covered in displacement_golden; this is the SELF case.

import { describe, expect, test } from 'bun:test'

import { check_traps } from '../src/fight_traps.js'
import { create_fight_state, reduce } from '../src/reduce.js'

const cell = x => ({ x, y: 1 })
const TRAP = cell(3)

const entity = (id, at, is_player) => ({
  id,
  name: id,
  cell: at,
  health: 100,
  health_max: 100,
  ap: 6,
  ap_max: 6,
  mp: 6,
  mp_max: 6,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'trap-owner',
  level: 1,
  stats: {},
  effects: [],
  spell_levels: {},
  ap_reserve: 0,
})

const arena = {
  width: 7,
  height: 3,
  radius: 0,
  center: { x: 3, y: 1 },
  cells: new Uint8Array(21),
  spawns_a: [],
  spawns_b: [],
}

const own_trap_state = () => {
  const state = create_fight_state({
    fight_id: 'trap-owner',
    arena_seed: 1,
    arena_radius: 0,
    arena,
    team0: [entity('owner', cell(1), true)],
    team1: [entity('mob', cell(6), false)],
  })
  return {
    ...state,
    started: true,
    turn_order: ['owner'],
    traps: [
      {
        id: 1,
        source_id: 'owner', // the walker IS the placer
        anchor: TRAP,
        cells: [TRAP],
        payload: [{ type: 'DAMAGE', element: 'fire', min: 30, max: 30 }],
      },
    ],
  }
}

const health_of = (state, id) =>
  [...(state.team0 ?? []), ...(state.team1 ?? [])].find(e => e.id === id)
    ?.health

describe('#2033 — a fighter detonates its OWN trap', () => {
  test('the direct on-enter door fires for the placer', () => {
    const fired = check_traps(own_trap_state(), TRAP, 'owner')
    expect(fired.triggered).toBe(true)
    expect(fired.state.traps).toEqual([]) // consumed, exactly as an enemy crossing would
    expect(health_of(fired.state, 'owner')).toBe(70)
  })

  test('a walk across it emits the trigger event and the damage — no self-exemption on the path', () => {
    const moved = reduce(
      own_trap_state(),
      { type: 'move', entity_id: 'owner', path: [cell(2), TRAP, cell(4)] },
      { arena, spell_templates: new Map() },
    )
    const triggers = moved.events.filter(
      event => event.type === 'fight_trap_triggered',
    )

    expect(triggers.map(event => event.cell)).toEqual([TRAP])
    expect(triggers[0].entity_id).toBe('owner')
    expect(health_of(moved.state, 'owner')).toBe(70)
    expect(moved.state.traps).toEqual([])
  })

  // The positive control on the negative claim above: the SAME fixture with the trap owned by the enemy behaves
  // identically. If ownership ever started mattering, this pair would split.
  test('ownership changes nothing — an enemy-owned trap on the same cell resolves the same', () => {
    const base = own_trap_state()
    const foreign = { ...base, traps: [{ ...base.traps[0], source_id: 'mob' }] }
    const fired = check_traps(foreign, TRAP, 'owner')

    expect(fired.triggered).toBe(true)
    expect(health_of(fired.state, 'owner')).toBe(70)
  })
})
