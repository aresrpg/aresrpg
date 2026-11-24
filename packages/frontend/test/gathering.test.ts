// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Collect All, the one reachable gathering automation, through the game's real store and socket: one gather
// transaction per confirmed node, never before the chain's own deadline, and a protector stops the run and is
// answered once, never forfeited.
import { afterEach, expect, test } from 'bun:test'
import { job_xp_for_level } from '@aresrpg/immutable'

import { GAME_MODULES } from '../src/game/game_modules.ts'
import { publish_pose } from '../src/game/core/pose_feed.ts'
import { resource_node_id } from '../src/game/resource_nodes.ts'
import { gathering_resources } from '../src/modules/automation_state.ts'
import { resource_pack_id } from '../src/modules/world_spawns.ts'

import { character_row, fake_wallet, settle, sign_in, start_surface, type Started } from './harness.ts'

const running: Started[] = []
afterEach(() => {
  running.splice(0).forEach(({ stop }) => stop())
  publish_pose(null)
})

test('Collect All gathers one confirmed node at a time, waits for the chain deadline, and stops on its protector', async () => {
  const resource = gathering_resources('nauvis').find(({ tier }) => tier === 1)!
  const key = 'nauvis:97:97'
  const pose = { character_id: 'alice', x: 0, y: 0, z: 0, yaw: 0, riding: false, gliding: false, time_of_day: 0 }
  const gathers: ((result: Readonly<{ quantity: number; ambushed: boolean }>) => void)[] = []
  const ambushes: string[] = []
  const wallet = fake_wallet({
    character: {
      gather: () => new Promise((resolve) => void gathers.push(resolve)),
      resolve_ambush: async () => (ambushes.push('protector'), { fight: 'protector' }),
    },
  })
  const game = await start_surface(GAME_MODULES, { seat: true, account: { wallet, remembered: 'Sign in with Google' } })
  running.push(game)
  const hero = character_row('alice', {
    kiosk: 'kiosk',
    custody: 'kiosk',
    world: 'nauvis',
    checkpoint_world: 'nauvis',
    x: 50_000,
    z: 50_000,
    at_ms: 1,
    jobs: { [resource.job]: String(job_xp_for_level(30)) },
    equipment: [{ slot: 'tool', category: `tool_${resource.job.toLowerCase()}` }] as never,
  })
  await sign_in(game, { characters: [hero] })
  game.dispatch({ type: 'character/select', character_id: 'alice' })
  const zone = {
    world: 'nauvis',
    zx: 97,
    zz: 97,
    seed: '1',
    searched_at_ms: 1,
    mob_taken: '0',
    res_taken: [] as number[],
  }
  game.receive(
    { type: 'packet/game_state', frozen: false },
    {
      type: 'packet/server_info',
      online: 1,
      online_characters: 1,
      indexing_lag: 0,
      current_epoch: '1',
      chain_timestamp_ms: Date.now(),
      chain_sample_age_ms: 0,
    },
    { type: 'packet/tracked_zones', character_id: 'alice', world: 'nauvis', zones: [{ zx: 97, zz: 97 }] },
    { type: 'packet/zones', zones: [zone] },
    {
      type: 'packet/zone_spawns',
      world: 'nauvis',
      zx: 97,
      zz: 97,
      mobs: [],
      resources: [{ index: 0, x: 50_000, z: 50_000, item_type: resource.item_type, nodes: 2 }],
    }
  )
  game.dispatch({
    type: 'clock/observed',
    chain_ms: Date.now() - 5_000,
    received_ms: performance.now(),
    sample_age_ms: 5_000,
  })
  publish_pose(pose)
  game.dispatch({
    type: 'automation/collect_all',
    id: 'pack',
    node: resource_node_id(resource_pack_id(key, '1', 0), 0),
    pose,
  })
  expect(gathers).toHaveLength(1)
  // Another page keeps the run; the projected node and the hero's new checkpoint arrive before the receipt.
  game.dispatch({ type: 'page/open', page: 'settings' })
  expect(game.state().automation.run).not.toBeNull()
  const deadline = Date.now() + 10_000
  game.receive(
    { type: 'packet/characters', characters: [{ ...hero, at_ms: deadline }] },
    { type: 'packet/zones', zones: [{ ...zone, res_taken: [1] }] }
  )
  expect(gathers).toHaveLength(1)
  gathers[0]!({ quantity: 2, ambushed: false })
  await settle()
  // Even an early completion on screen cannot gather before the chain's observed deadline.
  const gathering = game.state().world.gathering.alice!
  game.dispatch({
    type: 'world/gather_finished',
    character_id: 'alice',
    attempt_id: gathering.attempt_id,
    ends_at_ms: gathering.ends_at_ms,
  })
  expect(gathers).toHaveLength(1)
  game.dispatch({ type: 'clock/observed', chain_ms: deadline + 1, received_ms: performance.now() })
  expect(gathers).toHaveLength(2)
  // The protector appears: the run stops, the ambush is answered once, and nothing gathers again.
  gathers[1]!({ quantity: 2, ambushed: true })
  await settle()
  expect(game.state().automation.run).toBeNull()
  expect(ambushes).toEqual(['protector'])
  game.dispatch({ type: 'clock/observed', chain_ms: deadline + 20_000, received_ms: performance.now() })
  expect(gathers).toHaveLength(2)
})
