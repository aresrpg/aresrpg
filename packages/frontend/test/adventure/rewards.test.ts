// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_app } from '../../src/store.ts'
import { ADVENTURE_PET } from '../../src/adventure/content.ts'
import { ADVENTURE_INVENTORY, adventure_character_row } from '../../src/adventure/projection.ts'

test('victory grants Beru as loot without equipping it or altering the existing loadout', () => {
  const app = create_app()
  const stop = app.observe(['adventure', 'fight'])
  try {
    app.dispatch({ type: 'adventure/entered' })
    app.dispatch({ type: 'adventure/challenge' })
    const before = app.store.getState().adventure.character!
    const checkpoint = app.store.getState().fight.checkpoint!
    app.dispatch({
      type: 'adventure/settled',
      checkpoint: {
        ...checkpoint,
        contract: { ...checkpoint.contract, ended: true, winner: 0n, ended_ms: 10000n },
      },
    })
    const { character, result } = app.store.getState().adventure
    expect(character!.loadout).toEqual(before.loadout)
    expect(adventure_character_row(character!).equipment).toEqual([])
    expect(result!.participants.find(({ character_id }) => character_id === before.id)!.loot).toContainEqual({
      item_type: ADVENTURE_PET,
      qty: 1,
    })
    expect(ADVENTURE_INVENTORY.some(({ item_type }) => item_type === ADVENTURE_PET)).toBe(true)
    expect(result!.level_up_open).toBe(true)
    app.dispatch({ type: 'adventure/result_acknowledged', screen: 'result' })
    expect(app.store.getState().adventure.result).toBe(result)
    app.dispatch({ type: 'adventure/result_acknowledged', screen: 'level' })
    expect(app.store.getState().adventure.result?.level_up_open).toBe(false)
    expect(app.store.getState().adventure.result?.participants).toBe(result!.participants)
    app.dispatch({ type: 'adventure/result_acknowledged', screen: 'level' })
    expect(app.store.getState().adventure.result).not.toBeNull()
  } finally {
    stop()
  }
})

test('demo mob definitions expose valid resistances and loot without entering the live catalogue', async () => {
  const { ADVENTURE_MOBS, ADVENTURE_ITEMS, ADVENTURE_LOOT, adventure_item } =
    await import('../../src/adventure/content.ts')
  const { content_catalog, centered_resistance } = await import('../../src/content/catalog.ts')
  for (const mob of ADVENTURE_MOBS) {
    expect(content_catalog.mob(mob.mob_type)).toBeNull()
    expect(mob.spells[0]!.name).toBe(mob.role === 'boss' ? 'Royal Judgment' : 'Goblin Strike')
    expect(Object.values(mob.resistances).map(centered_resistance)).toEqual([0, 0, 0, 0])
  }
  expect(ADVENTURE_MOBS[0]!.loot).toEqual(ADVENTURE_LOOT)
  expect(ADVENTURE_LOOT).toHaveLength(6)
  for (const drop of ADVENTURE_LOOT) expect(adventure_item(drop.item_type)).toBeDefined()
  for (const item of ADVENTURE_ITEMS.filter(({ item_type }) => item_type.startsWith('demo_'))) {
    expect(content_catalog.item(item.item_type)).toBeNull()
  }
})

test('the demo route blocks cliffs and water, then opens only the authored path forward', async () => {
  const { adventure_movement_area } = await import('../../src/adventure/terrain.ts')
  const starting = adventure_movement_area(false),
    unlocked = adventure_movement_area(true)
  expect(starting(128, 112)).toBe(true)
  expect(starting(119, 135)).toBe(true)
  expect(starting(144, 150)).toBe(false)
  expect(unlocked(144, 150)).toBe(true)
  expect(starting(160, 112)).toBe(false)
  expect(starting(128, 95)).toBe(false)
  expect(unlocked(128, 211)).toBe(true)
  expect(unlocked(138, 211)).toBe(false)
})

test('every local fighter carries XP matching its level, including the fully allocated level-200 companion', async () => {
  const { create_fight_state } = await import('@aresrpg/fight')
  const { xp_for_level, characteristic_value_cost, characteristic_cost_step } = await import('@aresrpg/immutable')
  const { adventure_character, adventure_companion } = await import('../../src/adventure/character.ts')
  const { adventure_fight_setup } = await import('../../src/adventure/fight_setup.ts')
  const { adventure_result } = await import('../../src/adventure/result.ts')
  const { stat_budget } = await import('../../src/modules/simulator.ts')
  const app = create_app()
  const hero = adventure_character(200)
  const companion = adventure_companion()
  const checkpoint = create_fight_state(adventure_fight_setup(hero, 1, companion))
  expect(checkpoint.sources.players[companion.id]!.experience).toBe(BigInt(xp_for_level(200)!))
  const state = {
    ...app.store.getState(),
    adventure: { ...app.store.getState().adventure, character: hero, companion, encounter: 1 },
  }
  const result = adventure_result(
    state,
    { ...checkpoint, contract: { ...checkpoint.contract, ended: true, winner: 0n } },
    200
  )
  expect(result.participants.find(({ character_id }) => character_id === companion.id)).toMatchObject({
    level_before: 200,
    level_after: 200,
  })
  const remaining = stat_budget(200) - characteristic_value_cost('yajin', 'strength', companion.strength)!
  expect(remaining).toBeLessThan(characteristic_cost_step('yajin', 'strength', companion.strength).cost)
})

test('Gobadoc stands on reachable level grass beyond the descent', async () => {
  const { compile_runtime_world_recipe, sample_world_column } = await import('@aresrpg/engine')
  const { create_world_collision } = await import('../../src/game/core/world_collision.ts')
  const { adventure_terrain, adventure_movement_area } = await import('../../src/adventure/terrain.ts')
  const { ADVENTURE_ENCOUNTERS } = await import('../../src/adventure/content.ts')
  const terrain = compile_runtime_world_recipe(adventure_terrain())
  const world = create_world_collision(terrain, (error) => {
    throw error
  })
  const {
    position: { x, y, z },
  } = ADVENTURE_ENCOUNTERS.at(-1)!
  const ground = sample_world_column(terrain, x, z)
  expect(ground.surface_y).toBe(y)
  expect(terrain.materials.entries[ground.surface_id]!.preset).toBe('grass')
  expect(adventure_movement_area(true)(x, z)).toBe(true)
  for (const dx of [-1, 0, 1])
    for (const dz of [-2, 0, 2]) {
      expect(world.solid_at(x + dx, y - 1, z + dz)).toBe(true)
      expect(world.solid_at(x + dx, y, z + dz)).toBe(false)
      expect(world.solid_at(x + dx, y + 2, z + dz)).toBe(false)
    }
})
