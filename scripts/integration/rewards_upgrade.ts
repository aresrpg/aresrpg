// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import assert from 'node:assert/strict'
import { cp, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { local_packages, ROOT, object_of, shared_of } from './local_packages.ts'
import { prepare_game, play_tournament } from './rehearsal_game.ts'
import { fund_after_upgrade } from './rehearsal_funding.ts'

const env = await local_packages()
try {
  const rewards_path = join(env.workspace, 'packages/rewards/sources')
  await cp(join(ROOT, 'scripts/test/fixtures/rewards_upgrade/economy_v1.move'), join(rewards_path, 'economy.move'))
  await rm(join(rewards_path, 'tournament_rewards.move'))
  const initial = await env.publish('rewards')
  const setup = object_of(initial, '::economy::Setup')
  const economy = shared_of(initial, '::economy::Economy')
  assert.equal((await env.json(economy.id)).token, '')
  await cp(join(ROOT, 'packages/rewards/sources/economy.move'), join(rewards_path, 'economy.move'))
  await cp(
    join(ROOT, 'packages/rewards/sources/tournament_rewards.move'),
    join(rewards_path, 'tournament_rewards.move')
  )
  await env.upgrade('rewards')
  const cap = env.publications.rewards!
  assert.equal(cap.version, '2')
  assert.equal((await env.json(economy.id)).token, '')
  const retained = await env.client.core.getObject({ objectId: setup })
  assert.equal(retained.object.type, `${cap.original}::economy::Setup`)
  console.log('Unfunded upgrade retained Setup and Economy.')
  const game = await prepare_game(env, economy)
  await play_tournament(env, game)
  const funded = await fund_after_upgrade(env, game, setup)
  await play_tournament(env, funded, { coin_type: String(funded.pins.kares_coin_type), amount: 1_000_000_000_000n })
} finally {
  await env.cleanup()
}
