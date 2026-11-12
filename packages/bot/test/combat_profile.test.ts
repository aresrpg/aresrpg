// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { create_character_source, create_fight, spell_target_cells } from '@aresrpg/fight'

import spells from '../../../seed/content/spells.json'
import { create_fixture } from '../../fight/test/helpers.ts'
import { parse_combat_profile, validate_profile_character, type CombatProfile } from '../src/combat_profile.ts'
import { plan_combat_turn } from '../src/combat_tactics.ts'

const profile = (): CombatProfile => ({
  version: '1',
  intent: 'Strength: traps then retreat. Do not allocate capital.',
  combos: [
    {
      name: 'traps',
      steps: [
        { type: 'cast', spell: 'Tricky Trap', target: 'trap_near_enemy' },
        { type: 'cast', spell: 'Mass Trap', target: 'trap_near_enemy' },
      ],
    },
    { name: 'escape', steps: [{ type: 'move', direction: 'retreat' }] },
  ],
  rules: [
    { when: { type: 'always' }, combo: 'traps' },
    { when: { type: 'always' }, combo: 'escape' },
  ],
  fallback: 'end_turn',
})
const checkpoint = () => {
  const state = structuredClone(create_fixture().checkpoint)
  state.sources.players['0xc1'] = create_character_source({ classe: 'yajin', level: 30n, strength: 100n })
  state.sources.spells = Object.fromEntries(spells.map(({ name, ...spell }) => [name, spell])) as never
  state.contract.closed = state.contract.closed.map(() => 0n)
  state.contract.round = 1n
  state.contract.queue = [0n, 1n]
  state.contract.turn_ptr = 0n
  state.contract.turn_started_ms = 1_000n
  state.contract.fighters[0]!.cell = 105n
  state.contract.fighters[0]!.ap = 6n
  state.contract.fighters[0]!.mp = 3n
  state.contract.fighters[1]!.cell = 109n
  return create_fight({ state, mode: 'remote' }).state()
}

test('profile validation rejects arbitrary code, unknown spells and ambiguous combo references', () => {
  expect(parse_combat_profile(profile())).toEqual(profile())
  expect(() => parse_combat_profile({ ...profile(), script: 'run()' })).toThrow()
  expect(() => parse_combat_profile({ ...profile(), combos: [profile().combos[0], profile().combos[0]] })).toThrow(
    'duplicate_combo'
  )
  expect(() => parse_combat_profile({ ...profile(), rules: [{ when: { type: 'always' }, combo: 'missing' }] })).toThrow(
    'unknown_combo'
  )
  expect(() =>
    parse_combat_profile({
      ...profile(),
      combos: [{ name: 'x', steps: [{ type: 'cast', spell: 'invented', target: 'self' }] }],
    })
  ).toThrow('unknown_combat_spell')
  expect(validate_profile_character(profile(), { classe: 'yajin', level: 1, spells: {} })).toEqual(['Mass Trap'])
  expect(validate_profile_character(profile(), { classe: 'senshi', level: 200, spells: {} })).toEqual([
    'Tricky Trap',
    'Mass Trap',
  ])
})

test('trap combo retains its legal prefix then retreats, deterministically without mutating the source', () => {
  const state = checkpoint()
  const before = structuredClone(state)
  const result = plan_combat_turn(profile(), state, 0n, 4_000n)
  expect(result.actions.map(({ type }) => type)).toEqual(['cast', 'move'])
  const cast = result.actions[0]!
  if (cast.type !== 'cast') throw new Error('expected trap')
  expect(cast.spell).toBe('Tricky Trap')
  expect(spell_target_cells(state, 0n, cast.spell).targetable).toContain(BigInt(cast.target_cell))
  const simulation = create_fight({ state, mode: 'remote' })
  simulation.apply({
    type: 'cast_spell',
    fighter: 0n,
    spell: cast.spell,
    target_cell: BigInt(cast.target_cell),
    observed_ms: 4_000n,
  })
  expect(simulation.state().contract.zones.length).toBeGreaterThan(0)
  expect(simulation.state().contract.fighters[1]!.hp).toBe(state.contract.fighters[1]!.hp)
  expect(result.skipped.length).toBe(1)
  expect(plan_combat_turn(profile(), state, 0n, 4_000n)).toEqual(result)
  expect(state).toEqual(before)
})

test('conditions and no-legal-action fallback are data, never an invented action', () => {
  const state = checkpoint()
  state.contract.fighters[0]!.ap = 0n
  state.contract.fighters[0]!.mp = 0n
  expect(plan_combat_turn(profile(), state, 0n, 4_000n).actions).toEqual([])
  expect(plan_combat_turn({ ...profile(), fallback: 'awaiting_ai' }, state, 0n, 4_000n).issue).toBe('no_legal_tactic')
  const guarded = { ...profile(), rules: [{ when: { type: 'enemy_within' as const, cells: 1 }, combo: 'traps' }] }
  expect(plan_combat_turn(guarded, checkpoint(), 0n, 4_000n).actions).toEqual([])
})

test('retreat evaluates actual tackle outcomes instead of promising the requested endpoint', () => {
  const state = checkpoint()
  const enemy = state.contract.fighters[1]!
  enemy.cell = 106n
  if (enemy.kind.type !== 'mob') throw new Error('expected mob')
  enemy.kind.snapshot.agility = 1_000_000n
  state.contract.fighters[0]!.mp = 1n
  const retreat = { ...profile(), rules: [{ when: { type: 'always' as const }, combo: 'escape' }] }
  const result = plan_combat_turn(retreat, state, 0n, 4_000n)
  expect(result.actions).toEqual([])
  expect(result.skipped).toEqual(['escape:move'])
})

test('HP conditions use canonical maximum health and terminal/inactive seats produce no draft', () => {
  const state = checkpoint()
  const escape = { ...profile(), rules: [{ when: { type: 'hp_below' as const, percent: 50 }, combo: 'escape' }] }
  state.contract.fighters[0]!.hp = 1n
  expect(plan_combat_turn(escape, state, 0n, 4_000n).actions[0]?.type).toBe('move')
  state.contract.fighters[0]!.hp = 10_000n
  expect(plan_combat_turn(escape, state, 0n, 4_000n).actions).toEqual([])
  expect(plan_combat_turn(escape, state, 1n, 4_000n).issue).toBe('not_active_turn')
  state.contract.ended = true
  expect(plan_combat_turn(escape, state, 0n, 4_000n).actions).toEqual([])
})

test('target selection, approach and successive casts consume the preceding simulated state', () => {
  const state = checkpoint()
  state.sources.players['0xc1'] = create_character_source({ classe: 'senshi', level: 200n, strength: 100n })
  const slash = create_fixture().checkpoint.sources.spells.slash!
  state.sources.spells.slash = slash
  state.contract.fighters[1]!.hp = 1_000n
  const next = { ...structuredClone(state.contract.fighters[1]!), cell: 145n, hp: 900n }
  state.contract.fighters.push(next)
  const offensive: CombatProfile = {
    version: '1',
    intent: 'Approach then attack twice',
    combos: [
      {
        name: 'attack',
        steps: [
          { type: 'move', direction: 'approach' },
          { type: 'cast', spell: 'slash', target: 'lowest_hp_enemy' },
          { type: 'cast', spell: 'slash', target: 'nearest_enemy' },
        ],
      },
    ],
    rules: [{ when: { type: 'always' }, combo: 'attack' }],
    fallback: 'end_turn',
  }
  const result = plan_combat_turn(offensive, state, 0n, 4_000n)
  expect(result.actions.map(({ type }) => type)).toEqual(['move', 'cast', 'cast'])
  expect(result.actions[1]).toMatchObject({ target_cell: '145' })
  expect(result.actions[2]).toMatchObject({ target_cell: '109' })
})
