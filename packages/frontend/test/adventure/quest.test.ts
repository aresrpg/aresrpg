// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { create_fight, create_fight_state } from '@aresrpg/fight'
import { CONTRACT_CONSTANTS } from '@aresrpg/fight/move_contract'

import source from '../../../../seed/content/adventure.json'
import { create_app } from '../../src/store.ts'
import type { AuthSession } from '../../src/auth.ts'
import { audio_snapshot } from '../../src/modules/audio.ts'
import { adventure_quest, adventure_roster } from '../../src/adventure/quest.ts'
import { adventure_character, adventure_companion } from '../../src/adventure/character.ts'
import { adventure_fight_setup } from '../../src/adventure/fight_setup.ts'
import { natural_slot_for, stage_equip } from '../../src/characters/equipment_stage.ts'
import { adventure_available_inventory, ADVENTURE_INVENTORY } from '../../src/adventure/projection.ts'

const win_first_fight = (app: ReturnType<typeof create_app>) => {
  app.dispatch({ type: 'adventure/entered' })
  app.dispatch({ type: 'adventure/challenge' })
  const checkpoint = create_fight_state(adventure_fight_setup(app.store.getState().adventure.character!, 0))
  app.dispatch({
    type: 'adventure/settled',
    checkpoint: { ...checkpoint, contract: { ...checkpoint.contract, ended: true, winner: 0n, ended_ms: 10000n } },
  })
  app.dispatch({ type: 'adventure/result_acknowledged', screen: 'level' })
  app.dispatch({ type: 'adventure/result_acknowledged', screen: 'result' })
}

const equip_rewards = (app: ReturnType<typeof create_app>) => {
  const equipment = ADVENTURE_INVENTORY.reduce(
    (equipment, item) => stage_equip(equipment, item, natural_slot_for(item, equipment)!),
    {}
  )
  app.dispatch({ type: 'adventure/equipment_changed', equipment })
}

test('quest progression teaches recruitment, both characters and follow before the guards', () => {
  const app = create_app()
  app.dispatch({ type: 'adventure/entered' })
  expect(app.store.getState().adventure.character!.level).toBe(199)
  expect(adventure_available_inventory(app.store.getState().adventure)).toEqual([])
  app.dispatch({ type: 'adventure/invite' })
  expect(app.store.getState().adventure.companion).toBeNull()
  win_first_fight(app)
  expect(app.store.getState().adventure.character!.level).toBe(200)
  expect(adventure_quest(app.store.getState().adventure)).toBe('equip')
  app.dispatch({ type: 'adventure/talk' })
  app.dispatch({ type: 'adventure/invite' })
  expect(app.store.getState().adventure.dialogue).toBeNull()
  expect(app.store.getState().adventure.companion).toBeNull()
  const hat = ADVENTURE_INVENTORY.find(({ category }) => category === 'hat')!
  app.dispatch({ type: 'adventure/equipment_changed', equipment: stage_equip({}, hat, 'hat') })
  expect(adventure_quest(app.store.getState().adventure)).toBe('equip')
  equip_rewards(app)
  expect(adventure_quest(app.store.getState().adventure)).toBe('speak')
  app.dispatch({ type: 'adventure/equipment_changed', equipment: {} })
  expect(adventure_quest(app.store.getState().adventure)).toBe('speak')
  app.dispatch({ type: 'adventure/challenge' })
  expect(app.store.getState().adventure.phase).toBe('explore')
  for (let index = 0; index <= source.dialogue.length; index++) app.dispatch({ type: 'adventure/talk' })
  expect(adventure_quest(app.store.getState().adventure)).toBe('invite')
  app.dispatch({ type: 'adventure/invite' })
  expect(adventure_roster(app.store.getState().adventure)).toHaveLength(2)
  expect(app.store.getState().adventure.companion!.loadout).toEqual({ hat: 'solomonk', cloak: 'momaku' })
  app.dispatch({ type: 'adventure/select', character_id: source.companion.id })
  expect(adventure_quest(app.store.getState().adventure)).toBe('follow')
  app.dispatch({ type: 'adventure/follow', enabled: true })
  expect(app.store.getState().adventure.following).toBe(false)
  app.dispatch({ type: 'adventure/select', character_id: app.store.getState().adventure.character!.id })
  app.dispatch({ type: 'adventure/follow', enabled: true })
  expect(adventure_quest(app.store.getState().adventure)).toBe('guards')
  app.dispatch({ type: 'adventure/follow', enabled: false })
  expect(adventure_quest(app.store.getState().adventure)).toBe('guards')
  expect(app.store.getState().session.characters).toEqual([])
  expect(app.store.getState().journey.completed).toEqual([])
})

test('the guards seat both heroes under local control and the boss defeats both through ordinary combat', () => {
  const hero = {
    ...adventure_character(200),
    loadout: { hat: 'zukin_muru', cloak: 'enka_muru', boots: 'demo_goblin_boots' },
  }
  const companion = adventure_companion()
  const guard_setup = adventure_fight_setup(hero, 1, companion)
  expect(guard_setup.players.map(({ owner }) => owner)).toEqual(['local', 'local'])
  expect(guard_setup.mobs).toHaveLength(3)
  const game = create_fight({
    state: create_fight_state(adventure_fight_setup(hero, 2, companion)),
    mode: 'local',
    seed: 42n,
  })
  game.apply({ type: 'ready', fighter: 0n })
  game.apply({ type: 'ready', fighter: 1n })
  expect(game.apply({ type: 'start', observed_ms: 60000n }).error).toBeNull()
  for (let turn = 0; turn < 24 && !game.state().contract.ended; turn++) {
    expect(
      game.simulate_turn({ observed_ms: game.state().contract.turn_started_ms + CONTRACT_CONSTANTS.turn_min_ms }).error
    ).toBeNull()
  }
  const result = game.state().contract
  expect(result.ended).toBe(true)
  expect(result.winner).toBe(1n)
  expect(result.fighters.filter(({ kind }) => kind.type === 'player').every(({ dead }) => dead)).toBe(true)
})

test('the authored companion is valid, and its gear never enters the live catalogue', async () => {
  const { valid_simulator_character } = await import('../../src/modules/simulator.ts')
  const { content_catalog } = await import('../../src/content/catalog.ts')
  const { adventure_character_row } = await import('../../src/adventure/projection.ts')
  const companion = adventure_companion()
  expect(valid_simulator_character(companion)).toBe(true)
  expect(adventure_character_row(companion).available_points).toBeGreaterThanOrEqual(0)
  expect(content_catalog.item('solomonk')).toBeNull()
})

test('the companion walks the authored bridge using the same solid-world navigator', async () => {
  const { compile_runtime_world_recipe } = await import('@aresrpg/engine')
  const { adventure_terrain } = await import('../../src/adventure/terrain.ts')
  const { create_world_collision } = await import('../../src/game/core/world_collision.ts')
  const { step_walking_follower } = await import('../../src/game/core/walking_follower.ts')
  const collision = create_world_collision(compile_runtime_world_recipe(adventure_terrain()), (error) => {
    throw error
  })
  let position: readonly [number, number, number] = [129, 80, 196]
  let motion: Parameters<typeof step_walking_follower>[1] = null
  for (let tick = 0; tick < 600; tick++) {
    const next = step_walking_follower(collision, motion, position, { x: 128, z: 218 }, 1000 / 60)
    ;({ position, motion } = next)
    expect(position[0]).toBeGreaterThan(124)
    expect(position[0]).toBeLessThan(132)
    expect(position[1]).toBeGreaterThan(79)
    if (Math.hypot(position[0] - 128, position[2] - 218) < 0.2) break
  }
  expect(Math.hypot(position[0] - 128, position[2] - 218)).toBeLessThan(2.5)
})

for (const winner of [0n, 1n])
  test(`the final boss ending waits for presentation and preserves outcome ${winner} for rebirth`, () => {
    const app = create_app()
    win_first_fight(app)
    equip_rewards(app)
    for (let index = 0; index <= source.dialogue.length; index++) app.dispatch({ type: 'adventure/talk' })
    app.dispatch({ type: 'adventure/invite' })
    app.dispatch({ type: 'adventure/select', character_id: source.companion.id })
    app.dispatch({ type: 'adventure/select', character_id: app.store.getState().adventure.character!.id })
    app.dispatch({ type: 'adventure/follow', enabled: true })
    for (const encounter of [1, 2]) {
      app.dispatch({ type: 'adventure/challenge' })
      const state = app.store.getState().adventure
      const checkpoint = create_fight_state(adventure_fight_setup(state.character!, encounter, state.companion))
      app.dispatch({
        type: 'adventure/settled',
        checkpoint: {
          ...checkpoint,
          contract: { ...checkpoint.contract, ended: true, winner: encounter === 1 ? 0n : winner },
        },
      })
      if (encounter === 1) app.dispatch({ type: 'adventure/result_acknowledged', screen: 'result' })
    }
    expect(app.store.getState().adventure.phase).toBe('reward')
    app.dispatch({ type: 'adventure/result_acknowledged', screen: 'result' })
    expect(app.store.getState().adventure.phase).toBe('reward')
    app.dispatch({ type: 'fight/closed', fight: null })
    expect(app.store.getState().adventure.phase).toBe(winner === 0n ? 'ending' : 'complete')
    app.dispatch({ type: 'fight/closed', fight: null })
    expect(app.store.getState().adventure.phase).toBe(winner === 0n ? 'ending' : 'complete')
    app.dispatch({ type: 'adventure/ending_finished' })
    expect(app.store.getState().adventure.phase).toBe('complete')
    expect(app.store.getState().adventure.result?.winner).toBe(Number(winner))
    expect(audio_snapshot(app.store.getState()).completed_fights).not.toContain('adventure_2')
    app.dispatch({ type: 'adventure/challenge' })
    expect(app.store.getState().adventure.phase).toBe('complete')
    expect(app.store.getState().session.auth_request).toBeNull()
    expect(app.store.getState().session.wallet).toBeNull()
    app.dispatch({ type: 'adventure/game_entered' })
    expect(app.store.getState().adventure.phase).toBe('complete')
    app.dispatch({ type: 'auth/ready', wallets: [] })
    app.dispatch({ type: 'auth/login_google' })
    expect(app.store.getState().session.auth_request).toBe('google')
    app.dispatch({ type: 'auth/connected', session: { address: '0x1' } as AuthSession })
    app.dispatch({ type: 'adventure/game_entered' })
    expect(app.store.getState().adventure.phase).toBe('entered')
    app.dispatch({ type: 'auth/disconnected' })
    expect(app.store.getState().adventure.phase).toBe('entered')
  })

test('every locale explains equipment confirmation without an actual transaction in the tutorial', async () => {
  const { load_app_copy, copy_text } = await import('../../src/i18n/copy.ts')
  const { LOCALES } = await import('../../src/i18n/locale.ts')
  for (const { code } of LOCALES) {
    const copy = await load_app_copy(code)
    const text = copy_text(copy.adventure)
    const confirm = copy_text(copy.characters_page)('accept')
    expect(text('equip_title')).not.toBe('equip_title')
    expect(text('equip_objective', { confirm })).not.toContain('{{confirm}}')
    expect(text('equip_body', { confirm })).toContain('Sui')
  }
})
