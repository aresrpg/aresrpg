// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { AREA_SHAPES, EFFECT_KINDS } from '@aresrpg/fight/move_contract'

import spells from '../../../seed/content/spells.json'
import { spell_knowledge } from '../src/spell_catalog.ts'
import { gameplay_knowledge } from '../src/gameplay_knowledge.ts'
import { parse_combat_profile, validate_profile_character } from '../src/combat_profile.ts'

import { character, profession_context } from './helpers/profession_fixture.ts'

test('catalog preserves all authored identities and selected casting definitions with Move vocabulary', () => {
  const catalog = spell_knowledge([], [])
  if (!('catalog' in catalog)) throw new Error('missing spell catalog')
  expect(catalog.catalog).toEqual(spells.map(({ name, classe, unlock_level }) => ({ name, classe, unlock_level })))
  const knowledge = spell_knowledge([], ['Tricky Trap'])
  if (!('definitions' in knowledge)) throw new Error('missing spell definitions')
  const spell = spells.find(({ name }) => name === 'Tricky Trap')!
  expect(knowledge.definitions).toEqual([{ ...spell, characters: [] }])
  expect(knowledge.effect_kinds?.trap).toBe(Number(EFFECT_KINDS.trap))
  expect(knowledge.area_shapes?.circle).toBe(Number(AREA_SHAPES.circle))
  expect(() => JSON.stringify(knowledge)).not.toThrow()
})

test('catalog membership differs from character entitlement and invested rank; profile validation agrees', () => {
  const profile = parse_combat_profile({
    version: '1',
    intent: 'Trap',
    combos: [{ name: 'trap', steps: [{ type: 'cast', spell: 'Mass Trap', target: 'trap_near_enemy' }] }],
    rules: [{ when: { type: 'always' }, combo: 'trap' }],
    fallback: 'end_turn',
  })
  const rows = [
    { ...character, id: 'locked', classe: 'yajin', level: 20 },
    { ...character, id: 'learned', classe: 'yajin', level: 21 },
    { ...character, id: 'invested', classe: 'yajin', level: 21, spells: { 'Mass Trap': 3 } },
    { ...character, id: 'foreign', classe: 'asobi', level: 200 },
    { ...character, id: 'invalid_rank', classe: 'yajin', level: 200, spells: { 'Mass Trap': 100 } },
  ]
  const knowledge = spell_knowledge(rows, ['Mass Trap'])
  if (!('definitions' in knowledge)) throw new Error('missing spell definitions')
  const result = knowledge.definitions[0]!
  expect(result.unlock_level).toBe(21)
  expect(result.characters.map(({ learned_rank }) => learned_rank)).toEqual([null, 1, 3, null, null])
  for (const [index, row] of rows.entries())
    expect(validate_profile_character(profile, row).length === 0).toBe(result.characters[index]!.learned_rank !== null)
  expect(result.characters[2]!.upgrade).toEqual({ cost: 3, next_rank: 4 })
  const context = profession_context()
  expect(
    gameplay_knowledge({ ...context, now: context.now + context.freshness_ms }, undefined, ['Mass Trap'])
  ).toMatchObject({ available: false, reason: 'needs_resync' })
  expect(
    gameplay_knowledge({ ...context, now: context.now + context.freshness_ms }, undefined, ['Mass Trap'])
  ).not.toHaveProperty('spells')
})
