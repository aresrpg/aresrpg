// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import assert from 'node:assert/strict'

import { Transaction } from '@mysten/sui/transactions'

import { create_rewards_setup_transaction } from '../../packages/sdk/src/kares_ptb.ts'
import { project_rewards_setup } from '../../packages/sdk/src/deployment_admin.ts'
import { create_kares_transaction } from '../../packages/sdk/src/kares_actions.ts'

import { local_packages, object_of, shared_of } from './local_packages.ts'
import type { RehearsalGame } from './rehearsal_game.ts'

type Environment = Awaited<ReturnType<typeof local_packages>>
const UNIT = 1_000_000_000n
const TOKEN_SOURCE = `module rehearsal_token::test_token;
use sui::coin_registry::{Self, CoinRegistry};
public struct TOKEN has key { id: UID }
public fun create(registry: &mut CoinRegistry, ctx: &mut TxContext): sui::coin::Coin<TOKEN> {
    let (mut currency, mut cap) = coin_registry::new_currency<TOKEN>(registry,
        9, b"TEST".to_string(), b"Rehearsal".to_string(), b"Local only".to_string(), b"".to_string(), ctx);
    let coins = cap.mint(1_000_000_000_000_000_000, ctx);
    coin_registry::make_supply_burn_only_init(&mut currency, cap);
    coin_registry::finalize_and_delete_metadata_cap(currency, ctx);
    coins
}`

export const fund_after_upgrade = async (env: Environment, game: RehearsalGame, setup: string) => {
  await env.create_fixture('rehearsal_token', TOKEN_SOURCE)
  const token = env.publications.rehearsal_token!
  const coin_type = `${token.original}::test_token::TOKEN`
  const create = new Transaction()
  const [coins] = create.moveCall({ target: `${token.package}::test_token::create`, arguments: [create.object('0xc')] })
  create.transferObjects([coins], env.owner.toSuiAddress())
  const receipt = await env.send('create local test currency', create)
  const currency = shared_of(receipt, `::coin_registry::Currency<${coin_type}>`)
  const rewards = env.publications.rewards!
  await game.sdk.hydrate([setup, rewards.cap, env.publications.math!.cap])
  const terms = {
    package: rewards.package,
    setup,
    economy: game.pins.kares_economy as typeof currency,
    upgrade_cap: rewards.cap,
    coin_type,
    currency,
    treasury: env.owner.toSuiAddress(),
    victory_type: `${env.publications.game!.original}::fight_rewards::BossVictory`,
  }
  await assert.rejects(async () => {
    const tx = create_rewards_setup_transaction(game.sdk, { ...terms, upgrade_cap: env.publications.math!.cap })
    await game.sdk.simulate(tx)
  }, /MoveAbort|Move abort/)
  const funded = await env.send('fund upgraded rewards', create_rewards_setup_transaction(game.sdk, terms), game.sdk)
  const pools = project_rewards_setup(funded, rewards.original, coin_type)
  assert.equal((await env.json(rewards.cap)).version, '2')
  assert.equal((await env.json(pools.pool.id)).kares_rewards, String(200_000_000n * UNIT))
  assert.equal((await env.json(pools.combat_pot.id)).balance, String(100_000_000n * UNIT))
  const community = await env.json(pools.community.id)
  assert.equal(community.remaining, String(110_000_000n * UNIT))
  assert.equal(community.treasury, env.owner.toSuiAddress())
  const pins = {
    ...game.pins,
    kares_coin_type: coin_type,
    kares_currency: currency,
    kares_staking_pool: pools.pool,
    kares_combat_pot: pools.combat_pot,
    kares_community_pool: pools.community,
  }
  const sdk = env.sdk_for(env.owner, pins)
  const context = { sdk, address: env.owner.toSuiAddress() }
  const stake = await env.send(
    'stake after funding',
    await create_kares_transaction(context, { kind: 'stake', amount: 100n * UNIT }),
    sdk
  )
  const position = object_of(stake, `::staking::StakePosition<${coin_type}>`)
  assert.equal((await env.json(pools.pool.id)).principal, String(100n * UNIT))
  await env.send(
    'withdraw stake',
    await create_kares_transaction(context, { kind: 'withdraw', withdrawals: [{ id: position, amount: 100n * UNIT }] }),
    sdk
  )
  assert.equal((await env.json(pools.pool.id)).principal, '0')
  await sdk.hydrate([game.admin])
  return {
    ...game,
    sdk,
    pins,
    players: await Promise.all(
      game.players.map(async (player) => {
        const sdk = env.sdk_for(player.signer, pins)
        await sdk.hydrate([player.cap.objectId, player.cap.kioskId, player.character])
        return { ...player, sdk }
      })
    ),
  }
}
