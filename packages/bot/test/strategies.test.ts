// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { basic_build, basic_mode, bind_strategy, bind_team, strategies } from '@aresrpg/protocol/strategies'

import catalogue from '../../../seed/content/strategies.json'
import dungeons from '../../../seed/content/dungeons.json'
import spells from '../../../seed/content/spells.json'
import { id } from '../../sdk/test/helpers/transport.ts'
import { behavior_actor } from '../src/behavior_projection.ts'
import { parse_behavior_script, type BehaviorScript } from '../src/behavior_script.ts'
import { parse_combat_profile } from '../src/combat_profile.ts'

const heroes = [id(1), id(2), id(3)]
const scope = { title: 'Preset', area: { world: 'nauvis', city: 'thebes' }, dungeon: dungeons[0]!.dungeon }
const leaves = (script: BehaviorScript, type: string) => {
  const found: Record<string, unknown>[] = []
  JSON.stringify(script.tree, (_key, value: Record<string, unknown> | null) => {
    if (value?.type === type) found.push(value)
    return value
  })
  return found
}

test('every seed-authored strategy binds to a tree the bot accepts for exactly one hero', () => {
  expect(strategies.map((entry) => entry.id)).toEqual(['fight_nearby', 'gather_craft', 'team_hunt', 'dungeon_raid'])
  for (const { id: strategy } of strategies) {
    const solo = parse_behavior_script(bind_strategy(strategy, { ...scope, character: heroes[0]! }))
    expect(behavior_actor(solo)).toBe(heroes[0]!)
    expect(solo.strategy).toBe(strategy)
    expect(JSON.stringify(solo)).not.toContain('"$')
  }
  expect(() => bind_strategy('unknown', { ...scope, character: heroes[0]! })).toThrow('unknown_strategy')
  expect(() => bind_strategy('team_hunt', { ...scope, character: '' })).toThrow('strategy_identity_required')
})

test('a team is one tree per hero: each names the others as allies and brings its own build', () => {
  const healer = {
    version: '1',
    intent: 'Stay back.',
    combos: [{ name: 'wait', steps: [{ type: 'move', direction: 'retreat' }] }],
    rules: [{ when: { type: 'ally_present' }, combo: 'wait' }],
    fallback: 'end_turn',
  }
  const team = [{ character: heroes[0]!, profile: healer, stats: ['vitality'] }, { character: heroes[1]! }]
  for (const strategy of ['team_hunt', 'dungeon_raid']) {
    const scripts = bind_team(strategy, team, scope).map(parse_behavior_script)
    expect(scripts.map(behavior_actor)).toEqual(heroes.slice(0, 2))
    scripts.forEach((script, index) =>
      expect(JSON.stringify(script.tree)).toContain(`"allies":${JSON.stringify([heroes[1 - index]])}`)
    )
    // The healer keeps its own profile and priorities; its teammate keeps the catalogue's.
    const [own, mate] = scripts.map((script) => JSON.stringify(script.tree))
    expect(own).toContain(JSON.stringify(healer))
    expect(own).toContain('"stats":["vitality"],"spells":[]')
    expect(mate).toContain(JSON.stringify(catalogue.profile))
    expect(mate).toContain('"stats":[],"spells":[]')
  }
})

test('the Basic build is the archer authored in seed: a hero of another class gets none of it', () => {
  const build = basic_build('yogan')
  expect(build).toEqual({
    stats: ['intelligence'],
    spells: ['Magic Arrow', 'Distant Shooting', 'Critical Shooting', 'Powerful Shooting'],
    equipment: ['intelligence', 'vitality', 'wisdom'],
    profile: catalogue.basic.build.profile,
  })
  expect(basic_build('senshi')).toEqual({})
  // Every listed spell is a real spell of that class, and the profile is one the bot accepts.
  for (const name of build.spells!) expect(spells.find((spell) => spell.name === name)?.classe).toBe('yogan')
  expect(parse_combat_profile(build.profile).combos.map(({ name }) => name)).toEqual([
    'attack',
    'range',
    'critical',
    'power',
    'approach',
  ])
  expect(basic_mode).toEqual({ dungeon: 'gilded_lorito', classe: 'yogan' })
  expect(dungeons.some(({ dungeon }) => dungeon === basic_mode.dungeon)).toBe(true)
})

test('every strategy carries the growth leaves once: bound with a build they act, bound without they list nothing', () => {
  for (const { id: strategy } of strategies) {
    const archer = parse_behavior_script(
      bind_strategy(strategy, { ...scope, character: heroes[0]!, ...basic_build('yogan') })
    )
    const other = parse_behavior_script(
      bind_strategy(strategy, { ...scope, character: heroes[0]!, ...basic_build('senshi') })
    )
    const { stats, spells: ranks, equipment } = catalogue.basic.build
    expect(leaves(archer, 'spend_points')).toEqual([
      { type: 'spend_points', character_id: heroes[0]!, stats, spells: ranks },
    ])
    const worn = leaves(archer, 'equip_owned')
    expect(worn.map(({ slot }) => slot)).toEqual([
      'hat',
      'amulet',
      'cloak',
      'weapon',
      'left_ring',
      'right_ring',
      'belt',
      'boots',
    ])
    for (const leaf of worn) expect(leaf).toMatchObject({ order: 'best_stats', stats: equipment })
    expect(leaves(other, 'spend_points')).toMatchObject([{ stats: [], spells: [] }])
    for (const leaf of leaves(other, 'equip_owned')) expect(leaf).toMatchObject({ order: 'best_stats', stats: [] })
    expect(JSON.stringify(other.tree)).toContain(JSON.stringify(catalogue.profile))
    expect(JSON.stringify(other.tree)).not.toContain('Magic Arrow')
    expect(JSON.stringify(archer.tree)).toContain(JSON.stringify(catalogue.basic.build.profile))
  }
})
