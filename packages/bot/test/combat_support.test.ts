// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { CONTRACT_CONSTANTS, create_character_source, create_fight } from '@aresrpg/fight'

import spells from '../../../seed/content/spells.json'
import { encode_cell, mask_from_cells } from '../../fight/src/combat_grid.ts'
import { create_runtime } from '../../fight/src/runtime.ts'
import { tick_turn_start } from '../../fight/src/turn_effects.ts'
import { support_beneficiaries } from '../src/combat_support.ts'
import { plan_combat_turn } from '../src/combat_tactics.ts'
import { parse_combat_profile } from '../src/combat_profile.ts'

import { character_id, placement } from './helpers/combat_runtime_fixture.ts'

const cell = (x: number, y = 5) => encode_cell(BigInt(x), BigInt(y))
const checkpoint = () => {
  const state = placement()
  state.sources.players[character_id] = create_character_source({ classe: 'tomoda', level: 30n })
  state.sources.spells = Object.fromEntries(spells.map(({ name, ...spell }) => [name, spell])) as never
  state.contract.closed = mask_from_cells([])
  state.contract.board.shape_mask = mask_from_cells(
    Array.from({ length: Number(CONTRACT_CONSTANTS.grid_cells) }, (_, index) => BigInt(index))
  )
  state.contract.board.obstacles = []
  state.contract.board.holes = []
  state.contract.round = 1n
  state.contract.queue = [0n, 1n, 2n]
  state.contract.turn_ptr = 0n
  state.contract.turn_started_ms = 60_000n
  Object.assign(state.contract.fighters[0]!, { cell: cell(5), ap: 8n, mp: 3n })
  Object.assign(state.contract.fighters[1]!, { cell: cell(4), hp: 1_000n })
  state.contract.fighters.push({
    ...structuredClone(state.contract.fighters[1]!),
    team: state.contract.fighters[0]!.team,
    cell: cell(7),
  })
  return create_fight({ state, mode: 'remote' }).state()
}
const profile = () =>
  parse_combat_profile({
    version: '1',
    intent: 'Cover allies with a support glyph.',
    combos: [{ name: 'support', steps: [{ type: 'cast', spell: 'Pack Totem', target: 'most_allies' }] }],
    rules: [{ when: { type: 'always' }, combo: 'support' }],
    fallback: 'awaiting_ai',
  })

test('Pack Totem covers caster and ally rather than the nearest enemy without claiming immediate buffs', () => {
  const state = checkpoint()
  const before = structuredClone(state)
  const planned = plan_combat_turn(profile(), state, 0n, 63_000n)
  expect(planned.actions).toEqual([{ type: 'cast', spell: 'Pack Totem', target_cell: String(cell(6)) }])
  const runtime = create_fight({ state, mode: 'remote' })
  const result = runtime.apply({
    type: 'cast_spell',
    fighter: 0n,
    spell: 'Pack Totem',
    target_cell: cell(6),
    observed_ms: 63_000n,
  })
  expect(result.error).toBeNull()
  expect(result.state.contract.zones).toHaveLength(1)
  expect(result.state.contract.fighters[2]!.effects).toEqual(before.contract.fighters[2]!.effects)
  const next = create_runtime(result.state)
  tick_turn_start(next, 2n)
  expect(next.contract.fighters[2]!.effects).toContainEqual({
    kind: 4n,
    stat: 9n,
    value: 5n,
    turns_left: 1n,
    source: 0n,
    element: '',
  })
  expect(state).toEqual(before)
  expect(plan_combat_turn(profile(), state, 0n, 63_000n)).toEqual(planned)
})

test('support skips unavailable spells and zero eligible glyph coverage', () => {
  const state = checkpoint()
  state.contract.fighters[0]!.ap = 0n
  expect(plan_combat_turn(profile(), state, 0n, 63_000n)).toMatchObject({ actions: [], issue: 'no_legal_tactic' })
  state.contract.fighters[0]!.ap = 8n
  state.contract.fighters[2]!.dead = true
  const level = state.sources.spells['Pack Totem']!.levels[0]!
  level.effects[1]!.target_filter = 2n
  expect(plan_combat_turn(profile(), state, 0n, 63_000n)).toMatchObject({ actions: [], issue: 'no_legal_tactic' })
})

test('support selector rejects damage positioning and excludes dead or forfeited allies', () => {
  const requested = profile()
  expect(() =>
    parse_combat_profile({
      ...requested,
      combos: [
        {
          name: 'support',
          steps: [
            {
              type: 'cast',
              spell: 'Pack Totem',
              target: 'most_allies',
              position: 'best_damage',
            },
          ],
        },
      ],
    })
  ).toThrow()
  for (const unavailable of ['dead', 'forfeited'] as const) {
    const state = checkpoint()
    state.contract.fighters[2]![unavailable] = true
    const planned = plan_combat_turn(profile(), state, 0n, 63_000n)
    expect(planned.actions).toHaveLength(1)
    expect(planned.actions[0]).not.toMatchObject({ target_cell: String(cell(6)) })
  }
})

test('support scores new positive stat or pool gains, not existing buffs or enemy gains', () => {
  const before = checkpoint()
  const buff = { kind: 4n, stat: 9n, value: 5n, turns_left: 1n, source: 0n, element: '' }
  before.contract.fighters[0]!.effects = [buff]
  expect(support_beneficiaries(before, structuredClone(before), 0n)).toBe(0)
  const after = structuredClone(before)
  after.contract.fighters[1]!.effects.push(buff)
  expect(support_beneficiaries(before, after, 0n)).toBe(0)
  after.contract.fighters[2]!.effects.push(buff)
  expect(support_beneficiaries(before, after, 0n)).toBe(1)
  after.contract.fighters[0]!.hp += 1n
  expect(support_beneficiaries(before, after, 0n)).toBe(2)
})

test('glyph payload geometry uses the triggering occupant as its origin and ignores existing zones', () => {
  const before = checkpoint()
  before.contract.fighters.push({ ...structuredClone(before.contract.fighters[2]!), cell: cell(9) })
  const after = structuredClone(before)
  const payload = after.sources.spells['Pack Totem']!.levels[0]!.effects[1]!
  after.contract.zones.push({
    owner_fighter: 0n,
    trap: false,
    shape: 0n,
    size: 0n,
    anchor: cell(7),
    turns_left: 3n,
    effects: [{ ...payload, area_shape: 3n, area_size: 2n }],
  })
  expect(support_beneficiaries(before, after, 0n)).toBe(1)
  const runtime = create_runtime(after)
  tick_turn_start(runtime, 2n)
  expect(runtime.contract.fighters[2]!.effects).toHaveLength(1)
  expect(runtime.contract.fighters[3]!.effects).toHaveLength(0)
  expect(support_beneficiaries(after, structuredClone(after), 0n)).toBe(0)
  after.contract.zones[0]!.effects[0]!.chance_bp = 0n
  expect(support_beneficiaries(before, after, 0n)).toBe(0)
})

test('authored immediate area support maximizes actual allied gains through the same selector', () => {
  const state = checkpoint()
  state.sources.players[character_id] = create_character_source({ classe: 'shugo', level: 50n })
  const requested = parse_combat_profile({
    ...profile(),
    combos: [{ name: 'support', steps: [{ type: 'cast', spell: 'Art of Staff', target: 'most_allies' }] }],
  })
  const planned = plan_combat_turn(requested, state, 0n, 63_000n)
  const action = planned.actions[0]!
  expect(action.type).toBe('cast')
  if (action.type !== 'cast') throw new Error('expected support cast')
  const runtime = create_fight({ state, mode: 'remote' })
  const result = runtime.apply({
    type: 'cast_spell',
    fighter: 0n,
    spell: action.spell,
    target_cell: BigInt(action.target_cell),
    observed_ms: 63_000n,
  })
  expect(result.error).toBeNull()
  expect(support_beneficiaries(state, result.state, 0n)).toBe(2)
  expect(result.state.contract.fighters[1]!.effects).toHaveLength(0)
  expect(
    result.state.contract.fighters[2]!.effects.some(({ kind, stat, value }) => kind === 4n && stat === 9n && value > 0n)
  ).toBe(true)
})
