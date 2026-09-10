// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_fight } from '../src/fight.ts'

import { create_fixture } from './helpers.ts'

const active_group = () => {
  const { checkpoint } = create_fixture()
  const game = create_fight({ state: checkpoint, mode: 'local', seed: 91n })
  game.apply({
    type: 'join',
    team: 0n,
    character: '0xc2',
    owner: '0xa2',
    hp: 100n,
    source: checkpoint.sources.players['0xc1']!,
  })
  game.apply({ type: 'ready', fighter: 2n })
  game.apply({ type: 'start', observed_ms: 60_000n })
  return game
}

test('active forfeit removes the actor before monster turns and immediately hands off to the survivor', () => {
  const game = active_group()
  const result = game.apply({ type: 'forfeit', fighter: 0n, observed_ms: 60_001n })
  expect(result.error).toBeNull()
  expect(result.state.contract.fighters[0]).toMatchObject({ dead: true, settled: true, forfeited: true, hp: 0n })
  expect(result.state.contract.queue[Number(result.state.contract.turn_ptr)]).toBe(2n)
  expect(result.events.filter(({ type }) => type === 'turn_switched')).toHaveLength(2)
  expect(result.state.contract.turn_started_ms).toBe(63_001n)
})

test('out-of-turn forfeit leaves the active turn and its seed untouched', () => {
  const game = active_group()
  const before = game.state().contract
  const result = game.apply({ type: 'forfeit', fighter: 2n, observed_ms: 60_001n })
  expect(result.error).toBeNull()
  expect(result.state.contract.turn_ptr).toBe(before.turn_ptr)
  expect(result.state.contract.turn_seed).toBe(before.turn_seed)
  expect(result.state.contract.turn_started_ms).toBe(before.turn_started_ms)
  expect(result.events.filter(({ type }) => type === 'turn_switched')).toHaveLength(0)
})

test('the last living ally forfeiting ends combat without another turn', () => {
  const game = create_fight({ state: create_fixture().checkpoint, mode: 'local' })
  game.apply({ type: 'start', observed_ms: 60_000n })
  const result = game.apply({ type: 'forfeit', fighter: 0n, observed_ms: 60_001n })
  expect(result.error).toBeNull()
  expect(result.state.contract.ended).toBe(true)
  expect(result.events.filter(({ type }) => type === 'turn_switched')).toHaveLength(0)
})

test('remote forfeit replays monster turns once and completes from the next checkpoint', async () => {
  const { mix } = await import('../src/prng.ts')
  const local = active_group()
  const remote = create_fight({ state: local.state(), mode: 'remote' })
  const action = { type: 'forfeit' as const, fighter: 0n, observed_ms: 60_001n }
  const expected = local.apply(action)
  expect(remote.apply(action)).toMatchObject({ events: [], error: null })
  expect(remote.awaiting_witness()).toBe(true)
  // The same forfeit arrives through the actor's receipt and the indexed event.
  expect(remote.apply(action)).toMatchObject({ events: [], error: null })
  const witnessed = remote.apply({ type: 'turn_seed', fighter: 1n, seed: (mix(91n, 2n) << 32n) | mix(91n, 3n) })
  const completed = remote.replace(expected.state)
  expect(witnessed.error).toBeNull()
  expect([...witnessed.events, ...completed]).toEqual([...expected.events])
  expect(remote.state()).toEqual(expected.state)
  expect(remote.apply(action)).toMatchObject({ events: [], error: null })
})
