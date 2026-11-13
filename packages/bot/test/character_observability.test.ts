// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { item_stat_center } from '@aresrpg/immutable'

import { behavior_condition } from '../src/behavior_facts.ts'
import { character_health, item_bonuses } from '../src/character_observability.ts'
import { actor_observation } from '../src/actor_observation.ts'
import { parse_behavior_script } from '../src/behavior_script.ts'

import { combat_fixture, started, row_of } from './helpers/combat_runtime_fixture.ts'
import { runtime_fixture } from './helpers/runtime_fixture.ts'
import { profession_context, character } from './helpers/profession_fixture.ts'

const hp_condition = { fact: { type: 'hp' as const, character_id: character.id }, op: 'gte' as const, value: 60 }
test('HP condition follows whole recovery ticks and remains unknown without a fresh chain clock', () => {
  const context = profession_context()
  const current = {
    ...context,
    snapshot: {
      ...context.snapshot,
      characters: [{ ...character, hp: '59', hp_ms: context.snapshot.clock!.chain_ms }],
    },
  }
  expect(behavior_condition(hp_condition, current)).toBe(false)
  expect(behavior_condition(hp_condition, { ...current, now: current.now + 1000 })).toBe(true)
  expect(behavior_condition(hp_condition, { ...current, now: current.now + 60000 })).toBeNull()
  expect(behavior_condition(hp_condition, { ...current, snapshot: { ...current.snapshot, ready: false } })).toBeNull()
  expect(
    behavior_condition(hp_condition, {
      ...current,
      snapshot: { ...current.snapshot, characters: [{ ...character, hp: '59' }] },
    })
  ).toBeNull()
})
test('balance comparisons are exact MIST and reject stale, foreign, unavailable balances', () => {
  const context = profession_context()
  const condition = { type: 'sui_balance' as const, op: 'gte' as const, value: '9007199254740993' }
  const balance = {
    address: context.address,
    balance_mist: '9007199254740992',
    sampled_at: context.now,
    expires_at: context.now + 5000,
  }
  expect(behavior_condition(condition, { ...context, balance })).toBe(false)
  expect(behavior_condition(condition, { ...context, balance: { ...balance, balance_mist: condition.value } })).toBe(
    true
  )
  expect(behavior_condition(condition, { ...context, balance, now: balance.expires_at })).toBeNull()
  expect(behavior_condition(condition, { ...context, balance: { ...balance, address: 'foreign' } })).toBeNull()
  expect(behavior_condition(condition, context)).toBeNull()
})
test('tree schema admits HP thresholds and exact MIST, rejects numeric money', () => {
  const script = (condition: unknown) => ({
    version: '1',
    objective: { title: 'Recover and fund' },
    tree: { type: 'condition', condition },
  })
  expect(() => parse_behavior_script(script(hp_condition))).not.toThrow()
  expect(() => parse_behavior_script(script({ type: 'sui_balance', op: 'gte', value: '1000000000' }))).not.toThrow()
  expect(() => parse_behavior_script(script({ type: 'sui_balance', op: 'gte', value: 1 }))).toThrow()
})

test('fight health reads the exact owned seat, with no overworld regeneration', async () => {
  const checkpoint = started()
  checkpoint.contract.fighters[0]!.hp = 7n
  const f = await combat_fixture(checkpoint)
  const player = f.context.snapshot.characters[0]!
  expect(character_health(player, f.context)).toMatchObject({ current: 7, source: 'fight', regen_ms_per_hp: null })
  expect(character_health(player, { ...f.context, now: f.context.now + 1000 })?.current).toBe(7)
  expect(character_health(player, { ...f.context, snapshot: { ...f.context.snapshot, fights: {} } })).toBeNull()
  const fighter = checkpoint.contract.fighters[0]!
  if (fighter.kind.type !== 'player') throw new Error('fixture')
  fighter.kind.owner = 'foreign'
  expect(
    character_health(player, {
      ...f.context,
      snapshot: { ...f.context.snapshot, fights: { [checkpoint.contract.id]: row_of(checkpoint) } },
    })
  ).toBeNull()
})
test('health uses current gear maximum and clamps recovery; signed pet bonuses use shared scaling', () => {
  const context = profession_context()
  const equipped = {
    ...character,
    hp: '500',
    hp_ms: context.snapshot.clock!.chain_ms,
    folded_stats: { vitality: item_stat_center + 25 },
  }
  expect(character_health(equipped, context)).toMatchObject({ current: 125, maximum: 125 })
  expect(character_health({ ...equipped, folded_stats: { vitality: item_stat_center - 500 } }, context)).toMatchObject({
    current: 1,
    maximum: 1,
  })
  expect(character_health(character, context)).toMatchObject({ current: 100, maximum: 100 })
  expect(character_health({ ...character, hp: '1', hp_ms: context.snapshot.clock!.chain_ms + 1 }, context)).toBeNull()
  expect(
    item_bonuses({
      category: 'pet',
      stats: { vitality: item_stat_center + 10, strength: item_stat_center - 10 },
      pet_power: 30,
    })
  ).toMatchObject({ vitality: 5, strength: -5 })
  expect(item_bonuses({ category: 'hat' })).toBeNull()
})
test('full observations expose health and signed rolls alongside existing raw inventory', () => {
  const context = profession_context()
  const result = actor_observation(context, 1)
  expect(result).toMatchObject({ health: { [character.id]: { current: 100, maximum: 100 } }, balance: null })
})
test('actor observation reads only its multisig and returns explicit exact-MIST freshness', async () => {
  const f = await runtime_fixture()
  const owners: string[] = []
  f.options.sdk_options.client.core.getBalance = async (...args: unknown[]) => {
    owners.push((args[0] as { owner: string }).owner)
    return { balance: { balance: '10000000000', coinBalance: '0', addressBalance: '10000000000' } }
  }
  await f.observe()
  await f.admit()
  await f.runtime.settle()
  const observation = await f.observe()
  expect(observation).toMatchObject({
    balance: {
      address: f.bot.address,
      balance_mist: '10000000000',
      unit: 'MIST',
      mist_per_sui: '1000000000',
      clock: 'monotonic_ms',
    },
  })
  expect(f.errors).toEqual([])
  expect(owners).toEqual([f.bot.address])
  await f.runtime.stop()
})
